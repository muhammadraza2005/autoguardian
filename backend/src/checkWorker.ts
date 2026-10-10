import {Pool} from 'pg';
import {PostgresAccountStore} from './account';
import {CheckService,PostgresWorkflowStore} from './checks';

async function main(){
  const tenant=process.env.AUTOGUARDIAN_TENANT_ID;
  if(!tenant||!process.env.DATABASE_URL)throw new Error('Configure DATABASE_URL and AUTOGUARDIAN_TENANT_ID');
  const interval=Number(process.env.CHECK_SWEEP_INTERVAL_MS??10000);
  if(!Number.isInteger(interval)||interval<1000||interval>60000)throw new Error('Invalid CHECK_SWEEP_INTERVAL_MS');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,statement_timeout:10000});
  let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
  try{
    await new PostgresAccountStore(pool,tenant).checkConnection();
    const checks=new CheckService(new PostgresWorkflowStore(pool,tenant));
    do{
      await checks.sweep();
      if(process.argv.includes('--once'))break;
      await new Promise(resolve=>setTimeout(resolve,interval));
    }while(!stopped);
  }finally{await pool.end();}
}
void main().catch(()=>{console.error('Vehicle-check worker stopped. Check database configuration and migrations.');process.exitCode=1;});
