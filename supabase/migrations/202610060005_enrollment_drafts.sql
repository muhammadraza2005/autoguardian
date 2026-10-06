-- Run once as postgres after 001–004. Development drafts only; no active enrollments.
begin;
create role autoguardian_enrollment_api nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role autoguardian_enrollment_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_enrollment_api to autoguardian_identity_login;
-- Runtime cannot SET ROLE to the executor or read its underlying lookup tables.
grant usage on schema app, private to autoguardian_enrollment_api, autoguardian_enrollment_executor;
grant execute on function private.request_tenant_id(), private.request_auth_user_id()
  to autoguardian_enrollment_api, autoguardian_enrollment_executor;

create table app.agent_accreditations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
  user_id uuid not null, organization_id uuid not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  valid_from timestamptz not null default now(), valid_to timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  foreign key (tenant_id,user_id) references app.users(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  unique (tenant_id,user_id,organization_id)
);
create table app.enrollment_drafts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
  created_by uuid not null, organization_id uuid not null, owner_profile_id uuid not null,
  creation_key uuid not null, creation_payload jsonb not null,
  chassis_identifier text not null check (length(chassis_identifier) between 1 and 128 and chassis_identifier=upper(btrim(chassis_identifier))),
  plate text check (plate is null or (length(plate) between 1 and 64 and plate=upper(btrim(plate)))),
  category text not null check (length(btrim(category)) between 1 and 64),
  make text check (length(make)<=100), model text check (length(model)<=100), color text check (length(color)<=100),
  manufacture_year smallint check (manufacture_year between 1886 and 2200),
  status text not null default 'DRAFT' check (status='DRAFT'),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,created_by,creation_key),
  foreign key (tenant_id,created_by) references app.users(tenant_id,id),
  foreign key (tenant_id,owner_profile_id) references app.users(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id)
);
-- Provisional draft conflict rules: trim/case-fold chassis globally and plate within tenant.
-- This does not settle D09's final plate namespace or change core vehicle constraints.
create unique index enrollment_drafts_chassis_idx on app.enrollment_drafts(chassis_identifier);
create unique index enrollment_drafts_plate_idx on app.enrollment_drafts(tenant_id,plate) where plate is not null;
create index enrollment_drafts_agent_idx on app.enrollment_drafts(tenant_id,created_by,id);
create table private.enrollment_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
  agent_user_id uuid not null, organization_id uuid not null, draft_id uuid, revision integer,
  action text not null check (action in ('DRAFT_CREATED','DRAFT_UPDATED','DUPLICATE_REJECTED')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id)
);
alter table app.agent_accreditations enable row level security;
alter table app.agent_accreditations force row level security;
alter table app.enrollment_drafts enable row level security;
alter table app.enrollment_drafts force row level security;
alter table private.enrollment_events enable row level security;
alter table private.enrollment_events force row level security;
revoke all on app.agent_accreditations, app.enrollment_drafts, private.enrollment_events from public, anon, authenticated, service_role;
create trigger agent_accreditations_updated before update on app.agent_accreditations
  for each row execute function private.touch_updated_at();
create trigger enrollment_drafts_updated before update on app.enrollment_drafts
  for each row execute function private.touch_updated_at();

grant select (id,code,status,deleted_at) on app.tenants to autoguardian_enrollment_executor;
grant select (id,tenant_id,auth_user_id,status,deleted_at) on app.users to autoguardian_enrollment_executor;
grant select (id,tenant_id,status,deleted_at) on app.organizations to autoguardian_enrollment_executor;
grant select (tenant_id,user_id,role_code,organization_id,valid_from,valid_to,deleted_at)
  on app.role_assignments to autoguardian_enrollment_executor;
grant select on app.agent_accreditations to autoguardian_enrollment_executor;
grant select (tenant_id,chassis_identifier,current_plate,record_status,deleted_at)
  on app.vehicles to autoguardian_enrollment_executor;
grant select, insert, update on app.enrollment_drafts to autoguardian_enrollment_executor;
grant insert on private.enrollment_events to autoguardian_enrollment_executor;
-- Safe reads only; all runtime writes go through the reviewed function below.
grant select (id,organization_id,owner_profile_id,chassis_identifier,plate,category,make,model,
  manufacture_year,color,status,revision,created_at,updated_at) on app.enrollment_drafts to autoguardian_enrollment_api;

create policy enrollment_tenant_lookup on app.tenants for select to autoguardian_enrollment_executor
  using (id=private.request_tenant_id() and code='AUTOGUARDIAN_DEV' and status='ACTIVE' and deleted_at is null
    and private.request_auth_user_id() is not null);
create policy enrollment_user_lookup on app.users for select to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and status='ACTIVE' and deleted_at is null
    and exists (select 1 from app.tenants t where t.id=users.tenant_id));
create policy enrollment_org_lookup on app.organizations for select to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and status='ACTIVE' and deleted_at is null);
create policy enrollment_role_lookup on app.role_assignments for select to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and exists (select 1 from app.users u
    where u.id=role_assignments.user_id and u.auth_user_id=private.request_auth_user_id()));
create policy enrollment_accreditation_lookup on app.agent_accreditations for select to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and exists (select 1 from app.users u
    where u.id=agent_accreditations.user_id and u.auth_user_id=private.request_auth_user_id()));

create function private.enrollment_agent_id(p_organization uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select u.id from app.users u
  join app.role_assignments r on r.tenant_id=u.tenant_id and r.user_id=u.id
  join app.organizations o on o.tenant_id=r.tenant_id and o.id=r.organization_id
  join app.agent_accreditations a on a.tenant_id=u.tenant_id and a.user_id=u.id and a.organization_id=o.id
  where u.tenant_id=private.request_tenant_id() and u.auth_user_id=private.request_auth_user_id()
    and r.role_code='ENROLLMENT_AGENT' and r.deleted_at is null and r.valid_from<=now()
    and (r.valid_to is null or r.valid_to>now()) and a.status='ACTIVE' and a.valid_from<=now()
    and (a.valid_to is null or a.valid_to>now()) and (p_organization is null or o.id=p_organization)
  order by o.id limit 1
$$;
create policy enrollment_vehicle_conflict_lookup on app.vehicles for select to autoguardian_enrollment_executor
  using (private.enrollment_agent_id(null) is not null);
create policy enrollment_draft_executor on app.enrollment_drafts to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(organization_id))
  with check (tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(organization_id)
    and exists (select 1 from app.users u where u.tenant_id=enrollment_drafts.tenant_id and u.id=enrollment_drafts.owner_profile_id));
create policy enrollment_draft_read on app.enrollment_drafts for select to autoguardian_enrollment_api
  using (tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(organization_id));
create policy enrollment_event_append on private.enrollment_events for insert to autoguardian_enrollment_executor
  with check (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id));

create function private.enrollment_draft_json(d app.enrollment_drafts) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',d.id,'organizationId',d.organization_id,'ownerProfileId',d.owner_profile_id,
    'status',d.status,'revision',d.revision,'createdAt',d.created_at,'updatedAt',d.updated_at,
    'vehicle',jsonb_build_object('chassisIdentifier',d.chassis_identifier,'plate',d.plate,'category',d.category,
      'make',d.make,'model',d.model,'manufactureYear',d.manufacture_year,'color',d.color))
$$;

create function private.save_enrollment_draft(p_id uuid, p_key uuid, p_org uuid, p_owner uuid, p_vehicle jsonb, p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid; authority uuid:=private.request_tenant_id(); d app.enrollment_drafts;
  payload jsonb; chassis text; plate_value text;
begin
  if p_org is null or p_owner is null then raise exception using errcode='AG400',message='INVALID_DRAFT'; end if;
  actor:=private.enrollment_agent_id(p_org);
  if actor is null then raise exception using errcode='AG403',message='AGENT_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(p_vehicle) is distinct from 'object' then raise exception using errcode='AG400',message='INVALID_DRAFT'; end if;
  chassis:=upper(btrim(p_vehicle->>'chassisIdentifier')); plate_value:=nullif(upper(btrim(p_vehicle->>'plate')),'');
  if chassis is null or chassis='' or p_vehicle->>'category' is null or btrim(p_vehicle->>'category')='' then
    raise exception using errcode='AG400',message='INVALID_DRAFT';
  end if;
  payload:=jsonb_build_object('organizationId',p_org,'ownerProfileId',p_owner,'vehicle',p_vehicle);
  if p_id is null then
    if p_key is null or p_expected is not null then raise exception using errcode='AG400',message='INVALID_DRAFT'; end if;
    -- Serialize replay of the same creation key before checking its payload.
    perform pg_advisory_xact_lock(hashtextextended(authority::text||actor::text||p_key::text,0));
    select * into d from app.enrollment_drafts where tenant_id=authority and created_by=actor and creation_key=p_key;
    if found then
      if d.creation_payload<>payload then raise exception using errcode='AG409',message='IDEMPOTENCY_CONFLICT'; end if;
      return private.enrollment_draft_json(d);
    end if;
  else
    if p_key is not null or p_expected is null then raise exception using errcode='AG400',message='INVALID_DRAFT'; end if;
    select * into d from app.enrollment_drafts where tenant_id=authority and id=p_id and created_by=actor for update;
    if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
    if d.organization_id<>p_org then raise exception using errcode='AG400',message='ORGANIZATION_CANNOT_CHANGE'; end if;
    if d.revision<>p_expected then raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  end if;
  if not exists (select 1 from app.users u where u.tenant_id=authority and u.id=p_owner) then
    raise exception using errcode='AG422',message='OWNER_PROFILE_UNAVAILABLE';
  end if;
  if exists (select 1 from app.vehicles v where upper(btrim(v.chassis_identifier))=chassis
    or (plate_value is not null and v.tenant_id=authority and v.deleted_at is null
      and v.record_status<>'ARCHIVED' and upper(btrim(v.current_plate))=plate_value)) then
    insert into private.enrollment_events(tenant_id,agent_user_id,organization_id,draft_id,action)
      values (authority,actor,p_org,p_id,'DUPLICATE_REJECTED');
    return jsonb_build_object('error','DUPLICATE_VEHICLE');
  end if;
  begin
    if p_id is null then
      insert into app.enrollment_drafts(tenant_id,created_by,organization_id,owner_profile_id,creation_key,creation_payload,
        chassis_identifier,plate,category,make,model,manufacture_year,color)
      values (authority,actor,p_org,p_owner,p_key,payload,chassis,plate_value,btrim(p_vehicle->>'category'),
        p_vehicle->>'make',p_vehicle->>'model',(p_vehicle->>'manufactureYear')::smallint,p_vehicle->>'color') returning * into d;
    else
      update app.enrollment_drafts set owner_profile_id=p_owner,chassis_identifier=chassis,plate=plate_value,
        category=btrim(p_vehicle->>'category'),make=p_vehicle->>'make',model=p_vehicle->>'model',
        manufacture_year=(p_vehicle->>'manufactureYear')::smallint,color=p_vehicle->>'color',revision=revision+1
      where tenant_id=authority and id=p_id returning * into d;
    end if;
  exception when unique_violation then
    -- A subtransaction rolls back the conflicting write, but preserves this event at commit.
    insert into private.enrollment_events(tenant_id,agent_user_id,organization_id,draft_id,action)
      values (authority,actor,p_org,p_id,'DUPLICATE_REJECTED');
    return jsonb_build_object('error','DUPLICATE_VEHICLE');
  end;
  insert into private.enrollment_events(tenant_id,agent_user_id,organization_id,draft_id,revision,action)
    values (authority,actor,p_org,d.id,d.revision,case when p_id is null then 'DRAFT_CREATED' else 'DRAFT_UPDATED' end);
  return private.enrollment_draft_json(d);
end;
$$;

-- Functions run as a restricted non-owner with FORCE RLS, never as postgres/BYPASSRLS.
-- Hosted Supabase's migration role is not necessarily a superuser: it needs
-- membership to transfer ownership to the new restricted role. Keep it only on
-- this migration administrator so later migrations can maintain the functions.
grant autoguardian_enrollment_executor to current_user;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.enrollment_agent_id(uuid) owner to autoguardian_enrollment_executor;
alter function private.enrollment_draft_json(app.enrollment_drafts) owner to autoguardian_enrollment_executor;
alter function private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_agent_id(uuid), private.enrollment_draft_json(app.enrollment_drafts),
  private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function private.enrollment_agent_id(uuid), private.save_enrollment_draft(uuid,uuid,uuid,uuid,jsonb,integer)
  to autoguardian_enrollment_api;
commit;
