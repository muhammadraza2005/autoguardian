# Enrollment verification — 10 October 2026

This verification covers the existing development enrollment preparation flow.
It does not complete production enrollment or authorize activation.

## Latest follow-up: independent authority review

The project owner approved active, tenant-scoped TENANT_ADMIN review by someone
other than the enrolling agent. The workflow now includes a scoped reviewer
queue, audited image/PDF inspection, acceptance/correction, explicit same-kind
replacement, immutable history, agent feedback and snapshot-bound approval.
Production decisions can issue only evidence/review confirmations, after a valid
trusted seal confirmation; samples cannot issue production confirmations.
See [implementation and exact setup](REGISTRATION-REVIEWS.md).

Hosted migration 016 is installed and passed read-only verification. Migration
017 awaits manual installation; no hosted schema/account writes were performed.
The verifier now expects 017 and its private append-only table/executor.
Backend build/all **38 tests**, mobile TypeScript/lint/all **60 tests**, and
**123 isolated database foundation checks** pass. Web (4.4 MB entry bundle) and
Android Hermes (6.7 MB) exports pass. Offline dependency compatibility passes
with the tool's reliability warning. Browser/device interaction remains deferred.
Auth/Storage/provider doubles do not prove live production
approval. Stronger staff auth, actual consent, production seals and payments
remain the separate integrations needed before real activation.

## Follow-up: encrypted native enrollment implementation

Native forms, owner/consent attempts, attachment bytes and sample review retries
now have authenticated encrypted device recovery. Camera/file sample selection,
temporary-cache cleanup and in-memory image self-review are implemented. Backend
reservation/staging checks bind native retries to their original draft revision
and owner generation. See [implementation and acceptance limits](DEVELOPMENT-NATIVE-EVIDENCE.md).

Backend build/all 29 tests, mobile TypeScript/lint/all 52 tests, 123 isolated database
checks and Android/web exports pass. Dependency compatibility passes offline with
Expo's reliability warning. Node AES-GCM tests cover real encryption, tampering,
record substitution, account/role isolation, pending-write logout, disk failure,
and owner/file/review retry recovery. Backend tests use real isolated SQL roles and
all 15 migrations to cover exact native upload retries and stale contexts.

Hosted 011–014 remain verified. New 015 is absent, so native uploads remain disabled
there and the updated setup verifier exits nonzero. All eleven expected functions
are required by the expanded verifier. No hosted schema or domain data was changed.
Device acceptance, native PDF rendering and full offline automatic synchronization
remain unfinished. Browser/device manual acceptance is deferred to the end by
the project owner. SMS/phone OTP integration is moved to Milestone 2; no payment
provider has been selected. Real activation stays gated.

## Follow-up: hosted evidence-review setup

Read-only inspection now confirms hosted migrations 011–014. All 16 setup checks
pass, including TLS and restricted runtime role, eight restricted functions,
review table forced RLS, append-only executor grants, denied direct client access,
both review policies and the assigned-stock reservation policy. Migration 014
was already installed; it was not replayed and no hosted domain data was changed.

The verifier now checks review table security and requires all eight expected
functions. Backend build and all 28 existing tests passed again, including the
complete isolated enrollment/review journey. Auth and Storage remain doubles in
that test; hosted signed-in acceptance remains pending.

Browser automation initialization failed again with the Windows sandbox helper
setup error. This blocks automated signed-in downloads, decision interaction and
bilingual layout checks in this session. Android acceptance remains deferred.
The local backend was restarted after the build: health returned 200 and an
unauthenticated evidence-review request returned 401.
The live-login agent preview returned 200 at `http://localhost:8081/agent` after
restarting Metro with offline startup and CI mode (automatic reloads disabled).
HTTP availability does not establish signed-in UI acceptance.

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
# Latest follow-up: evidence PDF viewing and submission/finalization

Both requested implementation components are complete. Android image/PDF viewing
uses in-memory bytes and a bundled offline PDF renderer; automated tests render
real PDF pages and cover failed rendering and all-page review controls. Native
submission retries are encrypted. Migration 016 implements scoped trusted gates,
content snapshots, exact retries, duplicate rejection and atomic vehicle,
ownership and audit writes, read through the existing owner endpoints.

Latest validation: 34 backend tests/build; 57 mobile tests; mobile TypeScript and
lint; 123 isolated database checks; SDK compatibility in offline mode (with its
reliability warning); Android Hermes and web exports. Local backend health and
agent route return 200; unauthenticated submission returns 401. Local services
were restarted with the new code.

Hosted read-only inspection confirms 015 installed and 016 absent. Follow
[migration 016 instructions](ENROLLMENT-SUBMISSION.md). No hosted writes were made.
Real activation remains gated by the other production integrations; successful
automated activation uses privileged synthetic prerequisite fixtures. Browser,
physical Android, live-provider and concurrent live-PostgreSQL acceptance remain
pending. Rebuild the Android development app to include the new WebView module
before final phone testing. Earlier sections below describe historical checks.
