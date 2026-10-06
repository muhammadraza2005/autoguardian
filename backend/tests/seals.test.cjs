const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {UnauthorizedException}=require('@nestjs/common');const {createApp}=require('../dist/app');
const {PostgresSealStore,sealFittingInput}=require('../dist/seals');
const {PostgresEnrollmentStore,draftInput,DevelopmentDraftVerifier}=require('../dist/enrollments');
const {evidenceInput}=require('../dist/evidence');
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
  const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},release(){}})};
  const drafts=new PostgresEnrollmentStore(pool,tenant),seals=new PostgresSealStore(pool,tenant);
  const draftBody={organizationId:org,ownerProfileId:profile,vehicle:{chassisIdentifier:'SEAL-TEST',plate:'SEAL-001',category:'CAR'}};
  const draft=(await drafts.save(id(1),draftInput(draftBody),undefined,id(80))).draft;
  return {db,pool,drafts,seals,draft,draftBody};
}
const input=(package='STANDARD',placements=[],expectedFittingRevision=0,expectedDraftRevision=1)=>sealFittingInput({package,placements,expectedFittingRevision,expectedDraftRevision});
const placement=(position,code,photoId=null)=>({position,sealCode:code,photoId});
test('seal fitting validation rejects duplicated codes/photos, unknown fields, bad revisions and PDF fitting photos',async()=>{
  assert.equal(input('STANDARD',[placement(1,' dev-seal-std-001 ')]).placements[0].sealCode,'DEV-SEAL-STD-001');
  for(const value of [ {...input(),enrollmentActive:true}, {...input(),expectedFittingRevision:-1},
    {...input(),placements:[placement(1,'DEV-SEAL-STD-001'),placement(1,'DEV-SEAL-STD-002')]},
    {...input(),placements:[placement(1,'DEV-SEAL-STD-001',id(50)),placement(2,'DEV-SEAL-STD-002',id(50))]},
    {...input(),package:'NONE',placements:[placement(1,'DEV-SEAL-STD-001')]},
    {...input(),placements:[{position:1,sealCode:'DEV-SEAL-STD-001'}]}]) {
    assert.throws(()=>sealFittingInput(value),e=>e.getStatus()===400);
  }
  await assert.rejects(()=>evidenceInput({kind:'SEAL_FITTING_PHOTO',dataBase64:Buffer.from('%PDF-1.4\nSample\n%%EOF').toString('base64')}),e=>e.getStatus()===400);
});
test('stock, fitting reservations and photos persist atomically without activation; retries and conflicts preserve the draft',async()=>{
  const {db,drafts,seals,draft,draftBody}=await foundation();
  try{
    const stock=await seals.stock(id(1),org,{limit:7});assert.equal(stock.items.length,7);assert.ok(stock.nextCursor);assert.equal(stock.sampleOnly,true);
    const next=await seals.stock(id(1),org,{limit:50,cursor:stock.nextCursor});assert.equal(next.items.length,13);
    assert.equal((await seals.fitting(id(1),draft.id)).fittingRevision,0);
    const partial=input('STANDARD',[placement(1,'DEV-SEAL-STD-001')]);
    const saved=await seals.save(id(1),draft.id,id(90),partial);assert.equal(saved.fittingRevision,1);assert.equal(saved.sealDraftComplete,false);
    assert.deepEqual(await seals.save(id(1),draft.id,id(90),partial),saved);
    assert.equal((await db.query('select count(*)::int n from private.draft_seal_events')).rows[0].n,1);
    await assert.rejects(()=>seals.save(id(1),draft.id,id(90),input('NONE')),e=>e.getStatus()===409);
    await assert.rejects(()=>seals.save(id(1),draft.id,id(91),input('NONE')),e=>e.getStatus()===409);
    const second=(await drafts.save(id(1),draftInput({...draftBody,vehicle:{...draftBody.vehicle,chassisIdentifier:'SECOND-SEAL',plate:'SEAL-002'}}),undefined,id(81))).draft;
    await assert.rejects(()=>seals.save(id(1),second.id,id(92),partial),e=>e.getStatus()===409);
    assert.equal((await seals.fitting(id(1),second.id)).fittingRevision,0);
    await assert.rejects(()=>seals.save(id(1),draft.id,id(93),input('STANDARD',[placement(1,'DEV-SEAL-ALM-001')],1)),e=>e.getStatus()===400);
    const photos=[];
    for(let n=1;n<=4;n++){
      const photo=id(100+n);photos.push(photo);
      await db.exec(`insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,kind,mime_type,byte_size,sha256,object_path,status)
        values('${photo}','${tenant}','${draft.id}','${profile}','${org}','${profile}','SEAL_FITTING_PHOTO','image/jpeg',10,'${'a'.repeat(64)}','synthetic-${n}','STAGED');`);
    }
    await assert.rejects(()=>seals.save(id(1),second.id,id(94),input('STANDARD',[placement(1,'DEV-SEAL-STD-005',photos[0])])),e=>e.getStatus()===422);
    const complete=input('STANDARD',photos.map((photo,i)=>placement(i+1,'DEV-SEAL-STD-00'+(i+1),photo)),1);
    const final=await seals.save(id(1),draft.id,id(95),complete);assert.equal(final.sealDraftComplete,true);
    assert.equal(final.enrollmentActive,false);assert.equal(final.ownerVerified,false);assert.equal(final.paymentConfirmed,false);
    assert.equal((await seals.stock(id(1),org,{limit:50})).items.find(s=>s.code==='DEV-SEAL-STD-001').available,false);
    const oneAlarm=input('ONE_ALARM',photos.map((photo,i)=>placement(i+1,i===3?'DEV-SEAL-ALM-001':'DEV-SEAL-STD-00'+(i+1),photo)),2);
    assert.equal((await seals.save(id(1),draft.id,id(195),oneAlarm)).sealDraftComplete,true);
    const fourAlarms=input('FOUR_ALARMS',photos.map((photo,i)=>placement(i+1,'DEV-SEAL-ALM-00'+(i+1),photo)),3);
    assert.equal((await seals.save(id(1),draft.id,id(196),fourAlarms)).sealDraftComplete,true);
    await drafts.save(id(1),draftInput({...draftBody,expectedRevision:1},true),draft.id);
    assert.equal((await seals.fitting(id(1),draft.id)).current,false);assert.equal((await seals.fitting(id(1),draft.id)).sealDraftComplete,false);
    await assert.rejects(()=>seals.save(id(1),draft.id,id(96),input('NONE',[],4)),e=>e.getStatus()===409);
    const none=await seals.save(id(1),draft.id,id(97),input('NONE',[],4,2));assert.equal(none.sealDraftComplete,true);
    assert.equal(none.placements.length,0);assert.equal(none.enrollmentActive,false);
    assert.equal((await seals.stock(id(1),org,{limit:50})).items.find(s=>s.code==='DEV-SEAL-STD-001').available,true);
    await seals.save(id(1),second.id,id(98),partial);
    assert.equal((await db.query('select count(*)::int n from app.vehicles')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from private.owners')).rows[0].n,0);
    await db.exec(`update private.development_seal_stock set status='REVOKED' where code='DEV-SEAL-STD-006'`);
    await assert.rejects(()=>seals.save(id(1),draft.id,id(99),input('STANDARD',[placement(1,'DEV-SEAL-STD-006')],5,2)),e=>e.getStatus()===409);
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/setup-development-seal-stock.sql'),'utf8'));
    assert.equal((await db.query("select status from private.development_seal_stock where code='DEV-SEAL-STD-006'")).rows[0].status,'REVOKED');
  }finally{await db.close();}
});
test('seal APIs enforce identity, agent/organization/tenant scope and deny direct table access',async()=>{
  const {db,pool,drafts,seals,draft}=await foundation();let app;
  try{
    await assert.rejects(()=>seals.stock(id(2),org,{limit:20}),e=>e.getStatus()===403);
    await db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code,organization_id) values('${tenant}','${id(22)}','ENROLLMENT_AGENT','${org}');
      insert into app.agent_accreditations(tenant_id,user_id,organization_id) values('${tenant}','${id(22)}','${org}');`);
    assert.equal((await seals.stock(id(2),org,{limit:20})).items.length,0);
    await assert.rejects(()=>seals.fitting(id(2),draft.id),e=>e.getStatus()===404);
    await assert.rejects(()=>seals.save(id(2),draft.id,id(90),input('NONE')),e=>e.getStatus()===404);
    await assert.rejects(()=>seals.stock(id(1),id(900),{limit:20}),e=>e.getStatus()===403);
    await assert.rejects(()=>new PostgresSealStore(pool,id(900)).fitting(id(1),draft.id),e=>e.getStatus()===403);
    for(const role of ['anon','authenticated','service_role','autoguardian_enrollment_api'])for(const table of ['development_seal_stock','draft_seal_packages','draft_seal_placements','draft_seal_events']){
      await db.exec(`begin;set local role ${role}`);await assert.rejects(()=>db.exec('select * from private.'+table),e=>e.code==='42501');await db.exec('rollback');
    }
    const auth={verify:async header=>{if(header!=='Bearer agent')throw new UnauthorizedException();return id(1);}};
    app=await createApp(auth,{load:async()=>({})},undefined,undefined,{auth:new DevelopmentDraftVerifier(auth,true),store:drafts,seals});
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    const route=base+'/v1/enrollment-drafts/'+draft.id+'/seals';
    assert.equal((await fetch(route)).status,401);assert.equal((await fetch(base+'/v1/seal-stock?organizationId='+org)).status,401);
    const headers={Authorization:'Bearer agent','Content-Type':'application/json','Idempotency-Key':id(99)};
    assert.equal((await fetch(route+'?unexpected=1',{headers})).status,400);
    assert.equal((await fetch(route,{method:'POST',headers,body:JSON.stringify(input('NONE'))})).status,200);
    assert.equal((await fetch(base+'/v1/seal-stock?organizationId='+org,{headers})).status,200);
    await db.exec(`update app.agent_accreditations set status='SUSPENDED' where user_id='${profile}'`);
    assert.equal((await fetch(route,{headers})).status,403);
    assert.equal((await fetch(base+'/v1/seal-stock?organizationId='+org,{headers})).status,403);
  }finally{if(app)await app.close();await db.close();}
});
