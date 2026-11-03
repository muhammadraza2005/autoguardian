const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {telecomFixture,id,config}=require('./helpers/telecom-fixture.cjs');
const {OwnerPinStore,OwnerPinService,hashOwnerPin,verifyOwnerPin,pinPolicy}=require('../dist/ownerPin');
const {TelecomCipher,DurableTelecomSender,PostgresDispatchStorage,PostgresTelecomStorage}=require('../dist/telecomStore');
const {AfricasTalkingChannels}=require('../dist/telecomChannels');
const {CheckService,PostgresWorkflowStore,ReportEvidenceService}=require('../dist/checks');
const {createApp}=require('../dist/app');
const policy={enabled:true,maxAttempts:3,lockSeconds:60,proofSeconds:60,approvalReference:'SYNTHETIC POLICY FOR TESTS'};
async function setup(){
 const f=await telecomFixture(),store=new OwnerPinStore(f.pool,id(10)),cipher=new TelecomCipher(Buffer.alloc(32,5),id(10));
 let sends=0;const sender=new DurableTelecomSender(new PostgresDispatchStorage(f.pool,id(10)),{send:async input=>{sends++;assert.equal(input.to,config.allowedRecipients[1]);return {messageId:'ATXid_pin_'+sends,status:'sent',errorCode:''};}},cipher);
 const pin=new OwnerPinService(store,cipher,sender,()=> '654321'),checks=new CheckService(new PostgresWorkflowStore(f.pool,id(10)));
 const enable=()=>f.as(3,()=>store.call(id(3),'owner_pin_settings',[policy]));
 const enroll=()=>f.as(2,()=>pin.enroll(id(2),{pin:'142536'}));
 const confirm=challengeId=>f.as(2,()=>pin.confirm(id(2),{challengeId,code:'654321'}));
 return {...f,store,pin,checks,enable,enroll,confirm,cipher,sender,sends:()=>sends};
}
test('PIN hashing uses independent salts and adaptive scrypt; input/policy fields are strict',async()=>{
 const a=await hashOwnerPin('142536'),b=await hashOwnerPin('142536');assert.notEqual(a,b);assert.match(a,/^scrypt-v1:/);
 assert.equal(await verifyOwnerPin('142536',a),true);assert.equal(await verifyOwnerPin('142537',a),false);
 for(const value of ['123',123456,'1234567','12ab'])await assert.rejects(hashOwnerPin(value));
 assert.deepEqual(pinPolicy(policy),policy);assert.throws(()=>pinPolicy({...policy,maxAttempts:0}));assert.throws(()=>pinPolicy({...policy,extra:true}));
});
test('PIN enrollment is OTP/session/account bound and raw PIN or hash never leaves its API response',async()=>{
 const f=await setup();try{
  await assert.rejects(f.enroll(),e=>e.getResponse().code==='PIN_POLICY_OR_RECOVERY_REQUIRED');
  await assert.rejects(f.as(1,()=>f.store.call(id(1),'owner_pin_settings',[policy])),e=>e.getStatus()===403);
  await f.enable();const challenge=await f.enroll();assert.deepEqual(Object.keys(challenge),['challengeId']);assert.equal(f.sends(),1);
  await assert.rejects(f.as(2,()=>f.pin.confirm(id(2),{challengeId:challenge.challengeId,code:'000000'})),e=>e.getStatus()===403);
  assert.equal((await f.db.query('select attempts from private.owner_pin_enrollments')).rows[0].attempts,1);
  await assert.rejects(f.as(1,()=>f.pin.confirm(id(1),{challengeId:challenge.challengeId,code:'654321'})),e=>e.getStatus()===403);
  assert.deepEqual(await f.confirm(challenge.challengeId),{configured:true});await assert.rejects(f.confirm(challenge.challengeId));
  assert.equal((await f.as(2,()=>f.pin.status(id(2)))).configured,true);await assert.rejects(f.enroll(),e=>e.getResponse().code==='PIN_POLICY_OR_RECOVERY_REQUIRED');
  const stored=(await f.db.query('select credential from private.owner_pin_credentials')).rows[0].credential;assert.equal(stored.includes('142536'),false);
  await f.db.exec('set role autoguardian_identity_login');await assert.rejects(f.db.query('select * from private.owner_pin_credentials'),e=>e.code==='42501');
  await assert.rejects(f.db.query('select private.owner_pin_actor()'),e=>e.code==='42501');
 }finally{await f.db.close();}
});
test('request/decision/session-bound PIN proof is one-use and cannot be bypassed by the original decision operation',async()=>{
 const f=await setup();try{
  await f.enable();await f.confirm((await f.enroll()).challengeId);const request=await f.create();
  const decide=(decision,proof)=>f.as(2,()=>f.checks.decide(id(2),request,decision,proof));
  await assert.rejects(decide('approved'),e=>e.getStatus()===403);
  const result=await f.as(2,()=>f.pin.proof(id(2),{requestId:request,decision:'approved',pin:'142536'}));
  assert.match(result.proof,/^[a-f0-9]{64}$/);await assert.rejects(decide('refused',result.proof),e=>e.getStatus()===403);
  assert.equal((await f.db.query('select used from private.owner_pin_proofs')).rows[0].used,false);
  await decide('approved',result.proof);await assert.rejects(decide('approved',result.proof),e=>e.getStatus()===403);
  const row=(await f.db.query('select proof_hash,used from private.owner_pin_proofs')).rows[0];assert.equal(row.used,true);assert.equal(row.proof_hash,createHash('sha256').update(result.proof).digest('hex'));
  assert.equal((await f.db.query('select count(*)::int n from private.vehicle_check_decisions')).rows[0].n,1);
  await f.db.exec('set role autoguardian_identity_login');await assert.rejects(f.db.query('select private.decide_vehicle_check_without_pin($1,$2)',[request,'approved']),e=>e.code==='42501');
 }finally{await f.db.close();}
});
test('incorrect PIN attempts lock persistently; expired proof, revoked sessions and changed phones fail closed',async()=>{
 const f=await setup();try{
  await f.enable();await f.confirm((await f.enroll()).challengeId);const request=await f.create();
  const prove=pin=>f.as(2,()=>f.pin.proof(id(2),{requestId:request,decision:'refused',pin}));
  for(let i=0;i<3;i++)await assert.rejects(prove('000000'),e=>e.getStatus()===403);
  await assert.rejects(prove('142536'),e=>e.getResponse().code==='PIN_VERIFICATION_UNAVAILABLE');
  await f.db.exec("update private.owner_pin_credentials set locked_until=now()-interval '1 second'");
  const proof=await prove('142536');await f.db.exec("update private.owner_pin_proofs set expires_at=now()-interval '1 second'");
  await assert.rejects(f.as(2,()=>f.checks.decide(id(2),request,'refused',proof.proof)),e=>e.getStatus()===403);
  const fresh=await prove('142536');await f.db.query("update auth.users set phone='243000000009' where id=$1",[id(2)]);
  assert.equal((await f.as(2,()=>f.pin.status(id(2)))).phoneCurrent,false);
  await assert.rejects(f.as(2,()=>f.checks.decide(id(2),request,'refused',fresh.proof)),e=>e.getStatus()===403);await assert.rejects(prove('142536'));
  await f.db.query('delete from auth.sessions where id=$1',[id(62)]);await assert.rejects(f.as(2,()=>f.pin.status(id(2))),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
test('sale-status PIN proof binds vehicle, idempotency key, statuses and reason without granting seller mandates',async()=>{
 const f=await setup();try{
  await f.enable();await f.confirm((await f.enroll()).challengeId);
  const input={vehicleId:id(501),requestKey:id(850),expectedStatus:'NOT_FOR_SALE',saleStatus:'FOR_SALE',reason:'Synthetic sale listing',pin:'142536'};
  const change=(reason,proof)=>f.as(2,()=>f.checks.store.call(id(2),'change_vehicle_sale',[input.vehicleId,input.requestKey,input.expectedStatus,input.saleStatus,reason],proof));
  await assert.rejects(change(input.reason),e=>e.getStatus()===403);
  const result=await f.as(2,()=>f.pin.proof(id(2),input));assert.equal(result.action,'sale_status');
  await assert.rejects(change('Changed reason',result.proof),e=>e.getStatus()===403);
  assert.equal((await change(input.reason,result.proof)).saleStatus,'FOR_SALE');
  await assert.rejects(change(input.reason,result.proof),e=>e.getStatus()===403);
  assert.equal((await f.db.query('select used from private.owner_pin_sale_proofs')).rows[0].used,true);
 }finally{await f.db.close();}
});
test('PIN endpoints authenticate, never accept client-generated proof receipts and stay absent when disabled',async()=>{
 const f=await setup();let app;try{
  const {identityRequest,rememberVerifiedSession}=require('../dist/requestIdentity');
  const auth={verify:async h=>{if(h!=='Bearer owner')throw new (require('@nestjs/common').UnauthorizedException)();rememberVerifiedSession({authUserId:id(2),sessionId:id(62),expiresAt:Date.now()/1000+300,staff:false});return id(2);}};
  app=await createApp(auth,{load:async()=>({})},undefined,undefined,undefined,undefined,undefined,{auth,staffAuth:auth,checks:f.checks,evidence:new ReportEvidenceService(f.checks.store)},undefined,undefined,undefined,{pin:f.pin});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  assert.equal((await fetch(base+'/v1/me/owner-pin')).status,401);
  const response=await fetch(base+'/v1/me/owner-pin',{headers:{authorization:'Bearer owner'}});assert.equal(response.status,200);assert.equal((await response.json()).configured,false);
  assert.equal((await fetch(base+'/v1/me/owner-pin/confirm',{method:'POST',headers:{authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({challengeId:id(800),code:'654321',configured:true})})).status,400);
 }finally{if(app)await app.close();await f.db.close();}
});
test('PIN verifier confirms private storage, helper denial and legacy gate protection',async()=>{
 const f=await setup();try{
  const fs=require('node:fs/promises'),path=require('node:path');
  const checks=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-owner-pin.sql'),'utf8'))).rows[0];
  assert.ok(Object.values(checks).every(v=>v===true),JSON.stringify(checks));
 }finally{await f.db.close();}
});
test('USSD OTP plus PIN confirms one selected request, while ordinary SMS cannot carry or bypass the PIN',async()=>{
 const f=await setup();try{
  await f.enable();await f.confirm((await f.enroll()).challengeId);const request=await f.create();
  const storage=new PostgresTelecomStorage(f.pool,id(10),f.cipher);
  let now=Date.now();const channels=new AfricasTalkingChannels(config,'*384*123#','12345',storage,f.cipher,f.sender,()=>now,()=> '654321',160,true);
  const owner=config.allowedRecipients[1],type='application/x-www-form-urlencoded';
  const call=(text,sessionId='pin-inbox')=>channels.ussd(config.gatewayToken,type,{phoneNumber:owner,serviceCode:'*384*123#',sessionId,text});
  await call('');await call('1');await call('1*654321');const inbox=await call('1*654321*6');
  const reference=/TEST: ([A-F0-9]{12})/.exec(inbox)[1];
  // Read the request reference independently; SMS never accepts a plaintext PIN.
  await channels.inbound(config.gatewayToken,type,{id:'pin-sms',from:owner,to:'12345',text:'APPROVE '+reference});
  assert.equal((await f.db.query('select outcome from private.vehicle_check_requests where id=$1',[request])).rows[0].outcome,'pending');
  // Redial after the documented OTP-send cooldown, with a new verified session.
  now+=61000;
  await call('','pin-answer');await call('1','pin-answer');await call('1*654321','pin-answer');
  await call('1*654321*4','pin-answer');assert.match(await call('1*654321*4*'+reference,'pin-answer'),/^CON Enter your 4-6 digit/);
  const wrong='1*654321*4*'+reference+'*000000';assert.match(await call(wrong,'pin-answer'),/^CON Invalid PIN/);
  const final=await call(wrong+'*142536','pin-answer');assert.match(final,/^END TEST: response recorded/);
  assert.equal(await call(wrong+'*142536','pin-answer'),final);
  assert.equal((await f.db.query('select outcome from private.vehicle_check_requests where id=$1',[request])).rows[0].outcome,'approved');
  assert.equal((await f.db.query('select count(*)::int n from private.vehicle_check_decisions')).rows[0].n,1);
  assert.equal((await f.db.query('select used from private.owner_pin_proofs')).rows[0].used,true);
 }finally{await f.db.close();}
});
