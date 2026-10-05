-- Run once as postgres, after 001 and 002. No passwords or login identities here.
begin;
create role autoguardian_identity_api nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema app, private to autoguardian_identity_api;

create function private.request_tenant_id() returns uuid language sql stable
set search_path = '' as $$ select nullif(current_setting('autoguardian.tenant_id', true), '')::uuid $$;
create function private.request_auth_user_id() returns uuid language sql stable
set search_path = '' as $$ select nullif(current_setting('autoguardian.auth_user_id', true), '')::uuid $$;
revoke all on function private.request_tenant_id(), private.request_auth_user_id() from public, anon, authenticated, service_role;
grant execute on function private.request_tenant_id(), private.request_auth_user_id() to autoguardian_identity_api;

grant select on app.tenants, app.users, app.role_assignments to autoguardian_identity_api;
grant insert (tenant_id, auth_user_id) on app.users to autoguardian_identity_api;
-- PostgreSQL requires an UPDATE privilege/policy for SELECT FOR UPDATE row locks.
-- Only language is mutable with these credentials, not identity, status, or authority.
grant update (preferred_language) on app.users to autoguardian_identity_api;
grant insert (tenant_id, user_id, role_code) on app.role_assignments to autoguardian_identity_api;

create policy identity_tenant_read on app.tenants for select to autoguardian_identity_api
using (id = private.request_tenant_id() and status = 'ACTIVE' and deleted_at is null
    and private.request_auth_user_id() is not null);
create policy identity_profile_read on app.users for select to autoguardian_identity_api
using (tenant_id = private.request_tenant_id() and auth_user_id = private.request_auth_user_id());
create policy identity_profile_create on app.users for insert to autoguardian_identity_api
with check (tenant_id = private.request_tenant_id() and auth_user_id = private.request_auth_user_id()
    and status = 'ACTIVE' and deleted_at is null
    and exists (select 1 from app.tenants where id = tenant_id));
create policy identity_profile_lock on app.users for update to autoguardian_identity_api
using (tenant_id = private.request_tenant_id() and auth_user_id = private.request_auth_user_id()
    and status = 'ACTIVE' and deleted_at is null)
with check (tenant_id = private.request_tenant_id() and auth_user_id = private.request_auth_user_id()
    and status = 'ACTIVE' and deleted_at is null);
create policy identity_roles_read on app.role_assignments for select to autoguardian_identity_api
using (tenant_id = private.request_tenant_id()
    and exists (select 1 from app.users u where u.id = role_assignments.user_id and u.tenant_id = role_assignments.tenant_id));
create policy identity_verifier_create on app.role_assignments for insert to autoguardian_identity_api
with check (tenant_id = private.request_tenant_id() and role_code = 'VERIFIER'
    and organization_id is null and valid_to is null and deleted_at is null
    and granted_by is null and created_by is null
    and exists (select 1 from app.users u where u.id = role_assignments.user_id
        and u.tenant_id = role_assignments.tenant_id and u.status = 'ACTIVE' and u.deleted_at is null));

-- Minimal append-only provisioning record. Full domain audit is a later milestone.
create table private.identity_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references app.tenants(id),
    user_id uuid not null,
    auth_user_id uuid not null references auth.users(id),
    action text not null check (action = 'VERIFIER_PROVISIONED'),
    created_at timestamptz not null default now(),
    foreign key (tenant_id, user_id) references app.users(tenant_id, id)
);
alter table private.identity_events enable row level security;
alter table private.identity_events force row level security;
revoke all on private.identity_events from public, anon, authenticated, service_role;
grant insert (tenant_id, user_id, auth_user_id, action) on private.identity_events to autoguardian_identity_api;
create policy identity_event_append on private.identity_events for insert to autoguardian_identity_api
with check (tenant_id = private.request_tenant_id() and auth_user_id = private.request_auth_user_id()
    and exists (select 1 from app.users u where u.id = identity_events.user_id and u.tenant_id = identity_events.tenant_id
        and u.status = 'ACTIVE' and u.deleted_at is null));

commit;
