import {z} from 'zod';
import {sealCodeSchema,sealValidationSchema} from './sealValidation.ts';
export const sealPackageSchema=z.enum(['NONE','STANDARD','ONE_ALARM','FOUR_ALARMS']);
export type SealPackage=z.infer<typeof sealPackageSchema>;
const sealCode=sealCodeSchema;
const placementSchema=z.object({position:z.number().int().min(1).max(4),sealCode,photoId:z.uuid().nullable()});
export const sealValidationBodySchema=z.object({package:sealPackageSchema,placements:z.array(placementSchema).max(4),
  expectedDraftRevision:z.number().int().min(1).max(2147483646),expectedFittingRevision:z.number().int().min(0).max(2147483646)})
  .refine(v=>(v.package!=='NONE' || v.placements.length===0) && new Set(v.placements.map(p=>p.position)).size===v.placements.length);
export const sealFittingBodySchema=sealValidationBodySchema
  .superRefine((v,ctx)=>{
    if((v.package==='NONE' && v.placements.length) || new Set(v.placements.map(p=>p.position)).size!==v.placements.length
      || new Set(v.placements.map(p=>p.sealCode)).size!==v.placements.length
      || new Set(v.placements.flatMap(p=>p.photoId?[p.photoId.toLowerCase()]:[])).size!==v.placements.filter(p=>p.photoId).length)
      ctx.addIssue({code:'custom',message:'Invalid fitting assignments.'});
  });
export type SealFittingBody=z.infer<typeof sealFittingBodySchema>;
export const sealFittingSchema=z.object({draftId:z.uuid(),draftRevision:z.number().int().positive(),fittingRevision:z.number().int().nonnegative(),
  package:sealPackageSchema.nullable(),current:z.boolean(),placements:z.array(placementSchema.extend({sealType:z.enum(['STANDARD','ALARM'])})).max(4),
  sampleOnly:z.literal(true),sealDraftComplete:z.boolean(),sampleDocumentsSaved:z.boolean(),ownerVerified:z.literal(false),
  paymentConfirmed:z.literal(false),enrollmentActive:z.literal(false),sealValidation:sealValidationSchema}).superRefine((v,ctx)=>{
    const alarms=v.placements.filter(p=>p.sealType==='ALARM').length;
    const expected={NONE:0,STANDARD:0,ONE_ALARM:1,FOUR_ALARMS:4};
    if(v.sealDraftComplete!==v.sealValidation.complete || v.sealValidation.required!==(v.package!=='NONE')
      || v.sealValidation.issues.includes('STALE_FITTING')!==(v.package!==null && !v.current)
      || v.sealValidation.issues.includes('PACKAGE_REQUIRED')!==(v.package===null)
      || new Set(v.placements.map(p=>p.position)).size!==v.placements.length || new Set(v.placements.map(p=>p.sealCode)).size!==v.placements.length
      || (v.package===null && (v.current || v.fittingRevision!==0 || v.placements.length))
      || (v.sealDraftComplete && (!v.current || v.package===null || (v.package==='NONE'?v.placements.length!==0:
        v.placements.length!==4 || alarms!==expected[v.package] || v.placements.some(p=>p.photoId===null)))))
      ctx.addIssue({code:'custom',message:'Invalid fitting response.'});
  });
export type SealFitting=z.infer<typeof sealFittingSchema>;
type Request=(path:string,options:{method?:'POST';body?:unknown;idempotencyKey?:string;signal?:AbortSignal})=>Promise<unknown>;
export async function validateSealFitting(request:Request,id:string,body:SealFittingBody){
  const validated=sealValidationBodySchema.parse(body);
  const result=z.object({draftId:z.uuid(),draftRevision:z.number().int().positive(),fittingRevision:z.number().int().nonnegative(),
    sealValidation:sealValidationSchema}).parse(await request('/v1/enrollment-drafts/'+z.uuid().parse(id)+'/seals/validate',
    {method:'POST',body:{...validated,placements:[...validated.placements].sort((a,b)=>a.position-b.position)}}));
  if(result.draftId.toLowerCase()!==id.toLowerCase() || result.draftRevision!==validated.expectedDraftRevision
    || result.fittingRevision!==validated.expectedFittingRevision || result.sealValidation.required!==(validated.package!=='NONE')
    || result.sealValidation.issues.length)throw new Error('Unexpected fitting validation.');
  return result.sealValidation;
}
export async function readSealStock(request:Request,organizationId:string,cursor?:string,signal?:AbortSignal){
  const result=z.object({items:z.array(z.object({id:z.uuid(),code:sealCode,batchCode:z.string().regex(/^DEV-BATCH-[A-Z0-9-]{1,40}$/),
    type:z.enum(['STANDARD','ALARM']),status:z.enum(['IN_STOCK','REVOKED','DESTROYED']),available:z.boolean()})).max(20),nextCursor:z.uuid().nullable(),sampleOnly:z.literal(true)})
    .parse(await request('/v1/seal-stock?organizationId='+z.uuid().parse(organizationId)+'&limit=20'+(cursor?'&cursor='+z.uuid().parse(cursor):''),{signal}));
  if(new Set(result.items.map(s=>s.id)).size!==result.items.length || new Set(result.items.map(s=>s.code)).size!==result.items.length
    || result.items.some(s=>s.status!=='IN_STOCK' && s.available) || (result.nextCursor && (result.nextCursor===cursor || result.nextCursor!==result.items.at(-1)?.id)))
    throw new Error('Invalid stock page.');
  return result;
}
export async function readSealFitting(request:Request,id:string,signal?:AbortSignal){
  const result=sealFittingSchema.parse(await request('/v1/enrollment-drafts/'+z.uuid().parse(id)+'/seals',{signal}));
  if(result.draftId.toLowerCase()!==id.toLowerCase())throw new Error('Unexpected draft.');return result;
}
export async function saveSealFitting(request:Request,id:string,key:string,body:SealFittingBody){
  const validated=sealFittingBodySchema.parse(body);
  const result=sealFittingSchema.parse(await request('/v1/enrollment-drafts/'+z.uuid().parse(id)+'/seals',
    {method:'POST',idempotencyKey:z.uuid().parse(key),body:{...validated,placements:[...validated.placements].sort((a,b)=>a.position-b.position)}}));
  if(result.draftId.toLowerCase()!==id.toLowerCase())throw new Error('Unexpected draft.');return result;
}
