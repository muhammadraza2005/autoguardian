import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceReviewBody, evidenceReviewsSchema, readEvidenceReviews, saveEvidenceReview } from '../src/features/enrollment/evidenceReviews.ts';
import { evidenceReviewEn, evidenceReviewFr } from '../src/i18n/evidenceReviewResources.ts';
const id = '00000000-0000-4000-8000-000000000001';
const body = { expectedDraftRevision: 2, expectedReviewRevision: 0, decision: 'NEEDS_CORRECTION', reason: 'BLURRY' };
const result = { version: 1, draftId: id, draftRevision: 2, sampleOnly: true, productionApproved: false, canSubmit: false,
  items: [{ attachmentId: id, kind: 'OWNER_ID', uploadStatus: 'STAGED', reviewRevision: 1,
    decision: 'NEEDS_CORRECTION', reason: 'BLURRY', reviewedAt: '2026-10-10T00:00:00Z' }] };
test('review contracts reject production claims, unsupported decisions and inconsistent correction states', () => {
  assert.ok(evidenceReviewBody.safeParse(body).success);
  for (const patch of [{ reason: null }, { decision: 'APPROVED' }, { productionApproved: true },
    { expectedReviewRevision: -1 }, { expectedDraftRevision: 0 }, { reason: 'Private text' }]) {
    assert.equal(evidenceReviewBody.safeParse({ ...body, ...patch }).success, false);
  }
  assert.ok(evidenceReviewBody.safeParse({ ...body, decision: 'ACCEPTED_SAMPLE', reason: null }).success);
  assert.ok(evidenceReviewsSchema.safeParse(result).success);
  for (const patch of [{ canSubmit: true }, { productionApproved: true }, { sampleOnly: false }, { items: [...result.items, ...result.items] }]) {
    assert.equal(evidenceReviewsSchema.safeParse({ ...result, ...patch }).success, false);
  }
  for (const patch of [{ uploadStatus: 'PENDING' }, { reason: null }, { reviewedAt: null }, { decision: 'NOT_REVIEWED' }]) {
    assert.equal(evidenceReviewsSchema.safeParse({ ...result, items: [{ ...result.items[0], ...patch }] }).success, false);
  }
  assert.ok(evidenceReviewsSchema.safeParse({ ...result, items: [{ ...result.items[0], decision: 'NOT_REVIEWED', reason: null, reviewedAt: null }] }).success);
});
test('review writes retain scoped route, revisions and exact retry payload', async () => {
  const calls = []; const request = async (route, options) => { calls.push({ route, options }); return result; };
  await readEvidenceReviews(request, id);
  await saveEvidenceReview(request, id, id, id, body);
  await saveEvidenceReview(request, id, id, id, body);
  assert.equal(calls[0].route, '/v1/enrollment-drafts/' + id + '/attachments/reviews');
  assert.equal(calls[1].route, '/v1/enrollment-drafts/' + id + '/attachments/' + id + '/review');
  assert.deepEqual(calls[1], calls[2]); assert.deepEqual(calls[1].options.body, body);
  await assert.rejects(() => readEvidenceReviews(async () => ({ ...result, draftId: '00000000-0000-4000-8000-000000000002' }), id));
  await assert.rejects(() => readEvidenceReviews(async () => { throw new Error('Denied'); }, id), /Denied/);
});
test('review controls, decisions and correction reasons have matching bilingual resources', () => {
  const keys = value => Object.entries(value).flatMap(([key, item]) => typeof item === 'object' ? keys(item).map(child => key + '.' + child) : [key]).sort();
  assert.deepEqual(keys(evidenceReviewEn), keys(evidenceReviewFr));
});
