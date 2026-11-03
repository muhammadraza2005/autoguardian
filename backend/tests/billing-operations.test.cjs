const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,id}=require('./helpers/production-seal-fixture.cjs');
const {BillingStore,BillingService}=require('../dist/billing');
const {billingPolicy,settlementInput}=require('../dist/billingPolicy');
const {pawaPayProductionConfiguration,PawaPayProductionClient}=require('../dist/pawaPayClient');
const prices={sandboxEnabled:true,currency:'CDF',registrationFee:'1000',checkFee:'1000',renewalFee:'1000',freeMonthly:0,periodDays:30,graceDays:7,reminderDays:3,policyAcknowledged:false};
const policy={productionEnabled:true,billingRevision:1,approvalReference:'SYNTHETIC TEST APPROVAL',receiptValidityDays:30,graceAccess:false,
 protectedFeatures:['institutional_lock'],smsEnabled:true,smsEn:'Synthetic renewal reminder',smsFr:'Rappel synthetique',
 receiptIdentity:{businessName:'Synthetic test business',address:'Test address',registrationNumber:'TEST-ONLY'},offlineEnabled:true,offlineHours:2};
async function setup(){
 const f=await fixture(),store=new BillingStore(f.pool,id(10)),key=Buffer.alloc(32,8),statuses=new Map();
 const provider={depositStatus:async ref=>statuses.get(ref),initiateDeposit:async d=>{statuses.set(d.depositId,{...d,country:'COD',status:'COMPLETED',providerTransactionId:'TEST-REF'});return {status:'ACCEPTED',depositId:d.depositId};}};
 const service=new BillingService(store,key,provider,true),sandbox=new BillingService(store,Buffer.alloc(32,7),provider);
 await f.as(3,()=>sandbox.settings(id(3),prices,0));
 await f.as(3,()=>store.call(id(3),'billing_policy',[billingPolicy(policy),0]));
 await f.db.exec(`update auth.users set phone='243813456789',phone_confirmed_at=now();
 insert into app.vehicles(id,tenant_id,chassis_identifier,category,record_status) values('${id(501)}','${id(10)}','BILLING-OPS','CAR','ACTIVE');
 insert into app.ownerships(tenant_id,vehicle_id,owner_id,source) values('${id(10)}','${id(501)}','${id(40)}','TEST');`);
 return {...f,store,service,sandbox,statuses};
}
const input=(purpose,targetId,targetRevision=0)=>({purpose,targetId,targetRevision,phoneNumber:'243813456789',provider:'VODACOM_MPESA_COD'});

test('live payments satisfy only the current production registration snapshot and sandbox cannot claim them',async()=>{
 const f=await setup();try{
  const p=await f.as(1,()=>f.service.begin(id(1),id(1001),input('REGISTRATION',f.draft.id,1))).catch(e=>{throw e.cause??e;});
  assert.equal(p.sampleOnly,false);assert.equal(await f.sandbox.processOne(p.id),false);
  await f.service.processOne(p.id).catch(e=>{throw new Error((e.cause?.message??e.message)+' '+(e.cause?.where??''));});
  const receipt=(await f.db.query("select * from private.enrollment_prerequisite_receipts where code='PAYMENT'")).rows[0];
  assert.equal(receipt.snapshot_revision,1);assert.equal(receipt.trusted_reference,'pawapay-live:'+p.id);
  assert.equal(receipt.draft_revision,1);assert.equal(receipt.fitting_revision,0);
  const confirmed=await f.as(1,()=>f.service.read(id(1),p.id));assert.equal(confirmed.status,'COMPLETED');
  assert.deepEqual(confirmed.receiptIdentity,policy.receiptIdentity);
  assert.equal(await f.service.processOne(p.id),false);
  await assert.rejects(f.as(2,()=>f.service.read(id(2),p.id)),e=>e.getStatus()===404);
  await f.db.exec('set role autoguardian_identity_login');
  await assert.rejects(f.db.query('select private.billing_live_finish($1,$2,$3,$4,$5,$6)',[p.id,id(1010),'COMPLETED','1000','CDF','FORGED']),e=>e.code==='42501');
  await assert.rejects(f.db.query('select * from private.live_billing_payments'),e=>e.code==='42501');
  await f.db.exec('reset role');
  const fs=require('node:fs'),path=require('node:path');
  const checks=(await f.db.query(fs.readFileSync(path.resolve(__dirname,'../../supabase/verify-billing-operations.sql'),'utf8'))).rows[0];
  assert.ok(Object.values(checks).every(v=>v===true),JSON.stringify(checks));
 }finally{await f.db.close();}
});
test('changed registration snapshots stay paid but cannot unlock the edited draft',async()=>{
 const f=await setup();try{
  const p=await f.as(1,()=>f.service.begin(id(1),id(1002),input('REGISTRATION',f.draft.id,1)));
  await f.as(1,()=>f.drafts.save(id(1),{...f.input,expectedRevision:1},f.draft.id));await f.service.processOne(p.id);
  assert.equal((await f.db.query("select count(*)::int n from private.enrollment_prerequisite_receipts where code='PAYMENT'")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from private.billing_operations_audit where action='REGISTRATION_PAYMENT_STALE'")).rows[0].n,1);
 }finally{await f.db.close();}
});
test('production policy is revisioned, MFA controlled and revocation prevents new provider initiation',async()=>{
 const f=await setup();try{
  await assert.rejects(f.as(1,()=>f.store.call(id(1),'billing_policy',[policy,1])),e=>e.getStatus()===403);
  await assert.rejects(f.as(3,()=>f.store.call(id(3),'billing_policy',[{...policy,offlineHours:null},1])),e=>e.getStatus()===400);
  const p=await f.as(2,()=>f.service.begin(id(2),id(1003),input('SUBSCRIPTION',id(501))));
  await f.as(3,()=>f.store.call(id(3),'billing_policy',[{...policy,productionEnabled:false},1]));
  await f.service.processOne(p.id);assert.equal(f.statuses.size,0);
  assert.equal((await f.as(2,()=>f.service.read(id(2),p.id))).status,'PROCESSING');
  await assert.rejects(f.as(3,()=>f.store.call(id(3),'billing_policy',[policy,1])),e=>e.getStatus()===409);
 }finally{await f.db.close();}
});
test('production renewals enforce approved access through grace and suspension without changing vehicle protection',async()=>{
 const f=await setup();try{
  const p=await f.as(2,()=>f.service.begin(id(2),id(1004),input('SUBSCRIPTION',id(501))));await f.service.processOne(p.id);
  const entitlement=()=>f.as(2,()=>f.store.call(id(2),'billing_live_entitlement',[id(501),'institutional_lock']));
  assert.equal((await entitlement()).allowed,true);
  await f.db.exec("update private.live_billing_subscriptions set expires_at=now()-interval '1 minute',grace_until=now()+interval '1 day',remind_at=now()-interval '2 days';");
  await f.service.sweep();assert.equal((await entitlement()).allowed,false);
  assert.equal((await entitlement()).state,'GRACE');
  await f.as(3,()=>f.store.call(id(3),'billing_policy',[{...policy,graceAccess:true},1]));assert.equal((await entitlement()).allowed,true);
  await f.db.exec("update private.live_billing_subscriptions set grace_until=now()-interval '1 second';");await f.service.sweep();
  assert.equal((await entitlement()).state,'SUSPENDED');assert.equal((await entitlement()).allowed,false);
  assert.equal((await f.db.query('select record_status from app.vehicles')).rows[0].record_status,'ACTIVE');
  const j=await f.store.call('','billing_sms_claim',[['+243813456789']],true);assert.ok(j);assert.equal(j.body,policy.smsEn);
  await f.store.call('','billing_sms_finish',[j.id,j.leaseId,'UNKNOWN',null],true);
  assert.equal(await f.store.call('','billing_sms_claim',[['+243813456789']],true),null);
  await f.db.exec("begin; update app.vehicles set record_status='BLOCKED'; update app.ownerships set end_at=now(); commit;");
  await assert.rejects(entitlement(),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
test('settlement import detects mismatches, survives exact retries and cannot turn an unpaid transaction into a paid one',async()=>{
 const f=await setup();try{
  const p=await f.as(2,()=>f.service.begin(id(2),id(1005),input('SUBSCRIPTION',id(501))));
  const body=settlementInput({sourceReference:'SYNTHETIC STATEMENT',items:[{depositId:p.id,amount:'1000',currency:'CDF',status:'COMPLETED',providerReference:'TEST-REF'}]});
  const run=b=>f.as(3,()=>f.store.call(id(3),'billing_settlement',[b]));
  assert.equal((await run(body)).items[0].result,'STATUS');assert.deepEqual(await run(body),await run(body));
  await assert.rejects(run({...body,items:[{...body.items[0],amount:'1'}]}),e=>e.getStatus()===409);
  assert.equal((await f.as(2,()=>f.service.read(id(2),p.id))).status,'CREATED');
  await f.service.processOne(p.id);
  assert.equal((await run({...body,sourceReference:'SECOND TEST'})).items[0].result,'MATCHED');
  await assert.rejects(f.as(2,()=>f.store.call(id(2),'billing_settlement',[body])),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
test('offline lease requires current MFA accreditation and an approved bounded policy',async()=>{
 const f=await setup();try{
  const lease=await f.as(1,()=>f.store.call(id(1),'billing_offline_lease',[]));
  assert.equal(lease.readOnly,true);assert.equal(lease.authUserId,id(1));assert.equal(lease.actorId,id(21));
  assert.equal(Date.parse(lease.expiresAt)-Date.parse(lease.issuedAt),7200000);
  await assert.rejects(f.as(2,()=>f.store.call(id(2),'billing_offline_lease',[])),e=>e.getStatus()===403);
  await f.db.exec("update app.agent_accreditations set status='SUSPENDED';");
  await assert.rejects(f.as(1,()=>f.store.call(id(1),'billing_offline_lease',[])),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
test('live configuration stays off by default, rejects sandbox credentials and fixes the production origin',async()=>{
 assert.equal(pawaPayProductionConfiguration({}),undefined);
 assert.throws(()=>pawaPayProductionConfiguration({PAWAPAY_PRODUCTION_ENABLED:'true'}));
 assert.throws(()=>pawaPayProductionConfiguration({PAWAPAY_PRODUCTION_ENABLED:'true',PAWAPAY_PRODUCTION_APPROVED:'true',PAWAPAY_LIVE_BASE_URL:'https://api.pawapay.io',PAWAPAY_LIVE_API_TOKEN:'same',PAWAPAY_API_TOKEN:'same'}));
 let called;const client=new PawaPayProductionClient({token:'test-live-token'},async(url,opts)=>{called={url,opts};return new Response(JSON.stringify({status:'NOT_FOUND'}));});
 assert.equal(await client.depositStatus(id(1009)),undefined);assert.equal(called.url,'https://api.pawapay.io/v2/deposits/'+id(1009));assert.equal(called.opts.redirect,'error');
 assert.throws(()=>billingPolicy({...policy,offlineHours:100}));assert.throws(()=>billingPolicy({...policy,protectedFeatures:['owner_alerts']}));
});

test('SMS reminder dispatch persists provider acceptance and quarantines ambiguous sends without duplicates',async()=>{
 const {BillingReminderDispatcher}=require('../dist/billingReminders');
 const f=await setup();try{
  const p=await f.as(2,()=>f.service.begin(id(2),id(1011),input('SUBSCRIPTION',id(501))));await f.service.processOne(p.id);
  await f.db.exec("update private.live_billing_subscriptions set remind_at=now()-interval '1 day';");await f.service.sweep();
  let sent=0;const provider={send:async job=>{sent++;assert.equal(job.to,'+243813456789');assert.equal(job.body,policy.smsEn);return {messageId:'ATXid_billing_test',status:'queued',errorCode:''};}};
  const dispatcher=new BillingReminderDispatcher(f.store,provider,{allowedRecipients:['+243813456789']});
  assert.equal(await dispatcher.drain(),1);assert.equal(await dispatcher.drain(),0);assert.equal(sent,1);
  assert.equal((await f.db.query('select status from private.billing_sms_outbox')).rows[0].status,'SUBMITTED');
  const renewal=await f.as(2,()=>f.service.begin(id(2),id(1012),input('SUBSCRIPTION',id(501))));await f.service.processOne(renewal.id);
  await f.db.exec("update private.live_billing_subscriptions set remind_at=now()-interval '1 day';");await f.service.sweep();
  const unknown=new BillingReminderDispatcher(f.store,{send:async()=>{sent++;throw new Error('Network outcome unknown');}},{allowedRecipients:['+243813456789']});
  assert.equal(await unknown.drain(),1);assert.equal(await unknown.drain(),0);assert.equal(sent,2);
  assert.deepEqual((await f.db.query('select status from private.billing_sms_outbox order by created_at')).rows.map(r=>r.status),['SUBMITTED','UNKNOWN']);
  const other=new BillingStore(f.pool,id(999));await assert.rejects(f.as(2,()=>other.call(id(2),'billing_live_read',[p.id,false])),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
test('billing operations HTTP authenticates, rejects forged confirmations and keeps production endpoints disabled without live configuration',async()=>{
 const f=await setup();let app;try{
  const {createApp}=require('../dist/app'),{UnauthorizedException}=require('@nestjs/common'),{rememberVerifiedSession}=require('../dist/requestIdentity');
  const auth={verify:async h=>{const n=h==='Bearer admin'?3:h==='Bearer agent'?1:0;if(!n)throw new UnauthorizedException();
   rememberVerifiedSession({authUserId:id(n),sessionId:id(60+n),expiresAt:Date.now()/1000+300,staff:true});return id(n);}};
  app=await createApp(auth,{load:async()=>({})},undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{auth,staffAuth:auth,store:f.store});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  assert.equal((await fetch(base+'/v1/billing/operations/policy')).status,401);
  assert.equal((await fetch(base+'/v1/billing/live/payments',{headers:{authorization:'Bearer admin'}})).status,404);
  const response=await fetch(base+'/v1/billing/operations/policy',{headers:{authorization:'Bearer admin'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await response.json()).revision,1);
  assert.equal((await fetch(base+'/v1/billing/operations/policy',{method:'PUT',headers:{authorization:'Bearer agent','content-type':'application/json'},body:JSON.stringify({expectedRevision:1,policy})})).status,403);
  assert.equal((await fetch(base+'/v1/billing/operations/offline-lease',{method:'POST',headers:{authorization:'Bearer agent','content-type':'application/json'},body:JSON.stringify({readOnly:false})})).status,400);
 }finally{if(app)await app.close();await f.db.close();}
});
