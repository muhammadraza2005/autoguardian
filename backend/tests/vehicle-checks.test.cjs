const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create role autoguardian_identity_login nologin;
    create schema auth;create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);`);
  for(const name of ['202610050001_core_foundation.sql','202610050002_default_permissions.sql',
    '202610050003_identity_api.sql','202610060004_owned_vehicle_reads.sql','202610100021_vehicle_check_rules.sql'])
    await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',name),'utf8'));
  await db.exec(`insert into auth.users values
    ('${id(1)}','+243000000001',now()),('${id(2)}','+243000000002',now()),
    ('${id(3)}','+243000000003',now()),('${id(4)}','+243000000004',now());
    insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values
    ('${id(10)}','TEST_A','A','CD','USD','Africa/Kinshasa'),('${id(11)}','TEST_B','B','CD','USD','Africa/Kinshasa');
    insert into app.users(id,tenant_id,auth_user_id) values
    ('${id(21)}','${id(10)}','${id(1)}'),('${id(22)}','${id(10)}','${id(2)}'),
    ('${id(23)}','${id(10)}','${id(3)}'),('${id(24)}','${id(11)}','${id(4)}');
    insert into app.role_assignments(tenant_id,user_id,role_code) values
    ('${id(10)}','${id(21)}','VERIFIER'),('${id(10)}','${id(22)}','OWNER'),
    ('${id(10)}','${id(23)}','OWNER'),('${id(10)}','${id(23)}','VERIFIER'),
    ('${id(11)}','${id(24)}','VERIFIER');
    insert into private.owners(id,tenant_id,user_id,kind,legal_name) values
    ('${id(31)}','${id(10)}','${id(22)}','PERSON','Private owner name'),
    ('${id(32)}','${id(10)}','${id(23)}','PERSON','Other private name');
    begin;
    insert into app.vehicles(id,tenant_id,chassis_identifier,current_plate,category,record_status) values
    ('${id(41)}','${id(10)}','SYNTHETIC-CHASSIS','TEST-001','CAR','ACTIVE');
    insert into app.ownerships(id,tenant_id,vehicle_id,owner_id,source,start_at) values
    ('${id(51)}','${id(10)}','${id(41)}','${id(31)}','TEST',now()-interval '1 day');commit;`);
  async function call(user,sql,values=[],tenant=id(10),role='autoguardian_identity_login'){
    await db.exec(`begin;set local role ${role};`);
    try{
      await db.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`,[tenant,user? id(user):'']);
      const r=await db.query(sql,values);await db.exec('commit');return r.rows[0]?.result;
    }catch(e){await db.exec('rollback');throw e;}
  }
  const create=(key=100,user=1)=>call(user,'select private.create_vehicle_check($1,$2) as result',[id(41),id(key)]);
  const read=(request,user=1,tenant=id(10))=>call(user,'select private.read_vehicle_check($1) as result',[request],tenant);
  const decide=(request,decision='approved',user=2)=>call(user,'select private.decide_vehicle_check($1,$2) as result',[request,decision]);
  const enable=()=>db.exec(`insert into private.vehicle_check_configuration values('${id(10)}',true,900,86400)`);
  return {db,call,create,read,decide,enable};
}
const fails=(operation,code)=>assert.rejects(operation,e=>e.message.includes(code));

test('check migration installs under a non-superuser schema owner and removes temporary CREATE permission',async()=>{
  const db=new PGlite();try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create role autoguardian_identity_login nologin;create role migration_author createrole;
      create schema auth;create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);
      grant usage on schema auth to migration_author;grant references,select on auth.users to migration_author;
      grant create on database postgres to migration_author;set role migration_author;`);
    for(const name of ['202610050001_core_foundation.sql','202610050002_default_permissions.sql',
      '202610050003_identity_api.sql','202610060004_owned_vehicle_reads.sql','202610100021_vehicle_check_rules.sql'])
      await db.exec(await fs.readFile(path.resolve(__dirname,'../../supabase/migrations',name),'utf8'));
    assert.equal((await db.query("select has_schema_privilege('autoguardian_check_executor','private','CREATE') as allowed")).rows[0].allowed,false);
    const verified=(await db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-vehicle-check-rules.sql'),'utf8'))).rows[0];
    assert.equal(Object.values(verified).every(v=>v===true),true,JSON.stringify(verified));
  }finally{await db.close();}
});

test('check creation, decisions and outbox are atomic, private and idempotent',async()=>{
  const f=await fixture();try{
    await fails(f.create(),'CHECKS_NOT_CONFIGURED');await f.enable();
    const r=await f.create();assert.equal(await f.create(),r);
    const initial=await f.read(r);assert.equal(initial.outcome,'pending');
    assert.equal(initial.resultExpiresAt,null);assert.equal(initial.respondedAt,null);
    assert.equal(initial.authorizationUsable,false);assert.equal(initial.sampleOnly,true);
    assert.deepEqual(Object.keys(initial.vehicle).sort(),['id','chassisIdentifier','plate','category','make','model','manufactureYear','color','saleStatus','recordStatus'].sort());
    assert.equal(JSON.stringify(initial).includes('Private'),false);
    await fails(f.call(1,'select private.create_vehicle_check($1,$2)',[id(99),id(100)]),'CHECK_KEY_CONFLICT');
    await fails(f.read(r,3),'CHECK_NOT_FOUND');await fails(f.read(r,4,id(11)),'CHECK_NOT_FOUND');
    await fails(f.decide(r,'approved',3),'CHECK_NOT_FOUND');
    await fails(f.decide(r,'yes'),'INVALID_CHECK_DECISION');
    await f.decide(r);const approved=await f.read(r);
    assert.equal(approved.outcome,'approved');assert.equal(approved.authorizationUsable,true);
    assert.equal(Date.parse(approved.resultExpiresAt)-Date.parse(approved.respondedAt),86400000);
    await fails(f.decide(r,'refused'),'CHECK_ALREADY_ANSWERED');
    const counts=(await f.db.query(`select
      (select count(*)::int from private.vehicle_check_requests) as requests,
      (select count(*)::int from private.vehicle_check_decisions) as decisions,
      (select count(*)::int from private.vehicle_check_events) as events,
      (select count(*)::int from private.vehicle_check_notifications) as notifications`)).rows[0];
    assert.deepEqual(counts,{requests:1,decisions:1,events:2,notifications:2});
    assert.equal((await f.db.query("select delivery_status from private.vehicle_check_notifications where kind='owner_request'")).rows[0].delivery_status,'cancelled');
    assert.equal((await f.db.query('select owner_id from app.ownerships where end_at is null')).rows[0].owner_id,id(31));
    const refused=await f.create(101);await f.decide(refused,'refused');
    assert.equal((await f.read(refused)).outcome,'refused');assert.equal((await f.read(refused)).authorizationUsable,false);
    // Simulate a transaction failure after the decision insert: everything rolls back.
    const fail=await f.create(102);
    await f.db.exec(`create function private.fail_check_event() returns trigger language plpgsql as $$ begin
      if new.action='approved' then raise exception 'INJECTED_FAILURE';end if;return new;end $$;
      create trigger fail_check before insert on private.vehicle_check_events for each row execute function private.fail_check_event();`);
    await fails(f.decide(fail),'INJECTED_FAILURE');assert.equal((await f.read(fail)).outcome,'pending');
    assert.equal((await f.db.query('select count(*)::int as n from private.vehicle_check_decisions where request_id=$1',[fail])).rows[0].n,0);
  }finally{await f.db.close();}
});

test('deadlines and expiry use server time, preserve outcomes and invalidate transferred or unsafe approvals',async()=>{
  const f=await fixture();try{
    await f.enable();const late=await f.create();
    await f.db.exec(`update private.vehicle_check_requests set created_at=now()-interval '1 hour',response_deadline_at=now()-interval '1 minute' where id='${late}'`);
    await fails(f.decide(late),'CHECK_RESPONSE_LATE');
    const result=await f.read(late);assert.equal(result.outcome,'timed_out');assert.equal(result.respondedAt,null);
    await f.read(late);assert.equal((await f.db.query("select count(*)::int as n from private.vehicle_check_events where action='timed_out'")).rows[0].n,1);
    await fails(f.decide(late),'CHECK_ALREADY_ANSWERED');
    const r=await f.create(101);await f.decide(r);
    await f.db.exec(`update private.vehicle_check_requests set created_at=now()-interval '3 days',response_deadline_at=now()-interval '2 days',
      responded_at=now()-interval '3 days'+interval '1 minute',result_expires_at=now()-interval '2 days'+interval '1 minute' where id='${r}'`);
    const expired=await f.read(r);assert.equal(expired.outcome,'approved');assert.equal(expired.expired,true);
    assert.equal(expired.authorizationUsable,false);assert.equal(expired.vehicle,null);
    const safe=await f.create(102);await f.decide(safe);
    await f.db.exec("update app.vehicles set sale_status='REPORTED_MISSING'");
    assert.equal((await f.read(safe)).vehicle.saleStatus,'REPORTED_MISSING');assert.equal((await f.read(safe)).authorizationUsable,false);
    const missing=await f.create(103);await fails(f.decide(missing),'CHECK_APPROVAL_UNAVAILABLE');
    await f.decide(missing,'refused');
    await f.db.exec(`update app.vehicles set sale_status='FOR_SALE';begin;
      update app.ownerships set end_at=now() where id='${id(51)}';
      insert into app.ownerships(tenant_id,vehicle_id,owner_id,source) values('${id(10)}','${id(41)}','${id(32)}','TEST_TRANSFER');commit;`);
    assert.equal((await f.read(safe)).vehicle,null);assert.equal((await f.read(safe)).authorizationUsable,false);
    const pending=await f.create(104);
    await fails(f.decide(pending),'CHECK_NOT_FOUND');await f.decide(pending,'approved',3);
  }finally{await f.db.close();}
});

test('database roles deny direct data access, helper execution and unverified or revoked actors',async()=>{
  const f=await fixture();try{
    await f.enable();const r=await f.create();
    for(const role of ['anon','authenticated','service_role','autoguardian_identity_login']){
      for(const table of ['vehicle_check_configuration','vehicle_check_requests','vehicle_check_decisions','vehicle_check_events','vehicle_check_notifications'])
        await assert.rejects(f.call(1,`select * from private.${table}`,[],id(10),role),e=>e.code==='42501');
      await assert.rejects(f.call(1,'select private.finish_vehicle_check($1,$2,$3,now())',[r,'approved',id(22)],id(10),role),e=>e.code==='42501');
      if(role!=='autoguardian_identity_login')await assert.rejects(f.call(1,'select private.read_vehicle_check($1)',[r],id(10),role),e=>e.code==='42501');
    }
    // SET ROLE in this administrator-owned test session can always use the
    // session administrator's memberships. Inspect actual login membership.
    assert.equal((await f.db.query("select pg_has_role('autoguardian_identity_login','autoguardian_check_executor','MEMBER') as member")).rows[0].member,false);
    await fails(f.call(null,'select private.read_vehicle_check($1)',[r]),'CHECK_ACCESS_DENIED');
    await f.db.exec(`update auth.users set phone_confirmed_at=null where id='${id(2)}'`);
    await fails(f.decide(r),'CHECK_ACCESS_DENIED');
    await f.db.exec(`update auth.users set phone_confirmed_at=now() where id='${id(2)}';
      update app.role_assignments set valid_to=clock_timestamp() where user_id='${id(22)}'`);
    await fails(f.decide(r),'CHECK_ACCESS_DENIED');
    await f.db.exec(`update app.users set status='SUSPENDED' where id='${id(21)}'`);
    await fails(f.read(r),'CHECK_ACCESS_DENIED');
    await f.db.exec(`update app.users set status='ACTIVE';update app.tenants set status='SUSPENDED' where id='${id(10)}'`);
    await fails(f.read(r),'CHECK_ACCESS_DENIED');
    const tables=await f.db.query(`select relrowsecurity,relforcerowsecurity from pg_class
      where relnamespace='private'::regnamespace and relname like 'vehicle_check_%' and relkind='r'`);
    assert.equal(tables.rows.length,5);assert.equal(tables.rows.every(t=>t.relrowsecurity&&t.relforcerowsecurity),true);
    const installed=(await f.db.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-vehicle-check-rules.sql'),'utf8'))).rows[0];
    assert.equal(Object.values(installed).every(v=>v===true),true,JSON.stringify(installed));
  }finally{await f.db.close();}
});

test('deadline checks survive an old transaction timestamp and configuration changes affect only new requests',async()=>{
  const f=await fixture();try{
    await f.enable();const r=await f.create();
    await f.db.exec(`update private.vehicle_check_configuration set response_seconds=60,result_validity_seconds=120`);
    const next=await f.create(101);
    const stored=(await f.db.query('select result_validity_seconds from private.vehicle_check_requests order by created_at')).rows;
    assert.deepEqual(stored.map(v=>v.result_validity_seconds),[86400,120]);
    const newer=await f.read(next);
    assert.ok(Date.parse(newer.responseDeadlineAt)<Date.parse((await f.read(r)).responseDeadlineAt));
    // Begin before the deadline, then respond after it. now() would incorrectly
    // accept this; clock_timestamp() must reject it.
    await f.db.exec(`update private.vehicle_check_requests set response_deadline_at=clock_timestamp()+interval '150 milliseconds' where id='${r}'`);
    await f.db.exec('begin;set local role autoguardian_identity_login;');
    await f.db.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`,[id(10),id(2)]);
    await new Promise(resolve=>setTimeout(resolve,200));
    await fails(f.db.query('select private.decide_vehicle_check($1,$2)',[r,'approved']),'CHECK_RESPONSE_LATE');
    await f.db.exec('rollback');
    assert.equal((await f.read(r)).outcome,'timed_out');
    // Invalid states and cross-authority dependencies are rejected at storage.
    await assert.rejects(f.db.exec(`update private.vehicle_check_requests set outcome='approved',responded_at=null where id='${next}'`),e=>e.code==='23514');
    await assert.rejects(f.db.exec(`update private.vehicle_check_requests set tenant_id='${id(11)}' where id='${next}'`),e=>e.code==='23503');
  }finally{await f.db.close();}
});
