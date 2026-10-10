const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const twilio=require('twilio');
const {PGlite}=require('@electric-sql/pglite');
const {fixture,id}=require('./helpers/production-seal-fixture.cjs');
const {PostgresSmsStore,SmsDispatcher,TwilioSmsWebhooks,TwilioSmsProvider,smsConfiguration,smsPhoneHash}=require('../dist/sms');
const {createApp}=require('../dist/app');
const account='AC'+'a'.repeat(32),sid='SM'+'b'.repeat(32),token='c'.repeat(32),ownerPhone='+243000000002';
const config={accountSid:account,authToken:token,from:'+15005550006',callbackBaseUrl:'https://sms.example.test/v1/webhooks/twilio/sms',
  allowedRecipients:['+243000000001',ownerPhone]};
async function smsFixture(){
  const f=await fixture();
  await f.db.exec(`update auth.users set phone=case when id='${id(1)}' then '243000000001' else '${ownerPhone}' end,phone_confirmed_at=now();
    insert into app.role_assignments(tenant_id,user_id,role_code) values('${id(10)}','${id(21)}','VERIFIER');
    insert into private.vehicle_check_configuration(tenant_id,sample_enabled,response_seconds,result_validity_seconds,max_checks_per_hour) values('${id(10)}',true,900,86400,100);
    begin;insert into app.vehicles(id,tenant_id,chassis_identifier,current_plate,category,record_status)
    values('${id(501)}','${id(10)}','SMS-SYNTHETIC','SMS-001','CAR','ACTIVE');
    insert into app.ownerships(id,tenant_id,vehicle_id,owner_id,source,start_at)
    values('${id(601)}','${id(10)}','${id(501)}','${id(40)}','TEST',now()-interval '1 day');commit;`);
  const operation=async(actor,sql,values=[])=>{
    await f.db.exec('begin;set local role autoguardian_identity_login;');
    try{await f.db.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`,[id(10),id(actor)]);
      const result=await f.db.query(sql,values);await f.db.exec('commit');return result.rows[0]?.result;
    }catch(e){await f.db.exec('rollback');throw e;}
  };
  const create=key=>operation(1,'select private.create_vehicle_check($1,$2) as result',[id(501),id(key)]);
  const requestId=await create(701);
  const store=new PostgresSmsStore(f.pool,id(10));
  const claim=()=>store.claim(account,config.allowedRecipients.map(smsPhoneHash));
  const notification=async()=> (await f.db.query("select * from private.vehicle_check_notifications where request_id=$1 and kind='owner_request'",[requestId])).rows[0];
  return {...f,operation,create,requestId,store,claim,notification};
}
const callbackStatus=(job,status='delivered',messageSid=sid)=>({attemptId:job.attemptId,accountSid:account,messageSid,status,errorCode:'',phone:ownerPhone});

test('SMS configuration is opt-in, private and replaceable; provider maps sender and disables SDK retries',async()=>{
  assert.equal(smsConfiguration({}),undefined);
  const env={TWILIO_SMS_ENABLED:'true',TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:token,
    TWILIO_FROM_NUMBER:config.from,TWILIO_STATUS_CALLBACK_BASE_URL:config.callbackBaseUrl,
    TWILIO_SAMPLE_RECIPIENTS_JSON:JSON.stringify(config.allowedRecipients)};
  assert.deepEqual(smsConfiguration(env),{...config,previousAuthToken:undefined,messagingServiceSid:undefined});
  for(const changed of [{TWILIO_ACCOUNT_SID:'bad'},{TWILIO_AUTH_TOKEN:''},{TWILIO_FROM_NUMBER:''},
    {TWILIO_FROM_NUMBER:'500'},{TWILIO_MESSAGING_SERVICE_SID:'MG'+'d'.repeat(32)},
    {TWILIO_STATUS_CALLBACK_BASE_URL:'http://localhost/v1/webhooks/twilio/sms'},
    {TWILIO_STATUS_CALLBACK_BASE_URL:config.callbackBaseUrl+'?query=1'},
    {TWILIO_SAMPLE_RECIPIENTS_JSON:'[]'},{TWILIO_SAMPLE_RECIPIENTS_JSON:'["243000000002"]'}])assert.throws(()=>smsConfiguration({...env,...changed}));
  for(const sender of [{from:config.from},{messagingServiceSid:'MG'+'d'.repeat(32)}]){
    const provider=new TwilioSmsProvider({...config,from:undefined,...sender});
    assert.equal(provider.client.httpClient.autoRetry,false);
    let sent;provider.client={messages:{create:async input=>{sent=input;return {sid,status:'queued',errorCode:null};}}};
    assert.deepEqual(await provider.send({to:ownerPhone,body:'TEST',callbackUrl:'https://sms.example.test/callback',validityPeriod:60}),{messageSid:sid,status:'queued',errorCode:''});
    assert.equal(sent.to,ownerPhone);assert.equal(sent.validityPeriod,60);assert.deepEqual(Object.fromEntries(Object.entries(sent).filter(([k])=>['from','messagingServiceSid'].includes(k))),sender);
  }
});

test('SMS dispatch uses verified phones, persists attempts and survives early, duplicate and out-of-order callbacks',async()=>{
  const f=await smsFixture();try{
    let calls=0,job;
    const provider={send:async input=>{
      calls++;assert.equal(input.to,ownerPhone);assert.ok(input.body.startsWith('AutoGuardian TEST:'));assert.equal(input.body.includes('Synthetic owner'),false);
      assert.ok(input.validityPeriod<=300);
      const attemptId=input.callbackUrl.split('/').at(-1),notificationId=input.callbackUrl.split('/').at(-2);
      job={attemptId,notificationId};
      await f.store.callback(notificationId,callbackStatus(job)); // callback before API result commit
      return {messageSid:sid,status:'queued',errorCode:''};
    }};
    const dispatcher=new SmsDispatcher(f.store,provider,config);
    assert.equal(await dispatcher.drain(),1);assert.equal(await dispatcher.drain(),0);assert.equal(calls,1);
    await f.store.callback(job.notificationId,callbackStatus(job));
    await f.store.callback(job.notificationId,callbackStatus(job,'sent'));
    assert.equal((await f.notification()).delivery_status,'delivered');
    assert.equal((await f.db.query('select count(*)::int as n from private.sms_notification_attempts')).rows[0].n,1);
    assert.equal((await f.db.query("select count(*)::int as n from private.sms_delivery_events where source='callback' and status='delivered'")).rows[0].n,1);
    assert.equal((await f.db.query('select outcome from private.vehicle_check_requests where id=$1',[f.requestId])).rows[0].outcome,'pending');
    const state=JSON.stringify((await f.db.query('select * from private.sms_notification_attempts')).rows);
    assert.equal(state.includes(ownerPhone),false);assert.equal(state.includes(token),false);
    const r=await f.create(702);const next=await f.claim();
    assert.equal(next.requestId,r);await f.store.submitted(next.attemptId,'SM'+'e'.repeat(32),'sent','');
    await f.store.callback(next.notificationId,callbackStatus(next,'queued','SM'+'e'.repeat(32)));
    assert.equal((await f.db.query('select delivery_status from private.vehicle_check_notifications where id=$1',[next.notificationId])).rows[0].delivery_status,'sent');
    await f.store.callback(next.notificationId,{...callbackStatus(next,'undelivered','SM'+'e'.repeat(32)),errorCode:'30007'});
    await f.store.callback(next.notificationId,callbackStatus(next,'delivered','SM'+'e'.repeat(32)));
    assert.equal((await f.db.query('select delivery_status,last_error_code from private.vehicle_check_notifications where id=$1',[next.notificationId])).rows[0].last_error_code,'30007');
    await assert.rejects(f.store.callback(next.notificationId,callbackStatus(next,'sent','SM'+'f'.repeat(32))),e=>e.code==='42501');
    await assert.rejects(f.store.callback(next.notificationId,{...callbackStatus(next,'sent','SM'+'e'.repeat(32)),phone:'+243000000009'}),e=>e.code==='42501');
    await assert.rejects(f.store.callback(id(999),callbackStatus(next,'sent','SM'+'e'.repeat(32))),e=>e.code==='42501');
  }finally{await f.db.close();}
});

test('HTTP callbacks validate exact public URL and every form field before writing state',async()=>{
  const f=await smsFixture();let app;try{
    const job=await f.claim(),route=`/v1/webhooks/twilio/sms/${job.notificationId}/${job.attemptId}`;
    const signedUrl=`${config.callbackBaseUrl}/${job.notificationId}/${job.attemptId}`;
    const fields={AccountSid:account,MessageSid:sid,MessageStatus:'delivered',To:ownerPhone,FutureTwilioField:' retain spaces '};
    const signature=params=>twilio.getExpectedTwilioSignature(token,signedUrl,params);
    app=await createApp({verify:async()=>{throw new Error('App auth must not be used.');}},{load:async()=>({})},undefined,undefined,undefined,undefined,new TwilioSmsWebhooks(f.store,config));
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    const send=(body=fields,sig=signature(body),headers={},suffix='')=>fetch(base+route+suffix,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
      'X-Twilio-Signature':sig,...headers},body:new URLSearchParams(body)});
    assert.equal((await send(fields,'bad')).status,403);
    assert.equal((await send({...fields,MessageStatus:'failed'},signature(fields))).status,403);
    assert.equal((await send(fields,twilio.getExpectedTwilioSignature(token,'https://evil.test'+route,fields),{'X-Forwarded-Host':'evil.test'})).status,403);
    const wrongAccount={...fields,AccountSid:'AC'+'d'.repeat(32)};assert.equal((await send(wrongAccount)).status,403);
    assert.equal((await send(fields,signature(fields),{},'?unexpected=1')).status,400);
    const repeated=new URLSearchParams(fields);repeated.append('MessageStatus','sent');
    assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
      'X-Twilio-Signature':'ignored-for-invalid-body'},body:repeated})).status,400);
    const valid=await send(fields,signature(fields),{'X-Forwarded-Host':'evil.test'});assert.equal(valid.status,204);
    assert.equal((await send()).status,204);assert.equal((await f.notification()).delivery_status,'delivered');
    assert.equal(valid.headers.get('cache-control'),'no-store');
    assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Twilio-Signature':signature(fields)},body:JSON.stringify(fields)})).status,400);
  }finally{if(app)await app.close();await f.db.close();}
});

test('only definite rate limits retry, with backoff and three persisted attempts',async()=>{
  const f=await smsFixture();try{
    let sends=0;const dispatcher=new SmsDispatcher(f.store,{send:async()=>{sends++;throw {status:429,code:20429};}},config);
    for(let i=1;i<=3;i++){
      assert.equal(await dispatcher.drain(1),1);
      const n=await f.notification();assert.equal(n.attempts,i);assert.equal(n.delivery_status,i<3?'queued':'failed');
      assert.equal(n.last_error_code,'20429');
      if(i<3){
        const delay=(await f.db.query(`select extract(epoch from n.available_at-a.updated_at)::integer as seconds
          from private.vehicle_check_notifications n join private.sms_notification_attempts a on a.notification_id=n.id
          where n.id=$1 and a.attempt_number=$2`,[n.id,i])).rows[0].seconds;
        assert.equal(delay,30*(2**(i-1)));assert.equal(await dispatcher.drain(1),0);
        await f.db.query('update private.vehicle_check_notifications set available_at=now() where id=$1',[n.id]);}
    }
    assert.equal(await dispatcher.drain(1),0);assert.equal(sends,3);
    assert.equal((await f.db.query('select count(*)::int as n from private.sms_notification_attempts')).rows[0].n,3);
    const r=await f.create(703);
    const rejected=new SmsDispatcher(f.store,{send:async()=>{throw {status:400,code:21608,message:'sensitive phone or token'};}},config);
    await rejected.drain(1);const n=(await f.db.query("select delivery_status,last_error_code from private.vehicle_check_notifications where request_id=$1",[r])).rows[0];
    assert.deepEqual(n,{delivery_status:'failed',last_error_code:'21608'});
  }finally{await f.db.close();}
});

test('uncertain and crashed sends are quarantined without duplicates and a later receipt can resolve them',async()=>{
  const f=await smsFixture();try{
    let sends=0;const dispatcher=new SmsDispatcher(f.store,{send:async()=>{sends++;throw {status:503,message:token+' '+ownerPhone};}},config);
    assert.equal(await dispatcher.drain(1),1);assert.equal((await f.notification()).delivery_status,'unknown');
    assert.equal(await dispatcher.drain(1),0);assert.equal(sends,1);
    const a=(await f.db.query('select * from private.sms_notification_attempts')).rows[0];
    await f.store.callback((await f.notification()).id,callbackStatus({attemptId:a.id}));
    assert.equal((await f.notification()).delivery_status,'delivered');
    await f.create(704);const job=await f.claim();
    await f.db.query(`update private.sms_notification_attempts set started_at=now()-interval '2 minutes',lease_expires_at=now()-interval '1 minute' where id=$1`,[job.attemptId]);
    assert.equal(await f.claim(),null);
    assert.equal((await f.db.query('select state,error_code from private.sms_notification_attempts where id=$1',[job.attemptId])).rows[0].state,'unknown');
    await f.store.callback(job.notificationId,callbackStatus(job,'delivered','SM'+'e'.repeat(32)));
    assert.equal((await f.db.query('select delivery_status from private.vehicle_check_notifications where id=$1',[job.notificationId])).rows[0].delivery_status,'delivered');
    // A send that succeeded but whose persistence fails must stop the batch.
    let external=0,errors=0;
    const mock={claim:async()=>({...job,phone:ownerPhone,sampleOnly:true,kind:'buyer_result',language:'en'}),submitted:async()=>{throw new Error('DB unavailable');},sendError:async()=>errors++};
    await assert.rejects(new SmsDispatcher(mock,{send:async()=>{external++;return {messageSid:sid,status:'queued',errorCode:''};}},config).drain(),/DB unavailable/);
    assert.equal(external,1);assert.equal(errors,0);
  }finally{await f.db.close();}
});

test('stale notifications, unverified phones and destinations outside the sample list cannot be sent',async()=>{
  const f=await smsFixture();try{
    assert.equal(await f.store.claim(account,[smsPhoneHash('+243000000009')]),null);
    assert.equal((await f.notification()).last_error_code,'SAMPLE_RECIPIENT_NOT_ALLOWED');
    const r=await f.create(705);
    await f.db.exec(`update auth.users set phone_confirmed_at=null where id='${id(2)}'`);
    assert.equal(await f.claim(),null);assert.equal((await f.db.query('select last_error_code from private.vehicle_check_notifications where request_id=$1',[r])).rows[0].last_error_code,'VERIFIED_PHONE_REQUIRED');
    await f.db.exec(`update auth.users set phone_confirmed_at=now();`);
    const stale=await f.create(706);
    await f.db.query(`update private.vehicle_check_requests set created_at=now()-interval '1 hour',response_deadline_at=now()-interval '1 minute' where id=$1`,[stale]);
    assert.equal(await f.claim(),null);assert.equal((await f.db.query('select delivery_status from private.vehicle_check_notifications where request_id=$1',[stale])).rows[0].delivery_status,'cancelled');
    const answered=await f.create(707);
    await f.operation(2,'select private.decide_vehicle_check($1,$2)',[answered,'refused']);
    const resultJob=await f.claim();assert.equal(resultJob.kind,'buyer_result');assert.equal(resultJob.phone,'+243000000001');
    assert.equal((await f.db.query("select delivery_status from private.vehicle_check_notifications where request_id=$1 and kind='owner_request'",[answered])).rows[0].delivery_status,'cancelled');
  }finally{await f.db.close();}
});

test('SMS policies fail closed and installation supports a non-superuser migration owner',async()=>{
  const f=await smsFixture();try{
    const verify=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-twilio-sms-delivery.sql'),'utf8'))).rows[0];
    assert.equal(Object.values(verify).every(v=>v===true),true,JSON.stringify(verify));
    await assert.rejects(new PostgresSmsStore(f.pool,id(999)).claim(account,config.allowedRecipients.map(smsPhoneHash)),e=>e.code==='42501');
    for(const role of ['anon','authenticated','service_role','autoguardian_identity_login']){
      await f.db.exec(`begin;set local role ${role};`);
      await assert.rejects(f.db.query('select * from private.sms_notification_attempts'),e=>e.code==='42501');await f.db.exec('rollback');
      await f.db.exec(`begin;set local role ${role};`);
      await assert.rejects(f.db.query('select private.sms_verified_phone($1)',[id(2)]),e=>e.code==='42501');await f.db.exec('rollback');
    }
  }finally{await f.db.close();}
  const db=new PGlite();try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role autoguardian_identity_login nologin;
      create role migration_author createrole;create schema auth;create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);
      grant usage on schema auth to migration_author;grant references,select on auth.users to migration_author;
      grant create on database postgres to migration_author;set role migration_author;`);
    for(const name of ['202610050001_core_foundation.sql','202610050002_default_permissions.sql',
      '202610050003_identity_api.sql','202610060004_owned_vehicle_reads.sql','202610100021_vehicle_check_rules.sql','202610100022_twilio_sms_delivery.sql'])
      await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',name),'utf8'));
    const verify=(await db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-twilio-sms-delivery.sql'),'utf8'))).rows[0];
    assert.equal(Object.values(verify).every(v=>v===true),true,JSON.stringify(verify));
  }finally{await db.close();}
});
