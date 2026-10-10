import {Pool} from 'pg';
import {PostgresAccountStore} from './account';
import {smsConfiguration,PostgresSmsStore,SmsDispatcher,TwilioSmsProvider} from './sms';

async function main(){
  const configuration=smsConfiguration(process.env);
  if(!configuration)throw new Error('SMS is disabled. Configure server-only TWILIO settings first.');
  const tenant=process.env.AUTOGUARDIAN_TENANT_ID;
  if(!tenant||!process.env.DATABASE_URL)throw new Error('Missing database/authority configuration.');
  if(!/^[0-9a-f-]{36}$/i.test(tenant))throw new Error('Invalid authority configuration.');
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--once')||args.length>1)throw new Error('Use sms:worker with optional --once.');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000,query_timeout:10000,statement_timeout:10000});
  let stopping=false;
  const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
    await new PostgresAccountStore(pool,tenant).checkConnection();
    const dispatcher=new SmsDispatcher(new PostgresSmsStore(pool,tenant),new TwilioSmsProvider(configuration),configuration);
    do{
      // One job per pass permits a shutdown between external sends. Pending
      // attempts survive restarts; uncertain sends are quarantined by SQL.
      const count=await dispatcher.drain(1);
      if(args.includes('--once'))break;
      if(count===0&&!stopping)await new Promise(resolve=>setTimeout(resolve,2000));
    }while(!stopping);
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await pool.end();}
}
void main().catch(()=>{
  // Avoid printing driver/provider errors that may contain secrets or phone data.
  console.error('SMS worker stopped. Check server-only configuration, restricted database login and migration 022.');
  process.exitCode=1;
});
