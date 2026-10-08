import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[\x00-\x1f\x7f]/.test(v));
const common = { name: text(200), idDocumentType: text(64), idDocumentNumber: text(100),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/), preferredLanguage: z.enum(['en', 'fr']) };
export const ownerDetailsSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('INDIVIDUAL'), companyRegistration: z.null(), representativeName: z.null() }).strict(),
  z.object({ ...common, type: z.literal('COMPANY'), companyRegistration: text(100), representativeName: text(200) }).strict(),
]);
export type OwnerDetails = z.infer<typeof ownerDetailsSchema>;
export const ownerSaveSchema = z.object({ expectedDraftRevision: z.number().int().positive(), details: ownerDetailsSchema }).strict();
export const ownerConsentSchema = z.discriminatedUnion('accept', [
  z.object({ expectedDraftRevision: z.number().int().positive(), ownerGeneration: z.number().int().positive(),
    version: text(100), language: z.enum(['en', 'fr']), accept: z.literal(true), termsAccepted: z.literal(true), dataAccepted: z.literal(true) }).strict(),
  z.object({ expectedDraftRevision: z.number().int().positive(), ownerGeneration: z.number().int().positive(),
    version: text(100), language: z.enum(['en', 'fr']), accept: z.literal(false) }).strict(),
]);
export const ownerSnapshotSchema = z.object({
  draftId: z.uuid(), draftRevision: z.number().int().positive(), ownerProfileId: z.uuid(), ownerGeneration: z.number().int().positive(),
  details: ownerDetailsSchema.nullable(), savedAt: z.iso.datetime({ offset: true }).nullable(),
  documents: z.array(z.object({ version: text(100), language: z.enum(['en', 'fr']), termsText: text(4000), dataText: text(4000) })).max(2),
  consent: z.object({ status: z.enum(['RECORDED', 'WITHDRAWN']), version: text(100), language: z.enum(['en', 'fr']),
    recordedAt: z.iso.datetime({ offset: true }), recordedByProfileId: z.uuid(), source: z.literal('AGENT_RECORDED_SAMPLE') }).nullable(),
  sampleOnly: z.literal(true), phoneVerified: z.literal(false), productionConsentVerified: z.literal(false),
}).superRefine((v, ctx) => {
  if (new Set(v.documents.map(d => d.language)).size !== v.documents.length || Boolean(v.details) !== Boolean(v.savedAt)
    || (v.consent && (!v.details || v.consent.language !== v.details.preferredLanguage
      || !v.documents.some(d => d.language === v.consent!.language && d.version === v.consent!.version)))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid owner snapshot.' });
  }
});
export type OwnerSnapshot = z.infer<typeof ownerSnapshotSchema>;
export type OwnerSave = z.infer<typeof ownerSaveSchema>;
export type OwnerConsent = z.infer<typeof ownerConsentSchema>;
type Request = (path: string, options: { method?: 'POST'; body?: unknown; idempotencyKey?: string; signal?: AbortSignal }) => Promise<unknown>;
function parse(value: unknown, id: string) {
  const result = ownerSnapshotSchema.parse(value);
  if (result.draftId.toLowerCase() !== id.toLowerCase()) throw new Error('Unexpected draft.');
  return result;
}
export async function readOwner(request: Request, id: string, signal?: AbortSignal) {
  z.uuid().parse(id);
  return parse(await request('/v1/enrollment-drafts/' + id + '/owner', { signal }), id);
}
export async function saveOwner(request: Request, id: string, key: string, body: OwnerSave) {
  z.uuid().parse(id); z.uuid().parse(key);
  return parse(await request('/v1/enrollment-drafts/' + id + '/owner', { method: 'POST', idempotencyKey: key, body: ownerSaveSchema.parse(body) }), id);
}
export async function recordOwnerConsent(request: Request, id: string, key: string, body: OwnerConsent) {
  z.uuid().parse(id); z.uuid().parse(key);
  return parse(await request('/v1/enrollment-drafts/' + id + '/owner/consent', { method: 'POST', idempotencyKey: key, body: ownerConsentSchema.parse(body) }), id);
}
