-- Run once as postgres after 016. Approved policy: independent TENANT_ADMIN.
begin;
create role autoguardian_review_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
-- Schema installation needs SET ROLE for function ownership. The runtime login
-- receives no membership in this executor (matching migration 005).
grant autoguardian_review_executor to current_user;
grant usage on schema app,private to autoguardian_review_executor;
grant execute on function private.request_tenant_id(),private.request_auth_user_id(),private.enrollment_agent_id(uuid) to autoguardian_review_executor;
grant select(id,tenant_id,auth_user_id,status,deleted_at) on app.users to autoguardian_review_executor;
grant select(id,status,deleted_at) on app.tenants to autoguardian_review_executor;
grant select(tenant_id,user_id,role_code,organization_id,valid_from,valid_to,deleted_at) on app.role_assignments to autoguardian_review_executor;
create policy review_tenant_lookup on app.tenants for select to autoguardian_review_executor
  using(id=private.request_tenant_id() and status='ACTIVE' and deleted_at is null and private.request_auth_user_id() is not null);
create policy review_user_lookup on app.users for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and auth_user_id=private.request_auth_user_id() and status='ACTIVE' and deleted_at is null
    and exists(select 1 from app.tenants t where t.id=users.tenant_id));
create policy review_role_lookup on app.role_assignments for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.users u where u.id=role_assignments.user_id));
create function private.registration_reviewer_id() returns uuid language sql stable security definer set search_path='' as $$
  select u.id from app.users u join app.role_assignments r on r.tenant_id=u.tenant_id and r.user_id=u.id
  where r.role_code='TENANT_ADMIN' and r.organization_id is null and r.deleted_at is null and r.valid_from<=now()
    and (r.valid_to is null or r.valid_to>now()) order by u.id limit 1
$$;
grant select on app.enrollment_drafts to autoguardian_review_executor;
grant update(id) on app.enrollment_drafts to autoguardian_review_executor;
-- UPDATE(id) is solely for row locks; no write function is exposed.
create policy review_draft_read on app.enrollment_drafts for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and (created_by=private.enrollment_agent_id(organization_id)
    or (private.registration_reviewer_id() is not null and created_by<>private.registration_reviewer_id())));
create policy review_draft_lock on app.enrollment_drafts for update to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and (created_by=private.enrollment_agent_id(organization_id)
    or (private.registration_reviewer_id() is not null and created_by<>private.registration_reviewer_id())))
  with check(tenant_id=private.request_tenant_id());
grant select on private.enrollment_attachments,private.draft_seal_packages,private.draft_seal_placements,
  private.draft_seal_location_notes,private.enrollment_prerequisite_receipts,private.enrollment_submissions to autoguardian_review_executor;
create policy review_attachment_read on private.enrollment_attachments for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id
    and d.owner_generation=enrollment_attachments.owner_generation and d.owner_profile_id=enrollment_attachments.owner_profile_id));
create policy review_package_read on private.draft_seal_packages for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create policy review_placement_read on private.draft_seal_placements for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create policy review_location_read on private.draft_seal_location_notes for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create policy review_receipt_read on private.enrollment_prerequisite_receipts for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create policy review_submission_read on private.enrollment_submissions for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create table private.registration_review_events (
  sequence bigint generated always as identity primary key, id uuid not null unique default gen_random_uuid(),
  tenant_id uuid not null, draft_id uuid not null, reviewer_id uuid not null, request_key uuid not null,
  draft_revision integer not null, snapshot_revision integer not null, expected_review_revision integer not null,
  action text not null check(action in ('READ_REQUESTED','ACCEPTED','NEEDS_CORRECTION','SUPERSEDED','APPROVED')),
  attachment_id uuid references private.enrollment_attachments(id), replacement_id uuid references private.enrollment_attachments(id),
  reason text check(reason in ('BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH')),
  created_at timestamptz not null default now(),
  check(draft_revision>0 and snapshot_revision>0 and expected_review_revision>=0),
  check((action='NEEDS_CORRECTION')=(reason is not null)),
  check((action='SUPERSEDED')=(replacement_id is not null)),
  check((action='APPROVED')=(attachment_id is null)),
  unique(tenant_id,reviewer_id,request_key),
  foreign key(tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key(tenant_id,reviewer_id) references app.users(tenant_id,id)
);
alter table private.registration_review_events enable row level security;
alter table private.registration_review_events force row level security;
revoke all on private.registration_review_events from public,anon,authenticated,service_role,autoguardian_enrollment_api;
grant select,insert on private.registration_review_events to autoguardian_review_executor;
grant usage on sequence private.registration_review_events_sequence_seq to autoguardian_review_executor;
create policy registration_review_read on private.registration_review_events for select to autoguardian_review_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create policy registration_review_append on private.registration_review_events for insert to autoguardian_review_executor
  with check(tenant_id=private.request_tenant_id() and reviewer_id=private.registration_reviewer_id()
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_id and d.created_by<>reviewer_id
      and d.revision=draft_revision and d.enrollment_snapshot_revision=snapshot_revision));
grant insert on private.enrollment_prerequisite_receipts to autoguardian_review_executor;
grant usage on sequence private.enrollment_prerequisite_receipts_sequence_seq to autoguardian_review_executor;
create policy registration_review_receipt_append on private.enrollment_prerequisite_receipts for insert to autoguardian_review_executor
  with check(tenant_id=private.request_tenant_id() and code in ('PRODUCTION_EVIDENCE','REVIEW_POLICY')
    and private.registration_reviewer_id() is not null and exists(select 1 from app.enrollment_drafts d
      where d.id=draft_id and d.enrollment_mode='PRODUCTION' and d.created_by<>private.registration_reviewer_id()
        and d.revision=enrollment_prerequisite_receipts.draft_revision and d.enrollment_snapshot_revision=enrollment_prerequisite_receipts.snapshot_revision
        and d.owner_generation=enrollment_prerequisite_receipts.owner_generation));
-- Preserve 016's exact freeze behavior. This narrow role can lock either its
-- agent's own draft or an independent administrator's authorized review draft.
grant create on schema private to autoguardian_review_executor;
alter function private.enrollment_submission_freeze() owner to autoguardian_review_executor;

create function private.registration_review_read(p_draft uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; actor uuid; items jsonb; history jsonb; review_count integer; evidence_ok boolean; seal_ok boolean; frozen boolean;
  package private.draft_seal_packages; locations jsonb;
begin
  actor:=private.registration_reviewer_id();
  if actor is null then raise exception using errcode='AG403',message='REVIEWER_ACCESS_REQUIRED'; end if;
  select * into d from app.enrollment_drafts where id=p_draft and created_by<>actor for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select count(*)::integer into review_count from private.registration_review_events where draft_id=d.id and action<>'READ_REQUESTED';
  select * into package from private.draft_seal_packages where draft_id=d.id and owner_profile_id=d.owner_profile_id and saved_draft_revision=d.revision;
  select n.locations into locations from private.draft_seal_location_notes n where n.draft_id=d.id and n.owner_profile_id=d.owner_profile_id
    and n.draft_revision=d.revision and n.fitting_revision=package.revision;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'mimeType',a.mime_type,'status',a.status,
    'decision',case when r.snapshot_revision=d.enrollment_snapshot_revision and r.draft_revision=d.revision then r.action else 'NOT_REVIEWED' end,
    'reason',case when r.snapshot_revision=d.enrollment_snapshot_revision and r.draft_revision=d.revision then r.reason else null end,
    'replacementId',case when r.snapshot_revision=d.enrollment_snapshot_revision and r.draft_revision=d.revision then r.replacement_id else null end)
    order by a.created_at,a.id),'[]'::jsonb) into items from private.enrollment_attachments a left join lateral
      (select * from private.registration_review_events e where e.attachment_id=a.id and e.action in ('ACCEPTED','NEEDS_CORRECTION','SUPERSEDED')
        order by sequence desc limit 1) r on true where a.draft_id=d.id;
  evidence_ok:=not exists(select 1 from jsonb_array_elements(items) i where i->>'decision' not in ('ACCEPTED','SUPERSEDED') or i->>'status'<>'STAGED')
    and not exists(select 1 from unnest(array['OWNER_ID','REGISTRATION_PROOF','VEHICLE_FRONT','VEHICLE_REAR','VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO']) c
      where not exists(select 1 from jsonb_array_elements(items) i where i->>'decision'='ACCEPTED' and
        (i->>'kind'=c or (c='REGISTRATION_PROOF' and i->>'kind' in ('REGISTRATION_DOCUMENT','PURCHASE_PROOF')))));
  seal_ok:=exists(select 1 from (select * from private.enrollment_prerequisite_receipts where draft_id=d.id and code='SEALS' order by sequence desc limit 1) r
    where r.accepted and r.issued_at<=now() and r.expires_at>now() and r.draft_revision=d.revision and r.owner_generation=d.owner_generation
      and r.snapshot_revision=d.enrollment_snapshot_revision and r.fitting_revision=package.revision)
    and package.draft_id is not null and case when package.package='NONE' then
      not exists(select 1 from private.draft_seal_placements where draft_id=d.id and released_at is null)
    else coalesce(jsonb_array_length(locations),0)=4
      and (select count(*) from private.draft_seal_placements where draft_id=d.id and released_at is null)=4
      and not exists(select 1 from private.draft_seal_placements p where p.draft_id=d.id and p.released_at is null
        and not exists(select 1 from jsonb_array_elements(items) i where i->>'id'=p.photo_id::text and i->>'kind'='SEAL_FITTING_PHOTO'
          and i->>'decision'='ACCEPTED' and i->>'status'='STAGED')) end;
  frozen:=exists(select 1 from private.enrollment_submissions where draft_id=d.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'attachmentId',attachment_id,'replacementId',replacement_id,
    'reviewerId',reviewer_id,'draftRevision',draft_revision,'snapshotRevision',snapshot_revision,'reason',reason,'createdAt',created_at) order by sequence),'[]'::jsonb)
    into history from private.registration_review_events where draft_id=d.id and action<>'READ_REQUESTED';
  return jsonb_build_object('version',1,'draftId',d.id,'mode',d.enrollment_mode,'draftRevision',d.revision,'snapshotRevision',d.enrollment_snapshot_revision,
    'reviewRevision',review_count,'vehicle',private.enrollment_draft_json(d)->'vehicle','items',items,'history',history,
    'sealPackage',package.package,'sealLocations',coalesce(locations,'[]'::jsonb),
    'evidenceComplete',evidence_ok,'sealsConfirmed',seal_ok,'frozen',frozen,'canApprove',evidence_ok and seal_ok and not frozen,
    'productionApproved',d.enrollment_mode='PRODUCTION' and evidence_ok and seal_ok and exists(select 1 from private.registration_review_events e where e.draft_id=d.id
      and e.action='APPROVED' and e.snapshot_revision=d.enrollment_snapshot_revision and e.draft_revision=d.revision
      and e.sequence=(select max(sequence) from private.registration_review_events where draft_id=d.id and action<>'READ_REQUESTED')));
end; $$;
create function private.registration_review_queue(p_limit integer,p_offset integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if private.registration_reviewer_id() is null then raise exception using errcode='AG403',message='REVIEWER_ACCESS_REQUIRED'; end if;
  if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then raise exception using errcode='AG400',message='INVALID_PAGE'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'mode',enrollment_mode,'chassisIdentifier',chassis_identifier,
    'plate',plate,'updatedAt',updated_at) order by updated_at desc,id) from (select * from app.enrollment_drafts where created_by<>private.registration_reviewer_id()
      order by updated_at desc,id limit p_limit offset p_offset) d),'[]'::jsonb));
end; $$;
create function private.registration_review_feedback(p_draft uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; items jsonb;
begin
  if private.enrollment_agent_id(null) is null then raise exception using errcode='AG403',message='AGENT_ACCESS_REQUIRED'; end if;
  select * into d from app.enrollment_drafts where id=p_draft and created_by=private.enrollment_agent_id(organization_id) for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,
    'decision',case when e.snapshot_revision=d.enrollment_snapshot_revision and e.draft_revision=d.revision then e.action else 'NOT_REVIEWED' end,
    'reason',case when e.snapshot_revision=d.enrollment_snapshot_revision and e.draft_revision=d.revision then e.reason else null end,
    'replacementId',case when e.snapshot_revision=d.enrollment_snapshot_revision and e.draft_revision=d.revision then e.replacement_id else null end) order by a.created_at,a.id),'[]'::jsonb)
    into items from private.enrollment_attachments a left join lateral(select * from private.registration_review_events
      where attachment_id=a.id and action in ('ACCEPTED','NEEDS_CORRECTION','SUPERSEDED') order by sequence desc limit 1) e on true where a.draft_id=d.id;
  return jsonb_build_object('draftId',d.id,'snapshotRevision',d.enrollment_snapshot_revision,'items',items);
end; $$;
create function private.registration_review_change(p_draft uuid,p_key uuid,p_draft_revision integer,p_snapshot integer,p_review_revision integer,
  p_action text,p_attachment uuid,p_reason text,p_replacement uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; actor uuid; previous private.registration_review_events; current_revision integer; a private.enrollment_attachments;
  state jsonb; seal private.enrollment_prerequisite_receipts; event_id uuid:=gen_random_uuid();
begin
  actor:=private.registration_reviewer_id();
  if actor is null then raise exception using errcode='AG403',message='REVIEWER_ACCESS_REQUIRED'; end if;
  if p_key is null or p_draft_revision is null or p_draft_revision<1 or p_snapshot is null or p_snapshot<1 or p_review_revision is null or p_review_revision<0
    or p_action is null or p_action not in ('READ_REQUESTED','ACCEPTED','NEEDS_CORRECTION','SUPERSEDED','APPROVED')
    or (p_action='APPROVED')<>(p_attachment is null) or (p_action='SUPERSEDED')<>(p_replacement is not null)
    or (p_action='NEEDS_CORRECTION' and (p_reason is null or p_reason not in ('BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH')))
    or (p_action<>'NEEDS_CORRECTION' and p_reason is not null) then raise exception using errcode='AG400',message='INVALID_REVIEW'; end if;
  select * into d from app.enrollment_drafts where id=p_draft and created_by<>actor for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(d.tenant_id::text||actor::text||p_key::text,0));
  select * into previous from private.registration_review_events where tenant_id=d.tenant_id and reviewer_id=actor and request_key=p_key;
  if found then
    if previous.draft_id<>p_draft or previous.draft_revision<>p_draft_revision or previous.snapshot_revision<>p_snapshot or previous.expected_review_revision<>p_review_revision
      or previous.action<>p_action or previous.attachment_id is distinct from p_attachment or previous.reason is distinct from p_reason
      or previous.replacement_id is distinct from p_replacement then raise exception using errcode='AG409',message='IDEMPOTENCY_CONFLICT'; end if;
    if p_action='READ_REQUESTED' then
      if d.revision<>p_draft_revision or d.enrollment_snapshot_revision<>p_snapshot then raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
      select * into a from private.enrollment_attachments where id=p_attachment and draft_id=d.id and status='STAGED';
      if not found then raise exception using errcode='AG404',message='ATTACHMENT_NOT_FOUND'; end if;
      return to_jsonb(a);
    end if;
    return private.registration_review_read(d.id);
  end if;
  select count(*)::integer into current_revision from private.registration_review_events where draft_id=d.id and action<>'READ_REQUESTED';
  if d.revision<>p_draft_revision or d.enrollment_snapshot_revision<>p_snapshot or current_revision<>p_review_revision then raise exception using errcode='AG409',message='REVIEW_CHANGED'; end if;
  if p_action<>'READ_REQUESTED' and exists(select 1 from private.enrollment_submissions where draft_id=d.id) then raise exception using errcode='AG409',message='SUBMITTED_DRAFT_LOCKED'; end if;
  if p_attachment is not null then
    select * into a from private.enrollment_attachments where id=p_attachment and draft_id=d.id and status='STAGED';
    if not found then raise exception using errcode='AG404',message='ATTACHMENT_NOT_FOUND'; end if;
    if p_action in ('ACCEPTED','NEEDS_CORRECTION') and exists(select 1 from private.registration_review_events e where e.attachment_id=a.id
      and e.snapshot_revision=p_snapshot and e.action='SUPERSEDED') then raise exception using errcode='AG409',message='EVIDENCE_SUPERSEDED'; end if;
    if p_action in ('ACCEPTED','NEEDS_CORRECTION') and not exists(select 1 from private.registration_review_events e where e.draft_id=d.id
      and e.attachment_id=a.id and e.reviewer_id=actor and e.action='READ_REQUESTED' and e.snapshot_revision=p_snapshot and e.draft_revision=p_draft_revision)
      then raise exception using errcode='AG409',message='INSPECTION_REQUIRED'; end if;
    if p_action='SUPERSEDED' then
      if p_attachment=p_replacement or not exists(select 1 from private.enrollment_attachments r where r.id=p_replacement and r.draft_id=d.id and r.kind=a.kind and r.status='STAGED')
        or exists(select 1 from private.registration_review_events e where e.draft_id=d.id and e.action='SUPERSEDED'
          and e.snapshot_revision=p_snapshot and (e.attachment_id=p_replacement or e.replacement_id=p_attachment)) then
        raise exception using errcode='AG409',message='INVALID_REPLACEMENT'; end if;
    end if;
  else
    state:=private.registration_review_read(d.id);
    if not (state->>'canApprove')::boolean then raise exception using errcode='AG409',message='REVIEW_PREREQUISITES_REQUIRED'; end if;
  end if;
  insert into private.registration_review_events(id,tenant_id,draft_id,reviewer_id,request_key,draft_revision,snapshot_revision,expected_review_revision,action,attachment_id,reason,replacement_id)
    values(event_id,d.tenant_id,d.id,actor,p_key,p_draft_revision,p_snapshot,p_review_revision,p_action,p_attachment,p_reason,p_replacement);
  if d.enrollment_mode='PRODUCTION' and p_action<>'READ_REQUESTED' then
    select * into seal from private.enrollment_prerequisite_receipts where draft_id=d.id and code='SEALS' order by sequence desc limit 1;
    -- Approval validity inherits the existing trusted seal confirmation; this
    -- component never invents a physical-inspection result or a payment receipt.
    insert into private.enrollment_prerequisite_receipts(tenant_id,draft_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,code,accepted,trusted_reference,expires_at)
      select d.tenant_id,d.id,d.revision,d.owner_generation,coalesce((select revision from private.draft_seal_packages where draft_id=d.id),0),
        d.enrollment_snapshot_revision,c,p_action='APPROVED','REVIEW:'||event_id::text,
        case when p_action='APPROVED' then seal.expires_at else now()+interval '1 second' end
        from unnest(array['PRODUCTION_EVIDENCE','REVIEW_POLICY']) c;
  end if;
  if p_action='READ_REQUESTED' then return to_jsonb(a); end if;
  return private.registration_review_read(d.id);
end; $$;
alter function private.registration_reviewer_id() owner to autoguardian_review_executor;
alter function private.registration_review_read(uuid) owner to autoguardian_review_executor;
alter function private.registration_review_queue(integer,integer) owner to autoguardian_review_executor;
alter function private.registration_review_feedback(uuid) owner to autoguardian_review_executor;
alter function private.registration_review_change(uuid,uuid,integer,integer,integer,text,uuid,text,uuid) owner to autoguardian_review_executor;
revoke create on schema private from autoguardian_review_executor;
grant execute on function private.enrollment_draft_json(app.enrollment_drafts) to autoguardian_review_executor;
revoke all on function private.registration_reviewer_id(),private.registration_review_read(uuid),private.registration_review_queue(integer,integer),
  private.registration_review_feedback(uuid),private.registration_review_change(uuid,uuid,integer,integer,integer,text,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.registration_review_read(uuid),private.registration_review_queue(integer,integer),
  private.registration_review_feedback(uuid),private.registration_review_change(uuid,uuid,integer,integer,integer,text,uuid,text,uuid) to autoguardian_enrollment_api;
commit;
