const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const {randomBytes}=require('node:crypto');
const sharp=require('sharp');const {PGlite}=require('@electric-sql/pglite');
const {UnauthorizedException}=require('@nestjs/common');const {createApp}=require('../dist/app');
const {draftInput,DevelopmentDraftVerifier,PostgresEnrollmentStore}=require('../dist/enrollments');
const {EvidenceService,PostgresEvidenceStore,evidenceCipher,evidenceInput,digest,configuredEvidence,EVIDENCE_MAX}=require('../dist/evidence');
const {PostgresReadinessStore}=require('../dist/readiness');
const {PostgresSealStore}=require('../dist/seals');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431',profile='369cbe75-32c8-40b4-a9ee-f2d9bde379db',org='014db61a-4c68-48cb-86b6-46837f4da873';
const pdf=Buffer.from('%PDF-1.4\nSynthetic test only\n%%EOF\n');
const payload={kind:'OWNER_ID',dataBase64:pdf.toString('base64')};
async function foundation() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create role autoguardian_identity_login nologin;create schema auth;create table auth.users(id uuid primary key);`);
  for(const file of (await fs.readdir(path.resolve(__dirname,'../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'));
  }
  await db.exec(`insert into auth.users values ('${id(1)}'),('${id(2)}');
    insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone)
    values ('${tenant}','AUTOGUARDIAN_DEV','Development','CD','USD','Africa/Kinshasa');
    insert into app.users(id,tenant_id,auth_user_id) values ('${profile}','${tenant}','${id(1)}'),('${id(22)}','${tenant}','${id(2)}');`);
  for(const file of ['setup-development-agent.sql','setup-development-owner.sql']) {
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase',file),'utf8'));
  }
  const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},release(){}})};
  const drafts=new PostgresEnrollmentStore(pool,tenant);
  const draft=(await drafts.save(id(1),draftInput({organizationId:org,ownerProfileId:profile,
    vehicle:{chassisIdentifier:'ATTACHMENT-TEST',plate:'ATTACHMENT-001',category:'CAR'}}),undefined,id(80))).draft;
  return {db,pool,drafts,draft,store:new PostgresEvidenceStore(pool,tenant)};
}
test('attachment validation strips image metadata, rejects invalid/active content and enforces the size limit',async()=>{
  const image=await sharp({create:{width:3,height:3,channels:3,background:'white'}}).jpeg()
    .withExif({IFD0:{Artist:'Synthetic owner',Copyright:'Sample'}}).toBuffer();
  const result=await evidenceInput({kind:'VEHICLE_PHOTO',dataBase64:image.toString('base64')});
  assert.equal(result.mime,'image/jpeg');assert.equal((await sharp(result.bytes).metadata()).exif,undefined);
  assert.equal((await evidenceInput(payload)).mime,'application/pdf');
  for(const body of [{...payload,fileName:'Private'}, {...payload,kind:'VEHICLE_PHOTO'},
    ...['VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO']
      .map(kind=>({...payload,kind})),
    {...payload,dataBase64:'invalid'}, {...payload,dataBase64:Buffer.from('not an image').toString('base64')},
    {...payload,dataBase64:Buffer.from('%PDF-1.4\n/JavaScript\n%%EOF').toString('base64')}]) {
    await assert.rejects(()=>evidenceInput(body),e=>e.getStatus()===400);
  }
  await assert.rejects(()=>evidenceInput({...payload,dataBase64:'A'.repeat(Math.ceil(EVIDENCE_MAX/3)*4+4)}),e=>e.getStatus()===413);
});
test('authenticated encryption rejects tampering, wrong keys, owner changes and cross-draft substitution',()=>{
  const row={tenant_id:tenant,draft_id:id(40),owner_profile_id:profile,id:id(41),kind:'OWNER_ID',mime_type:'application/pdf',byte_size:pdf.length,sha256:digest(pdf)};
  const cipher=evidenceCipher(randomBytes(32));const encrypted=cipher.encrypt(pdf,row);
  assert.equal(encrypted.includes(pdf),false);assert.deepEqual(cipher.decrypt(encrypted,row),pdf);
  const changed=Buffer.from(encrypted);changed[changed.length-1]^=1;
  for(const [bytes,record] of [[changed,row],[encrypted,{...row,draft_id:id(42)}],[encrypted,{...row,owner_profile_id:id(22)}],
    [encrypted,{...row,kind:'PURCHASE_PROOF'}]]) {
    assert.throws(()=>cipher.decrypt(bytes,record),e=>e.getStatus()===503);
  }
  assert.throws(()=>evidenceCipher(randomBytes(32)).decrypt(encrypted,row),e=>e.getStatus()===503);
  assert.throws(()=>evidenceCipher(Buffer.alloc(4)));
  assert.ok(configuredEvidence({}, {}, false)); // Missing secrets never enable an upload service.
  assert.throws(()=>configuredEvidence({SUPABASE_STORAGE_SECRET_KEY:'sb_secret_test'}, {}, true),/encryption|ENROLLMENT_EVIDENCE_KEY_HEX/);
});
test('attachment lifecycle encrypts before storage, survives retries, audits reads and denies other users',async()=>{
  const {db,store,draft,drafts}=await foundation();let app;
  const objects=new Map();let failure=false;
  const storage={check:async()=>{},put:async(p,b)=>{if(!objects.has(p))objects.set(p,Buffer.from(b));},
    get:async p=>{if(failure)throw new Error('Simulated lost response');return objects.get(p);}};
  const service=new EvidenceService(store,storage,evidenceCipher(randomBytes(32)));
  try {
    assert.equal((await new EvidenceService(store).list(id(1),draft.id)).uploadsEnabled,false);
    await assert.rejects(()=>new EvidenceService(store).upload(id(1),draft.id,id(90),payload),e=>e.getStatus()===503);
    failure=true;await assert.rejects(()=>service.upload(id(1),draft.id,id(90),payload));
    assert.equal((await store.list(id(1),draft.id)).items[0].status,'PENDING');
    assert.equal([...objects.values()][0].includes(pdf),false);
    failure=false;const saved=await service.upload(id(1),draft.id,id(90),payload);
    assert.equal(saved.attachment.status,'STAGED');assert.equal('object_path' in saved.attachment,false);
    await service.upload(id(1),draft.id,id(90),payload);assert.equal(objects.size,1);
    await assert.rejects(()=>service.upload(id(1),draft.id,id(90),{...payload,dataBase64:Buffer.from('%PDF-1.4\nChanged\n%%EOF').toString('base64')}),e=>e.getStatus()===409);
    await assert.rejects(()=>service.read(id(1),draft.id,id(90),{}),e=>e.getStatus()===400);
    const restored=await service.read(id(1),draft.id,id(90),{reason:'ENROLLMENT_REVIEW'});
    assert.deepEqual(Buffer.from(restored.dataBase64,'base64'),pdf);
    assert.equal((await db.query("select count(*)::int n from private.enrollment_attachment_events where action='READ_REQUESTED'")).rows[0].n,1);
    await assert.rejects(()=>service.read(id(2),draft.id,id(90),{reason:'ENROLLMENT_REVIEW'}),e=>e.getStatus()===403);
    await db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code,organization_id) values ('${tenant}','${id(22)}','ENROLLMENT_AGENT','${org}');
      insert into app.agent_accreditations(tenant_id,user_id,organization_id) values ('${tenant}','${id(22)}','${org}');`);
    await assert.rejects(()=>store.list(id(2),draft.id),e=>e.getStatus()===404);
    await assert.rejects(()=>service.read(id(2),draft.id,id(90),{reason:'ENROLLMENT_REVIEW'}),e=>e.getStatus()===404);
    for(const role of ['anon','authenticated','service_role','autoguardian_enrollment_api']) {
      await db.exec(`begin;set local role ${role}`);
      await assert.rejects(()=>db.exec('select * from private.enrollment_attachments'),e=>e.code==='42501');await db.exec('rollback');
    }
    const auth={verify:async header=>{if(header!=='Bearer agent')throw new UnauthorizedException();return id(1);}};
    app=await createApp(auth,{load:async()=>({})},undefined,undefined,{auth:new DevelopmentDraftVerifier(auth,true),store:drafts,evidence:service});
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();const route=base+'/v1/enrollment-drafts/'+draft.id+'/attachments';
    assert.equal((await fetch(route)).status,401);
    const post=body=>fetch(route,{method:'POST',headers:{Authorization:'Bearer agent','Content-Type':'application/json','Idempotency-Key':id(91)},body:JSON.stringify(body)});
    assert.equal((await post({...payload,objectPath:'another-owner'})).status,400);
    assert.equal((await post({...payload,dataBase64:'A'.repeat(3*1024*1024)})).status,413);
    const pendingOwners=(await db.query('select count(*)::int n from private.owners')).rows[0].n;assert.equal(pendingOwners,0);
    // Changing proposed owner prevents old-owner evidence from being disclosed or reused.
    await db.exec(`insert into private.development_enrollment_owners(tenant_id,organization_id,user_id,label)
      values ('${tenant}','${org}','${id(22)}','Development owner 2');`);
    await drafts.save(id(1),draftInput({organizationId:org,ownerProfileId:id(22),vehicle:draft.vehicle,expectedRevision:1},true),draft.id);
    assert.deepEqual((await store.list(id(1),draft.id)).items,[]);
    await assert.rejects(()=>service.read(id(1),draft.id,id(90),{reason:'ENROLLMENT_REVIEW'}),e=>e.getStatus()===404);
    await db.exec(`update app.agent_accreditations set status='SUSPENDED' where user_id='${profile}'`);
    await assert.rejects(()=>store.list(id(1),draft.id),e=>e.getStatus()===403);
  } finally {if(app)await app.close();await db.close();}
});
test('private bucket setup overrides broad client policies without exposing ciphertext objects',async()=>{
  const {db}=await foundation();
  try {
    await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated,service_role;grant select,insert on storage.objects to anon,authenticated,service_role;
      create policy unrelated_permissive on storage.objects to public using (true) with check (true);`);
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/setup-development-evidence-bucket.sql'),'utf8'));
    await db.exec("insert into storage.objects(bucket_id) values ('development-enrollment-evidence'),('another-bucket')");
    for(const role of ['anon','authenticated']) {
      await db.exec(`begin;set local role ${role}`);
      assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows,[{bucket_id:'another-bucket'}]);
      await assert.rejects(()=>db.exec("insert into storage.objects(bucket_id) values ('development-enrollment-evidence')"),e=>e.code==='42501');
      await db.exec('rollback');
    }
    assert.equal((await db.query("select public from storage.buckets where id='development-enrollment-evidence'")).rows[0].public,false);
  } finally {await db.close();}
});

test('detailed evidence requires six distinct saved photos and either registration or purchase proof, with safe retries and owner invalidation',async()=>{
  const {db,pool,store,draft,drafts}=await foundation();
  const objects=new Map();let interrupted=false;
  const storage={check:async()=>{},put:async(p,b)=>{if(!objects.has(p))objects.set(p,b);},get:async p=>{
    if(interrupted)throw new Error('Interrupted read-back');return objects.get(p);
  }};
  const service=new EvidenceService(store,storage,evidenceCipher(randomBytes(32)));
  const readiness=new PostgresReadinessStore(pool,tenant),seals=new PostgresSealStore(pool,tenant);
  const state=(value,code)=>value.evidenceChecklist.items.find(item=>item.code===code).status;
  try {
    let value=await service.list(id(1),draft.id);assert.equal(value.evidenceChecklist.items.length,8);
    assert.ok(value.evidenceChecklist.items.every(item=>item.status==='MISSING'));
    await service.upload(id(1),draft.id,id(201),payload);
    await service.upload(id(1),draft.id,id(202),{...payload,kind:'PURCHASE_PROOF'});
    const photo=async n=>({dataBase64:(await sharp({create:{width:8,height:8,channels:3,
      background:{r:n*30,g:60,b:120}}}).png().toBuffer()).toString('base64')});
    const front={...await photo(1),kind:'VEHICLE_FRONT'};
    await service.upload(id(1),draft.id,id(203),{...front,kind:'VEHICLE_PHOTO'});
    assert.equal(state(await service.list(id(1),draft.id),'VEHICLE_FRONT'),'MISSING');
    interrupted=true;await assert.rejects(()=>service.upload(id(1),draft.id,id(204),front));
    value=await service.list(id(1),draft.id);assert.equal(state(value,'VEHICLE_FRONT'),'PENDING');
    assert.equal(value.evidenceChecklist.complete,false);
    assert.equal((await readiness.read(id(1),draft.id)).checks.find(c=>c.code==='VEHICLE_PHOTO_SAMPLE').status,'MISSING');
    interrupted=false;await service.upload(id(1),draft.id,id(204),front);await service.upload(id(1),draft.id,id(204),front);
    assert.equal(state(await service.list(id(1),draft.id),'VEHICLE_FRONT'),'COMPLETE');
    await assert.rejects(()=>service.upload(id(1),draft.id,id(204),{...front,kind:'VEHICLE_REAR'}),e=>e.getStatus()===409);
    await assert.rejects(()=>service.upload(id(1),draft.id,id(205),{...front,kind:'VEHICLE_REAR'}),e=>e.getStatus()===409);
    for(const [n,kind] of ['VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO'].entries())
      await service.upload(id(1),draft.id,id(210+n),{...await photo(n+2),kind});
    value=await service.list(id(1),draft.id);assert.equal(value.evidenceChecklist.complete,true);
    let review=await readiness.read(id(1),draft.id);assert.deepEqual(review.evidenceChecklist,value.evidenceChecklist);
    assert.equal(review.checks.find(c=>c.code==='REGISTRATION_SAMPLE').status,'COMPLETE');
    assert.equal(review.checks.find(c=>c.code==='VEHICLE_PHOTO_SAMPLE').status,'COMPLETE');
    assert.equal((await seals.fitting(id(1),draft.id)).sampleDocumentsSaved,true);
    assert.equal(review.canSubmit,false);assert.equal(review.enrollmentActive,false);
    // More than ten files are needed for all documents plus four fitting photos.
    for(let n=0;n<4;n++)await service.upload(id(1),draft.id,id(230+n),{...await photo(n+1),kind:'SEAL_FITTING_PHOTO'});
    assert.equal((await service.list(id(1),draft.id)).items.length,13);
    for(let n=0;n<17;n++)await service.upload(id(1),draft.id,id(250+n),payload);
    assert.equal((await service.list(id(1),draft.id)).items.length,30);
    await service.upload(id(1),draft.id,id(201),payload); // Retry still works at the limit.
    await assert.rejects(()=>service.upload(id(1),draft.id,id(280),payload),e=>e.getStatus()===409);
    await assert.rejects(()=>service.list(id(2),draft.id),e=>e.getStatus()===403);
    for(const role of ['anon','authenticated','service_role','autoguardian_enrollment_api']) {
      await db.exec('begin;set local role '+role);
      await assert.rejects(()=>db.query('select private.enrollment_evidence_checklist($1)',[draft.id]),e=>e.code==='42501');
      await db.exec('rollback');
    }
    // Owner edits advance the generation; stale files and retry keys cannot resurrect evidence.
    await db.query('update app.enrollment_drafts set owner_generation=owner_generation+1,revision=revision+1 where id=$1',[draft.id]);
    value=await service.list(id(1),draft.id);assert.deepEqual(value.items,[]);
    assert.ok(value.evidenceChecklist.items.every(item=>item.status==='MISSING'));
    await assert.rejects(()=>service.upload(id(1),draft.id,id(201),payload),e=>e.getStatus()===409);
    await service.upload(id(1),draft.id,id(281),{...payload,kind:'REGISTRATION_DOCUMENT'});
    assert.equal(state(await service.list(id(1),draft.id),'REGISTRATION_PROOF'),'COMPLETE');
    review=await readiness.read(id(1),draft.id);assert.equal(review.evidenceChecklist.complete,false);
    for(const table of ['app.vehicles','app.ownerships','private.owners'])assert.equal((await db.query('select count(*)::int n from '+table)).rows[0].n,0);
  } finally {await db.close();}
});

test('evidence endpoints report missing checklist setup without enabling uploads',async()=>{
  const store={list:async()=>({items:[]})};
  const service=new EvidenceService(store,{check:async()=>{},put:async()=>{},get:async()=>{}},evidenceCipher(randomBytes(32)));
  for(const operation of [()=>service.list(id(1),id(2)),()=>service.upload(id(1),id(2),id(3),payload)])
    await assert.rejects(operation,e=>e.getStatus()===503 && e.getResponse().code==='EVIDENCE_SETUP_REQUIRED');
});
