import {createHash,timingSafeEqual} from 'node:crypto';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {Pool} from 'pg';

export const phonePattern=/^\+[1-9]\d{7,14}$/;
export const messageIdPattern=/^[A-Za-z0-9_.:-]{1,200}$/;
export const smsPhoneHash=(phone:string)=>createHash('sha256').update(phone).digest('hex');
export type SmsConfiguration={environment:'sandbox'|'production';username:string;apiKey:string;from:string;
  providerAccount:string;gatewayToken:string;allowedRecipients:string[]};
export function enabled(env:NodeJS.ProcessEnv,key:string){
  if(!['true','false'].includes(env[key]??'false'))throw new Error(`${key} must be true or false.`);
  return env[key]==='true';
}
export function smsConfiguration(env:NodeJS.ProcessEnv):SmsConfiguration|undefined{
  if(!enabled(env,'AFRICASTALKING_SMS_ENABLED'))return undefined;
  const environment=env.AFRICASTALKING_ENVIRONMENT??'sandbox';
  if(!['sandbox','production'].includes(environment))throw new Error('Invalid AFRICASTALKING_ENVIRONMENT.');
  const username=env.AFRICASTALKING_USERNAME??'',apiKey=env.AFRICASTALKING_API_KEY??'',from=env.AFRICASTALKING_SENDER_ID??'';
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(username)||(environment==='sandbox')!==(username==='sandbox'))throw new Error('Invalid Africa Talking username/environment.');
  if(!/^[\x21-\x7e]{16,256}$/.test(apiKey)||!/^\+?[A-Za-z0-9_-]{1,20}$/.test(from))throw new Error('Configure Africa Talking API key and approved sender.');
  const gatewayToken=env.AFRICASTALKING_GATEWAY_TOKEN??'';
  if(!/^[a-f0-9]{64}$/i.test(gatewayToken))throw new Error('AFRICASTALKING_GATEWAY_TOKEN must be 32 random bytes encoded as hex.');
  let allowed:unknown;try{allowed=JSON.parse(env.AFRICASTALKING_TEST_RECIPIENTS_JSON??'[]');}catch{throw new Error('Invalid Africa Talking test recipients.');}
  if(!Array.isArray(allowed)||!allowed.length||allowed.length>20||allowed.some(v=>typeof v!=='string'||!phonePattern.test(v)))
    throw new Error('AFRICASTALKING_TEST_RECIPIENTS_JSON must contain 1-20 E.164 controlled recipients.');
  if(environment==='production'&&env.AFRICASTALKING_PRODUCTION_APPROVED!=='true')throw new Error('Africa Talking production acceptance/approval is required.');
  return {environment:environment as SmsConfiguration['environment'],username,apiKey,from,gatewayToken,
    providerAccount:`at:${environment}:${username}`,allowedRecipients:[...new Set(allowed)]};
}
// This credential authenticates trusted ingress, NOT an Africa's Talking signature.
// Ingress must verify provider origin, strip caller headers and inject this token.
// Keep the backend inaccessible outside that ingress.
export function verifyGateway(token:string|undefined,expected:string){
  if(!token||!expected||Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))
    throw new ForbiddenException({code:'GATEWAY_AUTH_REQUIRED'});
}
export function formBody(contentType:string|undefined,body:unknown):Record<string,string>{
  if(contentType?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded'||!body||typeof body!=='object'
    ||Array.isArray(body)||Object.keys(body).length>30||Object.values(body).some(v=>typeof v!=='string'||v.length>4096))
    throw new BadRequestException({code:'INVALID_GATEWAY_FORM'});
  return body as Record<string,string>;
}
export type SmsJob={notificationId:string;attemptId:string;requestId:string;kind:'owner_request'|'owner_reminder'|'buyer_result'|'backup_alert';
  phone:string;language:'en'|'fr';responseDeadlineAt:string;sampleOnly:true};
export interface SmsStore{
  claim(account:string,allowedHashes:string[]):Promise<SmsJob|null>;
  submitted(attempt:string,messageId:string,status:string,errorCode:string):Promise<void>;
  sendError(attempt:string,mode:'rate_limited'|'failed'|'unknown',code:string):Promise<void>;
  delivery(account:string,messageId:string,phone:string,status:string,error:string):Promise<void>;
}
export class PostgresSmsStore implements SmsStore{
  constructor(private readonly pool:Pool,private readonly tenantId:string){}
  async operation(sql:string,values:unknown[]){
    const client=await this.pool.connect();try{
      await client.query('begin');
      await client.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id','',true),set_config('autoguardian.session_id','',true)`,[this.tenantId]);
      const result=await client.query(sql,values);await client.query('commit');return result.rows[0]?.result;
    }catch(e){await client.query('rollback');throw e;}finally{client.release();}
  }
  claim(account:string,allowed:string[]):Promise<SmsJob|null>{return this.operation('select private.sms_claim_notification($1,$2::text[]) as result',[account,allowed]);}
  async submitted(attempt:string,messageId:string,status:string,errorCode:string){await this.operation('select private.sms_record_submission($1,$2,$3,$4)',[attempt,messageId,status,errorCode]);}
  async sendError(attempt:string,mode:'rate_limited'|'failed'|'unknown',code:string){await this.operation('select private.sms_record_send_error($1,$2,$3)',[attempt,mode,code]);}
  async delivery(account:string,messageId:string,phone:string,status:string,error:string){await this.operation('select private.sms_receive_delivery($1,$2,$3,$4,$5)',[account,messageId,phone,status,error]);}
}
export interface SmsProvider{
  send(input:{to:string;body:string;validityPeriod:number}):Promise<{messageId:string;status:string;errorCode:string}>;
}
export class AfricasTalkingSmsProvider implements SmsProvider{
  constructor(private readonly configuration:SmsConfiguration,private readonly request:typeof fetch=fetch,private readonly timeoutMs=3500){}
  async send(input:{to:string;body:string;validityPeriod:number}){
    if(!phonePattern.test(input.to)||!this.configuration.allowedRecipients.includes(input.to)||!input.body||input.body.length>640)
      throw {status:400,code:'RECIPIENT_OR_MESSAGE_DENIED'};
    const endpoint=this.configuration.environment==='sandbox'?'https://api.sandbox.africastalking.com/version1/messaging':'https://api.africastalking.com/version1/messaging';
    // One recipient per persisted attempt. Native fetch has no automatic retry.
    // Africa's Talking has no Twilio per-message validity/callback URL parameter.
    const response=await this.request(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),
      headers:{apiKey:this.configuration.apiKey,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username:this.configuration.username,to:input.to,from:this.configuration.from,message:input.body,bulkSMSMode:'1',enqueue:'0'})});
    if(!response.ok)throw {status:response.status,code:response.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_HTTP_REJECTION'};
    const data=await response.json() as {SMSMessageData?:{Recipients?:{number?:unknown;messageId?:unknown;statusCode?:unknown;status?:unknown}[]}};
    const recipients=data?.SMSMessageData?.Recipients;
    if(!Array.isArray(recipients)||recipients.length!==1)throw new Error('Uncertain provider response');
    const recipient=recipients[0];
    if(recipient.number!==input.to)throw new Error('Uncertain provider recipient');
    // 101 means API acceptance (Sent), not handset delivery.
    if(![100,101,102].includes(recipient.statusCode as number)){
      if(typeof recipient.statusCode==='number'&&Number.isInteger(recipient.statusCode)&&recipient.statusCode>=400&&recipient.statusCode<=499)
        throw {status:400,code:`AT_${recipient.statusCode}`};
      throw new Error('Uncertain provider response');
    }
    if(typeof recipient.messageId!=='string'||!messageIdPattern.test(recipient.messageId))throw new Error('Uncertain provider identifier');
    return {messageId:recipient.messageId,status:recipient.statusCode===101?'sent':recipient.statusCode===102?'queued':'accepted',errorCode:''};
  }
}
export function smsMessage(job:SmsJob):string{
  if(job.sampleOnly!==true)throw new Error('Only synthetic check notifications are enabled.');
  if(job.kind==='backup_alert')return job.language==='fr'
    ?"AutoGuardian TEST: une verification attend le proprietaire. Contactez-le. Alerte uniquement; aucune autorisation de vente."
    :'AutoGuardian TEST: a vehicle check awaits the owner. Please contact them. Alert only; you cannot authorize the sale.';
  if(job.kind==='owner_request'||job.kind==='owner_reminder')return job.language==='fr'
    ?`AutoGuardian TEST: demande de verification. Consultez l'application ou le service USSD avant ${job.responseDeadlineAt}.`
    :`AutoGuardian TEST: vehicle check requested. Use the app or USSD service before ${job.responseDeadlineAt}.`;
  return job.language==='fr'?"AutoGuardian TEST: resultat disponible dans l'application ou par USSD. Ce SMS n'autorise aucune vente."
    :'AutoGuardian TEST: check result ready in the app or USSD. This SMS does not authorize a sale.';
}
export function sendFailure(error:unknown):{mode:'rate_limited'|'failed'|'unknown';code:string}{
  const value=error as {status?:unknown;code?:unknown};
  const code=typeof value?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(value.code)?value.code:'PROVIDER_REJECTED';
  if(value?.status===429)return {mode:'rate_limited',code};
  if(typeof value?.status==='number'&&value.status>=400&&value.status<500)return {mode:'failed',code};
  return {mode:'unknown',code:'SEND_OUTCOME_UNKNOWN'};
}
export class SmsDispatcher{
  constructor(private readonly store:SmsStore,private readonly provider:SmsProvider,private readonly configuration:SmsConfiguration){}
  async drain(limit=10){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid SMS batch limit.');
    let processed=0;
    for(;processed<limit;processed++){
      const job=await this.store.claim(this.configuration.providerAccount,this.configuration.allowedRecipients.map(smsPhoneHash));
      if(!job)break;
      if(!this.configuration.allowedRecipients.includes(job.phone)||job.sampleOnly!==true){await this.store.sendError(job.attemptId,'failed','SAMPLE_RECIPIENT_NOT_ALLOWED');continue;}
      const seconds=job.kind==='buyer_result'?300:Math.floor((Date.parse(job.responseDeadlineAt)-Date.now())/1000);
      if(!Number.isFinite(seconds)||seconds<1){await this.store.sendError(job.attemptId,'failed','NOTIFICATION_OBSOLETE');continue;}
      let result;try{result=await this.provider.send({to:job.phone,body:smsMessage(job),validityPeriod:Math.min(seconds,300)});}
      catch(error){const failure=sendFailure(error);await this.store.sendError(job.attemptId,failure.mode,failure.code);continue;}
      // Persistence failure after sending stops the batch; never resend it.
      await this.store.submitted(job.attemptId,result.messageId,result.status,result.errorCode);
    }
    return processed;
  }
}
export class AfricasTalkingSmsWebhooks{
  constructor(private readonly store:SmsStore,private readonly configuration:SmsConfiguration){}
  async receive(token:string|undefined,contentType:string|undefined,body:unknown){
    verifyGateway(token,this.configuration.gatewayToken);const p=formBody(contentType,body);
    const mapping:Record<string,string>={Sent:'sent',Submitted:'sent',Buffered:'queued',Success:'delivered',Delivered:'delivered',Failed:'failed',Rejected:'failed',Expired:'undelivered'};
    if(!messageIdPattern.test(p.id??'')||!phonePattern.test(p.phoneNumber??'')||!Object.hasOwn(mapping,p.status??''))
      throw new BadRequestException({code:'INVALID_DELIVERY_REPORT'});
    await this.store.delivery(this.configuration.providerAccount,p.id,p.phoneNumber,mapping[p.status],['Failed','Rejected','Expired'].includes(p.status)?'AT_DELIVERY_FAILED':'');
  }
}
