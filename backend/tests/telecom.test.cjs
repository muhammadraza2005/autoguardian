const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {telecomFixture,config,id}=require('./helpers/telecom-fixture.cjs');
const {TelecomCipher,PostgresTelecomStorage,PostgresDispatchStorage,DurableTelecomSender}=require('../dist/telecomStore');
const {AfricasTalkingChannels}=require('../dist/telecomChannels');
const {SupabaseSmsHook,hookSecrets,verifySmsHook}=require('../dist/smsHook');
const {createApp}=require('../dist/app');
const {BillingStore}=require('../dist/billing');
const {PostgresWorkflowStore}=require('../dist/checks');
const fs=require('node:fs/promises'),path=require('node:path');
const type='application/x-www-form-urlencoded',secret=Buffer.alloc(32,7),key=Buffer.alloc(32,9),phone=config.allowedRecipients[0];
const headers=(raw,event='event_1',timestamp=String(Math.floor(Date.now()/1000)))=>({'webhook-id':event,'webhook-timestamp':timestamp,
 'webhook-signature':'v1,'+createHmac('sha256',secret).update(`${event}.${timestamp}.`).update(raw).digest('base64')});
function services(f,send){
 const cipher=new TelecomCipher(key,id(10)),storage=new PostgresTelecomStorage(f.pool,id(10),cipher);
 const sender=new DurableTelecomSender(new PostgresDispatchStorage(f.pool,id(10)),{send},cipher);
 return {cipher,storage,sender,channels:new AfricasTalkingChannels(config,'*384*123#','12345',storage,cipher,sender,()=>Date.now(),()=> '654321')};
}
test('Standard Webhooks signatures bind raw bytes/id/time, reject forgery/stale/future and support key rotation',()=>{
 const raw=Buffer.from('{ "user": {} }');assert.equal(verifySmsHook(raw,headers(raw),[secret]),'event_1');
 const keys=hookSecrets('v1,whsec_'+secret.toString('base64')+'|whsec_'+Buffer.alloc(32,8).toString('base64'));assert.equal(keys.length,2);
 assert.equal(verifySmsHook(raw,headers(raw),keys),'event_1');
 for(const [payload,h] of [[Buffer.from('{}'),headers(raw)],[raw,{...headers(raw),'webhook-id':'another'}],
  [raw,headers(raw,'event',String(Math.floor(Date.now()/1000)-301))],[raw,headers(raw,'event',String(Math.floor(Date.now()/1000)+301))],
  [undefined,headers(raw)],[raw,{...headers(raw),'webhook-signature':'v1,wrong'}]])assert.throws(()=>verifySmsHook(payload,h,keys));
 assert.throws(()=>hookSecrets('placeholder'));
});
test('telecom encryption binds tenant/state key and refuses changed ciphertext',()=>{
 const cipher=new TelecomCipher(key,id(10)),stateKey=cipher.hash('test'),sealed=cipher.seal(stateKey,{phone,code:'654321'});
 assert.equal(sealed.includes(phone),false);assert.deepEqual(cipher.open(stateKey,sealed),{phone,code:'654321'});
 assert.throws(()=>cipher.open(cipher.hash('other'),sealed));assert.throws(()=>new TelecomCipher(key,id(11)).open(stateKey,sealed));
 const bytes=Buffer.from(sealed,'base64');bytes[13]^=1;assert.throws(()=>cipher.open(stateKey,bytes.toString('base64')));
});
test('expired/ended USSD sessions discard challenge intents, while every menu remains within the configured bound',async()=>{
 const f=await telecomFixture();try{
  let now=Date.now(),sends=0;const s=services(f,async()=>({messageId:'ATXid_expiry_'+(++sends),status:'sent',errorCode:''}));
  const channels=new AfricasTalkingChannels(config,'*384*123#','12345',s.storage,s.cipher,s.sender,()=>now,()=> '654321',120);
  const fields={sessionId:'expiry',serviceCode:'*384*123#',phoneNumber:phone};
  const call=text=>channels.ussd(config.gatewayToken,type,{...fields,text});
  for(const text of ['','2','2*654321'])assert.ok((await call(text)).length<=120);
  assert.equal(sends,1);now+=180001;assert.match(await call('2*654321*1'),/^END Session expired/);
  assert.equal(sends,1);
  await channels.event(config.gatewayToken,type,{sessionId:'expiry'});await channels.event(config.gatewayToken,type,{sessionId:'expiry'});
  assert.equal(sends,1);
  assert.throws(()=>new AfricasTalkingChannels(config,'*384*123#','12345',s.storage,s.cipher,s.sender,undefined,undefined,10));
 }finally{await f.db.close();}
});
test('signed OTP hook sends once across replay/restart; payload conflicts, cooldown and unknown sends fail closed',async()=>{
 const f=await telecomFixture();try{
  let calls=0;const send=async input=>{calls++;assert.equal(input.to,phone);assert.ok(input.body.includes('123456'));return {messageId:'ATXid_auth',status:'sent',errorCode:''};};
  let s=services(f,send),hook=new SupabaseSmsHook([secret],config,s.cipher,s.storage,s.sender);
  const raw=Buffer.from(JSON.stringify({user:{id:id(1),phone:phone.slice(1)},sms:{otp:'123456'}}));
  assert.deepEqual(await hook.receive(raw,headers(raw)),{});await hook.receive(raw,headers(raw));assert.equal(calls,1);
  s=services(f,send);hook=new SupabaseSmsHook([secret],config,s.cipher,s.storage,s.sender);await hook.receive(raw,headers(raw));assert.equal(calls,1);
  const changed=Buffer.from(JSON.stringify({user:{id:id(1),phone:phone.slice(1)},sms:{otp:'654321'}}));
  await assert.rejects(hook.receive(changed,headers(changed,'event_2')),e=>e.getResponse().code==='OTP_RESEND_COOLDOWN');
  const other=Buffer.from(JSON.stringify({user:{id:id(2),phone:config.allowedRecipients[1]},sms:{otp:'123456'}}));
  const uncertain=services(f,async()=>{calls++;throw new Error('timeout');});
  const unknown=new SupabaseSmsHook([secret],config,uncertain.cipher,uncertain.storage,uncertain.sender);
  await assert.rejects(unknown.receive(other,headers(other,'event_unknown')));await assert.rejects(unknown.receive(other,headers(other,'event_unknown')));assert.equal(calls,2);
  const audit=JSON.stringify((await f.db.query('select * from private.telecom_dispatches')).rows);assert.equal(audit.includes(phone),false);assert.equal(audit.includes('123456'),false);
 }finally{await f.db.close();}
});
test('USSD OTP, cumulative replay, restart, scoped references and SMS decisions share atomic backend rules',async()=>{
 const f=await telecomFixture();try{
  let sends=0;const send=async()=>({messageId:'ATXid_'+(++sends),status:'sent',errorCode:''});let s=services(f,send);
  const call=(text,sessionId='buyer_session',number=phone)=>s.channels.ussd(config.gatewayToken,type,{sessionId,serviceCode:'*384*123#',phoneNumber:number,text});
  assert.match(await call(''),/^CON/);assert.match(await call('1'),/SMS code/);assert.equal(sends,1);
  assert.match(await call('1'),/SMS code/);assert.equal(sends,1);
  assert.match(await call('1*654321'),/1 Plate/);
  s=services(f,send);assert.match(await call('1*654321*1'),/Enter plate/);
  const reply=await call('1*654321*1*AT-001');assert.match(reply,/^END TEST [A-F0-9]{12}: pending/);
  assert.equal(await call('1*654321*1*AT-001'),reply);
  assert.equal((await f.db.query('select count(*)::int n from private.vehicle_check_requests')).rows[0].n,1);
  const buyerRef=/TEST ([A-F0-9]{12})/.exec(reply)[1];
  const owner=config.allowedRecipients[1];await call('','owner_session',owner);await call('1','owner_session',owner);await call('1*654321','owner_session',owner);
  const inbox=await call('1*654321*6','owner_session',owner);const ownerRef=/TEST: ([A-F0-9]{12})/.exec(inbox)[1];assert.notEqual(ownerRef,buyerRef);
  const inbound=(text,message='sms_decision')=>s.channels.inbound(config.gatewayToken,type,{id:message,from:owner,to:'12345',text});
  await inbound('REFUSE '+ownerRef);await inbound('REFUSE '+ownerRef);
  assert.equal((await f.db.query('select outcome from private.vehicle_check_requests')).rows[0].outcome,'refused');
  assert.equal((await f.db.query('select count(*)::int n from private.vehicle_check_decisions')).rows[0].n,1);
  await inbound('APPROVE '+ownerRef,'sms_late');assert.equal((await f.db.query('select outcome from private.vehicle_check_requests')).rows[0].outcome,'refused');
  await assert.rejects(inbound('REFUSE '+buyerRef),e=>e.getResponse().code==='INBOUND_REPLAY_CONFLICT');
  const raw=JSON.stringify((await f.db.query('select * from private.telecom_state')).rows);assert.equal(raw.includes(phone),false);assert.equal(raw.includes('654321'),false);
 }finally{await f.db.close();}
});
test('gateway forgery, session rebinding, skipped inputs, wrong OTPs, account changes and production gates are rejected',async()=>{
 const f=await telecomFixture();try{
  const s=services(f,async()=>({messageId:'ATXid_challenge',status:'sent',errorCode:''}));
  const body={sessionId:'secure',serviceCode:'*384*123#',phoneNumber:phone,text:''};
  const call=(text,extra={})=>s.channels.ussd(config.gatewayToken,type,{...body,text,...extra});
  await assert.rejects(s.channels.ussd('bad',type,body),e=>e.getStatus()===403);
  await assert.rejects(call('',{serviceCode:'*000#'}),e=>e.getStatus()===400);
  await call('');await assert.rejects(call('',{phoneNumber:config.allowedRecipients[1]}),e=>e.getStatus()===403);
  assert.match(await call('1*654321*1'),/^END Invalid/);await call('1');
  let text='1';for(let i=0;i<5;i++){text+='*000000';const result=await call(text);assert.match(result,i===4?/^END Verification failed/:/^CON Invalid/);}
  // SQL independently requires a verified channel and never exposes private rows.
  await f.db.query("select set_config('autoguardian.tenant_id',$1,false)",[id(10)]);
  const channel=s.cipher.hash(['channel',config.providerAccount,phone]);
  const denied=(await f.db.query("select private.telecom_operation($1,$2,'pending','{}') result",[channel,phone])).rows[0].result;assert.ok(denied.error);
  await f.db.query('select private.telecom_verify_channel($1,$2,$3)',[channel,phone,id(1)]);
  await f.db.exec('update private.vehicle_check_configuration set sample_enabled=false');
  assert.ok((await f.db.query("select private.telecom_operation($1,$2,'pending','{}') result",[channel,phone])).rows[0].result.error);
  await f.db.exec('set role autoguardian_identity_login');
  for(const table of ['telecom_state','telecom_dispatches','telecom_channels','telecom_references'])await assert.rejects(f.db.query(`select * from private.${table}`),e=>e.code==='42501');
  await assert.rejects(f.db.query('select private.telecom_phone_account($1)',[phone]),e=>e.code==='42501');
 }finally{await f.db.close();}
});
test('HTTP hook verifies original JSON bytes and USSD responds as text/plain',async()=>{
 const f=await telecomFixture();let app;try{
  const s=services(f,async()=>({messageId:'ATXid_http',status:'sent',errorCode:''}));
  const hook=new SupabaseSmsHook([secret],config,s.cipher,s.storage,s.sender);
  app=await createApp({verify:async()=>id(1)},{load:async()=>({})},undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{channels:s.channels,hook});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const raw=Buffer.from('{ "user": {"id":"'+id(1)+'", "phone":"'+phone+'"}, "sms":{"otp":"123456"}}');
  const request=()=>fetch(base+'/v1/webhooks/supabase/send-sms',{method:'POST',headers:{'Content-Type':'application/json',...headers(raw)},body:raw});
  assert.equal((await request()).status,200);assert.equal((await request()).status,200);
  const response=await fetch(base+'/v1/webhooks/africastalking/ussd',{method:'POST',headers:{'Content-Type':type,'x-autoguardian-gateway-token':config.gatewayToken},body:new URLSearchParams({sessionId:'http-session',serviceCode:'*384*123#',phoneNumber:phone,text:''})});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/plain/);assert.match(await response.text(),/^CON/);
 }finally{if(app)await app.close();await f.db.close();}
});
test('verified phone channels consume shared sandbox allowance atomically and cannot satisfy staff access',async()=>{
 const f=await telecomFixture();try{
  const billing=new BillingStore(f.pool,id(10));
  await f.as(3,()=>billing.call(id(3),'billing_settings',[{sandboxEnabled:true,currency:'CDF',registrationFee:'1000',checkFee:'1000',renewalFee:'1000',freeMonthly:1,periodDays:30,graceDays:7,reminderDays:3,policyAcknowledged:false},0]));
  const s=services(f,async()=>({messageId:'ATXid_allowance',status:'sent',errorCode:''}));
  await f.db.query("select set_config('autoguardian.tenant_id',$1,false)",[id(10)]);
  const channel=s.cipher.hash(['channel',config.providerAccount,phone]);
  assert.equal((await f.db.query('select private.telecom_verify_channel($1,$2,$3) result',[channel,phone,id(1)])).rows[0].result,true);
  const args={method:'plate',value:'AT-001',key:id(777)};
  const call=async input=>(await f.db.query("select private.telecom_operation($1,$2,'check',$3) result",[channel,phone,JSON.stringify(input)])).rows[0].result;
  const first=await call(args);assert.equal(first.outcome,'pending');assert.equal((await call(args)).id,first.id);
  assert.ok((await call({...args,key:id(778)})).error);
  assert.equal((await f.db.query('select count(*)::int n from private.billing_check_usage')).rows[0].n,1);
  assert.equal((await f.db.query('select private.access_session_valid(true) valid')).rows[0].valid,false);
  await f.db.exec('alter table auth.users add column banned_until timestamptz');
  await f.db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[id(1)]);
  assert.ok((await call(args)).error);
 }finally{await f.db.close();}
});
test('telecom verifier confirms forced RLS, grants and migration privileges remain restricted',async()=>{
 const f=await telecomFixture();try{
  const checks=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-africastalking-telecom.sql'),'utf8'))).rows[0];
  assert.ok(Object.values(checks).every(v=>v===true),JSON.stringify(checks));
  const workflows=new PostgresWorkflowStore(f.pool,id(10));
  const health=await f.as(3,()=>workflows.call(id(3),'telecom_health',[]));
  assert.deepEqual(health.smsQueue,{});assert.equal(health.activeVerifiedChannels,0);
  assert.equal(JSON.stringify(health).includes(phone),false);
  await assert.rejects(f.as(1,()=>workflows.call(id(1),'telecom_health',[])),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
