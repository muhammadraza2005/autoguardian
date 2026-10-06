-- Run once as postgres after 007. Synthetic stock and provisional fitting only.
begin;
alter table private.enrollment_attachments drop constraint enrollment_attachments_kind_check;
alter table private.enrollment_attachments add constraint enrollment_attachments_kind_check
  check (kind in ('OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_PHOTO','SEAL_FITTING_PHOTO'));
alter table private.enrollment_attachments add constraint enrollment_fitting_photo_image_check
  check (kind<>'SEAL_FITTING_PHOTO' or mime_type in ('image/jpeg','image/png'));
create table private.development_seal_stock (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
  organization_id uuid not null, assigned_agent_id uuid not null,
  code text not null unique check (code ~ '^DEV-SEAL-[A-Z0-9-]{1,40}$'),
  batch_code text not null check (batch_code ~ '^DEV-BATCH-[A-Z0-9-]{1,40}$'),
  type text not null check (type in ('STANDARD','ALARM')),
  status text not null default 'IN_STOCK' check (status in ('IN_STOCK','REVOKED','DESTROYED')),
  unique (tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,assigned_agent_id) references app.users(tenant_id,id)
);
create table private.draft_seal_packages (
  draft_id uuid primary key, tenant_id uuid not null, organization_id uuid not null, agent_user_id uuid not null,
  owner_profile_id uuid not null, saved_draft_revision integer not null check (saved_draft_revision>0),
  revision integer not null check (revision>0),
  package text not null check (package in ('NONE','STANDARD','ONE_ALARM','FOUR_ALARMS')),
  unique (tenant_id,draft_id),
  foreign key (tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id),
  foreign key (tenant_id,owner_profile_id) references app.users(tenant_id,id)
);
create table private.draft_seal_placements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, draft_id uuid not null,
  organization_id uuid not null, agent_user_id uuid not null, seal_id uuid not null,
  position smallint not null check (position between 1 and 4), photo_id uuid references private.enrollment_attachments(id),
  created_at timestamptz not null default now(), released_at timestamptz,
  foreign key (tenant_id,draft_id) references private.draft_seal_packages(tenant_id,draft_id),
  foreign key (tenant_id,seal_id) references private.development_seal_stock(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id)
);
create unique index draft_seal_reserved_once on private.draft_seal_placements(seal_id) where released_at is null;
create unique index draft_seal_position_once on private.draft_seal_placements(draft_id,position) where released_at is null;
create unique index draft_seal_photo_once on private.draft_seal_placements(photo_id) where released_at is null and photo_id is not null;
create table private.draft_seal_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, draft_id uuid not null,
  organization_id uuid not null, agent_user_id uuid not null, request_key uuid not null,
  payload jsonb not null, created_at timestamptz not null default now(),
  unique (tenant_id,agent_user_id,request_key),
  foreign key (tenant_id,draft_id) references private.draft_seal_packages(tenant_id,draft_id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id)
);
alter table private.development_seal_stock enable row level security;
alter table private.development_seal_stock force row level security;
alter table private.draft_seal_packages enable row level security;
alter table private.draft_seal_packages force row level security;
alter table private.draft_seal_placements enable row level security;
alter table private.draft_seal_placements force row level security;
alter table private.draft_seal_events enable row level security;
alter table private.draft_seal_events force row level security;
revoke all on private.development_seal_stock,private.draft_seal_packages,private.draft_seal_placements,private.draft_seal_events
  from public,anon,authenticated,service_role,autoguardian_enrollment_api;
grant select on private.development_seal_stock to autoguardian_enrollment_executor;
grant update(id) on private.development_seal_stock to autoguardian_enrollment_executor;
grant select,insert,update on private.draft_seal_packages,private.draft_seal_placements to autoguardian_enrollment_executor;
grant select,insert on private.draft_seal_events to autoguardian_enrollment_executor;
create policy dev_seal_stock_scope on private.development_seal_stock to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and assigned_agent_id=private.enrollment_agent_id(organization_id))
  with check (false); -- Stock creation/reallocation/revocation is not a runtime operation.
create policy draft_seal_package_scope on private.draft_seal_packages to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from app.enrollment_drafts d where d.id=draft_seal_packages.draft_id and d.status='DRAFT'))
  with check (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from app.enrollment_drafts d where d.id=draft_seal_packages.draft_id and d.status='DRAFT'
      and d.owner_profile_id=draft_seal_packages.owner_profile_id and d.revision=draft_seal_packages.saved_draft_revision));
create policy draft_seal_placement_scope on private.draft_seal_placements to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from private.draft_seal_packages h where h.draft_id=draft_seal_placements.draft_id))
  with check (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from private.draft_seal_packages h where h.draft_id=draft_seal_placements.draft_id));
create policy draft_seal_event_read on private.draft_seal_events for select to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id));
create policy draft_seal_event_append on private.draft_seal_events for insert to autoguardian_enrollment_executor
  with check (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from private.draft_seal_packages h where h.draft_id=draft_seal_events.draft_id));

create function private.development_seal_stock_page(p_org uuid,p_limit integer,p_cursor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb; next_id uuid;
begin
  if private.enrollment_agent_id(p_org) is null then raise exception using errcode='AG403',message='AGENT_ACCESS_REQUIRED'; end if;
  if p_org is null or p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='AG400',message='INVALID_STOCK_PAGE'; end if;
  select coalesce(jsonb_agg(v.item order by v.id),'[]'::jsonb) into items from (
    select s.id,jsonb_build_object('id',s.id,'code',s.code,'batchCode',s.batch_code,'type',s.type,'status',s.status,
      'available',s.status='IN_STOCK' and not exists (select 1 from private.draft_seal_placements p where p.seal_id=s.id and p.released_at is null)) item
    from private.development_seal_stock s where s.organization_id=p_org and (p_cursor is null or s.id>p_cursor)
    order by s.id limit p_limit
  ) v;
  if jsonb_array_length(items)=p_limit and exists (select 1 from private.development_seal_stock s
    where s.organization_id=p_org and s.id>(items->(p_limit-1)->>'id')::uuid) then
    next_id:=(items->(p_limit-1)->>'id')::uuid;
  end if;
  return jsonb_build_object('items',items,'nextCursor',next_id,'sampleOnly',true);
end;
$$;

create function private.draft_seal_fitting_read(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; h private.draft_seal_packages; items jsonb; ready boolean:=false;
  current_fit boolean:=false; alarm_count integer; photo_count integer;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select * into h from private.draft_seal_packages where draft_id=p_draft;
  current_fit:=h.draft_id is not null and h.saved_draft_revision=d.revision and h.owner_profile_id=d.owner_profile_id;
  select coalesce(jsonb_agg(jsonb_build_object('position',p.position,'sealCode',s.code,'sealType',s.type,'photoId',p.photo_id)
    order by p.position),'[]'::jsonb), count(*) filter (where s.type='ALARM'),
    count(*) filter (where s.status='IN_STOCK' and a.status='STAGED' and a.kind='SEAL_FITTING_PHOTO'
      and a.mime_type in ('image/jpeg','image/png'))
  into items,alarm_count,photo_count from private.draft_seal_placements p
    join private.development_seal_stock s on s.id=p.seal_id
    left join private.enrollment_attachments a on a.id=p.photo_id and a.draft_id=d.id and a.owner_profile_id=d.owner_profile_id
    where p.draft_id=p_draft and p.released_at is null;
  ready:=current_fit and ((h.package='NONE' and jsonb_array_length(items)=0)
    or (h.package<>'NONE' and jsonb_array_length(items)=4 and photo_count=4
      and alarm_count=case h.package when 'STANDARD' then 0 when 'ONE_ALARM' then 1 when 'FOUR_ALARMS' then 4 else -1 end));
  return jsonb_build_object('draftId',d.id,'draftRevision',d.revision,'fittingRevision',coalesce(h.revision,0),
    'package',h.package,'current',current_fit,'placements',items,'sampleOnly',true,'sealDraftComplete',coalesce(ready,false),
    'sampleDocumentsSaved',exists(select 1 from private.enrollment_attachments where draft_id=d.id and kind='OWNER_ID' and status='STAGED')
      and exists(select 1 from private.enrollment_attachments where draft_id=d.id and kind='REGISTRATION_DOCUMENT' and status='STAGED')
      and exists(select 1 from private.enrollment_attachments where draft_id=d.id and kind='VEHICLE_PHOTO' and status='STAGED'),
    'ownerVerified',false,'paymentConfirmed',false,'enrollmentActive',false);
end;
$$;

create function private.save_draft_seal_fitting(p_draft uuid,p_key uuid,p_expected_draft integer,p_expected_fit integer,
  p_package text,p_placements jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; h private.draft_seal_packages; actor uuid; payload_value jsonb; previous jsonb;
  item jsonb; stock private.development_seal_stock; n integer; alarms integer:=0; standards integer:=0;
  max_alarms integer; max_standards integer; photo uuid;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  actor:=private.enrollment_agent_id(d.organization_id);
  if not exists (select 1 from private.development_enrollment_owners o join app.users u on u.tenant_id=o.tenant_id and u.id=o.user_id
    where o.organization_id=d.organization_id and o.user_id=d.owner_profile_id) then
    raise exception using errcode='AG422',message='OWNER_PROFILE_UNAVAILABLE'; end if;
  if p_key is null or p_expected_draft is null or p_expected_fit is null or p_expected_fit<0
    or p_package is null or p_package not in ('NONE','STANDARD','ONE_ALARM','FOUR_ALARMS')
    or jsonb_typeof(p_placements) is distinct from 'array' then raise exception using errcode='AG400',message='INVALID_SEAL_FITTING'; end if;
  payload_value:=jsonb_build_object('draftId',p_draft,'draftRevision',p_expected_draft,'fittingRevision',p_expected_fit,'package',p_package,'placements',p_placements);
  perform pg_advisory_xact_lock(hashtextextended(d.tenant_id::text||actor::text||p_key::text,0));
  select payload into previous from private.draft_seal_events where tenant_id=d.tenant_id and agent_user_id=actor and request_key=p_key;
  if found then
    if previous<>payload_value then raise exception using errcode='AG409',message='IDEMPOTENCY_CONFLICT'; end if;
    return private.draft_seal_fitting_read(p_draft);
  end if;
  select * into h from private.draft_seal_packages where draft_id=d.id;
  if d.revision<>p_expected_draft or coalesce(h.revision,0)<>p_expected_fit then
    raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  n:=jsonb_array_length(p_placements);
  if n>4 or (p_package='NONE' and n<>0) then raise exception using errcode='AG400',message='INVALID_SEAL_FITTING'; end if;
  if exists (select 1 from jsonb_array_elements(p_placements) x where jsonb_typeof(x) is distinct from 'object'
    or not (x ?& array['position','sealCode','photoId']) or (x-array['position','sealCode','photoId'])<>'{}'::jsonb
    or jsonb_typeof(x->'position') is distinct from 'number' or (x->>'position') !~ '^[1-4]$'
    or jsonb_typeof(x->'sealCode') is distinct from 'string' or (x->>'sealCode') !~ '^DEV-SEAL-[A-Z0-9-]{1,40}$'
    or (x->'photoId'<>'null'::jsonb and jsonb_typeof(x->'photoId') is distinct from 'string')) then
    raise exception using errcode='AG400',message='INVALID_SEAL_FITTING'; end if;
  if (select count(distinct x->>'position') from jsonb_array_elements(p_placements) x)<>n
    or (select count(distinct x->>'sealCode') from jsonb_array_elements(p_placements) x)<>n then
    raise exception using errcode='AG400',message='DUPLICATE_SEAL_POSITION'; end if;
  max_alarms:=case p_package when 'ONE_ALARM' then 1 when 'FOUR_ALARMS' then 4 else 0 end;
  max_standards:=case p_package when 'STANDARD' then 4 when 'ONE_ALARM' then 3 else 0 end;
  -- Lock old and new stock in the same order; draft, upload and fitting writes share the draft lock.
  perform s.id from private.development_seal_stock s where s.code in
    (select x->>'sealCode' from jsonb_array_elements(p_placements) x)
    or s.id in (select seal_id from private.draft_seal_placements where draft_id=d.id and released_at is null)
    order by s.id for update;
  for item in select value from jsonb_array_elements(p_placements) loop
    select * into stock from private.development_seal_stock where code=item->>'sealCode' and organization_id=d.organization_id
      and assigned_agent_id=actor and status='IN_STOCK';
    if not found then raise exception using errcode='AG409',message='SEAL_UNAVAILABLE'; end if;
    if exists (select 1 from private.draft_seal_placements where seal_id=stock.id and released_at is null and draft_id<>d.id) then
      raise exception using errcode='AG409',message='SEAL_UNAVAILABLE'; end if;
    if stock.type='ALARM' then alarms:=alarms+1; else standards:=standards+1; end if;
    photo:=(item->>'photoId')::uuid;
    if photo is not null and not exists (select 1 from private.enrollment_attachments a where a.id=photo and a.draft_id=d.id
      and a.owner_profile_id=d.owner_profile_id and a.kind='SEAL_FITTING_PHOTO' and a.status='STAGED' and a.mime_type in ('image/jpeg','image/png')) then
      raise exception using errcode='AG422',message='FITTING_PHOTO_UNAVAILABLE'; end if;
  end loop;
  if alarms>max_alarms or standards>max_standards then raise exception using errcode='AG400',message='PACKAGE_SEAL_MISMATCH'; end if;
  if (select count(x->>'photoId') from jsonb_array_elements(p_placements) x)<>
    (select count(distinct x->>'photoId') from jsonb_array_elements(p_placements) x) then
    raise exception using errcode='AG400',message='DUPLICATE_FITTING_PHOTO'; end if;
  insert into private.draft_seal_packages(draft_id,tenant_id,organization_id,agent_user_id,owner_profile_id,saved_draft_revision,revision,package)
    values (d.id,d.tenant_id,d.organization_id,actor,d.owner_profile_id,d.revision,1,p_package)
    on conflict(draft_id) do update set owner_profile_id=excluded.owner_profile_id,saved_draft_revision=excluded.saved_draft_revision,
      package=excluded.package,revision=draft_seal_packages.revision+1;
  update private.draft_seal_placements set released_at=now() where draft_id=d.id and released_at is null;
  begin
    insert into private.draft_seal_placements(tenant_id,draft_id,organization_id,agent_user_id,seal_id,position,photo_id)
      select d.tenant_id,d.id,d.organization_id,actor,s.id,(x->>'position')::smallint,(x->>'photoId')::uuid
      from jsonb_array_elements(p_placements) x join private.development_seal_stock s on s.code=x->>'sealCode';
  exception when unique_violation then raise exception using errcode='AG409',message='SEAL_UNAVAILABLE'; end;
  insert into private.draft_seal_events(tenant_id,draft_id,organization_id,agent_user_id,request_key,payload)
    values(d.tenant_id,d.id,d.organization_id,actor,p_key,payload_value);
  return private.draft_seal_fitting_read(d.id);
end;
$$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.development_seal_stock_page(uuid,integer,uuid) owner to autoguardian_enrollment_executor;
alter function private.draft_seal_fitting_read(uuid) owner to autoguardian_enrollment_executor;
alter function private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.development_seal_stock_page(uuid,integer,uuid),private.draft_seal_fitting_read(uuid),
  private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.development_seal_stock_page(uuid,integer,uuid),private.draft_seal_fitting_read(uuid),
  private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb) to autoguardian_enrollment_api;
commit;
