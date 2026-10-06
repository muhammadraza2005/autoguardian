const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { UnauthorizedException } = require('@nestjs/common');
const { PostgresVehicleStore } = require('../dist/vehicles');
const { createApp } = require('../dist/app');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('Development vehicle SQL is repeatable and refuses revoked grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role autoguardian_identity_login nologin;
      create schema auth; create table auth.users (id uuid primary key);`);
    for (const file of ['202610050001_core_foundation.sql', '202610050002_default_permissions.sql',
      '202610050003_identity_api.sql', '202610060004_owned_vehicle_reads.sql']) {
      await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations', file), 'utf8'));
    }
    const tenant = 'ce31527e-d1b5-4379-9ddd-1458cfb73431';
    const profile = '369cbe75-32c8-40b4-a9ee-f2d9bde379db';
    await db.exec(`insert into auth.users values ('${id(1)}');
      insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone)
      values ('${tenant}','AUTOGUARDIAN_DEV','AutoGuardian Development','CD','USD','Africa/Kinshasa');
      insert into app.users(id,tenant_id,auth_user_id) values ('${profile}','${tenant}','${id(1)}');`);
    const seed = await fs.readFile(path.resolve(__dirname, '../../supabase/setup-development-vehicle.sql'), 'utf8');
    await db.exec(seed); await db.exec(seed);
    for (const table of ['app.vehicles','app.ownerships','private.owners','app.role_assignments']) {
      assert.equal((await db.query(`select count(*)::integer as n from ${table}`)).rows[0].n,1);
    }
    const pool = { connect: async () => ({
      query: async (sql,values) => {const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length};},
      release() {}
    }) };
    const result = await new PostgresVehicleStore(pool,tenant).list(id(1),{limit:20});
    assert.equal(result.items[0].plate,'DEV-001');
    assert.equal(result.items[0].recordStatus,'PENDING_REVIEW');
    await db.exec(`update app.role_assignments set valid_to=now() where user_id='${profile}'`);
    await assert.rejects(()=>db.exec(seed),/Existing OWNER grant is inactive/);
    await db.exec('rollback');
    assert.deepEqual((await new PostgresVehicleStore(pool,tenant).list(id(1),{limit:20})).items,[]);
  } finally {await db.close();}
});

test('Vehicle HTTP endpoints and PostgreSQL policies isolate current owners', async () => {
  const db = new PGlite();
  let app;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role autoguardian_identity_login nologin;
      create schema auth; create table auth.users (id uuid primary key);`);
    for (const file of ['202610050001_core_foundation.sql', '202610050002_default_permissions.sql',
      '202610050003_identity_api.sql', '202610060004_owned_vehicle_reads.sql']) {
      await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations', file), 'utf8'));
    }
    await db.exec(`insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
      insert into app.tenants (id,code,name_en,country_code,currency_code,time_zone) values
      ('${id(11)}','TEST_A','A','CD','USD','Africa/Kinshasa'),('${id(12)}','TEST_B','B','CD','USD','Africa/Kinshasa');
      insert into app.users(id,tenant_id,auth_user_id) values
      ('${id(21)}','${id(11)}','${id(1)}'),('${id(22)}','${id(11)}','${id(2)}'),
      ('${id(23)}','${id(12)}','${id(3)}'),('${id(24)}','${id(11)}','${id(4)}');
      insert into app.role_assignments(tenant_id,user_id,role_code) values
      ('${id(11)}','${id(21)}','OWNER'),('${id(11)}','${id(22)}','OWNER'),
      ('${id(12)}','${id(23)}','OWNER'),('${id(11)}','${id(24)}','VERIFIER');
      insert into private.owners(id,tenant_id,user_id,kind,legal_name) values
      ('${id(31)}','${id(11)}','${id(21)}','PERSON','Private Name A'),
      ('${id(32)}','${id(11)}','${id(22)}','PERSON','Private Name B'),
      ('${id(33)}','${id(12)}','${id(23)}','PERSON','Private Name C');
      begin;
      insert into app.vehicles(id,tenant_id,chassis_identifier,category,record_status,deleted_at) values
      ('${id(41)}','${id(11)}','TEST_A_1','CAR','ACTIVE',null),
      ('${id(42)}','${id(11)}','TEST_A_2','CAR','SUSPENDED_UNPAID',null),
      ('${id(43)}','${id(11)}','TEST_B_1','CAR','ACTIVE',null),
      ('${id(44)}','${id(12)}','TEST_C_1','CAR','ACTIVE',null),
      ('${id(45)}','${id(11)}','TEST_A_DELETED','CAR','ARCHIVED',now()),
      ('${id(46)}','${id(11)}','TEST_A_FUTURE','CAR','PENDING_REVIEW',null);
      insert into app.ownerships(tenant_id,vehicle_id,owner_id,source,start_at) values
      ('${id(11)}','${id(41)}','${id(31)}','TEST',now()-interval '1 day'),
      ('${id(11)}','${id(42)}','${id(31)}','TEST',now()-interval '1 day'),
      ('${id(11)}','${id(43)}','${id(32)}','TEST',now()-interval '1 day'),
      ('${id(12)}','${id(44)}','${id(33)}','TEST',now()-interval '1 day'),
      ('${id(11)}','${id(45)}','${id(31)}','TEST',now()-interval '1 day'),
      ('${id(11)}','${id(46)}','${id(31)}','TEST',now()+interval '1 day');
      commit;`);
    const adapter = { query: async (sql, values) => {
      const r = await db.query(sql, values);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    }, release() {} };
    const pool = { connect: async () => adapter };
    const store = new PostgresVehicleStore(pool, id(11));
    const first = await store.list(id(1), { limit: 1 });
    assert.deepEqual(first.items.map(v => v.id), [id(41)]);
    assert.equal(first.nextCursor, id(41));
    const second = await store.list(id(1), { limit: 1, cursor: first.nextCursor });
    assert.deepEqual(second.items.map(v => v.id), [id(42)]);
    assert.equal(second.nextCursor, null);
    assert.equal((await store.detail(id(1), id(42))).vehicle.recordStatus, 'SUSPENDED_UNPAID');
    assert.deepEqual(await store.list(id(4), { limit: 20 }), { items: [], nextCursor: null });
    for (const v of [43, 44, 45, 46, 99]) {
      await assert.rejects(() => store.detail(id(1), id(v)), e => e.getStatus() === 404);
    }
    await assert.rejects(() => store.list(id(3), { limit: 20 }), e => e.getStatus() === 403);
    assert.equal((await new PostgresVehicleStore(pool, id(12)).list(id(3), { limit: 20 })).items[0].id, id(44));

    async function context(user, tenant, operation, role = 'autoguardian_vehicle_reader') {
      await db.exec(`begin; set local role ${role};`);
      try {
        if (user) await db.query(`select set_config('autoguardian.auth_user_id',$1,true),set_config('autoguardian.tenant_id',$2,true)`, [user, tenant]);
        return await operation();
      } finally { await db.exec('rollback'); }
    }
    assert.deepEqual((await context(id(1),id(11),()=>db.query('select id from app.vehicles order by id'))).rows.map(v=>v.id),[id(41),id(42)]);
    assert.equal((await context(null,null,()=>db.query('select id from app.vehicles'))).rows.length,0);
    assert.equal((await context(id(1),id(12),()=>db.query('select id from app.vehicles'))).rows.length,0);
    for (const sql of ['select legal_name from private.owners', 'select seal_package from app.vehicles',
      'insert into app.vehicles default values', "update app.vehicles set color='RED'", 'delete from app.vehicles',
      "insert into app.role_assignments(tenant_id,user_id,role_code) values ('"+id(11)+"','"+id(21)+"','OWNER')"]) {
      await assert.rejects(() => context(id(1),id(11),()=>db.exec(sql)), e=>e.code==='42501');
    }
    for (const role of ['anon','authenticated','service_role']) {
      await assert.rejects(() => context(null,null,()=>db.exec('select id from app.vehicles'),role),e=>e.code==='42501');
    }
    assert.equal((await db.query("select nullif(current_setting('autoguardian.tenant_id',true),'') as tenant")).rows[0].tenant,null);

    const auth = { verify: async header => {
      if (header !== 'Bearer owner') throw new UnauthorizedException({code:'AUTH_REQUIRED'});
      return id(1);
    } };
    app=await createApp(auth,{load:async()=>({})},undefined,store);
    await app.listen(0,'127.0.0.1'); const base=await app.getUrl();
    const request = (route, signedIn=true) => fetch(`${base}/v1/me/vehicles${route}`, {headers:signedIn?{Authorization:'Bearer owner'}:{}});
    assert.equal((await request('',false)).status,401);
    assert.equal((await request('/'+id(41),false)).status,401);
    const detail=await request('/'+id(41));assert.equal(detail.status,200);
    assert.equal(detail.headers.get('cache-control'),'no-store');
    const response=await detail.json();
    assert.equal(response.vehicle.id,id(41));
    for (const field of ['ownerId','userId','tenantId','legalName','sealPackage','authUserId']) assert.equal(field in response.vehicle,false);
    for (const route of ['?limit=0','?limit=51','?limit=1.5','?limit=one','?limit=1&limit=2',
      '?cursor=bad','?tenantId='+id(12),'?userId='+id(22),'/bad','/'+id(41)+'?ownerId='+id(32)]) {
      assert.equal((await request(route)).status,400,route);
    }
    const unauthorized=await request('/'+id(43));const missing=await request('/'+id(99));
    assert.equal(unauthorized.status,404);assert.equal(missing.status,404);
    assert.deepEqual(await unauthorized.json(),await missing.json());

    // Current ownership alone does not substitute for an OWNER grant.
    await db.exec(`update app.role_assignments set valid_to=now() where user_id='${id(21)}' and role_code='OWNER'`);
    assert.deepEqual((await store.list(id(1),{limit:20})).items,[]);
    await db.exec(`update app.role_assignments set valid_to=null where user_id='${id(21)}';
      begin;
      update app.ownerships set end_at=now() where vehicle_id='${id(41)}' and end_at is null;
      insert into app.ownerships(tenant_id,vehicle_id,owner_id,source)
      values ('${id(11)}','${id(41)}','${id(32)}','TEST_TRANSFER'); commit;`);
    await assert.rejects(()=>store.detail(id(1),id(41)),e=>e.getStatus()===404);
    assert.equal((await store.detail(id(2),id(41))).vehicle.id,id(41));
    await db.exec(`update private.owners set deleted_at=now() where id='${id(31)}'`);
    assert.deepEqual((await store.list(id(1),{limit:20})).items,[]);
    await db.exec(`update private.owners set deleted_at=null where id='${id(31)}';
      update app.users set status='SUSPENDED' where id='${id(21)}'`);
    await assert.rejects(()=>store.list(id(1),{limit:20}),e=>e.getStatus()===403);
    await db.exec(`update app.users set status='ACTIVE' where id='${id(21)}';
      update app.tenants set status='SUSPENDED' where id='${id(11)}'`);
    await assert.rejects(()=>store.list(id(1),{limit:20}),e=>e.getStatus()===403);
  } finally {if(app)await app.close();await db.close();}
});
