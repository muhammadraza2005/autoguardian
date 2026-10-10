# AutoGuardian database foundation

## Independent review — 10 October 2026

[Migration 017](migrations/202610100017_independent_registration_reviews.sql)
implements the approved independent TENANT_ADMIN policy and scoped review receipt
producers. It awaits manual installation after installed/verified 016.
See [exact setup instructions](../docs/REGISTRATION-REVIEWS.md). The read-only
verifier now expects 18 functions and the private append-only review table.

## Registration finalization — 10 October 2026

[Migration 016](migrations/202610100016_enrollment_finalization.sql) is implemented
and locally tested, installed and verified in hosted development. Do not replay
it. See [the integration boundary](../docs/ENROLLMENT-SUBMISSION.md). The verifier
now also expects migration 017's review functions and the new
restricted tables. No development draft is promoted or activated by installation.

## Native upload bindings — 10 October 2026

[Migration 015](migrations/202610100015_native_evidence_uploads.sql) adds forced-RLS,
append-only native upload context bindings and restricted reservation/staging
wrappers. It is installed and verified in hosted development; do not replay it.
The verifier now expects 017 and exits nonzero until present.
No new bucket, credentials or environment settings are
required. See [native implementation and limits](../docs/DEVELOPMENT-NATIVE-EVIDENCE.md).

## Development evidence reviews — 10 October 2026

New [migration 014](migrations/202610100014_development_evidence_reviews.sql)
adds forced-RLS, append-only sample self-review decisions and restricted functions.
Apply it once as postgres after 013, without replaying installed migrations.
Hosted installation and review table/function security were confirmed by read-only
inspection on 10 October 2026. Do not replay it. See [setup and limits](../docs/DEVELOPMENT-EVIDENCE-REVIEWS.md).

## Development placement notes — 10 October 2026

New [migration 013](migrations/202610100013_seal_location_notes.sql) adds restricted,
revision-bound sample location notes and save events. Hosted 011–013 are now
confirmed by read-only inspection; do not replay them. Migration 014 is also confirmed. See
[setup and limits](../docs/DEVELOPMENT-SEAL-LOCATIONS.md).

## Owner details and sample consent (migration 010)

After 009, apply [010](migrations/202610080010_enrollment_owner_consent.sql) once
as postgres in development, then restart the backend. It adds encrypted owner
details, immutable bilingual sample consent versions, append-only recording/read/
withdrawal events and generation-bound evidence invalidation. Restricted functions
enforce agent/draft scope, current owner eligibility, revisions and request keys.
Readiness adds two sample checks while production consent/phone remain unavailable.
Hosted 010 installation and signed-in acceptance are pending; see
[setup and walkthrough](../docs/DEVELOPMENT-OWNER-CONSENT.md).

## Enrollment readiness (migration 009)

After 008, apply [009](migrations/202610080009_enrollment_readiness.sql) once as
postgres in development. It adds only a restricted read-only checklist function;
no tables or activation writes. Hosted 009 installation was subsequently confirmed
by a read-only runtime check; the current app also requires 010.
See [readiness setup and acceptance](../docs/DEVELOPMENT-ENROLLMENT-READINESS.md).

These scripts create the core database in an existing **development Supabase project**. They do not connect the mobile app, implement a backend, configure an SMS provider, or change a remote project automatically.

After applying the foundation, follow [phone-login setup](PHONE-LOGIN-SETUP.md). Its [single-grid verification query](verify-foundation-summary.sql) makes every database check visible in one result.

The backend is documented in [backend/README.md](../backend/README.md). It includes [migration 003](migrations/202610050003_identity_api.sql) for the restricted identity API, applied after 001/002. The mobile development email flow connects identity/profile loading and, after 004, owned-vehicle list/detail screens.

Vehicle list/detail backend endpoints are also available. After 003 and the restricted database login setup, run [migration 004](migrations/202610060004_owned_vehicle_reads.sql) once as `postgres` to add a separate reader role with current-owner policies. It grants no mobile/client permissions and permits no vehicle writes. Optional [setup-development-vehicle.sql](setup-development-vehicle.sql) links one synthetic vehicle and an OWNER role to the existing development test profile; it never activates real enrollment.

## Run in Supabase

1. Open your development project → **SQL Editor** → **New query**. Use the `postgres` database role.
2. Copy the entire contents of [001: core foundation](migrations/202610050001_core_foundation.sql), then click **Run**. Run once. Expected result: success, with no returned rows.
3. In a new query, run [002: default permissions](migrations/202610050002_default_permissions.sql).
4. In a new query, run [verify-foundation.sql](verify-foundation.sql). Expect eight tables with both RLS flags `true`, 14 business roles, and an empty final result (no client table privileges).

Each migration has its own transaction: an error rolls back that file. If 001 succeeded, do not rerun it; continue with 002. These are manual SQL Editor migrations, not yet registered in the Supabase CLI migration ledger. Before adopting CLI deployment, reconcile that ledger with the applied files rather than replaying 001.

Keep `app` and `private` out of **Data API → Exposed schemas**. Authentication continues to use Supabase's managed `auth` schema and Auth API. Do not edit or insert into `auth.users` with these scripts. Disable anonymous sign-ins if they are not part of your product. Enable phone login and configure an SMS provider/test numbers separately when testing authentication; SQL alone cannot deliver OTPs.

## Included

- Authorities (`tenants`), tenant user profiles linked to Auth identities, organizations, and the SRS's 14 business roles with scoped assignments.
- Protected owner records, vehicles, and ownership history, with same-authority composite foreign keys.
- Global chassis uniqueness using uppercase/trim only. No fixed 17-character VIN assumption.
- At most one current ownership per vehicle. Deferred checks require exactly one for an `ACTIVE` vehicle, allowing creation/transfer in a single transaction.
- UTC timestamps, update triggers, controlled source vehicle statuses, and soft deletion fields.
- RLS enabled and forced. No mobile, anonymous, authenticated, or service-role domain grants. No permissive policies or role grants from signup metadata.

## Access and next implementation step

Migrations 001/002 deliberately have **no runtime allow policies**. The SQL Editor administrator can manage data; the mobile app cannot query these tables. Optional migration 003 adds identity-only policies for the restricted backend role, not for mobile clients. Business roles in `app.roles` are a catalog, not executable permission rules. Public signup receives only `VERIFIER` through the backend provisioning endpoint; these scripts do not auto-create profiles or assign roles on Auth signup because the authority must be resolved and verified first.

Migration 003 and the identity API use a non-owner, non-BYPASSRLS database role and transaction-local verified tenant/actor context. Their access is limited to the first identity endpoints. Broader domain policies and organization/ownership scope, session revocation and step-up authentication remain future work. Never use a Supabase service key as proof of tenant isolation or place it in the mobile app. Default privileges here apply to objects created by the migration owner; another creator must apply equivalent defaults.

Migrations do not seed authorities or privileged users. For development, run [setup-development-tenant.sql](setup-development-tenant.sql) to create **AutoGuardian Development** with the SRS's proposed CD/USD/Africa/Kinshasa defaults. It returns the UUID needed by the backend. This does not create any Auth account or assign any role. User profile provisioning requires an actual verified Auth identity, not a UUID copied from frontend fixtures.

## Rules still pending

Plate uniqueness geography and canonical identifier/category rules remain decision D09 in [backend.md](../backend.md). Plate lookup is indexed but not unique; category is nonempty text until the exact codes are agreed. Owner legal names are protected database data, not application-encrypted fields. Document/PIN storage, historical interval overlap rules, audit, grants/revocations, workflow transitions, seals, payments and transfers are later migrations. The foundation is not permission to activate real production enrollments. Source statuses are stored now; their workflow transitions are not implemented.

## Validation

The repository test runner uses an isolated PostgreSQL engine (PGlite) and simulated Supabase Auth identities/database roles. It checks migration execution, denied client access, RLS fail-closed behavior, tenant foreign keys, chassis/current-owner uniqueness, and deferred activation/transfer integrity. It does not substitute for running the verification SQL in your hosted project.

To reproduce locally from the repository root (no Supabase credentials required):

```powershell
npm.cmd install --prefix .tools/db-validation --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node supabase/tests/foundation.mjs
```

Official references: [Supabase user data](https://supabase.com/docs/guides/auth/managing-user-data), [RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security), [securing domain data](https://supabase.com/docs/guides/database/secure-data).
## Enrollment drafts

The development owner selector uses migration 006 and `setup-development-owner.sql`; the user has confirmed its setup. Optional attachment staging now uses [007](migrations/202610060007_enrollment_attachments.sql) and [private bucket setup](setup-development-evidence-bucket.sql), once in that order. See [upload guide](../docs/DEVELOPMENT-EVIDENCE-UPLOADS.md). Only synthetic sample uploads are enabled for this development increment; real evidence and activation remain pending.

After migrations 001–004, run [005: enrollment drafts](migrations/202610060005_enrollment_drafts.sql) once as `postgres` in development. Then run [setup-development-agent.sql](setup-development-agent.sql) once to give the known test profile a development organization-scoped agent grant and accreditation. See [development enrollment guide](../docs/DEVELOPMENT-ENROLLMENT-DRAFTS.md) for expected output and app verification. Drafts do not create registered vehicles or ownership. The current draft API stays disabled in production pending stronger agent login.

## Development seal stock and fitting

After 007, run [008](migrations/202610060008_development_seal_fitting.sql) once, then [sample stock setup](setup-development-seal-stock.sql) as postgres in the development project. Expect 12 standard and 8 alarm sample seals. Follow the [app verification guide](../docs/DEVELOPMENT-SEAL-FITTING.md). No production stock issuance or enrollment activation is performed.

## Detailed development evidence

After 011, apply [012](migrations/202610090012_seal_fitting_validation.sql) once in
development. It adds restricted read-only seal diagnostics, distinct fitting-image
validation and safe Review summaries. Reservations remain visible to the restricted
executor for currently assigned stock after reassignment, while direct client
table access and write scopes remain restricted. No private codes, file IDs or
hashes enter the diagnostic summary. See
[setup and acceptance](../docs/DEVELOPMENT-SEAL-VALIDATION.md). Hosted SQL was not
executed by this change. Physical verification and activation remain unavailable.

After migrations through 010, run [011](migrations/202610090011_enrollment_evidence_checklist.sql)
once in development. It adds six named photo kinds and purchase proof, computes
eight requirements under forced RLS, and keeps existing encrypted attachments
unchanged. Generic photos do not satisfy a specific view. The attachment limit is
30 per current owner generation; pending files do not complete a requirement.
See [setup and acceptance](../docs/DEVELOPMENT-EVIDENCE-CHECKLIST.md). This change
was verified locally only; no hosted SQL was executed.
