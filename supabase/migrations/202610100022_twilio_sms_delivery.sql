-- Run once as postgres after 021. No account, phone, sender or secret is seeded.
begin;
create role autoguardian_sms_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_sms_executor to current_user;
grant usage on schema app,private to autoguardian_sms_executor;
grant execute on function private.request_tenant_id() to autoguardian_sms_executor;

alter table private.vehicle_check_notifications drop constraint vehicle_check_notifications_delivery_status_check;
alter table private.vehicle_check_notifications add constraint vehicle_check_notifications_delivery_status_check
  check(delivery_status in ('queued','sending','submitted','sent','delivered','failed','unknown','cancelled'));
alter table private.vehicle_check_notifications add constraint vehicle_check_notifications_tenant_id_id_key unique(tenant_id,id);
  
create table private.sms_notification_attempts (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,notification_id uuid not null,
  attempt_number integer not null check(attempt_number between 1 and 3),
  account_sid text not null check(account_sid ~ '^AC[0-9a-fA-F]{32}$'),
  recipient_hash text not null check(recipient_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'sending' check(state in ('sending','submitted','delivered','failed','unknown','rate_limited')),
  provider_message_id text check(provider_message_id ~ '^(SM|MM)[0-9a-fA-F]{32}$'),
  provider_status text,error_code text check(length(error_code)<=64),
  started_at timestamptz not null,lease_expires_at timestamptz not null,
  updated_at timestamptz not null,
  unique(notification_id,attempt_number),unique(tenant_id,id),unique(account_sid,provider_message_id),
  foreign key(tenant_id,notification_id) references private.vehicle_check_notifications(tenant_id,id),
  check(lease_expires_at>started_at)
);
create table private.sms_delivery_events (
  id bigint generated always as identity primary key,tenant_id uuid not null,attempt_id uuid not null,
  source text not null check(source in ('api','callback','recovery')),
  status text not null,error_code text not null default '' check(length(error_code)<=64),
  created_at timestamptz not null default clock_timestamp(),
  unique(attempt_id,source,status,error_code),
  foreign key(tenant_id,attempt_id) references private.sms_notification_attempts(tenant_id,id)
);
create index sms_attempt_leases on private.sms_notification_attempts(lease_expires_at) where state='sending';
create index sms_due_notifications on private.vehicle_check_notifications(tenant_id,available_at) where delivery_status='queued';

grant select(id,status,deleted_at) on app.tenants to autoguardian_sms_executor;
grant select(id,tenant_id,auth_user_id,status,deleted_at,preferred_language) on app.users to autoguardian_sms_executor;
grant select(tenant_id,user_id,role_code,organization_id,valid_from,valid_to,deleted_at) on app.role_assignments to autoguardian_sms_executor;
grant select(id,tenant_id,user_id,deleted_at) on private.owners to autoguardian_sms_executor;
grant select(tenant_id,id,vehicle_id,owner_id,start_at,end_at,deleted_at) on app.ownerships to autoguardian_sms_executor;
grant select(id,tenant_id,deleted_at,record_status) on app.vehicles to autoguardian_sms_executor;
grant select on private.vehicle_check_requests,private.vehicle_check_notifications to autoguardian_sms_executor;
grant update(delivery_status,attempts,available_at,provider_message_id,last_error_code)
  on private.vehicle_check_notifications to autoguardian_sms_executor;
do $$ declare t text;begin
  foreach t in array array['app.tenants','app.users','app.role_assignments','app.ownerships','app.vehicles','private.owners',
      'private.vehicle_check_requests','private.vehicle_check_notifications'] loop
    execute format('create policy sms_executor_read on %s for select to autoguardian_sms_executor using(%s=private.request_tenant_id())',
      t,case when t='app.tenants' then 'id' else 'tenant_id' end);
  end loop;
  foreach t in array array['sms_notification_attempts','sms_delivery_events'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert on private.%I to autoguardian_sms_executor',t);
    execute format('create policy sms_executor_read on private.%I for select to autoguardian_sms_executor using(tenant_id=private.request_tenant_id())',t);
    execute format('create policy sms_executor_append on private.%I for insert to autoguardian_sms_executor with check(tenant_id=private.request_tenant_id())',t);
  end loop;
end $$;
grant update(state,provider_message_id,provider_status,error_code,updated_at) on private.sms_notification_attempts to autoguardian_sms_executor;
grant usage on sequence private.sms_delivery_events_id_seq to autoguardian_sms_executor;
create policy sms_executor_attempt_update on private.sms_notification_attempts for update to autoguardian_sms_executor
  using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create policy sms_executor_notification_update on private.vehicle_check_notifications for update to autoguardian_sms_executor
  using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());

-- Provider-owned Auth gateway: plaintext exists only in the server dispatch
-- result; it is never persisted in delivery records or exposed to app clients.
create function private.sms_verified_phone(p_auth uuid) returns text
language sql stable security definer set search_path='' as $$
  select '+'||ltrim(phone,'+') from auth.users where id=p_auth and phone_confirmed_at is not null
    and phone ~ '^\+?[1-9][0-9]{7,14}$'
$$;
revoke all on function private.sms_verified_phone(uuid) from public,anon,authenticated,service_role;
grant execute on function private.sms_verified_phone(uuid) to autoguardian_sms_executor;

create function private.sms_claim_notification(p_account text,p_allowed_hashes text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.vehicle_check_notifications;r private.vehicle_check_requests;a private.sms_notification_attempts;
  u record;phone text;stamp timestamptz;recipient_hash text;attempt uuid;
begin
  if p_account is null or p_account !~ '^AC[0-9a-fA-F]{32}$' or p_allowed_hashes is null or cardinality(p_allowed_hashes)=0 then
    raise exception 'SMS_CONFIGURATION_REQUIRED' using errcode='23514';end if;
  if not exists(select 1 from app.tenants where status='ACTIVE' and deleted_at is null) then
    raise exception 'SMS_AUTHORITY_UNAVAILABLE' using errcode='42501';end if;
  -- A crashed/uncertain send is quarantined, never replayed automatically.
  -- Lock order is always notification, then attempt (also used by callbacks).
  for n in select * from private.vehicle_check_notifications where delivery_status='sending'
    and exists(select 1 from private.sms_notification_attempts pending_attempt where pending_attempt.notification_id=vehicle_check_notifications.id
      and pending_attempt.state='sending' and pending_attempt.lease_expires_at<=clock_timestamp()) for update skip locked loop
    select * into a from private.sms_notification_attempts where notification_id=n.id and state='sending' for update;
    if a.id is not null and a.lease_expires_at<=clock_timestamp() then
      update private.sms_notification_attempts set state='unknown',error_code='SEND_OUTCOME_UNKNOWN',updated_at=clock_timestamp() where id=a.id;
      update private.vehicle_check_notifications set delivery_status='unknown',last_error_code='SEND_OUTCOME_UNKNOWN' where id=n.id;
      insert into private.sms_delivery_events(tenant_id,attempt_id,source,status,error_code)
        values(n.tenant_id,a.id,'recovery','unknown','SEND_OUTCOME_UNKNOWN') on conflict do nothing;
    end if;
  end loop;
  for n in select * from private.vehicle_check_notifications where delivery_status='queued'
    and available_at<=clock_timestamp() and attempts<3 order by available_at,id limit 20 for update skip locked loop
    stamp:=clock_timestamp();
    select * into r from private.vehicle_check_requests where id=n.request_id;
    select id,auth_user_id,preferred_language into u from app.users where id=n.recipient_id and status='ACTIVE' and deleted_at is null;
    if r.id is null or u.id is null or not exists(select 1 from app.vehicles where id=r.vehicle_id
      and deleted_at is null and record_status<>'ARCHIVED')
      or not exists(select 1 from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
        where s.id=r.ownership_id and s.vehicle_id=r.vehicle_id and s.owner_id=r.owner_id
          and s.deleted_at is null and s.end_at is null and s.start_at<=stamp and o.deleted_at is null)
      or (n.kind='owner_request' and (r.outcome<>'pending' or r.response_deadline_at<=stamp
        or not exists(select 1 from private.owners where id=r.owner_id and user_id=n.recipient_id and deleted_at is null)))
      or (n.kind='buyer_result' and (r.outcome='pending' or r.result_expires_at<=stamp or r.buyer_id<>n.recipient_id)) then
      update private.vehicle_check_notifications set delivery_status='cancelled',last_error_code='NOTIFICATION_OBSOLETE' where id=n.id;
      continue;
    end if;
    if not exists(select 1 from app.role_assignments where user_id=u.id
      and role_code=case when n.kind='owner_request' then 'OWNER' else 'VERIFIER' end
      and organization_id is null and deleted_at is null and valid_from<=stamp and (valid_to is null or valid_to>stamp)) then
      update private.vehicle_check_notifications set delivery_status='cancelled',last_error_code='RECIPIENT_UNAVAILABLE' where id=n.id;
      continue;
    end if;
    phone:=private.sms_verified_phone(u.auth_user_id);
    recipient_hash:=encode(sha256(convert_to(phone,'UTF8')),'hex');
    if phone is null or not coalesce(recipient_hash=any(p_allowed_hashes),false) then
      update private.vehicle_check_notifications set delivery_status='failed',last_error_code=
        case when phone is null then 'VERIFIED_PHONE_REQUIRED' else 'SAMPLE_RECIPIENT_NOT_ALLOWED' end where id=n.id;
      continue;
    end if;
    insert into private.sms_notification_attempts(tenant_id,notification_id,attempt_number,account_sid,recipient_hash,
      started_at,lease_expires_at,updated_at) values(n.tenant_id,n.id,n.attempts+1,p_account,recipient_hash,stamp,stamp+interval '60 seconds',stamp)
      returning id into attempt;
    update private.vehicle_check_notifications set attempts=attempts+1,delivery_status='sending',last_error_code=null where id=n.id;
    return jsonb_build_object('notificationId',n.id,'attemptId',attempt,'requestId',r.id,'kind',n.kind,
      'phone',phone,'language',u.preferred_language,'responseDeadlineAt',r.response_deadline_at,'sampleOnly',true);
  end loop;
  return null;
end $$;

create function private.sms_apply_status(p_attempt uuid,p_account text,p_sid text,p_status text,p_error text,p_source text,p_recipient_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare a private.sms_notification_attempts;n private.vehicle_check_notifications;old_rank integer;new_rank integer;
begin
  if p_account is null or p_sid is null or p_sid !~ '^(SM|MM)[0-9a-fA-F]{32}$'
    or p_status is null or p_status not in ('accepted','queued','sending','sent','delivered','failed','undelivered','canceled')
    or p_source is null or p_source not in ('api','callback') or p_error is null or p_error !~ '^[0-9]{0,6}$' then
    raise exception 'SMS_INVALID_STATUS' using errcode='23514';end if;
  select * into n from private.vehicle_check_notifications where id=(select notification_id from private.sms_notification_attempts where id=p_attempt) for update;
  select * into a from private.sms_notification_attempts where id=p_attempt for update;
  if a.id is null or n.id is null or a.account_sid<>p_account
    or (p_source='callback' and (p_recipient_hash is null or a.recipient_hash<>p_recipient_hash))
    or (a.provider_message_id is not null and a.provider_message_id<>p_sid)
    or (a.state in ('rate_limited','failed') and a.provider_message_id is null) then
    raise exception 'SMS_CALLBACK_MISMATCH' using errcode='42501';end if;
  insert into private.sms_delivery_events(tenant_id,attempt_id,source,status,error_code)
    values(a.tenant_id,a.id,p_source,p_status,p_error) on conflict do nothing;
  -- Bind the SID even if the callback wins the race with the send API result.
  update private.sms_notification_attempts set provider_message_id=p_sid where id=a.id;
  update private.vehicle_check_notifications set provider_message_id=p_sid where id=n.id;
  old_rank:=case a.provider_status when 'accepted' then 0 when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 else -1 end;
  new_rank:=case p_status when 'accepted' then 0 when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 else 4 end;
  if a.state in ('delivered','failed') or new_rank<old_rank then return;end if;
  update private.sms_notification_attempts set provider_status=p_status,error_code=nullif(p_error,''),updated_at=clock_timestamp(),
    state=case when p_status='delivered' then 'delivered' when p_status in ('failed','undelivered','canceled') then 'failed' else 'submitted' end where id=a.id;
  update private.vehicle_check_notifications set delivery_status=case when delivery_status='cancelled' then 'cancelled'
    when p_status='delivered' then 'delivered' when p_status in ('failed','undelivered','canceled') then 'failed'
    when p_status='sent' then 'sent' else 'submitted' end,last_error_code=nullif(p_error,'') where id=n.id;
end $$;

create function private.sms_record_submission(p_attempt uuid,p_sid text,p_status text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare account text;begin
  select account_sid into account from private.sms_notification_attempts where id=p_attempt;
  perform private.sms_apply_status(p_attempt,account,p_sid,p_status,p_error,'api',null);
end $$;
create function private.sms_record_callback(p_notification uuid,p_attempt uuid,p_account text,p_sid text,p_status text,p_error text,p_phone text) returns void
language plpgsql security definer set search_path='' as $$ begin
  if not exists(select 1 from private.sms_notification_attempts where id=p_attempt and notification_id=p_notification) then
    raise exception 'SMS_CALLBACK_MISMATCH' using errcode='42501';end if;
  perform private.sms_apply_status(p_attempt,p_account,p_sid,p_status,p_error,'callback',encode(sha256(convert_to(p_phone,'UTF8')),'hex'));
end $$;

create function private.sms_record_send_error(p_attempt uuid,p_mode text,p_code text) returns void
language plpgsql security definer set search_path='' as $$
declare a private.sms_notification_attempts;n private.vehicle_check_notifications;stamp timestamptz;
begin
  if p_mode is null or p_mode not in ('rate_limited','failed','unknown') or p_code is null or p_code !~ '^[A-Z0-9_]{1,64}$' then
    raise exception 'SMS_INVALID_ERROR' using errcode='23514';end if;
  select * into n from private.vehicle_check_notifications where id=(select notification_id from private.sms_notification_attempts where id=p_attempt) for update;
  select * into a from private.sms_notification_attempts where id=p_attempt for update;
  if a.id is null or n.id is null then raise exception 'SMS_ATTEMPT_NOT_FOUND' using errcode='P0002';end if;
  if a.provider_message_id is not null or a.state<>'sending' then return;end if;
  stamp:=clock_timestamp();
  update private.sms_notification_attempts set state=p_mode,error_code=p_code,updated_at=stamp where id=a.id;
  insert into private.sms_delivery_events(tenant_id,attempt_id,source,status,error_code)
    values(a.tenant_id,a.id,'api',p_mode,p_code) on conflict do nothing;
  update private.vehicle_check_notifications set delivery_status=case
    when delivery_status='cancelled' then 'cancelled'
    when p_mode='rate_limited' and attempts<3 then 'queued'
    when p_mode='unknown' then 'unknown' else 'failed' end,
    last_error_code=p_code,available_at=case when p_mode='rate_limited' and attempts<3
      then stamp+make_interval(secs=>30*power(2,a.attempt_number-1)::integer) else available_at end where id=n.id;
end $$;

grant create on schema private to autoguardian_sms_executor;
do $$ declare f regprocedure;begin
  foreach f in array array['private.sms_claim_notification(text,text[])'::regprocedure,
    'private.sms_apply_status(uuid,text,text,text,text,text,text)'::regprocedure,
    'private.sms_record_submission(uuid,text,text,text)'::regprocedure,
    'private.sms_record_callback(uuid,uuid,text,text,text,text,text)'::regprocedure,
    'private.sms_record_send_error(uuid,text,text)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('alter function %s owner to autoguardian_sms_executor',f);
  end loop;
end $$;
revoke create on schema private from autoguardian_sms_executor;
grant execute on function private.sms_claim_notification(text,text[]),private.sms_record_submission(uuid,text,text,text),
  private.sms_record_callback(uuid,uuid,text,text,text,text,text),private.sms_record_send_error(uuid,text,text)
  to autoguardian_identity_login;
commit;
