import {z} from 'zod';
export const relationship=z.object({id:z.uuid(),vehicleId:z.uuid(),plate:z.string().nullable(),kind:z.enum(['backup','seller']),
 state:z.enum(['invited','accepted','revoked']),asOwner:z.boolean(),current:z.boolean(),expiresAt:z.string().nullable(),
 consentVersion:z.literal('alert-only-v1'),canApprove:z.literal(false)}).strict();
export const relationshipPage=z.object({items:z.array(relationship).max(100),sampleOnly:z.literal(true)}).strict();
export const invitationInput=z.object({vehicleId:z.uuid(),kind:z.enum(['backup','seller']),phone:z.string().regex(/^\+[1-9]\d{7,14}$/)}).strict();
export const acceptedRelationship=z.object({accepted:z.literal(true)}).strict();
