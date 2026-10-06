import test from 'node:test';import assert from 'node:assert/strict';
import {sampleFilePayload,listEvidence,uploadEvidence,readEvidence} from '../src/features/enrollment/evidence.ts';
const draft='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
const item={id,kind:'OWNER_ID',mimeType:'application/pdf',byteSize:3,status:'STAGED',createdAt:'2026-10-06T00:00:00+00:00'};
test('sample upload checks size/type and repeats only the exact scoped payload/key',async()=>{
  const body=sampleFilePayload('OWNER_ID','data:application/pdf;base64,YWJj',3);const calls=[];
  const request=async(path,options)=>{calls.push({path,options});return {attachment:{...item,object_path:'private',sha256:'internal'}};};
  const saved=await uploadEvidence(request,draft,id,body);await uploadEvidence(request,draft,id,body);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].options.idempotencyKey,id);
  assert.equal(calls[0].path,'/v1/enrollment-drafts/'+draft+'/attachments');assert.equal('object_path' in saved,false);
  assert.throws(()=>sampleFilePayload('VEHICLE_PHOTO','data:application/pdf;base64,YWJj',3));
  assert.throws(()=>sampleFilePayload('SEAL_FITTING_PHOTO','data:application/pdf;base64,YWJj',3));
  assert.throws(()=>sampleFilePayload('OWNER_ID','data:application/pdf;base64,YWJj',2097153));
  await assert.rejects(uploadEvidence(async()=>({attachment:{...item,status:'APPROVED'}}),draft,id,body));
});
test('attachment reads require a review reason and never accept another file or a non-sample capability',async()=>{
  assert.equal((await listEvidence(async()=>({items:[item],uploadsEnabled:false,sampleOnly:true,maxBytes:2097152}),draft)).uploadsEnabled,false);
  await assert.rejects(listEvidence(async()=>({items:[item],uploadsEnabled:true,sampleOnly:false,maxBytes:2097152}),draft));
  const file=await readEvidence(async(path,options)=>{assert.equal(options.body.reason,'ENROLLMENT_REVIEW');return {id,mimeType:'application/pdf',dataBase64:'YWJj'};},draft,id);
  assert.equal(file.id,id);
  await assert.rejects(readEvidence(async()=>({id:draft,mimeType:'application/pdf',dataBase64:'YWJj'}),draft,id));
  await assert.rejects(uploadEvidence(async()=>{throw new Error('Connection lost');},draft,id,{kind:'OWNER_ID',dataBase64:'YWJj'}));
});
