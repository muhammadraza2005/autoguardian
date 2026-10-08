# Development enrollment readiness

This increment adds a server-calculated, read-only checklist and a connected
English/French enrollment review page for synthetic development drafts. It does
not submit enrollment, create ownership, confirm payment or activate a vehicle.

## Setup

After migrations 001–008, run the entire
[009: enrollment readiness](../supabase/migrations/202610080009_enrollment_readiness.sql)
once as `postgres` in the development Supabase SQL Editor. Expected: success,
no returned rows. It adds one restricted function, no tables or credentials.
The current app also requires [010: owner details and sample consent](DEVELOPMENT-OWNER-CONSENT.md).
Apply it after 009, then restart the backend. Hosted 009 installation was confirmed
subsequently; 010 is not yet installed by this implementation.

## Review a saved draft

1. Start **Start Backend.cmd** and **Preview Live Login.cmd**.
2. Sign in as the accredited development agent and open **Development enrollment drafts**.
3. Choose **Review enrollment readiness** on a saved draft or its edit screen.
4. Review metadata, owner eligibility, sample owner details/consent, staged identity/registration/vehicle samples,
   and package/fitting completeness. Pending uploads do not count.
5. Save owner details/sample consent first, then use upload and fitting actions to complete development steps. Save
   edits first; unsaved working copies are not server data.
6. Return to review or choose **Refresh readiness** to obtain a new snapshot.
   A changed draft revision makes saved fitting stale until resaved.
7. Confirm **Submission unavailable** stays disabled even with all sample steps
   saved. Production authentication, owner OTP, consent, full evidence/physical
   seal validation, payment, review rules and finalization remain unavailable.

The page hides old checklists during refresh and on errors. Invalid IDs, missing
drafts and revoked access do not fall back to samples. HTTP 503 displays setup
guidance; an operator should also check backend availability. Native production
access and encrypted offline storage are unchanged.

Switching away from and back to the same browser tab does not refresh the
checklist or draft list. Same-account auth refresh also leaves the review in
place. Navigating back from another page and explicit Refresh still obtain a
fresh snapshot; account or verified permission changes still clear domain state.

## API and security

`GET /v1/enrollment-drafts/:id/readiness` uses the existing development agent
authentication gate. Query fields are rejected; responses use `Cache-Control: no-store`.
It returns `draftId`, `draftRevision`, `fittingRevision`, `package`, a minimal
vehicle summary, `sampleOnly: true`, `canSubmit: false`, `enrollmentActive: false`,
and `checks`. Each check has a stable code and status: COMPLETE, MISSING, STALE
or UNAVAILABLE. COMPLETE means saved for development, not approval. Production
checks are UNAVAILABLE because authoritative workflow records do not exist yet.
There is no submit endpoint in this increment.

SQL executes under the existing non-owner/non-BYPASSRLS enrollment executor with
an empty search path, restricted API role and transaction-local tenant/actor
context. Existing RLS scopes drafts, owner choices, evidence and stock to the
accredited agent. Another agent's draft returns 404; revoked access returns 403.
The draft is share-locked while saved metadata and fitting are read. Readiness is
advisory; finalization must recheck duplicates, stock, permissions and production
prerequisites inside its final transaction.

No owner names/phones, document paths/bytes, seal codes/positions or hashes are
returned. Samples count only for the current proposed owner. Fitting uses the
existing package/type/photo/reservation checks; revoked stock invalidates it.

## Validation and remaining work

Tests cover staged versus pending samples, withdrawn owners, revoked stock,
stale fitting, NONE packages, unchanged vehicle/ownership tables, cross-agent/
tenant denial, direct client function denial, HTTP validation, no-store headers
and missing migration handling. Mobile tests reject malformed checklists,
mismatched draft IDs and fabricated production success, and check bilingual copy.

Hosted signed-in browser acceptance and Android visual/device acceptance remain
manual checks after applying 010. Phone OTP is deferred while other development
requirements progress; production owner verification/consent and approved agent
factors remain prerequisites for finalization.
Provider credentials and authority review rules remain external inputs.

Navigation follows [Expo Router navigation](https://docs.expo.dev/router/basics/navigation/)
for the installed [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
