# AutoGuardian database foundation

These scripts create the core database in an existing **development Supabase project**. They do not connect the mobile app, implement a backend, configure an SMS provider, or change a remote project automatically.

After applying the foundation, follow [phone-login setup](PHONE-LOGIN-SETUP.md). Its [single-grid verification query](verify-foundation-summary.sql) makes every database check visible in one result.

The next backend slice is available in [backend/README.md](../backend/README.md). It includes optional [migration 003](migrations/202610050003_identity_api.sql) for the restricted identity API, applied after 001/002. The mobile app remains unconnected.

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
