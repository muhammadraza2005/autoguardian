import {z} from 'zod';
export const purposes=['REGISTRATION','CHECK','SUBSCRIPTION'] as const;
export const paymentSchema=z.object({id:z.uuid(),purpose:z.enum(purposes),targetId:z.uuid(),targetRevision:z.number().int().nonnegative(),
  amount:z.string().regex(/^\d+(?:\.\d{1,4})?$/),currency:z.enum(['CDF','USD']),status:z.enum(['CREATED','PROCESSING','COMPLETED','FAILED','DISCREPANCY']),
  createdAt:z.string(),confirmedAt:z.string().nullable(),providerReference:z.string().nullable(),receiptNumber:z.string().nullable(),sampleOnly:z.literal(true)}).strict();
export const livePaymentSchema=paymentSchema.extend({purpose:z.enum(['REGISTRATION','SUBSCRIPTION']),sampleOnly:z.literal(false),
 receiptIdentity:z.object({businessName:z.string(),address:z.string(),registrationNumber:z.string()}).strict().nullable()}).strict();
export type Payment=z.infer<typeof paymentSchema>|z.infer<typeof livePaymentSchema>;
export const livePaymentListSchema=z.object({items:z.array(livePaymentSchema).max(100),sampleOnly:z.literal(false)}).strict();
export const liveSettingsSchema=z.object({productionEnabled:z.literal(true),currency:z.enum(['CDF','USD']),registrationFee:z.string(),renewalFee:z.string(),sampleOnly:z.literal(false)}).strict().nullable();
export const paymentListSchema=z.object({items:z.array(paymentSchema).max(100),sampleOnly:z.literal(true)}).strict();
export const settingsSchema=z.object({revision:z.number().int().positive(),sandboxEnabled:z.boolean(),currency:z.enum(['CDF','USD']),
  registrationFee:z.string(),checkFee:z.string(),renewalFee:z.string(),freeMonthly:z.number().int(),periodDays:z.number().int(),
  graceDays:z.number().int(),reminderDays:z.number().int(),sampleOnly:z.literal(true)}).strict().nullable();
export const quoteSchema=z.object({configured:z.boolean(),allowed:z.boolean().optional(),freeRemaining:z.number().int().optional(),
  amount:z.string().optional(),currency:z.enum(['CDF','USD']).optional(),sampleOnly:z.literal(true)}).strict();
export const subscriptionsSchema=z.object({items:z.array(z.object({vehicleId:z.uuid(),expiresAt:z.string(),graceUntil:z.string(),state:z.enum(['ACTIVE','GRACE','SUSPENDED'])}).strict()),
  reminders:z.array(z.object({id:z.uuid(),vehicleId:z.uuid(),createdAt:z.string()}).strict()),sampleOnly:z.literal(true)}).strict();
export const liveSubscriptionsSchema=subscriptionsSchema.extend({sampleOnly:z.literal(false)}).strict();
