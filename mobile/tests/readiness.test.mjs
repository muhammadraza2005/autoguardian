import test from 'node:test';import assert from 'node:assert/strict';
import {checkCodes,productionCheckCodes,readReadiness,readinessSchema} from '../src/features/enrollment/readiness.ts';
import {readinessEn,readinessFr} from '../src/i18n/readinessResources.ts';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const snapshot={draftId:id,draftRevision:1,fittingRevision:0,package:null,
  vehicle:{chassisIdentifier:'SAMPLE',plate:null,category:'CAR'},sampleOnly:true,canSubmit:false,enrollmentActive:false,
  checks:checkCodes.map(code=>({code,status:productionCheckCodes.includes(code)?'UNAVAILABLE':code==='VEHICLE_DRAFT'?'COMPLETE':'MISSING'}))};
test('readiness rejects incomplete checklists, active claims and production success from sample data',()=>{
  assert.equal(readinessSchema.parse(snapshot).canSubmit,false);
  for(const patch of [{canSubmit:true},{enrollmentActive:true},{sampleOnly:false},
    {checks:snapshot.checks.slice(1)},{checks:snapshot.checks.map(c=>c.code==='PAYMENT'?{...c,status:'COMPLETE'}:c)},
    {checks:snapshot.checks.map(c=>c.code==='OWNER_PHONE'?{...c,code:'PAYMENT'}:c)},
    {checks:snapshot.checks.map(c=>c.code==='SEAL_FITTING'?{...c,status:'COMPLETE'}:c)}])
    assert.throws(()=>readinessSchema.parse({...snapshot,...patch}));
});
test('readiness uses the scoped read endpoint, validates route identity and propagates unavailable access',async()=>{
  const controller=new AbortController();let calls=0;
  const request=async(path,options)=>{calls++;assert.equal(path,'/v1/enrollment-drafts/'+id+'/readiness');assert.equal(options.signal,controller.signal);return snapshot;};
  assert.equal((await readReadiness(request,id,controller.signal)).draftId,id);
  await assert.rejects(readReadiness(request,'invalid'));assert.equal(calls,1);
  await assert.rejects(readReadiness(async()=>({...snapshot,draftId:other}),id));
  await assert.rejects(readReadiness(async()=>{throw new Error('Access revoked');},id),/Access revoked/);
  const result=await readReadiness(async()=>({...snapshot,ownerPhone:'private',vehicle:{...snapshot.vehicle,ownerName:'private'}}),id);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('every readiness requirement and state has English and French copy',()=>{
  for(const language of [readinessEn,readinessFr]){
    for(const code of checkCodes){assert.ok(language.checks[code].title);assert.ok(language.checks[code].hint);}
    for(const state of ['COMPLETE','MISSING','STALE','UNAVAILABLE'])assert.ok(language.statuses[state]);
  }
});
