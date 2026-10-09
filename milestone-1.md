# Milestone 1 — Finish vehicle registration

Last reviewed: **10 October 2026**.

This is the handoff for the next development session. Read this file alongside
[whatsleft.md](whatsleft.md), the relevant repository instructions, and the linked
implementation guides. Recheck repository and hosted setup state before continuing.

## Completion estimate and target

**Approximately 45–50% complete**, as a planning estimate rather than a measured
percentage or delivery commitment. Much of the enrollment preparation flow is
implemented. Production verification, approval and activation remain unfinished.

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

Latest checks passed: backend build and **28 tests**; mobile TypeScript, lint and
**44 tests**; **123 isolated database foundation checks**; web and Android Hermes
exports. Offline dependency compatibility passed with the tool's reliability
warning. These checks do not establish signed-in browser or physical-device
acceptance. The full enrollment HTTP test uses Auth/Storage provider doubles.

## What is left

- [ ] Production authentication: real login and required stronger agent factors;
  finish production permissions without allowing users to self-grant roles.
- [ ] Owner verification: phone OTP, expiry/resend/attempt handling and verified
  owner consent. Existing consent is explicitly a development sample.
- [ ] Secure Android document/photo capture and viewing; encrypted native drafts
  **and attachment files**, with safe synchronization and conflicts.
- [ ] Production seal issuance and authenticated identifiers; approved
  category-specific placement rules and physical inspection.
- [ ] Authorized production reviewer roles, separation of duties, evidence
  standards, correction/supersession handling and authority approval rules.
- [ ] Confirmed registration payment, including verified provider callbacks and
  failure/retry handling. Coordinate this prerequisite with milestone 3 billing.
- [ ] Enrollment submission/finalization: enforce all prerequisites, prevent
  duplicate activation, atomically create vehicle/ownership records and append
  audit events, then expose the registered vehicle through owner reads.
- [ ] Signed-in browser and Android acceptance, including failed uploads, expired
  sessions, revoked permissions, competing edits, retries and incomplete checks.
- [ ] Verify French wrapping, narrow screens, keyboard, touch and accessibility.

## Current setup and decisions

- Fourteen migrations exist in source. Hosted development **011–013 are confirmed**
  by read-only inspection; do not replay them.
- New [migration 014](supabase/migrations/202610100014_development_evidence_reviews.sql)
  is **not installed** at the latest inspection. Review endpoints return setup
  required until it is installed. Apply it once as postgres in the development
  SQL Editor. The restricted backend login cannot install schema changes.
- No new credentials, bucket or environment setting is required for 013/014.
- Backend and Metro were running at the last check: backend health on port 3000
  and agent route on port 8081 returned 200; unauthenticated review access returned
  401. Recheck on the next session; processes may have stopped.
- Phone OTP was deferred by the project owner. It remains required before real
  registration. Do not interpret that deferral as permission to bypass it.
- Android phone testing was deferred: the owner asked to finish the report and
  test the phone later. Do not report device acceptance as completed.
- Provider choices/access and approved production seal/review rules still need
  project-owner input. Sample acceptance is agent self-review, not authority
  approval. Production evidence approval, submission and activation remain false.

## Next achievable steps

1. Install missing migration 014 once, then verify setup from `backend/`:

   ```powershell
   node --env-file=.env scripts/verify-enrollment-setup.cjs
   ```

   This script is read-only and prints setup booleans without credentials. It
   currently exits nonzero because migration 014 is missing.
2. In the signed-in development browser, open an enrollment's Review step. Use
   fictional samples to test downloads, correction/acceptable decisions, refresh,
   exact retries, competing edits and draft/owner invalidation. Follow the guide
   below. Check that submission and activation stay disabled.
3. Resume Android acceptance when a device is available; finish secure native
   evidence handling before enabling real capture or native review decisions.
4. Confirm reviewer/evidence rules and seal placement/issuance requirements, then
   implement production review and physical inspection under approved permissions.
   Arrange SMS/OTP and payment sandbox access alongside this work.
5. Implement finalization only after its authentication, consent, evidence, seal,
   payment and authority prerequisites can be verified by the server.

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
