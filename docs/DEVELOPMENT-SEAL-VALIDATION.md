# Development seal validation

The connected Seals step supports assigned-stock choices, QR scanning and manual
`DEV-SEAL-*` entry. Code entry checks the restricted server stock record before
accepting a code. Checking choices makes no reservations or audit save events;
only a successful fitting save changes reservations.

## Setup

In the development Supabase project, apply any missing migrations in order through
[011](../supabase/migrations/202610090011_enrollment_evidence_checklist.sql), then run
the entire [012](../supabase/migrations/202610090012_seal_fitting_validation.sql)
once as postgres in SQL Editor. Do not rerun applied migrations. Existing sample
stock and encrypted evidence setup are still required. No credentials, providers
or encryption keys need changing. Hosted 012 was not applied by this change.

Build/start the backend with `Start Backend.cmd`. Refresh the live app at
`http://localhost:8081/agent`, open a saved draft and select Seals. Older database
setup returns a setup-required error for fitting/readiness instead of counting
incomplete checks as success. Sample upload remains browser-only; native private
capture/offline encryption is still gated.

## Behavior

- QR/manual entry accepts a raw development seal code, trimmed and uppercased.
  URLs, JSON payloads and consumer verification tokens are rejected. The scanner
  never opens a URL, creates a file or claims a signature was verified.
- Camera permission is requested on Open QR scanner. Denied permission or camera
  failure leaves manual entry available. Camera preview stops on scan, close,
  route blur or app background. Confirm the scanned code with Check and use.
- Unknown or foreign stock appears unavailable. Revoked/destroyed assigned stock,
  reservations, duplicate codes and excess package types receive specific feedback.
  A seal transferred between agents remains unavailable while its earlier draft
  reservation is active. Other agents' draft identifiers are never returned.
- Four seals with four staged fitting photos complete a sealed package. Partial
  saves are allowed with missing seals/photos. No-seals requires an empty list.
  Package type limits are four standard; three standard plus one alarm; or four
  alarms. Invalid stock/types/photos cannot be saved.
- A photo reference cannot fill two entries. Different uploads of identical
  normalized image content cannot fill two entries either. A failed duplicate-image
  save rolls back the package, reservations and event together. This detects
  identical content, not visually similar photographs or edited copies.
- Vehicle/owner edits make the saved fitting stale; owner generation rules also
  invalidate previous attachments. Draft and fitting revisions protect both checks
  and saves. Exact retry keys preserve the original operation; retries return the
  current saved checks, including later revocation, without another save event.
- Seals and Review show a versioned, server-calculated `sealValidation` summary:
  only completion, physical-verification false, and numbered issue codes. No code,
  file ID, owner identity, image hash or storage path enters this summary. Review
  reads saved records. Unsaved changes clear old results until checked again.

`POST /v1/enrollment-drafts/:id/seals/validate` accepts the same package, placements
and expected revisions as saving, without an idempotency key. Duplicate code/photo
choices reach this read-only endpoint for diagnostics. Duplicate positions and
malformed bodies are rejected. The normal save endpoint retains stricter input
validation and atomic database enforcement.

## Acceptance

Use fictional data and dedicated drafts. Test both languages and a narrow screen:

1. Choose a sealed package. Enter an assigned code manually, then scan a QR with
   the same raw code; confirm it is checked before selection. Cancel scanning,
   deny permission, background the app and navigate away. Manual entry must work.
2. Try an unknown code, revoked/destroyed assigned sample, reserved code, repeated
   code, wrong package type and a URL QR. Confirm specific failures, no reservation
   from checking and no loss of the previous selection.
3. Attach four distinct synthetic fitting images and check/save. Reopen Seals and
   Review; both show complete development records. Use two uploaded IDs containing
   the same image and confirm duplicate-image rejection without a partial save.
4. Save a partial fitting, switch packages, edit vehicle/owner, and reload. Confirm
   missing/stale details never count as complete. Test revision conflicts and retry
   the same body/key after an ambiguous save.
5. Confirm submission remains disabled even when every development check passes.

Local tests cover migration installation under a non-superuser schema owner, RLS,
HTTP authentication, diagnostics, revision conflicts, retries, revocation,
reassignment and duplicate-image rollback. Browser camera/device acceptance remains
pending because browser automation could not initialize in this session. Bundle
exports do not replace device acceptance or hosted multi-connection contention tests.

Physical positions 1–4 are still development placeholders. Category-specific
placement policy, authenticated manufacturing/issuance and signed seal authenticity,
physical inspection, production evidence review, owner OTP/consent, stronger agent
login, payment and finalization remain separate unfinished work. `physicalVerified`
stays false and submission/activation stay disabled.

Scanner integration uses the installed [Expo SDK 57 Camera API](https://docs.expo.dev/versions/v57.0.0/sdk/camera/).
