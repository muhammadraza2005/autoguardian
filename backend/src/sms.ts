import {createHash} from 'node:crypto';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {Pool} from 'pg';
import twilio from 'twilio';

const phonePattern=/^\+[1-9]\d{7,14}$/;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statuses=new Set(['accepted','queued','sending','sent','delivered','failed','undelivered','canceled']);
export const smsPhoneHash=(phone:string)=>createHash('sha256').update(phone).digest('hex');
export type SmsConfiguration={accountSid:string;authToken:string;previousAuthToken?:string;
  from?:string;messagingServiceSid?:string;callbackBaseUrl:string;allowedRecipients:string[]};

export function smsConfiguration(env:NodeJS.ProcessEnv):SmsConfiguration|undefined{
  const enabled=env.TWILIO_SMS_ENABLED??'false';
  if(!['true','false'].includes(enabled))throw new Error('TWILIO_SMS_ENABLED must be true or false.');
  if(enabled==='false')return undefined;
  const required=['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_STATUS_CALLBACK_BASE_URL','TWILIO_SAMPLE_RECIPIENTS_JSON'] as const;
  for(const key of required)if(!env[key]?.trim())throw new Error(`Missing ${key}.`);
  if(!/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID!))throw new Error('Invalid TWILIO_ACCOUNT_SID.');
  // Twilio Auth Tokens are 32 hexadecimal characters; no placeholder accepted.
  for(const key of ['TWILIO_AUTH_TOKEN','TWILIO_PREVIOUS_AUTH_TOKEN'] as const)
    if(env[key]&&!/^[0-9a-fA-F]{32}$/.test(env[key]!))throw new Error(`Invalid ${key}.`);
  const from=env.TWILIO_FROM_NUMBER?.trim()||undefined,service=env.TWILIO_MESSAGING_SERVICE_SID?.trim()||undefined;
  if(Boolean(from)===Boolean(service))throw new Error('Configure exactly one Twilio sender: FROM_NUMBER or MESSAGING_SERVICE_SID.');
  if(from&&!phonePattern.test(from))throw new Error('TWILIO_FROM_NUMBER must use E.164 format.');
  if(service&&!/^MG[0-9a-fA-F]{32}$/.test(service))throw new Error('Invalid TWILIO_MESSAGING_SERVICE_SID.');
  let url:URL;try{url=new URL(env.TWILIO_STATUS_CALLBACK_BASE_URL!);}catch{throw new Error('Invalid TWILIO_STATUS_CALLBACK_BASE_URL.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash
      ||url.pathname!=='/v1/webhooks/twilio/sms'||url.hostname.includes('_')
      ||['localhost','127.0.0.1','[::1]'].includes(url.hostname))
    throw new Error('Twilio callbacks require a public HTTPS URL ending in /v1/webhooks/twilio/sms.');
  let allowed:unknown;try{allowed=JSON.parse(env.TWILIO_SAMPLE_RECIPIENTS_JSON!);}catch{throw new Error('Invalid TWILIO_SAMPLE_RECIPIENTS_JSON.');}
  if(!Array.isArray(allowed)||!allowed.length||allowed.length>20||allowed.some(v=>typeof v!=='string'||!phonePattern.test(v)))
    throw new Error('TWILIO_SAMPLE_RECIPIENTS_JSON must contain 1–20 E.164 test recipients.');
  return {accountSid:env.TWILIO_ACCOUNT_SID!,authToken:env.TWILIO_AUTH_TOKEN!,previousAuthToken:env.TWILIO_PREVIOUS_AUTH_TOKEN||undefined,
    from,messagingServiceSid:service,callbackBaseUrl:url.href,allowedRecipients:[...new Set(allowed)]};
}

export type SmsJob={notificationId:string;attemptId:string;requestId:string;kind:'owner_request'|'owner_reminder'|'buyer_result';
  phone:string;language:'en'|'fr';responseDeadlineAt:string;sampleOnly:true};
export type SmsStatus={attemptId:string;accountSid:string;messageSid:string;status:string;errorCode:string;phone:string};
export interface SmsStore{
  claim(accountSid:string,allowedHashes:string[]):Promise<SmsJob|null>;
  submitted(attemptId:string,messageSid:string,status:string,errorCode:string):Promise<void>;
  sendError(attemptId:string,mode:'rate_limited'|'failed'|'unknown',code:string):Promise<void>;
  callback(notificationId:string,status:SmsStatus):Promise<void>;
}
export class PostgresSmsStore implements SmsStore{
  constructor(private readonly pool:Pool,private readonly tenantId:string){}
  private async operation(sql:string,values:unknown[]){
    const client=await this.pool.connect();try{
      await client.query('begin');
      // Worker and authenticated provider callback have no application user.
      // Scope comes from the server's configured tenant, never callback input.
      await client.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id','',true)`,[this.tenantId]);
      const result=await client.query(sql,values);await client.query('commit');return result.rows[0]?.result;
    }catch(e){await client.query('rollback');throw e;}finally{client.release();}
  }
  claim(accountSid:string,allowedHashes:string[]):Promise<SmsJob|null>{
    return this.operation('select private.sms_claim_notification($1,$2::text[]) as result',[accountSid,allowedHashes]);
  }
  async submitted(attemptId:string,messageSid:string,status:string,errorCode:string){
    await this.operation('select private.sms_record_submission($1,$2,$3,$4)',[attemptId,messageSid,status,errorCode]);
  }
  async sendError(attemptId:string,mode:'rate_limited'|'failed'|'unknown',code:string){
    await this.operation('select private.sms_record_send_error($1,$2,$3)',[attemptId,mode,code]);
  }
  async callback(notificationId:string,status:SmsStatus){
    await this.operation('select private.sms_record_callback($1,$2,$3,$4,$5,$6,$7)',
      [notificationId,status.attemptId,status.accountSid,status.messageSid,status.status,status.errorCode,status.phone]);
  }
}

export interface SmsProvider{
  send(input:{to:string;body:string;callbackUrl:string;validityPeriod:number}):Promise<{messageSid:string;status:string;errorCode:string}>;
}
export class TwilioSmsProvider implements SmsProvider{
  private readonly client;
  constructor(private readonly configuration:SmsConfiguration){
    // Bounded retries are persisted in PostgreSQL. SDK/network retries would
    // bypass the attempt record, so explicitly disable them.
    this.client=twilio(configuration.accountSid,configuration.authToken,{autoRetry:false,timeout:10000});
  }
  async send(input:{to:string;body:string;callbackUrl:string;validityPeriod:number}){
    const message=await this.client.messages.create({to:input.to,body:input.body,statusCallback:input.callbackUrl,
      validityPeriod:input.validityPeriod,...(this.configuration.messagingServiceSid
        ?{messagingServiceSid:this.configuration.messagingServiceSid}:{from:this.configuration.from!})});
    return {messageSid:message.sid,status:message.status,errorCode:message.errorCode===null?'':String(message.errorCode)};
  }
}
export function smsMessage(job:SmsJob):string{
  if(job.sampleOnly!==true)throw new Error('Only synthetic check notifications are enabled.');
  if(job.kind==='owner_request'||job.kind==='owner_reminder')return job.language==='fr'
    ?`AutoGuardian TEST: demande de verification. Ouvrez l'application avant ${job.responseDeadlineAt}. Ne repondez pas par SMS.`
    :`AutoGuardian TEST: vehicle check requested. Open the app before ${job.responseDeadlineAt}. Do not reply by SMS.`;
  return job.language==='fr'
    ?'AutoGuardian TEST: resultat disponible. Consultez le statut actuel dans l\'application. Ce SMS n\'autorise aucune vente.'
    :'AutoGuardian TEST: check result ready. Open the app for current status. This SMS does not authorize a sale.';
}
function sendFailure(error:unknown):{mode:'rate_limited'|'failed'|'unknown';code:string}{
  const value=error as {status?:unknown;code?:unknown};
  const code=typeof value?.code==='number'&&Number.isInteger(value.code)&&value.code>=1000&&value.code<=999999
    ?String(value.code):'SEND_OUTCOME_UNKNOWN';
  if(value?.status===429)return {mode:'rate_limited',code:code==='SEND_OUTCOME_UNKNOWN'?'20429':code};
  if(typeof value?.status==='number'&&value.status>=400&&value.status<500)return {mode:'failed',code:code==='SEND_OUTCOME_UNKNOWN'?'PROVIDER_REJECTED':code};
  // Timeouts, connection failures and 5xx responses may follow acceptance.
  // Without a provider idempotency guarantee, quarantine rather than resend.
  return {mode:'unknown',code:'SEND_OUTCOME_UNKNOWN'};
}
export class SmsDispatcher{
  constructor(private readonly store:SmsStore,private readonly provider:SmsProvider,private readonly configuration:SmsConfiguration){}
  async drain(limit=10){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid SMS batch limit.');
    let processed=0;
    for(;processed<limit;processed++){
      const job=await this.store.claim(this.configuration.accountSid,this.configuration.allowedRecipients.map(smsPhoneHash));
      if(!job)break;
      if(!this.configuration.allowedRecipients.includes(job.phone)||job.sampleOnly!==true){
        await this.store.sendError(job.attemptId,'failed','SAMPLE_RECIPIENT_NOT_ALLOWED');continue;
      }
      const seconds=job.kind==='owner_request'||job.kind==='owner_reminder'?Math.floor((Date.parse(job.responseDeadlineAt)-Date.now())/1000):300;
      if(!Number.isFinite(seconds)||seconds<1){await this.store.sendError(job.attemptId,'failed','NOTIFICATION_OBSOLETE');continue;}
      let result;
      try{result=await this.provider.send({to:job.phone,body:smsMessage(job),
        callbackUrl:`${this.configuration.callbackBaseUrl}/${job.notificationId}/${job.attemptId}`,
        validityPeriod:Math.min(seconds,300)});}catch(error){
        const failure=sendFailure(error);await this.store.sendError(job.attemptId,failure.mode,failure.code);continue;
      }
      // A DB failure here must terminate this drain. Never treat it as a
      // provider rejection or trigger a second external send.
      await this.store.submitted(job.attemptId,result.messageSid,result.status,result.errorCode);
    }
    return processed;
  }
}

export class TwilioSmsWebhooks{
  constructor(private readonly store:SmsStore,private readonly configuration:SmsConfiguration){}
  async receive(notificationId:string,attemptId:string,path:string,signature:string|undefined,contentType:string|undefined,body:unknown){
    if(!uuidPattern.test(notificationId)||!uuidPattern.test(attemptId)
      ||path!==`/v1/webhooks/twilio/sms/${notificationId}/${attemptId}`)
      throw new BadRequestException({code:'INVALID_SMS_CALLBACK_PATH'});
    if(contentType?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded'
      ||!body||typeof body!=='object'||Array.isArray(body)
      ||Object.values(body).some(value=>typeof value!=='string'))
      throw new BadRequestException({code:'INVALID_SMS_CALLBACK_BODY'});
    const params=body as Record<string,string>,url=`${this.configuration.callbackBaseUrl}/${notificationId}/${attemptId}`;
    // Validate every received parameter, including future provider fields.
    // The public URL is configured, never derived from Host/forwarded headers.
    if(!signature||![this.configuration.authToken,this.configuration.previousAuthToken].some(token=>token&&twilio.validateRequest(token,signature,url,params)))
      throw new ForbiddenException({code:'INVALID_TWILIO_SIGNATURE'});
    if(params.AccountSid!==this.configuration.accountSid)throw new ForbiddenException({code:'TWILIO_ACCOUNT_MISMATCH'});
    if(!/^(SM|MM)[0-9a-fA-F]{32}$/.test(params.MessageSid??'')||!statuses.has(params.MessageStatus)
      ||!phonePattern.test(params.To??'')||!/^\d{0,6}$/.test(params.ErrorCode??''))
      throw new BadRequestException({code:'INVALID_SMS_CALLBACK_STATUS'});
    try{await this.store.callback(notificationId,{attemptId,accountSid:params.AccountSid,messageSid:params.MessageSid,
      status:params.MessageStatus,errorCode:params.ErrorCode??'',phone:params.To});}
    catch(error){if((error as {code?:string}).code==='42501')throw new ForbiddenException({code:'SMS_CALLBACK_MISMATCH'});throw error;}
  }
}
