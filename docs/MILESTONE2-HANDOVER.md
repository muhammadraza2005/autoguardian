# Milestone 2 development handover

Implemented locally on 11 October 2026. This is a development handover, not
production or telecom acceptance. No hosted database, provider account or secrets
were changed. Keep the previous uncommitted registration work when reviewing.

## SQL to run

Apply in order on the development project, using the migration/schema owner:

1. Existing migrations through 021 (021 was reported installed and verified).
2. [022 SMS outbox and receipts](../supabase/migrations/202610100022_twilio_sms_delivery.sql), if not already installed.
3. [023 remaining development workflows](../supabase/migrations/202610110023_milestone2_workflows.sql).
4. [023 read-only verifier](../supabase/verify-milestone2-workflows.sql). All eight columns must be true.

These are run-once migrations, not repeatable setup scripts. Migration 023 depends
on 001–022, including signed production seal tables from 019. Check your migration
history first; hosted 020/022 installation was not confirmed in this session.
The executor gets temporary schema CREATE for changing function ownership, then
loses it. No runtime login receives executor membership or table access.

023 intentionally does not seed timing, limits or backup recipients. An
administrator must set `max_checks_per_hour` (1–100) on the existing development
`private.vehicle_check_configuration` row. Existing `response_seconds`,
`result_validity_seconds` and `sample_enabled` remain required. Optional
`reminder_seconds` and `backup_seconds` must be positive and shorter than the
response window. Null means that job is disabled. Choose values for synthetic
testing rather than enabling sample mode on a production authority. All new
checks still return `sampleOnly: true`.

## Run and use

From `backend/`: `npm.cmd run build`, then the existing `npm.cmd start`.
Start `npm.cmd run checks:worker` separately for deadline processing; append
`-- --once` to process one bounded batch. It uses the restricted existing database
login and tenant, polls every `CHECK_SWEEP_INTERVAL_MS` (default 10000), and never
sends an SMS itself. The existing `sms:worker` dispatches queued owner reminders
and buyer-result notices only when explicitly configured and allowlisted.

The mobile app has Account links to **Check**, **Pending owner requests** and
**Vehicle reports**. Owned vehicle details link to sale changes and missing reports.
The existing design preview remains synthetic and cannot call the live API.
In live mode, consumer sign-in uses Supabase phone OTP. Staff can select email
sign-in and complete the existing MFA flow. The development email enrollment mode
continues to work, but its email proof cannot authorize these phone-gated owner
operations.

OTP sending and verification use the real Supabase Auth methods. Resend has a
60-second UI cooldown; provider rate limits and configured expiry are authoritative.
The code field follows Supabase's six-digit configuration. Invalid, expired,
undelivered and rate-limited attempts never produce a local success. Configure the
actual Auth provider before trying live OTP. See [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login).

Owner binding uses the existing `app.users.auth_user_id` and
`private.owners.user_id`, never a client claim of ownership by phone number.
An owner must sign in to the Auth account already linked during enrollment.
A new account with the same name does not acquire vehicles. Agent-assisted phone
replacement is still a separate identity-recovery procedure; there is no
self-service change endpoint here. After an actual Auth phone change, the current
Auth phone confirmation is checked again on each owner operation. Do not edit
Auth tables manually or share an Auth test OTP with production.

## Backend operations

| Operation | Route / behavior |
| --- | --- |
| Start check | `POST /v1/vehicle-checks`, Idempotency-Key UUID, `{method,value}` |
| Buyer checks | `GET /v1/vehicle-checks`, optional `cursor` and `limit` (1–50) |
| Current result | `GET /v1/vehicle-checks/:id`; read also settles an overdue request |
| Owner inbox | `GET /v1/me/check-requests`, same pagination |
| Decision | `POST /v1/me/check-requests/:id/decision`, `{decision:"approved"|"refused"}` |
| Sale update | `POST /v1/me/vehicle-status/:id`, key UUID, `{expectedStatus,saleStatus,reason}` |
| Owner status history | `GET /v1/me/vehicle-status/:id/history` |
| Submit report | `POST /v1/vehicle-reports`, key UUID, `{vehicleId,kind,occurredAt,description}` |
| Own report list | `GET /v1/vehicle-reports` |
| Upload evidence | `POST /v1/vehicle-reports/:id/evidence`, key UUID, `{kind,dataBase64}` |
| Own evidence read | `GET /v1/vehicle-reports/evidence/:id` |
| Independent review | `GET /v1/vehicle-report-reviews`; `POST .../:id`, key UUID, `{status,reason}` |
| Reviewer evidence read | `GET /v1/vehicle-report-reviews/evidence/:id` |

Every route authenticates the current session; the controller never accepts an
actor/tenant/owner in input. The SQL operations recheck current roles and
relationships. Report review requires existing live staff MFA and TENANT_ADMIN,
and an actor cannot review their own report. All routes use `Cache-Control: no-store`.

Methods are `plate`, `chassis`, `seal` (manual production seal code), and `qr`
(the existing signed URL format). QR needs the existing server seal signing key
ring. A valid signature alone is insufficient: the seal must be fitted, ACTIVE,
not revoked and linked to an activated registration. No seal positions or alarm
types are returned. Plates/chassis use trim and case folding, without inventing
a national plate format or a 17-character VIN requirement. Ambiguous plates fail
closed; use chassis or a seal. Buyer results only contain the 021 allowlist.
Lookup and request creation share one transaction; no separate unpaid public
result endpoint was added.

Repeated requests are limited per buyer over a rolling hour. Exact retries reuse
the original key and do not consume additional quota. A changed vehicle under
the same key conflicts. Phone identity is bound to one Auth account; broader
provider/device/IP abuse controls still need operational acceptance.

Buyer results poll every five seconds while focused/active. Fetch failures hide
cached results. Server expiry remains authoritative; the UI also hides the
vehicle at expiry while preserving the historical outcome. Owners approve only
an individual request. Duplicate/late/cross-owner decisions fail. Transfers
invalidate previous-owner results and access. A listing never approves a check
and an approval never transfers ownership.

## Scheduling and reports

Jobs persist relative to request creation. A due reminder creates one durable
notification; repeated sweeps do not duplicate it. A backup job becomes
`awaiting_configuration`, without inventing an accepted contact or delegation.
Decisions/timeouts cancel pending backup jobs and queued reminders atomically.
Already submitted SMS cannot be recalled. Ownership changes cancel outstanding
schedule jobs during the next sweep; sending also rechecks current ownership.
Buyer reads and owner decisions enforce deadlines even if the worker is down.

Report kinds are `incident`, `missing`, `recovered`. Verifiers may submit an
incident for a vehicle they checked; owners may report their current vehicle
missing or recovered. Missing/recovered changes are immediate owner reports,
not official police clearance. Recovery requires a reason and resets to
NOT_FOR_SALE. Review adds append-only history and does not fabricate police action
or silently reverse an owner report. Buyers see only the vehicle's permitted
sale/record status, never report descriptions, evidence or reporter identity.

Sale changes currently permit NOT_FOR_SALE → FOR_SALE and FOR_SALE/AGENT_SALE →
NOT_FOR_SALE. Missing/recovered uses the separate reporting operation.
AGENT_SALE creation stays blocked until an accepted seller mandate exists.
Owner status changes remain development-gated until the production PIN/step-up
policy is integrated. No arbitrary client state or role can bypass this gate.

For evidence, set a dedicated server-only `AUTOGUARDIAN_REPORT_EVIDENCE_KEY`
(32 random bytes as 64 hex digits). Missing key returns setup-required; no plaintext
fallback exists. JPEG/PNG images are re-encoded without EXIF/GPS; PDFs receive the
existing bounded content screening. Each report allows ten files, each at most
2 MB. Evidence is staged, AES-256-GCM encrypted with authority/report/file AAD,
and stored in the private database for this development implementation. Retrieval
checks current access, records an audit event, authenticates the ciphertext and
verifies its digest. No public bucket or bearer download link exists. Keep and
back up the key; key rotation/versioning, approved retention and malware scanning
remain production work. Do not infer malware clearance from PDF screening.
Mobile uploads retain an uncertain attempt in memory for exact retry; temporary
native capture copies are removed by the existing picker adapter. No new offline
report/evidence cache is created.

## Basic-phone simulation

`backend/src/basicPhone.ts` implements strict `CHECK PLATE`, `CHECK CHASSIS`,
`CHECK SEAL`, `STATUS`, `APPROVE`, `REFUSE`, `HELP`. Decisions/status require the
full request UUID, so an ambiguous bare `1` or `2` cannot authorize anything.
The simulated SMS and USSD adapters reuse the SQL-backed service. There is no
public inbound endpoint and no sender-number-only authentication.

USSD includes plate/chassis checks, pending owner requests, decisions, status
retrieval and exit. Sessions bind to one simulation principal, expire, serialize
concurrent inputs, replay identical sequence retries and end after request creation.
Dropped sessions can retrieve the persisted request in a new session. The simulator
is bounded and memory-only; a real gateway needs durable/shared session storage,
provider-authenticated callbacks, approved identity/challenge handling, short
reference design and network-specific text limits. Do not expose this simulator
as a live gateway. All replies are labeled TEST and available in English/French.

## Verification and external acceptance

Local result: backend build and 80 tests pass; mobile typecheck, lint and 73 tests
pass. Expo compatibility reports up to date and Doctor passes 21/21 checks.
The seven recommended SDK 57 patch packages were updated using Expo's installer.
Web and Android Hermes exports succeed; this is bundle validation, not handset
or live provider acceptance. The all-migration installation test also runs as a
non-superuser schema owner and checks that temporary schema CREATE is removed.
The package installer reported 28 dependency advisories (10 moderate, 18 high).
Compatibility/Doctor success is not an audit clearance; review those advisories
before release rather than applying a forced, potentially breaking upgrade.

Run `npm.cmd test` in backend and mobile; mobile also has `typecheck`, `lint`,
`check:dependencies`, `doctor`, and export scripts. Database tests exercise real
PostgreSQL functions through PGlite, including rollback, privacy, grants,
ownership changes, expiry, scheduler deduplication, evidence encryption and
cross-channel duplicate decisions. PGlite is single-session; it does not prove
real multi-connection races, hosted Supabase, radio delivery or device behavior.

Still required before release: install/verify hosted migrations; client-owned
Auth/SMS account and supported sender/inbound route; real phone binding/OTP
acceptance; production payment allowance and owner PIN/step-up rules; approved
backup contacts/delegation, seller mandates/listing duration; USSD provisioning
and handset testing; PostgreSQL concurrency/load acceptance; key recovery,
retention, monitoring and independent security acceptance. These are not marked
complete merely because simulations pass.
