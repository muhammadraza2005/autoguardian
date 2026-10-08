const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {UnauthorizedException}=require('@nestjs/common');const {createApp}=require('../dist/app');
const {OwnerService,PostgresOwnerStore,ownerCipher,ownerDetailsInput,ownerConsentInput,configuredOwner}=require('../dist/owner');
const {PostgresEnrollmentStore,draftInput,DevelopmentDraftVerifier}=require('../dist/enrollments');
const {PostgresReadinessStore}=require('../dist/readiness');const {PostgresEvidenceStore}=require('../dist/evidence');
const {PostgresSealStore}=require('../dist/seals');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431',profile='369cbe75-32c8-40b4-a9ee-f2d9bde379db',org='014db61a-4c68-48cb-86b6-46837f4da873';
const details={type:'INDIVIDUAL',name:'Fictional Owner',companyRegistration:null,representativeName:null,
  idDocumentType:'SAMPLE',idDocumentNumber:'SAMPLE-ID-1',phone:'+243000000000',preferredLanguage:'en'};
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
  const drafts=new PostgresEnrollmentStore(pool,tenant),store=new PostgresOwnerStore(pool,tenant),cipher=ownerCipher(Buffer.alloc(32,7));
  const owner=new OwnerService(store,cipher),readiness=new PostgresReadinessStore(pool,tenant),evidence=new PostgresEvidenceStore(pool,tenant),seals=new PostgresSealStore(pool,tenant);
  const body={organizationId:org,ownerProfileId:profile,vehicle:{chassisIdentifier:'OWNER-TEST',plate:'OWNER-001',category:'CAR'}};
  const draft=(await drafts.save(id(1),draftInput(body),undefined,id(80))).draft;
  return {db,pool,drafts,store,cipher,owner,readiness,evidence,seals,draft,body};
}
const state=(result,code)=>result.checks.find(check=>check.code===code).status;
const accept=row=>({expectedDraftRevision:row.draftRevision,ownerGeneration:row.ownerGeneration,
  version:row.documents.find(d=>d.language==='en').version,language:'en',accept:true,termsAccepted:true,dataAccepted:true});

test('owner validation and authenticated encryption reject mismatched identities, tampering and fake verification',()=>{
  assert.deepEqual(ownerDetailsInput(details),details);
  for(const patch of [{type:'PERSON'},{phone:'123'},{phoneVerified:true},{name:' '},{idDocumentNumber:'bad\nID'},
    {type:'COMPANY'},{preferredLanguage:'de'},{companyRegistration:'EXTRA'}])assert.throws(()=>ownerDetailsInput({...details,...patch}));
  assert.equal(ownerDetailsInput({...details,type:'COMPANY',companyRegistration:'SAMPLE-REG',representativeName:'Fictional Representative'}).type,'COMPANY');
  const input={expectedDraftRevision:2,ownerGeneration:2,version:'v1',language:'en',accept:true,termsAccepted:true,dataAccepted:true};
  for(const patch of [{termsAccepted:false},{dataAccepted:false},{accept:false},{ownerGeneration:0},{acceptedAt:'forged'},{accept:'true'}])assert.throws(()=>ownerConsentInput({...input,...patch}));
  const cipher=ownerCipher(Buffer.alloc(32,7)),ctx=[tenant,id(80),profile,2],bytes=cipher.encrypt(details,ctx);
  assert.deepEqual(cipher.decrypt(bytes,ctx),details);assert.notEqual(cipher.encrypt(details,ctx),bytes);
  assert.throws(()=>cipher.decrypt(bytes,[tenant,id(81),profile,2]));assert.throws(()=>cipher.decrypt(bytes,[tenant,id(80),profile,3]));
  assert.throws(()=>ownerCipher(Buffer.alloc(32,8)).decrypt(bytes,ctx));
  const corrupt=Buffer.from(bytes,'base64');corrupt[33]^=1;assert.throws(()=>cipher.decrypt(corrupt.toString('base64'),ctx));
});

test('encrypted owner saves, consent withdrawal, exact retries and generation invalidation stay development-only',async()=>{
  const {db,owner,drafts,readiness,evidence,seals,draft,body}=await foundation();
  try{
    let row=await owner.read(id(1),draft.id);assert.equal(row.details,null);assert.equal(row.consent,null);
    await seals.save(id(1),draft.id,id(81),{expectedDraftRevision:1,expectedFittingRevision:0,package:'NONE',placements:[]});
    const upload=await evidence.reserve(id(1),draft.id,id(82),{kind:'OWNER_ID',mime:'image/jpeg',bytes:Buffer.alloc(10),sha:'a'.repeat(64)});
    await evidence.finish(id(1),draft.id,upload.id);
    const save={expectedDraftRevision:1,details};
    row=await owner.save(id(1),draft.id,id(90),save);
    assert.equal(row.draftRevision,2);assert.equal(row.ownerGeneration,2);assert.deepEqual(row.details,details);
    assert.equal(row.phoneVerified,false);assert.equal(row.productionConsentVerified,false);assert.ok(!('ciphertext' in row));
    const stored=(await db.query('select * from private.draft_owner_details')).rows[0];
    for(const secret of [details.name,details.phone,details.idDocumentNumber])assert.ok(!JSON.stringify(stored).includes(secret));
    assert.equal((await owner.save(id(1),draft.id,id(90),save)).ownerGeneration,2);
    await assert.rejects(()=>owner.save(id(1),draft.id,id(90),{...save,details:{...details,name:'Changed'}}),e=>e.getStatus()===409);
    await assert.rejects(()=>owner.save(id(1),draft.id,id(91),save),e=>e.getStatus()===409);
    assert.deepEqual((await evidence.list(id(1),draft.id)).items,[]);
    await assert.rejects(()=>evidence.read(id(1),draft.id,upload.id),e=>e.getStatus()===404);
    await assert.rejects(()=>evidence.finish(id(1),draft.id,upload.id),e=>e.getStatus()===404);
    await assert.rejects(()=>evidence.reserve(id(1),draft.id,upload.id,{kind:'OWNER_ID',mime:'image/jpeg',bytes:Buffer.alloc(10),sha:'a'.repeat(64)}),e=>e.getStatus()===409);
    let ready=await readiness.read(id(1),draft.id);assert.equal(state(ready,'OWNER_DETAILS_SAMPLE'),'COMPLETE');
    assert.equal(state(ready,'CONSENT_SAMPLE'),'MISSING');assert.equal(state(ready,'SEAL_FITTING'),'STALE');
    const acceptance=accept(row);row=await owner.consent(id(1),draft.id,id(92),acceptance);
    assert.equal(row.consent.source,'AGENT_RECORDED_SAMPLE');assert.equal(row.consent.recordedByProfileId,profile);
    assert.equal(row.consent.status,'RECORDED');assert.ok(row.consent.recordedAt);assert.equal(state(await readiness.read(id(1),draft.id),'CONSENT_SAMPLE'),'COMPLETE');
    const {termsAccepted,dataAccepted,...withdraw}=acceptance;
    row=await owner.consent(id(1),draft.id,id(93),{...withdraw,accept:false});assert.equal(row.consent.status,'WITHDRAWN');
    assert.equal((await owner.consent(id(1),draft.id,id(92),acceptance)).consent.status,'WITHDRAWN');
    assert.equal(state(await readiness.read(id(1),draft.id),'CONSENT_SAMPLE'),'MISSING');
    row=await owner.consent(id(1),draft.id,id(94),acceptance);
    await assert.rejects(()=>db.exec("update private.development_enrollment_consent_documents set terms_text='rewritten' where language='en'"),e=>e.code==='AG409');
    await db.exec("update private.development_enrollment_consent_documents set active=false where language='en'");
    assert.equal((await owner.read(id(1),draft.id)).consent,null);
    assert.equal(state(await readiness.read(id(1),draft.id),'CONSENT_SAMPLE'),'MISSING');
    await assert.rejects(()=>owner.consent(id(1),draft.id,id(97),acceptance),e=>e.getStatus()===409);
    await db.exec("update private.development_enrollment_consent_documents set active=true where language='en'");
    row=await owner.save(id(1),draft.id,id(95),{expectedDraftRevision:2,details:{...details,name:'Fictional Owner Updated'}});
    assert.equal(row.consent,null);assert.equal(row.ownerGeneration,3);assert.equal(row.draftRevision,3);
    await assert.rejects(()=>owner.consent(id(1),draft.id,id(96),acceptance),e=>e.getStatus()===409);
    await db.exec(`insert into private.development_enrollment_owners(tenant_id,organization_id,user_id,label) values('${tenant}','${org}','${id(22)}','Development owner 2')`);
    await drafts.save(id(1),draftInput({...body,ownerProfileId:id(22),expectedRevision:3},true),draft.id);
    assert.equal((await owner.read(id(1),draft.id)).details,null);
    await drafts.save(id(1),draftInput({...body,expectedRevision:4},true),draft.id);
    row=await owner.read(id(1),draft.id);assert.equal(row.details,null);assert.equal(row.consent,null);
    assert.deepEqual((await evidence.list(id(1),draft.id)).items,[]);
    ready=await readiness.read(id(1),draft.id);assert.equal(ready.canSubmit,false);
    assert.equal(state(ready,'OWNER_PHONE'),'UNAVAILABLE');assert.equal(state(ready,'CONSENT'),'UNAVAILABLE');
    const projection=JSON.stringify([await drafts.list(id(1),{limit:20}),ready,await db.query('select * from private.draft_owner_events')]);
    for(const secret of [details.name,details.phone,details.idDocumentNumber])assert.ok(!projection.includes(secret));
    for(const table of ['app.vehicles','app.ownerships','private.owners'])assert.equal((await db.query('select count(*)::int n from '+table)).rows[0].n,0);
  }finally{await db.close();}
});

test('owner HTTP endpoints fail closed for revoked agents, foreign drafts, missing key and invalid bodies',async()=>{
  const {db,pool,store,owner,drafts,draft}=await foundation();let app;
  try{
    await assert.rejects(()=>owner.read(id(2),draft.id),e=>e.getStatus()===403);
    await db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code,organization_id) values('${tenant}','${id(22)}','ENROLLMENT_AGENT','${org}');
      insert into app.agent_accreditations(tenant_id,user_id,organization_id) values('${tenant}','${id(22)}','${org}');`);
    await assert.rejects(()=>owner.read(id(2),draft.id),e=>e.getStatus()===404);
    await assert.rejects(()=>new OwnerService(new PostgresOwnerStore(pool,id(999)),ownerCipher(Buffer.alloc(32,7))).read(id(1),draft.id),e=>e.getStatus()===403);
    await assert.rejects(()=>configuredOwner({},store,true).read(id(1),draft.id),e=>e.getStatus()===503);
    await assert.rejects(()=>configuredOwner({ENROLLMENT_EVIDENCE_KEY_HEX:'a'.repeat(64)},store,false).read(id(1),draft.id),e=>e.getStatus()===503);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('begin;set local role '+role);
      await assert.rejects(()=>db.query('select private.draft_owner_read($1)',[draft.id]),e=>e.code==='42501');await db.exec('rollback');
    }
    await db.exec('begin;set local role autoguardian_enrollment_api');
    await assert.rejects(()=>db.query('select private.draft_owner_snapshot($1)',[draft.id]),e=>e.code==='42501');await db.exec('rollback');
    for(const table of ['draft_owner_details','draft_owner_events','development_enrollment_consent_documents']){
      await db.exec('begin;set local role autoguardian_enrollment_api');
      await assert.rejects(()=>db.query('select * from private.'+table),e=>e.code==='42501');await db.exec('rollback');
    }
    const auth={verify:async header=>{if(header!=='Bearer agent')throw new UnauthorizedException();return id(1);}};
    app=await createApp(auth,{load:async()=>({})},undefined,undefined,{auth:new DevelopmentDraftVerifier(auth,true),store:drafts,owner});
    await app.listen(0,'127.0.0.1');const base=await app.getUrl(),route=base+'/v1/enrollment-drafts/'+draft.id+'/owner';
    assert.equal((await fetch(route)).status,401);const headers={Authorization:'Bearer agent','Content-Type':'application/json','Idempotency-Key':id(90)};
    assert.equal((await fetch(route+'?tenantId='+tenant,{headers})).status,400);
    assert.equal((await fetch(route,{method:'POST',headers,body:JSON.stringify({expectedDraftRevision:1,details:{...details,phoneVerified:true}})})).status,400);
    const response=await fetch(route,{method:'POST',headers,body:JSON.stringify({expectedDraftRevision:1,details})});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).phoneVerified,false);
    await db.exec(`update app.agent_accreditations set status='REVOKED' where user_id='${profile}'`);
    assert.equal((await fetch(route,{headers})).status,403);
  }finally{if(app)await app.close();await db.close();}
});
