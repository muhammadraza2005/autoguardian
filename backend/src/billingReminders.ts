import {BillingStore} from './billing';
import {SmsConfiguration,SmsProvider,AfricasTalkingSmsProvider,smsConfiguration} from './sms';
type Reminder={id:string;leaseId:string;phone:string;body:string};
// SUBMITTED means provider acceptance, never handset delivery. Unknown sends
// and expired send leases are quarantined without automatic resend.
export class BillingReminderDispatcher {
 constructor(private readonly store:BillingStore,private readonly provider:SmsProvider,private readonly configuration:SmsConfiguration){}
 async drain(limit=10){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid reminder batch.');
  let count=0;
  for(;count<limit;count++){
   const job=await this.store.call<Reminder|null>('','billing_sms_claim',[this.configuration.allowedRecipients],true);if(!job)break;
   if(!this.configuration.allowedRecipients.includes(job.phone)||!job.body||job.body.length>320){
    await this.store.call('','billing_sms_finish',[job.id,job.leaseId,'FAILED',null],true);continue;
   }
   let status='UNKNOWN',reference:string|null=null;
   try{const result=await this.provider.send({to:job.phone,body:job.body,validityPeriod:300});
    reference=result.messageId;status=['failed','undelivered','canceled'].includes(result.status)?'FAILED':'SUBMITTED';
   }catch(error){const http=(error as {status?:number}).status;if(http&&http>=400&&http<500)status='FAILED';}
   await this.store.call('','billing_sms_finish',[job.id,job.leaseId,status,reference],true);
  }
  return count;
 }
}
export function configuredBillingReminders(env:NodeJS.ProcessEnv,store:BillingStore){
 if(env.BILLING_REMINDER_SMS_ENABLED!=='true')return undefined;
 const configuration=smsConfiguration(env);
 if(!configuration||env.BILLING_REMINDER_SMS_APPROVED!=='true')throw new Error('Billing SMS requires approved copy and an enabled Africa Talking sender.');
 // Receipt of the SMS is unverified; no vehicle-check callback is reused.
 return new BillingReminderDispatcher(store,new AfricasTalkingSmsProvider(configuration),configuration);
}
