import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {ServiceUnavailableException} from '@nestjs/common';
import {SmsProvider,PostgresSmsStore,sendFailure} from './sms';

export class TelecomCipher {
 constructor(private readonly key:Buffer,private readonly tenant:string){if(key.length!==32)throw new Error('Telecom key must be 32 bytes.');}
 hash(value:unknown){return createHmac('sha256',this.key).update(JSON.stringify([this.tenant,value])).digest('hex');}
 seal(stateKey:string,value:unknown){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(['AutoGuardian/telecom/v1',this.tenant,stateKey])));
  return Buffer.concat([nonce,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');
 }
 open<T>(stateKey:string,value:string):T{
  const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(JSON.stringify(['AutoGuardian/telecom/v1',this.tenant,stateKey])));cipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString()) as T;
 }
}
export type TelecomTx={call<T=unknown>(name:string,args:unknown[]):Promise<T>};
const operations=new Set(['telecom_state_read','telecom_state_write','telecom_resolve','telecom_verify_channel','telecom_operation',
 'telecom_pin_policy','telecom_pin_begin','telecom_pin_finish']);
export interface TelecomStorage {
 transact<T>(key:string,work:(state:any,tx:TelecomTx)=>Promise<{state:unknown;result:T;ttl?:number}>):Promise<T>;
}
export class PostgresTelecomStorage implements TelecomStorage {
 constructor(private readonly pool:Pool,private readonly tenant:string,private readonly cipher:TelecomCipher){}
 async transact<T>(key:string,work:(state:any,tx:TelecomTx)=>Promise<{state:unknown;result:T;ttl?:number}>):Promise<T>{
  const client=await this.pool.connect();try{
   await client.query('begin');
   await client.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id','',true),set_config('autoguardian.session_id','',true)`,[this.tenant]);
   const tx:TelecomTx={call:async<R>(name:string,args:unknown[])=>{
    if(!operations.has(name))throw new Error('Unknown telecom operation');
    const row=await client.query(`select private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
    return row.rows[0]?.result as R;
   }};
   const row=await tx.call<{ciphertext:string}|null>('telecom_state_read',[key]);
   const outcome=await work(row?this.cipher.open(key,row.ciphertext):null,tx);
   await tx.call('telecom_state_write',[key,this.cipher.seal(key,outcome.state),outcome.ttl??900]);
   await client.query('commit');return outcome.result;
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
 }
}
export interface DispatchStorage {claim(key:string,hash:string):Promise<string>;finish(key:string,state:string,reference:string|null):Promise<void>;}
export class PostgresDispatchStorage implements DispatchStorage {
 private readonly db:PostgresSmsStore;
 constructor(pool:Pool,tenant:string){this.db=new PostgresSmsStore(pool,tenant);}
 claim(key:string,hash:string):Promise<string>{return this.db.operation('select private.telecom_dispatch_claim($1,$2) as result',[key,hash]);}
 async finish(key:string,state:string,reference:string|null){await this.db.operation('select private.telecom_dispatch_finish($1,$2,$3)',[key,state,reference]);}
}
export type TelecomSend={key:string;phone:string;body:string};
export class DurableTelecomSender {
 constructor(private readonly storage:DispatchStorage,private readonly provider:SmsProvider,private readonly cipher:TelecomCipher){}
 async send(job:TelecomSend){
  const key=this.cipher.hash(['dispatch',job.key]),hash=this.cipher.hash(['payload',job.phone,job.body]);
  const state=await this.storage.claim(key,hash);
  if(state==='sent')return;
  if(state!=='claimed')throw new ServiceUnavailableException({code:'TELECOM_SEND_UNCONFIRMED'});
  let result;
  try{result=await this.provider.send({to:job.phone,body:job.body,validityPeriod:180});}
  catch(error){const failure=sendFailure(error);await this.storage.finish(key,failure.mode==='unknown'?'unknown':'failed',null);
   throw new ServiceUnavailableException({code:'TELECOM_SEND_UNCONFIRMED'});}
  // Never transform a DB failure after submission into an automatic retry.
  await this.storage.finish(key,'sent',result.messageId);
 }
}
export function telecomKey(env:NodeJS.ProcessEnv){
 const key=env.AUTOGUARDIAN_TELECOM_KEY_HEX;
 if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new Error('Configure AUTOGUARDIAN_TELECOM_KEY_HEX (32 random bytes as hex).');
 return Buffer.from(key,'hex');
}
