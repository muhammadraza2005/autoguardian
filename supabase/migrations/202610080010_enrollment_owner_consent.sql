-- Run once as postgres after 009. Synthetic development details and consent only.
begin;
alter table app.enrollment_drafts add column owner_generation integer not null default 1 check(owner_generation>0);
alter table private.enrollment_attachments add column owner_generation integer not null default 1 check(owner_generation>0);

-- Generations prevent old evidence/details from reappearing after switching owners back.
create function private.enrollment_owner_generation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.owner_profile_id is distinct from old.owner_profile_id then new.owner_generation:=old.owner_generation+1; end if;
  return new;
end; $$;
create trigger enrollment_owner_change before update on app.enrollment_drafts
for each row execute function private.enrollment_owner_generation();
create function private.enrollment_attachment_generation() returns trigger language plpgsql set search_path='' as $$
begin
  select owner_generation into new.owner_generation from app.enrollment_drafts where id=new.draft_id;
  return new;
end; $$;
create trigger enrollment_attachment_generation before insert on private.enrollment_attachments
for each row execute function private.enrollment_attachment_generation();
drop policy attachment_executor_scope on private.enrollment_attachments;
create policy attachment_executor_scope on private.enrollment_attachments to autoguardian_enrollment_executor
  using (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=enrollment_attachments.draft_id and d.status='DRAFT'
      and d.owner_profile_id=enrollment_attachments.owner_profile_id and d.owner_generation=enrollment_attachments.owner_generation))
  with check (tenant_id=private.request_tenant_id() and agent_user_id=private.enrollment_agent_id(organization_id)
    and exists(select 1 from app.enrollment_drafts d where d.id=enrollment_attachments.draft_id and d.status='DRAFT'
      and d.owner_profile_id=enrollment_attachments.owner_profile_id and d.owner_generation=enrollment_attachments.owner_generation));

create table private.draft_owner_details (
  draft_id uuid primary key references app.enrollment_drafts(id), tenant_id uuid not null references app.tenants(id),
  owner_generation integer not null check(owner_generation>0),
  ciphertext text not null check(length(ciphertext) between 44 and 16000),
  saved_at timestamptz not null default now(),
  foreign key(tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id)
);
create table private.development_enrollment_consent_documents (
  version text not null, language text not null check(language in ('en','fr')),
  terms_text text not null, data_text text not null, active boolean not null default true,
  primary key(version,language)
);
insert into private.development_enrollment_consent_documents values
 ('sample-2026-10-08-v1','en','Development sample only: I agree to test the enrollment workflow. This is not approved production terms or owner authorization.',
  'Development sample only: I agree to use fictional details to test data collection. This does not authorize real personal data processing or insurer sharing.',true),
 ('sample-2026-10-08-v1','fr','Exemple de développement uniquement : j’accepte de tester le parcours d’enrôlement. Ce texte ne constitue ni des conditions de production approuvées ni une autorisation du propriétaire.',
  'Exemple de développement uniquement : j’accepte d’utiliser des données fictives pour tester la collecte. Ceci n’autorise ni le traitement de données personnelles réelles ni leur partage avec un assureur.',true);
create unique index one_active_development_consent_language on private.development_enrollment_consent_documents(language) where active;
create function private.immutable_development_consent_document() returns trigger language plpgsql set search_path='' as $$
begin
  if new.version is distinct from old.version or new.language is distinct from old.language
    or new.terms_text is distinct from old.terms_text or new.data_text is distinct from old.data_text then
    raise exception using errcode='AG409',message='CONSENT_VERSION_IMMUTABLE';
  end if;
  return new;
end; $$;
create trigger immutable_development_consent_document before update on private.development_enrollment_consent_documents
for each row execute function private.immutable_development_consent_document();
create table private.draft_owner_events (
  sequence bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id), draft_id uuid not null, actor_user_id uuid not null,
  owner_profile_id uuid not null,
  owner_generation integer not null check(owner_generation>0),
  action text not null check(action in ('DETAILS_SAVED','READ_REQUESTED','CONSENT_RECORDED','CONSENT_WITHDRAWN')),
  request_key uuid, request_digest text check(request_digest ~ '^[0-9a-f]{64}$'),
  consent_version text, consent_language text,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,draft_id) references app.enrollment_drafts(tenant_id,id),
  foreign key(tenant_id,actor_user_id) references app.users(tenant_id,id),
  foreign key(tenant_id,owner_profile_id) references app.users(tenant_id,id),
  foreign key(consent_version,consent_language) references private.development_enrollment_consent_documents(version,language),
  unique(tenant_id,request_key),
  check ((action='READ_REQUESTED' and request_key is null and request_digest is null)
    or (action<>'READ_REQUESTED' and request_key is not null and request_digest is not null)),
  check ((action in ('CONSENT_RECORDED','CONSENT_WITHDRAWN') and consent_version is not null and consent_language is not null)
    or (action in ('DETAILS_SAVED','READ_REQUESTED') and consent_version is null and consent_language is null))
);
create index draft_owner_events_lookup on private.draft_owner_events(draft_id,owner_generation,sequence desc);
alter table private.draft_owner_details enable row level security;
alter table private.draft_owner_details force row level security;
alter table private.draft_owner_events enable row level security;
alter table private.draft_owner_events force row level security;
alter table private.development_enrollment_consent_documents enable row level security;
alter table private.development_enrollment_consent_documents force row level security;
revoke all on private.draft_owner_details,private.draft_owner_events,private.development_enrollment_consent_documents from public,anon,authenticated,service_role;
grant select,insert,update on private.draft_owner_details to autoguardian_enrollment_executor;
grant select,insert on private.draft_owner_events to autoguardian_enrollment_executor;
grant usage on sequence private.draft_owner_events_sequence_seq to autoguardian_enrollment_executor;
grant select on private.development_enrollment_consent_documents to autoguardian_enrollment_executor;
create policy draft_owner_details_scope on private.draft_owner_details to autoguardian_enrollment_executor
 using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_owner_details.draft_id))
 with check(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_owner_details.draft_id and d.owner_generation=draft_owner_details.owner_generation));
create policy draft_owner_events_read on private.draft_owner_events for select to autoguardian_enrollment_executor
 using(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d where d.id=draft_owner_events.draft_id));
create policy draft_owner_events_append on private.draft_owner_events for insert to autoguardian_enrollment_executor
 with check(tenant_id=private.request_tenant_id() and exists(select 1 from app.enrollment_drafts d
   where d.id=draft_owner_events.draft_id and d.owner_generation=draft_owner_events.owner_generation
     and d.owner_profile_id=draft_owner_events.owner_profile_id and d.created_by=draft_owner_events.actor_user_id));
create policy development_consent_documents_read on private.development_enrollment_consent_documents for select to autoguardian_enrollment_executor
 using(private.enrollment_agent_id(null) is not null);

-- Internal snapshot. No identity fields appear in list or readiness projections.
create function private.draft_owner_snapshot(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; details private.draft_owner_details; consent private.draft_owner_events; docs jsonb;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for share;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  if not exists(select 1 from private.development_enrollment_owners o join app.users u on u.id=o.user_id and u.tenant_id=o.tenant_id
    where o.organization_id=d.organization_id and o.user_id=d.owner_profile_id) then
    raise exception using errcode='AG422',message='OWNER_PROFILE_UNAVAILABLE'; end if;
  select * into details from private.draft_owner_details where draft_id=d.id and owner_generation=d.owner_generation;
  select e.* into consent from private.draft_owner_events e join private.development_enrollment_consent_documents c
    on c.version=e.consent_version and c.language=e.consent_language and c.active
    where e.draft_id=d.id and e.owner_generation=d.owner_generation and e.action in ('CONSENT_RECORDED','CONSENT_WITHDRAWN')
    order by e.sequence desc limit 1;
  select jsonb_agg(jsonb_build_object('version',version,'language',language,'termsText',terms_text,'dataText',data_text) order by language)
    into docs from private.development_enrollment_consent_documents where active;
  return jsonb_build_object('draftId',d.id,'draftRevision',d.revision,'ownerProfileId',d.owner_profile_id,'ownerGeneration',d.owner_generation,
    'ciphertext',details.ciphertext,'savedAt',details.saved_at,'documents',coalesce(docs,'[]'::jsonb),
    'consent',case when consent.sequence is null then null else jsonb_build_object(
      'status',case when consent.action='CONSENT_RECORDED' then 'RECORDED' else 'WITHDRAWN' end,
      'version',consent.consent_version,'language',consent.consent_language,'recordedAt',consent.created_at,
      'recordedByProfileId',consent.actor_user_id,'source','AGENT_RECORDED_SAMPLE') end,
    'sampleOnly',true,'phoneVerified',false,'productionConsentVerified',false);
end; $$;
create function private.draft_owner_read(p_draft uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.draft_owner_snapshot(p_draft);
  insert into private.draft_owner_events(tenant_id,draft_id,actor_user_id,owner_profile_id,owner_generation,action)
  values(private.request_tenant_id(),p_draft,private.enrollment_agent_id((select organization_id from app.enrollment_drafts where id=p_draft)),
    (result->>'ownerProfileId')::uuid,(result->>'ownerGeneration')::integer,'READ_REQUESTED');
  return result;
end; $$;
create function private.draft_owner_save(p_draft uuid,p_key uuid,p_expected integer,p_digest text,p_ciphertext text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; e private.draft_owner_events;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  perform private.draft_owner_snapshot(p_draft); -- current owner eligibility
  if p_key is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_ciphertext is null or length(p_ciphertext) not between 44 and 16000 then
    raise exception using errcode='AG400',message='INVALID_OWNER_DETAILS'; end if;
  select * into e from private.draft_owner_events where request_key=p_key;
  if found then
    if e.draft_id<>d.id or e.action<>'DETAILS_SAVED' or e.request_digest<>p_digest or e.owner_generation<>d.owner_generation then
      raise exception using errcode='AG409',message='OWNER_CONFLICT'; end if;
    return private.draft_owner_snapshot(p_draft);
  end if;
  if p_expected is distinct from d.revision then raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  update app.enrollment_drafts set owner_generation=owner_generation+1,revision=revision+1,updated_at=now() where id=d.id returning * into d;
  insert into private.draft_owner_details(draft_id,tenant_id,owner_generation,ciphertext) values(d.id,d.tenant_id,d.owner_generation,p_ciphertext)
    on conflict(draft_id) do update set owner_generation=excluded.owner_generation,ciphertext=excluded.ciphertext,saved_at=now();
  insert into private.draft_owner_events(tenant_id,draft_id,actor_user_id,owner_profile_id,owner_generation,action,request_key,request_digest)
    values(d.tenant_id,d.id,d.created_by,d.owner_profile_id,d.owner_generation,'DETAILS_SAVED',p_key,p_digest);
  return private.draft_owner_snapshot(p_draft);
end; $$;
create function private.draft_owner_consent(p_draft uuid,p_key uuid,p_expected integer,p_generation integer,p_digest text,p_version text,p_language text,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.enrollment_drafts; e private.draft_owner_events; action_name text;
begin
  select * into d from app.enrollment_drafts where id=p_draft and status='DRAFT' for update;
  if not found then raise exception using errcode='AG404',message='DRAFT_NOT_FOUND'; end if;
  perform private.draft_owner_snapshot(p_draft);
  if p_key is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_accept is null then
    raise exception using errcode='AG400',message='INVALID_CONSENT'; end if;
  if not exists(select 1 from private.draft_owner_details where draft_id=d.id and owner_generation=d.owner_generation)
    or not exists(select 1 from private.development_enrollment_consent_documents where version=p_version and language=p_language and active) then
    raise exception using errcode='AG409',message='CONSENT_CHANGED'; end if;
  action_name:=case when p_accept then 'CONSENT_RECORDED' else 'CONSENT_WITHDRAWN' end;
  select * into e from private.draft_owner_events where request_key=p_key;
  if found then
    if e.draft_id<>d.id or e.action<>action_name or e.request_digest<>p_digest or e.owner_generation<>d.owner_generation then
      raise exception using errcode='AG409',message='OWNER_CONFLICT'; end if;
    -- A delayed retry cannot re-accept withdrawn consent; return the latest snapshot.
    return private.draft_owner_snapshot(p_draft);
  end if;
  if p_expected is distinct from d.revision or p_generation is distinct from d.owner_generation then
    raise exception using errcode='AG409',message='DRAFT_CHANGED'; end if;
  insert into private.draft_owner_events(tenant_id,draft_id,actor_user_id,owner_profile_id,owner_generation,action,request_key,request_digest,consent_version,consent_language)
    values(d.tenant_id,d.id,d.created_by,d.owner_profile_id,d.owner_generation,action_name,p_key,p_digest,p_version,p_language);
  return private.draft_owner_snapshot(p_draft);
end; $$;

-- Preserve the existing production blockers and add two development-only checks.
alter function private.enrollment_readiness(uuid) rename to enrollment_readiness_samples;
revoke all on function private.enrollment_readiness_samples(uuid) from autoguardian_enrollment_api;
create function private.enrollment_readiness(p_draft uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; d app.enrollment_drafts; details_ok boolean; consent_ok boolean;
begin
  result:=private.enrollment_readiness_samples(p_draft);
  select * into d from app.enrollment_drafts where id=p_draft;
  details_ok:=exists(select 1 from private.draft_owner_details where draft_id=d.id and owner_generation=d.owner_generation);
  select coalesce(e.action='CONSENT_RECORDED',false) into consent_ok from private.draft_owner_events e
    join private.development_enrollment_consent_documents c on c.version=e.consent_version and c.language=e.consent_language and c.active
    where e.draft_id=d.id and e.owner_generation=d.owner_generation and e.action in ('CONSENT_RECORDED','CONSENT_WITHDRAWN')
    order by e.sequence desc limit 1;
  return jsonb_set(result,'{checks}',(result->'checks')||jsonb_build_array(
    jsonb_build_object('code','OWNER_DETAILS_SAMPLE','status',case when details_ok then 'COMPLETE' else 'MISSING' end),
    jsonb_build_object('code','CONSENT_SAMPLE','status',case when details_ok and coalesce(consent_ok,false) then 'COMPLETE' else 'MISSING' end)));
end; $$;

grant create on schema private to autoguardian_enrollment_executor;
alter function private.draft_owner_snapshot(uuid) owner to autoguardian_enrollment_executor;
alter function private.draft_owner_read(uuid) owner to autoguardian_enrollment_executor;
alter function private.draft_owner_save(uuid,uuid,integer,text,text) owner to autoguardian_enrollment_executor;
alter function private.draft_owner_consent(uuid,uuid,integer,integer,text,text,text,boolean) owner to autoguardian_enrollment_executor;
alter function private.enrollment_readiness(uuid) owner to autoguardian_enrollment_executor;
revoke create on schema private from autoguardian_enrollment_executor;
revoke all on function private.enrollment_owner_generation(),private.enrollment_attachment_generation(),private.immutable_development_consent_document(),private.draft_owner_snapshot(uuid),
 private.draft_owner_read(uuid),private.draft_owner_save(uuid,uuid,integer,text,text),
 private.draft_owner_consent(uuid,uuid,integer,integer,text,text,text,boolean),private.enrollment_readiness(uuid) from public,anon,authenticated,service_role;
grant execute on function private.draft_owner_read(uuid),private.draft_owner_save(uuid,uuid,integer,text,text),
 private.draft_owner_consent(uuid,uuid,integer,integer,text,text,text,boolean),private.enrollment_readiness(uuid) to autoguardian_enrollment_api;
commit;
