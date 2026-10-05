-- Run as postgres in your DEVELOPMENT project's SQL Editor, after 001/002/003.
-- Creates a development group only: no Auth accounts or administrator grants.
-- SRS proposed defaults: DRC (CD), USD, Africa/Kinshasa.
begin;

insert into app.tenants (code, name_en, country_code, currency_code, time_zone)
values ('AUTOGUARDIAN_DEV', 'AutoGuardian Development', 'CD', 'USD', 'Africa/Kinshasa')
on conflict (code) do nothing;

-- Repeating this script reuses its UUID, without overwriting an existing group.
do $$
begin
    if not exists (
        select 1 from app.tenants
        where code = 'AUTOGUARDIAN_DEV' and name_en = 'AutoGuardian Development'
          and country_code = 'CD' and currency_code = 'USD'
          and time_zone = 'Africa/Kinshasa' and status = 'ACTIVE' and deleted_at is null
    ) then
        raise exception 'AUTOGUARDIAN_DEV already exists with different settings or is inactive. Review it before proceeding.';
    end if;
end;
$$;

commit;

-- Copy tenant_id into AUTOGUARDIAN_TENANT_ID in backend/.env later.
select id as tenant_id, name_en as name, country_code, currency_code, time_zone
from app.tenants where code = 'AUTOGUARDIAN_DEV';
