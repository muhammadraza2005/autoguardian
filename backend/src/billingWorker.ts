import {Pool} from 'pg';
import {configuredBilling} from './billing';
import {BillingStore} from './billing';
import {configuredLiveBilling} from './billingOperations';
import {configuredBillingReminders} from './billingReminders';

async function main(){
 if(!process.env.BILLING_DATABASE_URL||!process.env.AUTOGUARDIAN_TENANT_ID)throw new Error('Billing worker requires a separate scoped database login.');
 const pool=new Pool({connectionString:process.env.BILLING_DATABASE_URL,max:2,connectionTimeoutMillis:10000,query_timeout:10000,statement_timeout:10000});
 const billing=configuredBilling(process.env,pool,process.env.AUTOGUARDIAN_TENANT_ID);
 const live=configuredLiveBilling(process.env,pool,process.env.AUTOGUARDIAN_TENANT_ID);
 const reminders=configuredBillingReminders(process.env,new BillingStore(pool,process.env.AUTOGUARDIAN_TENANT_ID));
 if(!billing&&!live){await pool.end();throw new Error('Billing is not enabled.');}
 let running=true;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{running=false;});
 try{
  while(running){
   for(const service of [billing,live])if(service)try{await service.processOne();await service.sweep();}catch{console.error('Billing operation failed; pending work remains durable.');}
   if(reminders)try{await reminders.drain();}catch{console.error('Billing reminder operation failed; pending work remains durable.');}
   if(running)await new Promise(resolve=>setTimeout(resolve,5000));
  }
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('Unable to start sandbox billing worker.');process.exitCode=1;});
