import { z } from 'zod';

export const evidenceRequirements = [
  { code: 'OWNER_ID', kinds: ['OWNER_ID'] },
  { code: 'REGISTRATION_PROOF', kinds: ['REGISTRATION_DOCUMENT', 'PURCHASE_PROOF'] },
  { code: 'VEHICLE_FRONT', kinds: ['VEHICLE_FRONT'] },
  { code: 'VEHICLE_REAR', kinds: ['VEHICLE_REAR'] },
  { code: 'VEHICLE_LEFT', kinds: ['VEHICLE_LEFT'] },
  { code: 'VEHICLE_RIGHT', kinds: ['VEHICLE_RIGHT'] },
  { code: 'CHASSIS_PHOTO', kinds: ['CHASSIS_PHOTO'] },
  { code: 'PLATE_PHOTO', kinds: ['PLATE_PHOTO'] },
] as const;
export const evidenceRequirementCodes = evidenceRequirements.map(r => r.code);
export const documentEvidenceKinds = evidenceRequirements.flatMap(r => [...r.kinds]);
export const evidenceChecklistSchema = z.object({
  version: z.literal(1), complete: z.boolean(),
  items: z.array(z.object({ code: z.enum(evidenceRequirementCodes), status: z.enum(['COMPLETE', 'PENDING', 'MISSING']) }))
    .length(evidenceRequirements.length),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map(r => r.code)).size !== evidenceRequirements.length
    || value.complete !== value.items.every(r => r.status === 'COMPLETE')) {
    ctx.addIssue({ code: 'custom', message: 'Invalid evidence checklist.' });
  }
});
export type EvidenceChecklist = z.infer<typeof evidenceChecklistSchema>;
