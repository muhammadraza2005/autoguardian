const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {PostgresRegistrationReviewStore,RegistrationReviewService,registrationReviewInput}=require('../dist/registrationReviews');
const {PostgresEnrollmentStore,draftInput}=require('../dist/enrollments');
const {PostgresSubmissionStore}=require('../dist/submission');const {createApp}=require('../dist/app');
const {UnauthorizedException}=require('@nestjs/common');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431',agent='369cbe75-32c8-40b4-a9ee-f2d9bde379db',org='014db61a-4c68-48cb-86b6-46837f4da873';
async function foundation(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create role autoguardian_identity_login nologin;create schema auth;create table auth.users(id uuid primary key);`);
 for(const file of (await fs.readdir(path.resolve(__dirname,'../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())
  await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'));
 await db.exec(`insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values('${tenant}','AUTOGUARDIAN_DEV','Development','CD','USD','Africa/Kinshasa');
 insert into app.users(id,tenant_id,auth_user_id) values('${agent}','${tenant}','${id(1)}'),('${id(22)}','${tenant}','${id(2)}'),('${id(23)}','${tenant}','${id(3)}');
 insert into app.role_assignments(tenant_id,user_id,role_code) values('${tenant}','${id(22)}','TENANT_ADMIN'),('${tenant}','${id(23)}','TENANT_ADMIN'),('${tenant}','${agent}','TENANT_ADMIN');`);
 for(const file of ['setup-development-agent.sql','setup-development-owner.sql'])await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase',file),'utf8'));
 const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},release(){}})};
 const drafts=new PostgresEnrollmentStore(pool,tenant),store=new PostgresRegistrationReviewStore(pool,tenant);
 const draft=(await drafts.save(id(1),draftInput({organizationId:org,ownerProfileId:agent,vehicle:{chassisIdentifier:'REVIEW-001',category:'CAR'}}),undefined,id(80))).draft;
 async function context(actor=id(1)){await db.query("select set_config('autoguardian.tenant_id',$1,false),set_config('autoguardian.auth_user_id',$2,false)",[tenant,actor]);}
 async function attachment(n,kind,status='STAGED'){await context();await db.query(`insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,
 kind,mime_type,byte_size,sha256,object_path,status) values($1,$2,$3,$4,$5,$4,$6,'image/jpeg',10,$7,$8,$9)`,[id(n),tenant,draft.id,agent,org,kind,String(n).padStart(64,'a'),'synthetic-'+n,status]);}
 let key=500;
 async function change(action,attachmentId=null,reason=null,replacementId=null,actor=id(2),state){
  state??=await store.read(actor,draft.id);const input={expectedDraftRevision:state.draftRevision,expectedSnapshotRevision:state.snapshotRevision,
   expectedReviewRevision:state.reviewRevision,action,attachmentId,reason,replacementId,inspected:action!=='READ_REQUESTED'};
  return store.change(actor,draft.id,id(key++),input);
 }
 async function accepted(n){await change('READ_REQUESTED',id(n));return change('ACCEPTED',id(n));}
 async function ready(){await context();await db.query(`insert into private.draft_seal_packages(draft_id,tenant_id,organization_id,agent_user_id,owner_profile_id,saved_draft_revision,revision,package)
 values($1,$2,$3,$4,$4,1,1,'NONE')`,[draft.id,tenant,org,agent]);
 for(const [n,kind]of ['OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO'].entries())await attachment(200+n,kind);
  for(let n=200;n<208;n++)await accepted(n);
 }
 async function seals(){await context();await db.query(`insert into private.enrollment_prerequisite_receipts(tenant_id,draft_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,code,accepted,trusted_reference,expires_at)
 select tenant_id,id,revision,owner_generation,1,enrollment_snapshot_revision,'SEALS',true,'SYNTHETIC_INSPECTION',now()+interval '1 hour' from app.enrollment_drafts where id=$1`,[draft.id]);}
 return {db,pool,store,drafts,draft,context,attachment,change,accepted,ready,seals};
}
test('independent review denies self-review, unauthorized and cross-tenant actors; tables/history are private and append-only',async()=>{
 const f=await foundation();try{
  await assert.rejects(()=>f.store.read(id(1),f.draft.id),e=>e.getStatus()===404);
  await assert.rejects(()=>f.store.queue(id(99),20,0),e=>e.getStatus()===403);
  await assert.rejects(()=>new PostgresRegistrationReviewStore(f.pool,id(90)).queue(id(2),20,0),e=>e.getStatus()===403);
 }finally{await f.db.close();}
 const g=await foundation();try{
  assert.equal((await g.store.queue(id(2),20,0)).items.length,1);
  for(const role of ['anon','authenticated','service_role','autoguardian_enrollment_api']){
   assert.equal((await g.db.query("select has_table_privilege($1,'private.registration_review_events','SELECT,INSERT,UPDATE,DELETE') rights",[role])).rows[0].rights,false);
  }
  assert.equal((await g.db.query("select has_table_privilege('autoguardian_review_executor','private.registration_review_events','UPDATE,DELETE,TRUNCATE') rights")).rows[0].rights,false);
  await g.db.exec(`update app.role_assignments set valid_to=now()+interval '1 second',valid_from=now()-interval '2 seconds' where user_id='${id(22)}'; update app.users set status='SUSPENDED' where id='${id(22)}'`);
  await assert.rejects(()=>g.store.read(id(2),g.draft.id),e=>e.getStatus()===403);
 }finally{await g.db.close();}
});
test('inspection, exact replay, correction and explicit same-kind replacement are snapshot bound',async()=>{
 const f=await foundation();try{
  await f.attachment(200,'OWNER_ID');await assert.rejects(()=>f.change('ACCEPTED',id(200)),e=>e.getStatus()===409);
  await f.change('READ_REQUESTED',id(200));const s=await f.store.read(id(2),f.draft.id);
  const input={expectedDraftRevision:s.draftRevision,expectedSnapshotRevision:s.snapshotRevision,expectedReviewRevision:s.reviewRevision,
   action:'NEEDS_CORRECTION',attachmentId:id(200),reason:'BLURRY',replacementId:null,inspected:true};
  const first=await f.store.change(id(2),f.draft.id,id(700),input);assert.equal(first.items[0].decision,'NEEDS_CORRECTION');
  assert.equal((await f.store.feedback(id(1),f.draft.id)).items[0].reason,'BLURRY');
  await assert.rejects(()=>f.store.feedback(id(2),f.draft.id),e=>e.getStatus()===403);
  assert.deepEqual(await f.store.change(id(2),f.draft.id,id(700),input),first);
  await assert.rejects(()=>f.store.change(id(2),f.draft.id,id(700),{...input,reason:'INCOMPLETE'}),e=>e.getStatus()===409);
  await f.attachment(201,'OWNER_ID');await assert.rejects(()=>f.store.change(id(2),f.draft.id,id(701),input),e=>e.getStatus()===409);
  assert.ok((await f.store.read(id(2),f.draft.id)).items.every(i=>i.decision==='NOT_REVIEWED'));
  await f.accepted(201);await f.change('SUPERSEDED',id(200),null,id(201));
  await assert.rejects(()=>f.change('SUPERSEDED',id(201),null,id(200)),e=>e.getStatus()===409);
  const current=await f.store.read(id(2),f.draft.id);assert.equal(current.items.find(i=>i.id===id(200)).decision,'SUPERSEDED');
  await assert.rejects(()=>f.change('ACCEPTED',id(201),null,null,id(3),first),e=>e.getStatus()===409);
 }finally{await f.db.close();}
});
test('approval requires all evidence and trusted seals; only production receives the two review receipts, later correction revokes them',async()=>{
 const f=await foundation();try{
  await f.ready();let s=await f.store.read(id(2),f.draft.id);assert.equal(s.evidenceComplete,true);assert.equal(s.canApprove,false);
  await assert.rejects(()=>f.change('APPROVED'),e=>e.getStatus()===409);
  await f.seals();s=await f.change('APPROVED');assert.equal(s.productionApproved,false);
  assert.equal((await f.db.query("select count(*)::integer n from private.enrollment_prerequisite_receipts where code in ('PRODUCTION_EVIDENCE','REVIEW_POLICY')")).rows[0].n,0);
  await f.context();await f.db.query("update app.enrollment_drafts set enrollment_mode='PRODUCTION' where id=$1",[f.draft.id]);
  s=await f.change('APPROVED');assert.equal(s.productionApproved,true);
  const receipts=(await f.db.query("select code,accepted,trusted_reference,expires_at from private.enrollment_prerequisite_receipts where code in ('PRODUCTION_EVIDENCE','REVIEW_POLICY')")).rows;
  assert.equal(receipts.length,2);assert.ok(receipts.every(r=>r.accepted&&r.trusted_reference.startsWith('REVIEW:')));
  const submission=new PostgresSubmissionStore(f.pool,tenant);assert.ok((await submission.read(id(1),f.draft.id)).checks.filter(c=>['PRODUCTION_EVIDENCE','REVIEW_POLICY'].includes(c.code)).every(c=>c.status==='COMPLETE'));
  await f.change('NEEDS_CORRECTION',id(200),'DETAILS_MISMATCH');
  assert.equal((await f.store.read(id(2),f.draft.id)).productionApproved,false);
  assert.ok((await submission.read(id(1),f.draft.id)).checks.filter(c=>['PRODUCTION_EVIDENCE','REVIEW_POLICY'].includes(c.code)).every(c=>c.status==='REJECTED'));
  await f.context();await f.db.query(`insert into private.enrollment_submissions(draft_id,tenant_id,organization_id,agent_user_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,submit_key,status)
    select id,tenant_id,organization_id,created_by,revision,owner_generation,1,enrollment_snapshot_revision,$2,'SUBMITTED' from app.enrollment_drafts where id=$1`,[f.draft.id,id(901)]);
  assert.equal((await f.store.read(id(2),f.draft.id)).frozen,true);
  await assert.rejects(()=>f.change('ACCEPTED',id(200)),e=>e.getStatus()===409);
 }finally{await f.db.close();}
});
test('review HTTP requires authenticated administrator and inspected attestation; file access uses the scoped audited row',async()=>{
 const f=await foundation();let app;try{
  await f.attachment(200,'OWNER_ID');let readRow;
  const service=new RegistrationReviewService(f.store,{readReviewRecord:async row=>{readRow=row;return {id:row.id,mimeType:row.mime_type,dataBase64:'c3ludGhldGlj'};}});
  const auth={verify:async header=>{if(!header)throw new UnauthorizedException();return header==='Bearer reviewer'?id(2):id(1);}};
  app=await createApp(auth,{},undefined,undefined,{auth,store:f.drafts,registrationReviews:service});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  assert.equal((await fetch(base+'/v1/registration-reviews')).status,401);
  assert.equal((await fetch(base+'/v1/registration-reviews?scope=all',{headers:{authorization:'Bearer reviewer'}})).status,400);
  const s=await f.store.read(id(2),f.draft.id),body={expectedDraftRevision:s.draftRevision,expectedSnapshotRevision:s.snapshotRevision,expectedReviewRevision:s.reviewRevision,
   action:'READ_REQUESTED',attachmentId:id(200),reason:null,replacementId:null,inspected:false};
  const headers={authorization:'Bearer reviewer','content-type':'application/json','idempotency-key':id(900)};
  let response=await fetch(base+'/v1/registration-reviews/'+f.draft.id,{method:'POST',headers,body:JSON.stringify({...body,tenantId:tenant})});assert.equal(response.status,400);
  response=await fetch(base+'/v1/registration-reviews/'+f.draft.id,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);
  assert.equal((await response.json()).id,id(200));assert.equal(readRow.object_path,'synthetic-200');
  assert.throws(()=>registrationReviewInput({...body,action:'ACCEPTED'}),e=>e.getStatus()===400);
  assert.equal((await f.db.query("select count(*)::int n from private.registration_review_events where action='READ_REQUESTED'")).rows[0].n,1);
 }finally{if(app)await app.close();await f.db.close();}
});
