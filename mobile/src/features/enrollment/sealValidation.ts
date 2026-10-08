import { z } from 'zod';

export const sealIssues = ['SEAL_REQUIRED','SEAL_UNAVAILABLE','SEAL_REVOKED','SEAL_DESTROYED','SEAL_RESERVED',
  'DUPLICATE_SEAL','PACKAGE_TYPE_MISMATCH','PHOTO_REQUIRED','PHOTO_PENDING','PHOTO_UNAVAILABLE','DUPLICATE_PHOTO'] as const;
export type SealIssue = typeof sealIssues[number];
export const sealCodeSchema=z.string().trim().toUpperCase().regex(/^DEV-SEAL-[A-Z0-9-]{1,40}$/);
// Scanned URLs/consumer verification tokens are never followed or accepted as fitting codes.
export function parseFittingCode(raw:string):string|null {
  const value=sealCodeSchema.safeParse(raw);return value.success?value.data:null;
}
export const sealValidationSchema=z.object({version:z.literal(1),required:z.boolean(),complete:z.boolean(),
  physicalVerified:z.literal(false),issues:z.array(z.enum(['PACKAGE_REQUIRED','STALE_FITTING'])).max(1),
  slots:z.array(z.object({position:z.number().int().min(1).max(4),issues:z.array(z.enum(sealIssues)).max(sealIssues.length)})).length(4),
}).superRefine((v,ctx)=>{
  const ready=v.issues.length===0 && v.slots.every(slot=>slot.issues.length===0);
  if(new Set(v.slots.map(slot=>slot.position)).size!==4 || v.complete!==ready
    || (!v.required && v.slots.some(slot=>slot.issues.length>0))
    || v.slots.some(slot=>new Set(slot.issues).size!==slot.issues.length))
    ctx.addIssue({code:'custom',message:'Invalid seal validation.'});
});
export type SealValidation=z.infer<typeof sealValidationSchema>;
export function blockingSealIssues(value:SealValidation) {
  return value.issues.length>0 || value.slots.some(slot=>slot.issues.some(issue=>!['SEAL_REQUIRED','PHOTO_REQUIRED'].includes(issue)));
}
