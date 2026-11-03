import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentSchema,paymentListSchema,quoteSchema,livePaymentSchema} from '../src/features/billing/contracts.ts';
import {billingOpsEn,billingOpsFr} from '../src/features/billing/billingOperationsResources.ts';
import {billingEn,billingFr} from '../src/features/billing/billingResources.ts';
const id='00000000-0000-4000-8000-000000000001';
const payment={id,purpose:'CHECK',targetId:id,targetRevision:0,amount:'1000.0000',currency:'CDF',status:'PROCESSING',createdAt:'2026-10-13T00:00:00Z',
 confirmedAt:null,providerReference:null,receiptNumber:null,sampleOnly:true};
test('billing responses reject production claims, leaked payer details, unsupported status and malformed money',()=>{
 assert.equal(paymentSchema.safeParse(payment).success,true);
 for(const value of [{...payment,sampleOnly:false},{...payment,status:'PAID'},{...payment,phoneNumber:'243813456789'},
  {...payment,amount:'NaN'},{...payment,currency:'EUR'}])assert.equal(paymentSchema.safeParse(value).success,false);
 assert.equal(paymentListSchema.safeParse({items:[payment],sampleOnly:true}).success,true);
 assert.equal(quoteSchema.safeParse({configured:true,allowed:false,freeRemaining:0,amount:'1000',currency:'CDF',sampleOnly:true}).success,true);
});
test('billing English and French cover the same user states and fields',()=>{
 const keys=(v,p='')=>Object.entries(v).flatMap(([k,x])=>typeof x==='object'?keys(x,p+k+'.'):[p+k]).sort();
 assert.deepEqual(keys(billingEn),keys(billingFr));
 assert.deepEqual(keys(billingOpsEn),keys(billingOpsFr));
});
test('live receipt contracts cannot accept sandbox confirmations or leak private wallet details',()=>{
 const live={...payment,purpose:'REGISTRATION',sampleOnly:false,receiptIdentity:null};
 assert.equal(livePaymentSchema.safeParse(live).success,true);
 assert.equal(livePaymentSchema.safeParse({...live,sampleOnly:true}).success,false);
 assert.equal(livePaymentSchema.safeParse({...live,phoneNumber:'243813456789'}).success,false);
 assert.equal(livePaymentSchema.safeParse({...live,purpose:'CHECK'}).success,false);
});
