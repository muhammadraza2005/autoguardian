# Milestone 1 — Finish vehicle registration

Last reviewed: **10 October 2026**.

This is the handoff for the next development session. Read this file alongside
[whatsleft.md](whatsleft.md), the relevant repository instructions, and the linked
implementation guides. Recheck repository and hosted setup state before continuing.

## Completion estimate and target

The previous 45–50% estimate is superseded by the concrete checklist below.
Evidence handling, finalization and independent review components are implemented.
Three production integrations remain: agent access/consent, seals and payments,
followed by the deferred manual acceptance. This is not yet real registration.

Milestone 1 is achieved when an authorized agent can register a real vehicle
through all required checks, and its verified owner can see the active vehicle in
their account. A saved draft, sample consent, staged file, sample review decision
or complete development fitting does not satisfy this target.

## What is done

- [x] NestJS backend and Supabase database foundation with restricted database
  roles, tenant isolation, row-level security and scoped audit events.
- [x] Development authentication, server identity checks, role loading and
  organization-scoped agent accreditation/access checks.
- [x] Agent enrollment drafts with vehicle details, owner selection, duplicate
  checks, revision conflicts and retry handling.
- [x] Encrypted sample owner details and versioned English/French sample consent.
- [x] Browser document/photo uploads, encrypted private storage, required evidence
  checklist and audited sample file reads. Saved evidence is not verified evidence.
- [x] Development assigned seal stock, QR/manual checks, reservations, provisional
  fitting records and fitting diagnostics.
- [x] Four saved sample seal location descriptions, bound to current draft and
  fitting revisions, with conflicts, exact retries and stale-data hiding.
- [x] Development evidence self-review: sample downloads, acceptable/correction
  decisions, four fixed correction reasons and append-only review history.
  Vehicle edits require fresh review; owner edits hide previous evidence.
- [x] Connected five-step agent wizard: Vehicle, Owner, Documents, Seals, Review.
- [x] Readiness checks that keep submission and activation disabled.
- [x] Owner vehicle list/detail reads already exist; activation must create the
  records that make newly registered vehicles appear there.
- [x] English/French resources for the connected enrollment features.
- [x] Technical setup guides and automated validation.
- [x] Encrypted native vehicle/seal and owner-form recovery, attachment and review
  retry journals, camera/sample selection and in-memory image viewing/review.
  Migration 015 is installed. Android PDF viewing is now implemented with a
  bundled renderer and automated real-PDF rendering checks; device acceptance
  remains pending. See [native implementation and limits](docs/DEVELOPMENT-NATIVE-EVIDENCE.md).
- [x] Submission/finalization component: trusted prerequisite checks, content
  snapshots, duplicate protection, exact retries and atomic vehicle/ownership/audit
  writes, connected to owner reads and the Review step. Migration 016 is installed
  and verified. Real activation still requires the remaining trusted integrations;
  isolated successful activation tests use synthetic privileged fixtures.

- [x] Independent TENANT_ADMIN review under the project owner's approved policy:
  separate reviewer access, audited image/PDF inspection, corrections, explicit
  replacement, append-only history, snapshot invalidation, agent feedback and
  trusted review/evidence confirmations. Migration 017 awaits installation;
  approval still requires the remaining production seal confirmation.
  See [setup and acceptance](docs/REGISTRATION-REVIEWS.md).

Latest checks passed: backend build and **38 tests**; mobile TypeScript, lint and
**60 tests**; **123 isolated database foundation checks**; web and Android Hermes
exports. Offline dependency compatibility passed with the tool's reliability
warning. These checks do not establish signed-in browser or physical-device
acceptance. The full enrollment HTTP test uses Auth/Storage provider doubles.

## What is left

- [ ] Production authentication: real login and required stronger agent factors;
  finish production permissions without allowing users to self-grant roles.
- [ ] Authenticated owner consent. Existing consent is explicitly a development
  sample. SMS/phone OTP integration is moved to Milestone 2 by the project owner;
  it remains an activation dependency, not a sample-verification bypass.
- [ ] Final physical-device evidence/capture/PDF acceptance. Android handling,
  PDF viewing, encrypted recovery and automated checks are implemented;
  full offline operation belongs to Milestone 3.
- [ ] Production seal issuance and authenticated identifiers; approved
  category-specific placement rules and physical inspection.
- [ ] Install review migration 017. The reviewer policy is approved and the
  workflow is implemented; prepare a separate reviewer account at final acceptance.
- [ ] Confirmed registration payment, including verified provider callbacks and
  failure/retry handling. Coordinate this prerequisite with milestone 3 billing.
- [ ] Connect the remaining trusted authentication,
  consent, seal and payment producers to the implemented finalization
  component. Production draft creation belongs to production authentication/
  enrollment integration; samples remain blocked.
- [ ] Signed-in browser and Android acceptance, including failed uploads, expired
  sessions, revoked permissions, competing edits, retries and incomplete checks.
- [ ] Verify French wrapping, narrow screens, keyboard, touch and accessibility.

## Scope boundary

The remaining checklist above covers registration only. SMS and owner phone OTP
integration belong to Milestone 2. Full offline startup, automatic durable sync,
stock reconciliation, general administration, subscriptions and expanded billing
belong to Milestone 3. App-wide language/security acceptance, performance,
monitoring, backup/restore, production deployment and store release belong to
Milestone 4. Broader transfer and institutional connector work is outside this
registration milestone.

Registration consent and verification hooks remain in Milestone 1; they must
fail closed until Milestone 2 supplies trusted owner verification. Registration
payment handling remains here because `whatsleft.md` explicitly requires payment
integration early enough to support registration. It does not include the whole
billing system. Workflow-specific permissions, audit records, bilingual copy and
browser/Android acceptance remain part of each milestone's own implementation.

## Current setup and decisions

- Seventeen migrations exist in source. Hosted development **011–016 are confirmed**
  by read-only inspection; do not replay them.
- New [migration 014](supabase/migrations/202610100014_development_evidence_reviews.sql)
  is **installed**, confirmed by read-only inspection on 10 October 2026.
  Review functions, forced RLS, append-only executor grants, denied client table
  access and the two executor policies passed verification. Do not replay it.
- No new credentials, bucket or environment setting is required for 013/014.
- [Migration 015](supabase/migrations/202610100015_native_evidence_uploads.sql)
  is installed, confirmed by read-only inspection on 10 October 2026. All setup
  checks pass, including restricted native upload bindings and function privileges.
  Do not replay it. Native uploads are ready for final manual acceptance.
- Migration 016 is installed and passed read-only hosted verification after the
  project owner ran it. Migration 017 is implemented and pending installation;
  follow [the exact setup instructions](docs/REGISTRATION-REVIEWS.md).
- Backend and Metro were running at the last check: backend health on port 3000
  and agent route on port 8081 returned 200; unauthenticated review access returned
  401. Recheck on the next session; processes may have stopped.
- SMS and phone OTP integration are assigned to Milestone 2 by the project owner.
  Owner verification remains required before real activation. Stronger staff
  factor choices still require the approved authentication policy.
- No payment provider has been selected, confirmed by the project owner in this
  session. Provider confirmation cannot be treated as implemented.
- Manual browser and Android acceptance should be performed at the end, per the
  project owner's instruction. Continue independent implementation work first.
- Android phone testing was deferred: the owner asked to finish the report and
  test the phone later. Do not report device acceptance as completed.
- Provider choices/access and production seal/authentication/consent rules still
  need project-owner input. The independent authority review policy is approved.
  Samples cannot produce production approval or activation.

## Next achievable steps

1. Continue production authentication/consent, seal issuance
   and configured payment handling, connected to the implemented finalizer.
   Approved authentication/consent/seal rules and payment provider access are still needed for
   enabling production. Leave manual acceptance until the end.
2. Apply migration 017 once using the review guide. Migrations 015–016 are complete.
   To recheck setup from `backend/`:

   ```powershell
   node --env-file=.env scripts/verify-enrollment-setup.cjs
   ```

   This script is read-only and prints setup booleans without credentials. It
   now expects eighteen functions and the restricted review tables. It exits nonzero
   until 017 is installed; the existing 011–016 checks still pass.
   Installation and metadata checks do not establish signed-in acceptance.
3. At final manual acceptance, open an enrollment's Review step in the signed-in
   development browser. Use
   fictional samples to test downloads, correction/acceptable decisions, refresh,
   exact retries, competing edits and draft/owner invalidation. Follow the guide
   below. Check that submission and activation stay disabled.
4. At final Android acceptance, follow the native guide for recovery, capture,
   encrypted retries, image review, conflicts, sign-out and cache cleanup.
   Do not enable real evidence based on Node tests or exports alone.

## Implementation references

- [Connected wizard](docs/CONNECTED-ENROLLMENT-WIZARD.md)
- [Evidence review API, setup and acceptance](docs/DEVELOPMENT-EVIDENCE-REVIEWS.md)
- [Seal locations](docs/DEVELOPMENT-SEAL-LOCATIONS.md)
- [Evidence checklist](docs/DEVELOPMENT-EVIDENCE-CHECKLIST.md)
- [Seal fitting validation](docs/DEVELOPMENT-SEAL-VALIDATION.md)
- [Enrollment verification report](docs/ENROLLMENT-VERIFICATION-2026-10-10.md)
- [Backend setup](backend/README.md) and [database setup](supabase/README.md)
- [Mobile instructions](mobile/AGENTS.md)

Current development routes include `/agent` and
`/agent/new-enrollment?id=<draft-uuid>&step=review`. Implementation lives in
`backend/src/`, `mobile/src/features/enrollment/` and `supabase/migrations/`.

When changing code, run the relevant backend/database checks and the mobile
typecheck, lint, tests and compatibility checks required by its instructions.
Update this handoff and `whatsleft.md` with verified results and remaining work.
Keep local secrets and real owner documents out of commits and test fixtures.
