import { z } from 'zod';
export const prerequisiteCodes=['AGENT_AUTHENTICATION','OWNER_PHONE','CONSENT','PRODUCTION_EVIDENCE','SEALS','PAYMENT','REVIEW_POLICY'] as const;
const revision=z.number().int().min(1).max(2147483647);
export const submissionBodySchema=z.object({expectedDraftRevision:revision,expectedSnapshotRevision:revision}).strict();
export const submissionAttemptSchema=z.object({key:z.uuid(),action:z.enum(['submit','finalize']),body:submissionBodySchema}).strict();
export type SubmissionAttempt=z.infer<typeof submissionAttemptSchema>;
export const submissionSchema=z.object({draftId:z.uuid(),draftRevision:revision,ownerGeneration:revision,snapshotRevision:revision,
  fittingRevision:z.number().int().nonnegative(),mode:z.enum(['DEVELOPMENT','PRODUCTION']),status:z.enum(['DRAFT','SUBMITTED','ACTIVE']),
  ownerReady:z.boolean(),checks:z.array(z.object({code:z.enum(prerequisiteCodes),status:z.enum(['COMPLETE','MISSING','STALE','REJECTED','EXPIRED'])}).strict()).length(7),
  vehicleId:z.uuid().nullable(),canSubmit:z.boolean(),canFinalize:z.boolean()}).strict().superRefine((value,ctx)=>{
    const complete=value.mode==='PRODUCTION' && value.ownerReady && value.checks.every(c=>c.status==='COMPLETE');
    if(new Set(value.checks.map(c=>c.code)).size!==7 || (value.status==='ACTIVE')!==(value.vehicleId!==null)
      || (value.canSubmit && (!complete || value.status!=='DRAFT')) || (value.canFinalize && (!complete || value.status!=='SUBMITTED'))
      || (value.mode==='DEVELOPMENT' && value.status!=='DRAFT'))ctx.addIssue({code:'custom',message:'Invalid submission state.'});
  });
export type SubmissionState=z.infer<typeof submissionSchema>;
type Request=(path:string,options?:{method?:'POST';body?:unknown;idempotencyKey?:string;signal?:AbortSignal})=>Promise<unknown>;
function matching(raw:unknown,id:string){const state=submissionSchema.parse(raw);if(state.draftId.toLowerCase()!==id.toLowerCase())throw new Error('Unexpected enrollment.');return state;}
export async function readSubmission(request:Request,id:string,signal?:AbortSignal){
  return matching(await request('/v1/enrollment-drafts/'+z.uuid().parse(id)+'/submission',{signal}),id);
}
export async function executeSubmission(request:Request,id:string,value:SubmissionAttempt){
  const attempt=submissionAttemptSchema.parse(value);
  const state=matching(await request('/v1/enrollment-drafts/'+z.uuid().parse(id)+'/submission'+(attempt.action==='finalize'?'/finalize':''),
    {method:'POST',body:attempt.body,idempotencyKey:attempt.key}),id);
  if(attempt.action==='finalize' && state.status!=='ACTIVE' || attempt.action==='submit' && state.status==='DRAFT')throw new Error('Submission not confirmed.');
  return state;
}
