# Development owner details and consent

This increment adds synthetic individual/company identity details and versioned
sample acknowledgments. Phone OTP remains deferred. It creates no verified owner,
registered vehicle, ownership, insurer-sharing authorization or active enrollment.

## Setup

1. Apply migrations 001–009 first. Run
   [010](../supabase/migrations/202610080010_enrollment_owner_consent.sql) once as
   `postgres` in the **development** Supabase SQL editor. This migration has been
   tested locally; it has not been applied to the hosted project by this change.
2. Keep the existing backend `ENROLLMENT_EVIDENCE_KEY_HEX` (32 random bytes encoded
   as 64 hex characters). Owner encryption and request fingerprints derive separate
   keys from it using HKDF. Never replace an existing key: it also protects saved
   development attachments. No extra SMS service or storage bucket is required.
   If the key is absent, owner endpoints return HTTP 503 with setup guidance.
3. Restart **Start Backend.cmd** to load the new backend, then use
   **Preview Live Login.cmd**. Sign in with the accredited development agent.

## Walkthrough

1. Open **Development enrollment drafts**, select a saved draft and choose
   **Owner details and sample consent**. Save the vehicle/proposed-owner selection
   before entering this screen; unsaved metadata is not server data.
2. Use fictional information only. Select **Individual** or **Company**, complete
   name, identity document type/number, international phone and preferred FR/EN
   language. Companies also require a registration number and representative name.
3. Save. The server encrypts all identity fields before PostgreSQL storage, advances
   the draft revision and owner generation, invalidates earlier evidence/sample
   consent and makes saved fitting stale. Save owner details **before** uploads.
4. Read the versioned sample terms and sample data text in the saved preferred
   language. Explicitly acknowledge each, then record the sample acknowledgment.
   The server records the agent profile, version, language, generation and time.
   This is agent-recorded sample activity, not authenticated owner acceptance.
5. Return to review. **Sample owner details** and **Sample versioned consent** now
   use saved server data. Production **Owner phone verification** and **Identity
   details and consent** remain unavailable; **Submission unavailable** stays disabled.
6. Withdraw the sample acknowledgment and refresh review: the sample consent check
   becomes incomplete. Editing saved details clears current consent; record a new
   acknowledgment after saving. Changing the proposed owner and switching back
   cannot recover old details, evidence or consent. Restage samples and resave fitting.
7. Switching away and returning to the browser tab must preserve current edits.
   Explicit reload discards edits. Interrupted saves retain the same request/body
   in memory for retry; after a full reload, read the saved server state first.

Invalid IDs, missing drafts, ineligible owners and revoked agent access fail closed.
Foreign drafts are hidden. Stale revisions or reused request keys with changed
content return HTTP 409. Missing migration/key returns HTTP 503; also check backend
availability. No sample fallback is used.

## Storage and remaining work

The restricted API role can execute scoped functions only; it cannot select the
encrypted details or consent-event tables directly. RLS is forced. Identity data
does not enter draft list/readiness responses, audit payloads, URLs, logs, browser
working-copy storage or idempotency payloads in SQL. Request fingerprints use HMAC
rather than an unkeyed hash of identity fields. AES-256-GCM binds ciphertext to the
tenant, draft, proposed owner and generation; corruption or a wrong key fails closed.
Sensitive reads append audit events before disclosure. Consent text content cannot
be rewritten under an existing version; operators retire a version and add a new one.
Withdrawal appends an event and retries cannot undo it.

Unsaved forms and retry bodies live in component memory only. The active screen's
server response uses an account-scoped memory query with zero inactive retention.
Account/scope changes clear application queries. Native production access and
encrypted offline storage are unchanged; do not collect real personal information.

Before production: approved legal terms/data policy and consent proof, owner OTP,
production agent authentication, verified native database/file encryption and key
management, complete evidence/physical seal validation, payment, review rules and
atomic finalization are still required. Insurer sharing needs separate consent.

Validation uses an isolated PostgreSQL engine and simulated Auth identities. It
covers encryption/tampering, input validation, access isolation, retries, stale
edits, owner-change invalidation, withdrawal, immutable/retired consent versions and
inactive enrollment. Hosted SQL and signed-in browser/native acceptance are separate.
