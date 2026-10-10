const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,id}=require('./helpers/production-seal-fixture.cjs');
const {PostgresWorkflowStore,CheckService,ReportEvidenceService,checkLookup}=require('../dist/checks');
const {SealSigner}=require('../dist/productionSeals');
const {SimulatedSmsAdapter,SimulatedUssdAdapter,parseSmsCommand}=require('../dist/basicPhone');
const {createApp}=require('../dist/app');
const sharp=require('sharp'),fs=require('node:fs/promises'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
async function workflowFixture(){
  const f=await fixture();
  await f.db.exec(`update auth.users set phone='24300000000'||case when id='${id(1)}' then '1' when id='${id(2)}' then '2' else '3' end,phone_confirmed_at=now();
    insert into app.role_assignments(tenant_id,user_id,role_code) values('${id(10)}','${id(21)}','VERIFIER');
    insert into private.vehicle_check_configuration(tenant_id,sample_enabled,response_seconds,result_validity_seconds,max_checks_per_hour,reminder_seconds,backup_seconds)
    values('${id(10)}',true,900,3600,20,120,300);
    begin;insert into app.vehicles(id,tenant_id,chassis_identifier,current_plate,category,record_status) values('${id(501)}','${id(10)}','CHECK-CHASSIS','CHECK-001','CAR','ACTIVE');
    insert into app.ownerships(id,tenant_id,vehicle_id,owner_id,source,start_at) values('${id(601)}','${id(10)}','${id(501)}','${id(40)}','TEST',now()-interval '1 day');commit;`);
  const store=new PostgresWorkflowStore(f.pool,id(10)),checks=new CheckService(store);
  const create=(key=701,method='plate',value='check-001')=>f.as(1,()=>checks.create(id(1),id(key),{method,value}));
  const call=(user,name,args)=>f.as(user,()=>store.call(id(user),name,args));
  const report=(key=801,kind='missing',user=2)=>call(user,'submit_vehicle_report',[id(501),id(key),kind,'2026-01-01T00:00:00Z','Synthetic report reason']);
  return {...f,store,checks,create,call,report};
}
test('lookup unifies trimmed plate/chassis, limits retries, rejects ambiguity and private payloads',async()=>{
  const f=await workflowFixture();try{
    const r=await f.create();assert.equal(r.outcome,'pending');assert.equal((await f.create(701,'chassis',' CHECK-CHASSIS ')).id,r.id);
    assert.equal(JSON.stringify(r).includes('Synthetic owner'),false);
    assert.equal('ownerId' in r,false);assert.equal('sealPackage' in r.vehicle,false);
    await assert.rejects(f.create(702,'plate','absent'),e=>e.getStatus()===404);
    await f.db.exec(`insert into app.vehicles(tenant_id,chassis_identifier,current_plate,category) values('${id(10)}','OTHER-CHASSIS','CHECK-001','CAR')`);
    await assert.rejects(f.create(703),e=>e.getResponse().code==='CHECK_AMBIGUOUS_IDENTIFIER');
    await f.db.exec(`update private.vehicle_check_configuration set max_checks_per_hour=1`);
    await assert.rejects(f.create(704,'chassis','CHECK-CHASSIS'),e=>e.getStatus()===429);
    assert.equal((await f.create(701,'chassis','CHECK-CHASSIS')).id,r.id); // retries do not consume quota
    await f.db.exec('update auth.users set phone_confirmed_at=null');
    await assert.rejects(f.call(2,'decide_vehicle_check',[r.id,'approved']),e=>e.getStatus()===403);
    assert.throws(()=>checkLookup({method:'plate',value:'A',ownerId:id(2)}));
    assert.throws(()=>checkLookup({method:'qr',value:'\nsecret'}));
  }finally{await f.db.close();}
});
test('owner inbox and cross-channel decisions remain request-bound, revoked ownership cannot answer',async()=>{
  const f=await workflowFixture();try{
    const r=await f.create();
    const inbox=await f.call(2,'list_vehicle_checks',[true,null,20]);assert.equal(inbox.items[0].id,r.id);
    assert.equal('buyerId' in inbox.items[0],false);assert.equal('ownerId' in inbox.items[0],false);
    await assert.rejects(f.call(1,'list_vehicle_checks',[true,null,20]),e=>e.getStatus()===403);
    const sms=new SimulatedSmsAdapter(f.checks);
    await f.as(2,()=>sms.execute({simulation:true,authUserId:id(2),language:'en'},'REFUSE '+r.id,id(900)));
    await assert.rejects(f.call(2,'decide_vehicle_check',[r.id,'approved']),e=>e.getStatus()===409);
    assert.equal((await f.call(1,'read_vehicle_check',[r.id])).outcome,'refused');
    assert.deepEqual((await f.call(2,'list_vehicle_checks',[true,null,20])).items,[]);
    const next=await f.create(702);
    await f.db.exec(`begin;update app.ownerships set end_at=now() where id='${id(601)}';
      insert into private.owners(id,tenant_id,user_id,kind,legal_name) values('${id(41)}','${id(10)}','${id(23)}','PERSON','New owner');
      insert into app.ownerships(tenant_id,vehicle_id,owner_id,source) values('${id(10)}','${id(501)}','${id(41)}','TRANSFER_TEST');commit;`);
    await assert.rejects(f.call(2,'decide_vehicle_check',[next.id,'approved']),e=>e.getStatus()===404);
    assert.equal((await f.call(1,'read_vehicle_check',[next.id])).vehicle,null);
  }finally{await f.db.close();}
});
test('scheduled reminders, held backups and timeouts are durable, bounded and cancelled atomically',async()=>{
  const f=await workflowFixture();try{
    const r=await f.create();await f.db.exec(`update private.check_alert_jobs set due_at=now()-interval '1 minute'`);
    assert.deepEqual(await f.checks.sweep(),{timedOut:0,alertsRecorded:2});assert.deepEqual(await f.checks.sweep(),{timedOut:0,alertsRecorded:0});
    const jobs=(await f.db.query('select kind,state from private.check_alert_jobs order by kind')).rows;
    assert.deepEqual(jobs,[{kind:'backup',state:'awaiting_configuration'},{kind:'reminder',state:'recorded'}]);
    assert.equal((await f.db.query("select count(*)::int n from private.vehicle_check_notifications where kind='owner_reminder'")).rows[0].n,1);
    await f.call(2,'decide_vehicle_check',[r.id,'approved']);
    assert.equal((await f.db.query("select state from private.check_alert_jobs where kind='backup'")).rows[0].state,'cancelled');
    assert.equal((await f.db.query("select delivery_status from private.vehicle_check_notifications where kind='owner_reminder'")).rows[0].delivery_status,'cancelled');
    const late=await f.create(702);
    await f.db.exec(`update private.vehicle_check_requests set created_at=now()-interval '1 hour',response_deadline_at=now()-interval '1 minute' where id='${late.id}'`);
    assert.equal((await f.checks.sweep()).timedOut,1);assert.equal((await f.checks.sweep()).timedOut,0);
    await assert.rejects(f.call(2,'decide_vehicle_check',[late.id,'approved']),e=>e.getStatus()===409);
    assert.equal((await f.call(1,'read_vehicle_check',[late.id])).outcome,'timed_out');
    await f.db.exec(`update private.vehicle_check_requests set created_at=now()-interval '2 hours',response_deadline_at=now()-interval '70 minutes',result_expires_at=now()-interval '10 minutes' where id='${late.id}'`);
    const expired=await f.call(1,'read_vehicle_check',[late.id]);assert.equal(expired.expired,true);assert.equal(expired.vehicle,null);
  }finally{await f.db.close();}
});
test('authorized sale, missing and recovery changes preserve history and never transfer ownership',async()=>{
  const f=await workflowFixture();try{
    await assert.rejects(f.call(1,'change_vehicle_sale',[id(501),id(800),'NOT_FOR_SALE','FOR_SALE','Selling vehicle']),e=>e.getStatus()===403);
    const args=[id(501),id(801),'NOT_FOR_SALE','FOR_SALE','Selling vehicle'];
    const changed=await f.call(2,'change_vehicle_sale',args);assert.deepEqual(await f.call(2,'change_vehicle_sale',args),changed);
    await assert.rejects(f.call(2,'change_vehicle_sale',[id(501),id(802),'NOT_FOR_SALE','FOR_SALE','Selling vehicle']),e=>e.getStatus()===409);
    await assert.rejects(f.call(2,'change_vehicle_sale',[id(501),id(803),'FOR_SALE','AGENT_SALE','Appointing seller']),e=>e.getStatus()===409);
    const r=await f.create();const missing=await f.report(804);assert.equal((await f.call(1,'read_vehicle_check',[r.id])).vehicle.saleStatus,'REPORTED_MISSING');
    await assert.rejects(f.call(2,'decide_vehicle_check',[r.id,'approved']),e=>e.getStatus()===409);
    await assert.rejects(f.call(2,'change_vehicle_sale',[id(501),id(805),'REPORTED_MISSING','NOT_FOR_SALE','Recovered']),e=>e.getStatus()===409);
    await f.report(806,'recovered');assert.equal((await f.call(1,'read_vehicle_check',[r.id])).vehicle.saleStatus,'NOT_FOR_SALE');
    const history=await f.call(2,'read_vehicle_status_history',[id(501)]);assert.equal(history.items.length,3);
    assert.equal((await f.db.query('select owner_id from app.ownerships where end_at is null')).rows[0].owner_id,id(40));
    assert.equal((await f.call(2,'read_vehicle_reports',[false,missing.id])).items[0].history[0].action,'submitted');
    await f.db.exec('update private.vehicle_check_configuration set sample_enabled=false');
    await assert.rejects(f.report(807),e=>e.getStatus()===403);
  }finally{await f.db.close();}
});
test('report evidence is encrypted, scoped, idempotent and audited; only independent MFA admin reviews',async()=>{
  const f=await workflowFixture();try{
    await f.create();const report=await f.report(801,'incident',1);
    const evidence=new ReportEvidenceService(f.store,Buffer.alloc(32,5));
    const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#fff'}}).jpeg().toBuffer();
    const input={kind:'VEHICLE_PHOTO',dataBase64:bytes.toString('base64')};
    const uploaded=await f.as(1,()=>evidence.upload(id(1),report.id,id(802),input));
    assert.deepEqual(await f.as(1,()=>evidence.upload(id(1),report.id,id(802),input)),uploaded);
    assert.equal((await f.db.query('select count(*)::int n from private.vehicle_report_evidence')).rows[0].n,1);
    const ciphertext=(await f.db.query('select ciphertext from private.vehicle_report_evidence')).rows[0].ciphertext;
    assert.notEqual(ciphertext,input.dataBase64);
    await assert.rejects(f.as(2,()=>evidence.read(id(2),uploaded.id,false)),e=>e.getStatus()===404);
    const file=await f.as(3,()=>evidence.read(id(3),uploaded.id,true));assert.equal(file.mimeType,'image/jpeg');
    await assert.rejects(f.call(2,'read_vehicle_reports',[true,null]),e=>e.getStatus()===403);
    await f.db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code) values('${id(10)}','${id(21)}','TENANT_ADMIN')`);
    await assert.rejects(f.call(1,'review_vehicle_report',[report.id,id(803),'accepted','Evidence checked']),e=>e.getStatus()===403);
    const review=await f.call(3,'review_vehicle_report',[report.id,id(804),'accepted','Evidence checked']);
    assert.deepEqual(await f.call(3,'review_vehicle_report',[report.id,id(804),'accepted','Evidence checked']),review);
    await assert.rejects(f.call(3,'review_vehicle_report',[report.id,id(805),'rejected','Another decision']),e=>e.getStatus()===409);
    await assert.rejects(f.as(1,()=>evidence.upload(id(1),report.id,id(806),input)),e=>e.getStatus()===409);
    const events=(await f.call(3,'read_vehicle_reports',[true,report.id])).items[0].history;assert.ok(events.some(e=>e.action==='evidence_read'));
    const wrongKey=new ReportEvidenceService(f.store,Buffer.alloc(32,6));await assert.rejects(f.as(3,()=>wrongKey.read(id(3),uploaded.id,true)),e=>e.getStatus()===503);
  }finally{await f.db.close();}
});
test('signed QR and manual seal lookup reject forged, revoked and unknown identifiers',async()=>{
  const f=await workflowFixture();try{
    const signer=new SealSigner(id(10),'https://seals.example.test','v1',{v1:'a'.repeat(64)}),signed=signer.issue();
    // Synthetic fixture models an activated registration without changing the production signer.
    await f.db.exec(`insert into private.production_seal_batches(id,tenant_id,issuer_id,request_key,payload) values('${id(850)}','${id(10)}','${id(23)}','${id(851)}','{}');
      insert into private.development_seal_stock(id,tenant_id,organization_id,assigned_agent_id,code,type,batch_code,status,origin) values('${id(852)}','${id(10)}','${id(30)}','${id(21)}','${signed.code}','STANDARD','SYNTHETIC','IN_STOCK','PRODUCTION');
      insert into private.production_seal_identifiers(seal_id,tenant_id,batch_id,key_version,qr_url) values('${id(852)}','${id(10)}','${id(850)}','v1','${signed.qrUrl}');`);
    // Unknown/unfitted signed IDs must never yield a vehicle.
    const checks=new CheckService(f.store,signer);
    await assert.rejects(f.as(1,()=>checks.create(id(1),id(853),{method:'qr',value:signed.qrUrl})),e=>e.getStatus()===404);
    await assert.rejects(f.as(1,()=>checks.create(id(1),id(854),{method:'qr',value:signed.qrUrl.replace('sig=','sig=X')})),e=>e.getStatus()===400);
    await assert.rejects(f.create(855,'seal','AG'+'B'.repeat(32)),e=>e.getStatus()===404);
    await f.db.query("select set_config('autoguardian.tenant_id',$1,false),set_config('autoguardian.auth_user_id',$2,false),set_config('autoguardian.session_id',$3,false),set_config('autoguardian.staff_until',$4,false)",[id(10),id(1),id(61),String(Date.now()/1000+300)]);
    await f.db.exec(`insert into private.draft_seal_packages(draft_id,tenant_id,organization_id,agent_user_id,owner_profile_id,saved_draft_revision,revision,package)
      values('${f.draft.id}','${id(10)}','${id(30)}','${id(21)}','${id(22)}',1,1,'STANDARD');
      insert into private.draft_seal_placements(tenant_id,draft_id,organization_id,agent_user_id,seal_id,position)
      values('${id(10)}','${f.draft.id}','${id(30)}','${id(21)}','${id(852)}',1);
      insert into private.enrollment_submissions(draft_id,tenant_id,organization_id,agent_user_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,submit_key,finalize_key,status,vehicle_id,activated_at)
      values('${f.draft.id}','${id(10)}','${id(30)}','${id(21)}',1,1,1,1,'${id(856)}','${id(857)}','ACTIVE','${id(501)}',now());
      update private.development_seal_stock set status='ACTIVE' where id='${id(852)}';`);
    const result=await f.as(1,()=>checks.create(id(1),id(858),{method:'qr',value:signed.qrUrl}));
    assert.equal(result.vehicle.id,id(501));assert.equal((await f.create(858,'seal',signed.code)).id,result.id);
    await f.db.exec(`update private.development_seal_stock set status='REVOKED',revocation_reason='DAMAGED' where id='${id(852)}'`);
    await assert.rejects(f.as(1,()=>checks.create(id(1),id(859),{method:'qr',value:signed.qrUrl})),e=>e.getStatus()===404);
  }finally{await f.db.close();}
});
test('workflow migration installs for a non-superuser schema owner and removes temporary schema CREATE',async()=>{
  const db=new PGlite();try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create role autoguardian_identity_login nologin;create role workflow_migrator createrole;
      create schema auth;create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid,aal text,factor_id uuid,not_after timestamptz);
      create table auth.mfa_factors(id uuid primary key,user_id uuid,factor_type text,status text);
      create table auth.mfa_amr_claims(session_id uuid,authentication_method text,updated_at timestamptz);
      grant usage on schema auth to workflow_migrator;grant references,select on all tables in schema auth to workflow_migrator;
      grant create on database postgres to workflow_migrator;set role workflow_migrator;`);
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort()){
      try{await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'));}
      catch(e){throw new Error(file+': '+e.message+' '+(e.where??''));}
    }
    const checks=(await db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-milestone2-workflows.sql'),'utf8'))).rows[0];
    assert.ok(Object.values(checks).every(v=>v===true),JSON.stringify(checks));
  }finally{await db.close();}
});
test('SMS parsing and simulated USSD handle expiry, retries, correlation and dropped-session retrieval',async()=>{
  assert.deepEqual(parseSmsCommand('check chassis SAMPLE'),{type:'check',lookup:{method:'chassis',value:'SAMPLE'}});
  for(const input of ['1','APPROVE','APPROVE '+id(1)+' '+id(2),'HELP extra','CHECK SAMPLE','STATUS secret','HELP\nAPPROVE'])assert.throws(()=>parseSmsCommand(input));
  const f=await workflowFixture();try{
    const sms=new SimulatedSmsAdapter(f.checks),principal={simulation:true,authUserId:id(1),language:'fr'};let now=0;
    const ussd=new SimulatedUssdAdapter(sms,()=>now,1000);assert.ok(ussd.open(id(900),principal).startsWith('CON'));
    assert.ok((await ussd.input(id(900),principal,1,'1',id(901))).startsWith('CON'));
    const reply=await f.as(1,()=>ussd.input(id(900),principal,2,'CHECK-001',id(902)));assert.ok(reply.startsWith('END TEST'));
    assert.equal(await ussd.input(id(900),principal,2,'CHECK-001',id(902)),reply);
    assert.equal((await f.db.query('select count(*)::int n from private.vehicle_check_requests')).rows[0].n,1);
    const request=(await f.db.query('select id from private.vehicle_check_requests')).rows[0].id;
    const owner={simulation:true,authUserId:id(2),language:'en'};ussd.open(id(909),owner);
    assert.ok((await f.as(2,()=>ussd.input(id(909),owner,1,'6',id(910)))).includes(request));
    ussd.open(id(911),owner);
    await assert.rejects(ussd.input(id(911),principal,1,'6',id(912)),e=>e.getStatus()===403);
    const replies=await f.as(2,()=>Promise.all([ussd.input(id(911),owner,1,'6',id(913)),ussd.input(id(911),owner,1,'6',id(913))]));
    assert.equal(replies[0],replies[1]);assert.ok(replies[0].includes(request));
    ussd.open(id(903),principal);await ussd.input(id(903),principal,1,'3',id(904));
    assert.ok((await f.as(1,()=>ussd.input(id(903),principal,2,request,id(905)))).includes(request));
    ussd.open(id(906),principal);now=1001;await assert.rejects(ussd.input(id(906),principal,1,'1',id(907)),e=>e.getStatus()===403);
    await assert.rejects(sms.execute({...principal,simulation:false},'HELP',id(908)),e=>e.getStatus()===403);
  }finally{await f.db.close();}
});
test('workflow HTTP rejects spoofed input, requires bearer identity, and does not expose inbound simulation routes',async()=>{
  const f=await workflowFixture();let app;
  try{
    const auth={verify:async h=>{if(h!=='Bearer buyer')throw new (require('@nestjs/common').UnauthorizedException)();return id(1);}};
    app=await createApp(auth,{load:async()=>({})},undefined,undefined,undefined,undefined,undefined,{auth,staffAuth:auth,checks:f.checks,evidence:new ReportEvidenceService(f.store)});
    await app.listen(0,'127.0.0.1');const url=await app.getUrl();
    const post=(body,key=id(980),authorization='Bearer buyer')=>fetch(url+'/v1/vehicle-checks',{method:'POST',headers:{authorization,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
    assert.equal((await post({method:'plate',value:'CHECK-001',actor:id(2)})).status,400);
    assert.equal((await post({method:'plate',value:'CHECK-001'},id(980),'Bearer fake')).status,401);
    const created=await post({method:'plate',value:'CHECK-001'});assert.equal(created.status,200);assert.equal(created.headers.get('cache-control'),'no-store');
    assert.equal((await fetch(url+'/v1/webhooks/sms/inbound',{method:'POST'})).status,404);
  }finally{if(app)await app.close();await f.db.close();}
});
test('workflow tables deny direct tenant/client access and keep helper and history grants private',async()=>{
  const f=await workflowFixture();try{
    const checks=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-milestone2-workflows.sql'),'utf8'))).rows[0];
    assert.ok(Object.values(checks).every(v=>v===true),JSON.stringify(checks));
    await f.create();await f.report();
    for(const role of ['autoguardian_identity_login','anon','authenticated','service_role']){
      await f.db.exec('begin;set local role '+role);
      try{await assert.rejects(f.db.query('select * from private.vehicle_reports'),e=>e.code==='42501');}finally{await f.db.exec('rollback');}
    }
    await f.db.query("select set_config('autoguardian.tenant_id',$1,false),set_config('autoguardian.auth_user_id',$2,false)",[id(999),id(2)]);
    await f.db.exec('begin;set local role autoguardian_identity_login');
    try{await assert.rejects(f.db.query('select private.list_vehicle_checks(true,null,20)'),e=>e.code==='42501');}finally{await f.db.exec('rollback');}
    await f.db.exec(`update app.role_assignments set valid_from=now()-interval '1 day',valid_to=now()-interval '1 second' where user_id='${id(22)}'`);
    await assert.rejects(f.report(808),e=>e.getStatus()===403);
  }finally{await f.db.close();}
});
