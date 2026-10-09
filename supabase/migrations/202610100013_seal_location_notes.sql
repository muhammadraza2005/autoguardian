-- Development placement descriptions only. No approved placement policy or inspection.
begin;
create table private.draft_seal_location_notes (
  draft_id uuid primary key, tenant_id uuid not null, organization_id uuid not null,
  agent_user_id uuid not null, owner_profile_id uuid not null,
  draft_revision integer not null check(draft_revision>0),
  fitting_revision integer not null check(fitting_revision>0),
  revision integer not null check(revision>0),
  locations jsonb not null check(jsonb_typeof(locations)='array'),
  saved_at timestamptz not null default now(),
  foreign key(tenant_id,draft_id) references private.draft_seal_packages(tenant_id,draft_id),
  foreign key(tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key(tenant_id,agent_user_id) references app.users(tenant_id,id),
  foreign key(tenant_id,owner_profile_id) references app.users(tenant_id,id)
);
create table private.draft_seal_location_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  draft_id uuid not null, organization_id uuid not null, agent_user_id uuid not null,
  request_key uuid not null, payload jsonb not null, created_at timestamptz not null default now(),
  unique(tenant_id,agent_user_id,request_key),
  foreign key(tenant_id,draft_id) references private.draft_seal_packages(tenant_id,draft_id),
  foreign key(tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key(tenant_id,agent_user_id) references app.users(tenant_id,id)
);
alter table private.draft_seal_location_notes enable row level security;
alter table private.draft_seal_location_notes force row level security;
alter table private.draft_seal_location_events enable row level security;
alter table private.draft_seal_location_events force row level security;
revoke all on private.draft_seal_location_notes,private.draft_seal_location_events
  from public,anon,authenticated,service_role,autoguardian_enrollment_api;
grant select,insert,update on private.draft_seal_location_notes to autoguardian_enrollment_executor;
grant select,insert on private.draft_seal_location_events to autoguardian_enrollment_executor;
create policy location_notes_scope on private.draft_seal_location_notes to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_seal_location_notes.draft_id and d.status='DRAFT'))
  with check(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_seal_location_notes.draft_id and d.status='DRAFT'
      and d.owner_profile_id=draft_seal_location_notes.owner_profile_id and d.revision=draft_seal_location_notes.draft_revision));
create policy location_events_read on private.draft_seal_location_events for select to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id));
create policy location_events_append on private.draft_seal_location_events for insert to autoguardian_enrollment_executor
  with check(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_id and d.status='DRAFT'));

create function private.draft_seal_locations_read(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; h private.draft_seal_packages; n private.draft_seal_location_notes;
  current_notes boolean; required boolean;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select * into h from private.draft_seal_packages where draft_id=d.id;
  select * into n from private.draft_seal_location_notes where draft_id=d.id;
  required:=h.package is distinct from 'NONE';
  current_notes:=coalesce(n.draft_revision=d.revision and n.fitting_revision=h.revision
    and n.owner_profile_id=d.owner_profile_id and h.saved_draft_revision=d.revision,false);
  return jsonb_build_object('version',1,'draftId',d.id,'draftRevision',d.revision,
    'fittingRevision',coalesce(h.revision,0),'package',h.package,'required',required,
    'locationRevision',coalesce(n.revision,0),
    'current',current_notes,'complete',coalesce(h.saved_draft_revision=d.revision,false)
      and (not required or (current_notes and jsonb_array_length(n.locations)=4)),
    'locations',case when current_notes and required then n.locations else '[]'::jsonb end,
    'savedAt',case when current_notes and required then n.saved_at else null end,
    'sampleOnly',true,'policyVerified',false,'physicalVerified',false);
end; $$;

create function private.save_draft_seal_locations(p_draft uuid,p_key uuid,p_expected_draft integer,
  p_expected_fit integer,p_expected_notes integer,p_locations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; h private.draft_seal_packages; actor uuid; previous jsonb;
  normalized jsonb; payload_value jsonb; notes_revision integer;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  actor:=private.enrollment_agent_id(d.organization_id);
  if p_key is null or p_expected_draft is null or p_expected_fit is null
    or p_expected_notes is null or p_expected_notes<0 or p_expected_draft<1 or p_expected_fit<1
    or jsonb_typeof(p_locations) is distinct from 'array' then
    raise exception using errcode='AG400',message='INVALID_SEAL_LOCATIONS'; end if;
  if jsonb_array_length(p_locations)<>4 or exists(select 1 from jsonb_array_elements(p_locations) x
    where jsonb_typeof(x) is distinct from 'object' or not(x ?& array['position','description'])
      or (x-array['position','description'])<>'{}'::jsonb
      or jsonb_typeof(x->'position') is distinct from 'number' or (x->>'position') !~ '^[1-4]$'
      or jsonb_typeof(x->'description') is distinct from 'string'
      or char_length(btrim(x->>'description')) not between 3 and 200
      or (x->>'description') ~ '[[:cntrl:]]')
    or (select count(distinct x->>'position') from jsonb_array_elements(p_locations) x)<>4 then
    raise exception using errcode='AG400',message='INVALID_SEAL_LOCATIONS'; end if;
  select jsonb_agg(jsonb_build_object('position',(x->>'position')::integer,
    'description',btrim(x->>'description')) order by (x->>'position')::integer) into normalized
    from jsonb_array_elements(p_locations) x;
  payload_value:=jsonb_build_object('draftId',d.id,'draftRevision',p_expected_draft,
    'fittingRevision',p_expected_fit,'locationRevision',p_expected_notes,'locations',normalized);
  perform pg_advisory_xact_lock(hashtextextended(d.tenant_id::text||actor::text||p_key::text,0));
  select payload into previous from private.draft_seal_location_events where tenant_id=d.tenant_id
    and agent_user_id=actor and request_key=p_key;
  if found then
    if previous<>payload_value then raise exception using errcode='AG409',message='IDEMPOTENCY_CONFLICT'; end if;
    return private.draft_seal_locations_read(d.id);
  end if;
  select * into h from private.draft_seal_packages where draft_id=d.id;
  select revision into notes_revision from private.draft_seal_location_notes where draft_id=d.id;
  if d.revision<>p_expected_draft or h.revision is distinct from p_expected_fit
    or h.saved_draft_revision<>d.revision or h.owner_profile_id<>d.owner_profile_id
    or coalesce(notes_revision,0)<>p_expected_notes then
    raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  if h.package='NONE' or (select count(*) from private.draft_seal_placements
    where draft_id=d.id and released_at is null)<>4 then
    raise exception using errcode='AG409',message='FITTING_REQUIRED'; end if;
  insert into private.draft_seal_location_notes(draft_id,tenant_id,organization_id,agent_user_id,
    owner_profile_id,draft_revision,fitting_revision,revision,locations)
    values(d.id,d.tenant_id,d.organization_id,actor,d.owner_profile_id,d.revision,h.revision,1,normalized)
    on conflict(draft_id) do update set owner_profile_id=excluded.owner_profile_id,
      draft_revision=excluded.draft_revision,fitting_revision=excluded.fitting_revision,
      revision=draft_seal_location_notes.revision+1,locations=excluded.locations,saved_at=now();
  insert into private.draft_seal_location_events(tenant_id,draft_id,organization_id,agent_user_id,request_key,payload)
    values(d.tenant_id,d.id,d.organization_id,actor,p_key,payload_value);
  return private.draft_seal_locations_read(d.id);
end; $$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.draft_seal_locations_read(uuid) owner to autoguardian_enrollment_executor;
alter function private.save_draft_seal_locations(uuid,uuid,integer,integer,integer,jsonb) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.draft_seal_locations_read(uuid),
  private.save_draft_seal_locations(uuid,uuid,integer,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.draft_seal_locations_read(uuid),
  private.save_draft_seal_locations(uuid,uuid,integer,integer,integer,jsonb) to autoguardian_enrollment_api;
commit;
