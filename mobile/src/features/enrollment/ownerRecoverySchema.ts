import { z } from 'zod';
import { ownerSaveSchema, ownerConsentSchema } from './owner.ts';
const field=z.string().max(256);
export const ownerAttemptSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('details'),key:z.uuid(),body:ownerSaveSchema}).strict(),
  z.object({kind:z.literal('consent'),key:z.uuid(),body:ownerConsentSchema}).strict(),
]);
export const ownerRecoverySchema=z.object({draftRevision:z.number().int().positive(),ownerGeneration:z.number().int().positive(),
  ownerProfileId:z.uuid(),type:z.enum(['INDIVIDUAL','COMPANY']),language:z.enum(['en','fr']),
  fields:z.object({name:field,companyRegistration:field,representativeName:field,idDocumentType:field,idDocumentNumber:field,phone:field}).strict(),
  terms:z.boolean(),data:z.boolean(),pending:ownerAttemptSchema.nullable()}).strict();
export type OwnerRecovery=z.infer<typeof ownerRecoverySchema>;
export type OwnerAttempt=z.infer<typeof ownerAttemptSchema>;
