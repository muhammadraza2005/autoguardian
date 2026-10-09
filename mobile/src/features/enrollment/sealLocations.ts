import { z } from 'zod';

export const locationDescription = z.string().trim().min(3).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const location = z.object({ position: z.number().int().min(1).max(4), description: locationDescription }).strict();
export const sealLocationBody = z.object({ expectedDraftRevision: z.number().int().min(1).max(2147483646),
  expectedFittingRevision: z.number().int().min(1).max(2147483646), expectedLocationRevision: z.number().int().min(0).max(2147483646), locations: z.array(location).length(4),
}).strict().refine(value => new Set(value.locations.map(item => item.position)).size === 4);
export type SealLocationBody = z.infer<typeof sealLocationBody>;
export const sealLocationsSchema = z.object({ version: z.literal(1), draftId: z.uuid(),
  draftRevision: z.number().int().positive(), fittingRevision: z.number().int().nonnegative(), locationRevision: z.number().int().nonnegative(),
  package: z.enum(['NONE', 'STANDARD', 'ONE_ALARM', 'FOUR_ALARMS']).nullable(), required: z.boolean(),
  current: z.boolean(), complete: z.boolean(), locations: z.array(location).max(4), savedAt: z.string().nullable(),
  sampleOnly: z.literal(true), policyVerified: z.literal(false), physicalVerified: z.literal(false),
}).superRefine((value, ctx) => {
  if (value.required !== (value.package !== 'NONE')
    || new Set(value.locations.map(item => item.position)).size !== value.locations.length
    || (!value.current && (value.locations.length > 0 || value.savedAt !== null))
    || (value.current && (value.locationRevision < 1 || value.fittingRevision < 1 || value.package === null || value.locations.length !== 4 || value.savedAt === null || !value.required))
    || (value.required && value.complete !== value.current)
    || (value.complete && value.fittingRevision < 1)) ctx.addIssue({ code: 'custom', message: 'Invalid placement notes.' });
});
export type SealLocations = z.infer<typeof sealLocationsSchema>;
type Request = (path: string, options?: { method?: 'POST'; body?: unknown; idempotencyKey?: string; signal?: AbortSignal }) => Promise<unknown>;
export async function readSealLocations(request: Request, id: string, signal?: AbortSignal) {
  const value = sealLocationsSchema.parse(await request('/v1/enrollment-drafts/' + z.uuid().parse(id) + '/seals/locations', { signal }));
  if (value.draftId.toLowerCase() !== id.toLowerCase()) throw new Error('Unexpected draft.');
  return value;
}
export async function saveSealLocations(request: Request, id: string, key: string, body: SealLocationBody) {
  const parsed = sealLocationBody.parse(body);
  const value = sealLocationsSchema.parse(await request('/v1/enrollment-drafts/' + z.uuid().parse(id) + '/seals/locations', {
    method: 'POST', idempotencyKey: z.uuid().parse(key), body: { ...parsed, locations: [...parsed.locations].sort((a, b) => a.position - b.position) },
  }));
  if (value.draftId.toLowerCase() !== id.toLowerCase()) throw new Error('Unexpected draft.');
  return value;
}
