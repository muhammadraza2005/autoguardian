import { z } from 'zod';
import { sealValidationSchema } from './sealValidation.ts';
import { evidenceChecklistSchema } from './evidenceChecklist.ts';

export const sampleCheckCodes = ['VEHICLE_DRAFT', 'OWNER_SELECTION', 'IDENTITY_SAMPLE',
  'REGISTRATION_SAMPLE', 'VEHICLE_PHOTO_SAMPLE', 'SEAL_FITTING', 'OWNER_DETAILS_SAMPLE', 'CONSENT_SAMPLE'] as const;
export const productionCheckCodes = ['AGENT_AUTHENTICATION', 'OWNER_PHONE', 'CONSENT',
  'PRODUCTION_EVIDENCE', 'PAYMENT', 'REVIEW_POLICY', 'FINALIZATION'] as const;
export const checkCodes = [...sampleCheckCodes, ...productionCheckCodes] as const;
const checkSchema = z.object({ code: z.enum(checkCodes), status: z.enum(['COMPLETE', 'MISSING', 'STALE', 'UNAVAILABLE']) });
export const readinessSchema = z.object({
  draftId: z.uuid(), draftRevision: z.number().int().positive(), fittingRevision: z.number().int().nonnegative(),
  package: z.enum(['NONE', 'STANDARD', 'ONE_ALARM', 'FOUR_ALARMS']).nullable(),
  vehicle: z.object({ chassisIdentifier: z.string().min(1), plate: z.string().nullable(), category: z.string().min(1) }),
  sampleOnly: z.literal(true), canSubmit: z.literal(false), enrollmentActive: z.literal(false),
  checks: z.array(checkSchema).length(checkCodes.length),
  evidenceChecklist: evidenceChecklistSchema,
  sealValidation: sealValidationSchema,
}).superRefine((value, ctx) => {
  if(value.sealValidation.required!==(value.package!=='NONE')
    || value.sealValidation.issues.includes('PACKAGE_REQUIRED')!==(value.package===null)
    || value.sealValidation.issues.includes('STALE_FITTING')!==(value.checks.find(c=>c.code==='SEAL_FITTING')?.status==='STALE')
    || value.sealValidation.complete!==(value.checks.find(c=>c.code==='SEAL_FITTING')?.status==='COMPLETE'))
    ctx.addIssue({code:'custom',message:'Readiness does not match seal validation.'});
  if (new Set(value.checks.map(c => c.code)).size !== checkCodes.length
    || value.checks.some(c => productionCheckCodes.some(code => code === c.code)
      ? c.status !== 'UNAVAILABLE'
      : c.status === 'UNAVAILABLE' || (c.status === 'STALE' && c.code !== 'SEAL_FITTING'))
    || value.checks.find(c => c.code === 'VEHICLE_DRAFT')?.status !== 'COMPLETE'
    || (value.package === null && (value.fittingRevision !== 0 || value.checks.find(c => c.code === 'SEAL_FITTING')?.status !== 'MISSING'))
    || (value.package !== null && value.fittingRevision === 0)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid readiness checklist.' });
  }
  for (const [aggregate, codes] of [
    ['IDENTITY_SAMPLE', ['OWNER_ID']], ['REGISTRATION_SAMPLE', ['REGISTRATION_PROOF']],
    ['VEHICLE_PHOTO_SAMPLE', ['VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO']],
  ] as const) {
    const complete=value.evidenceChecklist.items.filter(item=>(codes as readonly string[]).includes(item.code))
      .every(item=>item.status==='COMPLETE');
    if ((value.checks.find(c=>c.code===aggregate)?.status==='COMPLETE')!==complete)
      ctx.addIssue({ code: 'custom', message: 'Readiness does not match required evidence.' });
  }
});
export type EnrollmentReadiness = z.infer<typeof readinessSchema>;
type Request = (path: string, options: { signal?: AbortSignal }) => Promise<unknown>;
export async function readReadiness(request: Request, id: string, signal?: AbortSignal) {
  const draftId = z.uuid().parse(id);
  const result = readinessSchema.parse(await request('/v1/enrollment-drafts/' + draftId + '/readiness', { signal }));
  if (result.draftId.toLowerCase() !== draftId.toLowerCase()) throw new Error('Unexpected draft.');
  return result;
}
