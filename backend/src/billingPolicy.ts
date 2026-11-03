import {BadRequestException} from '@nestjs/common';
import {fields} from './checks';

// No commercial or offline policy is supplied by the application.
export function billingPolicy(value:unknown){
 const v=fields(value,['productionEnabled','billingRevision','approvalReference','receiptValidityDays','graceAccess',
   'protectedFeatures','smsEnabled','smsEn','smsFr','receiptIdentity','offlineEnabled','offlineHours']);
 for(const k of ['productionEnabled','graceAccess','smsEnabled','offlineEnabled'])if(typeof v[k]!=='boolean')invalid();
 for(const [k,min,max] of [['billingRevision',1,2147483647],['receiptValidityDays',1,366],['offlineHours',0,72]] as const)
  if(!Number.isInteger(v[k])||Number(v[k])<min||Number(v[k])>max)invalid();
 if(v.offlineEnabled&&Number(v.offlineHours)===0)invalid();
 if(typeof v.approvalReference!=='string'||v.approvalReference.trim().length<1||v.approvalReference.length>200)invalid();
 if(!Array.isArray(v.protectedFeatures)||v.protectedFeatures.length>1||v.protectedFeatures.some(x=>x!=='institutional_lock'))invalid();
 for(const k of ['smsEn','smsFr'])if(typeof v[k]!=='string'||v[k].length>320||v.smsEnabled&&!v[k].trim())invalid();
 const identity=fields(v.receiptIdentity,['businessName','address','registrationNumber']);
 for(const k of ['businessName','address','registrationNumber'])if(typeof identity[k]!=='string'||!identity[k].trim()||identity[k].length>300)invalid();
 return {...v,receiptIdentity:identity};
}
function invalid():never{throw new BadRequestException({code:'INVALID_BILLING_POLICY'});}

export function settlementInput(value:unknown){
 const v=fields(value,['sourceReference','items']);
 if(typeof v.sourceReference!=='string'||!v.sourceReference.trim()||v.sourceReference.length>200
    ||!Array.isArray(v.items)||!v.items.length||v.items.length>1000)invalid();
 const seen=new Set<string>();
 const items=v.items.map(row=>{
  const r=fields(row,['depositId','amount','currency','status','providerReference']);
  if(typeof r.depositId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.depositId)
    ||seen.has(r.depositId.toLowerCase())||typeof r.amount!=='string'||!/^\d{1,16}(?:\.\d{1,4})?$/.test(r.amount)
    ||!['CDF','USD'].includes(String(r.currency))||!['COMPLETED','FAILED'].includes(String(r.status))
    ||typeof r.providerReference!=='string'||!r.providerReference.trim()||r.providerReference.length>128)invalid();
  seen.add(r.depositId.toLowerCase());return r;
 });
 return {...v,items};
}
