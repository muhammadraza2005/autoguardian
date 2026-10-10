import { z } from 'zod';
const revision=z.number().int().min(1).max(2147483647);
export const reviewActions=['READ_REQUESTED','ACCEPTED','NEEDS_CORRECTION','SUPERSEDED','APPROVED'] as const;
export const reviewReasons=['BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH'] as const;
export const reviewBodySchema=z.object({expectedDraftRevision:revision,expectedSnapshotRevision:revision,
  expectedReviewRevision:z.number().int().nonnegative(),action:z.enum(reviewActions),attachmentId:z.uuid().nullable(),replacementId:z.uuid().nullable(),
  reason:z.enum(reviewReasons).nullable(),inspected:z.boolean()}).strict().superRefine((v,c)=>{
    if((v.action==='APPROVED')!==(v.attachmentId===null) || (v.action==='SUPERSEDED')!==(v.replacementId!==null)
      || (v.action==='NEEDS_CORRECTION')!==(v.reason!==null) || (v.action==='READ_REQUESTED'?v.inspected:!v.inspected))c.addIssue({code:'custom',message:'Invalid review.'});
  });
export const reviewAttemptSchema=z.object({key:z.uuid(),body:reviewBodySchema}).strict();
export type ReviewAttempt=z.infer<typeof reviewAttemptSchema>;
export type ReviewBody=z.infer<typeof reviewBodySchema>;
const item=z.object({id:z.uuid(),kind:z.string(),mimeType:z.enum(['image/jpeg','image/png','application/pdf']),status:z.enum(['PENDING','STAGED']),
  decision:z.enum(['NOT_REVIEWED','ACCEPTED','NEEDS_CORRECTION','SUPERSEDED']),reason:z.enum(reviewReasons).nullable(),replacementId:z.uuid().nullable()}).strict();
export const reviewStateSchema=z.object({version:z.literal(1),draftId:z.uuid(),mode:z.enum(['DEVELOPMENT','PRODUCTION']),draftRevision:revision,snapshotRevision:revision,
  reviewRevision:z.number().int().nonnegative(),vehicle:z.object({chassisIdentifier:z.string(),plate:z.string().nullable(),category:z.string(),make:z.string().nullable(),
    model:z.string().nullable(),manufactureYear:z.number().nullable(),color:z.string().nullable()}).strict(),items:z.array(item),
  sealPackage:z.enum(['NONE','STANDARD','ONE_ALARM','FOUR_ALARMS']).nullable(),sealLocations:z.array(z.object({position:z.number().int().min(1).max(4),description:z.string()}).strict()),
  history:z.array(z.object({id:z.uuid(),action:z.enum(['ACCEPTED','NEEDS_CORRECTION','SUPERSEDED','APPROVED']),attachmentId:z.uuid().nullable(),replacementId:z.uuid().nullable(),
    reviewerId:z.uuid(),draftRevision:revision,snapshotRevision:revision,reason:z.enum(reviewReasons).nullable(),createdAt:z.string()}).strict()),
  evidenceComplete:z.boolean(),sealsConfirmed:z.boolean(),frozen:z.boolean(),canApprove:z.boolean(),productionApproved:z.boolean()}).strict().superRefine((v,c)=>{
    if((v.canApprove && (!v.evidenceComplete||!v.sealsConfirmed||v.frozen)) || (v.productionApproved && (v.mode!=='PRODUCTION'||!v.evidenceComplete||!v.sealsConfirmed))
      || new Set(v.items.map(i=>i.id)).size!==v.items.length)c.addIssue({code:'custom',message:'Invalid approval state.'});
  });
export type ReviewState=z.infer<typeof reviewStateSchema>;
export const reviewQueueSchema=z.object({items:z.array(z.object({id:z.uuid(),mode:z.enum(['DEVELOPMENT','PRODUCTION']),chassisIdentifier:z.string(),plate:z.string().nullable(),updatedAt:z.string()}).strict())}).strict();
type Request=(path:string,options?:{method?:'POST';body?:unknown;idempotencyKey?:string;signal?:AbortSignal})=>Promise<unknown>;
export async function reviewQueue(request:Request,offset:number,signal?:AbortSignal){return reviewQueueSchema.parse(await request('/v1/registration-reviews?limit=20&offset='+offset,{signal}));}
function matching(raw:unknown,id:string){const result=reviewStateSchema.parse(raw);if(result.draftId.toLowerCase()!==id.toLowerCase())throw new Error('Unexpected review.');return result;}
export async function reviewState(request:Request,id:string,signal?:AbortSignal){return matching(await request('/v1/registration-reviews/'+z.uuid().parse(id),{signal}),id);}
export async function changeReview(request:Request,id:string,raw:ReviewAttempt,signal?:AbortSignal){
  const attempt=reviewAttemptSchema.parse(raw);const result=await request('/v1/registration-reviews/'+z.uuid().parse(id),{method:'POST',body:attempt.body,idempotencyKey:attempt.key,signal});
  if(attempt.body.action==='READ_REQUESTED'){
    const file=z.object({id:z.uuid(),mimeType:z.enum(['image/jpeg','image/png','application/pdf']),dataBase64:z.string().min(1).max(Math.ceil(2097152/3)*4)}).strict().parse(result);
    if(file.id!==attempt.body.attachmentId || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.dataBase64))throw new Error('Unexpected file.');
    return file;
  }
  return matching(result,id);
}
