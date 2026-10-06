const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const {randomBytes}=require('node:crypto');
const sharp=require('sharp');const {PGlite}=require('@electric-sql/pglite');
const {UnauthorizedException}=require('@nestjs/common');const {createApp}=require('../dist/app');
const {draftInput,DevelopmentDraftVerifier,PostgresEnrollmentStore}=require('../dist/enrollments');
const {EvidenceService,PostgresEvidenceStore,evidenceCipher,evidenceInput,digest,configuredEvidence,EVIDENCE_MAX}=require('../dist/evidence');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant='ce31527e-d1b5-4379-9ddd-1458cfb73431',profile='369cbe75-32c8-40b4-a9ee-f2d9bde379db',org='014db61a-4c68-48cb-86b6-46837f4da873';
const pdf=Buffer.from('%PDF-1.4\nSynthetic test only\n%%EOF\n');
const payload={kind:'OWNER_ID',dataBase64:pdf.toString('base64')};
async function foundation() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create role autoguardian_identity_login nologin;create schema auth;create table auth.users(id uuid primary key);`);
  for(const file of ['202610050001_core_foundation.sql','202610050002_default_permissions.sql','202610050003_identity_api.sql',
    '202610060004_owned_vehicle_reads.sql','202610060005_enrollment_drafts.sql','202610060006_development_owner_selection.sql',
    '202610060007_enrollment_attachments.sql']) {
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
  for(const [bytes,record] of [[changed,row],[encrypted,{...row,draft_id:id(42)}],[encrypted,{...row,owner_profile_id:id(22)}]]) {
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
