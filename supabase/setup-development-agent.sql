-- Development only. Run as postgres after migration 005. No passwords or Auth edits.
begin;
do $$
declare
  authority uuid:='ce31527e-d1b5-4379-9ddd-1458cfb73431';
  profile uuid:='369cbe75-32c8-40b4-a9ee-f2d9bde379db';
  organization uuid:='014db61a-4c68-48cb-86b6-46837f4da873';
begin
  if not exists (select 1 from app.tenants where id=authority and code='AUTOGUARDIAN_DEV'
    and status='ACTIVE' and deleted_at is null) then raise exception 'Active development group not found'; end if;
  perform 1 from app.users where id=profile and tenant_id=authority and status='ACTIVE' and deleted_at is null for update;
  if not found then raise exception 'Active development test profile not found'; end if;
  insert into app.organizations(id,tenant_id,name,type) values (organization,authority,'AutoGuardian Development Enrollment','OTHER')
    on conflict(id) do nothing;
  if not exists (select 1 from app.organizations where id=organization and tenant_id=authority
    and name='AutoGuardian Development Enrollment' and status='ACTIVE' and deleted_at is null) then
    raise exception 'Existing development organization needs manual review';
  end if;
  if exists (select 1 from app.role_assignments where tenant_id=authority and user_id=profile
    and role_code='ENROLLMENT_AGENT' and organization_id=organization) then
    if not exists (select 1 from app.role_assignments where tenant_id=authority and user_id=profile
      and role_code='ENROLLMENT_AGENT' and organization_id=organization and deleted_at is null
      and valid_from<=now() and (valid_to is null or valid_to>now())) then
      raise exception 'Existing agent grant is inactive; manual review required';
    end if;
  else
    insert into app.role_assignments(tenant_id,user_id,role_code,organization_id)
      values (authority,profile,'ENROLLMENT_AGENT',organization);
  end if;
  if exists (select 1 from app.agent_accreditations where tenant_id=authority and user_id=profile and organization_id=organization) then
    if not exists (select 1 from app.agent_accreditations where tenant_id=authority and user_id=profile and organization_id=organization
      and status='ACTIVE' and valid_from<=now() and (valid_to is null or valid_to>now())) then
      raise exception 'Existing accreditation is inactive; manual review required';
    end if;
  else
    insert into app.agent_accreditations(tenant_id,user_id,organization_id) values (authority,profile,organization);
  end if;
end;
$$;
select r.user_id as agent_profile_id,r.organization_id,'ENROLLMENT_AGENT' as role,a.status as accreditation_status
  from app.role_assignments r join app.agent_accreditations a
    on a.tenant_id=r.tenant_id and a.user_id=r.user_id and a.organization_id=r.organization_id
  where r.tenant_id='ce31527e-d1b5-4379-9ddd-1458cfb73431' and r.user_id='369cbe75-32c8-40b4-a9ee-f2d9bde379db'
    and r.organization_id='014db61a-4c68-48cb-86b6-46837f4da873' and r.role_code='ENROLLMENT_AGENT';
commit;
