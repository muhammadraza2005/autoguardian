import test from 'node:test';import assert from 'node:assert/strict';
import {sampleFilePayload,listEvidence,uploadEvidence,readEvidence} from '../src/features/enrollment/evidence.ts';
import {evidenceRequirements,evidenceChecklistSchema} from '../src/features/enrollment/evidenceChecklist.ts';
import {evidenceEn,evidenceFr} from '../src/i18n/evidenceResources.ts';
const draft='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
const item={id,kind:'OWNER_ID',mimeType:'application/pdf',byteSize:3,status:'STAGED',createdAt:'2026-10-06T00:00:00+00:00'};
const checklist={version:1,complete:false,items:evidenceRequirements.map(r=>({code:r.code,status:r.code==='OWNER_ID'?'COMPLETE':'MISSING'}))};
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
  assert.equal((await listEvidence(async()=>({items:[item],evidenceChecklist:checklist,uploadsEnabled:false,sampleOnly:true,maxBytes:2097152}),draft)).uploadsEnabled,false);
  await assert.rejects(listEvidence(async()=>({items:[item],evidenceChecklist:checklist,uploadsEnabled:true,sampleOnly:false,maxBytes:2097152}),draft));
  const file=await readEvidence(async(path,options)=>{assert.equal(options.body.reason,'ENROLLMENT_REVIEW');return {id,mimeType:'application/pdf',dataBase64:'YWJj'};},draft,id);
  assert.equal(file.id,id);
  await assert.rejects(readEvidence(async()=>({id:draft,mimeType:'application/pdf',dataBase64:'YWJj'}),draft,id));
  await assert.rejects(uploadEvidence(async()=>{throw new Error('Connection lost');},draft,id,{kind:'OWNER_ID',dataBase64:'YWJj'}));
});

test('the detailed checklist rejects incomplete schemas, false completion and generic photo substitution',async()=>{
  const response={items:[item],evidenceChecklist:checklist,uploadsEnabled:true,sampleOnly:true,maxBytes:2097152};
  for(const patch of [{complete:true},{items:checklist.items.slice(1)},
    {items:checklist.items.map(r=>({...r,code:'OWNER_ID'}))},
    {items:checklist.items.map(r=>({...r,status:'APPROVED'}))}])assert.throws(()=>evidenceChecklistSchema.parse({...checklist,...patch}));
  await assert.rejects(listEvidence(async()=>({...response,evidenceChecklist:undefined}),draft));
  await assert.rejects(listEvidence(async()=>({...response,items:[{...item,status:'PENDING'}]}),draft));
  const generic={...item,id:draft,kind:'VEHICLE_PHOTO',mimeType:'image/jpeg'};
  const result=await listEvidence(async()=>({...response,items:[item,generic]}),draft);
  assert.equal(result.evidenceChecklist.complete,false);
  assert.equal(result.evidenceChecklist.items.find(r=>r.code==='VEHICLE_FRONT').status,'MISSING');
  for(const requirement of evidenceRequirements)for(const kind of requirement.kinds){
    if(kind!=='OWNER_ID' && kind!=='REGISTRATION_DOCUMENT' && kind!=='PURCHASE_PROOF')
      assert.throws(()=>sampleFilePayload(kind,'data:application/pdf;base64,YWJj',3));
    for(const language of [evidenceEn,evidenceFr]){assert.ok(language.requirements[requirement.code]);assert.ok(language.add[kind]);assert.ok(language.kinds[kind]);}
  }
  for(const language of [evidenceEn,evidenceFr])for(const state of ['COMPLETE','PENDING','MISSING'])assert.ok(language.checklistStatuses[state]);
});

test('purchase proof satisfies the alternative and pending photos never complete a requirement',async()=>{
  const files=[item,{...item,id:draft,kind:'PURCHASE_PROOF'},
    {...item,id:'00000000-0000-4000-8000-000000000003',kind:'VEHICLE_FRONT',mimeType:'image/jpeg',status:'PENDING'}];
  const value={...checklist,items:checklist.items.map(r=>({...r,status:r.code==='REGISTRATION_PROOF'?'COMPLETE':r.code==='VEHICLE_FRONT'?'PENDING':r.status}))};
  const response={items:files,evidenceChecklist:value,uploadsEnabled:true,sampleOnly:true,maxBytes:2097152};
  assert.equal((await listEvidence(async()=>response,draft)).evidenceChecklist.complete,false);
});
