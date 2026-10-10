const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {PostgresConsentStore,consentInput}=require('../dist/consent');
const {PostgresEnrollmentStore,draftInput}=require('../dist/enrollments');
const {identityRequest,rememberVerifiedSession}=require('../dist/requestIdentity');
const {PostgresSubmissionStore}=require('../dist/submission');
const {PostgresRegistrationReviewStore}=require('../dist/registrationReviews');
const {SessionCheckedAuthentication}=require('../dist/staffAuthentication');
const {PostgresSealStore,sealFittingInput}=require('../dist/seals');
const {ProductionSealService,PostgresProductionSealStore}=require('../dist/productionSeals');
const {createApp}=require('../dist/app');
const {UnauthorizedException,ForbiddenException}=require('@nestjs/common');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function approveNoSeals(f,save=false){
 await f.db.exec(`insert into auth.mfa_factors values('${id(53)}','${id(3)}','totp','verified');
  insert into auth.sessions values('${id(63)}','${id(3)}','aal2','${id(53)}',now()+interval '1 hour');
  insert into auth.mfa_amr_claims values('${id(63)}','password',now()),('${id(63)}','totp',now());`);
 if(save)await f.as(1,()=>new PostgresSealStore(f.pool,id(10)).save(id(1),f.draft.id,id(450),sealFittingInput({package:'NONE',placements:[],expectedDraftRevision:1,expectedFittingRevision:0})));
 const service=new ProductionSealService(new PostgresProductionSealStore(f.pool,id(10))),state=await f.as(3,()=>service.read(id(3),f.draft.id),true);
 await f.as(3,()=>service.inspect(id(3),f.draft.id,id(451),{expectedDraftRevision:state.draftRevision,expectedSnapshotRevision:state.snapshotRevision,expectedInspectionRevision:0,action:'APPROVE',placements:[]}),true);
}
async function fixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role autoguardian_identity_login nologin;
 create schema auth;create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid,aal text,factor_id uuid,not_after timestamptz);
 create table auth.mfa_factors(id uuid primary key,user_id uuid,factor_type text,status text);
 create table auth.mfa_amr_claims(session_id uuid,authentication_method text,updated_at timestamptz);
 alter table auth.sessions enable row level security;alter table auth.mfa_factors enable row level security;alter table auth.mfa_amr_claims enable row level security;`);
 for(const file of (await fs.readdir(path.resolve(__dirname,'../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())
  await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'));
 await db.exec(`insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values('${id(10)}','PRODUCTION_TEST','Synthetic authority','CD','USD','Africa/Kinshasa');
 insert into app.users(id,tenant_id,auth_user_id) values('${id(21)}','${id(10)}','${id(1)}'),('${id(22)}','${id(10)}','${id(2)}'),('${id(23)}','${id(10)}','${id(3)}');
 insert into app.organizations(id,tenant_id,type,name) values('${id(30)}','${id(10)}','ASSOCIATION','Synthetic agent network');
 insert into app.role_assignments(tenant_id,user_id,role_code,organization_id) values('${id(10)}','${id(21)}','ENROLLMENT_AGENT','${id(30)}'),('${id(10)}','${id(22)}','OWNER',null),('${id(10)}','${id(23)}','TENANT_ADMIN',null);
 insert into app.agent_accreditations(tenant_id,organization_id,user_id) values('${id(10)}','${id(30)}','${id(21)}');
 insert into private.owners(id,tenant_id,user_id,kind,legal_name) values('${id(40)}','${id(10)}','${id(22)}','PERSON','Synthetic owner');
 insert into auth.mfa_factors values('${id(51)}','${id(1)}','totp','verified');
 insert into auth.sessions values('${id(61)}','${id(1)}','aal2','${id(51)}',now()+interval '2 hours'),('${id(62)}','${id(2)}','aal1',null,now()+interval '2 hours');
 insert into auth.mfa_amr_claims values('${id(61)}','password',now()-interval '1 minute'),('${id(61)}','totp',now()-interval '10 seconds');
 insert into private.production_enrollment_owners values('${id(10)}','${id(30)}','${id(22)}','Owner reference 22',true);
 insert into private.registration_access_configuration(tenant_id,production_enabled) values('${id(10)}',true);`);
 const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},release(){}})};
 const drafts=new PostgresEnrollmentStore(pool,id(10),true),consents=new PostgresConsentStore(pool,id(10));
 function as(n,call,staff=n===1){return new Promise((resolve,reject)=>identityRequest(()=>{
  rememberVerifiedSession({authUserId:id(n),sessionId:id(60+n),expiresAt:Date.now()/1000+300,staff});Promise.resolve().then(call).then(resolve,reject);
 }));}
 const input=draftInput({organizationId:id(30),ownerProfileId:id(22),vehicle:{chassisIdentifier:'PRODUCTION-SYNTHETIC',category:'CAR'}});
 const draft=(await as(1,()=>drafts.save(id(1),input,undefined,id(90)))).draft;
 async function publish(){await db.exec(`insert into private.registration_consent_documents(id,tenant_id,version,operator_name,authority_name,privacy_contact,retention_notice,text_en,text_fr,text_hash_en,text_hash_fr,approved_by,approved_at)
 values('${id(70)}','${id(10)}','synthetic-v1','Synthetic operator','Synthetic authority','privacy@synthetic.invalid',repeat('Synthetic retention notice. ',3),
 repeat('Synthetic English agreement for automated testing only. ',4),repeat('Texte français synthétique pour les tests automatisés. ',4),
 encode(sha256(convert_to(repeat('Synthetic English agreement for automated testing only. ',4),'UTF8')),'hex'),
 encode(sha256(convert_to(repeat('Texte français synthétique pour les tests automatisés. ',4),'UTF8')),'hex'),'Synthetic approver',now());
 update private.registration_access_configuration set consent_document_id='${id(70)}' where tenant_id='${id(10)}';`);}
 async function read(){return as(2,()=>consents.read(id(2),draft.id));}
 async function change(state,action,key){return as(2,()=>consents.change(id(2),draft.id,id(key),consentInput({action,
 documentId:action==='WITHDRAW'?state.lastDocumentId:state.document.id,language:action==='WITHDRAW'?state.lastLanguage:'en',
 expectedDraftRevision:state.draftRevision,expectedOwnerGeneration:state.ownerGeneration,expectedConsentRevision:state.consentRevision})));}
 async function refresh(){await db.exec(`begin;set local role autoguardian_enrollment_api;
 select set_config('autoguardian.tenant_id','${id(10)}',true),set_config('autoguardian.auth_user_id','${id(1)}',true),
 set_config('autoguardian.session_id','${id(61)}',true),set_config('autoguardian.staff_until',extract(epoch from now()+interval '5 minutes')::text,true);
 select private.refresh_registration_access('${draft.id}');commit;`);}
 async function context(n=1){await db.query(`select set_config('autoguardian.tenant_id',$1,false),set_config('autoguardian.auth_user_id',$2,false),
   set_config('autoguardian.session_id',$3,false),set_config('autoguardian.staff_until',$4,false)`,[id(10),id(n),id(60+n),n===1?String(Date.now()/1000+300):'']);}
 return {db,pool,drafts,consents,draft,input,as,publish,read,change,refresh,context};
}
test('production access requires live password/TOTP session and current accreditation; revoked sessions and factors fail closed',async()=>{
 const f=await fixture();try{
  assert.equal((await f.db.query('select enrollment_mode from app.enrollment_drafts')).rows[0].enrollment_mode,'PRODUCTION');
  await f.db.exec(`insert into auth.sessions values('${id(63)}','${id(3)}','aal1',null,now()+interval '1 hour')`);
  const reviews=new PostgresRegistrationReviewStore(f.pool,id(10));
  await assert.rejects(()=>f.as(3,()=>reviews.queue(id(3),20,0)),e=>e.getStatus()===403);
  await f.db.exec(`insert into auth.mfa_factors values('${id(53)}','${id(3)}','totp','verified');
    update auth.sessions set aal='aal2',factor_id='${id(53)}' where id='${id(63)}';
    insert into auth.mfa_amr_claims values('${id(63)}','password',now()-interval '1 minute'),('${id(63)}','totp',now()-interval '10 seconds')`);
  assert.equal((await f.as(3,()=>reviews.queue(id(3),20,0),true)).items.length,1);
  await assert.rejects(()=>f.as(2,()=>f.drafts.list(id(2),{limit:20})),e=>e.getStatus()===403);
  await f.db.exec(`update auth.mfa_factors set status='unverified' where id='${id(51)}'`);
  await assert.rejects(()=>f.as(1,()=>f.drafts.list(id(1),{limit:20})),e=>e.getStatus()===403);
  await f.db.exec(`update auth.mfa_factors set status='verified';update auth.mfa_amr_claims set updated_at=now()-interval '2 hours' where authentication_method='password'`);
  await assert.rejects(()=>f.as(1,()=>f.drafts.list(id(1),{limit:20})),e=>e.getStatus()===403);
  await f.db.exec(`update auth.mfa_amr_claims set updated_at=now()-interval '1 minute';delete from auth.sessions where id='${id(61)}'`);
  await assert.rejects(()=>f.as(1,()=>f.drafts.list(id(1),{limit:20})),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
test('consent publisher is scoped and cannot enable production, grant runtime membership or alter historical wording',async()=>{
 const f=await fixture();try{
  const source=await fs.readFile(path.resolve(__dirname,'../../supabase/publish-registration-consent.sql'),'utf8');
  await assert.rejects(()=>f.db.exec(source),e=>e.message.includes('Fill every field'));await f.db.exec('rollback');
  const values={REPLACE_WITH_TENANT_UUID:id(10),REPLACE_WITH_NEW_VERSION:'published-synthetic-v2',REPLACE_WITH_OPERATING_ORGANIZATION:'Synthetic operator',
   REPLACE_WITH_REGISTRATION_AUTHORITY:'Synthetic authority',REPLACE_WITH_PRIVACY_CONTACT:'privacy@synthetic.invalid',REPLACE_WITH_APPROVED_RETENTION_NOTICE:'Synthetic approved retention notice for automated testing only.',
   REPLACE_WITH_APPROVER_NAME_OR_REFERENCE:'Synthetic approval',REPLACE_WITH_APPROVED_ENGLISH_AGREEMENT:'Synthetic English agreement for automated testing only. '.repeat(4),
   REPLACE_WITH_APPROVED_FRENCH_AGREEMENT:'Accord français synthétique pour les tests automatisés uniquement. '.repeat(4)};
  let publication=source.replace('wording_approved boolean:=false','wording_approved boolean:=true');
  for(const [marker,value]of Object.entries(values))publication=publication.replace(marker,value);
  await f.db.exec(publication);
  assert.equal((await f.db.query('select version from private.registration_consent_documents')).rows[0].version,'published-synthetic-v2');
  assert.equal((await f.db.query("select has_column_privilege('autoguardian_consent_publisher','private.registration_access_configuration','production_enabled','UPDATE') as allowed")).rows[0].allowed,false);
  await f.db.exec('alter table auth.mfa_factors add column secret text');
  const verification=await f.db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-access-consent.sql'),'utf8'));
  assert.ok(Object.values(verification[0].rows[0]).every(Boolean));
 }finally{await f.db.close();}
});
test('HTTP uses separate staff and owner authentication and does not let an agent impersonate owner acceptance',async()=>{
 const f=await fixture();let app;try{
  const proof=staff=>({verifyContext:async header=>{
    if(!header)throw new UnauthorizedException();const owner=header==='Bearer owner';
    if(staff&&owner)throw new ForbiddenException();
    return {authUserId:id(owner?2:1),sessionId:id(owner?62:61),expiresAt:Date.now()/1000+300};
  }});
  const account=new SessionCheckedAuthentication(proof(false),f.pool,id(10),false),staff=new SessionCheckedAuthentication(proof(true),f.pool,id(10),true);
  app=await createApp(account,{load:async()=>({})},undefined,undefined,{auth:staff,store:f.drafts},{accountAuth:account,staffAuth:staff,consents:f.consents});
  await app.listen(0,'127.0.0.1');const url=await app.getUrl();
  assert.equal((await fetch(url+'/v1/enrollment-drafts',{headers:{Authorization:'Bearer owner'}})).status,403);
  assert.equal((await fetch(url+'/v1/me/registration-consents/'+f.draft.id)).status,401);
  assert.equal((await fetch(url+'/v1/me/registration-consents/'+f.draft.id,{headers:{Authorization:'Bearer staff'}})).status,403);
  const response=await fetch(url+'/v1/me/registration-consents/'+f.draft.id,{headers:{Authorization:'Bearer owner'}});
  assert.equal(response.status,200);assert.equal((await response.json()).phoneVerified,false);assert.equal(response.headers.get('cache-control'),'no-store');
  const status=await fetch(url+'/v1/me/staff-access',{headers:{Authorization:'Bearer staff'}});assert.equal(status.status,200);assert.equal((await status.json()).verified,true);
  assert.equal((await fetch(url+'/v1/me/registration-consents/'+f.draft.id,{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json','Idempotency-Key':id(300)},body:JSON.stringify({accepted:true,actorId:id(21)})})).status,400);
 }finally{if(app)await app.close();await f.db.close();}
});
test('the full finalizer rechecks current consent and authentication even with once-valid receipts',async()=>{
 const f=await fixture();try{
  await f.publish();await f.context();
  for(const [n,kind] of ['OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO'].entries())
    await f.db.query(`insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,
      kind,mime_type,byte_size,sha256,object_path,status) values($1,$2,$3,$4,$5,$6,$7,'image/jpeg',10,$8,$9,'STAGED')`,
      [id(200+n),id(10),f.draft.id,id(21),id(30),id(22),kind,String(n).padStart(64,'a'),'synthetic-'+n]);
  await f.db.query(`insert into private.draft_seal_packages(draft_id,tenant_id,organization_id,agent_user_id,owner_profile_id,saved_draft_revision,revision,package)
    values($1,$2,$3,$4,$5,1,1,'NONE')`,[f.draft.id,id(10),id(30),id(21),id(22)]);
  for(const code of ['OWNER_PHONE','PRODUCTION_EVIDENCE','SEALS','PAYMENT','REVIEW_POLICY'])await f.db.query(`insert into private.enrollment_prerequisite_receipts
    (tenant_id,draft_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,code,accepted,trusted_reference,expires_at)
    select tenant_id,id,revision,owner_generation,1,enrollment_snapshot_revision,$2,true,'ISOLATED_PROVIDER_FIXTURE',now()+interval '1 hour' from app.enrollment_drafts where id=$1`,[f.draft.id,code]);
  await approveNoSeals(f);
  let state=await f.read();state=await f.change(state,'ACCEPT',100);
  const store=new PostgresSubmissionStore(f.pool,id(10));let status=await f.as(1,()=>store.read(id(1),f.draft.id));
  assert.equal(status.canSubmit,true);assert.ok(status.checks.every(c=>c.status==='COMPLETE'));
  await f.as(1,()=>store.execute(id(1),f.draft.id,id(170),status.draftRevision,'submit',status.snapshotRevision));
  // Retiring a document blocks finalization even before a new rejected receipt.
  await f.db.exec(`update private.registration_access_configuration set consent_document_id=null where tenant_id='${id(10)}'`);
  assert.equal((await f.as(1,()=>store.read(id(1),f.draft.id))).canFinalize,false);
  await f.db.exec(`update private.registration_access_configuration set consent_document_id='${id(70)}' where tenant_id='${id(10)}'`);
  status=await f.as(1,()=>store.read(id(1),f.draft.id));assert.equal(status.canFinalize,true);
  await f.as(1,()=>store.execute(id(1),f.draft.id,id(171),status.draftRevision,'finalize',status.snapshotRevision));
  assert.equal((await f.db.query('select count(*)::integer n from app.vehicles')).rows[0].n,1);
  await assert.rejects(()=>f.change(state,'WITHDRAW',101),e=>e.getStatus()===409);
 }finally{await f.db.close();}
});
test('only the independently authenticated owner accepts immutable versioned consent; absent configuration, stale edits and forged fields are rejected',async()=>{
 const f=await fixture();try{
  assert.equal((await f.read()).document,null);await f.publish();let state=await f.read();
  assert.equal(state.phoneVerified,false);assert.equal(state.status,'MISSING');
  await assert.rejects(()=>f.as(1,()=>f.consents.read(id(1),f.draft.id)),e=>e.getStatus()===403);
  state=await f.change(state,'ACCEPT',100);assert.equal(state.status,'ACCEPTED');assert.equal(state.consentRevision,1);
  await f.refresh();assert.ok((await f.db.query("select code,accepted from private.enrollment_prerequisite_receipts where code in ('CONSENT','AGENT_AUTHENTICATION')")).rows.every(r=>r.accepted));
  await f.as(1,()=>f.drafts.save(id(1),{...f.input,vehicle:{...f.input.vehicle,color:'BLUE'},expectedRevision:1},f.draft.id));
  assert.equal((await f.read()).status,'STALE');await assert.rejects(()=>f.change(state,'ACCEPT',101),e=>e.getStatus()===409);
  await f.refresh();assert.equal((await f.db.query("select accepted from private.enrollment_prerequisite_receipts where code='CONSENT' order by sequence desc limit 1")).rows[0].accepted,false);
  await assert.rejects(()=>f.db.exec("update private.registration_consent_documents set text_en='tampered'"),e=>e.code==='AG403');
  for(const role of ['anon','authenticated','service_role','autoguardian_enrollment_api'])assert.equal((await f.db.query("select has_table_privilege($1,'private.registration_consent_events','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
  assert.throws(()=>consentInput({accepted:true,ownerProfileId:id(22)}));
 }finally{await f.db.close();}
});
test('withdrawal remains possible after submission and invalidates the gate; delayed retries never restore consent and activation closes withdrawal',async()=>{
 const f=await fixture();try{
  await f.publish();await approveNoSeals(f,true);const before=await f.read();let state=await f.change(before,'ACCEPT',100);await f.refresh();
  await f.db.exec(`insert into private.enrollment_submissions(draft_id,tenant_id,organization_id,agent_user_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,submit_key,status)
    select id,tenant_id,organization_id,created_by,revision,owner_generation,0,enrollment_snapshot_revision,'${id(150)}','SUBMITTED' from app.enrollment_drafts where id='${f.draft.id}'`);
  state=await f.change(state,'WITHDRAW',101);assert.equal(state.status,'WITHDRAWN');
  assert.equal((await f.change(before,'ACCEPT',100)).status,'WITHDRAWN');
  assert.equal((await f.db.query("select accepted from private.enrollment_prerequisite_receipts where code='CONSENT' order by sequence desc limit 1")).rows[0].accepted,false);
  await assert.rejects(()=>f.change(state,'ACCEPT',102),e=>e.getStatus()===409);
  await f.context();
  await f.db.exec(`insert into app.vehicles(id,tenant_id,chassis_identifier,category) values('${id(160)}','${id(10)}','ACTIVE-SYNTHETIC','CAR');
    update private.enrollment_submissions set status='ACTIVE',vehicle_id='${id(160)}',finalize_key='${id(151)}',activated_at=now() where draft_id='${f.draft.id}'`);
  await assert.rejects(()=>f.change(state,'WITHDRAW',103),e=>e.getStatus()===409);
 }finally{await f.db.close();}
});
