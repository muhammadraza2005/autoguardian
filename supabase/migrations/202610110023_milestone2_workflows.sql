-- Additive development workflows. No billing, PIN, SMS or USSD bypass is enabled.
begin;
grant create on schema private to autoguardian_check_executor;
grant execute on function private.access_session_valid(boolean) to autoguardian_check_executor;
-- Supabase may store phone digits with or without the leading plus. The
-- immutable auth UUID binds the proof to the existing owner account.
create or replace function private.check_phone_verified() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=private.request_auth_user_id()
    and phone ~ '^\+?[1-9][0-9]{7,14}$' and phone_confirmed_at is not null)
$$;
alter table private.vehicle_check_configuration
  add column max_checks_per_hour integer check(max_checks_per_hour between 1 and 100),
  add column reminder_seconds integer check(reminder_seconds>0 and reminder_seconds<response_seconds),
  add column backup_seconds integer check(backup_seconds>0 and backup_seconds<response_seconds);

create table private.check_alert_jobs (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,request_id uuid not null,
  kind text not null check(kind in ('reminder','backup')),due_at timestamptz not null,
  state text not null default 'pending' check(state in ('pending','recorded','awaiting_configuration','cancelled')),
  unique(request_id,kind),foreign key(tenant_id,request_id) references private.vehicle_check_requests(tenant_id,id)
);
-- Backup dispatch deliberately awaits accepted contact/delegation policy.
create table private.vehicle_reports (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,vehicle_id uuid not null,
  actor_id uuid not null,request_key uuid not null,kind text not null check(kind in ('incident','missing','recovered')),
  occurred_at timestamptz not null,description text not null check(length(description) between 3 and 2000),
  status text not null default 'submitted' check(status in ('submitted','accepted','rejected')),
  created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),unique(tenant_id,actor_id,request_key),
  foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id),
  foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
create table private.vehicle_report_events (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,report_id uuid not null,actor_id uuid not null,
  request_key uuid not null,action text not null check(action in ('submitted','accepted','rejected','evidence_uploaded','evidence_read')),
  reason text,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,actor_id,request_key),
  foreign key(tenant_id,report_id) references private.vehicle_reports(tenant_id,id),
  foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
create table private.vehicle_status_events (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,vehicle_id uuid not null,actor_id uuid not null,
  request_key uuid not null,previous_status text not null,new_status text not null,reason text not null,
  created_at timestamptz not null default clock_timestamp(),unique(tenant_id,actor_id,request_key),
  foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id),
  foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
-- Encrypted, sanitized staged bytes; never returned by buyer lookup. No public bucket.
create table private.vehicle_report_evidence (
  id uuid primary key,tenant_id uuid not null,report_id uuid not null,actor_id uuid not null,request_key uuid not null,
  mime_type text not null check(mime_type in ('image/jpeg','application/pdf')),byte_size integer not null check(byte_size between 1 and 2097152),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),ciphertext text not null check(length(ciphertext) between 44 and 2796300),
  created_at timestamptz not null default clock_timestamp(),unique(tenant_id,actor_id,request_key),
  foreign key(tenant_id,report_id) references private.vehicle_reports(tenant_id,id),
  foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
do $$ declare t text; begin
  foreach t in array array['check_alert_jobs','vehicle_reports','vehicle_report_events','vehicle_status_events','vehicle_report_evidence'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role,autoguardian_identity_login',t);
    execute format('grant select,insert on private.%I to autoguardian_check_executor',t);
    execute format('create policy workflow_read on private.%I for select to autoguardian_check_executor using(tenant_id=private.request_tenant_id())',t);
    execute format('create policy workflow_append on private.%I for insert to autoguardian_check_executor with check(tenant_id=private.request_tenant_id())',t);
  end loop;
end $$;
grant update(state) on private.check_alert_jobs to autoguardian_check_executor;
grant update(status) on private.vehicle_reports to autoguardian_check_executor;
create policy workflow_update on private.check_alert_jobs for update to autoguardian_check_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create policy workflow_update on private.vehicle_reports for update to autoguardian_check_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
grant update(sale_status) on app.vehicles to autoguardian_check_executor;

grant select(tenant_id,id,code,status,origin) on private.development_seal_stock to autoguardian_check_executor;
grant select(tenant_id,seal_id,key_version) on private.production_seal_identifiers to autoguardian_check_executor;
grant select(tenant_id,draft_id,seal_id,released_at) on private.draft_seal_placements to autoguardian_check_executor;
grant select(tenant_id,draft_id,vehicle_id,status) on private.enrollment_submissions to autoguardian_check_executor;
do $$ declare t text; begin
  foreach t in array array['development_seal_stock','production_seal_identifiers','draft_seal_placements','enrollment_submissions'] loop
    execute format('create policy check_lookup on private.%I for select to autoguardian_check_executor using(tenant_id=private.request_tenant_id())',t);
  end loop;
end $$;

-- Wrap creation so ALL channels, including the original operation, share limits.
alter function private.create_vehicle_check(uuid,uuid) rename to create_vehicle_check_unlimited;
revoke execute on function private.create_vehicle_check_unlimited(uuid,uuid) from autoguardian_identity_login;
create function private.create_vehicle_check(p_vehicle uuid,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.vehicle_check_configuration;r private.vehicle_check_requests;result uuid;
begin
  actor:=private.check_actor('VERIFIER');
  select * into c from private.vehicle_check_configuration where sample_enabled;
  if c.tenant_id is null or c.max_checks_per_hour is null then raise exception 'CHECKS_NOT_CONFIGURED' using errcode='23514';end if;
  if p_key is null then raise exception 'CHECK_KEY_REQUIRED' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||actor::text,23));
  select * into r from private.vehicle_check_requests where buyer_id=actor and request_key=p_key;
  if r.id is not null then
    if r.vehicle_id<>p_vehicle then raise exception 'CHECK_KEY_CONFLICT' using errcode='23514';end if;
    return r.id;
  end if;
  if (select count(*) from private.vehicle_check_requests where buyer_id=actor and created_at>clock_timestamp()-interval '1 hour')>=c.max_checks_per_hour then
    raise exception 'CHECK_RATE_LIMIT' using errcode='AG429';end if;
  result:=private.create_vehicle_check_unlimited(p_vehicle,p_key);
  insert into private.check_alert_jobs(tenant_id,request_id,kind,due_at)
    select c.tenant_id,result,k,q.created_at+make_interval(secs=>s)
    from (values('reminder',c.reminder_seconds),('backup',c.backup_seconds)) j(k,s)
      cross join private.vehicle_check_requests q where s is not null and q.id=result;
  return result;
end $$;

create function private.lookup_vehicle_check(p_method text,p_value text,p_version text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare vehicle uuid;matches integer;result uuid;
begin
  perform private.check_actor('VERIFIER');
  if p_method is null or p_method not in ('plate','chassis','seal') or p_value is null or length(btrim(p_value)) not between 1 and 160 or p_value ~ '[[:cntrl:]]' then
    raise exception 'INVALID_CHECK_LOOKUP' using errcode='AG400';end if;
  if p_method='seal' then
    if p_value !~ '^AG[A-F0-9]{32}$' then raise exception 'INVALID_CHECK_LOOKUP' using errcode='AG400';end if;
    select count(distinct v.id),min(v.id::text)::uuid into matches,vehicle
      from private.development_seal_stock s join private.production_seal_identifiers i on i.seal_id=s.id and i.tenant_id=s.tenant_id
      join private.draft_seal_placements p on p.seal_id=s.id and p.tenant_id=s.tenant_id and p.released_at is null
      join private.enrollment_submissions e on e.draft_id=p.draft_id and e.tenant_id=p.tenant_id and e.status='ACTIVE'
      join app.vehicles v on v.id=e.vehicle_id and v.tenant_id=e.tenant_id
      where s.code=p_value and s.origin='PRODUCTION' and s.status='ACTIVE' and (p_version is null or i.key_version=p_version)
        and v.deleted_at is null and v.record_status<>'ARCHIVED';
  else
    select count(*),min(id::text)::uuid into matches,vehicle from app.vehicles where deleted_at is null and record_status<>'ARCHIVED'
      and upper(btrim(case when p_method='plate' then current_plate else chassis_identifier end))=upper(btrim(p_value));
  end if;
  if matches=0 then raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  if matches<>1 then raise exception 'CHECK_AMBIGUOUS_IDENTIFIER' using errcode='AG409';end if;
  result:=private.create_vehicle_check(vehicle,p_key);
  return private.read_vehicle_check(result);
end $$;

create function private.list_vehicle_checks(p_owner boolean,p_cursor uuid,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;items jsonb:='[]';r record;counted integer:=0;next_id uuid;
begin
  actor:=private.check_actor(case when p_owner then 'OWNER' else 'VERIFIER' end);
  if p_owner is null or p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_CHECK_PAGE' using errcode='AG400';end if;
  for r in select q.*,v.current_plate from private.vehicle_check_requests q join app.vehicles v on v.id=q.vehicle_id and v.tenant_id=q.tenant_id
    where (p_cursor is null or q.id>p_cursor) and v.deleted_at is null and v.record_status<>'ARCHIVED'
      and ((not p_owner and q.buyer_id=actor) or (p_owner and q.outcome='pending' and q.response_deadline_at>clock_timestamp()
        and exists(select 1 from private.owners o join app.ownerships s on s.owner_id=o.id and s.tenant_id=o.tenant_id
          where o.id=q.owner_id and o.user_id=actor and o.deleted_at is null and s.id=q.ownership_id and s.end_at is null
            and s.deleted_at is null and s.start_at<=clock_timestamp()))) order by q.id limit p_limit+1 loop
    if counted=p_limit then next_id:=(items->(p_limit-1)->>'id')::uuid;exit;end if;
    counted:=counted+1;
    items:=items||jsonb_build_array(case when p_owner then jsonb_build_object('id',r.id,'vehicleId',r.vehicle_id,'plate',r.current_plate,
      'responseDeadlineAt',r.response_deadline_at,'sampleOnly',true) else private.read_vehicle_check(r.id) end);
  end loop;
  return jsonb_build_object('items',items,'nextCursor',next_id);
end $$;

-- Worker only: no HTTP endpoint. Vehicle -> request -> notifications lock order.
create function private.sweep_vehicle_checks(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare check_row record;alert_job record;timed integer:=0;alerts integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_CHECK_PAGE' using errcode='AG400';end if;
  if not exists(select 1 from app.tenants where status='ACTIVE' and deleted_at is null) then raise exception 'CHECK_ACCESS_DENIED' using errcode='42501';end if;
  update private.check_alert_jobs j set state='cancelled' where state in ('pending','awaiting_configuration') and exists(
    select 1 from private.vehicle_check_requests q where q.id=j.request_id and not exists(
      select 1 from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
        where s.id=q.ownership_id and s.owner_id=q.owner_id and s.end_at is null and s.deleted_at is null
          and s.start_at<=clock_timestamp() and o.deleted_at is null));
  for check_row in select q.id,q.vehicle_id from private.vehicle_check_requests q where q.outcome='pending'
    and (q.response_deadline_at<=clock_timestamp() or exists(select 1 from private.check_alert_jobs j where j.request_id=q.id and j.state='pending' and j.due_at<=clock_timestamp()))
    order by q.response_deadline_at,q.id limit p_limit loop
    perform 1 from app.vehicles where id=check_row.vehicle_id for update skip locked;
    if not found then continue;end if;
    select * into check_row from private.vehicle_check_requests where id=check_row.id for update;
    if check_row.outcome<>'pending' then continue;end if;
    if check_row.response_deadline_at<=clock_timestamp() then
      perform private.finish_vehicle_check(check_row.id,'timed_out',check_row.buyer_id,clock_timestamp());timed:=timed+1;
    else
      for alert_job in select * from private.check_alert_jobs where request_id=check_row.id and state='pending' and due_at<=clock_timestamp() for update loop
        if alert_job.kind='reminder' then
          insert into private.vehicle_check_notifications(tenant_id,request_id,recipient_id,kind,available_at)
            select check_row.tenant_id,check_row.id,o.user_id,'owner_reminder',clock_timestamp() from private.owners o
            join app.ownerships s on s.owner_id=o.id and s.tenant_id=o.tenant_id where o.id=check_row.owner_id and o.deleted_at is null
              and s.id=check_row.ownership_id and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp()
            on conflict(request_id,kind) do nothing;
        end if;
        update private.check_alert_jobs set state=case when alert_job.kind='backup' then 'awaiting_configuration' else 'recorded' end where id=alert_job.id;
        alerts:=alerts+1;
      end loop;
    end if;
  end loop;
  update private.check_alert_jobs j set state='cancelled' where state in ('pending','awaiting_configuration')
    and exists(select 1 from private.vehicle_check_requests r where r.id=j.request_id and (r.outcome<>'pending' or r.response_deadline_at<=clock_timestamp()));
  return jsonb_build_object('timedOut',timed,'alertsRecorded',alerts);
end $$;

create function private.workflow_owner(p_vehicle uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=private.check_actor('OWNER');
  perform 1 from app.vehicles where id=p_vehicle and deleted_at is null and record_status<>'ARCHIVED' for update;
  if not found or not exists(select 1 from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
    where s.vehicle_id=p_vehicle and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp() and o.user_id=actor and o.deleted_at is null) then
    raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  if not exists(select 1 from private.vehicle_check_configuration where sample_enabled) then raise exception 'OWNER_STEP_UP_SETUP_REQUIRED' using errcode='AG403';end if;
  return actor;
end $$;

create function private.change_vehicle_sale(p_vehicle uuid,p_key uuid,p_expected text,p_status text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;previous text;e private.vehicle_status_events;
begin
  actor:=private.workflow_owner(p_vehicle);
  if p_key is null or p_expected is null or p_status is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'INVALID_STATUS_CHANGE' using errcode='AG400';end if;
  select * into e from private.vehicle_status_events where actor_id=actor and request_key=p_key;
  if e.id is not null then
    if (e.vehicle_id,e.previous_status,e.new_status,e.reason) is distinct from (p_vehicle,p_expected,p_status,p_reason) then raise exception 'CHECK_KEY_CONFLICT' using errcode='AG409';end if;
    return jsonb_build_object('eventId',e.id,'saleStatus',e.new_status,'sampleOnly',true);
  end if;
  select sale_status into previous from app.vehicles where id=p_vehicle;
  if previous<>p_expected then raise exception 'STATUS_CHANGED' using errcode='AG409';end if;
  -- AGENT_SALE requires a real accepted mandate, which is not implemented yet.
  if not ((previous='NOT_FOR_SALE' and p_status='FOR_SALE') or (previous in ('FOR_SALE','AGENT_SALE') and p_status='NOT_FOR_SALE')) then
    raise exception 'STATUS_TRANSITION_DENIED' using errcode='AG409';end if;
  update app.vehicles set sale_status=p_status where id=p_vehicle;
  insert into private.vehicle_status_events(tenant_id,vehicle_id,actor_id,request_key,previous_status,new_status,reason)
    values(private.request_tenant_id(),p_vehicle,actor,p_key,previous,p_status,p_reason) returning * into e;
  return jsonb_build_object('eventId',e.id,'saleStatus',p_status,'sampleOnly',true);
end $$;

create function private.submit_vehicle_report(p_vehicle uuid,p_key uuid,p_kind text,p_occurred timestamptz,p_description text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;r private.vehicle_reports;previous text;
begin
  if p_kind is null or p_kind not in ('incident','missing','recovered') or p_key is null or p_occurred is null
    or p_occurred>clock_timestamp() or p_description is null or length(btrim(p_description)) not between 3 and 2000 then raise exception 'INVALID_REPORT' using errcode='AG400';end if;
  if p_kind='incident' then
    actor:=private.check_actor('VERIFIER');
    perform 1 from app.vehicles where id=p_vehicle and deleted_at is null and record_status<>'ARCHIVED' for update;
    if not found or not exists(select 1 from private.vehicle_check_requests where vehicle_id=p_vehicle and buyer_id=actor) then raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  else actor:=private.workflow_owner(p_vehicle);end if;
  perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text||p_key::text,24));
  select * into r from private.vehicle_reports where actor_id=actor and request_key=p_key;
  if r.id is not null then
    if (r.vehicle_id,r.kind,r.occurred_at,r.description) is distinct from (p_vehicle,p_kind,p_occurred,p_description) then raise exception 'CHECK_KEY_CONFLICT' using errcode='AG409';end if;
    return jsonb_build_object('id',r.id,'status',r.status);
  end if;
  select sale_status into previous from app.vehicles where id=p_vehicle;
  if (p_kind='missing' and previous='REPORTED_MISSING') or (p_kind='recovered' and previous<>'REPORTED_MISSING') then raise exception 'STATUS_TRANSITION_DENIED' using errcode='AG409';end if;
  insert into private.vehicle_reports(tenant_id,vehicle_id,actor_id,request_key,kind,occurred_at,description)
    values(private.request_tenant_id(),p_vehicle,actor,p_key,p_kind,p_occurred,p_description) returning * into r;
  insert into private.vehicle_report_events(tenant_id,report_id,actor_id,request_key,action) values(r.tenant_id,r.id,actor,p_key,'submitted');
  if p_kind<>'incident' then
    update app.vehicles set sale_status=case when p_kind='missing' then 'REPORTED_MISSING' else 'NOT_FOR_SALE' end where id=p_vehicle;
    insert into private.vehicle_status_events(tenant_id,vehicle_id,actor_id,request_key,previous_status,new_status,reason)
      values(r.tenant_id,p_vehicle,actor,p_key,previous,case when p_kind='missing' then 'REPORTED_MISSING' else 'NOT_FOR_SALE' end,p_description);
  end if;
  return jsonb_build_object('id',r.id,'status',r.status);
end $$;

create function private.workflow_reviewer() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if not private.access_session_valid(true) then raise exception 'STAFF_MFA_REQUIRED' using errcode='AG403';end if;
  select u.id into actor from app.users u join app.tenants t on t.id=u.tenant_id
    where u.auth_user_id=private.request_auth_user_id() and u.status='ACTIVE' and u.deleted_at is null and t.status='ACTIVE' and t.deleted_at is null
      and exists(select 1 from app.role_assignments a where a.user_id=u.id and a.role_code='TENANT_ADMIN' and a.organization_id is null
        and a.deleted_at is null and a.valid_from<=clock_timestamp() and (a.valid_to is null or a.valid_to>clock_timestamp()));
  if actor is null then raise exception 'STAFF_ACCESS_REQUIRED' using errcode='AG403';end if;
  return actor;
end $$;
create function private.read_vehicle_reports(p_review boolean,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;items jsonb;
begin
  if p_review then actor:=private.workflow_reviewer();else
    select id into actor from app.users where auth_user_id=private.request_auth_user_id() and status='ACTIVE' and deleted_at is null;
    if actor is null or not private.check_phone_verified() then raise exception 'CHECK_ACCESS_DENIED' using errcode='42501';end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'vehicleId',r.vehicle_id,'kind',r.kind,'occurredAt',r.occurred_at,'description',r.description,'status',r.status,'createdAt',r.created_at,
    'evidence',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'mimeType',e.mime_type,'byteSize',e.byte_size)),'[]') from private.vehicle_report_evidence e where e.report_id=r.id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'reason',e.reason,'createdAt',e.created_at) order by e.created_at),'[]') from private.vehicle_report_events e where e.report_id=r.id))), '[]') into items
    from (select * from private.vehicle_reports where (p_id is null or id=p_id) and (actor_id=actor or p_review) order by created_at desc,id limit 50) r;
  if p_id is not null and jsonb_array_length(items)=0 then raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  return jsonb_build_object('items',items);
end $$;
create function private.review_vehicle_report(p_id uuid,p_key uuid,p_status text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;r private.vehicle_reports;e private.vehicle_report_events;
begin
  actor:=private.workflow_reviewer();
  if p_key is null or p_status is null or p_status not in ('accepted','rejected') or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'INVALID_REPORT' using errcode='AG400';end if;
  select * into r from private.vehicle_reports where id=p_id for update;
  if r.id is null then raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  if r.actor_id=actor then raise exception 'INDEPENDENT_REVIEW_REQUIRED' using errcode='AG403';end if;
  select * into e from private.vehicle_report_events where actor_id=actor and request_key=p_key;
  if e.id is not null then
    if (e.report_id,e.action,e.reason) is distinct from(p_id,p_status,p_reason) then raise exception 'CHECK_KEY_CONFLICT' using errcode='AG409';end if;
    return jsonb_build_object('id',p_id,'status',e.action);
  end if;
  if r.status<>'submitted' then raise exception 'REPORT_ALREADY_REVIEWED' using errcode='AG409';end if;
  update private.vehicle_reports set status=p_status where id=p_id;
  insert into private.vehicle_report_events(tenant_id,report_id,actor_id,request_key,action,reason) values(r.tenant_id,p_id,actor,p_key,p_status,p_reason);
  return jsonb_build_object('id',p_id,'status',p_status);
end $$;

create function private.save_report_evidence(p_report uuid,p_key uuid,p_id uuid,p_mime text,p_size integer,p_sha text,p_ciphertext text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;r private.vehicle_reports;e private.vehicle_report_evidence;
begin
  select id into actor from app.users where auth_user_id=private.request_auth_user_id() and status='ACTIVE' and deleted_at is null;
  if actor is null or not private.check_phone_verified() then raise exception 'CHECK_ACCESS_DENIED' using errcode='42501';end if;
  select * into r from private.vehicle_reports where id=p_report and actor_id=actor for update;
  if r.id is null then raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  if p_key is null or p_id is null or p_mime is null or p_size is null or p_sha is null or p_ciphertext is null then raise exception 'INVALID_REPORT' using errcode='AG400';end if;
  select * into e from private.vehicle_report_evidence where actor_id=actor and request_key=p_key;
  if e.id is not null then
    if (e.report_id,e.mime_type,e.byte_size,e.sha256) is distinct from(p_report,p_mime,p_size,p_sha) then raise exception 'CHECK_KEY_CONFLICT' using errcode='AG409';end if;
    return jsonb_build_object('id',e.id,'mimeType',e.mime_type,'byteSize',e.byte_size);
  end if;
  if r.status<>'submitted' or (select count(*) from private.vehicle_report_evidence where report_id=p_report)>=10 then raise exception 'EVIDENCE_LIMIT' using errcode='AG409';end if;
  insert into private.vehicle_report_evidence(id,tenant_id,report_id,actor_id,request_key,mime_type,byte_size,sha256,ciphertext)
    values(p_id,r.tenant_id,p_report,actor,p_key,p_mime,p_size,p_sha,p_ciphertext);
  insert into private.vehicle_report_events(tenant_id,report_id,actor_id,request_key,action) values(r.tenant_id,p_report,actor,p_key,'evidence_uploaded');
  return jsonb_build_object('id',p_id,'mimeType',p_mime,'byteSize',p_size);
end $$;
create function private.read_report_evidence(p_id uuid,p_key uuid,p_review boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;e private.vehicle_report_evidence;
begin
  if p_key is null then raise exception 'INVALID_REPORT' using errcode='AG400';end if;
  if p_review then actor:=private.workflow_reviewer();else
    select id into actor from app.users where auth_user_id=private.request_auth_user_id() and status='ACTIVE' and deleted_at is null;
    if actor is null or not private.check_phone_verified() then raise exception 'CHECK_ACCESS_DENIED' using errcode='42501';end if;
  end if;
  select * into e from private.vehicle_report_evidence where id=p_id and (actor_id=actor or p_review);
  if e.id is null then raise exception 'CHECK_NOT_FOUND' using errcode='P0002';end if;
  insert into private.vehicle_report_events(tenant_id,report_id,actor_id,request_key,action) values(e.tenant_id,e.report_id,actor,p_key,'evidence_read');
  return to_jsonb(e);
end $$;

-- Cancel persisted jobs in the same transaction as any decision/read-time timeout.
create function private.cancel_check_alert_jobs() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.outcome<>'pending' then
    update private.check_alert_jobs set state='cancelled' where request_id=new.id and state in ('pending','awaiting_configuration');
    update private.vehicle_check_notifications set delivery_status='cancelled' where request_id=new.id and kind='owner_reminder' and delivery_status='queued';
  end if;
  return new;
end $$;
create trigger check_alert_cancellation after update of outcome on private.vehicle_check_requests for each row execute function private.cancel_check_alert_jobs();

alter table private.vehicle_check_notifications drop constraint vehicle_check_notifications_kind_check;
alter table private.vehicle_check_notifications add constraint vehicle_check_notifications_kind_check check(kind in ('owner_request','owner_reminder','buyer_result'));
-- Preserve reviewed receipt/retry behavior while applying owner checks to reminders.
do $$ declare definition text; begin
  select pg_get_functiondef('private.sms_claim_notification(text,text[])'::regprocedure) into definition;
  execute replace(definition,'n.kind=''owner_request''','n.kind in (''owner_request'',''owner_reminder'')');
end $$;

create function private.read_vehicle_status_history(p_vehicle uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;items jsonb;
begin
  actor:=private.workflow_owner(p_vehicle);
  -- Former owners and new owners cannot read each other's private history.
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'previousStatus',e.previous_status,'saleStatus',e.new_status,'reason',e.reason,'createdAt',e.created_at) order by e.created_at),'[]')
    into items from private.vehicle_status_events e where e.vehicle_id=p_vehicle and e.actor_id=actor;
  return jsonb_build_object('items',items);
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array[
    'create_vehicle_check','lookup_vehicle_check','list_vehicle_checks','sweep_vehicle_checks','workflow_owner','change_vehicle_sale',
    'submit_vehicle_report','workflow_reviewer','read_vehicle_reports','review_vehicle_report','save_report_evidence','read_report_evidence','cancel_check_alert_jobs','read_vehicle_status_history']) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('alter function %s owner to autoguardian_check_executor',f);
  end loop;
end $$;
revoke create on schema private from autoguardian_check_executor;
grant execute on function private.create_vehicle_check(uuid,uuid),private.lookup_vehicle_check(text,text,text,uuid),
  private.list_vehicle_checks(boolean,uuid,integer),private.sweep_vehicle_checks(integer),private.change_vehicle_sale(uuid,uuid,text,text,text),
  private.submit_vehicle_report(uuid,uuid,text,timestamptz,text),private.read_vehicle_reports(boolean,uuid),private.review_vehicle_report(uuid,uuid,text,text),
  private.save_report_evidence(uuid,uuid,uuid,text,integer,text,text),private.read_report_evidence(uuid,uuid,boolean),private.read_vehicle_status_history(uuid) to autoguardian_identity_login;
commit;
