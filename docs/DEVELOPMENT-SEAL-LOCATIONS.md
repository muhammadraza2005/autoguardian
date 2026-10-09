# Development seal placement descriptions

Implemented 10 October 2026 for milestone one. Agents can record a fictional
location description for each of four saved seals. This records an agent's stated
location, not an approved position, physical inspection or authenticated seal.
Approved category-specific positions remain an authority/project-owner decision.

## Setup

Hosted development migrations 011–013 are now confirmed by read-only inspection.
Do not replay [013](../supabase/migrations/202610100013_seal_location_notes.sql).
The restricted application login cannot install migrations. No new
provider, key, bucket or environment setting is needed. Do not replay applied SQL.

Build/restart **Start Backend.cmd** and refresh the live agent app. Missing 013
shows setup-required only in the new panel; existing fitting/readiness contracts
remain unchanged. From `backend/`, run
`node --env-file=.env scripts/verify-enrollment-setup.cjs` to check installation.
Missing 013 yields `migration013LocationsPresent: false` and a nonzero exit.
The script also checks new evidence-review migration 014; that missing migration
currently gives a nonzero exit while the 013 check succeeds.

## Agent flow

1. Save a current four-seal fitting on **Seals**. Saving now stays on this step.
2. Enter a fictional description of 3–200 characters per slot and select
   **Save placement descriptions**. Unsaved text stays in memory, not browser
   working copies or native offline files.
3. Save/discard note edits before changing fitting choices or leaving the step.
   Explicit reload discards edits. Unknown save outcomes retain the identical
   payload/key for retry.
4. Select **Review enrollment**. Review shows current saved notes and an explicit
   missing/stale or saved-not-inspected status, separately from the older sample
   fitting/evidence progress checklist.
5. Vehicle/owner edits or another fitting save invalidate notes and hide their
   text until recorded again. No-seals packages require no notes and expose no
   previous descriptions.

Descriptions can include confidential fitting information. They are restricted
agent metadata; consumer/buyer APIs and generic readiness do not include them.
Use synthetic descriptions only in this development workflow.

## API and consistency

`GET /v1/enrollment-drafts/:id/seals/locations` returns a versioned snapshot with
draft/fitting/location revisions, package, current/complete flags and current
notes only. Sample-only is true; policy/physical verification remain false.

`POST` requires a UUID idempotency key, all three expected revisions and exactly
four distinct positions with valid descriptions. Four seal choices must be saved;
this does not approve photos or physical fitting. Unknown fields, control
characters, missing/duplicate positions, stale revisions and no-seals writes fail.
The draft lock serializes writes; normalized notes, their revision increment and
one save event commit atomically. Competing editors cannot silently overwrite
the same note revision. Exact retries append no event and return current state.

Forced RLS, tenant/agent/organization scope and revoked-accreditation checks apply.
Client/service/API roles cannot access tables directly. Responses are no-store;
runtime event permissions allow append/read only. Production audit chaining and
retention remain separate work.

## Validation and limits

The expanded HTTP enrollment test covers retries, payload/revision conflicts,
fitting/owner invalidation, no-seals behavior, malformed input, direct table/function
denial, cross-tenant denial and revoked agents. Backend: 28 tests passed. Mobile
contracts reject fake approvals, wrong drafts and stale disclosure; 41 tests passed
with TypeScript/lint. English/French controls are included.

Hosted 013 and browser/Android interactive acceptance remain pending. Native
keyboard/layout behavior and hosted concurrency are not established by isolated
tests or exports. Approved positions, physical/evidence review, stronger login,
OTP/consent, payment, authority policy and finalization remain unfinished.
Submission/activation stay disabled.
