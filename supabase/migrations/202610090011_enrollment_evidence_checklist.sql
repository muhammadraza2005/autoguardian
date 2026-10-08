-- Run once after 010. Detailed development evidence only; never activation.
begin;
alter table private.enrollment_attachments drop constraint enrollment_attachments_kind_check;
alter table private.enrollment_attachments add constraint enrollment_attachments_kind_check check(kind in (
  'OWNER_ID','REGISTRATION_DOCUMENT','PURCHASE_PROOF','VEHICLE_PHOTO','SEAL_FITTING_PHOTO',
  'VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO'));
alter table private.enrollment_attachments add constraint enrollment_checklist_photo_image_check check(
  kind not in ('VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO')
  or mime_type in ('image/jpeg','image/png'));

-- Forced RLS limits every result to the current draft, agent and owner generation.
-- No identity, storage paths, hashes or file identifiers enter this projection.
create function private.enrollment_evidence_checklist(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform 1 from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  with requirements(code,kinds,position) as (values
    ('OWNER_ID',array['OWNER_ID'],1),
    ('REGISTRATION_PROOF',array['REGISTRATION_DOCUMENT','PURCHASE_PROOF'],2),
    ('VEHICLE_FRONT',array['VEHICLE_FRONT'],3),('VEHICLE_REAR',array['VEHICLE_REAR'],4),
    ('VEHICLE_LEFT',array['VEHICLE_LEFT'],5),('VEHICLE_RIGHT',array['VEHICLE_RIGHT'],6),
    ('CHASSIS_PHOTO',array['CHASSIS_PHOTO'],7),('PLATE_PHOTO',array['PLATE_PHOTO'],8)
  ), states as (
    select r.code,r.position,case
      when exists(select 1 from private.enrollment_attachments a where a.draft_id=p_draft
        and a.kind=any(r.kinds) and a.status='STAGED') then 'COMPLETE'
      when exists(select 1 from private.enrollment_attachments a where a.draft_id=p_draft
        and a.kind=any(r.kinds) and a.status='PENDING') then 'PENDING'
      else 'MISSING' end as status from requirements r
  ) select jsonb_build_object('version',1,'complete',bool_and(status='COMPLETE'),
      'items',jsonb_agg(jsonb_build_object('code',code,'status',status) order by position)) into result from states;
  return result;
end; $$;

create or replace function private.enrollment_attachment_list(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; checklist jsonb;
begin
  checklist:=private.enrollment_evidence_checklist(p_draft);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'mimeType',mime_type,
    'byteSize',byte_size,'status',status,'createdAt',created_at) order by created_at,id),'[]'::jsonb)
    into result from private.enrollment_attachments where draft_id=p_draft;
  return jsonb_build_object('items',result,'evidenceChecklist',checklist);
end; $$;

create or replace function private.enrollment_attachment_reserve(p_draft uuid,p_id uuid,p_kind text,p_mime text,p_size integer,p_sha text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; a private.enrollment_attachments;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if not exists(select 1 from private.development_enrollment_owners o join app.users u
    on u.tenant_id=o.tenant_id and u.id=o.user_id
    where o.organization_id=d.organization_id and o.user_id=d.owner_profile_id) then
    raise exception using errcode='AG422',message='OWNER_PROFILE_UNAVAILABLE'; end if;
  select * into a from private.enrollment_attachments where id=p_id;
  if found then
    if a.draft_id<>p_draft or a.kind<>p_kind or a.mime_type<>p_mime or a.byte_size<>p_size or a.sha256<>p_sha then
      raise exception using errcode='AG409',message='ATTACHMENT_CONFLICT'; end if;
    return to_jsonb(a);
  end if;
  -- Serialize reservations on the draft. One identical image cannot fill different views.
  if p_kind in ('VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO')
    and exists(select 1 from private.enrollment_attachments where draft_id=p_draft and sha256=p_sha
      and kind in ('VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO') and kind<>p_kind) then
    raise exception using errcode='AG409',message='DISTINCT_PHOTO_REQUIRED'; end if;
  -- Eight required items plus four fitting photos, with room for corrections.
  if (select count(*) from private.enrollment_attachments where draft_id=p_draft)>=30 then
    raise exception using errcode='AG409',message='ATTACHMENT_LIMIT'; end if;
  insert into private.enrollment_attachments(id,tenant_id,draft_id,agent_user_id,organization_id,owner_profile_id,kind,mime_type,byte_size,sha256,object_path)
    values(p_id,d.tenant_id,d.id,d.created_by,d.organization_id,d.owner_profile_id,p_kind,p_mime,p_size,p_sha,
      d.tenant_id::text||'/'||d.id::text||'/'||p_id::text||'.agenc') returning * into a;
  insert into private.enrollment_attachment_events(tenant_id,attachment_id,actor_user_id,action)
    values(d.tenant_id,a.id,d.created_by,'RESERVED');
  return to_jsonb(a);
end; $$;

-- Finish uses the same draft lock as reservation/owner edits. A checklist/list
-- read holds a share lock, so its metadata and completion states stay consistent.
create or replace function private.enrollment_attachment_finish(p_draft uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.enrollment_attachments;
begin
  perform 1 from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select * into a from private.enrollment_attachments where id=p_id and draft_id=p_draft for update;
  if not found then raise exception using errcode='AG404',message='ATTACHMENT_NOT_FOUND'; end if;
  if a.status='PENDING' then
    update private.enrollment_attachments set status='STAGED' where id=p_id returning * into a;
    insert into private.enrollment_attachment_events(tenant_id,attachment_id,actor_user_id,action)
      values(a.tenant_id,a.id,a.agent_user_id,'STAGED');
  end if;
  return jsonb_build_object('id',a.id,'kind',a.kind,'mimeType',a.mime_type,'byteSize',a.byte_size,
    'status',a.status,'createdAt',a.created_at);
end; $$;

alter function private.draft_seal_fitting_read(uuid) rename to draft_seal_fitting_read_samples;
revoke all on function private.draft_seal_fitting_read_samples(uuid) from autoguardian_enrollment_api;
create function private.draft_seal_fitting_read(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return jsonb_set(private.draft_seal_fitting_read_samples(p_draft),'{sampleDocumentsSaved}',
    private.enrollment_evidence_checklist(p_draft)->'complete');
end; $$;

alter function private.enrollment_readiness(uuid) rename to enrollment_readiness_owner;
revoke all on function private.enrollment_readiness_owner(uuid) from autoguardian_enrollment_api;
create function private.enrollment_readiness(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; checklist jsonb; checks jsonb;
begin
  result:=private.enrollment_readiness_owner(p_draft);
  checklist:=private.enrollment_evidence_checklist(p_draft);
  select jsonb_agg(case when c->>'code' in ('IDENTITY_SAMPLE','REGISTRATION_SAMPLE','VEHICLE_PHOTO_SAMPLE') then
      jsonb_set(c,'{status}',to_jsonb(case when not exists(
        select 1 from jsonb_array_elements(checklist->'items') e where
          (case c->>'code' when 'IDENTITY_SAMPLE' then e->>'code'='OWNER_ID'
            when 'REGISTRATION_SAMPLE' then e->>'code'='REGISTRATION_PROOF'
            else e->>'code' not in ('OWNER_ID','REGISTRATION_PROOF') end)
          and e->>'status'<>'COMPLETE') then 'COMPLETE'::text else 'MISSING'::text end))
    else c end order by ordinal) into checks from jsonb_array_elements(result->'checks') with ordinality as x(c,ordinal);
  return jsonb_set(result,'{checks}',checks)||jsonb_build_object('evidenceChecklist',checklist);
end; $$;

grant create on schema private to autoguardian_enrollment_executor;
alter function private.enrollment_evidence_checklist(uuid) owner to autoguardian_enrollment_executor;
alter function private.draft_seal_fitting_read(uuid) owner to autoguardian_enrollment_executor;
alter function private.enrollment_readiness(uuid) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_evidence_checklist(uuid),private.draft_seal_fitting_read(uuid),
  private.enrollment_readiness(uuid) from public,anon,authenticated,service_role;
grant execute on function private.draft_seal_fitting_read(uuid),private.enrollment_readiness(uuid) to autoguardian_enrollment_api;
commit;
