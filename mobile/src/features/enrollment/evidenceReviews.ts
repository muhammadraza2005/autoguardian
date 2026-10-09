import { z } from 'zod';
import { evidenceKindSchema } from './evidence.ts';
export const correctionReasons = ['BLURRY', 'INCOMPLETE', 'WRONG_DOCUMENT', 'DETAILS_MISMATCH'] as const;
const reason = z.enum(correctionReasons);
export const evidenceReviewBody = z.object({
  expectedDraftRevision: z.number().int().min(1).max(2147483647),
  expectedReviewRevision: z.number().int().min(0).max(2147483646),
  decision: z.enum(['ACCEPTED_SAMPLE', 'NEEDS_CORRECTION']), reason: reason.nullable(),
}).strict().refine(value => value.decision === 'ACCEPTED_SAMPLE' ? value.reason === null : value.reason !== null);
export type EvidenceReviewBody = z.infer<typeof evidenceReviewBody>;
export const evidenceReviewsSchema = z.object({ version: z.literal(1), draftId: z.uuid(), draftRevision: z.number().int().positive(),
  sampleOnly: z.literal(true), productionApproved: z.literal(false), canSubmit: z.literal(false),
  items: z.array(z.object({ attachmentId: z.uuid(), kind: evidenceKindSchema, uploadStatus: z.enum(['PENDING', 'STAGED']),
    reviewRevision: z.number().int().nonnegative(), decision: z.enum(['NOT_REVIEWED', 'ACCEPTED_SAMPLE', 'NEEDS_CORRECTION']),
    reason: reason.nullable(), reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  }).refine(item => item.decision === 'NOT_REVIEWED' ? item.reason === null && item.reviewedAt === null
    : item.uploadStatus === 'STAGED' && item.reviewRevision > 0 && item.reviewedAt !== null
      && (item.decision === 'ACCEPTED_SAMPLE' ? item.reason === null : item.reason !== null))).max(30),
}).refine(value => new Set(value.items.map(item => item.attachmentId.toLowerCase())).size === value.items.length);
export type EvidenceReviews = z.infer<typeof evidenceReviewsSchema>;
type Request = (path: string, options?: { method?: 'POST'; body?: unknown; idempotencyKey?: string; signal?: AbortSignal }) => Promise<unknown>;
function scoped(raw: unknown, id: string) {
  const value = evidenceReviewsSchema.parse(raw);
  if (value.draftId.toLowerCase() !== id.toLowerCase()) throw new Error('Unexpected evidence review draft.');
  return value;
}
export async function readEvidenceReviews(request: Request, id: string, signal?: AbortSignal) {
  return scoped(await request('/v1/enrollment-drafts/' + z.uuid().parse(id) + '/attachments/reviews', { signal }), id);
}
export async function saveEvidenceReview(request: Request, id: string, attachmentId: string, key: string, body: EvidenceReviewBody) {
  return scoped(await request('/v1/enrollment-drafts/' + z.uuid().parse(id) + '/attachments/' + z.uuid().parse(attachmentId) + '/review',
    { method: 'POST', idempotencyKey: z.uuid().parse(key), body: evidenceReviewBody.parse(body) }), id);
}
