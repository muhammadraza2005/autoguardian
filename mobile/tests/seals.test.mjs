import test from 'node:test';import assert from 'node:assert/strict';
import {readSealStock,readSealFitting,saveSealFitting,sealFittingBodySchema,sealFittingSchema} from '../src/features/enrollment/seals.ts';
import {availableSealChoices} from '../src/features/enrollment/sealChoices.ts';
const draft='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002';
const empty={draftId:draft,draftRevision:1,fittingRevision:0,package:null,current:false,placements:[],sampleOnly:true,
  sealDraftComplete:false,sampleDocumentsSaved:false,ownerVerified:false,paymentConfirmed:false,enrollmentActive:false};
test('guided choices exclude reused, revoked, reserved and excess package types, while allowing this draft’s saved seals',()=>{
  const stock=[1,2,3,4,5].map(n=>({code:'DEV-SEAL-STD-00'+n,type:'STANDARD',status:'IN_STOCK',available:true}));
  stock.push({code:'DEV-SEAL-ALM-001',type:'ALARM',status:'IN_STOCK',available:true},
    {code:'DEV-SEAL-ALM-002',type:'ALARM',status:'REVOKED',available:false});
  stock[4].available=false;
  const slots=[{position:1,sealCode:'DEV-SEAL-STD-001'},{position:2,sealCode:'DEV-SEAL-STD-002'},{position:3,sealCode:'DEV-SEAL-STD-003'}];
  assert.deepEqual(availableSealChoices('ONE_ALARM',4,slots,stock,[]).map(s=>s.code),['DEV-SEAL-ALM-001']);
  assert.deepEqual(availableSealChoices('STANDARD',4,slots,stock,[]).map(s=>s.code),['DEV-SEAL-STD-004']);
  assert.deepEqual(availableSealChoices('NONE',1,[],stock,[]),[]);
  assert.deepEqual(availableSealChoices('FOUR_ALARMS',1,[],stock,[]).map(s=>s.code),['DEV-SEAL-ALM-001']);
  assert.ok(availableSealChoices('STANDARD',4,slots,stock,[{sealCode:'DEV-SEAL-STD-005',sealType:'STANDARD'}]).some(s=>s.code==='DEV-SEAL-STD-005'));
});
test('seal drafts cannot imply activation or completeness from a partial fitting',async()=>{
  assert.equal(sealFittingSchema.parse(empty).sealDraftComplete,false);
  for(const changed of [{enrollmentActive:true},{ownerVerified:true},{paymentConfirmed:true},{sealDraftComplete:true},{current:true},{sampleOnly:false}])
    assert.throws(()=>sealFittingSchema.parse({...empty,...changed}));
  await assert.rejects(readSealFitting(async()=>({...empty,draftId:key}),draft));
  const body={package:'STANDARD',placements:[{position:1,sealCode:'dev-seal-std-001',photoId:null}],expectedDraftRevision:1,expectedFittingRevision:0};
  assert.equal(sealFittingBodySchema.parse(body).placements[0].sealCode,'DEV-SEAL-STD-001');
  assert.throws(()=>sealFittingBodySchema.parse({...body,placements:[...body.placements,...body.placements]}));
  assert.throws(()=>sealFittingBodySchema.parse({...body,package:'NONE'}));
});
test('fitting saves preserve replay key and revisions; stock is scoped and cannot claim revoked seals are available',async()=>{
  const calls=[];const result={...empty,package:'NONE',current:true,fittingRevision:1,sealDraftComplete:true};
  const body={package:'NONE',placements:[],expectedDraftRevision:1,expectedFittingRevision:0};
  const request=async(path,options)=>{calls.push({path,options});return result;};
  await saveSealFitting(request,draft,key,body);await saveSealFitting(request,draft,key,body);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].options.idempotencyKey,key);
  assert.equal(calls[0].options.body.expectedFittingRevision,0);assert.equal(calls[0].path,'/v1/enrollment-drafts/'+draft+'/seals');
  const seal={id:key,code:'DEV-SEAL-STD-001',batchCode:'DEV-BATCH-001',type:'STANDARD',status:'IN_STOCK',available:true};
  await readSealStock(async(path)=>{assert.equal(path,'/v1/seal-stock?organizationId='+draft+'&limit=20');return {items:[seal],nextCursor:null,sampleOnly:true};},draft);
  await assert.rejects(readSealStock(async()=>({items:[{...seal,status:'REVOKED'}],nextCursor:null,sampleOnly:true}),draft));
  await assert.rejects(readSealStock(async()=>({items:[seal],nextCursor:draft,sampleOnly:true}),draft));
  await assert.rejects(saveSealFitting(async()=>{throw new Error('Connection lost');},draft,key,body));
});
