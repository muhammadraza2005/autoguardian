import {test} from 'node:test';import assert from 'node:assert/strict';
import {reviewStateSchema,reviewBodySchema,reviewState,changeReview} from '../src/features/administration/registrationReviews.ts';
import {registrationReviewEn,registrationReviewFr} from '../src/i18n/registrationReviewResources.ts';
const id='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002';
const state={version:1,draftId:id,mode:'DEVELOPMENT',draftRevision:1,snapshotRevision:4,reviewRevision:0,
 vehicle:{chassisIdentifier:'SYNTHETIC',plate:null,category:'CAR',make:null,model:null,manufactureYear:null,color:null},items:[],history:[],
 sealPackage:null,sealLocations:[],evidenceComplete:false,sealsConfirmed:false,frozen:false,canApprove:false,productionApproved:false};
test('independent review contract rejects fake production approvals, missing prerequisites and uninspected decisions',async()=>{
 assert.equal(reviewStateSchema.safeParse(state).success,true);
 for(const raw of [{...state,productionApproved:true},{...state,canApprove:true},{...state,mode:'PRODUCTION',productionApproved:true},{...state,storagePath:'secret'}])
  assert.equal(reviewStateSchema.safeParse(raw).success,false);
 const body={expectedDraftRevision:1,expectedSnapshotRevision:4,expectedReviewRevision:0,action:'ACCEPTED',attachmentId:key,replacementId:null,reason:null,inspected:true};
 assert.equal(reviewBodySchema.safeParse(body).success,true);
 for(const raw of [{...body,inspected:false},{...body,reason:'BLURRY'},{...body,paymentConfirmed:true},{...body,action:'SUPERSEDED'},
  {...body,action:'NEEDS_CORRECTION'},{...body,action:'APPROVED'}])assert.equal(reviewBodySchema.safeParse(raw).success,false);
 await assert.rejects(()=>reviewState(async()=>({...state,draftId:key}),id));
});
test('review retries retain exact context/key and files must match the inspected attachment',async()=>{
 const attempt={key,body:{expectedDraftRevision:1,expectedSnapshotRevision:4,expectedReviewRevision:0,action:'ACCEPTED',attachmentId:key,replacementId:null,reason:null,inspected:true}},calls=[];
 const request=async(path,options)=>{calls.push({path,options});if(calls.length===1)throw new Error('Unknown result');return {...state,reviewRevision:1};};
 await assert.rejects(()=>changeReview(request,id,attempt));assert.equal((await changeReview(request,id,attempt)).reviewRevision,1);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].options.idempotencyKey,key);
 const read={...attempt,body:{...attempt.body,action:'READ_REQUESTED',inspected:false}};
 await assert.rejects(()=>changeReview(async()=>({id,mimeType:'image/jpeg',dataBase64:'c2FtcGxl'}),id,read));
 assert.equal((await changeReview(async()=>({id:key,mimeType:'image/jpeg',dataBase64:'c2FtcGxl'}),id,read)).id,key);
});
test('review resources provide the same English/French actions, reasons and statuses',()=>{
 const keys=o=>Object.entries(o).flatMap(([key,value])=>typeof value==='object'?keys(value).map(child=>key+'.'+child):[key]).sort();
 assert.deepEqual(keys(registrationReviewEn),keys(registrationReviewFr));
});
