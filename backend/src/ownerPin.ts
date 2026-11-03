import {scrypt,randomBytes,randomInt,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {Pool} from 'pg';
import {BadRequestException,ForbiddenException,ConflictException,ServiceUnavailableException,HttpException} from '@nestjs/common';
import {setRequestIdentity} from './requestIdentity';
import {fields,workflowText} from './checks';
import {draftId} from './enrollments';
import {TelecomCipher,DurableTelecomSender} from './telecomStore';
const pattern=/^\d{4,6}$/;
function derive(pin:string,salt:Buffer):Promise<Buffer>{
 return new Promise((resolve,reject)=>scrypt(pin,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
}
export async function hashOwnerPin(pin:unknown){
 if(typeof pin!=='string'||!pattern.test(pin))throw new BadRequestException({code:'PIN_MUST_HAVE_4_TO_6_DIGITS'});
 const salt=randomBytes(16),key=await derive(pin,salt);return `scrypt-v1:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyOwnerPin(pin:string,credential:string){
 const match=/^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(credential);
 if(!pattern.test(pin)||!match)return false;
 return timingSafeEqual(await derive(pin,Buffer.from(match[1],'hex')),Buffer.from(match[2],'hex'));
}
export class OwnerPinStore {
 constructor(private readonly pool:Pool,private readonly tenant:string){}
 async call<T=unknown>(actor:string,name:string,args:unknown[]):Promise<T>{
  if(!['owner_pin_status','owner_pin_settings','owner_pin_start_enrollment','owner_pin_finish_enrollment','owner_pin_begin_attempt','owner_pin_finish_attempt'].includes(name))throw new Error('Unknown PIN operation');
  const client=await this.pool.connect();try{
   await client.query('begin');await setRequestIdentity(client,this.tenant,actor);
   const row=await client.query(`select private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
   await client.query('commit');return row.rows[0]?.result as T;
  }catch(error){await client.query('rollback');if(error instanceof HttpException)throw error;
   const code=(error as {code?:string}).code;
   if(['42501','AG403'].includes(code??''))throw new ForbiddenException({code:'OWNER_PIN_ACCESS_REQUIRED'});
   if(['23514','23502','22P02'].includes(code??''))throw new ConflictException({code:'PIN_POLICY_OR_RECOVERY_REQUIRED'});
   if(['42883','42P01'].includes(code??''))throw new ServiceUnavailableException({code:'OWNER_PIN_SETUP_REQUIRED'});
   throw error;
  }finally{client.release();}
 }
}
export function pinPolicy(value:unknown){
 const v=fields(value,['enabled','maxAttempts','lockSeconds','proofSeconds','approvalReference']);
 if(typeof v.enabled!=='boolean'||!Number.isInteger(v.maxAttempts)||Number(v.maxAttempts)<1||Number(v.maxAttempts)>10
  ||!Number.isInteger(v.lockSeconds)||Number(v.lockSeconds)<30||Number(v.lockSeconds)>86400
  ||!Number.isInteger(v.proofSeconds)||Number(v.proofSeconds)<15||Number(v.proofSeconds)>300
  ||typeof v.approvalReference!=='string'||v.approvalReference.trim().length<3||v.approvalReference.length>200)
  throw new BadRequestException({code:'INVALID_PIN_POLICY'});
 return v;
}
export function salePinAction(value:unknown){
 const v=fields(value,['vehicleId','requestKey','expectedStatus','saleStatus','reason','pin']);
 const target=draftId(v.vehicleId),requestKey=draftId(v.requestKey),expected=workflowText(v.expectedStatus,32),status=workflowText(v.saleStatus,32),reason=workflowText(v.reason,500,3);
 if(!['NOT_FOR_SALE','FOR_SALE','AGENT_SALE','REPORTED_MISSING'].includes(expected)||!['NOT_FOR_SALE','FOR_SALE','AGENT_SALE'].includes(status))throw new BadRequestException({code:'INVALID_PIN_ACTION'});
 const fingerprint=createHash('sha256').update([target,requestKey,expected,status,reason].join('\x1f')).digest('hex');
 return {target,decision:'sale:'+fingerprint,pin:v.pin};
}
export class OwnerPinService {
 constructor(readonly store:OwnerPinStore,private readonly cipher:TelecomCipher,private readonly sender:DurableTelecomSender,
  private readonly code=()=>String(randomInt(100000,1000000))){}
 status(actor:string){return this.store.call(actor,'owner_pin_status',[]);}
 async enroll(actor:string,value:unknown){
  const v=fields(value,['pin']);
  const status=await this.store.call<{policyEnabled:boolean;configured:boolean;cooldown:boolean}>(actor,'owner_pin_status',[]);
  if(!status.policyEnabled||status.configured||status.cooldown)throw new ConflictException({code:'PIN_POLICY_OR_RECOVERY_REQUIRED'});
  const credential=await hashOwnerPin(v.pin),challengeId=randomUUID(),code=this.code();
  const result=await this.store.call<{phone:string}>(actor,'owner_pin_start_enrollment',[challengeId,credential,this.cipher.hash(['pin-enrollment',challengeId,code])]);
  await this.sender.send({key:`pin-enrollment:${challengeId}`,phone:result.phone,body:`AutoGuardian PIN setup: ${code}. Do not share. Ne partagez pas. Valid 3 min.`});
  return {challengeId};
 }
 async confirm(actor:string,value:unknown){
  const v=fields(value,['challengeId','code']);
  if(typeof v.challengeId!=='string'||!/^[a-f0-9-]{36}$/i.test(v.challengeId)||typeof v.code!=='string'||!/^\d{6}$/.test(v.code))throw new BadRequestException({code:'INVALID_PIN_CHALLENGE'});
  const valid=await this.store.call(actor,'owner_pin_finish_enrollment',[v.challengeId,this.cipher.hash(['pin-enrollment',v.challengeId,v.code])]);
  if(!valid)throw new ForbiddenException({code:'PIN_CHALLENGE_INVALID'});return {configured:true};
 }
 async proof(actor:string,value:unknown){
  let target:string,decision:string,pin:unknown;
  if(value&&typeof value==='object'&&'vehicleId' in value){const v=salePinAction(value);target=v.target;decision=v.decision;pin=v.pin;}
  else{const v=fields(value,['requestId','decision','pin']);target=draftId(v.requestId);decision=String(v.decision);pin=v.pin;
   if(!['approved','refused'].includes(decision))throw new BadRequestException({code:'INVALID_PIN_ACTION'});}
  if(typeof pin!=='string'||!pattern.test(pin))throw new BadRequestException({code:'INVALID_PIN_ACTION'});
  const nonce=randomUUID(),credential=await this.store.call<string|null>(actor,'owner_pin_begin_attempt',[target,decision,nonce]);
  if(!credential)throw new ForbiddenException({code:'PIN_VERIFICATION_UNAVAILABLE'});
  const valid=await verifyOwnerPin(pin,credential),proof=randomBytes(32).toString('hex');
  const accepted=await this.store.call(actor,'owner_pin_finish_attempt',[target,decision,nonce,valid,createHash('sha256').update(proof).digest('hex')]);
  if(!accepted)throw new ForbiddenException({code:'PIN_VERIFICATION_FAILED'});
  return decision.startsWith('sale:')?{proof,vehicleId:target,action:'sale_status'}:{proof,requestId:target,decision};
 }
}
