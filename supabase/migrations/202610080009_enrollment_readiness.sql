-- Run once as postgres after 008. Read-only development checklist, not activation.
begin;
create function private.enrollment_readiness(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; fitting jsonb; checks jsonb; owner_ok boolean;
  identity_saved boolean; registration_saved boolean; photo_saved boolean;
begin
  -- Hold the draft stable while reading its saved evidence and fitting.
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  owner_ok:=exists(select 1 from private.development_enrollment_owners o
    join app.users u on u.tenant_id=o.tenant_id and u.id=o.user_id
    where o.tenant_id=d.tenant_id and o.organization_id=d.organization_id and o.user_id=d.owner_profile_id);
  select exists(select 1 from private.enrollment_attachments where draft_id=d.id and owner_profile_id=d.owner_profile_id and kind='OWNER_ID' and status='STAGED'),
    exists(select 1 from private.enrollment_attachments where draft_id=d.id and owner_profile_id=d.owner_profile_id and kind='REGISTRATION_DOCUMENT' and status='STAGED'),
    exists(select 1 from private.enrollment_attachments where draft_id=d.id and owner_profile_id=d.owner_profile_id and kind='VEHICLE_PHOTO' and status='STAGED')
    into identity_saved,registration_saved,photo_saved;
  fitting:=private.draft_seal_fitting_read(d.id);
  checks:=jsonb_build_array(
    jsonb_build_object('code','VEHICLE_DRAFT','status','COMPLETE'),
    jsonb_build_object('code','OWNER_SELECTION','status',case when owner_ok then 'COMPLETE' else 'MISSING' end),
    jsonb_build_object('code','IDENTITY_SAMPLE','status',case when identity_saved then 'COMPLETE' else 'MISSING' end),
    jsonb_build_object('code','REGISTRATION_SAMPLE','status',case when registration_saved then 'COMPLETE' else 'MISSING' end),
    jsonb_build_object('code','VEHICLE_PHOTO_SAMPLE','status',case when photo_saved then 'COMPLETE' else 'MISSING' end),
    jsonb_build_object('code','SEAL_FITTING','status',case
      when (fitting->>'sealDraftComplete')::boolean then 'COMPLETE'
      when fitting->>'package' is not null and not (fitting->>'current')::boolean then 'STALE'
      else 'MISSING' end),
    jsonb_build_object('code','AGENT_AUTHENTICATION','status','UNAVAILABLE'),
    jsonb_build_object('code','OWNER_PHONE','status','UNAVAILABLE'),
    jsonb_build_object('code','CONSENT','status','UNAVAILABLE'),
    jsonb_build_object('code','PRODUCTION_EVIDENCE','status','UNAVAILABLE'),
    jsonb_build_object('code','PAYMENT','status','UNAVAILABLE'),
    jsonb_build_object('code','REVIEW_POLICY','status','UNAVAILABLE'),
    jsonb_build_object('code','FINALIZATION','status','UNAVAILABLE')
  );
  return jsonb_build_object('draftId',d.id,'draftRevision',d.revision,
    'fittingRevision',(fitting->>'fittingRevision')::integer,'package',fitting->'package',
    'vehicle',jsonb_build_object('chassisIdentifier',d.chassis_identifier,'plate',d.plate,'category',d.category),
    'sampleOnly',true,'canSubmit',false,'enrollmentActive',false,'checks',checks);
end;
$$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.enrollment_readiness(uuid) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_readiness(uuid) from public,anon,authenticated,service_role;
grant execute on function private.enrollment_readiness(uuid) to autoguardian_enrollment_api;
commit;
