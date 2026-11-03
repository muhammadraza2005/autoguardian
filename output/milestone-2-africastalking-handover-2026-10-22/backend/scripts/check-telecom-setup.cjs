// Read-only setup inspection. Never prints env values, connection URLs or phones.
const fs=require('node:fs/promises'),path=require('node:path'),{Pool}=require('pg');
async function main(){
 const e=process.env,report={
  providerCredentialsPresent:Boolean(e.AFRICASTALKING_API_KEY&&e.AFRICASTALKING_USERNAME),
  smsEnabled:e.AFRICASTALKING_SMS_ENABLED==='true',channelsEnabled:e.AFRICASTALKING_CHANNELS_ENABLED==='true',
  hookEnabled:e.SUPABASE_SMS_HOOK_ENABLED==='true',hookSecretPresent:Boolean(e.SUPABASE_SMS_HOOK_SECRET),
  pinEndpointsEnabled:e.OWNER_PIN_ENABLED==='true',
  telecomKeyPresent:Boolean(e.AUTOGUARDIAN_TELECOM_KEY_HEX),gatewayTokenPresent:Boolean(e.AFRICASTALKING_GATEWAY_TOKEN)
 };
 if(!e.DATABASE_URL){console.log(JSON.stringify({...report,database:'not_configured'},null,2));process.exitCode=1;return;}
 const pool=new Pool({connectionString:e.DATABASE_URL,max:1,connectionTimeoutMillis:10000,query_timeout:10000,statement_timeout:10000});
 try{
  const client=await pool.connect();try{
   await client.query('begin read only');
   const result=await client.query(`select
    to_regprocedure('private.billing_settings(jsonb,integer)') is not null billing_024_present,
    to_regprocedure('private.pilot_read(text,integer,integer)') is not null administration_025_present,
    to_regprocedure('private.sms_receive_delivery(text,text,text,text,text)') is not null sms_migration_present,
    to_regprocedure('private.telecom_operation(text,text,text,jsonb)') is not null channel_migration_present,
    to_regprocedure('private.owner_pin_status()') is not null pin_migration_present`);
   report.database='connected';Object.assign(report,result.rows[0]);
   const access=await client.query(`select exists(select 1 from pg_namespace where nspname='private' and pg_has_role(current_user,nspowner,'MEMBER')) owns_private_schema,
    (select rolcreaterole or rolsuper from pg_roles where rolname=current_user) can_manage_migration_roles,
    to_regprocedure('private.billing_policy(jsonb,integer)') is not null billing_026_present`);
   Object.assign(report,access.rows[0]);
   if(report.sms_migration_present&&report.channel_migration_present){
    const sql=await fs.readFile(path.resolve(__dirname,'../../supabase/verify-africastalking-telecom.sql'),'utf8');
    report.verification=(await client.query(sql)).rows[0];
   }
   if(report.pin_migration_present){
    report.pinVerification=(await client.query(await fs.readFile(path.resolve(__dirname,'../../supabase/verify-owner-pin.sql'),'utf8'))).rows[0];
   }
   await client.query('rollback');
  }finally{client.release();}
 }catch(error){report.database='unavailable_or_insufficient_access';
  const code=String(error?.code??'');report.databaseErrorCode=/^[A-Z0-9_]{1,32}$/.test(code)?code:'UNAVAILABLE';process.exitCode=1;}
 finally{await pool.end();}
 console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Read-only telecom setup check failed. No secrets printed.');process.exitCode=1;});
