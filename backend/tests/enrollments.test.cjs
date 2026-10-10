const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { UnauthorizedException } = require('@nestjs/common');
const { createApp } = require('../dist/app');
const { draftInput, DevelopmentDraftVerifier, PostgresEnrollmentStore } = require('../dist/enrollments');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431';
const profile='369cbe75-32c8-40b4-a9ee-f2d9bde379db';
const org='014db61a-4c68-48cb-86b6-46837f4da873';
async function foundation() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create role autoguardian_identity_login nologin;
    create schema auth;create table auth.users(id uuid primary key);`);
  for (const f of ['202610050001_core_foundation.sql','202610050002_default_permissions.sql',
    '202610050003_identity_api.sql','202610060004_owned_vehicle_reads.sql','202610060005_enrollment_drafts.sql',
    '202610060006_development_owner_selection.sql','202610060007_enrollment_attachments.sql']) {
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',f),'utf8'));
  }
  await db.exec(`insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}');
    insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values
    ('${tenant}','AUTOGUARDIAN_DEV','Dev','CD','USD','Africa/Kinshasa'),('${id(12)}','OTHER_TENANT','Other','CD','USD','Africa/Kinshasa');
    insert into app.users(id,tenant_id,auth_user_id) values
    ('${profile}','${tenant}','${id(1)}'),('${id(22)}','${tenant}','${id(2)}'),('${id(23)}','${id(12)}','${id(3)}');`);
  const seed=await fs.readFile(path.resolve(__dirname,'../../supabase/setup-development-agent.sql'),'utf8');
  await db.exec(seed);
  await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/setup-development-owner.sql'),'utf8'));
  await db.exec(`insert into private.development_enrollment_owners(tenant_id,organization_id,user_id,label)
    values ('${tenant}','${org}','${id(22)}','Development owner 2');`);
  const pool={connect:async()=>({query:async(sql,values)=>{
    const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0};
  },release(){}})};
  return {db,pool,seed,store:new PostgresEnrollmentStore(pool,tenant)};
}

test('draft migration can be installed by a non-superuser schema owner, as on hosted Supabase',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create role autoguardian_identity_login nologin;
      create role migration_author createrole;create schema auth;create table auth.users(id uuid primary key);
      grant usage on schema auth to migration_author;grant references on auth.users to migration_author;
      grant create on database postgres to migration_author;set role migration_author;`);
    for(const f of ['202610050001_core_foundation.sql','202610050002_default_permissions.sql','202610050003_identity_api.sql',
      '202610060004_owned_vehicle_reads.sql','202610060005_enrollment_drafts.sql','202610060006_development_owner_selection.sql',
      '202610060007_enrollment_attachments.sql','202610060008_development_seal_fitting.sql',
      '202610080009_enrollment_readiness.sql','202610080010_enrollment_owner_consent.sql',
      '202610090011_enrollment_evidence_checklist.sql','202610090012_seal_fitting_validation.sql',
      '202610100013_seal_location_notes.sql','202610100014_development_evidence_reviews.sql',
      '202610100015_native_evidence_uploads.sql','202610100016_enrollment_finalization.sql',
      '202610100017_independent_registration_reviews.sql']) {
      await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',f),'utf8'));
    }
    assert.equal((await db.query("select pg_has_role('migration_author','autoguardian_enrollment_executor','MEMBER') member")).rows[0].member,true);
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int n from pg_proc where proname='save_enrollment_draft'")).rows[0].n,1);
  } finally {await db.close();}
});
const body=(chassis='DRAFT-TEST-001',plate='DRAFT-001')=>({organizationId:org,ownerProfileId:profile,
  vehicle:{chassisIdentifier:chassis,plate,category:'CAR',make:'Development',model:'Draft vehicle',manufactureYear:null,color:null}});

test('draft validation normalizes identifiers, rejects activation/client scope, and production agent auth stays closed',async()=>{
  assert.equal(draftInput(body('  draft-001  ','  plate-001  ')).vehicle.chassisIdentifier,'DRAFT-001');
  for (const b of [{...body(),tenantId:tenant},{...body(),status:'ACTIVE'},
    {...body(),vehicle:{...body().vehicle,sealPackage:'FOUR_ALARMS'}},
    {...body(),vehicle:{...body().vehicle,manufactureYear:'2020'}},
    {...body(),vehicle:{...body().vehicle,chassisIdentifier:'\u0000bad'}},
    {...body(),ownerProfileId:id(1),expectedRevision:0}]) {
    assert.throws(()=>draftInput(b,true));
  }
  const identity={verify:async()=>id(1)};
  assert.equal(await new DevelopmentDraftVerifier(identity,true).verify('Bearer test'),id(1));
  await assert.rejects(()=>new DevelopmentDraftVerifier(identity,false).verify('Bearer test'),e=>e.getStatus()===403);
});

test('draft save, replay, revision checks and duplicate rejection preserve ownership and append events',async()=>{
  const {db,store,seed}=await foundation();
  try {
    await db.exec(seed);
    const first=await store.save(id(1),draftInput(body()),undefined,id(80));
    assert.equal(first.draft.status,'DRAFT');assert.equal(first.draft.revision,1);
    const replay=await store.save(id(1),draftInput(body()),undefined,id(80));
    assert.equal(replay.draft.id,first.draft.id);
    await assert.rejects(()=>store.save(id(1),draftInput(body('OTHER')),undefined,id(80)),e=>e.getStatus()===409);
    const changed=await store.save(id(1),draftInput({...body(),vehicle:{...body().vehicle,color:'Blue'},expectedRevision:1},true),first.draft.id);
    assert.equal(changed.draft.revision,2);
    await assert.rejects(()=>store.save(id(1),draftInput({...body(),expectedRevision:1},true),first.draft.id),e=>e.getStatus()===409);
    for (const b of [body(),body('DIFFERENT','draft-001')]) {
      await assert.rejects(()=>store.save(id(1),draftInput(b),undefined,id(81)),e=>e.getStatus()===409);
    }
    assert.equal((await store.list(id(1),{limit:20})).items.length,1);
    assert.equal((await store.detail(id(1),first.draft.id)).draft.vehicle.color,'Blue');
    assert.equal((await db.query('select count(*)::int n from private.enrollment_events')).rows[0].n,4);
    for (const table of ['app.vehicles','app.ownerships','private.owners']) {
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
    }
    assert.equal((await db.query("select count(*)::int n from app.role_assignments where role_code='OWNER'")).rows[0].n,0);
    // Global chassis conflict includes another authority; tenant plates remain provisional.
    await db.exec(`insert into app.vehicles(tenant_id,chassis_identifier,current_plate,category)
      values ('${id(12)}','GLOBAL-EXISTING','SAME-PLATE','CAR'),('${tenant}','LOCAL-EXISTING','LOCAL-PLATE','CAR');`);
    for (const b of [body(' global-existing ','NEW'),body('NEW','local-plate')]) {
      await assert.rejects(()=>store.save(id(1),draftInput(b),undefined,id(82)),e=>e.getStatus()===409);
    }
    assert.equal((await db.query("select count(*)::int n from private.enrollment_events where action='DUPLICATE_REJECTED'")).rows[0].n,4);
    await assert.rejects(()=>store.save(id(1),draftInput({...body('NEW'),ownerProfileId:id(23)}),undefined,id(83)),e=>e.getStatus()===422);
    await db.exec(`update app.users set status='SUSPENDED' where id='${id(22)}'`);
    await assert.rejects(()=>store.save(id(1),draftInput({...body('NEW'),ownerProfileId:id(22)}),undefined,id(83)),e=>e.getStatus()===422);
    assert.equal((await db.query("select nullif(current_setting('autoguardian.tenant_id',true),'') context")).rows[0].context,null);
  } finally {await db.close();}
});

test('draft HTTP/RLS denies other agents, missing accreditation, revoked grants, client writes and private identity reads',async()=>{
  const {db,store}=await foundation();let app;
  try {
    const auth={verify:async header=>{
      if (header!=='Bearer agent') throw new UnauthorizedException({code:'AUTH_REQUIRED'});return id(1);
    }};
    app=await createApp(auth,{load:async()=>({})},'http://localhost:8081',undefined,{auth:new DevelopmentDraftVerifier(auth,true),store});
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    const request=(suffix='',method='GET',payload,key)=>fetch(base+'/v1/enrollment-drafts'+suffix,{method,
      headers:{Authorization:'Bearer agent','Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})});
    assert.equal((await fetch(base+'/v1/enrollment-drafts')).status,401);
    assert.equal((await fetch(base+'/v1/enrollment-drafts/owner-options?organizationId='+org)).status,401);
    assert.equal((await request('/owner-options')).status,400);
    assert.equal((await request('/owner-options?organizationId='+org+'&tenantId='+tenant)).status,400);
    const owners=await request('/owner-options?organizationId='+org);assert.equal(owners.status,200);
    assert.equal((await owners.json()).items.length,2);
    assert.equal((await request('','POST',body())).status,400);
    assert.equal((await request('','POST',{...body(),status:'ACTIVE'},id(81))).status,400);
    const created=await request('','POST',body(),id(80));assert.equal(created.status,200);
    assert.equal(created.headers.get('cache-control'),'no-store');const data=await created.json();
    assert.equal((await request('/bad')).status,400);
    assert.equal((await request('?tenantId='+id(12))).status,400);
    const preflight=await fetch(base+'/v1/enrollment-drafts/'+data.draft.id,{method:'OPTIONS',headers:{Origin:'http://localhost:8081','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'idempotency-key'}});
    assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-methods'),/PUT/);
    await assert.rejects(()=>store.list(id(2),{limit:20}),e=>e.getStatus()===403);
    // An agent grant by itself is insufficient.
    await db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code,organization_id)
      values ('${tenant}','${id(22)}','ENROLLMENT_AGENT','${org}');`);
    await assert.rejects(()=>store.list(id(2),{limit:20}),e=>e.getStatus()===403);
    await db.exec(`insert into app.agent_accreditations(tenant_id,user_id,organization_id) values ('${tenant}','${id(22)}','${org}');`);
    assert.deepEqual((await store.list(id(2),{limit:20})).items,[]);
    await assert.rejects(()=>store.detail(id(2),data.draft.id),e=>e.getStatus()===404);
    await assert.rejects(()=>store.detail(id(2),id(999)),e=>e.getStatus()===404);
    await assert.rejects(()=>store.save(id(2),draftInput({...body(),expectedRevision:1},true),data.draft.id),e=>e.getStatus()===404);
    // Unique indexes catch a conflict invisible through the other agent's RLS.
    await assert.rejects(()=>store.save(id(2),draftInput(body()),undefined,id(81)),e=>e.getStatus()===409);
    const other=await store.save(id(2),draftInput({...body('OTHER-AGENT','OTHER-001'),ownerProfileId:id(22)}),undefined,id(82));
    assert.equal(other.draft.ownerProfileId,id(22));
    async function context(role,subject,operation,scope=tenant) {
      await db.exec(`begin;set local role ${role}`);
      try {if(subject) await db.query("select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)",[scope,subject]);return await operation();}
      finally {await db.exec('rollback');}
    }
    assert.equal((await context('autoguardian_enrollment_api',null,()=>db.query('select id from app.enrollment_drafts'))).rows.length,0);
    assert.deepEqual((await context('autoguardian_enrollment_api',id(1),()=>db.query('select id from app.enrollment_drafts'))).rows.map(r=>r.id),[data.draft.id]);
    assert.equal((await context('autoguardian_enrollment_api',id(1),()=>db.query('select id from app.enrollment_drafts'),id(12))).rows.length,0);
    for (const sql of ['select auth_user_id from app.users','select legal_name from private.owners','select chassis_identifier from app.vehicles',
      'select creation_payload from app.enrollment_drafts','insert into app.enrollment_drafts default values',
      "update app.enrollment_drafts set status='ACTIVE'",'delete from app.enrollment_drafts',
      'select * from private.enrollment_events','delete from private.enrollment_events']) {
      await assert.rejects(()=>context('autoguardian_enrollment_api',id(1),()=>db.exec(sql)),e=>e.code==='42501');
    }
    await assert.rejects(()=>context('autoguardian_enrollment_api',id(1),()=>db.query(
      'select private.save_enrollment_draft_metadata($1,$2,$3,$4,$5::jsonb,$6)',
      [null,id(99),org,profile,JSON.stringify(body().vehicle),null])),e=>e.code==='42501');
    await assert.rejects(()=>context('autoguardian_enrollment_api',id(1),()=>db.exec('select * from private.development_enrollment_owners')),e=>e.code==='42501');
    // PGlite's session user is postgres even after SET LOCAL ROLE; validate the
    // real login's membership rather than testing postgres's ability to switch roles.
    assert.equal((await db.query("select pg_has_role('autoguardian_identity_login','autoguardian_enrollment_executor','MEMBER') member")).rows[0].member,false);
    assert.equal((await db.query("select rolsuper or rolbypassrls privileged from pg_roles where rolname='autoguardian_enrollment_executor'")).rows[0].privileged,false);
    for (const role of ['anon','authenticated','service_role']) {
      await assert.rejects(()=>context(role,null,()=>db.exec('select id from app.enrollment_drafts')),e=>e.code==='42501');
      await assert.rejects(()=>context(role,null,()=>db.query('select private.enrollment_agent_id(null)')),e=>e.code==='42501');
    }
    await db.exec(`update app.agent_accreditations set status='SUSPENDED' where user_id='${profile}'`);
    assert.equal((await request()).status,403);
    await db.exec(`update app.agent_accreditations set status='ACTIVE' where user_id='${profile}';
      update app.role_assignments set valid_to=now() where user_id='${profile}' and role_code='ENROLLMENT_AGENT'`);
    assert.equal((await request()).status,403);
    const seed=await fs.readFile(path.resolve(__dirname,'../../supabase/setup-development-agent.sql'),'utf8');
    await assert.rejects(()=>db.exec(seed),/Existing agent grant is inactive/);await db.exec('rollback');
  } finally {if(app)await app.close();await db.close();}
});

test('owner selection is organization scoped, exposes synthetic aliases only, and refuses withdrawn or suspended candidates',async()=>{
  const {db,store}=await foundation();
  try {
    const options=await store.ownerOptions(id(1),org);
    assert.deepEqual(options.items,[{profileId:profile,label:'Development owner 1',verificationStatus:'NOT_VERIFIED'},
      {profileId:id(22),label:'Development owner 2',verificationStatus:'NOT_VERIFIED'}]);
    await assert.rejects(()=>store.ownerOptions(id(1),id(999)),e=>e.getStatus()===403);
    await assert.rejects(()=>store.ownerOptions(id(2),org),e=>e.getStatus()===403);
    await db.exec(`insert into auth.users values ('${id(4)}');
      insert into app.users(id,tenant_id,auth_user_id) values ('${id(24)}','${tenant}','${id(4)}');`);
    await assert.rejects(()=>store.save(id(1),draftInput({...body(),ownerProfileId:id(24)}),undefined,id(80)),e=>e.getStatus()===422);
    const saved=await store.save(id(1),draftInput(body()),undefined,id(80));
    await db.exec(`update private.development_enrollment_owners set active=false where user_id='${profile}';
      update app.users set status='SUSPENDED' where id='${id(22)}';`);
    assert.deepEqual((await store.ownerOptions(id(1),org)).items,[]);
    await assert.rejects(()=>store.save(id(1),draftInput({...body(),expectedRevision:1},true),saved.draft.id),e=>e.getStatus()===422);
    await assert.rejects(()=>store.save(id(1),draftInput(body()),undefined,id(80)),e=>e.getStatus()===422);
    const setup=await fs.readFile(path.resolve(__dirname,'../../supabase/setup-development-owner.sql'),'utf8');
    await assert.rejects(()=>db.exec(setup),/will not restore it/);await db.exec('rollback');
    assert.equal((await store.detail(id(1),saved.draft.id)).draft.revision,1);
    await assert.rejects(()=>db.exec(`insert into private.development_enrollment_owners(tenant_id,organization_id,user_id,label)
      values ('${tenant}','${org}','${id(24)}','Real Person')`),e=>e.code==='23514');
  } finally {await db.close();}
});
