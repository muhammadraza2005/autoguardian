import {test} from 'node:test';import assert from 'node:assert/strict';
import {submissionSchema,submissionAttemptSchema,readSubmission,executeSubmission,prerequisiteCodes} from '../src/features/enrollment/submission.ts';
const id='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002';
const state={draftId:id,draftRevision:1,ownerGeneration:1,snapshotRevision:2,fittingRevision:1,mode:'DEVELOPMENT',status:'DRAFT',ownerReady:false,
  checks:prerequisiteCodes.map(code=>({code,status:'MISSING'})),vehicleId:null,canSubmit:false,canFinalize:false};
test('registration contract rejects fake activation, sample submission, duplicate/missing checks and unexpected owner records',async()=>{
  assert.ok(submissionSchema.safeParse(state).success);
  for(const raw of [{...state,canSubmit:true},{...state,status:'ACTIVE'},{...state,vehicleId:key},{...state,canFinalize:true},
    {...state,checks:state.checks.map(()=>state.checks[0])},{...state,ownerPhone:'secret'}])assert.equal(submissionSchema.safeParse(raw).success,false);
  await assert.rejects(()=>readSubmission(async()=>({...state,draftId:key}),id));
  await assert.rejects(()=>executeSubmission(async()=>state,id,{key,action:'finalize',body:{expectedDraftRevision:1,expectedSnapshotRevision:2}}));
  assert.equal(submissionAttemptSchema.safeParse({key,action:'submit',body:{expectedDraftRevision:1,expectedSnapshotRevision:2,paymentConfirmed:true}}).success,false);
});
test('registration retry preserves operation, exact idempotency key and both revisions',async()=>{
  const attempt={key,action:'submit',body:{expectedDraftRevision:1,expectedSnapshotRevision:2}},calls=[];
  const result={...state,mode:'PRODUCTION',status:'SUBMITTED',ownerReady:true,checks:state.checks.map(c=>({...c,status:'COMPLETE'})),canFinalize:true};
  const request=async(path,options)=>{calls.push({path,options});if(calls.length===1)throw new Error('Unknown network result');return result;};
  await assert.rejects(()=>executeSubmission(request,id,attempt));assert.equal((await executeSubmission(request,id,attempt)).status,'SUBMITTED');
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].options.idempotencyKey,key);
  const active={...result,status:'ACTIVE',vehicleId:key,canFinalize:false};
  const confirmed=await executeSubmission(async(path,options)=>{assert.ok(path.endsWith('/submission/finalize'));assert.deepEqual(options.body,attempt.body);return active;},
    id,{...attempt,action:'finalize'});assert.equal(confirmed.vehicleId,key);
});
