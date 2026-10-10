-- Run once as postgres after 015. No existing sample is promoted or activated.
begin;
alter table app.enrollment_drafts add column enrollment_mode text not null default 'DEVELOPMENT'
  check (enrollment_mode in ('DEVELOPMENT','PRODUCTION'));
alter table app.enrollment_drafts add column enrollment_snapshot_revision integer not null default 1 check(enrollment_snapshot_revision>0);
-- Only a future trusted production enrollment entrypoint can create production
-- drafts. The existing development API cannot change this column.
create table private.enrollment_prerequisite_receipts (
  sequence bigint generated always as identity primary key,
  tenant_id uuid not null, draft_id uuid not null,
  draft_revision integer not null check (draft_revision>0),
  owner_generation integer not null check (owner_generation>0),
  fitting_revision integer not null check (fitting_revision>=0),
  snapshot_revision integer not null check (snapshot_revision>0),
  code text not null check (code in ('AGENT_AUTHENTICATION','OWNER_PHONE','CONSENT','PRODUCTION_EVIDENCE','SEALS','PAYMENT','REVIEW_POLICY')),
  accepted boolean not null, trusted_reference text not null check (length(btrim(trusted_reference)) between 1 and 200),
  issued_at timestamptz not null default now(), expires_at timestamptz not null check (expires_at>issued_at),
  foreign key (tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id)
);
-- No writer grants: samples, browser claims and the enrollment runtime cannot
-- manufacture confirmation. Future provider/reviewer integrations need their
-- own reviewed, narrowly authorized receipt-writing functions.
create table private.enrollment_submissions (
  draft_id uuid primary key, tenant_id uuid not null, organization_id uuid not null, agent_user_id uuid not null,
  draft_revision integer not null, owner_generation integer not null, fitting_revision integer not null,
  snapshot_revision integer not null,
  submit_key uuid not null, finalize_key uuid,
  status text not null check (status in ('SUBMITTED','ACTIVE')),
  vehicle_id uuid, submitted_at timestamptz not null default now(), activated_at timestamptz,
  unique (tenant_id,agent_user_id,submit_key), unique (tenant_id,agent_user_id,finalize_key),
  unique (vehicle_id),
  check ((status='ACTIVE')=(vehicle_id is not null and finalize_key is not null and activated_at is not null)),
  foreign key (tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key (tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key (tenant_id,agent_user_id) references app.users(tenant_id,id),
  foreign key (tenant_id,vehicle_id) references app.vehicles(tenant_id,id)
);
create table private.enrollment_finalization_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, draft_id uuid not null,
  agent_user_id uuid not null, action text not null check(action in ('SUBMITTED','ACTIVATED')),
  vehicle_id uuid, receipt_sequences bigint[] not null, created_at timestamptz not null default now(),
  foreign key(tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key(tenant_id,agent_user_id) references app.users(tenant_id,id),
  foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id),
  unique(draft_id,action)
);
alter table private.enrollment_prerequisite_receipts enable row level security;
alter table private.enrollment_prerequisite_receipts force row level security;
alter table private.enrollment_submissions enable row level security;
alter table private.enrollment_submissions force row level security;
alter table private.enrollment_finalization_events enable row level security;
alter table private.enrollment_finalization_events force row level security;
revoke all on private.enrollment_prerequisite_receipts,private.enrollment_submissions,private.enrollment_finalization_events
  from public,anon,authenticated,service_role,autoguardian_enrollment_api;
grant select on private.enrollment_prerequisite_receipts to autoguardian_enrollment_executor;
grant select,insert,update on private.enrollment_submissions to autoguardian_enrollment_executor;
grant insert on private.enrollment_finalization_events to autoguardian_enrollment_executor;
create policy prerequisite_scope on private.enrollment_prerequisite_receipts for select to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_id));
create policy submission_scope on private.enrollment_submissions to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id))
  with check(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_id and d.enrollment_mode='PRODUCTION'));
create policy finalization_event_append on private.enrollment_finalization_events for insert to autoguardian_enrollment_executor
  with check(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(null)
    and exists(select 1 from app.enrollment_drafts d where d.id=draft_id and d.enrollment_mode='PRODUCTION'));
grant select(id,tenant_id,user_id,deleted_at) on private.owners to autoguardian_enrollment_executor;
create policy finalization_owner_read on private.owners for select to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and deleted_at is null
    and exists(select 1 from app.enrollment_drafts d where d.owner_profile_id=owners.user_id));
create policy finalization_owner_role_read on app.role_assignments for select to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and role_code='OWNER' and organization_id is null
    and exists(select 1 from app.enrollment_drafts d where d.owner_profile_id=role_assignments.user_id));
grant insert on app.vehicles,app.ownerships to autoguardian_enrollment_executor;
grant select(id) on app.vehicles to autoguardian_enrollment_executor;
grant update(id) on app.vehicles to autoguardian_enrollment_executor;
grant select(tenant_id,vehicle_id,end_at,deleted_at) on app.ownerships to autoguardian_enrollment_executor;
create policy finalization_vehicle_lock on app.vehicles for update to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from private.enrollment_submissions s where s.vehicle_id=vehicles.id))
  with check(tenant_id=private.request_tenant_id() and exists(select 1 from private.enrollment_submissions s where s.vehicle_id=vehicles.id));
create policy finalization_ownership_read on app.ownerships for select to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and exists(select 1 from private.enrollment_submissions s where s.vehicle_id=ownerships.vehicle_id));
create policy finalization_vehicle_append on app.vehicles for insert to autoguardian_enrollment_executor
  with check(tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(null)
    and record_status='ACTIVE' and sale_status='NOT_FOR_SALE' and deleted_at is null
    and exists(select 1 from app.enrollment_drafts d join private.enrollment_submissions s on s.draft_id=d.id
      where d.enrollment_mode='PRODUCTION' and d.chassis_identifier=vehicles.chassis_identifier and s.status='SUBMITTED'));
create policy finalization_ownership_append on app.ownerships for insert to autoguardian_enrollment_executor
  with check(tenant_id=private.request_tenant_id() and created_by=private.enrollment_agent_id(null)
    and source='ENROLLMENT' and end_at is null and deleted_at is null
    and exists(select 1 from private.owners o where o.id=owner_id));

create function private.enrollment_submission_status(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; s private.enrollment_submissions; fitting jsonb; checks jsonb; owner_ok boolean; evidence_ok boolean; locations_ok boolean;
begin
  select * into d from app.enrollment_drafts where id=p_draft for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select * into s from private.enrollment_submissions where draft_id=d.id;
  fitting:=private.draft_seal_fitting_read(d.id);
  evidence_ok:=coalesce((private.enrollment_evidence_checklist(d.id)->>'complete')::boolean,false);
  locations_ok:=coalesce((private.draft_seal_locations_read(d.id)->>'complete')::boolean,false);
  owner_ok:=exists(select 1 from private.owners o join app.role_assignments r on r.tenant_id=o.tenant_id and r.user_id=o.user_id
    where o.user_id=d.owner_profile_id and o.tenant_id=d.tenant_id and o.deleted_at is null
      and r.role_code='OWNER' and r.organization_id is null and r.deleted_at is null and r.valid_from<=now()
      and (r.valid_to is null or r.valid_to>now())
      and exists(select 1 from app.users u where u.id=o.user_id))
    and (select count(*) from private.owners o where o.tenant_id=d.tenant_id and o.user_id=d.owner_profile_id and o.deleted_at is null)=1;
  select jsonb_agg(jsonb_build_object('code',c.code,'status',case
    when c.code='PRODUCTION_EVIDENCE' and not evidence_ok then 'MISSING'
    when c.code='SEALS' and (not coalesce((fitting->>'sealDraftComplete')::boolean,false) or not locations_ok) then 'MISSING'
    when r.sequence is null then 'MISSING'
    when r.draft_revision<>d.revision or r.owner_generation<>d.owner_generation
      or r.fitting_revision<>(fitting->>'fittingRevision')::integer or r.snapshot_revision<>d.enrollment_snapshot_revision then 'STALE'
    when not r.accepted then 'REJECTED'
    when r.issued_at>now() or r.expires_at<=now() then 'EXPIRED'
    else 'COMPLETE' end) order by c.ordinal) into checks
  from unnest(array['AGENT_AUTHENTICATION','OWNER_PHONE','CONSENT','PRODUCTION_EVIDENCE','SEALS','PAYMENT','REVIEW_POLICY'])
    with ordinality c(code,ordinal)
  left join lateral (select * from private.enrollment_prerequisite_receipts r where r.draft_id=d.id and r.code=c.code
    order by r.sequence desc limit 1) r on true;
  return jsonb_build_object('draftId',d.id,'draftRevision',d.revision,'ownerGeneration',d.owner_generation,
    'fittingRevision',(fitting->>'fittingRevision')::integer,'snapshotRevision',d.enrollment_snapshot_revision,
    'mode',d.enrollment_mode,'status',coalesce(s.status,'DRAFT'),
    'ownerReady',owner_ok,'checks',checks,'vehicleId',s.vehicle_id,
    'canSubmit',d.enrollment_mode='PRODUCTION' and s.draft_id is null and owner_ok
      and not exists(select 1 from jsonb_array_elements(checks) c where c->>'status'<>'COMPLETE'),
    'canFinalize',coalesce(d.enrollment_mode='PRODUCTION' and s.status='SUBMITTED' and owner_ok
      and s.draft_revision=d.revision and s.owner_generation=d.owner_generation
      and s.fitting_revision=(fitting->>'fittingRevision')::integer
      and s.snapshot_revision=d.enrollment_snapshot_revision
      and not exists(select 1 from jsonb_array_elements(checks) c where c->>'status'<>'COMPLETE'),false));
end; $$;

create function private.enrollment_submit(p_draft uuid,p_key uuid,p_revision integer,p_snapshot integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; s private.enrollment_submissions; state jsonb; refs bigint[];
begin
  if p_key is null or p_revision is null or p_revision<1 or p_snapshot is null or p_snapshot<1 then raise exception using errcode='AG400',message='INVALID_SUBMISSION'; end if;
  select * into d from app.enrollment_drafts where id=p_draft for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select * into s from private.enrollment_submissions where draft_id=d.id;
  if found then
    if s.submit_key<>p_key or s.draft_revision<>p_revision or s.snapshot_revision<>p_snapshot then raise exception using errcode='AG409',message='SUBMISSION_CONFLICT'; end if;
    return private.enrollment_submission_status(d.id);
  end if;
  if d.revision<>p_revision or d.enrollment_snapshot_revision<>p_snapshot then raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  state:=private.enrollment_submission_status(d.id);
  if not (state->>'canSubmit')::boolean then return jsonb_build_object('blocked',true,'submission',state); end if;
  select array_agg(sequence) into refs from (select distinct on(code) code,sequence from private.enrollment_prerequisite_receipts
    where draft_id=d.id order by code,sequence desc) r;
  insert into private.enrollment_submissions(draft_id,tenant_id,organization_id,agent_user_id,draft_revision,owner_generation,
    fitting_revision,snapshot_revision,submit_key,status) values(d.id,d.tenant_id,d.organization_id,d.created_by,d.revision,d.owner_generation,
    (state->>'fittingRevision')::integer,d.enrollment_snapshot_revision,p_key,'SUBMITTED');
  insert into private.enrollment_finalization_events(tenant_id,draft_id,agent_user_id,action,receipt_sequences)
    values(d.tenant_id,d.id,d.created_by,'SUBMITTED',refs);
  return private.enrollment_submission_status(d.id);
end; $$;

create function private.enrollment_finalize(p_draft uuid,p_key uuid,p_revision integer,p_snapshot integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; s private.enrollment_submissions; state jsonb; owner_id uuid; v uuid; refs bigint[]; fitting jsonb;
begin
  if p_key is null or p_revision is null or p_revision<1 or p_snapshot is null or p_snapshot<1 then raise exception using errcode='AG400',message='INVALID_SUBMISSION'; end if;
  select * into d from app.enrollment_drafts where id=p_draft for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select * into s from private.enrollment_submissions where draft_id=d.id for update;
  if not found then raise exception using errcode='AG409',message='SUBMISSION_REQUIRED'; end if;
  if s.status='ACTIVE' then
    if s.finalize_key<>p_key or s.draft_revision<>p_revision or s.snapshot_revision<>p_snapshot then raise exception using errcode='AG409',message='FINALIZATION_CONFLICT'; end if;
    return private.enrollment_submission_status(d.id);
  end if;
  if d.revision<>p_revision or d.enrollment_snapshot_revision<>p_snapshot then raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  state:=private.enrollment_submission_status(d.id);
  if not coalesce((state->>'canFinalize')::boolean,false) then return jsonb_build_object('blocked',true,'submission',state); end if;
-- Serialize competing finalizers. Global chassis uniqueness is also enforced by
  -- the core unique index. Plates use the existing provisional tenant rule.
  perform pg_advisory_xact_lock(hashtextextended('chassis:'||d.chassis_identifier,0));
  if d.plate is not null then perform pg_advisory_xact_lock(hashtextextended('plate:'||d.tenant_id::text||':'||d.plate,0)); end if;
  if exists(select 1 from app.vehicles where upper(btrim(chassis_identifier))=d.chassis_identifier
    or (d.plate is not null and tenant_id=d.tenant_id and deleted_at is null and upper(btrim(current_plate))=d.plate)) then
    raise exception using errcode='AG409',message='VEHICLE_ALREADY_REGISTERED';
  end if;
  select id into owner_id from private.owners where tenant_id=d.tenant_id and user_id=d.owner_profile_id and deleted_at is null;
  if owner_id is null then raise exception using errcode='AG409',message='OWNER_NOT_READY'; end if;
  fitting:=private.draft_seal_fitting_read(d.id); v:=gen_random_uuid();
  select array_agg(sequence) into refs from (select distinct on(code) code,sequence from private.enrollment_prerequisite_receipts
    where draft_id=d.id order by code,sequence desc) r;
  insert into app.vehicles(id,tenant_id,chassis_identifier,current_plate,category,make,model,manufacture_year,color,
    record_status,seal_package,created_by) values(v,d.tenant_id,d.chassis_identifier,d.plate,d.category,d.make,d.model,
    d.manufacture_year,d.color,'ACTIVE',fitting->>'package',d.created_by);
  insert into app.ownerships(tenant_id,vehicle_id,owner_id,source,created_by) values(d.tenant_id,v,owner_id,'ENROLLMENT',d.created_by);
  update private.enrollment_submissions set status='ACTIVE',vehicle_id=v,finalize_key=p_key,activated_at=now() where draft_id=d.id;
  insert into private.enrollment_finalization_events(tenant_id,draft_id,agent_user_id,action,vehicle_id,receipt_sequences)
    values(d.tenant_id,d.id,d.created_by,'ACTIVATED',v,refs);
  -- Check the core deferred ACTIVE/ownership invariant while inside the narrow
  -- executor role; the outer runtime API has no direct domain-table access.
  set constraints app.vehicles_require_owner,app.ownerships_require_owner immediate;
  return private.enrollment_submission_status(d.id);
end; $$;

-- Every evidence/fitting/owner mutation already locks its parent draft. Freeze
-- submitted snapshots, and serialize trusted receipt appends with that same lock.
create function private.enrollment_submission_freeze() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if tg_table_name='draft_owner_events' then
    if new.action='READ_REQUESTED' then return new; end if;
  end if;
  if tg_table_name='enrollment_drafts' then target:=old.id; else target:=new.draft_id; end if;
  perform 1 from app.enrollment_drafts where id=target for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if tg_table_name<>'enrollment_prerequisite_receipts' and exists(select 1 from private.enrollment_submissions where draft_id=target) then
    raise exception using errcode='AG409',message='SUBMITTED_DRAFT_LOCKED';
  end if;
  return new;
end; $$;
create trigger submitted_draft_freeze before update on app.enrollment_drafts for each row execute function private.enrollment_submission_freeze();
create trigger submitted_attachment_freeze before insert or update on private.enrollment_attachments for each row execute function private.enrollment_submission_freeze();
create trigger submitted_owner_freeze before insert or update on private.draft_owner_details for each row execute function private.enrollment_submission_freeze();
create trigger submitted_consent_freeze before insert on private.draft_owner_events for each row execute function private.enrollment_submission_freeze();
create trigger prerequisite_append_lock before insert on private.enrollment_prerequisite_receipts for each row execute function private.enrollment_submission_freeze();
-- Fitting/location saves lock the draft, but also freeze their child writes.
create trigger submitted_package_freeze before insert or update on private.draft_seal_packages for each row execute function private.enrollment_submission_freeze();
create trigger submitted_placement_freeze before insert or update on private.draft_seal_placements for each row execute function private.enrollment_submission_freeze();
create trigger submitted_location_freeze before insert or update on private.draft_seal_location_notes for each row execute function private.enrollment_submission_freeze();
create trigger submitted_review_freeze before insert on private.development_evidence_reviews for each row execute function private.enrollment_submission_freeze();
create function private.enrollment_snapshot_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='draft_owner_events' then
    if new.action='READ_REQUESTED' then return new; end if;
  end if;
  update app.enrollment_drafts set enrollment_snapshot_revision=enrollment_snapshot_revision+1 where id=new.draft_id;
  return new;
end; $$;
create trigger attachment_snapshot_changed after insert or update on private.enrollment_attachments for each row execute function private.enrollment_snapshot_changed();
create trigger owner_snapshot_changed after insert or update on private.draft_owner_details for each row execute function private.enrollment_snapshot_changed();
create trigger consent_snapshot_changed after insert on private.draft_owner_events for each row execute function private.enrollment_snapshot_changed();
create trigger package_snapshot_changed after insert or update on private.draft_seal_packages for each row execute function private.enrollment_snapshot_changed();
create trigger placement_snapshot_changed after insert or update on private.draft_seal_placements for each row execute function private.enrollment_snapshot_changed();
create trigger location_snapshot_changed after insert or update on private.draft_seal_location_notes for each row execute function private.enrollment_snapshot_changed();
create trigger review_snapshot_changed after insert on private.development_evidence_reviews for each row execute function private.enrollment_snapshot_changed();

grant create on schema private to autoguardian_enrollment_executor;
alter function private.enrollment_submission_status(uuid) owner to autoguardian_enrollment_executor;
alter function private.enrollment_submit(uuid,uuid,integer,integer) owner to autoguardian_enrollment_executor;
alter function private.enrollment_finalize(uuid,uuid,integer,integer) owner to autoguardian_enrollment_executor;
alter function private.enrollment_submission_freeze() owner to autoguardian_enrollment_executor;
alter function private.enrollment_snapshot_changed() owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_submission_status(uuid),private.enrollment_submit(uuid,uuid,integer,integer),
  private.enrollment_finalize(uuid,uuid,integer,integer),private.enrollment_submission_freeze(),private.enrollment_snapshot_changed() from public,anon,authenticated,service_role;
grant execute on function private.enrollment_submission_status(uuid),private.enrollment_submit(uuid,uuid,integer,integer),
  private.enrollment_finalize(uuid,uuid,integer,integer) to autoguardian_enrollment_api;
commit;
