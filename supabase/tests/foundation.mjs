import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.tools/db-validation/node_modules/@electric-sql/pglite/dist/index.js';

// This engine is disposable. No network/database credentials are used.
const db = new PGlite();
let checks = 0;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function expectError(sql, code) {
  await db.exec('begin');
  try {
    await db.exec(sql);
    await db.exec('commit');
    assert.fail(`Expected SQLSTATE ${code}`);
  } catch (error) {
    assert.equal(error.code, code, error.message);
    checks++;
  } finally {
    await db.exec('rollback');
  }
}

try {
  // Only managed objects needed by the migrations are simulated.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);`);
  for (const name of ['202610050001_core_foundation.sql', '202610050002_default_permissions.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const verification = await db.exec(await readFile(new URL('../verify-foundation.sql', import.meta.url), 'utf8'));
  assert.equal(verification[0].rows.length, 8);
  assert.ok(verification[0].rows.every((r) => r.rls_enabled && r.rls_forced));
  assert.equal(verification[1].rows[0].business_role_count, 14);
  assert.equal(verification[2].rows.length, 0);
  checks += 4;

  const summary = await db.exec(await readFile(new URL('../verify-foundation-summary.sql', import.meta.url), 'utf8'));
  assert.equal(summary[0].rows.length, 6);
  assert.ok(summary[0].rows.every((row) => row.result === 'PASS'));
  checks += 2;

  const developmentSetup = await readFile(new URL('../setup-development-tenant.sql', import.meta.url), 'utf8');
  const firstSetup = await db.exec(developmentSetup);
  const developmentTenant = firstSetup.at(-1).rows[0];
  assert.equal(developmentTenant.name, 'AutoGuardian Development');
  assert.equal(developmentTenant.currency_code, 'USD');
  const repeatSetup = await db.exec(developmentSetup);
  assert.equal(repeatSetup.at(-1).rows[0].tenant_id, developmentTenant.tenant_id);
  assert.equal((await db.query("select count(*)::int as n from app.tenants where code='AUTOGUARDIAN_DEV'")).rows[0].n, 1);
  checks += 4;

  await db.exec(`insert into auth.users values ('${id(1)}'), ('${id(2)}');
    insert into app.tenants (id,code,name_en,country_code,currency_code,time_zone) values
    ('${id(11)}','TEST_A','Test A','CD','CDF','Africa/Kinshasa'),
    ('${id(12)}','TEST_B','Test B','CD','CDF','Africa/Kinshasa');
    insert into app.users (id,tenant_id,auth_user_id) values
    ('${id(21)}','${id(11)}','${id(1)}'), ('${id(22)}','${id(12)}','${id(2)}');
    insert into private.owners (id,tenant_id,user_id,kind,legal_name) values
    ('${id(31)}','${id(11)}','${id(21)}','PERSON','Test Owner A'),
    ('${id(32)}','${id(12)}','${id(22)}','PERSON','Test Owner B');
    insert into app.vehicles (id,tenant_id,chassis_identifier,category) values
    ('${id(41)}','${id(11)}','TEST-CHASSIS-A','CAR'),
    ('${id(42)}','${id(12)}','TEST-CHASSIS-B','CAR');`);

  // Duplicate identifiers across authorities and invalid cross-tenant references.
  await expectError(`insert into app.vehicles (tenant_id,chassis_identifier,category)
    values ('${id(12)}',' test-chassis-a ','CAR')`, '23505');
  await expectError(`insert into app.users (tenant_id,auth_user_id) values ('${id(11)}','${id(99)}')`, '23503');
  await expectError(`insert into app.ownerships (tenant_id,vehicle_id,owner_id,source)
    values ('${id(11)}','${id(41)}','${id(32)}','ENROLLMENT')`, '23503');
  await expectError(`insert into app.role_assignments (tenant_id,user_id,role_code)
    values ('${id(11)}','${id(22)}','TENANT_ADMIN')`, '23503');
  await expectError(`update app.tenants set time_zone = 'Invalid/Zone' where id = '${id(11)}'`, '23514');
  await expectError(`update app.vehicles set record_status = 'ACTIVE' where id = '${id(41)}'`, '23514');
  await expectError(`update app.vehicles set sale_status = 'INVENTED' where id = '${id(41)}'`, '23514');

  await db.exec(`begin;
    update app.vehicles set record_status = 'ACTIVE' where id = '${id(41)}';
    insert into app.ownerships (id,tenant_id,vehicle_id,owner_id,source,start_at)
    values ('${id(51)}','${id(11)}','${id(41)}','${id(31)}','ENROLLMENT','2026-01-01');
    commit;`);
  checks++;
  await expectError(`insert into app.ownerships (tenant_id,vehicle_id,owner_id,source)
    values ('${id(11)}','${id(41)}','${id(31)}','ENROLLMENT')`, '23505');
  await expectError(`delete from app.ownerships where id = '${id(51)}'`, '23514');
  await expectError(`update app.ownerships set end_at = '2026-02-01' where id = '${id(51)}'`, '23514');
  await db.exec(`begin;
    update app.ownerships set end_at = '2026-02-01' where id = '${id(51)}';
    insert into app.ownerships (id,tenant_id,vehicle_id,owner_id,source,start_at)
    values ('${id(52)}','${id(11)}','${id(41)}','${id(31)}','TRANSFER','2026-02-01');
    commit;`);
  assert.equal((await db.query(`select count(*)::int as n from app.ownerships where end_at is null`)).rows[0].n, 1);
  checks++;
  await expectError(`update app.ownerships set tenant_id='${id(12)}',vehicle_id='${id(42)}',owner_id='${id(32)}'
    where id='${id(52)}'`, '23514');

  // Every client/service role is blocked for every CRUD operation on all tables.
  const tables = ['app.tenants', 'app.roles', 'app.users', 'app.organizations',
    'app.role_assignments', 'private.owners', 'app.vehicles', 'app.ownerships'];
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of tables) {
      for (const statement of [`select * from ${table}`, `insert into ${table} default values`,
        `update ${table} set ${table === 'app.roles' ? 'label=label' : 'updated_at=updated_at'}`, `delete from ${table}`]) {
        await expectError(`set local role ${role}; ${statement}`, '42501');
      }
    }
  }

  // Even an accidental grant does not open RLS-protected tables to clients.
  await db.exec(`grant usage on schema app to authenticated;
    grant select, insert, update, delete on app.vehicles to authenticated;`);
  await db.exec('begin; set local role authenticated;');
  assert.equal((await db.query('select * from app.vehicles')).rows.length, 0);
  assert.equal((await db.query('update app.vehicles set color = \'RED\' returning id')).rows.length, 0);
  assert.equal((await db.query('delete from app.vehicles returning id')).rows.length, 0);
  await db.exec('rollback');
  checks += 3;
  await expectError(`set local role authenticated;
    insert into app.vehicles (tenant_id,chassis_identifier,category)
    values ('${id(11)}','TEST-DENIED','CAR')`, '42501');

  console.log(`PASS: ${checks} foundation checks (isolated PostgreSQL; no hosted changes).`);
} finally {
  await db.close();
}
