-- Run once as postgres after 001/002/003. Read-only owner access for the backend.
begin;
create role autoguardian_vehicle_reader nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_vehicle_reader to autoguardian_identity_login;
grant usage on schema app, private to autoguardian_vehicle_reader;
grant execute on function private.request_tenant_id(), private.request_auth_user_id() to autoguardian_vehicle_reader;
grant select (id, status, deleted_at) on app.tenants to autoguardian_vehicle_reader;
grant select (id, tenant_id, auth_user_id, status, deleted_at) on app.users to autoguardian_vehicle_reader;
grant select (tenant_id, user_id, role_code, organization_id, valid_from, valid_to, deleted_at)
    on app.role_assignments to autoguardian_vehicle_reader;
-- No legal names, registration numbers, documents, PINs or alarm types.
grant select (id, tenant_id, user_id, deleted_at) on private.owners to autoguardian_vehicle_reader;
grant select (tenant_id, vehicle_id, owner_id, start_at, end_at, deleted_at)
    on app.ownerships to autoguardian_vehicle_reader;
grant select (id, tenant_id, chassis_identifier, current_plate, category, make, model,
    manufacture_year, color, sale_status, record_status, created_at, updated_at, deleted_at)
    on app.vehicles to autoguardian_vehicle_reader;

create policy vehicle_reader_tenant on app.tenants for select to autoguardian_vehicle_reader
using (id = private.request_tenant_id() and status = 'ACTIVE' and deleted_at is null
    and private.request_auth_user_id() is not null);
create policy vehicle_reader_user on app.users for select to autoguardian_vehicle_reader
using (tenant_id = private.request_tenant_id() and auth_user_id = private.request_auth_user_id()
    and status = 'ACTIVE' and deleted_at is null
    and exists (select 1 from app.tenants t where t.id = users.tenant_id));
create policy vehicle_reader_roles on app.role_assignments for select to autoguardian_vehicle_reader
using (tenant_id = private.request_tenant_id()
    and exists (select 1 from app.users u where u.id = role_assignments.user_id and u.tenant_id = role_assignments.tenant_id));
create policy vehicle_reader_owner on private.owners for select to autoguardian_vehicle_reader
using (tenant_id = private.request_tenant_id() and deleted_at is null
    and exists (select 1 from app.users u where u.id = owners.user_id and u.tenant_id = owners.tenant_id)
    and exists (select 1 from app.role_assignments r
        where r.tenant_id = owners.tenant_id and r.user_id = owners.user_id and r.role_code = 'OWNER'
          and r.organization_id is null and r.deleted_at is null and r.valid_from <= now()
          and (r.valid_to is null or r.valid_to > now())));
create policy vehicle_reader_ownership on app.ownerships for select to autoguardian_vehicle_reader
using (tenant_id = private.request_tenant_id() and deleted_at is null and end_at is null and start_at <= now()
    and exists (select 1 from private.owners o where o.id = ownerships.owner_id and o.tenant_id = ownerships.tenant_id));
create policy vehicle_reader_vehicle on app.vehicles for select to autoguardian_vehicle_reader
using (tenant_id = private.request_tenant_id() and deleted_at is null
    and exists (select 1 from app.ownerships s where s.vehicle_id = vehicles.id and s.tenant_id = vehicles.tenant_id));

-- No client grants and no runtime vehicle writes.
commit;
