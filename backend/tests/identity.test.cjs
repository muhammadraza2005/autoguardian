const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { PostgresAccountStore } = require('../dist/account');
const { SupabaseIdentityVerifier } = require('../dist/auth');
const { createApp } = require('../dist/app');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('Identity endpoints and runtime RLS enforce the verified user/authority', async () => {
  const db = new PGlite();
  let app;
  const originalFetch = global.fetch;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);`);
    for (const filename of ['202610050001_core_foundation.sql', '202610050002_default_permissions.sql', '202610050003_identity_api.sql']) {
      await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations', filename), 'utf8'));
    }
    await db.exec(`insert into auth.users values ('${id(1)}'),('${id(2)}');
      insert into app.tenants (id,code,name_en,country_code,currency_code,time_zone) values
      ('${id(11)}','TEST_A','Test A','CD','CDF','Africa/Kinshasa'),
      ('${id(12)}','TEST_B','Test B','CD','CDF','Africa/Kinshasa');`);
    const adapter = { query: async (sql, values) => {
      const result = await db.query(sql, values);
      return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
    }, release() {} };
    const pool = { ...adapter, connect: async () => adapter };
    const store = new PostgresAccountStore(pool, id(11));
    await assert.rejects(() => store.checkConnection(), /restricted identity login/);
    await assert.rejects(() => store.load(id(1), false), e => e.getStatus() === 404);
    const profile = await store.load(id(1), true);
    assert.deepEqual(profile.roles, [{ code: 'VERIFIER', organizationId: null }]);
    assert.equal((await store.load(id(1), true)).id, profile.id);
    assert.equal((await db.query('select count(*)::int as n from private.identity_events')).rows[0].n, 1);
    assert.equal((await db.query('select current_user as name')).rows[0].name === 'autoguardian_identity_api', false);
    assert.equal((await db.query("select nullif(current_setting('autoguardian.tenant_id',true),'') as tenant")).rows[0].tenant, null);

    // Real SQL policies: unscoped and cross-account reads are invisible.
    await db.exec('begin; set local role autoguardian_identity_api;');
    assert.equal((await db.query('select * from app.users')).rows.length, 0);
    await db.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`, [id(12), id(1)]);
    assert.equal((await db.query('select * from app.users')).rows.length, 0);
    await db.exec('rollback');

    async function denied(sql, code) {
      await db.exec('begin; set local role autoguardian_identity_api;');
      await db.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`, [id(11), id(1)]);
      try { await assert.rejects(() => db.exec(sql), e => e.code === code); }
      finally { await db.exec('rollback'); }
    }
    await denied(`insert into app.role_assignments (tenant_id,user_id,role_code) values ('${id(11)}','${profile.id}','TENANT_ADMIN')`, '42501');
    await denied(`insert into app.users (tenant_id,auth_user_id) values ('${id(11)}','${id(2)}')`, '42501');
    await denied(`update app.users set status='SUSPENDED'`, '42501');
    await denied('select * from private.owners', '42501');
    await denied('select * from app.vehicles', '42501');
    await denied('delete from private.identity_events', '42501');
    await db.exec(`update app.role_assignments set valid_to = now() where user_id='${profile.id}'`);
    assert.deepEqual((await store.load(id(1), true)).roles, []); // No restoration of revoked role.

    // Exercise the actual HTTP controller + actual SDK validation; only upstream Auth is stubbed.
    global.fetch = async (input, init) => {
      if (!String(input).startsWith('https://test.supabase.co/')) return originalFetch(input, init);
      const token = new Headers(init?.headers).get('Authorization');
      if (token === 'Bearer expired') return new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 });
      if (token === 'Bearer unavailable') return new Response('{}', { status: 503 });
      const user = { id: id(1), phone: '+15555550101', phone_confirmed_at: '2026-01-01',
        is_anonymous: false, user_metadata: { role: 'PLATFORM_ADMIN' } };
      if (token === 'Bearer unverified') delete user.phone_confirmed_at;
      if (token === 'Bearer anonymous') user.is_anonymous = true;
      return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    app = await createApp(new SupabaseIdentityVerifier('https://test.supabase.co', 'test-public-key'), store);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = (route, token, body) => originalFetch(`${base}/v1/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await request('health')).status, 200);
    assert.equal((await request('me')).status, 401);
    assert.equal((await request('me', 'expired')).status, 401);
    assert.equal((await request('me', 'unverified')).status, 403);
    assert.equal((await request('me', 'anonymous')).status, 403);
    assert.equal((await request('me/profile', 'valid', { role: 'PLATFORM_ADMIN' })).status, 400);
    assert.equal((await request('me/profile', 'valid', { tenantId: id(12) })).status, 400);
    const response = await request('me', 'valid');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).roles, []); // Metadata cannot add roles.
    assert.equal((await request('me/profile', 'valid', {})).status, 200);
    await db.exec(`update app.users set status='SUSPENDED' where id='${profile.id}'`);
    assert.equal((await request('me', 'valid')).status, 403);
    await db.exec(`update app.users set status='ACTIVE' where id='${profile.id}'; update app.tenants set status='SUSPENDED' where id='${id(11)}'`);
    assert.equal((await request('me', 'valid')).status, 403);
    // Missing authority on configured API also fails closed.
    await assert.rejects(() => new PostgresAccountStore(pool, id(99)).load(id(1), true), e => e.getStatus() === 403);
  } finally {
    if (app) await app.close();
    global.fetch = originalFetch;
    await db.close();
  }
});
