const {fixture,id}=require('./production-seal-fixture.cjs');
const {PostgresSmsStore,smsPhoneHash}=require('../../dist/sms');
const config={environment:'sandbox',username:'sandbox',apiKey:'a'.repeat(32),from:'TEST',providerAccount:'at:sandbox:sandbox',gatewayToken:'b'.repeat(64),allowedRecipients:['+243000000001','+243000000002']};
async function telecomFixture(){
 const f=await fixture();
 await f.db.exec(`update auth.users set phone='24300000000'||case when id='${id(1)}' then '1' when id='${id(2)}' then '2' else '3' end,phone_confirmed_at=now();
 insert into app.role_assignments(tenant_id,user_id,role_code) values('${id(10)}','${id(21)}','VERIFIER');
 insert into private.vehicle_check_configuration(tenant_id,sample_enabled,response_seconds,result_validity_seconds,max_checks_per_hour) values('${id(10)}',true,900,3600,100);
 begin;insert into app.vehicles(id,tenant_id,chassis_identifier,current_plate,category,record_status) values('${id(501)}','${id(10)}','AT-CHASSIS','AT-001','CAR','ACTIVE');
 insert into app.ownerships(id,tenant_id,vehicle_id,owner_id,source,start_at) values('${id(601)}','${id(10)}','${id(501)}','${id(40)}','TEST',now()-interval '1 day');commit;`);
 const store=new PostgresSmsStore(f.pool,id(10));
 const create=async(key=701)=>{
  await f.db.exec('begin;set local role autoguardian_identity_login');
  try{await f.db.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`,[id(10),id(1)]);
   const r=await f.db.query('select private.create_vehicle_check($1,$2) as result',[id(501),id(key)]);await f.db.exec('commit');return r.rows[0].result;
  }catch(e){await f.db.exec('rollback');throw e;}
 };
 return {...f,store,create,config,claim:()=>store.claim(config.providerAccount,config.allowedRecipients.map(smsPhoneHash))};
}
module.exports={telecomFixture,config,id};
