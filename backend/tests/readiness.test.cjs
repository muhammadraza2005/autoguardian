const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {UnauthorizedException}=require('@nestjs/common');const {createApp}=require('../dist/app');
const {PostgresReadinessStore}=require('../dist/readiness');
const {PostgresEnrollmentStore,draftInput,DevelopmentDraftVerifier}=require('../dist/enrollments');
const {PostgresSealStore}=require('../dist/seals');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431',profile='369cbe75-32c8-40b4-a9ee-f2d9bde379db',org='014db61a-4c68-48cb-86b6-46837f4da873';
async function foundation(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role autoguardian_identity_login nologin;
    create schema auth;create table auth.users(id uuid primary key);`);
  for(const file of (await fs.readdir(path.resolve(__dirname,'../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'));
  await db.exec(`insert into auth.users values ('${id(1)}'),('${id(2)}');
    insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values ('${tenant}','AUTOGUARDIAN_DEV','Development','CD','USD','Africa/Kinshasa');
    insert into app.users(id,tenant_id,auth_user_id) values ('${profile}','${tenant}','${id(1)}'),('${id(22)}','${tenant}','${id(2)}');`);
  for(const file of ['setup-development-agent.sql','setup-development-owner.sql','setup-development-seal-stock.sql'])
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase',file),'utf8'));
  const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows};},release(){}})};
  const drafts=new PostgresEnrollmentStore(pool,tenant),seals=new PostgresSealStore(pool,tenant),readiness=new PostgresReadinessStore(pool,tenant);
  const body={organizationId:org,ownerProfileId:profile,vehicle:{chassisIdentifier:'READINESS-TEST',plate:'READY-001',category:'CAR'}};
  const draft=(await drafts.save(id(1),draftInput(body),undefined,id(80))).draft;
  return {db,pool,drafts,seals,readiness,draft,body};
}
const state=(result,code)=>result.checks.find(check=>check.code===code).status;
test('readiness tracks current staged samples, seal revocation and stale revisions without enabling enrollment',async()=>{
  const {db,drafts,seals,readiness,draft,body}=await foundation();
  try{
    let result=await readiness.read(id(1),draft.id);
    assert.equal(result.canSubmit,false);assert.equal(result.enrollmentActive,false);assert.equal(result.sampleOnly,true);
    assert.equal(state(result,'OWNER_SELECTION'),'COMPLETE');assert.equal(state(result,'IDENTITY_SAMPLE'),'MISSING');
    assert.equal(state(result,'SEAL_FITTING'),'MISSING');
    const kinds=['OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_PHOTO',...Array(4).fill('SEAL_FITTING_PHOTO')];
    for(let n=0;n<kinds.length;n++)await db.exec(`insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,kind,mime_type,byte_size,sha256,object_path,status)
      values('${id(100+n)}','${tenant}','${draft.id}','${profile}','${org}','${profile}','${kinds[n]}','image/jpeg',10,'${'a'.repeat(64)}','sample-${n}','${n===0?'PENDING':'STAGED'}');`);
    result=await readiness.read(id(1),draft.id);assert.equal(state(result,'IDENTITY_SAMPLE'),'MISSING');
    assert.equal(state(result,'REGISTRATION_SAMPLE'),'COMPLETE');assert.equal(state(result,'VEHICLE_PHOTO_SAMPLE'),'COMPLETE');
    await db.exec(`update private.enrollment_attachments set status='STAGED' where id='${id(100)}'`);
    await seals.save(id(1),draft.id,id(90),{expectedDraftRevision:1,expectedFittingRevision:0,package:'STANDARD',
      placements:[1,2,3,4].map(n=>({position:n,sealCode:'DEV-SEAL-STD-00'+n,photoId:id(102+n)}))});
    result=await readiness.read(id(1),draft.id);
    assert.ok(result.checks.slice(0,6).every(check=>check.status==='COMPLETE'));
    assert.ok(result.checks.filter(check=>['AGENT_AUTHENTICATION','OWNER_PHONE','CONSENT','PRODUCTION_EVIDENCE','PAYMENT','REVIEW_POLICY','FINALIZATION'].includes(check.code)).every(check=>check.status==='UNAVAILABLE'));
    assert.equal(state(result,'OWNER_DETAILS_SAMPLE'),'MISSING');assert.equal(state(result,'CONSENT_SAMPLE'),'MISSING');assert.equal(result.canSubmit,false);
    const encoded=JSON.stringify(result);for(const field of ['ownerProfileId','object_path','sha256','photoId','sealCode','auth_user_id'])assert.ok(!encoded.includes(field));
    await db.exec("update private.development_seal_stock set status='REVOKED' where code='DEV-SEAL-STD-001'");
    assert.equal(state(await readiness.read(id(1),draft.id),'SEAL_FITTING'),'MISSING');
    await drafts.save(id(1),draftInput({...body,expectedRevision:1},true),draft.id);
    result=await readiness.read(id(1),draft.id);assert.equal(result.draftRevision,2);assert.equal(state(result,'SEAL_FITTING'),'STALE');
    await seals.save(id(1),draft.id,id(91),{expectedDraftRevision:2,expectedFittingRevision:1,package:'NONE',placements:[]});
    result=await readiness.read(id(1),draft.id);assert.equal(state(result,'SEAL_FITTING'),'COMPLETE');assert.equal(result.canSubmit,false);
    await db.exec(`update private.development_enrollment_owners set active=false where user_id='${profile}'`);
    assert.equal(state(await readiness.read(id(1),draft.id),'OWNER_SELECTION'),'MISSING');
    await db.exec(`insert into private.development_enrollment_owners(tenant_id,organization_id,user_id,label)
      values('${tenant}','${org}','${id(22)}','Development owner 2')`);
    await drafts.save(id(1),draftInput({...body,ownerProfileId:id(22),expectedRevision:2},true),draft.id);
    result=await readiness.read(id(1),draft.id);
    assert.equal(state(result,'OWNER_SELECTION'),'COMPLETE');
    for(const code of ['IDENTITY_SAMPLE','REGISTRATION_SAMPLE','VEHICLE_PHOTO_SAMPLE'])assert.equal(state(result,code),'MISSING');
    assert.equal(state(result,'SEAL_FITTING'),'STALE');
    for(const table of ['app.vehicles','app.ownerships','private.owners'])assert.equal((await db.query('select count(*)::int n from '+table)).rows[0].n,0);
  }finally{await db.close();}
});
test('readiness denies cross-agent, cross-tenant and revoked access and validates the HTTP boundary',async()=>{
  const {db,pool,drafts,readiness,draft}=await foundation();let app;
  try{
    await assert.rejects(()=>readiness.read(id(2),draft.id),e=>e.getStatus()===403);
    await db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code,organization_id) values('${tenant}','${id(22)}','ENROLLMENT_AGENT','${org}');
      insert into app.agent_accreditations(tenant_id,user_id,organization_id) values('${tenant}','${id(22)}','${org}');`);
    await assert.rejects(()=>readiness.read(id(2),draft.id),e=>e.getStatus()===404);
    await assert.rejects(()=>new PostgresReadinessStore(pool,id(999)).read(id(1),draft.id),e=>e.getStatus()===403);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('begin;set local role '+role);
      await assert.rejects(()=>db.query('select private.enrollment_readiness($1)',[draft.id]),e=>e.code==='42501');
      await db.exec('rollback');
    }
    await db.exec('begin;set local role autoguardian_enrollment_api');
    await assert.rejects(()=>db.query('select private.enrollment_readiness($1)',[draft.id]),e=>e.code==='AG404');
    await db.exec('rollback');
    const auth={verify:async header=>{if(header!=='Bearer agent')throw new UnauthorizedException();return id(1);}};
    app=await createApp(auth,{load:async()=>({})},undefined,undefined,{auth:new DevelopmentDraftVerifier(auth,true),store:drafts,readiness});
    await app.listen(0,'127.0.0.1');const base=await app.getUrl(),route=base+'/v1/enrollment-drafts/'+draft.id+'/readiness';
    assert.equal((await fetch(route)).status,401);
    const headers={Authorization:'Bearer agent'};
    assert.equal((await fetch(route+'?tenantId='+tenant,{headers})).status,400);
    assert.equal((await fetch(base+'/v1/enrollment-drafts/invalid/readiness',{headers})).status,400);
    const response=await fetch(route,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).canSubmit,false);
    await db.exec(`update app.agent_accreditations set status='SUSPENDED' where user_id='${profile}'`);
    assert.equal((await fetch(route,{headers})).status,403);
  }finally{if(app)await app.close();await db.close();}
});
test('readiness reports a missing migration as setup required and releases the connection',async()=>{
  let released=false;const calls=[];
  const store=new PostgresReadinessStore({connect:async()=>({query:async sql=>{calls.push(sql);
    if(sql.includes('enrollment_agent_id'))return {rows:[{actor:id(1)}]};
    if(sql.includes('enrollment_readiness'))throw Object.assign(new Error('missing'),{code:'42883'});
    return {rows:[]};},release(){released=true;}})},tenant);
  await assert.rejects(()=>store.read(id(1),id(80)),e=>e.getStatus()===503 && e.getResponse().code==='READINESS_SETUP_REQUIRED');
  assert.ok(calls.includes('rollback'));assert.ok(released);
});
