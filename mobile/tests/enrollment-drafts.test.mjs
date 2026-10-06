import test from 'node:test';
import assert from 'node:assert/strict';
import { draftBodySchema, enrollmentDraftSchema, readDraftPage, readDraft, readOwnerOptions, saveDraft } from '../src/features/enrollment/drafts.ts';
const id='00000000-0000-4000-8000-000000000001';
const org='00000000-0000-4000-8000-000000000002';
const owner='00000000-0000-4000-8000-000000000003';
const key='00000000-0000-4000-8000-000000000004';
const body={organizationId:org,ownerProfileId:owner,vehicle:{chassisIdentifier:'DRAFT-002',plate:'DRAFT-002',category:'CAR',
  make:null,model:null,manufactureYear:null,color:null}};
const draft={...body,id,status:'DRAFT',revision:1,createdAt:'2026-10-06T00:00:00+00:00',updatedAt:'2026-10-06T00:00:00+00:00'};

test('draft save retries retain the same creation key and edits send the expected revision',async()=>{
  const calls=[];
  const request=async(path,options)=>{calls.push({path,options});return {draft};};
  await saveDraft(request,body,{key});await saveDraft(request,body,{key});
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].options.idempotencyKey,key);
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].path,'/v1/enrollment-drafts');
  await saveDraft(request,body,{id,revision:1});
  assert.equal(calls[2].options.method,'PUT');assert.equal(calls[2].options.body.expectedRevision,1);
  assert.equal(calls[2].options.idempotencyKey,undefined);
  assert.equal(calls[2].path,'/v1/enrollment-drafts/'+id);
  await assert.rejects(saveDraft(request,body,{id,revision:0}));
});

test('draft responses cannot present active enrollment or private owner evidence',async()=>{
  assert.throws(()=>enrollmentDraftSchema.parse({...draft,status:'ACTIVE'}));
  const value=enrollmentDraftSchema.parse({...draft,legalName:'Private',documentUrl:'private-file',creation_payload:'internal'});
  assert.equal('legalName' in value,false);assert.equal('creation_payload' in value,false);
  assert.equal('documentUrl' in value,false);
  assert.throws(()=>draftBodySchema.parse({...body,ownerProfileId:'invalid'}));
  const page=await readDraftPage(async()=>({items:[],nextCursor:null}));assert.deepEqual(page.items,[]);
  await assert.rejects(readDraftPage(async()=>({items:[],nextCursor:id})));
  await assert.rejects(readDraft(async()=>({draft:{...draft,id:owner}}),id));
  assert.equal((await readDraft(async()=>({draft}),id)).status,'DRAFT');
});

test('duplicate, revoked-agent and network failures propagate without local save confirmation',async()=>{
  for(const status of [403,409,422,503]) {
    const error=Object.assign(new Error('Save failed'),{status});
    await assert.rejects(saveDraft(async()=>{throw error;},body,{key}),e=>e===error);
  }
});

test('owner choices use a scoped endpoint and cannot expose identity or claim verification',async()=>{
  const option={profileId:owner,label:'Development owner 1',verificationStatus:'NOT_VERIFIED'};
  const result=await readOwnerOptions(async(path,options)=>{
    assert.equal(path,'/v1/enrollment-drafts/owner-options?organizationId='+org);
    assert.equal(options.method,undefined);
    return {items:[{...option,phone:'+123456789',legalName:'Private',documentUrl:'private-file'}]};
  },org);
  assert.deepEqual(result,[option]);
  assert.deepEqual(await readOwnerOptions(async()=>({items:[]}),org),[]);
  await assert.rejects(readOwnerOptions(async()=>({items:[{...option,verificationStatus:'VERIFIED'}]}),org));
  await assert.rejects(readOwnerOptions(async()=>({items:[{...option,label:'Real Person'}]}),org));
  await assert.rejects(readOwnerOptions(async()=>({items:[option,option]}),org));
  let requested=false;
  await assert.rejects(readOwnerOptions(async()=>{requested=true;return {items:[]};},'invalid'));
  assert.equal(requested,false);
});
