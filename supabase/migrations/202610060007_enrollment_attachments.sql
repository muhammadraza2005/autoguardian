-- Run once as postgres after 006. Development staging only; no enrollment activation.
begin;
create table private.enrollment_attachments (
  id uuid primary key, tenant_id uuid not null references app.tenants(id), draft_id uuid not null,
  agent_user_id uuid not null, organization_id uuid not null, owner_profile_id uuid not null,
  kind text not null check (kind in ('OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_PHOTO')),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  byte_size integer not null check (byte_size between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_path text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','STAGED')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id),
  foreign key (tenant_id,owner_profile_id) references app.users(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id)
);
create table private.enrollment_attachment_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
  attachment_id uuid not null references private.enrollment_attachments(id), actor_user_id uuid not null,
  action text not null check (action in ('RESERVED','STAGED','READ_REQUESTED')),
  reason text check (reason is null or reason='ENROLLMENT_REVIEW'), created_at timestamptz not null default now(),
  foreign key (tenant_id,actor_user_id) references app.users(tenant_id,id)
);
alter table private.enrollment_attachments enable row level security;
alter table private.enrollment_attachments force row level security;
alter table private.enrollment_attachment_events enable row level security;
alter table private.enrollment_attachment_events force row level security;
revoke all on private.enrollment_attachments,private.enrollment_attachment_events from public,anon,authenticated,service_role;
grant select,insert,update on private.enrollment_attachments to autoguardian_enrollment_executor;
grant insert on private.enrollment_attachment_events to autoguardian_enrollment_executor;
create policy attachment_executor_scope on private.enrollment_attachments to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from app.enrollment_drafts d where d.id=enrollment_attachments.draft_id and d.status='DRAFT'
      and d.owner_profile_id=enrollment_attachments.owner_profile_id))
  with check (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists (select 1 from app.enrollment_drafts d where d.id=enrollment_attachments.draft_id and d.status='DRAFT'
      and d.owner_profile_id=enrollment_attachments.owner_profile_id));
create policy attachment_event_append on private.enrollment_attachment_events for insert to autoguardian_enrollment_executor
  with check (tenant_id=private.request_tenant_id() and exists (select 1 from private.enrollment_attachments a
    where a.id=enrollment_attachment_events.attachment_id and a.agent_user_id=enrollment_attachment_events.actor_user_id));

create function private.enrollment_attachment_list(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists (select 1 from app.enrollment_drafts where id=p_draft and status='DRAFT') then
    raise exception using errcode='AG404',message='DRAFT_NOT_FOUND';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'mimeType',mime_type,
    'byteSize',byte_size,'status',status,'createdAt',created_at) order by created_at,id),'[]'::jsonb)
  into result from private.enrollment_attachments where draft_id=p_draft;
  return jsonb_build_object('items',result);
end;
$$;
create function private.enrollment_attachment_reserve(p_draft uuid,p_id uuid,p_kind text,p_mime text,p_size integer,p_sha text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; a private.enrollment_attachments;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if not exists (select 1 from private.development_enrollment_owners o join app.users u
    on u.tenant_id=o.tenant_id and u.id=o.user_id
    where o.organization_id=d.organization_id and o.user_id=d.owner_profile_id) then
    raise exception using errcode='AG422',message='OWNER_PROFILE_UNAVAILABLE';
  end if;
  select * into a from private.enrollment_attachments where id=p_id;
  if found then
    if a.draft_id<>p_draft or a.kind<>p_kind or a.mime_type<>p_mime or a.byte_size<>p_size or a.sha256<>p_sha then
      raise exception using errcode='AG409',message='ATTACHMENT_CONFLICT';
    end if;
    return to_jsonb(a);
  end if;
  if (select count(*) from private.enrollment_attachments where draft_id=p_draft)>=10 then
    raise exception using errcode='AG409',message='ATTACHMENT_LIMIT';
  end if;
  insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,kind,mime_type,byte_size,sha256,object_path)
  values (p_id,d.tenant_id,d.id,d.created_by,d.organization_id,d.owner_profile_id,p_kind,p_mime,p_size,p_sha,
    d.tenant_id::text||'/'||d.id::text||'/'||p_id::text||'.agenc') returning * into a;
  insert into private.enrollment_attachment_events(tenant_id,attachment_id,actor_user_id,action)
    values (d.tenant_id,a.id,d.created_by,'RESERVED');
  return to_jsonb(a);
end;
$$;
create function private.enrollment_attachment_finish(p_draft uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.enrollment_attachments;
begin
  select * into a from private.enrollment_attachments where id=p_id and draft_id=p_draft for update;
  if not found then raise exception using errcode='AG404',message='ATTACHMENT_NOT_FOUND'; end if;
  if a.status='PENDING' then
    update private.enrollment_attachments set status='STAGED' where id=p_id returning * into a;
    insert into private.enrollment_attachment_events(tenant_id,attachment_id,actor_user_id,action)
      values (a.tenant_id,a.id,a.agent_user_id,'STAGED');
  end if;
  return jsonb_build_object('id',a.id,'kind',a.kind,'mimeType',a.mime_type,'byteSize',a.byte_size,
    'status',a.status,'createdAt',a.created_at);
end;
$$;
create function private.enrollment_attachment_read(p_draft uuid,p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.enrollment_attachments;
begin
  if p_reason is distinct from 'ENROLLMENT_REVIEW' then raise exception using errcode='AG400',message='READ_REASON_REQUIRED'; end if;
  select * into a from private.enrollment_attachments where id=p_id and draft_id=p_draft and status='STAGED';
  if not found then raise exception using errcode='AG404',message='ATTACHMENT_NOT_FOUND'; end if;
  insert into private.enrollment_attachment_events(tenant_id,attachment_id,actor_user_id,action,reason)
    values (a.tenant_id,a.id,a.agent_user_id,'READ_REQUESTED',p_reason);
  return to_jsonb(a);
end;
$$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.enrollment_attachment_list(uuid) owner to autoguardian_enrollment_executor;
alter function private.enrollment_attachment_reserve(uuid,uuid,text,text,integer,text) owner to autoguardian_enrollment_executor;
alter function private.enrollment_attachment_finish(uuid,uuid) owner to autoguardian_enrollment_executor;
alter function private.enrollment_attachment_read(uuid,uuid,text) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_attachment_list(uuid),
  private.enrollment_attachment_reserve(uuid,uuid,text,text,integer,text),
  private.enrollment_attachment_finish(uuid,uuid),private.enrollment_attachment_read(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function private.enrollment_attachment_list(uuid),
  private.enrollment_attachment_reserve(uuid,uuid,text,text,integer,text),
  private.enrollment_attachment_finish(uuid,uuid),private.enrollment_attachment_read(uuid,uuid,text)
  to autoguardian_enrollment_api;
commit;
