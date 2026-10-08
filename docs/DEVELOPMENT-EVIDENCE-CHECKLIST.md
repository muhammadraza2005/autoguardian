# Detailed enrollment evidence checklist

Implemented 9 October 2026 for the connected development agent wizard. This is
saved sample preparation, not document authenticity, physical inspection or
production approval. Phone OTP remains deferred and submission remains disabled.

## Apply and start

1. Apply existing development migrations 001–010 first. In the development
   Supabase SQL Editor, run [011](../supabase/migrations/202610090011_enrollment_evidence_checklist.sql)
   once. Existing hosted installations apply only this missing migration.
2. Keep the existing private evidence bucket and server encryption key. No new
   bucket, secret, account or environment variable is required. Do not replace
   the key or replay already-applied migrations.
3. Restart **Start Backend.cmd** and refresh **Preview Live Login.cmd**. Open a
   fictional draft in **Agent → Documents**, after saving its owner details.

Migration 011 has been tested locally, including installation by a non-superuser
schema owner. It has **not** been applied to hosted Supabase by this change.
The updated API reports setup unavailable for the old checklist rather than
allowing a generic photo to complete Documents.

## Requirements

Documents and Review show the same eight server-calculated requirements:

| Requirement | Accepted sample |
| --- | --- |
| Owner identity | JPG, PNG or PDF |
| Registration certificate or purchase proof | Either document; JPG, PNG or PDF |
| Front view | JPG or PNG |
| Rear view | JPG or PNG |
| Left side | JPG or PNG |
| Right side | JPG or PNG |
| Chassis identifier | JPG or PNG |
| Plate | JPG or PNG |

Each input is limited to 2 MiB. Images are re-encoded without EXIF/GPS metadata,
then encrypted before private storage. The six photo requirements must use
distinct images: the same normalized image hash cannot be reserved under
different required photo kinds. This prevents simple file reuse; it does not
prove the images depict different views or the correct vehicle.

Each requirement is **Missing**, **Upload pending**, or **Saved — not approved**.
Only a `STAGED` upload counts, after encrypted storage read-back succeeds.
An already saved sample remains complete if another attempt for the same
requirement is pending. A registration certificate and a purchase proof are
alternatives, not two separate requirements.

Earlier generic `VEHICLE_PHOTO` attachments remain downloadable, with a notice
explaining that they do not satisfy a named view. Existing identity and
registration samples still count for the current owner generation. No attachment
bytes or encryption metadata are changed by the migration.

The limit is now **30 attachments per current draft/owner generation**, including
pending reservations, to fit the eight requirements and four seal-fitting photos
with room for corrections. The UI explains the limit. Retrying an existing
upload key still works at the limit; new keys cannot exceed it.

## Acceptance walkthrough

- Start with a fictional saved owner. Confirm eight missing requirements and
  matching progress in Review. An old generic photo must leave six views missing.
- Upload owner ID and purchase proof. Confirm the registration-or-purchase row
  completes without also requiring a registration certificate. Repeat with a
  registration certificate in another draft.
- Upload six distinct sample photos. A PDF is rejected for every photo kind;
  using the same image for a different photo kind returns a conflict and does
  not complete that requirement.
- Interrupt an upload/read-back. Pending evidence must not complete its row or
  Documents. Retry the identical file/key and verify one saved attachment.
- Finish the checklist, then add four fitting photos. More than ten total files
  must work. Seal fitting and production validation remain separate checks.
- Edit saved owner details or change the proposed owner. Earlier evidence must
  disappear from the current checklist, including when switching the owner back.
- Revoke access or use a foreign/missing draft. Confirm denial without old file
  rows, sample fallback or stale readiness. Refreshing hides prior results until
  saved server data returns successfully.
- Check English/French and narrow displays/text scaling. Review must show the
  eight individual requirements and keep **Submission unavailable** disabled.

Native private capture remains gated pending verified database/file encryption.
Browser automation could not start in this session, so interactive browser and
Android-device acceptance remain pending.

## API and security

`GET /v1/enrollment-drafts/:id/attachments` and `GET .../:id/readiness` now return
`evidenceChecklist: { version: 1, complete: boolean, items: [{ code, status }] }`.
The readiness identity/registration/photo summary checks and the seal screen's
`sampleDocumentsSaved` use this checklist. Its projection contains no owner
identity, storage paths, attachment IDs or hashes. Existing scoped attachment
list/read APIs retain their authorization and read audit requirements.

Forced RLS, agent/organization/tenant scope, owner-generation invalidation,
idempotency and encryption bindings remain enforced. Production evidence,
authenticated consent, OTP, payment, review and activation remain unavailable.

Local validation: backend build and 26 tests; mobile TypeScript, lint and 33 tests;
web and Android Hermes bundle exports; offline dependency compatibility check;
123 database foundation checks. The Android export required sandbox escalation
to execute the already-installed Hermes compiler. Bundle verification does not
establish device acceptance.
