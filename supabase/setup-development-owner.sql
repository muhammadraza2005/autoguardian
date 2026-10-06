-- Run once as postgres after 006 and setup-development-agent.sql.
-- A synthetic alias for the existing test profile, never an identity verification.
begin;
do $$
begin
  if not exists (select 1 from app.tenants t
    join app.users u on u.tenant_id=t.id
    join app.organizations o on o.tenant_id=t.id
    where t.id='ce31527e-d1b5-4379-9ddd-1458cfb73431' and t.code='AUTOGUARDIAN_DEV'
      and t.status='ACTIVE' and t.deleted_at is null
      and u.id='369cbe75-32c8-40b4-a9ee-f2d9bde379db' and u.status='ACTIVE' and u.deleted_at is null
      and o.id='014db61a-4c68-48cb-86b6-46837f4da873' and o.status='ACTIVE' and o.deleted_at is null) then
    raise exception 'Active development tenant, test profile and enrollment organization are required';
  end if;
  if exists (select 1 from private.development_enrollment_owners
    where tenant_id='ce31527e-d1b5-4379-9ddd-1458cfb73431'
      and organization_id='014db61a-4c68-48cb-86b6-46837f4da873'
      and user_id='369cbe75-32c8-40b4-a9ee-f2d9bde379db' and not active) then
    raise exception 'Development owner choice is inactive; setup will not restore it';
  end if;
end;
$$;
insert into private.development_enrollment_owners(tenant_id,organization_id,user_id,label)
values ('ce31527e-d1b5-4379-9ddd-1458cfb73431','014db61a-4c68-48cb-86b6-46837f4da873',
  '369cbe75-32c8-40b4-a9ee-f2d9bde379db','Development owner 1')
on conflict (tenant_id,organization_id,user_id) do nothing;
select label, 'NOT_VERIFIED'::text as verification_status,active
from private.development_enrollment_owners
where tenant_id='ce31527e-d1b5-4379-9ddd-1458cfb73431'
  and organization_id='014db61a-4c68-48cb-86b6-46837f4da873'
  and user_id='369cbe75-32c8-40b4-a9ee-f2d9bde379db';
commit;
