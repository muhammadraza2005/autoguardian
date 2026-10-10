# Registration submission and finalization

Implemented 10 October 2026. This completes the submission/finalization component,
not the independent authentication, consent, seal, review or payment integrations.
Existing development drafts remain samples and cannot activate.

## Manual setup: migration 016

Migrations 015–016 are installed and verified in hosted development. Do not replay
them. The following steps are retained for a fresh setup only. The current verifier
also expects [review migration 017](REGISTRATION-REVIEWS.md), which is not yet installed.

1. Open [202610100016_enrollment_finalization.sql](../supabase/migrations/202610100016_enrollment_finalization.sql).
2. Copy the entire file, including `begin` and `commit`.
3. In the **development** Supabase project, open SQL Editor → New query, select
   the postgres role, paste and Run **once**. Expect `Success. No rows returned`.
4. Do not replay migrations 001–015. No new credentials or bucket are needed.
5. From `backend/`, run:

   ```powershell
   node --env-file=.env scripts/verify-enrollment-setup.cjs
   ```

   It should exit successfully and print every check as `true`, including
   `migration016FinalizationPresent`, `finalizationTablesRestricted` and
   `developmentPromotionDenied`. Until 016 is installed, those checks are false
   and the complete function-count check fails. Earlier installed checks still pass.
6. Restart the backend and refresh the app. The Review step loads the new
   submission status. A development draft explicitly remains blocked.

## Contract and security

- GET `/v1/enrollment-drafts/:id/submission` returns the scoped state and seven
  prerequisite checks: agent authentication, owner verification, consent,
  production evidence, seals/inspection, payment and approval.
- POST to that route submits; POST to `/submission/finalize` activates. Both
  require a UUID `Idempotency-Key` and exactly
  `{ expectedDraftRevision, expectedSnapshotRevision }`. Client claims of payment,
  verification, approval, ownership or active status are rejected.
- Checks require current, accepted, unexpired **trusted receipts** bound to draft,
  owner generation, fitting and content snapshot. The latest receipt controls each
  check; a rejection supersedes an earlier acceptance. Receipt appends lock the
  same draft as submission/finalization.
- Saved required evidence, a valid fitting/package and complete applicable seal
  locations are also checked independently. Sample self-review cannot mint a
  production receipt. Runtime/client roles have no receipt-writing grants.
- Child evidence, owner, consent, fitting, location and review writes advance a
  separate content snapshot revision. Viewing owner details does not. Submitted
  snapshots freeze these mutations. The correction workflow will need an explicit
  authorized return-to-draft transition when independent review is implemented.
- Production drafts and a provisioned, active owner account with an OWNER grant
  are required. The existing development draft entrypoint cannot promote a draft.
  Owner identity provisioning belongs to the consent/authentication integration;
  finalization does not invent an owner identity or grant an OWNER role.
  Ambiguous multiple owner records for one selected profile fail closed rather
  than choosing an arbitrary person/entity; the identity integration must resolve
  that case explicitly.
- Finalization rechecks prerequisites and duplicates inside a serializable
  transaction. It creates the ACTIVE vehicle, current ownership, activation state
  and audit event together. Core deferred ownership constraints are checked before
  returning. Any failure rolls back all activation writes.
- The core chassis index is globally unique, including tombstones. Plates use the
  existing provisional tenant-scoped conflict check with finalizer advisory locks;
  the final plate namespace remains a business decision. Future vehicle-writing
  workflows must follow the same locking rule or introduce the agreed constraint.
- Exact retries return the original vehicle. Conflicting keys, stale snapshots
  and duplicate activation are rejected. The owner’s existing `/v1/me/vehicles`
  list/detail automatically reads the new ownership; other accounts cannot see it.
- Native pending submission keys/bodies use the existing encrypted vault. Browser
  attempts stay in memory. Unknown outcomes retain the exact request; no local
  success is presented as server activation.

## What remains intentionally gated

No production draft creation or trusted receipt producer is enabled by 016.
Migration 017 implements independent approval and the two review receipt producers
under the approved authority-admin policy; see [review setup](REGISTRATION-REVIEWS.md).
The remaining authentication/consent, production seals and
payment tasks must install narrowly authorized integrations that issue these
receipts after actual verification. SMS/OTP remains Milestone 2. Do not manually
promote samples or insert fabricated receipts in the hosted project.

## Verification and final manual acceptance

Automated isolated database/API tests cover blocked samples, permissions, exact
replays, content invalidation, expiry/rejection, revoked access, duplicate
identifiers, mid-activation rollback, owner visibility and the HTTP flow. Synthetic
privileged fixtures stand in for the remaining trusted integrations; no real
provider confirmation is claimed. PGlite tests do not simulate separate live
PostgreSQL connections; concurrent-session acceptance remains at the end.

At final acceptance, test signed-in permission changes, competing edits,
interrupted requests, exact retries, prerequisites changing between submission
and activation, and owner-only visibility. Until real integrations are connected,
hosted samples must remain blocked. Browser and Android acceptance are pending.
