import {createHmac,timingSafeEqual} from 'node:crypto';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {DurableTelecomSender,TelecomCipher,TelecomStorage} from './telecomStore';
import {phonePattern,SmsConfiguration} from './sms';

export function hookSecrets(value:string){
 const keys=value.split('|').map(s=>s.replace(/^v1,whsec_|^whsec_/,''));
 if(!keys.length||keys.length>2||keys.some(s=>!/^[A-Za-z0-9+/]{43}=$/.test(s)||Buffer.from(s,'base64').length!==32))throw new Error('Invalid Supabase SMS hook signing secret.');
 return keys.map(s=>Buffer.from(s,'base64'));
}
export function verifySmsHook(raw:Buffer|undefined,headers:Record<string,string|undefined>,keys:Buffer[],now=Date.now()){
 const id=headers['webhook-id'],timestamp=headers['webhook-timestamp'],signature=headers['webhook-signature'];
 if(!raw||raw.length>32768||!id||!/^[A-Za-z0-9_.:-]{1,200}$/.test(id)||!timestamp||!/^\d{10}$/.test(timestamp)
  ||Math.abs(now/1000-Number(timestamp))>300||!signature||signature.length>1024)throw new ForbiddenException({code:'INVALID_HOOK_SIGNATURE'});
 const valid=keys.some(key=>{
  const expected=createHmac('sha256',key).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  return signature.split(' ').some(value=>{const candidate=value.startsWith('v1,')?value.slice(3):'';
   return /^[A-Za-z0-9+/]{43}=$/.test(candidate)&&timingSafeEqual(Buffer.from(candidate),Buffer.from(expected));});
 });
 if(!valid)throw new ForbiddenException({code:'INVALID_HOOK_SIGNATURE'});
 return id;
}
export class SupabaseSmsHook {
 constructor(private readonly keys:Buffer[],private readonly configuration:SmsConfiguration,private readonly cipher:TelecomCipher,
  private readonly storage:TelecomStorage,private readonly sender:DurableTelecomSender){}
 async receive(raw:Buffer|undefined,headers:Record<string,string|undefined>){
  const id=verifySmsHook(raw,headers,this.keys);let body:{user?:{id?:unknown;phone?:unknown};sms?:{otp?:unknown}};
  try{body=JSON.parse(raw!.toString());}catch{throw new BadRequestException({code:'INVALID_HOOK_PAYLOAD'});}
  if(!body||typeof body.user?.phone!=='string'||typeof body.sms?.otp!=='string'||!/^\d{6,10}$/.test(body.sms.otp)
   ||typeof body.user.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.user.id))throw new BadRequestException({code:'INVALID_HOOK_PAYLOAD'});
  const phone='+'+body.user.phone.replace(/^\+/,'');
  if(!phonePattern.test(phone)||!this.configuration.allowedRecipients.includes(phone))throw new ForbiddenException({code:'TEST_RECIPIENT_REQUIRED'});
  // Independent phone-based cooldown limits signed request IDs used to spam sends.
  // Store only keyed fingerprints; never store the OTP/body in this ledger.
  const hash=this.cipher.hash(['hook-payload',body.user.id,phone,body.sms.otp]);
  await this.storage.transact(this.cipher.hash(['hook-limit',phone]),async state=>{
   const now=Date.now();state??={at:0,hash:''};
   if(state.hash!==hash&&now-state.at<60000)throw new BadRequestException({code:'OTP_RESEND_COOLDOWN'});
   return {state:{at:state.hash===hash?state.at:now,hash},result:null,ttl:600};
  });
  await this.sender.send({key:`${this.configuration.providerAccount}:auth:${id}`,phone,body:`AutoGuardian: ${body.sms.otp}. Do not share this verification code. Ne partagez pas ce code.`});
  return {};
 }
}
