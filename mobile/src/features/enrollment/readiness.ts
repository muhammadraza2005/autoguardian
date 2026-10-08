import { z } from 'zod';

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
}).superRefine((value, ctx) => {
  if (new Set(value.checks.map(c => c.code)).size !== checkCodes.length
    || value.checks.some(c => productionCheckCodes.some(code => code === c.code)
      ? c.status !== 'UNAVAILABLE'
      : c.status === 'UNAVAILABLE' || (c.status === 'STALE' && c.code !== 'SEAL_FITTING'))
    || value.checks.find(c => c.code === 'VEHICLE_DRAFT')?.status !== 'COMPLETE'
    || (value.package === null && (value.fittingRevision !== 0 || value.checks.find(c => c.code === 'SEAL_FITTING')?.status !== 'MISSING'))
    || (value.package !== null && value.fittingRevision === 0)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid readiness checklist.' });
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
