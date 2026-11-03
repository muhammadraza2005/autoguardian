const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {telecomFixture,id,config}=require('./helpers/telecom-fixture.cjs');
const {RelationshipService}=require('../dist/relationships');
const {PostgresWorkflowStore,CheckService}=require('../dist/checks');
const {TelecomCipher,DurableTelecomSender,PostgresDispatchStorage}=require('../dist/telecomStore');
const {smsMessage}=require('../dist/sms');
const hash=phone=>createHash('sha256').update(phone).digest('hex');
async function setup(){
 const f=await telecomFixture(),store=new PostgresWorkflowStore(f.pool,id(10)),cipher=new TelecomCipher(Buffer.alloc(32,11),id(10)),sent=[];
 const sender=new DurableTelecomSender(new PostgresDispatchStorage(f.pool,id(10)),{send:async input=>{sent.push(input);return {messageId:'ATXid_relationship_'+sent.length,status:'sent',errorCode:''};}},cipher);
 const service=new RelationshipService(store,cipher,sender,()=> '654321');
 const invite=(kind='backup',key=901)=>f.as(2,()=>service.invite(id(2),id(key),{vehicleId:id(501),kind,phone:config.allowedRecipients[0]}));
 const accept=async(key=901)=>{
  const c=await f.as(1,()=>service.start(id(1),id(key),{consentVersion:'alert-only-v1',accept:true}));
  await f.as(1,()=>service.confirm(id(1),{challengeId:c.challengeId,code:'654321'}));return c;
 };
 return {...f,store,service,sent,invite,accept,checks:new CheckService(store)};
}
test('backup invitation requires consent and OTP, rejects other users/replay, grants no owner decisions',async()=>{
 const f=await setup();try{
  await f.invite();await f.invite();assert.equal(f.sent.length,1);
  assert.equal((await f.as(1,()=>f.service.list(id(1)))).items[0].canApprove,false);
  await assert.rejects(f.as(3,()=>f.service.start(id(3),id(901),{consentVersion:'alert-only-v1',accept:true})));
  await assert.rejects(f.as(3,()=>f.service.revoke(id(3),id(901))));
  await assert.rejects(f.as(1,()=>f.service.start(id(1),id(901),{consentVersion:'alert-only-v1',accept:false})));
  const c=await f.as(1,()=>f.service.start(id(1),id(901),{consentVersion:'alert-only-v1',accept:true}));
  await assert.rejects(f.as(1,()=>f.service.confirm(id(1),{challengeId:c.challengeId,code:'000000'})));
  assert.equal((await f.db.query('select attempts from private.relationship_challenges')).rows[0].attempts,1);
  await f.as(1,()=>f.service.confirm(id(1),{challengeId:c.challengeId,code:'654321'}));
  await assert.rejects(f.as(1,()=>f.service.confirm(id(1),{challengeId:c.challengeId,code:'654321'})));
  const request=await f.create();await assert.rejects(f.as(1,()=>f.checks.decide(id(1),request,'approved')));
  await f.as(1,()=>f.service.revoke(id(1),id(901)));
  assert.equal((await f.as(1,()=>f.service.list(id(1)))).items[0].state,'revoked');
 }finally{await f.db.close();}
});
test('only accepted current backup queues one durable alert; revocation cancels it at dispatch',async()=>{
 const f=await setup();try{
  await f.invite();await f.db.exec('update private.vehicle_check_configuration set backup_seconds=60');
  const request=await f.create();await f.db.exec("update private.check_alert_jobs set due_at=now()-interval '1 minute'");
  await f.checks.sweep();assert.equal((await f.db.query("select count(*)::int n from private.vehicle_check_notifications where kind='backup_alert'")).rows[0].n,0);
  await f.accept();await f.checks.sweep();await f.checks.sweep();
  const rows=(await f.db.query("select * from private.vehicle_check_notifications where kind='backup_alert'")).rows;assert.equal(rows.length,1);assert.equal(rows[0].recipient_id,id(21));
  assert.equal(await f.as(2,()=>f.store.call(id(2),'relationship_revoke',[id(901)])),true);
  // Other queued owner alerts are not allowlisted in this claim; backup must not send after revoke.
  const {PostgresSmsStore}=require('../dist/sms');
  assert.equal(await new PostgresSmsStore(f.pool,id(10)).claim(config.providerAccount,[hash(config.allowedRecipients[0])]),null);
  assert.equal((await f.db.query("select delivery_status from private.vehicle_check_notifications where kind='backup_alert'")).rows[0].delivery_status,'cancelled');
  for(const language of ['en','fr'])assert.ok(smsMessage({kind:'backup_alert',sampleOnly:true,language}).length<=160);
 }finally{await f.db.close();}
});
test('accepted backup alerts use the real outbox claim and stop after a final decision',async()=>{
 const f=await setup();try{
  await f.invite();await f.accept();await f.db.exec('update private.vehicle_check_configuration set backup_seconds=60');
  const request=await f.create();await f.db.exec("update private.check_alert_jobs set due_at=now()-interval '1 minute'");await f.checks.sweep();
  const {PostgresSmsStore}=require('../dist/sms'),store=new PostgresSmsStore(f.pool,id(10));
  const job=await store.claim(config.providerAccount,[hash(config.allowedRecipients[0])]);assert.equal(job.kind,'backup_alert');assert.equal(job.phone,config.allowedRecipients[0]);
  await store.submitted(job.attemptId,'ATXid_backup','sent','');
  assert.equal(await store.claim(config.providerAccount,[hash(config.allowedRecipients[0])]),null);
  await f.as(2,()=>f.checks.decide(id(2),request,'refused'));await f.checks.sweep();
  assert.equal((await f.db.query("select count(*)::int n from private.vehicle_check_notifications where kind='backup_alert'")).rows[0].n,1);
 }finally{await f.db.close();}
});
test('seller OTP accepts only NOT_FOR_SALE, expires within 30 days, never grants approval, owner can revoke',async()=>{
 const f=await setup();try{
  await f.invite('seller');await f.accept();
  assert.equal((await f.db.query('select sale_status from app.vehicles where id=$1',[id(501)])).rows[0].sale_status,'AGENT_SALE');
  assert.equal((await f.db.query("select expires_at<=listed_at+interval '30 days' valid from private.vehicle_sale_listings")).rows[0].valid,true);
  const request=await f.create();await assert.rejects(f.as(1,()=>f.checks.decide(id(1),request,'approved')));
  await f.as(2,()=>f.service.revoke(id(2),id(901)));
  assert.equal((await f.db.query('select sale_status from app.vehicles where id=$1',[id(501)])).rows[0].sale_status,'NOT_FOR_SALE');
  await f.invite('seller',902);await f.db.exec("update private.vehicle_relationships set expires_at=now()-interval '1 second' where id='"+id(902)+"'");
  await assert.rejects(f.accept(902));
 }finally{await f.db.close();}
});
test('expired listings are unusable in buyer and owner reads before sweep; worker expires once and preserves missing status',async()=>{
 const f=await setup();try{
  await f.as(2,()=>f.store.call(id(2),'change_vehicle_sale',[id(501),id(910),'NOT_FOR_SALE','FOR_SALE','Synthetic listing']));
  await f.db.exec("update private.vehicle_sale_listings set expires_at=now()-interval '1 second'");
  const {PostgresVehicleStore}=require('../dist/vehicles');
  assert.equal((await new PostgresVehicleStore(f.pool,id(10)).detail(id(2),id(501))).vehicle.saleStatus,'NOT_FOR_SALE');
  const request=await f.create();assert.equal((await f.as(1,()=>f.checks.read(id(1),request))).vehicle.saleStatus,'NOT_FOR_SALE');
  await f.checks.sweep();await f.checks.sweep();
  assert.equal((await f.db.query("select count(*)::int n from private.vehicle_status_events where reason='Listing expired or ownership changed'")).rows[0].n,1);
  await f.db.exec("update app.vehicles set sale_status='REPORTED_MISSING'");await f.checks.sweep();
  assert.equal((await f.db.query('select sale_status from app.vehicles where id=$1',[id(501)])).rows[0].sale_status,'REPORTED_MISSING');
 }finally{await f.db.close();}
});
test('relationship OTP attempts persist, sessions/phones bind consent, and stale ownership invalidates invitations',async()=>{
 const f=await setup();try{
  await f.invite();const c=await f.as(1,()=>f.service.start(id(1),id(901),{consentVersion:'alert-only-v1',accept:true}));
  for(let i=0;i<5;i++)await assert.rejects(f.as(1,()=>f.service.confirm(id(1),{challengeId:c.challengeId,code:'000000'})));
  await assert.rejects(f.as(1,()=>f.service.confirm(id(1),{challengeId:c.challengeId,code:'654321'})));
  await f.db.exec("update private.relationship_challenges set created_at=now()-interval '2 minutes'");
  const next=await f.as(1,()=>f.service.start(id(1),id(901),{consentVersion:'alert-only-v1',accept:true}));
  await f.db.query("update auth.users set phone='243000000009' where id=$1",[id(1)]);
  await assert.rejects(f.as(1,()=>f.service.confirm(id(1),{challengeId:next.challengeId,code:'654321'})));
  await f.db.query("update auth.users set phone='243000000001' where id=$1",[id(1)]);
  // Model a valid transfer atomically; ACTIVE vehicles cannot be ownerless.
  await f.db.exec(`insert into private.owners(id,tenant_id,user_id,kind,legal_name) values('${id(41)}','${id(10)}','${id(21)}','PERSON','Synthetic new owner');
   begin;update app.ownerships set end_at=now() where vehicle_id='${id(501)}';
   insert into app.ownerships(id,tenant_id,vehicle_id,owner_id,source,start_at) values('${id(602)}','${id(10)}','${id(501)}','${id(41)}','TEST',now());commit;`);
  await assert.rejects(f.as(1,()=>f.service.confirm(id(1),{challengeId:next.challengeId,code:'654321'})));
 }finally{await f.db.close();}
});
test('seller invitation consumes an action-bound owner PIN proof; changing recipient cannot reuse it',async()=>{
 const f=await setup();try{
  const {OwnerPinStore,OwnerPinService}=require('../dist/ownerPin');
  const cipher=new TelecomCipher(Buffer.alloc(32,12),id(10)),sender=new DurableTelecomSender(new PostgresDispatchStorage(f.pool,id(10)),{send:async()=>({messageId:'ATXid_pin_mandate',status:'sent',errorCode:''})},cipher);
  const pin=new OwnerPinService(new OwnerPinStore(f.pool,id(10)),cipher,sender,()=> '654321');
  await f.as(3,()=>pin.store.call(id(3),'owner_pin_settings',[{enabled:true,maxAttempts:5,lockSeconds:900,proofSeconds:60,approvalReference:'Synthetic approved policy'}]));
  const enrollment=await f.as(2,()=>pin.enroll(id(2),{pin:'142536'}));await f.as(2,()=>pin.confirm(id(2),{challengeId:enrollment.challengeId,code:'654321'}));
  await assert.rejects(f.invite('seller'));
  const proof=await f.as(2,()=>pin.proof(id(2),{vehicleId:id(501),requestKey:id(901),expectedStatus:'NOT_FOR_SALE',saleStatus:'AGENT_SALE',reason:'seller-mandate:'+hash(config.allowedRecipients[0]),pin:'142536'}));
  await assert.rejects(f.as(2,()=>f.service.invite(id(2),id(901),{vehicleId:id(501),kind:'seller',phone:'+243000000009',proof:proof.proof})));
  await f.as(2,()=>f.service.invite(id(2),id(901),{vehicleId:id(501),kind:'seller',phone:config.allowedRecipients[0],proof:proof.proof}));
  assert.equal((await f.db.query('select used from private.owner_pin_sale_proofs')).rows[0].used,true);
 }finally{await f.db.close();}
});
test('relationship verifier passes under restricted runtime role; private data and legacy helpers are denied',async()=>{
 const f=await setup();try{
  const fs=require('node:fs/promises'),path=require('node:path');await f.invite();
  await f.db.exec('set role autoguardian_identity_login');
  const result=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-vehicle-relationships.sql'),'utf8'))).rows[0];
  assert.ok(Object.values(result).every(x=>x===true),JSON.stringify(result));
  for(const table of ['vehicle_relationships','relationship_challenges','relationship_events','vehicle_sale_listings'])await assert.rejects(f.db.query(`select * from private.${table}`),e=>e.code==='42501');
  await assert.rejects(f.db.query('select private.relationship_current($1)',[id(901)]),e=>e.code==='42501');
 }finally{await f.db.close();}
});
test('phone reassignment cannot inherit accepted relationships or revoke them; disabled sandbox rejects acceptance',async()=>{
 const f=await setup();try{
  await f.invite();await f.accept();
  await f.db.query("update auth.users set phone='243000000009' where id=$1",[id(1)]);
  await f.db.query("update auth.users set phone='243000000001' where id=$1",[id(3)]);
  assert.equal((await f.as(3,()=>f.service.list(id(3)))).items.length,0);
  await assert.rejects(f.as(3,()=>f.service.revoke(id(3),id(901))));
  assert.equal((await f.as(1,()=>f.service.list(id(1)))).items[0].current,false);
  await f.as(2,()=>f.service.revoke(id(2),id(901)));
  await f.db.query("update auth.users set phone='243000000003' where id=$1",[id(3)]);
  await f.db.query("update auth.users set phone='243000000001' where id=$1",[id(1)]);
  await f.invite('backup',902);await f.db.exec('update private.vehicle_check_configuration set sample_enabled=false');
  await assert.rejects(f.accept(902),e=>e.getStatus()===403);
 }finally{await f.db.close();}
});
