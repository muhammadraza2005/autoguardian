import test from 'node:test';import assert from 'node:assert/strict';
import {ownerDetailsSchema,ownerSaveSchema,ownerConsentSchema,ownerSnapshotSchema,readOwner,saveOwner,recordOwnerConsent} from '../src/features/enrollment/owner.ts';
import {ownerEn,ownerFr} from '../src/i18n/ownerResources.ts';
const id='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002';
const details={type:'INDIVIDUAL',name:'Fictional Owner',idDocumentType:'SAMPLE',idDocumentNumber:'SAMPLE-ID',phone:'+243000000000',preferredLanguage:'en',companyRegistration:null,representativeName:null};
const snapshot={draftId:id,draftRevision:2,ownerProfileId:key,ownerGeneration:2,details,savedAt:'2026-10-08T12:00:00Z',
  documents:[{version:'sample-v1',language:'en',termsText:'Sample terms',dataText:'Sample data'}],consent:null,
  sampleOnly:true,phoneVerified:false,productionConsentVerified:false};
const consent={expectedDraftRevision:2,ownerGeneration:2,version:'sample-v1',language:'en',accept:true,termsAccepted:true,dataAccepted:true};
test('owner schemas validate individual/company fields and prohibit fabricated consent or verified status',()=>{
  assert.equal(ownerDetailsSchema.parse(details).type,'INDIVIDUAL');
  for(const patch of [{phone:'1234'},{name:' '},{preferredLanguage:'de'},{phoneVerified:true},{companyRegistration:'EXTRA'},
    {type:'COMPANY'},{idDocumentNumber:'bad\nID'}])assert.throws(()=>ownerDetailsSchema.parse({...details,...patch}));
  assert.equal(ownerDetailsSchema.parse({...details,type:'COMPANY',companyRegistration:'SAMPLE',representativeName:'Fictional Representative'}).type,'COMPANY');
  for(const patch of [{termsAccepted:false},{dataAccepted:false},{acceptedAt:'forged'},{ownerGeneration:0},{accept:false}])
    assert.throws(()=>ownerConsentSchema.parse({...consent,...patch}));
  assert.throws(()=>ownerSaveSchema.parse({expectedDraftRevision:0,details}));
  for(const patch of [{phoneVerified:true},{productionConsentVerified:true},{sampleOnly:false},{details:null},
    {consent:{status:'RECORDED',version:'stale',language:'en',recordedAt:snapshot.savedAt,recordedByProfileId:key,source:'AGENT_RECORDED_SAMPLE'}},
    {documents:[...snapshot.documents,...snapshot.documents]}])assert.throws(()=>ownerSnapshotSchema.parse({...snapshot,...patch}));
});
test('owner adapters bind route/request keys, propagate denial and strip server-only fields',async()=>{
  const signal=new AbortController().signal;let calls=0;
  assert.equal((await readOwner(async(path,options)=>{calls++;assert.equal(path,'/v1/enrollment-drafts/'+id+'/owner');assert.equal(options.signal,signal);return {...snapshot,ciphertext:'secret'};},id,signal)).draftId,id);
  await assert.rejects(readOwner(async()=>{calls++;return snapshot;},'invalid'));assert.equal(calls,1);
  await assert.rejects(readOwner(async()=>({...snapshot,draftId:key}),id));
  await assert.rejects(readOwner(async()=>{throw new Error('revoked');},id),/revoked/);
  for(const [save,path,body] of [[saveOwner,'owner',{expectedDraftRevision:1,details}],[recordOwnerConsent,'owner/consent',consent]]) {
    const result=await save(async(route,options)=>{assert.equal(route,'/v1/enrollment-drafts/'+id+'/'+path);assert.equal(options.method,'POST');assert.equal(options.idempotencyKey,key);assert.deepEqual(options.body,body);return snapshot;},id,key,body);
    assert.ok(!('ciphertext' in result));assert.equal(result.phoneVerified,false);
  }
});
test('owner fields and consent states have both languages',()=>{
  for(const copy of [ownerEn,ownerFr]){
    for(const field of ['name','companyRegistration','representativeName','idDocumentType','idDocumentNumber','phone','preferredLanguage'])assert.ok(copy.fields[field]);
    for(const state of ['recorded','withdrawn','uncertain','setup','notice','phonePending'])assert.ok(copy[state]);
  }
});
