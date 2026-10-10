import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,validOtp,resendSeconds} from '../src/features/auth/phone.ts';
import {sendPhoneOtp,verifyPhoneOtp} from '../src/features/auth/phoneOtp.ts';
import {checkResult,checkView,readCheck,inboxItem} from '../src/features/checks/contracts.ts';
import {checkEn,checkFr} from '../src/i18n/checkResources.ts';
const id='00000000-0000-4000-8000-000000000001';
const result={id,outcome:'approved',responseDeadlineAt:'2026-10-11T01:00:00Z',respondedAt:'2026-10-11T00:59:00Z',
  resultExpiresAt:'2026-10-12T00:59:00Z',expired:false,authorizationUsable:true,sampleOnly:true,vehicle:{id,chassisIdentifier:'TEST',plate:'TEST-01',category:'CAR',
    make:null,model:null,manufactureYear:null,color:null,saleStatus:'NOT_FOR_SALE',recordStatus:'ACTIVE'}};
test('international phone normalization never guesses a national number or treats OTP typing as proof',()=>{
  assert.equal(normalizePhone('+243 (81) 234-5678'),'+243812345678');assert.equal(normalizePhone('00243 812345678'),'+243812345678');
  for(const phone of ['0812345678','+000000000','+24381234abc','+243812345678\nsecret','+243+812345678','+1234567890123456'])assert.throws(()=>normalizePhone(phone));
  assert.equal(validOtp('123456'),true);for(const token of ['12345','1234567','secret','123 456'])assert.equal(validOtp(token),false);
  assert.equal(resendSeconds(60000,59999),1);assert.equal(resendSeconds(60000,61000),0);
});
test('buyer contract rejects extra identity and seal data and expiry is independent of outcome',()=>{
  const parsed=checkResult.parse(result);assert.equal(checkView(parsed,Date.parse('2026-10-11T02:00:00Z')).usable,false);
  assert.equal(checkView(parsed,Date.parse('2026-10-12T01:00:00Z')).outcome,'expired');assert.equal(parsed.outcome,'approved');
  for(const value of [{...result,ownerPhone:'secret'},{...result,vehicle:{...result.vehicle,legalName:'secret'}},{...result,vehicle:{...result.vehicle,alarmPositions:[]}}])assert.equal(checkResult.safeParse(value).success,false);
  assert.equal(inboxItem.safeParse({id,vehicleId:id,plate:null,responseDeadlineAt:result.responseDeadlineAt,sampleOnly:true,buyerPhone:'secret'}).success,false);
});
test('check retrieval scopes full reference and does not return stale data on network failure',async()=>{
  const controller=new AbortController();assert.equal((await readCheck(async(path,options)=>{assert.equal(path,'/v1/vehicle-checks/'+id);assert.equal(options.signal,controller.signal);return result;},id,controller.signal)).id,id);
  await assert.rejects(readCheck(async()=>{throw new Error('Offline');},id));await assert.rejects(readCheck(async()=>result,'guess'));
});
test('new milestone screens have matching English and French keys',()=>{
  function keys(v,p=''){return Object.entries(v).flatMap(([k,x])=>typeof x==='string'?[p+k]:keys(x,p+k+'.'));}
  assert.deepEqual(keys(checkEn).sort(),keys(checkFr).sort());
});
test('phone sign-in calls the provider and rejects expired/rate-limited/incorrect codes and missing sessions',async()=>{
  let calls=0;const auth={signInWithOtp:async input=>{assert.equal(input.phone,'+243812345678');return {error:null};},
    verifyOtp:async input=>{calls++;assert.equal(input.type,'sms');assert.equal(input.phone,'+243812345678');return {error:null,data:{session:{}}};}};
  assert.equal(await sendPhoneOtp(auth,'00243 81 234 5678'),'+243812345678');await verifyPhoneOtp(auth,'+243812345678','123456');assert.equal(calls,1);
  await assert.rejects(verifyPhoneOtp(auth,'+243812345678','12345'));assert.equal(calls,1);
  for(const error of ['otp_expired','invalid_otp','over_sms_send_rate_limit']){
    await assert.rejects(sendPhoneOtp({...auth,signInWithOtp:async()=>({error})},'+243812345678'));
    await assert.rejects(verifyPhoneOtp({...auth,verifyOtp:async()=>({error,data:{session:{}}})},'+243812345678','123456'));
  }
  await assert.rejects(verifyPhoneOtp({...auth,verifyOtp:async()=>({error:null,data:{session:null}})},'+243812345678','123456'));
});
