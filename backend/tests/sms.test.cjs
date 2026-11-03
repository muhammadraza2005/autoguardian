const {test}=require('node:test'),assert=require('node:assert/strict');
const {telecomFixture,config,id}=require('./helpers/telecom-fixture.cjs');
const {AfricasTalkingSmsProvider,AfricasTalkingSmsWebhooks,smsConfiguration,SmsDispatcher,PostgresSmsStore,smsPhoneHash,sendFailure}=require('../dist/sms');
const {createApp}=require('../dist/app');
const phone=config.allowedRecipients[1],messageId='ATXid_opaque-123';
const env={AFRICASTALKING_SMS_ENABLED:'true',AFRICASTALKING_ENVIRONMENT:'sandbox',AFRICASTALKING_USERNAME:'sandbox',AFRICASTALKING_API_KEY:config.apiKey,
 AFRICASTALKING_SENDER_ID:'TEST',AFRICASTALKING_GATEWAY_TOKEN:config.gatewayToken,AFRICASTALKING_TEST_RECIPIENTS_JSON:JSON.stringify(config.allowedRecipients)};
test('Africa Talking configuration is opt-in, validates environments, private sender and controlled recipients',()=>{
 assert.equal(smsConfiguration({}),undefined);assert.deepEqual(smsConfiguration(env),config);
 for(const changed of [{AFRICASTALKING_ENVIRONMENT:'wrong'},{AFRICASTALKING_USERNAME:'live'},
  {AFRICASTALKING_GATEWAY_TOKEN:'short'},{AFRICASTALKING_API_KEY:''},{AFRICASTALKING_TEST_RECIPIENTS_JSON:'[]'},
  {AFRICASTALKING_TEST_RECIPIENTS_JSON:'["24312345"]'},{AFRICASTALKING_SMS_ENABLED:'yes'},
  {AFRICASTALKING_ENVIRONMENT:'production',AFRICASTALKING_USERNAME:'client'}])assert.throws(()=>smsConfiguration({...env,...changed}));
 const live=smsConfiguration({...env,AFRICASTALKING_ENVIRONMENT:'production',AFRICASTALKING_USERNAME:'client',AFRICASTALKING_PRODUCTION_APPROVED:'true'});
 assert.equal(live.providerAccount,'at:production:client');
});
test('HTTP transport sends once, maps each accepted status, rejects wrong recipients and quarantines malformed/5xx results',async()=>{
 for(const status of [100,101,102]){
  let calls=0;const provider=new AfricasTalkingSmsProvider(config,async(url,request)=>{
   calls++;assert.equal(url,'https://api.sandbox.africastalking.com/version1/messaging');assert.equal(request.headers.apiKey,config.apiKey);
   const body=request.body;assert.equal(body.get('to'),phone);assert.equal(body.get('from'),'TEST');assert.equal(body.get('username'),'sandbox');
   assert.equal(body.has('statusCallback'),false);assert.equal(request.redirect,'error');
   return new Response(JSON.stringify({SMSMessageData:{Recipients:[{number:phone,messageId,statusCode:status}]}}),{status:201});
  });
  assert.deepEqual(await provider.send({to:phone,body:'TEST',validityPeriod:60}),{messageId,status:status===101?'sent':status===102?'queued':'accepted',errorCode:''});assert.equal(calls,1);
 }
 for(const [row,mode] of [[{number:phone,messageId,statusCode:405},'failed'],[{number:phone,messageId,statusCode:500},'unknown'],
  [{number:phone,messageId,statusCode:101},'sent'],[{number:'+243000000009',messageId,statusCode:101},'unknown'],[{number:phone,statusCode:101},'unknown']]){
  const provider=new AfricasTalkingSmsProvider(config,async()=>new Response(JSON.stringify({SMSMessageData:{Recipients:[row]}})));
  try{await provider.send({to:phone,body:'TEST',validityPeriod:60});assert.equal(mode,'sent');}catch(e){assert.equal(sendFailure(e).mode,mode);}
 }
 for(const status of [429,400,503]){
  const provider=new AfricasTalkingSmsProvider(config,async()=>new Response('',{status}));
  await assert.rejects(provider.send({to:phone,body:'TEST',validityPeriod:60}),e=>sendFailure(e).mode===(status===429?'rate_limited':status===400?'failed':'unknown'));
 }
});
test('AT delivery receipts reconcile early arrival, deduplicate, preserve terminal state and enforce account/recipient scope',async()=>{
 const f=await telecomFixture();try{
  const request=await f.create(),job=await f.claim();assert.equal(job.kind,'owner_request');
  await f.store.delivery(config.providerAccount,messageId,phone,'delivered','');
  await f.store.delivery(config.providerAccount,messageId,phone,'delivered','');
  assert.equal((await f.db.query('select count(*)::int n from private.sms_unmatched_receipts')).rows[0].n,1);
  await f.store.submitted(job.attemptId,messageId,'sent','');
  await f.store.delivery(config.providerAccount,messageId,phone,'sent','');
  await f.store.delivery(config.providerAccount,messageId,phone,'failed','AT_DELIVERY_FAILED');
  assert.equal((await f.db.query('select delivery_status from private.vehicle_check_notifications where id=$1',[job.notificationId])).rows[0].delivery_status,'delivered');
  assert.equal((await f.db.query('select outcome from private.vehicle_check_requests where id=$1',[request])).rows[0].outcome,'pending');
  assert.equal((await f.db.query('select count(*)::int n from private.sms_unmatched_receipts')).rows[0].n,0);
  await assert.rejects(f.store.delivery(config.providerAccount,messageId,'+243000000009','sent',''),e=>e.code==='42501');
  await assert.rejects(new PostgresSmsStore(f.pool,id(999)).delivery(config.providerAccount,messageId,phone,'sent',''),e=>e.code==='42501');
  const state=JSON.stringify((await f.db.query('select * from private.sms_notification_attempts')).rows);
  assert.equal(state.includes(phone),false);assert.equal(state.includes(config.apiKey),false);
 }finally{await f.db.close();}
});
test('persisted retries are bounded, unknown sends never resend and persistence failure terminates batch',async()=>{
 const f=await telecomFixture();try{
  await f.create();let calls=0;
  const dispatcher=new SmsDispatcher(f.store,{send:async()=>{calls++;throw {status:429,code:'PROVIDER_RATE_LIMIT'};}},config);
  for(let i=1;i<=3;i++){
   assert.equal(await dispatcher.drain(1),1);assert.equal(await dispatcher.drain(1),0);
   const n=(await f.db.query('select * from private.vehicle_check_notifications')).rows[0];
   assert.equal(n.attempts,i);assert.equal(n.delivery_status,i<3?'queued':'failed');
   if(i<3){const delay=(await f.db.query('select extract(epoch from n.available_at-a.updated_at)::integer s from private.vehicle_check_notifications n join private.sms_notification_attempts a on a.notification_id=n.id where a.attempt_number=$1',[i])).rows[0].s;assert.equal(delay,30*2**(i-1));
    await f.db.exec('update private.vehicle_check_notifications set available_at=now()');}
  }assert.equal(calls,3);
  await f.create(702);const unknown=new SmsDispatcher(f.store,{send:async()=>{throw new Error('network timeout');}},config);
  await unknown.drain(1);assert.equal(await unknown.drain(1),0);
  const stale=(await f.db.query("select * from private.sms_notification_attempts where state='unknown'")).rows[0];assert.ok(stale);
  const job={phone,attemptId:id(900),kind:'buyer_result',sampleOnly:true,language:'en'};let sends=0,errors=0;
  await assert.rejects(new SmsDispatcher({claim:async()=>job,submitted:async()=>{throw new Error('DB down');},sendError:async()=>errors++},
   {send:async()=>{sends++;return {messageId,status:'sent',errorCode:''};}},config).drain(),/DB down/);
  assert.equal(sends,1);assert.equal(errors,0);
 }finally{await f.db.close();}
});
test('HTTP delivery route requires trusted ingress, validates form/query, keeps old Twilio route absent',async()=>{
 const f=await telecomFixture();let app;try{
  await f.create();const job=await f.claim();await f.store.submitted(job.attemptId,messageId,'sent','');
  app=await createApp({verify:async()=>{throw new Error('App auth not used');}},{load:async()=>({})},undefined,undefined,undefined,undefined,new AfricasTalkingSmsWebhooks(f.store,config));
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),route='/v1/webhooks/africastalking/sms/delivery';
  const fields={id:messageId,phoneNumber:phone,status:'Success'};
  const send=(token=config.gatewayToken,body=new URLSearchParams(fields),suffix='',type='application/x-www-form-urlencoded')=>fetch(base+route+suffix,{method:'POST',headers:{'Content-Type':type,'x-autoguardian-gateway-token':token},body});
  assert.equal((await send('bad')).status,403);assert.equal((await send(config.gatewayToken,undefined,'?x=1')).status,400);
  const duplicate=new URLSearchParams(fields);duplicate.append('status','Failed');assert.equal((await send(config.gatewayToken,duplicate)).status,400);
  assert.equal((await send(config.gatewayToken,JSON.stringify(fields),'','application/json')).status,400);
  const ok=await send();assert.equal(ok.status,204);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal((await send()).status,204);
  assert.equal((await fetch(base+'/v1/webhooks/twilio/sms/test/test',{method:'POST'})).status,404);
 }finally{if(app)await app.close();await f.db.close();}
});
test('unverified phones, stale notifications and unapproved recipients cannot be dispatched',async()=>{
 const f=await telecomFixture();try{
  await f.create();assert.equal(await f.store.claim(config.providerAccount,[smsPhoneHash('+243000000009')]),null);
  await f.create(702);await f.db.query('update auth.users set phone_confirmed_at=null where id=$1',[id(2)]);assert.equal(await f.claim(),null);
  await f.db.exec('update auth.users set phone_confirmed_at=now()');const request=await f.create(703);
  await f.db.query("update private.vehicle_check_requests set created_at=now()-interval '1 hour',response_deadline_at=now()-interval '1 minute' where id=$1",[request]);assert.equal(await f.claim(),null);
 }finally{await f.db.close();}
});
