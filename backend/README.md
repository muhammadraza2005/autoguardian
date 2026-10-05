# AutoGuardian identity API

This is the first NestJS backend slice, not the complete backend. It does not enable phone login, send SMS, connect the mobile app, or deploy anything.

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/health` | Process health, no authentication |
| `POST /v1/me/profile` | Verify Supabase session and provision a verifier profile; send `{}` |
| `GET /v1/me` | Verify session and return the existing profile and current role assignments |

Protected requests require `Authorization: Bearer <Supabase access token>`. The backend validates it through Supabase Auth `getUser`, requires a verified phone identity, checks the authority/account state, and reads roles from PostgreSQL. A client cannot choose its authority or grant itself roles. Repeating provisioning reuses the profile and does not restore a previously revoked verifier assignment. Privileged sections still need their later authorization/step-up policies; returning a role does not implement those workflows.

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

The default listener is local only (`127.0.0.1:3000`). A successful health response does not prove SMS or user login works. Phone authentication is still pending an SMS provider; tests use isolated stubs and PostgreSQL, not a bypass in real endpoints. The API will reject unverified phone accounts even during development.

The database role is limited to identity/profile operations, not vehicles, owner identities or administrative writes. RLS context is transaction-local and derived from the validated user plus server configuration. Each request explicitly sets the restricted role and context, commits or rolls back, and releases its connection. Sessions/application revocation, rate limiting, request-ID tracing, OpenAPI, complete audit hash chains, worker processes and privileged authentication strength remain later work before production.

References: [NestJS controllers](https://docs.nestjs.com/controllers), [Supabase token validation](https://supabase.com/docs/reference/javascript/auth-getuser).
