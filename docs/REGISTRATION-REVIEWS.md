# Independent registration review

Implemented 10 October 2026 using the project owner's approved policy: an active,
tenant-scoped `TENANT_ADMIN`, different from the enrolling agent, examines the
owner ID, registration/purchase proof and required photos. Missing, unreadable or
mismatched evidence requires correction. Approval requires accepted evidence and
a current trusted seal confirmation. The policy is recorded here; no new business
role or automatic staff grant is introduced.

## Required setup now: migration 017

Migration **016 is installed and verified**. Do not rerun it.

1. Open [202610100017_independent_registration_reviews.sql](../supabase/migrations/202610100017_independent_registration_reviews.sql).
2. Copy the **whole file**, including `begin` and `commit`.
3. In the development Supabase project, open **SQL Editor → New query**, select
   **postgres**, paste the file and click **Run once**.
4. Expected result: **Success. No rows returned**. No new bucket, credentials or
   environment variable is required for the existing development setup.
5. From `backend/`, run:

   ```powershell
   npm.cmd run build
   node --env-file=.env scripts/verify-enrollment-setup.cjs
   ```

   Every result should be `true`, including `migration017IndependentReviewsPresent`,
   `independentReviewTableRestricted` and `independentReviewExecutorRestricted`.
   The verifier is read-only and now expects 18 functions. It fails until 017 is
   installed. Restart the backend and refresh the app afterward.

## Reviewer account: prepare at final manual acceptance

Use a separate genuine test account. The enrollment agent cannot approve their
own enrollment even if also granted administrator access.

1. Create/sign into the separate development Auth account using the existing
   development login. Open its Account page so the server provisions its tenant
   profile, then copy the **profile ID**, not the Auth user ID.
2. Open [setup-development-reviewer.sql](../supabase/setup-development-reviewer.sql).
   Replace `reviewer uuid:=null` with `reviewer uuid:='THE_PROFILE_UUID'::uuid`.
3. Run that whole script once as postgres in the development SQL Editor. It
   checks the development tenant, existing active profile and absence of an
   enrollment-agent grant. It does not create credentials or edit `auth.users`.
4. Refresh the separate account's profile. Select **Registration reviews** on
   its Account page (route `/registration-reviews`). Staff access comes from the
   server's current grant, never a public metadata field or preview role picker.

## Review and correction workflow

- The queue is tenant scoped and paginated. Own enrollments are excluded. A
  suspended user/tenant, expired or revoked administrator grant cannot read,
  inspect or decide. Agents can read feedback only for their own accredited draft.
- Open an enrollment to compare vehicle details, its package/location descriptions
  and current-owner evidence. Inspect each image or PDF in memory. All PDF pages
  must render, then the reviewer explicitly confirms complete inspection before
  accepting or requesting correction. Browser PDFs use an opaque-origin sandbox
  with the bundled renderer, without external fetches or document scripts.
- Choose one of four correction reasons: unreadable, incomplete, wrong document/view
  or mismatched details. The agent sees the authority feedback in the Review step
  and uploads the corrected evidence in Documents.
- Uploading/editing evidence, owner details, consent or fitting changes the content
  snapshot and invalidates earlier acceptance. Refresh and inspect the current
  files again. No upload is silently treated as replacing an older file.
- The reviewer explicitly chooses **Choose a replacement for this file**, then
  **Replace with this file** on a staged file of the same kind. Both remain stored;
  the old file is marked superseded in the current snapshot and its historical
  decisions remain. Self-replacement, incompatible files and replacement cycles
  are denied. A superseded target cannot be accepted again in that snapshot.
- Every current file must be staged and accepted or explicitly superseded. Owner
  ID, registration/purchase proof and the six distinct vehicle views must be
  accepted. Fitting photos referenced by active placements must be accepted.
- Approval additionally requires a current, accepted, unexpired `SEALS` receipt,
  the saved current fitting package, and applicable placements/location notes.
  The reviewer then explicitly attests to checking the evidence and seal
  confirmation and presses **Approve registration review**.
- Production approval atomically records the reviewer event and writes only
  `PRODUCTION_EVIDENCE` and `REVIEW_POLICY` confirmations. Their expiry inherits
  the trusted seal confirmation. A subsequent correction/decision revokes the
  prior confirmations; a changed snapshot makes them stale automatically.
- Development decisions remain sample decisions and write **no production
  confirmations**. Missing seals cannot be replaced with a checkbox or mock
  inspection. The seal producer belongs to the remaining seal task.
- Authority review occurs **before final submission**. Submission freezes the
  evidence and review snapshot; this component cannot reopen submitted/active
  registrations. Changes before submission are the correction loop implemented
  here. Post-activation administrative changes are outside this registration task.

## API and security

`GET /v1/registration-reviews?limit=20&offset=0` loads the queue;
`GET /v1/registration-reviews/:id` loads the exact review context/history;
`GET /v1/registration-reviews/:id/feedback` is the agent's own-draft projection.
`POST /v1/registration-reviews/:id` requires an Idempotency-Key UUID and exactly:

```json
{
  "expectedDraftRevision": 1,
  "expectedSnapshotRevision": 10,
  "expectedReviewRevision": 0,
  "action": "ACCEPTED",
  "attachmentId": "00000000-0000-4000-8000-000000000001",
  "replacementId": null,
  "reason": null,
  "inspected": true
}
```

Actions are `READ_REQUESTED`, `ACCEPTED`, `NEEDS_CORRECTION`, `SUPERSEDED`,
`APPROVED`. Reads use `inspected:false`; decisions require `true`. Approval has
a null attachment ID. Correction needs a fixed reason; supersession needs a
replacement ID. No arbitrary client payment, identity, seal, tenant or approval
claims are accepted. An audited current-snapshot read is required before an
attachment acceptance/correction, independently for each reviewer.

Audit records are append-only, forced-RLS private tables. The new executor is
nonlogin, nonsuperuser and cannot bypass RLS; the backend login cannot assume it.
Its only receipt-writing function authorizes an independent current administrator
and writes the two review codes. Receipt insertion holds the same draft lock as
submission, preserving 016's snapshot freeze. Client/service/API roles have no
direct review-table rights. API projections exclude ciphertext paths and hashes.

Exact retries create no extra decisions. Changed keys/payloads or competing
versions conflict. Native decisions persist their exact key/body in the existing
encrypted, account-scoped vault before sending. Browser decisions remain in
memory. Unknown saves block new decisions until exact retry or local discard and
refresh. Local discard does not undo a committed server decision. File contents
are cleared when closing the viewer, leaving the screen or backgrounding.

A read event and an attestation are evidence of the workflow, not automatic
proof of identity validity or human attention. The approved policy uses human
review; this component does not perform OCR, government identity verification,
malware certification or physical inspection. Existing production agent/owner
authentication, consent, seal issuance and payment integrations remain separate
activation gates. Production draft creation/storage enablement remains with
those integrations; this migration cannot promote a development sample.

## Acceptance

Automated backend checks cover access denial, self-review, tenant isolation,
revocation, direct privilege denial, inspection requirements, exact retry,
corrections/replacements, stale snapshots, approval gates, sample denial,
production receipt issuance/revocation and scoped audited HTTP file reads.
Installation is checked under a non-superuser schema owner. Mobile checks cover
strict contracts, fake-approval denial, exact retries, matching files and bilingual
resources. Provider/Auth/Storage fixtures are isolated doubles.

Signed-in browser and physical Android acceptance remain at the end, as requested.
Use fictional files with the separate reviewer account. Check all PDF pages,
correction upload/review, replacement selection, competing administrators,
revoked access, uncertain retry, background cleanup, French wrapping and keyboard
controls. Real approval remains blocked until the other production gates exist.

SDK references used: [Expo 57 Crypto](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/)
and [Expo 57 Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/).
