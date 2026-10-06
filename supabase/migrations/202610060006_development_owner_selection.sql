-- Run once as postgres after 005. Synthetic development owner choices only.
begin;
create table private.development_enrollment_owners (
  tenant_id uuid not null references app.tenants(id),
  organization_id uuid not null,
  user_id uuid not null,
  label text not null check (label ~ '^Development owner [1-9][0-9]{0,3}$'),
  active boolean not null default true,
  primary key (tenant_id,organization_id,user_id),
  unique (tenant_id,organization_id,label),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,user_id) references app.users(tenant_id,id)
);
alter table private.development_enrollment_owners enable row level security;
alter table private.development_enrollment_owners force row level security;
revoke all on private.development_enrollment_owners from public,anon,authenticated,service_role;
grant select on private.development_enrollment_owners to autoguardian_enrollment_executor;
create policy development_owner_agent_lookup on private.development_enrollment_owners
  for select to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and active
    and private.enrollment_agent_id(organization_id) is not null);
drop policy enrollment_draft_executor on app.enrollment_drafts;
create policy enrollment_draft_executor on app.enrollment_drafts to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(organization_id))
  with check (tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(organization_id)
    and exists (select 1 from app.users u where u.tenant_id=enrollment_drafts.tenant_id and u.id=enrollment_drafts.owner_profile_id)
    and exists (select 1 from private.development_enrollment_owners o
      where o.tenant_id=enrollment_drafts.tenant_id and o.organization_id=enrollment_drafts.organization_id
        and o.user_id=enrollment_drafts.owner_profile_id));

create function private.enrollment_owner_options(p_org uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_org is null then raise exception using errcode='AG400',message='INVALID_ORGANIZATION'; end if;
  if private.enrollment_agent_id(p_org) is null then
    raise exception using errcode='AG403',message='AGENT_ACCESS_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('profileId',c.user_id,'label',c.label,
    'verificationStatus','NOT_VERIFIED') order by c.label,c.user_id),'[]'::jsonb)
  into result from (
    select o.user_id,o.label from private.development_enrollment_owners o
    join app.users u on u.tenant_id=o.tenant_id and u.id=o.user_id
    where o.tenant_id=private.request_tenant_id() and o.organization_id=p_org
    order by o.label,o.user_id limit 50
  ) c;
  return jsonb_build_object('items',result);
end;
$$;

-- Preserve the tested metadata implementation behind a stricter owner-selection gate.
-- Runtime must not be able to call the previous implementation directly.
alter function private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer)
  rename to save_enrollment_draft_metadata;
revoke all on function private.save_enrollment_draft_metadata(uuid,uuid,uuid,uuid,jsonb,integer)
  from public,anon,authenticated,service_role,autoguardian_enrollment_api;
create function private.save_enrollment_draft(p_id uuid,p_key uuid,p_org uuid,p_owner uuid,p_vehicle jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_org is null or p_owner is null then raise exception using errcode='AG400',message='INVALID_DRAFT'; end if;
  if private.enrollment_agent_id(p_org) is null then
    raise exception using errcode='AG403',message='AGENT_ACCESS_REQUIRED';
  end if;
  -- Recheck eligibility on every create, update and retry; the write policy also checks it.
  perform o.user_id from private.development_enrollment_owners o
  join app.users u on u.tenant_id=o.tenant_id and u.id=o.user_id
  where o.tenant_id=private.request_tenant_id() and o.organization_id=p_org and o.user_id=p_owner;
  if not found then raise exception using errcode='AG422',message='OWNER_PROFILE_UNAVAILABLE'; end if;
  return private.save_enrollment_draft_metadata(p_id,p_key,p_org,p_owner,p_vehicle,p_expected);
end;
$$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.enrollment_owner_options(uuid) owner to autoguardian_enrollment_executor;
alter function private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_owner_options(uuid),
  private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function private.enrollment_owner_options(uuid),
  private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer) to autoguardian_enrollment_api;
commit;
