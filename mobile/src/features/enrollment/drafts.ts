import { z } from 'zod';

export const draftVehicleSchema = z.object({
  chassisIdentifier: z.string().trim().min(1).max(128).transform(v => v.toUpperCase()),
  plate: z.string().trim().min(1).max(64).nullable().transform(v => v?.toUpperCase() ?? null),
  category: z.string().trim().min(1).max(64).transform(v => v.toUpperCase()),
  make: z.string().trim().max(100).nullable(), model: z.string().trim().max(100).nullable(),
  manufactureYear: z.number().int().min(1886).max(2200).nullable(), color: z.string().trim().max(100).nullable(),
});
export const draftBodySchema = z.object({organizationId:z.uuid(),ownerProfileId:z.uuid(),vehicle:draftVehicleSchema});
export const enrollmentDraftSchema = draftBodySchema.extend({
  id:z.uuid(),status:z.literal('DRAFT'),revision:z.number().int().positive(),
  createdAt:z.iso.datetime({offset:true}),updatedAt:z.iso.datetime({offset:true}),
});
export type EnrollmentDraft = z.infer<typeof enrollmentDraftSchema>;
export type EnrollmentDraftBody = z.infer<typeof draftBodySchema>;
type Request = (path:string,options:{method?:'POST'|'PUT';body?:unknown;idempotencyKey?:string;signal?:AbortSignal})=>Promise<unknown>;
export const ownerOptionSchema = z.object({profileId:z.uuid(),label:z.string().regex(/^Development owner [1-9][0-9]{0,3}$/),
  verificationStatus:z.literal('NOT_VERIFIED')});
export async function readOwnerOptions(request:Request,organizationId:string,signal?:AbortSignal) {
  const result=z.object({items:z.array(ownerOptionSchema).max(50)})
    .parse(await request('/v1/enrollment-drafts/owner-options?organizationId='+z.uuid().parse(organizationId),{signal}));
  if(new Set(result.items.map(item=>item.profileId.toLowerCase())).size!==result.items.length) throw new Error('Invalid owner choices.');
  return result.items;
}
export async function readDraftPage(request:Request,cursor?:string,signal?:AbortSignal) {
  const result = z.object({items:z.array(enrollmentDraftSchema).max(20),nextCursor:z.uuid().nullable()})
    .parse(await request('/v1/enrollment-drafts?limit=20'+(cursor?'&cursor='+z.uuid().parse(cursor):''),{signal}));
  if(result.nextCursor && (result.nextCursor===cursor || result.nextCursor!==result.items.at(-1)?.id)) throw new Error('Invalid draft page.');
  return result;
}
export async function readDraft(request:Request,id:string,signal?:AbortSignal) {
  const safeId=z.uuid().parse(id).toLowerCase();
  const result=z.object({draft:enrollmentDraftSchema}).parse(await request('/v1/enrollment-drafts/'+safeId,{signal}));
  if(result.draft.id.toLowerCase()!==safeId) throw new Error('Unexpected draft.');
  return result.draft;
}
export async function saveDraft(request:Request,body:EnrollmentDraftBody,options:{id?:string;revision?:number;key?:string}) {
  const validated=draftBodySchema.parse(body);
  const update=options.id!==undefined;
  const path='/v1/enrollment-drafts'+(update?'/'+z.uuid().parse(options.id):'');
  const result=z.object({draft:enrollmentDraftSchema}).parse(await request(path,{
    method:update?'PUT':'POST',body:update?{...validated,expectedRevision:z.number().int().positive().parse(options.revision)}:validated,
    ...(update?{}:{idempotencyKey:z.uuid().parse(options.key)}),
  }));
  if(update && result.draft.id.toLowerCase()!==options.id!.toLowerCase()) throw new Error('Unexpected draft.');
  return result.draft;
}
