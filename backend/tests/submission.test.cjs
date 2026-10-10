const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {PostgresSubmissionStore,submissionInput}=require('../dist/submission');
const {PostgresEnrollmentStore,draftInput}=require('../dist/enrollments');
const {PostgresVehicleStore}=require('../dist/vehicles');
const {createApp}=require('../dist/app');const {UnauthorizedException}=require('@nestjs/common');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431',profile='369cbe75-32c8-40b4-a9ee-f2d9bde379db',org='014db61a-4c68-48cb-86b6-46837f4da873';
const codes=['AGENT_AUTHENTICATION','OWNER_PHONE','CONSENT','PRODUCTION_EVIDENCE','SEALS','PAYMENT','REVIEW_POLICY'];
async function foundation(){
  const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create role autoguardian_identity_login nologin;create schema auth;create table auth.users(id uuid primary key);`);
  for(const file of (await fs.readdir(path.resolve(__dirname,'../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
    insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values('${tenant}','AUTOGUARDIAN_DEV','Development','CD','USD','Africa/Kinshasa');
    insert into app.users(id,tenant_id,auth_user_id) values('${profile}','${tenant}','${id(1)}'),('${id(22)}','${tenant}','${id(2)}'),('${id(23)}','${tenant}','${id(3)}');`);
  for(const file of ['setup-development-agent.sql','setup-development-owner.sql'])
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase',file),'utf8'));
  const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},release(){}})};
  const drafts=new PostgresEnrollmentStore(pool,tenant),store=new PostgresSubmissionStore(pool,tenant),vehicles=new PostgresVehicleStore(pool,tenant);
  const draft=(await drafts.save(id(1),draftInput({organizationId:org,ownerProfileId:profile,vehicle:{chassisIdentifier:'FINAL-001',plate:'FINAL-001',category:'CAR'}}),undefined,id(80))).draft;
  async function context(){await db.query("select set_config('autoguardian.tenant_id',$1,false),set_config('autoguardian.auth_user_id',$2,false)",[tenant,id(1)]);}
  async function receipt(code,accepted=true,expires="now()+interval '1 hour'"){
    await context();await db.query(`insert into private.enrollment_prerequisite_receipts(tenant_id,draft_id,draft_revision,owner_generation,
      fitting_revision,snapshot_revision,code,accepted,trusted_reference,expires_at)
      select tenant_id,id,revision,owner_generation,coalesce((select revision from private.draft_seal_packages where draft_id=$1),0),enrollment_snapshot_revision,$2,$3,'SYNTHETIC_TRUSTED_FIXTURE',${expires}
      from app.enrollment_drafts where id=$1`,[draft.id,code,accepted]);
  }
  async function ready(){
    await context();
    for(const [n,kind]of ['OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO'].entries())
      await db.query(`insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,
        kind,mime_type,byte_size,sha256,object_path,status) values($1,$2,$3,$4,$5,$4,$6,'image/jpeg',10,$7,$8,'STAGED')`,
        [id(200+n),tenant,draft.id,profile,org,kind,String(n).padStart(64,'a'),'synthetic-'+n]);
    await db.query(`insert into private.draft_seal_packages(draft_id,tenant_id,organization_id,agent_user_id,owner_profile_id,
      saved_draft_revision,revision,package) values($1,$2,$3,$4,$4,1,1,'NONE')`,[draft.id,tenant,org,profile]);
    await db.query("update app.enrollment_drafts set enrollment_mode='PRODUCTION' where id=$1",[draft.id]);
    await db.exec(`insert into private.owners(id,tenant_id,user_id,kind,legal_name) values('${id(90)}','${tenant}','${profile}','PERSON','Synthetic owner');
      insert into app.role_assignments(tenant_id,user_id,role_code) values('${tenant}','${profile}','OWNER');`);
    // Production integration is not installed: only isolated privileged fixtures
    // mint receipts. The runtime must have no path to do this.
    for(const code of codes)await receipt(code);
  }
  return {db,pool,drafts,store,vehicles,draft,context,receipt,ready};
}
test('submission is fail-closed for samples, strict input, missing setup and missing trusted prerequisites',async()=>{
  for(const body of [{},{expectedDraftRevision:0},{expectedDraftRevision:1,paymentConfirmed:true},{expectedDraftRevision:'1'},null])
    assert.throws(()=>submissionInput(body),e=>e.getStatus()===400);
  const f=await foundation();try{
    const state=await f.store.read(id(1),f.draft.id);assert.equal(state.mode,'DEVELOPMENT');assert.equal(state.canSubmit,false);assert.equal(state.canFinalize,false);
    assert.equal(state.checks.length,7);assert.ok(state.checks.every(c=>c.status==='MISSING'));
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(100),1,'submit',1),e=>e.getStatus()===409&&e.getResponse().code==='ENROLLMENT_PREREQUISITES_REQUIRED');
    await assert.rejects(()=>f.store.read(id(2),f.draft.id),e=>e.getStatus()===403);
    for(const table of ['app.vehicles','app.ownerships','private.enrollment_submissions','private.enrollment_finalization_events'])
      assert.equal((await f.db.query('select count(*)::int n from '+table)).rows[0].n,0);
    await f.ready();await f.context();await f.db.query("update app.enrollment_drafts set enrollment_mode='DEVELOPMENT' where id=$1",[f.draft.id]);
    assert.equal((await f.store.read(id(1),f.draft.id)).canSubmit,false); // Even every receipt cannot promote a sample.
    for(const role of ['anon','authenticated','service_role','autoguardian_enrollment_api']){
      const p=await f.db.query(`select has_table_privilege($1,'private.enrollment_prerequisite_receipts','INSERT,UPDATE,DELETE,TRUNCATE') writes,
        has_table_privilege($1,'private.enrollment_submissions','SELECT,INSERT,UPDATE,DELETE') direct`,[role]);
      assert.deepEqual(p.rows[0],{writes:false,direct:false});
    }
    assert.equal((await f.db.query("select has_table_privilege('autoguardian_enrollment_executor','private.enrollment_prerequisite_receipts','INSERT,UPDATE,DELETE,TRUNCATE') writes")).rows[0].writes,false);
  }finally{await f.db.close();}
});
test('trusted submission/finalization creates exactly one vehicle and ownership visible only to its owner',async()=>{
  const f=await foundation();try{
    await f.ready();assert.equal((await f.store.read(id(1),f.draft.id)).canSubmit,true);
    const submitted=await f.store.execute(id(1),f.draft.id,id(100),1,'submit',10);assert.equal(submitted.status,'SUBMITTED');
    assert.deepEqual(await f.store.execute(id(1),f.draft.id,id(100),1,'submit',10),submitted);
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(101),1,'submit',10),e=>e.getStatus()===409);
    await assert.rejects(()=>f.drafts.save(id(1),draftInput({organizationId:org,ownerProfileId:profile,expectedRevision:1,
      vehicle:{...f.draft.vehicle,color:'Blue'}},true),f.draft.id),e=>e.getStatus()===409);
    const active=await f.store.execute(id(1),f.draft.id,id(102),1,'finalize',10);assert.equal(active.status,'ACTIVE');assert.ok(active.vehicleId);
    assert.equal((await f.store.execute(id(1),f.draft.id,id(102),1,'finalize',10)).vehicleId,active.vehicleId);
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(103),1,'finalize',10),e=>e.getStatus()===409);
    const owned=await f.vehicles.list(id(1),{limit:20});assert.equal(owned.items.length,1);assert.equal(owned.items[0].id,active.vehicleId);
    assert.equal((await f.vehicles.detail(id(1),active.vehicleId)).vehicle.recordStatus,'ACTIVE');
    assert.equal((await f.vehicles.list(id(2),{limit:20})).items.length,0);
    await assert.rejects(()=>f.vehicles.detail(id(2),active.vehicleId),e=>e.getStatus()===404);
    for(const table of ['app.vehicles','app.ownerships'])assert.equal((await f.db.query('select count(*)::int n from '+table)).rows[0].n,1);
    assert.equal((await f.db.query('select count(*)::int n from private.enrollment_finalization_events')).rows[0].n,2);
  }finally{await f.db.close();}
});
test('new evidence invalidates receipts; rejected/expired/revoked prerequisites block finalization',async()=>{
  const f=await foundation();try{
    await f.ready();
    await f.db.query("insert into private.owners(id,tenant_id,user_id,kind,legal_name) values($1,$2,$3,'LEGAL_ENTITY','Synthetic entity')",[id(91),tenant,profile]);
    assert.equal((await f.store.read(id(1),f.draft.id)).ownerReady,false);
    await f.db.query('delete from private.owners where id=$1',[id(91)]);
    await f.receipt('PAYMENT',false);assert.equal((await f.store.read(id(1),f.draft.id)).checks.find(c=>c.code==='PAYMENT').status,'REJECTED');
    await f.receipt('PAYMENT');
    await f.context();await f.db.query(`insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,
      owner_profile_id,kind,mime_type,byte_size,sha256,object_path,status) values($1,$2,$3,$4,$5,$4,'OWNER_ID','application/pdf',10,$6,'synthetic','STAGED')`,
      [id(300),tenant,f.draft.id,profile,org,'a'.repeat(64)]);
    let state=await f.store.read(id(1),f.draft.id);assert.equal(state.snapshotRevision,11);assert.ok(state.checks.every(c=>c.status==='STALE'));
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(100),1,'submit',10),e=>e.getStatus()===409);
    for(const code of codes)await f.receipt(code);
    await f.store.execute(id(1),f.draft.id,id(100),1,'submit',11);
    // Receipt appends serialize with submission and can revoke approval without
    // permitting edits to the submitted documents.
    await f.receipt('REVIEW_POLICY',false);
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(102),1,'finalize',11),e=>e.getStatus()===409);
    await f.receipt('REVIEW_POLICY');
    await f.context();await f.db.query("update private.enrollment_prerequisite_receipts set issued_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where draft_id=$1 and code='PAYMENT'",[f.draft.id]);
    state=await f.store.read(id(1),f.draft.id);assert.equal(state.checks.find(c=>c.code==='PAYMENT').status,'EXPIRED');
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(102),1,'finalize',11),e=>e.getStatus()===409);
    await f.receipt('PAYMENT');await f.db.query("update app.users set status='SUSPENDED' where id=$1",[profile]);
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(102),1,'finalize',11),e=>e.getStatus()===403);
    for(const table of ['app.vehicles','app.ownerships'])assert.equal((await f.db.query('select count(*)::int n from '+table)).rows[0].n,0);
  }finally{await f.db.close();}
});
test('duplicate chassis/plate and a mid-activation failure roll back all domain writes and activation events',async()=>{
  const f=await foundation();try{
    await f.ready();await f.store.execute(id(1),f.draft.id,id(100),1,'submit',10);
    await f.db.exec("create function private.synthetic_fail_ownership() returns trigger language plpgsql as $$begin raise exception 'Synthetic interrupted activation';end;$$;create trigger synthetic_fail before insert on app.ownerships for each row execute function private.synthetic_fail_ownership();");
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(102),1,'finalize',10));
    assert.equal((await f.store.read(id(1),f.draft.id)).status,'SUBMITTED');
    assert.equal((await f.db.query('select count(*)::int n from app.vehicles')).rows[0].n,0);
    assert.equal((await f.db.query("select count(*)::int n from private.enrollment_finalization_events where action='ACTIVATED'")).rows[0].n,0);
    await f.db.exec('drop trigger synthetic_fail on app.ownerships;drop function private.synthetic_fail_ownership();');
    await f.db.query("insert into app.vehicles(tenant_id,chassis_identifier,current_plate,category) values($1,'OTHER-CHASSIS',' final-001 ','CAR')",[tenant]);
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(102),1,'finalize',10),e=>e.getStatus()===409);
    await f.db.query("update app.vehicles set current_plate='OTHER-PLATE',chassis_identifier='final-001' where tenant_id=$1",[tenant]);
    await assert.rejects(()=>f.store.execute(id(1),f.draft.id,id(102),1,'finalize',10),e=>e.getStatus()===409);
    await f.db.exec('delete from app.vehicles');
    assert.equal((await f.store.execute(id(1),f.draft.id,id(102),1,'finalize',10)).status,'ACTIVE');
  }finally{await f.db.close();}
});
test('submission HTTP authenticates, rejects client confirmation fields and returns blocked state without writes',async()=>{
  const f=await foundation();const auth={verify:async h=>{if(h!=='Bearer synthetic')throw new UnauthorizedException();return id(1);}};
  const app=await createApp(auth,{load:async()=>({})},undefined,f.vehicles,{auth,store:f.drafts,submission:f.store});
  await app.listen(0,'127.0.0.1');const url=await app.getUrl(),route='/v1/enrollment-drafts/'+f.draft.id+'/submission';
  try{
    assert.equal((await fetch(url+route)).status,401);
    const headers={Authorization:'Bearer synthetic','Content-Type':'application/json','Idempotency-Key':id(100)};
    assert.equal((await fetch(url+route+'?approve=true',{headers})).status,400);
    const response=await fetch(url+route,{method:'POST',headers,body:JSON.stringify({expectedDraftRevision:1,expectedSnapshotRevision:1})});
    assert.equal(response.status,409);assert.equal((await response.json()).code,'ENROLLMENT_PREREQUISITES_REQUIRED');
    assert.equal((await fetch(url+route,{method:'POST',headers,body:JSON.stringify({expectedDraftRevision:1,expectedSnapshotRevision:1,paymentConfirmed:true})})).status,400);
    assert.equal((await fetch(url+route+'/finalize',{method:'POST',headers,body:JSON.stringify({expectedDraftRevision:1,expectedSnapshotRevision:1})})).status,409);
    await f.ready();
    const body=JSON.stringify({expectedDraftRevision:1,expectedSnapshotRevision:10});
    assert.equal((await fetch(url+route,{method:'POST',headers,body})).status,200);
    const activated=await fetch(url+route+'/finalize',{method:'POST',headers:{...headers,'Idempotency-Key':id(102)},body});
    assert.equal(activated.status,200);const active=await activated.json();
    const owned=await fetch(url+'/v1/me/vehicles',{headers});assert.equal(owned.status,200);
    const list=await owned.json();assert.equal(list.items[0].id,active.vehicleId);
  }finally{await app.close();await f.db.close();}
});
