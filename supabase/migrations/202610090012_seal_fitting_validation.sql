-- Development fitting records only. No seal authenticity or physical inspection claim.
begin;

-- An assigned seal may still be reserved by its previous agent after reallocation.
-- Allow executor SELECT for that assigned stock so checks cannot report it free.
-- Runtime table grants remain denied; write policies and draft access are unchanged.
create policy assigned_stock_reservation_read on private.draft_seal_placements for select
  to autoguardian_enrollment_executor using(tenant_id=private.request_tenant_id()
    and exists(select 1 from private.development_seal_stock s where s.id=draft_seal_placements.seal_id));

create function private.draft_seal_validation(p_draft uuid,p_package text,p_placements jsonb,p_current boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; item jsonb; s private.development_seal_stock;
  a private.enrollment_attachments; slot_issues jsonb; slots jsonb:='[]'; issues jsonb:='[]';
  pos integer; alarms integer; standards integer; ready boolean:=true;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if (p_package is not null and p_package not in ('NONE','STANDARD','ONE_ALARM','FOUR_ALARMS'))
    or jsonb_typeof(p_placements) is distinct from 'array' then
    raise exception using errcode='AG400',message='INVALID_SEAL_FITTING'; end if;
  if jsonb_array_length(p_placements)>4 or (p_package='NONE' and jsonb_array_length(p_placements)<>0)
    or exists(select 1 from jsonb_array_elements(p_placements) x where jsonb_typeof(x) is distinct from 'object'
      or not(x ?& array['position','sealCode','photoId'])
      or jsonb_typeof(x->'position') is distinct from 'number' or (x->>'position') !~ '^[1-4]$'
      or jsonb_typeof(x->'sealCode') is distinct from 'string' or (x->>'sealCode') !~ '^DEV-SEAL-[A-Z0-9-]{1,40}$'
      or (x->'photoId'<>'null'::jsonb and (jsonb_typeof(x->'photoId') is distinct from 'string'
        or (x->>'photoId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')))
    or (select count(distinct x->>'position') from jsonb_array_elements(p_placements) x)<>jsonb_array_length(p_placements) then
    raise exception using errcode='AG400',message='INVALID_SEAL_FITTING'; end if;
  -- Same draft/stock lock order as saving; validation makes no reservations or events.
  perform id from private.development_seal_stock where organization_id=d.organization_id
    and code in(select x->>'sealCode' from jsonb_array_elements(p_placements) x) order by id for share;
  select count(*) filter(where stock.type='ALARM'),count(*) filter(where stock.type='STANDARD') into alarms,standards
    from jsonb_array_elements(p_placements) x join private.development_seal_stock stock on stock.code=x->>'sealCode'
    and stock.organization_id=d.organization_id;
  if p_package is null then issues:=issues||'"PACKAGE_REQUIRED"'::jsonb;
  elsif not p_current then issues:=issues||'"STALE_FITTING"'::jsonb; end if;
  for pos in 1..4 loop
    slot_issues:='[]';
    if p_package is distinct from 'NONE' then
      select x into item from jsonb_array_elements(p_placements) x where (x->>'position')::integer=pos;
      if item is null then slot_issues:=slot_issues||'"SEAL_REQUIRED"'::jsonb||'"PHOTO_REQUIRED"'::jsonb;
      else
        select * into s from private.development_seal_stock where code=item->>'sealCode' and organization_id=d.organization_id;
        if not found then slot_issues:=slot_issues||'"SEAL_UNAVAILABLE"'::jsonb;
        else
          if s.status='REVOKED' then slot_issues:=slot_issues||'"SEAL_REVOKED"'::jsonb;
          elsif s.status='DESTROYED' then slot_issues:=slot_issues||'"SEAL_DESTROYED"'::jsonb; end if;
          if exists(select 1 from private.draft_seal_placements where seal_id=s.id and released_at is null and draft_id<>d.id) then
            slot_issues:=slot_issues||'"SEAL_RESERVED"'::jsonb; end if;
          if (s.type='ALARM' and alarms>case p_package when 'ONE_ALARM' then 1 when 'FOUR_ALARMS' then 4 else 0 end)
            or (s.type='STANDARD' and standards>case p_package when 'STANDARD' then 4 when 'ONE_ALARM' then 3 else 0 end) then
            slot_issues:=slot_issues||'"PACKAGE_TYPE_MISMATCH"'::jsonb; end if;
        end if;
        if (select count(*) from jsonb_array_elements(p_placements) x where x->>'sealCode'=item->>'sealCode')>1 then
          slot_issues:=slot_issues||'"DUPLICATE_SEAL"'::jsonb; end if;
        if item->>'photoId' is null then slot_issues:=slot_issues||'"PHOTO_REQUIRED"'::jsonb;
        else
          select * into a from private.enrollment_attachments where id=(item->>'photoId')::uuid and draft_id=d.id
            and owner_profile_id=d.owner_profile_id and kind='SEAL_FITTING_PHOTO' and mime_type in ('image/jpeg','image/png');
          if not found then slot_issues:=slot_issues||'"PHOTO_UNAVAILABLE"'::jsonb;
          elsif a.status='PENDING' then slot_issues:=slot_issues||'"PHOTO_PENDING"'::jsonb; end if;
          if (select count(*) from jsonb_array_elements(p_placements) x where x->>'photoId'=item->>'photoId')>1
            or (a.id is not null and exists(select 1 from jsonb_array_elements(p_placements) x
              join private.enrollment_attachments other on other.id=(x->>'photoId')::uuid
              where (x->>'position')::integer<>pos and other.draft_id=d.id and other.sha256=a.sha256)) then
            slot_issues:=slot_issues||'"DUPLICATE_PHOTO"'::jsonb; end if;
        end if;
      end if;
    end if;
    ready:=ready and jsonb_array_length(slot_issues)=0;
    slots:=slots||jsonb_build_object('position',pos,'issues',slot_issues);
  end loop;
  return jsonb_build_object('version',1,'required',p_package is distinct from 'NONE',
    'complete',ready and jsonb_array_length(issues)=0,'physicalVerified',false,'issues',issues,'slots',slots);
end; $$;

create function private.validate_draft_seal_fitting(p_draft uuid,p_expected_draft integer,p_expected_fit integer,
  p_package text,p_placements jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; revision integer;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select h.revision into revision from private.draft_seal_packages h where draft_id=d.id;
  if p_expected_draft is null or p_expected_fit is null or d.revision<>p_expected_draft or coalesce(revision,0)<>p_expected_fit then
    raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  if p_package is null then raise exception using errcode='AG400',message='INVALID_SEAL_FITTING'; end if;
  return jsonb_build_object('draftId',d.id,'draftRevision',d.revision,'fittingRevision',coalesce(revision,0),
    'sealValidation',private.draft_seal_validation(d.id,p_package,p_placements,true));
end; $$;

create or replace function private.draft_seal_fitting_read(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; validation jsonb;
begin
  result:=private.draft_seal_fitting_read_samples(p_draft);
  validation:=private.draft_seal_validation(p_draft,result->>'package',result->'placements',(result->>'current')::boolean);
  return result||jsonb_build_object('sampleDocumentsSaved',private.enrollment_evidence_checklist(p_draft)->'complete',
    'sealDraftComplete',validation->'complete','sealValidation',validation);
end; $$;

-- Preserve the existing atomic stock locks, revision checks and exact-retry handling.
alter function private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb) rename to save_draft_seal_fitting_samples;
revoke all on function private.save_draft_seal_fitting_samples(uuid,uuid,integer,integer,text,jsonb) from autoguardian_enrollment_api;
create function private.save_draft_seal_fitting(p_draft uuid,p_key uuid,p_expected_draft integer,p_expected_fit integer,
  p_package text,p_placements jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; replay boolean;
begin
  perform 1 from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select exists(select 1 from private.draft_seal_events where request_key=p_key) into replay;
  result:=private.save_draft_seal_fitting_samples(p_draft,p_key,p_expected_draft,p_expected_fit,p_package,p_placements);
  if not replay and exists(select 1 from jsonb_array_elements(result->'sealValidation'->'slots') slot
    where slot->'issues' ? 'DUPLICATE_PHOTO') then
    raise exception using errcode='AG400',message='DUPLICATE_FITTING_PHOTO'; end if;
  return result;
end; $$;

alter function private.enrollment_readiness(uuid) rename to enrollment_readiness_evidence;
revoke all on function private.enrollment_readiness_evidence(uuid) from autoguardian_enrollment_api;
create function private.enrollment_readiness(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return private.enrollment_readiness_evidence(p_draft)||jsonb_build_object('sealValidation',
    private.draft_seal_fitting_read(p_draft)->'sealValidation');
end; $$;

grant create on schema private to autoguardian_enrollment_executor;
alter function private.draft_seal_validation(uuid,text,jsonb,boolean) owner to autoguardian_enrollment_executor;
alter function private.validate_draft_seal_fitting(uuid,integer,integer,text,jsonb) owner to autoguardian_enrollment_executor;
alter function private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb) owner to autoguardian_enrollment_executor;
alter function private.enrollment_readiness(uuid) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.draft_seal_validation(uuid,text,jsonb,boolean),
  private.validate_draft_seal_fitting(uuid,integer,integer,text,jsonb),
  private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb),private.enrollment_readiness(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.validate_draft_seal_fitting(uuid,integer,integer,text,jsonb),
  private.save_draft_seal_fitting(uuid,uuid,integer,integer,text,jsonb),private.enrollment_readiness(uuid)
  to autoguardian_enrollment_api;
commit;
