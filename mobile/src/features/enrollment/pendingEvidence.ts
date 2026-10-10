import { z } from 'zod';
import { evidenceKindSchema, nativeUploadContextSchema } from './evidence.ts';
export const pendingEvidenceSchema=z.object({key:z.uuid(),body:z.object({kind:evidenceKindSchema,
  dataBase64:z.string().min(4).max(Math.ceil(2097152/3)*4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  uploadContext:nativeUploadContextSchema}).strict()}).strict();
export type PendingEvidence=z.infer<typeof pendingEvidenceSchema>;
export function evidenceRecoveryId(draftId:string,slot:string){
  z.uuid().parse(draftId);if(!/^(documents|fitting-[1-4])$/.test(slot))throw new Error('Invalid evidence recovery slot.');
  return 'evidence:'+draftId.toLowerCase()+':'+slot;
}
