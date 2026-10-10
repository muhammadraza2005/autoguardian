-- Revision-bound development uploads for encrypted native retry journals.
-- This does not enable production evidence, approval, submission or activation.
begin;
create table private.native_evidence_upload_bindings (
  attachment_id uuid primary key references private.enrollment_attachments(id),
  tenant_id uuid not null, draft_id uuid not null, organization_id uuid not null,
  agent_user_id uuid not null, draft_revision integer not null check (draft_revision > 0),
  owner_generation integer not null check (owner_generation > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id)
);
alter table private.native_evidence_upload_bindings enable row level security;
alter table private.native_evidence_upload_bindings force row level security;
revoke all on private.native_evidence_upload_bindings from public,anon,authenticated,service_role,autoguardian_enrollment_api;
grant select,insert on private.native_evidence_upload_bindings to autoguardian_enrollment_executor;
create policy native_upload_binding_read on private.native_evidence_upload_bindings
  for select to autoguardian_enrollment_executor using (
    tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_id and d.status='DRAFT'));
create policy native_upload_binding_append on private.native_evidence_upload_bindings
  for insert to autoguardian_enrollment_executor with check (
    tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d join private.enrollment_attachments a on a.draft_id=d.id
      where d.id=native_evidence_upload_bindings.draft_id and d.status='DRAFT'
        and d.revision=native_evidence_upload_bindings.draft_revision
        and d.owner_generation=native_evidence_upload_bindings.owner_generation
        and a.id=attachment_id and a.owner_generation=d.owner_generation));

create function private.native_evidence_upload_context(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  return jsonb_build_object('draftRevision',d.revision,'ownerGeneration',d.owner_generation);
end; $$;
create function private.enrollment_attachment_reserve_bound(p_draft uuid,p_id uuid,p_kind text,p_mime text,p_size integer,p_sha text,
  p_revision integer,p_generation integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; b private.native_evidence_upload_bindings; result jsonb;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if p_revision is distinct from d.revision or p_generation is distinct from d.owner_generation then
    raise exception using errcode='AG409',message='UPLOAD_CONTEXT_CHANGED'; end if;
  select * into b from private.native_evidence_upload_bindings where attachment_id=p_id;
  if found and (b.draft_id<>d.id or b.draft_revision<>p_revision or b.owner_generation<>p_generation) then
    raise exception using errcode='AG409',message='UPLOAD_CONTEXT_CHANGED'; end if;
  if not found and exists(select 1 from private.enrollment_attachments where id=p_id) then
    raise exception using errcode='AG409',message='UPLOAD_KEY_ALREADY_USED'; end if;
  result:=private.enrollment_attachment_reserve(p_draft,p_id,p_kind,p_mime,p_size,p_sha);
  insert into private.native_evidence_upload_bindings(attachment_id,tenant_id,draft_id,organization_id,agent_user_id,draft_revision,owner_generation)
    values(p_id,d.tenant_id,d.id,d.organization_id,d.created_by,p_revision,p_generation) on conflict(attachment_id) do nothing;
  return result;
end; $$;
create function private.enrollment_attachment_finish_bound(p_draft uuid,p_id uuid,p_revision integer,p_generation integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if p_revision is distinct from d.revision or p_generation is distinct from d.owner_generation
    or not exists(select 1 from private.native_evidence_upload_bindings b where b.attachment_id=p_id
      and b.draft_id=d.id and b.draft_revision=p_revision and b.owner_generation=p_generation) then
    raise exception using errcode='AG409',message='UPLOAD_CONTEXT_CHANGED'; end if;
  return private.enrollment_attachment_finish(p_draft,p_id);
end; $$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.native_evidence_upload_context(uuid) owner to autoguardian_enrollment_executor;
alter function private.enrollment_attachment_reserve_bound(uuid,uuid,text,text,integer,text,integer,integer) owner to autoguardian_enrollment_executor;
alter function private.enrollment_attachment_finish_bound(uuid,uuid,integer,integer) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.native_evidence_upload_context(uuid),
  private.enrollment_attachment_reserve_bound(uuid,uuid,text,text,integer,text,integer,integer),
  private.enrollment_attachment_finish_bound(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.native_evidence_upload_context(uuid),
  private.enrollment_attachment_reserve_bound(uuid,uuid,text,text,integer,text,integer,integer),
  private.enrollment_attachment_finish_bound(uuid,uuid,integer,integer) to autoguardian_enrollment_api;
commit;
