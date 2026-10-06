-- DEVELOPMENT ONLY. Run as postgres after migration 004.
-- Grants OWNER to the existing test profile and links one synthetic vehicle.
-- Does not create an Auth account, activate a vehicle, or change a password.
begin;
do $$
declare
    development_tenant uuid := 'ce31527e-d1b5-4379-9ddd-1458cfb73431';
    test_profile uuid := '369cbe75-32c8-40b4-a9ee-f2d9bde379db';
    test_vehicle uuid := '6f512d69-4070-4f05-8a30-2bbdb0fd9a1d';
    test_owner uuid;
begin
    if not exists (
        select 1 from app.tenants where id = development_tenant
        and code = 'AUTOGUARDIAN_DEV' and status = 'ACTIVE' and deleted_at is null
    ) then
        raise exception 'Expected active AutoGuardian development group';
    end if;
    perform 1 from app.users where id = test_profile and tenant_id = development_tenant
        and status = 'ACTIVE' and deleted_at is null for update;
    if not found then
        raise exception 'Expected active test profile; sign in and provision your profile first';
    end if;

    if not exists (
        select 1 from app.role_assignments where tenant_id = development_tenant
        and user_id = test_profile and role_code = 'OWNER' and organization_id is null
        and deleted_at is null and valid_from <= now() and (valid_to is null or valid_to > now())
    ) then
        if exists (
            select 1 from app.role_assignments where tenant_id = development_tenant
            and user_id = test_profile and role_code = 'OWNER' and organization_id is null
        ) then
            raise exception 'Existing OWNER grant is inactive; review it manually instead of restoring it';
        end if;
        insert into app.role_assignments(tenant_id, user_id, role_code)
        values (development_tenant, test_profile, 'OWNER');
    end if;

    select id into test_owner from private.owners
        where tenant_id = development_tenant and user_id = test_profile
        and kind = 'PERSON' and deleted_at is null;
    if test_owner is null then
        if exists (select 1 from private.owners where tenant_id = development_tenant
            and user_id = test_profile and kind = 'PERSON') then
            raise exception 'A deleted owner record exists; review it manually';
        end if;
        insert into private.owners(tenant_id, user_id, kind, legal_name)
        values (development_tenant, test_profile, 'PERSON', 'AutoGuardian Test Owner')
        returning id into test_owner;
    end if;

    insert into app.vehicles(id, tenant_id, chassis_identifier, current_plate, category, make, model)
    values (test_vehicle, development_tenant, 'AUTOGUARDIAN-DEV-VEHICLE-001',
        'DEV-001', 'CAR', 'Development', 'Test vehicle')
    on conflict (id) do nothing;
    perform 1 from app.vehicles where id = test_vehicle and tenant_id = development_tenant
        and chassis_identifier = 'AUTOGUARDIAN-DEV-VEHICLE-001' and deleted_at is null for update;
    if not found then
        raise exception 'Test vehicle was changed or removed; review it manually';
    end if;
    if exists (select 1 from app.ownerships where vehicle_id = test_vehicle) then
        if not exists (
            select 1 from app.ownerships where vehicle_id = test_vehicle
            and tenant_id = development_tenant and owner_id = test_owner
            and deleted_at is null and end_at is null and start_at <= now()
        ) then
            raise exception 'Test vehicle ownership changed; this script will not restore it';
        end if;
    else
        insert into app.ownerships(tenant_id, vehicle_id, owner_id, source)
        values (development_tenant, test_vehicle, test_owner, 'DEVELOPMENT_TEST');
    end if;
end;
$$;
commit;

select id as vehicle_id, current_plate as plate, record_status
from app.vehicles where id = '6f512d69-4070-4f05-8a30-2bbdb0fd9a1d';
