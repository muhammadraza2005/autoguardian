import { z } from 'zod';
export const evidenceKindSchema=z.enum(['OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_PHOTO','SEAL_FITTING_PHOTO']);
export type EvidenceKind=z.infer<typeof evidenceKindSchema>;
export const evidenceMetadata=z.object({id:z.uuid(),kind:evidenceKindSchema,mimeType:z.enum(['application/pdf','image/jpeg','image/png']),
  byteSize:z.number().int().min(1).max(2097152),status:z.enum(['PENDING','STAGED']),createdAt:z.iso.datetime({offset:true})});
type Request=(path:string,options?:{method?:'POST';body?:unknown;idempotencyKey?:string;signal?:AbortSignal})=>Promise<unknown>;
export function sampleFilePayload(kind:EvidenceKind,dataUrl:string,size:number) {
  if(!Number.isInteger(size) || size<1 || size>2097152) throw new Error('Invalid sample file size.');
  const match=/^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if(!match || match[2].length!==Math.ceil(size/3)*4 || (['VEHICLE_PHOTO','SEAL_FITTING_PHOTO'].includes(kind) && match[1]==='application/pdf')) throw new Error('Invalid sample file.');
  return {kind:evidenceKindSchema.parse(kind),dataBase64:match[2]};
}
export async function listEvidence(request:Request,id:string,signal?:AbortSignal) {
  const result=z.object({items:z.array(evidenceMetadata).max(10),uploadsEnabled:z.boolean(),sampleOnly:z.literal(true),maxBytes:z.literal(2097152)})
    .parse(await request('/v1/enrollment-drafts/'+z.uuid().parse(id)+'/attachments',{signal}));
  if(new Set(result.items.map(item=>item.id)).size!==result.items.length) throw new Error('Invalid attachment list.');
  return result;
}
export async function uploadEvidence(request:Request,id:string,key:string,body:{kind:EvidenceKind;dataBase64:string},signal?:AbortSignal) {
  const result=z.object({attachment:evidenceMetadata.extend({status:z.literal('STAGED')})}).parse(await request(
    '/v1/enrollment-drafts/'+z.uuid().parse(id)+'/attachments',{method:'POST',idempotencyKey:z.uuid().parse(key),body,signal}));
  if(result.attachment.id.toLowerCase()!==key.toLowerCase() || result.attachment.kind!==body.kind) throw new Error('Unexpected attachment.');
  return result.attachment;
}
export async function readEvidence(request:Request,draftId:string,id:string,signal?:AbortSignal) {
  const result=z.object({id:z.uuid(),mimeType:z.enum(['application/pdf','image/jpeg','image/png']),
    dataBase64:z.string().min(4).max(Math.ceil(2097152/3)*4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)})
    .parse(await request('/v1/enrollment-drafts/'+z.uuid().parse(draftId)+'/attachments/'+z.uuid().parse(id)+'/read',
      {method:'POST',body:{reason:'ENROLLMENT_REVIEW'},signal}));
  if(result.id.toLowerCase()!==id.toLowerCase()) throw new Error('Unexpected attachment.');
  return result;
}
