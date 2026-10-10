# Milestone 2: backend rules and database

Migration [021](../supabase/migrations/202610100021_vehicle_check_rules.sql) adds
the database component for the first development module. It builds on the
existing authority/profile/role model, private owner records and current
ownership history. It creates no vehicle, owner, Auth identity or role assignment.
Apply once as postgres after the existing migrations through 020; do not replay
installed files. The project owner reports hosted installation and all eight
verification checks true on 10 October 2026. After
installation run [the read-only verifier](../supabase/verify-vehicle-check-rules.sql);
all eight columns should be true. These checks do not enable requests.

If an earlier copy failed at `ALTER FUNCTION ... OWNER` with permission denied
for schema private, its explicit transaction rolls back the migration. Run the
entire corrected 021 file in a new SQL Editor query as postgres. The corrected
file grants CREATE on private to the destination function owner only during
ownership changes, then revokes it before commit. A non-superuser installation
regression test and the read-only verifier check that CREATE is not retained.

## Buyer-visible contract

Only the buyer who created a request, with a current tenant-level VERIFIER grant,
an active account/authority and confirmed Auth phone, can read its result.
The result contains request ID, outcome, response deadline, response time,
result expiry, expired flag, authorizationUsable, sampleOnly and vehicle.
The exact vehicle allowlist is: `id`, `chassisIdentifier`, `plate`, `category`,
`make`, `model`, `manufactureYear`, `color`, `saleStatus`, `recordStatus`.
These are current values, not cached creation-time values. No owner identity,
phone, owner/user/tenant/ownership IDs, names, documents, PINs, seal codes,
alarm package or history is returned. Seal/trust/incident projections await their
own authoritative workflows; no synthetic trust score is supplied.

Expired results retain the original outcome and timestamps, with `vehicle: null`
and `authorizationUsable: false`. A transferred, deleted or archived vehicle also
loses its projection. A missing, blocked or unpaid vehicle cannot provide usable
approval. Approval is per buyer request and never changes ownership or sale status.

## Configuration and production boundary

No configuration is seeded. New requests fail with CHECKS_NOT_CONFIGURED until
an administrator explicitly configures synthetic development checks. Set
`private.vehicle_check_configuration` for the development tenant with
`sample_enabled=true`, `response_seconds` and `result_validity_seconds`.
For example, 900 and 86400 reflect the SRS's **proposed**, unapproved fifteen-minute
response window and twenty-four-hour result lifetime. Configuration snapshots
apply to new requests only. Timing limits are 1–86400 seconds for responses and
1–604800 seconds for results. No runtime role can change configuration.

Result reads return sample results; `authorizationUsable` describes only the
sample check's state. Do not use it to authorize production sales or transfers.
There is no production enable switch or new HTTP/mobile endpoint in this module.
Real checks need the later lookup/channel adapters, trusted allowance/payment
gates, phone binding/reverification, owner PIN/step-up policy and rate limits.
Confirmed Auth phone is a database requirement now; development email login
cannot authorize a decision. PIN and delegated/backup approval policies remain
unresolved in backend.md and are not bypassed by a production endpoint here.

## Shared database operations

The backend login can call only these functions, inside a transaction with
server-derived `autoguardian.tenant_id` and validated `autoguardian.auth_user_id`:

- `private.create_vehicle_check(vehicle_uuid, request_key_uuid)` returns a request
  UUID and writes creation audit plus an owner notification atomically. Exact
  retries return the same request; a changed vehicle under the same key conflicts.
- `private.decide_vehicle_check(request_uuid, 'approved'|'refused')` checks active
  OWNER role, confirmed phone, original and current ownership, deadline and state.
  Approval requires ACTIVE and not REPORTED_MISSING. Wrong owners receive the same
  CHECK_NOT_FOUND error as unknown requests. Duplicate and late decisions fail.
- `private.read_vehicle_check(request_uuid)` returns the allowlisted JSON and
  atomically settles overdue pending requests to timed_out on buyer reads.

Operations serialize on vehicle and request locks; creation keys also use a
transaction advisory lock. Server clock time is checked **after** lock acquisition,
not the transaction start time. A failed late response does not persist a timeout
inside its rolled-back transaction; the next read settles it. The scheduled
worker/sweep is module 7, and owner inbox/list endpoints are module 5.

`pending` transitions to exactly one of `approved`, `refused`, `timed_out` through
the reviewed functions. Result lifetime starts at the accepted decision, or at
the response deadline for timeout. `responded_at` stays null for timeout.
Decisions and events are append-only for the executor. The notification outbox
records recipient profile, kind, schedule, transport status, attempts and provider
reference/error; it carries no phone or provider credentials. Finalization queues
one buyer result and cancels a queued owner alert. Transport delivery never changes
the check decision. Sending, callbacks, retries and delivery audit are module 2.

All five new tables have forced RLS. The non-login executor has tenant-scoped
policies and no BYPASSRLS; the runtime login has no membership in it and no direct
check-table grants. Security-definer functions have an empty search_path.
Only a narrowly scoped administrator-owned Boolean function reads Auth phone
confirmation; no runtime/executor role receives Auth-table grants.

## Verification

Run `npm.cmd test` from backend. The new isolated PostgreSQL tests exercise
allowlisting, tenant/buyer/owner isolation, denied direct grants and helper calls,
unverified phones, revoked roles, suspended accounts/authorities, retry conflicts,
approval/refusal, rollback after an injected audit failure, deadlines even inside
an older transaction, timeout idempotency, expiry, configuration snapshots,
missing status, transfers, state constraints and cross-tenant foreign keys.
Existing all-migration fixtures now model Auth's phone columns as well.
All five check tests pass, including installation by a non-superuser schema owner.
PGlite uses a single database session: this verifies real SQL rules and rollback,
but does not prove multi-connection contention or hosted Supabase behavior.
Run multi-connection race acceptance before production with real PostgreSQL.

Migration 023 now adds configured per-buyer limits, shared lookup, buyer/owner
lists and a scheduled timeout/reminder worker. It wraps the original creation
operation so direct backend callers also obey limits. Set `max_checks_per_hour`
on the development configuration before creating further checks.
See [current setup and limitations](MILESTONE2-HANDOVER.md).
