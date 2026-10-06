# AutoGuardian backend

The NestJS backend supports identity and reading currently owned vehicles. The mobile development email flow calls its identity endpoints; connecting vehicle screens, phone login, SMS and deployment remain pending. See [development email login](../docs/DEVELOPMENT-EMAIL-LOGIN.md).

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/health` | Process health, no authentication |
| `POST /v1/me/profile` | Verify Supabase session and provision a verifier profile; send `{}` |
| `GET /v1/me` | Verify session and return the existing profile and current role assignments |
| `GET /v1/me/vehicles` | List the signed-in owner's vehicles; `limit` 1–50 (default 20), optional UUID `cursor` |
| `GET /v1/me/vehicles/:id` | Return one currently owned vehicle; unauthorized/missing vehicles both return 404 |

Protected requests require `Authorization: Bearer <Supabase access token>`. The backend validates it through Supabase Auth `getUser`, requires a verified phone identity (or confirmed email with the development-only option), checks the authority/account state, and reads roles from PostgreSQL. A client cannot choose its authority or grant itself roles. Repeating provisioning reuses the profile and does not restore a previously revoked verifier assignment. Privileged sections still need their later authorization/step-up policies; returning a role does not implement those workflows.

## Local setup

1. Apply [migration 003](../supabase/migrations/202610050003_identity_api.sql) in Supabase SQL Editor as `postgres`, after the existing 001/002. Run once. It creates a **non-login database role**, identity-only grants/RLS and a minimal append-only provisioning event table. It does not give mobile clients access. The earlier six-check verification remains valid; the eight **core** tables are unchanged, with one additional protected event table.
2. To run the API, use [setup-identity-login.sql](../supabase/setup-identity-login.sql) in the SQL Editor. Replace its password placeholder there with a strong random password. Keep the real password out of source control.
3. Create `backend/.env` from `.env.example`. Supply the Supabase project URL/public publishable key, restricted login connection string and authority UUID. `DATABASE_URL` must not use `postgres` or service-role/admin credentials. Use Supabase's supplied host/port/database and the custom username (for a pooler, typically `autoguardian_identity_login.PROJECT_REF`). Use TLS according to your project's connection instructions; never disable certificate verification. URL-encode the password in a connection URI.
4. For your development project, run [setup-development-tenant.sql](../supabase/setup-development-tenant.sql). It creates **AutoGuardian Development**, using the SRS's proposed CD/USD/Africa/Kinshasa defaults, and returns its `tenant_id`. Put that UUID in `AUTOGUARDIAN_TENANT_ID`. Rerunning this script reuses the UUID and does not overwrite existing settings. Real authority details must be chosen separately for production. This first slice is configured for one authority per API instance; multi-authority selection is future work.
5. Run from `backend/`:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd start
```

The default listener is local only (`127.0.0.1:3000`). A successful health response does not prove SMS or user login works. Phone authentication is still pending an SMS provider; tests use isolated stubs and PostgreSQL, not a bypass in real endpoints. The API rejects unverified phone accounts by default; the explicit development email option accepts confirmed email test accounts only.

The identity database role is limited to identity/profile operations. A separate vehicle reader role has limited column grants and ownership RLS; neither permits administrative vehicle writes. RLS context is transaction-local and derived from the validated user plus server configuration. Each request explicitly sets the restricted role and context, commits or rolls back, and releases its connection. Sessions/application revocation, rate limiting, request-ID tracing, OpenAPI, complete audit hash chains, worker processes and privileged authentication strength remain later work before production.

## Enable vehicle reads

1. With 001–003 and the restricted login already applied, run [migration 004](../supabase/migrations/202610060004_owned_vehicle_reads.sql) **once** in the development Supabase SQL Editor as `postgres`. No environment changes or password reset are needed. Until it is applied, authenticated vehicle requests return 503.
2. Optionally run [setup-development-vehicle.sql](../supabase/setup-development-vehicle.sql). It targets the development tenant and profile shown in the current test account, grants `OWNER`, and creates one synthetic `PENDING_REVIEW` vehicle (`DEV-001`). It is repeatable, but refuses to restore a revoked role or changed ownership. Use it only in development.
3. Refresh the app profile to see `OWNER` alongside existing roles, then select **My vehicles** to use the connected list/detail screens.

The list response is `{ "items": [...], "nextCursor": "uuid-or-null" }`. Results are ordered by vehicle UUID; pass `nextCursor` as `cursor` to fetch the next page. Detail returns `{ "vehicle": {...} }`. Both include vehicle ID, chassis, plate, category, make/model, year/color, sale/record status, timestamps and ownership start. Private owner identity and alarm/seal fields are excluded.

Access requires an active tenant, active profile, active tenant-level `OWNER` assignment and current ownership. A verifier without ownership gets an empty list. Ownership transfer or revoked OWNER access prevents subsequent reads. Suspended/deleted accounts or tenants receive 403; invalid IDs/query parameters receive 400. Clients cannot supply a tenant or owner ID. Responses use `Cache-Control: no-store`. Vehicle registration, edits and transfers remain separate future workflows.

`npm.cmd test` validates the endpoints and PostgreSQL policies in isolated PGlite, including other users/tenants, revoked roles, ownership transfer, unpaid vehicles, missing context, denied writes and pagination. It does not apply changes to hosted Supabase.

References: [NestJS controllers](https://docs.nestjs.com/controllers), [Supabase token validation](https://supabase.com/docs/reference/javascript/auth-getuser).

## Enrollment drafts

Development draft APIs now save, list and update an agent's own vehicle metadata and proposed owner profile, with accreditation checks, duplicate rejection, creation idempotency, revision conflicts and append-only events. See [setup and API guide](../docs/DEVELOPMENT-ENROLLMENT-DRAFTS.md). Run new migration 005 and development-agent SQL once before testing. No database password or environment change is needed.

This is draft storage only. It does not create ownership or active vehicles; production agent authentication, evidence, OTP, payment, review and activation remain pending. Production draft access is denied until the required agent factors are implemented.

Migration 006 restricts owner selection to designated organization-scoped development profiles; see [owner setup](../docs/DEVELOPMENT-OWNER-SELECTION.md). Migration 007 adds attachment staging functions, with a private ciphertext Storage bucket and server-only encryption/key configuration. See [sample uploads](../docs/DEVELOPMENT-EVIDENCE-UPLOADS.md) for SQL, environment setup, app verification and the limits before real evidence collection.

## Development seal stock and fitting

See [development seal fitting](../docs/DEVELOPMENT-SEAL-FITTING.md). Apply migration 008 and the synthetic stock setup after 007. The backend adds scoped stock reads and idempotent provisional fitting saves with package/type, reservation, photo and revision checks. These routes do not activate enrollments or bypass owner OTP/payment.
