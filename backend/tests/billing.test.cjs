const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,id}=require('./helpers/production-seal-fixture.cjs');
const {BillingStore,BillingService,billingInput}=require('../dist/billing');
const settings={sandboxEnabled:true,currency:'CDF',registrationFee:'1000',checkFee:'1000',renewalFee:'1000',freeMonthly:0,periodDays:30,graceDays:7,reminderDays:3,policyAcknowledged:false};
const key=Buffer.alloc(32,7);
async function setup(){
 const f=await fixture();const store=new BillingStore(f.pool,id(10));
 await f.db.exec(`update auth.users set phone='243813456789',phone_confirmed_at=now();
 insert into app.role_assignments(tenant_id,user_id,role_code) values('${id(10)}','${id(21)}','VERIFIER');
 insert into app.vehicles(id,tenant_id,chassis_identifier,category,record_status) values('${id(501)}','${id(10)}','BILLING-SYNTHETIC','CAR','ACTIVE');
 insert into app.ownerships(tenant_id,vehicle_id,owner_id,source) values('${id(10)}','${id(501)}','${id(40)}','TEST');`);
 const pending=new Map();const provider={
  async depositStatus(reference){return pending.get(reference);},
  async initiateDeposit(deposit){pending.set(deposit.depositId,{...deposit,country:'COD',status:'COMPLETED',providerTransactionId:'SANDBOX_TEST'});return {depositId:deposit.depositId,status:'ACCEPTED'};}
 };
 const service=new BillingService(store,key,provider);
 await f.as(3,()=>service.settings(id(3),settings,0));
 return {...f,store,service,pending};
}
const body=(purpose,targetId,revision=0)=>({purpose,targetId,targetRevision:revision,phoneNumber:'243813456789',provider:'VODACOM_MPESA_COD'});

test('billing configuration and payments enforce MFA, tenant permissions, exact retries, encrypted payer privacy and sandbox isolation',async()=>{
 const f=await setup();try{
  await assert.rejects(f.as(1,()=>f.service.settings(id(1),settings,1)),e=>e.getStatus()===403);
  await assert.rejects(f.as(3,()=>f.service.settings(id(3),settings,0)),e=>e.getStatus()===409);
  const input=body('REGISTRATION',f.draft.id,f.draft.enrollmentSnapshotRevision??1);
  const payment=await f.as(1,()=>f.service.begin(id(1),id(801),input));
  assert.equal(payment.status,'CREATED');assert.equal(payment.amount,'1000.0000');assert.equal(payment.sampleOnly,true);
  assert.equal(payment.id,(await f.as(1,()=>f.service.begin(id(1),id(801),input))).id);
  assert.equal(payment.id,(await f.as(1,()=>f.service.begin(id(1),id(803),input))).id);
  await assert.rejects(f.as(1,()=>f.service.begin(id(1),id(801),{...input,phoneNumber:'243813456039'})),e=>e.getStatus()===409);
  await assert.rejects(f.as(2,()=>f.service.read(id(2),payment.id)),e=>e.getStatus()===404);
  assert.equal(JSON.stringify(await f.as(1,()=>f.service.read(id(1),payment.id))).includes('243813456789'),false);
  const rows=await f.db.query('select payer_ciphertext from private.billing_payments');assert.equal(rows.rows[0].payer_ciphertext.includes('243813456789'),false);
  await f.service.processOne(payment.id);
  const confirmed=await f.as(1,()=>f.service.read(id(1),payment.id));assert.equal(confirmed.status,'COMPLETED');assert.ok(confirmed.receiptNumber.startsWith('SANDBOX-'));
  assert.equal((await f.db.query("select count(*)::integer as n from private.enrollment_prerequisite_receipts where code='PAYMENT'")).rows[0].n,0);
  await f.db.exec('set role autoguardian_identity_login;');
  await assert.rejects(f.db.query('select * from private.billing_payments'),e=>e.code==='42501');
  await assert.rejects(f.db.query('select private.billing_finish($1,$2,$3,$4,$5,$6)',[payment.id,id(802),'COMPLETED','1000','CDF','FORGED']),e=>e.code==='42501');
  await assert.rejects(f.db.query('select private.create_vehicle_check_before_billing($1,$2)',[id(501),id(804)]),e=>e.code==='42501');
  assert.equal((await f.db.query("select pg_has_role(current_user,'autoguardian_billing_worker','MEMBER') as member")).rows[0].member,false);
  await f.db.exec('reset role');
  const fs=require('node:fs/promises'),path=require('node:path');
  const verified=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-milestone3.sql'),'utf8'))).rows[0];
  assert.ok(Object.values(verified).every(v=>v===true),JSON.stringify(verified));
 }finally{await f.db.close();}
});

test('paid checks consume one purpose-bound payment; allowance is atomic and failed creation rolls back consumption',async()=>{
 const f=await setup();try{
  const quote=await f.as(1,()=>f.service.quote(id(1),id(810)));assert.equal(quote.allowed,false);
  const p=await f.as(1,()=>f.service.begin(id(1),id(811),body('CHECK',id(810))));await f.service.processOne(p.id);
  assert.equal((await f.as(1,()=>f.service.quote(id(1),id(810)))).allowed,true);
  const use=()=>f.store.call(id(1),'billing_quote',[id(810)]);
  await f.db.exec(`insert into private.vehicle_check_configuration(tenant_id,sample_enabled,response_seconds,result_validity_seconds,max_checks_per_hour) values('${id(10)}',true,900,86400,100);`);
  const {PostgresWorkflowStore}=require('../dist/checks');const checks=new PostgresWorkflowStore(f.pool,id(10));
  await assert.rejects(f.as(1,()=>checks.call(id(1),'lookup_vehicle_check',['chassis','UNKNOWN',null,id(810)])),e=>e.getStatus()===404);
  assert.equal((await f.db.query('select count(*)::integer as n from private.billing_check_usage')).rows[0].n,0);
  const created=await f.as(1,()=>checks.call(id(1),'lookup_vehicle_check',['chassis','BILLING-SYNTHETIC',null,id(810)]));
  assert.ok(created.id);assert.equal((await f.db.query('select count(*)::integer as n from private.billing_check_usage')).rows[0].n,1);
  await f.as(2,()=>checks.call(id(2),'decide_vehicle_check',[created.id,'approved']));
  assert.equal((await f.as(1,()=>checks.call(id(1),'read_vehicle_check',[created.id]))).outcome,'approved');
  await f.as(1,()=>checks.call(id(1),'lookup_vehicle_check',['chassis','BILLING-SYNTHETIC',null,id(810)]));
  assert.equal((await f.db.query('select count(*)::integer as n from private.billing_check_usage')).rows[0].n,1);
  await assert.rejects(f.as(1,()=>checks.call(id(1),'lookup_vehicle_check',['chassis','BILLING-SYNTHETIC',null,id(812)])),e=>e.getStatus()===409);
  assert.equal((await f.as(1,use)).allowed,true);
 }finally{await f.db.close();}
});

test('renewals extend subscription once, preserve resale vehicle state, schedule reminders and hide former-owner access',async()=>{
 const f=await setup();try{
  const p=await f.as(2,()=>f.service.begin(id(2),id(820),body('SUBSCRIPTION',id(501))));await f.service.processOne(p.id);
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).items[0].state,'ACTIVE');
  assert.equal(await f.service.processOne(p.id),false);
  await f.db.exec("update private.billing_subscriptions set remind_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 day',grace_until=clock_timestamp()+interval '1 day';");
  assert.equal(await f.service.sweep(),1);assert.equal(await f.service.sweep(),0);
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).items[0].state,'GRACE');
  await f.db.exec("update private.billing_subscriptions set grace_until=clock_timestamp()-interval '1 minute';");await f.service.sweep();
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).items[0].state,'SUSPENDED');
  assert.equal((await f.db.query('select record_status from app.vehicles')).rows[0].record_status,'ACTIVE');
  const renewal=await f.as(2,()=>f.service.begin(id(2),id(821),body('SUBSCRIPTION',id(501))));await f.service.processOne(renewal.id);
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).items[0].state,'ACTIVE');
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).reminders.length,0);
  await f.db.exec("begin; update app.vehicles set record_status='BLOCKED'; update app.ownerships set end_at=clock_timestamp(); commit;");
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).items.length,0);
  assert.equal((await f.as(2,()=>f.service.subscriptions(id(2)))).reminders.length,0);
 }finally{await f.db.close();}
});

test('payment amount and provider are never accepted as client confirmation',()=>{
 assert.throws(()=>billingInput({...body('CHECK',id(900)),status:'COMPLETED'}));
 assert.throws(()=>billingInput({...body('CHECK',id(900)),amount:'0.01'}));
});

test('unknown provider outcomes remain durable, mismatches cannot pay, and only MFA administrators can resume reconciliation',async()=>{
 const f=await setup();try{
   const p=await f.as(1,()=>f.service.begin(id(1),id(830),body('CHECK',id(831))));
   const offline=new BillingService(f.store,key,{depositStatus:async()=>{throw new Error('Network outcome unknown');}});
   await offline.processOne(p.id);
   assert.equal((await f.as(1,()=>f.service.read(id(1),p.id))).status,'PROCESSING');
   await f.db.exec('update private.billing_payments set attempts=12,available_at=clock_timestamp();');
   assert.equal(await f.service.processOne(p.id),false);
   await assert.rejects(f.as(1,()=>f.service.reconcile(id(1),p.id)),e=>e.getStatus()===403);
   await f.as(3,()=>f.service.reconcile(id(3),p.id));
   f.pending.set(p.id,{depositId:p.id,amount:'1',currency:'CDF',country:'COD',status:'COMPLETED',payer:{type:'MMO',accountDetails:{phoneNumber:'243813456789',provider:'VODACOM_MPESA_COD'}}});
   await f.service.processOne(p.id);assert.equal((await f.as(1,()=>f.service.read(id(1),p.id))).status,'DISCREPANCY');
   assert.equal((await f.as(1,()=>f.service.quote(id(1),id(831)))).allowed,false);
   assert.equal((await f.db.query("select count(*)::integer as n from private.billing_events where action='RECONCILIATION_REQUESTED'")).rows[0].n,1);
 }finally{await f.db.close();}
});

test('free allowances are shared by verified phone, bounded by Kinshasa month and not consumed by duplicate checks',async()=>{
 const f=await setup();try{
  await f.as(3,()=>f.service.settings(id(3),{...settings,freeMonthly:1},1));
  await f.db.exec(`insert into app.role_assignments(tenant_id,user_id,role_code) values('${id(10)}','${id(22)}','VERIFIER');
   insert into private.vehicle_check_configuration(tenant_id,sample_enabled,response_seconds,result_validity_seconds,max_checks_per_hour) values('${id(10)}',true,900,86400,100);`);
  const {PostgresWorkflowStore}=require('../dist/checks'),checks=new PostgresWorkflowStore(f.pool,id(10));
  const send=()=>f.as(1,()=>checks.call(id(1),'lookup_vehicle_check',['chassis','BILLING-SYNTHETIC',null,id(840)]));
  assert.equal((await f.as(1,()=>f.service.quote(id(1),id(840)))).freeRemaining,1);
  await send();await send();
  assert.equal((await f.as(2,()=>f.service.quote(id(2),id(841)))).allowed,false);
  await f.db.exec("update private.billing_check_usage set created_at=clock_timestamp()-interval '2 months';");
  assert.equal((await f.as(2,()=>f.service.quote(id(2),id(841)))).allowed,true);
 }finally{await f.db.close();}
});

test('billing HTTP requires verified accounts, separate staff proof for registration and server-owned confirmation fields',async()=>{
 const f=await setup();let app;try{
  const {createApp}=require('../dist/app'),{UnauthorizedException,ForbiddenException}=require('@nestjs/common'),{rememberVerifiedSession}=require('../dist/requestIdentity');
  const authenticate=async header=>{const n=header==='Bearer agent'?1:header==='Bearer owner'?2:0;if(!n)throw new UnauthorizedException();
   rememberVerifiedSession({authUserId:id(n),sessionId:id(60+n),expiresAt:Date.now()/1000+300,staff:n===1});return id(n);};
  const account={verify:authenticate},staff={verify:async header=>{if(header!=='Bearer agent')throw new ForbiddenException();return authenticate(header);}};
  app=await createApp(account,{load:async()=>({})},undefined,undefined,undefined,undefined,undefined,undefined,{auth:account,staffAuth:staff,service:f.service});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  assert.equal((await fetch(base+'/v1/billing/payments')).status,401);
  const headers={authorization:'Bearer agent','content-type':'application/json','idempotency-key':id(850)},input=body('REGISTRATION',f.draft.id,1);
  let response=await fetch(base+'/v1/billing/payments',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,200);
  const p=await response.json();assert.equal(p.status,'CREATED');assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/v1/billing/payments',{method:'POST',headers,body:JSON.stringify({...input,status:'COMPLETED'})})).status,400);
  assert.equal((await fetch(base+'/v1/billing/payments',{method:'POST',headers:{...headers,authorization:'Bearer owner'},body:JSON.stringify(input)})).status,403);
  assert.equal((await fetch(base+'/v1/billing/payments/'+p.id,{headers:{authorization:'Bearer owner'}})).status,404);
  assert.equal((await fetch(base+'/v1/billing/reconciliation',{headers})).status,403);
  assert.equal((await fetch(base+'/v1/billing/payments/'+p.id+'/reconcile',{method:'POST',headers,body:'{}'})).status,403);
 }finally{if(app)await app.close();await f.db.close();}
});
