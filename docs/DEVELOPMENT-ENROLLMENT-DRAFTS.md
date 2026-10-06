# Development enrollment drafts

This step saves vehicle metadata and a **proposed** link to an existing profile. It does not create an owner, grant OWNER, create a core vehicle, activate protection or approve enrollment. Photos, documents, owner OTP, payment and final review/activation are still pending.

## Run in Supabase

Use the isolated **development** project, SQL Editor, `postgres` role. Core migrations 001–004 must already have succeeded. Run each new file once, in this order:

1. [005: enrollment drafts](../supabase/migrations/202610060005_enrollment_drafts.sql). Expected: success, no returned rows.
2. [Development agent setup](../supabase/setup-development-agent.sql). Expected: your test profile, development organization ID, `ENROLLMENT_AGENT`, and accreditation `ACTIVE`.

The second file explicitly grants the existing test account an organization-scoped agent role and a development accreditation. It guards the known development tenant/profile and refuses to restore suspended/revoked/expired grants or accreditation. It does not change passwords or Supabase Auth accounts. Do not run it in production. No environment changes are required.

The current owner selector additionally requires [006 and owner setup](DEVELOPMENT-OWNER-SELECTION.md). These have been confirmed in the development project; do not rerun a successful migration. Optional sample file staging requires [007 and private bucket setup](DEVELOPMENT-EVIDENCE-UPLOADS.md) plus server-only upload configuration.

## Verify in the app

The backend and live preview can be started with **Start Backend.cmd** and **Preview Live Login.cmd**.

1. Sign in, then select **Refresh profile**. Existing roles remain; `ENROLLMENT_AGENT` should also appear.
2. Select **Development enrollment drafts** → **New enrollment draft**.
3. The authorized organization is prefilled. Select **Development owner 1** rather than typing a UUID. For a new synthetic draft, use an unused chassis/plate such as `AUTOGUARDIAN-DRAFT-004` / `DRAFT-004`, category `CAR`, and optional make/model/year/color. Do not reuse another draft's identifiers or `DEV-001`.
4. Select **Save draft**. Only after the backend confirms success does the app return to the drafts list, which refreshes to show the saved draft and revision. A failed save keeps the editor open with the entered values.
5. Reopen the draft, edit its color, and save. The app should return to the list again. Reopen it to confirm the change remains after signing out/in.
6. Try a second new draft using the same chassis or plate: it should show a conflict. The saved draft should remain unchanged.
7. “My vehicles” should still contain the original test vehicle; a draft is not added there.

Unfinished synthetic form fields now recover from account/role-scoped tab storage in the development browser, including after a refresh or navigation away/back. They remain temporary working copies until **Save draft** succeeds on the server. This is not native encrypted/offline storage. Uploaded bytes, passwords/PINs and query caches are never persisted by the working-copy store. Sign-out or verified identity/permission changes clear the working copies; server revision changes invalidate ordinary older working copies. Following a lost create response, retry retains the same payload and creation key, including after reload. Pending edits retain their original expected revision so recovery cannot silently repeat a completed update. **Reload saved draft** explicitly discards the working copy and loads the server record.

## API and permission boundary

- `GET /v1/enrollment-drafts?limit=20&cursor=<uuid>`: own authorized drafts, UUID pagination, maximum 50 per request.
- `GET /v1/enrollment-drafts/:id`: same unavailable response for missing/inaccessible drafts.
- `POST /v1/enrollment-drafts`: requires a UUID `Idempotency-Key` header. Replaying the same initial payload returns the current saved draft; a changed initial payload with that key gives 409.
- `PUT /v1/enrollment-drafts/:id`: full metadata replacement with `expectedRevision`; organization remains fixed. Stale revision gives 409.

Create body:

```json
{
  "organizationId": "014db61a-4c68-48cb-86b6-46837f4da873",
  "ownerProfileId": "369cbe75-32c8-40b4-a9ee-f2d9bde379db",
  "vehicle": {
    "chassisIdentifier": "AUTOGUARDIAN-DRAFT-002",
    "plate": "DRAFT-002",
    "category": "CAR",
    "make": "Development",
    "model": "Draft vehicle",
    "manufactureYear": null,
    "color": null
  }
}
```

Unknown fields, tenant IDs, status/ownership grants and evidence are rejected. For an update add `"expectedRevision": 1`. Response is `{ "draft": { ... } }` with ID, organization, proposed owner profile, vehicle metadata, fixed `DRAFT` status, revision and timestamps.

Each request validates a genuine Supabase identity, active development tenant/profile/organization, current organization-scoped `ENROLLMENT_AGENT` role and active accreditation. Agent grants do not unlock the unfinished production sections. The draft HTTP API is disabled outside the existing explicit development email mode; SQL also limits it to `AUTOGUARDIAN_DEV`. Required production agent password + OTP authentication must be implemented before enabling production draft access.

Runtime may read its authorized drafts and invoke one reviewed write function. It cannot write core vehicles/ownership/roles, read owner legal names, browse profiles, edit accreditation, bypass RLS, switch to the restricted function executor, or alter/delete event records. The executor is NOLOGIN, non-owner, non-superuser and non-BYPASSRLS, with scoped policies and a fixed empty search path.

Chassis conflicts use trim/case-fold globally, including archived core chassis identifiers. Plate conflicts are a provisional development guard within the tenant against current core vehicles and drafts. Unique indexes also prevent two drafts reserving the same identifiers; core enrollment activation must revalidate identifiers and its final uniqueness rules later. D09's final plate namespace remains unresolved. A draft reservation needs a later authorized abandonment/release workflow; no deletion endpoint is included now.

Created/updated drafts and rejected duplicate attempts append metadata-only events transactionally. This is not the full production audit hash chain. Existing vehicles/owners and consumer endpoints are unaffected by draft writes.

## Checks

Backend tests apply 001–005 in isolated PGlite and cover authorization/RLS, duplicate constraints and recorded rejection events, retry keys, revision conflicts, owner-profile scope, forbidden activation/writes and unchanged ownership. Mobile tests validate contracts and HTTP request behavior. PGlite is not evidence of a multi-connection hosted concurrency test. Hosted SQL execution and signed-in app checks require the steps above. Native device acceptance, production agent factors, enrollment evidence, owner verification, fees/payment, review and activation remain future work.
