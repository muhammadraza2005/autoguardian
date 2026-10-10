# Development evidence-review foundation

Implemented 10 October 2026. This is an accredited development agent's self-review
of fictional evidence in their own draft. It does not grant administration or
authority reviewer permissions and cannot approve production registration.

## Setup

Apply migrations in order. Hosted 011–014 are now confirmed by read-only inspection;
do not replay installed migrations.
For a fresh development setup, apply [014](../supabase/migrations/202610100014_development_evidence_reviews.sql)
once as postgres in the development Supabase SQL Editor after 013. The restricted
backend login cannot install schema changes. No new credentials or provider
settings are needed. On 10 October 2026, the existing hosted installation passed
read-only function, forced-RLS, append-only grant, denied-client-access and policy
checks. No migration was rerun. Signed-in acceptance remains pending.

Build/restart the backend, then run from `backend/`:

```powershell
npm.cmd run build
node --env-file=.env scripts/verify-enrollment-setup.cjs
```

Missing setup returns 503; the app displays an explicit setup message.

## App acceptance

1. Sign into the development browser as an accredited agent and open a saved
   enrollment's Review step. Use only fictional evidence.
2. The Sample evidence review card lists current uploaded documents/photos,
   including fitting photos. Download and inspect each file before deciding.
3. Mark a staged sample acceptable, or choose a correction reason: unreadable,
   incomplete, wrong document/view or mismatched details. Pending uploads cannot
   be reviewed. Native sample images can be viewed in memory; decision controls
   require the current image load event. Native PDFs render in the app; every
   page must render before a sample decision is enabled.
   See [native setup and acceptance](DEVELOPMENT-NATIVE-EVIDENCE.md).
4. Refresh to verify decisions persist. Upload a correction in Documents: the new
   attachment starts unreviewed; the original decision remains in the history.
   No replacement/supersession policy is inferred, and old files are not deleted.
5. On an ambiguous save failure, retry the same decision/key. Discard-and-refresh
   abandons only the local attempt; it does not undo a committed decision.
6. A competing decision/draft edit returns a conflict. Refresh before deciding
   again. Changed draft revision invalidates decisions; changed owner generation
   also hides old attachments and their decisions. Losing accreditation denies
   both reads and writes.
7. Verify English/French wording, narrow layouts, keyboard/touch accessibility and
   navigation locking while a request or uncertain save is pending.

Browser/device interaction remains unverified. Phone acceptance was deferred by
the project owner. Downloads use the existing audited, decrypted sample read
endpoint; downloaded files must remain fictional.

## API and persistence

- `GET /v1/enrollment-drafts/:id/attachments/reviews` returns versioned,
  current-owner attachment metadata and latest decisions for this draft revision.
- `POST /v1/enrollment-drafts/:id/attachments/:attachmentId/review` requires an
  `Idempotency-Key` UUID and exactly `expectedDraftRevision`,
  `expectedReviewRevision`, `decision`, `reason`.
- `ACCEPTED_SAMPLE` requires a null reason. `NEEDS_CORRECTION` requires one of
  `BLURRY`, `INCOMPLETE`, `WRONG_DOCUMENT`, `DETAILS_MISMATCH`. Arbitrary text and
  client approval/scope fields are rejected.
- Server tenant/auth context, active accreditation, draft ownership and forced
  RLS scope all access. API/client/service roles have no direct table access.
- Decisions are append-only, versioned per attachment, serialized on the draft
  and retry key, with exact retries creating no extra records. Executor runtime
  cannot update or delete review events. This is not tamper-proof against database
  administrators.
- Projection excludes ciphertext paths, hashes, owner details and old decision
  reasons. It always returns `sampleOnly: true`, `productionApproved: false`,
  `canSubmit: false`. Sample readiness still means files saved, not reviewed.

## Production work still required

The project owner has approved independent TENANT_ADMIN review. That separate
workflow, correction/replacement, audit and trusted review receipts are implemented
in [migration 017 and its guide](REGISTRATION-REVIEWS.md); installation is pending.
Native capture/PDF viewing and the finalization component are also implemented.
Actual identity/consent verification, physical seal inspection and payment remain
their separate integrations. This sample self-review still cannot approve a
production registration. A requested download is not proof of human inspection.

## Automated validation

The isolated HTTP/PostgreSQL enrollment acceptance scenario exercises pending-file
denial, correction/acceptance transitions, exact retries, reused-key conflicts,
stale revisions, invalid payloads, cross-tenant denial, revoked access, direct
table/function denial, immutable history, vehicle-revision and owner invalidation. Mobile contract
tests reject production claims and malformed review states and check scoped API
retries and bilingual keys. Auth/Storage are provider doubles in this scenario;
this does not prove hosted or native acceptance. Latest backend build/34 tests,
mobile TypeScript/lint/57 tests, 123 database checks and web/Android exports passed.
Offline dependency compatibility passed with the tool's reliability warning.
