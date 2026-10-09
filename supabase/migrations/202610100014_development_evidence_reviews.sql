-- Development agent self-review only. Never production approval or activation.
begin;
create table private.development_evidence_reviews (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  draft_id uuid not null, attachment_id uuid not null references private.enrollment_attachments(id),
  organization_id uuid not null, agent_user_id uuid not null, request_key uuid not null,
  draft_revision integer not null check(draft_revision>0),
  review_revision integer not null check(review_revision>0),
  decision text not null check(decision in ('ACCEPTED_SAMPLE','NEEDS_CORRECTION')),
  reason text check(reason in ('BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH')),
  created_at timestamptz not null default now(),
  check((decision='ACCEPTED_SAMPLE' and reason is null) or (decision='NEEDS_CORRECTION' and reason is not null)),
  unique(tenant_id,agent_user_id,request_key), unique(attachment_id,review_revision),
  foreign key(tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key(tenant_id,organization_id) references app.organizations(tenant_id,id),
  foreign key(tenant_id,agent_user_id) references app.users(tenant_id,id)
);
alter table private.development_evidence_reviews enable row level security;
alter table private.development_evidence_reviews force row level security;
revoke all on private.development_evidence_reviews from public,anon,authenticated,service_role,autoguardian_enrollment_api;
grant select,insert on private.development_evidence_reviews to autoguardian_enrollment_executor;
create policy evidence_reviews_read on private.development_evidence_reviews for select to autoguardian_enrollment_executor
  using(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=development_evidence_reviews.draft_id and d.status='DRAFT'));
create policy evidence_reviews_append on private.development_evidence_reviews for insert to autoguardian_enrollment_executor
  with check(tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d join private.enrollment_attachments a on a.draft_id=d.id
      where d.id=development_evidence_reviews.draft_id and d.status='DRAFT'
        and d.revision=development_evidence_reviews.draft_revision
        and a.id=development_evidence_reviews.attachment_id and a.status='STAGED'));

create function private.development_evidence_reviews_read(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; result jsonb;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('attachmentId',a.id,'kind',a.kind,'uploadStatus',a.status,
    'reviewRevision',coalesce(r.review_revision,0),
    'decision',case when r.draft_revision=d.revision then r.decision else 'NOT_REVIEWED' end,
    'reason',case when r.draft_revision=d.revision then r.reason else null end,
    'reviewedAt',case when r.draft_revision=d.revision then r.created_at else null end)
    order by a.created_at,a.id),'[]'::jsonb) into result
    from private.enrollment_attachments a left join lateral
      (select * from private.development_evidence_reviews where attachment_id=a.id order by review_revision desc limit 1) r on true
    where a.draft_id=d.id;
  return jsonb_build_object('version',1,'draftId',d.id,'draftRevision',d.revision,'items',result,
    'sampleOnly',true,'productionApproved',false,'canSubmit',false);
end; $$;

create function private.save_development_evidence_review(p_draft uuid,p_attachment uuid,p_key uuid,
  p_expected_draft integer,p_expected_review integer,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; a private.enrollment_attachments; actor uuid;
  previous private.development_evidence_reviews; last_revision integer;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  actor:=private.enrollment_agent_id(d.organization_id);
  if p_key is null or p_expected_draft is null or p_expected_draft<1
    or p_expected_review is null or p_expected_review<0 or p_expected_review>=2147483647
    or p_decision is null or p_decision not in ('ACCEPTED_SAMPLE','NEEDS_CORRECTION')
    or (p_decision='ACCEPTED_SAMPLE' and p_reason is not null)
    or (p_decision='NEEDS_CORRECTION' and (p_reason is null or p_reason not in ('BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH'))) then
    raise exception using errcode='AG400',message='INVALID_EVIDENCE_REVIEW'; end if;
  perform pg_advisory_xact_lock(hashtextextended(d.tenant_id::text||actor::text||p_key::text,0));
  select * into previous from private.development_evidence_reviews where tenant_id=d.tenant_id
    and agent_user_id=actor and request_key=p_key;
  if found then
    if previous.draft_id<>d.id or previous.attachment_id<>p_attachment
      or previous.draft_revision<>p_expected_draft or previous.review_revision<>p_expected_review+1
      or previous.decision<>p_decision or previous.reason is distinct from p_reason then
      raise exception using errcode='AG409',message='IDEMPOTENCY_CONFLICT'; end if;
    return private.development_evidence_reviews_read(d.id);
  end if;
  if d.revision<>p_expected_draft then raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  select * into a from private.enrollment_attachments where id=p_attachment and draft_id=d.id;
  if not found then raise exception using errcode='AG404',message='ATTACHMENT_NOT_FOUND'; end if;
  if a.status<>'STAGED' then raise exception using errcode='AG409',message='EVIDENCE_NOT_STAGED'; end if;
  select coalesce(max(review_revision),0) into last_revision from private.development_evidence_reviews where attachment_id=a.id;
  if last_revision<>p_expected_review then raise exception using errcode='AG409',message='REVIEW_CHANGED'; end if;
  insert into private.development_evidence_reviews(tenant_id,draft_id,attachment_id,organization_id,agent_user_id,
    request_key,draft_revision,review_revision,decision,reason)
    values(d.tenant_id,d.id,a.id,d.organization_id,actor,p_key,d.revision,last_revision+1,p_decision,p_reason);
  return private.development_evidence_reviews_read(d.id);
end; $$;
grant create on schema private to autoguardian_enrollment_executor;
alter function private.development_evidence_reviews_read(uuid) owner to autoguardian_enrollment_executor;
alter function private.save_development_evidence_review(uuid,uuid,uuid,integer,integer,text,text) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.development_evidence_reviews_read(uuid),
  private.save_development_evidence_review(uuid,uuid,uuid,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function private.development_evidence_reviews_read(uuid),
  private.save_development_evidence_review(uuid,uuid,uuid,integer,integer,text,text) to autoguardian_enrollment_api;
commit;
