# Enrollment verification — 10 October 2026

This verification covers the existing development enrollment preparation flow.
It does not complete production enrollment or authorize activation.

## Hosted development prerequisites

The configured hosted development database was inspected without changing its
schema or domain data. Migrations 011 and 012 are already present: the evidence
checklist and fitting-validation functions, Seals/Review validation wrappers and
assigned-stock reservation policy were found. Expected function privileges passed,
including denial of direct runtime access to the internal checklist. TLS certificate
validation and the non-superuser/non-BYPASSRLS login checks passed.

Reproduce from `backend/`:

```powershell
node --env-file=.env scripts/verify-enrollment-setup.cjs
```

This script uses a read-only transaction and prints only check results. Presence
and privilege checks do not establish production acceptance or concurrency safety.
Do not replay installed migrations.

The existing hosted evidence probe also passed: private bucket configuration,
attachment RLS/functions, encryption key format, ciphertext storage, successful
decryption, anonymous/public access denial and probe cleanup. It creates one
synthetic encrypted Storage object and deletes it; it does not enroll a vehicle.

```powershell
node --env-file=.env scripts/verify-evidence-setup.cjs
```

## Complete isolated API journey

`backend/tests/enrollment-acceptance.test.cjs` adds a complete five-step HTTP
acceptance scenario using all migrations, real controllers/services, encryption
and restricted SQL roles in disposable PGlite. Authentication and Storage are
explicit test doubles; no hosted identity or domain record is written.

The scenario verifies:

- Vehicle draft creation/retry and duplicate rejection.
- Fictional owner details and French versioned sample acknowledgments.
- Interrupted evidence read-back leaves a pending requirement; exact retry stages
  one attachment without duplicate records.
- Purchase proof satisfies the registration alternative; six distinct image views
  complete the eight-item checklist; PDFs and reused view images are rejected.
- Four fitting images bring the draft to 12 attachments; read-only fitting checks
  do not create save events, and an exact fitting retry creates only one event.
- All development preparation checks can complete while every production check
  remains unavailable, submission/activation stay false and physical verification
  stays false. The readiness summary excludes private owner and file data.
- Editing owner details invalidates evidence/consent and makes fitting stale;
  obsolete revisions fail, no vehicle/ownership is created, and revoked agent
  accreditation denies subsequent reads.

Reproduce from `backend/` after building:

```powershell
node --test tests/enrollment-acceptance.test.cjs
```

The full backend suite passed all 28 tests, including the new journey test. Mobile
TypeScript/lint and all 38 tests passed. The 123 database foundation checks passed.
Web and Android Hermes exports passed. Installed dependency compatibility passed
with Expo's warning that offline validation is less reliable.

## Interactive acceptance

The configured backend starts and connects successfully. `/v1/health` returns 200;
unauthenticated draft and stock routes return 401. The live development browser
serves `/`, `/agent` and the enrollment route with HTTP 200. Serving HTML does not
verify signed-in interaction, camera permissions, responsive layout or accessibility.

Browser automation could not initialize because the Windows sandbox helper failed.
ADB detected no connected Android device. The project owner requested finishing
this report and testing the phone later, so Android device checks are deferred.
Native private evidence capture/offline storage
remain gated; a successful bundle export does not validate them.

Remaining interactive scenarios are in
[the connected wizard walkthrough](CONNECTED-ENROLLMENT-WIZARD.md),
[evidence checklist acceptance](DEVELOPMENT-EVIDENCE-CHECKLIST.md) and
[seal/camera acceptance](DEVELOPMENT-SEAL-VALIDATION.md).

Production enrollment still requires stronger agent authentication, owner OTP,
authenticated consent, production evidence/physical seal review, provider-confirmed
payment, authority review policy and atomic finalization.
