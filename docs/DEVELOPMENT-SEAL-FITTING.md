# Development seal stock and fitting

Current increment: apply missing migrations through 012 and follow
[seal validation setup and acceptance](DEVELOPMENT-SEAL-VALIDATION.md). The connected
wizard now supports QR/manual code entry, per-position diagnostics, and rejection
of identical image content used for multiple seals. The current attachment limit
is 30 per owner generation; the detailed eight-item evidence checklist replaces
the original aggregate document summary described below. The numbered fitting
positions remain development placeholders.

This step adds real server persistence for **synthetic stock and provisional enrollment drafts**. Phone OTP and the remaining encryption verification work remain deferred at the user's request. Production activation, payment, physical seal validation and signed QR generation are separate work. No core vehicle, ownership, subscription or active seal is created here.

## Run in Supabase

In the development project, use **SQL Editor → New query**, with the **postgres** database role. Migrations 001–007 and the development agent/owner setup must already be applied.

1. Run the entire [008: development seal fitting](../supabase/migrations/202610060008_development_seal_fitting.sql) **once**. Expected: success, no returned rows.
2. In a new query, run [development seal stock](../supabase/setup-development-seal-stock.sql). Expected: batch `DEV-BATCH-001`, **12 STANDARD** and **8 ALARM** seals.

008 adds four private tables, access policies, restricted backend functions, reservation indexes, and a new encrypted attachment kind for fitting photos. It replaces the existing attachment-kind check with one allowing the additional kind; it does not delete attachments, drafts, users or vehicles. The stock setup creates only `DEV-SEAL-*` sample codes assigned to the existing development agent. Rerunning the stock setup preserves revocation and existing reservations; it does not replenish/reset stock. Do not rerun the migration.

No new `.env` credentials, storage bucket, SMS provider or payment provider are required. The existing encryption adapter handles fitting photos. Do not rotate its encryption key. SQL must be run by the user as postgres, not through the restricted backend database login.

## Test in the browser

1. Start **Start Backend.cmd** and **Preview Live Login.cmd** if they are not already running. Open `http://localhost:8081` and refresh after SQL setup.
2. Sign in, open **Development enrollment drafts**, then **Development seal stock**. Confirm codes and availability are loaded from the backend. A code is the unique number printed on a physical seal; `DEV-SEAL-*` codes are synthetic samples.
3. Return to the list and choose **Protection package and seals** on an existing saved draft.
4. Choose **Four standard seals**. Package changes clear unsaved fitting choices; saved reservations change only after a successful save.
5. Under **Seal 1 of 4**, tap **Choose a seal** and select an available code. The list filters out seals used by another entry, unavailable stock and types that do not match your package. Codes saved on this draft remain selectable.
6. Tap **Upload a photo for this seal**, selecting `sample-seal-fitting-1.jpg` from `.tools/upload-samples/`. A successful upload attaches the photo to that entry automatically. Repeat for seals 2–4 with the other three sample files. **Use a photo already uploaded** lets you reuse an existing fitting upload once; it cannot be assigned to two entries. Photos must be JPG/PNG, at most 2 MiB. The total limit of 10 attachments per current draft/owner includes fitting photos and unconfirmed uploads. Changing an entry's seal clears its photo selection so it can be checked again. No manual code typing is needed.
7. Click **Save seal fitting draft**. Success returns to the drafts list. Reopen the package/seals page and confirm the details persisted and **Seal fitting draft complete** shows **Complete for development**.
8. Stock should show those codes as **Reserved for a draft**. A second draft cannot reserve the same codes. Partial fitting drafts can be saved, but remain incomplete until all four valid seals and four distinct photo references are present.
9. Other package choices are **No seals**, **Three standard seals and one alarm seal**, and **Four alarm seals**. Use available `DEV-SEAL-ALM-*` stock for alarm seals. No seals requires an empty placement list; it completes only this development step, not enrollment.

The fitting page also shows vehicle draft, sample document, owner-phone and payment progress. Sample documents means an identity sample, registration sample and vehicle photo have been staged; it is not the complete production document/view/consent checklist. Owner verification and payment remain pending. Editing the vehicle/owner draft makes a previously saved fitting stale; review and resave it against the new draft revision. A missing/changed-owner photo cannot be reused.

Unfinished sample package/seal/photo-reference choices now recover within the current development browser tab after navigation or a refresh. The working copy is separate from server confirmation, holds no file bytes or filenames, and clears on sign-out/account/permission changes or a successful save. Same-account auth refresh keeps the editor mounted. Server revisions prevent older working copies from overwriting newer data; pending saves retain their original replay key/body. **Reload saved fitting details** explicitly discards the working copy. Native encrypted offline recovery remains deferred.

If samples are missing, regenerate them with `node backend/scripts/create-evidence-samples.cjs` from the project root. This creates only synthetic JPEG files in ignored local tooling storage. Actual browser upload/download acceptance requires the hosted SQL and a signed-in user; local automated tests do not replace that check.

## Access and integrity

- All three API routes use genuine development identity verification and the existing accredited-agent gate. SQL also requires the active `AUTOGUARDIAN_DEV` tenant, actor, organization, grant and accreditation.
- Stock is assigned to a specific agent/organization. No agent can browse another agent's stock or fitting details. Buyers and owned-vehicle endpoints receive no alarm classification, positions or private fitting evidence.
- Four private tables have forced RLS. Clients, service-role API access and the runtime role have no direct table grants. Reviewed functions execute as the existing non-owner, non-BYPASSRLS executor with a fixed empty search path.
- Draft and stock locks serialize writes; a partial unique index enforces one current reservation per seal globally. Current position and photo-reference uniqueness are also enforced. Old reservations are retained with a release timestamp, and saves append an immutable request/event payload.
- Full replacement is atomic: invalid codes, unavailable stock, package mismatches, wrong photos, duplicates and stale revisions leave prior reservations intact. Changing a successfully saved sample package can release its previous reservations; real fitted seal replacement/revocation is not implemented by this development operation.
- UUID request keys are bound to draft, package, placements and both revisions. Same-key retries return current authoritative state; changed payloads conflict. Authorization/owner eligibility are rechecked on retries. A lost response does not reserve the seal twice.
- A fitting photo must be a staged image attachment for the same draft and current proposed owner. Encryption, metadata stripping and audited downloads use the existing upload service. This checks the reference and file lifecycle; it does not prove that a real physical seal was fitted.

## API

- `GET /v1/seal-stock?organizationId=<uuid>&limit=20&cursor=<uuid>`: own assigned stock, maximum page size 50.
- `GET /v1/enrollment-drafts/:id/seals`: package, current fitting, draft revision and development progress.
- `POST /v1/enrollment-drafts/:id/seals`: UUID `Idempotency-Key`, `expectedDraftRevision`, `expectedFittingRevision`, `package`, and up to four `{position, sealCode, photoId}` assignments. `photoId` can be null for an incomplete draft.

Positions 1–4 are explicitly **development placeholders**. Category-specific fitting policy, actual authenticated seal manufacture/batch issuance and HMAC QR/manual verification, stock distribution, replacement/revocation, physical evidence review, production authentication, full enrollment prerequisites and multi-connection hosted contention acceptance remain future work. Package prices are not invented.

Implementation follows `frontend.md` §6 and `backend.md` enrollment/seal workflow. Locking and browser picker behavior were checked against [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html) and [Expo SDK 57 DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/).
