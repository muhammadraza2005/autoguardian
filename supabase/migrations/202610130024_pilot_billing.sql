-- Run once after 023. Sandbox billing only: never writes production activation receipts.
begin;
create role autoguardian_billing_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role autoguardian_billing_worker nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_billing_executor to current_user;
-- A separate worker login receives this role via setup-billing-worker.sql.
-- The HTTP identity login must never confirm payments or impersonate this role.
grant usage on schema app,private to autoguardian_billing_executor,autoguardian_billing_worker;
grant create on schema private to autoguardian_billing_executor;
grant execute on function private.request_tenant_id(),private.request_auth_user_id(),private.access_session_valid(boolean),private.enrollment_agent_id(uuid)
  to autoguardian_billing_executor;
grant select on app.tenants,app.users,app.role_assignments,app.enrollment_drafts,app.vehicles,app.ownerships,private.owners to autoguardian_billing_executor;
do $$declare t text;begin
  foreach t in array array['app.tenants','app.users','app.role_assignments','app.enrollment_drafts','app.vehicles','app.ownerships','private.owners'] loop
    execute format('create policy billing_scope on %s for select to autoguardian_billing_executor using(%s=private.request_tenant_id())',t,case when t='app.tenants' then 'id' else 'tenant_id' end);
  end loop;
end $$;

create table private.billing_configuration (
  tenant_id uuid primary key references app.tenants(id),revision integer not null default 1 check(revision>0),
  sandbox_enabled boolean not null default false,currency text not null check(currency in ('CDF','USD')),
  registration_fee numeric(20,4) not null check(registration_fee>0),check_fee numeric(20,4) not null check(check_fee>0),
  renewal_fee numeric(20,4) not null check(renewal_fee>0),free_monthly integer not null check(free_monthly between 0 and 100),
  period_days integer not null check(period_days between 1 and 366),grace_days integer not null check(grace_days between 0 and 90),
  reminder_days integer not null check(reminder_days between 0 and 90),updated_at timestamptz not null default clock_timestamp()
);
create table private.billing_payments (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,actor_id uuid not null,request_key uuid not null,
  purpose text not null check(purpose in ('REGISTRATION','CHECK','SUBSCRIPTION')),target_id uuid not null,target_revision integer not null default 0,
  amount numeric(20,4) not null check(amount>0),currency text not null check(currency in ('CDF','USD')),config_revision integer not null,
  period_days integer not null,grace_days integer not null,reminder_days integer not null,
  payer_ciphertext text not null check(length(payer_ciphertext) between 44 and 4096),fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'CREATED' check(status in ('CREATED','PROCESSING','COMPLETED','FAILED','DISCREPANCY')),
  provider_reference text,attempts integer not null default 0,lease_id uuid,lease_until timestamptz,
  available_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),confirmed_at timestamptz,
  unique(tenant_id,id),unique(tenant_id,actor_id,request_key),foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
create table private.billing_events (
  id bigint generated always as identity primary key,tenant_id uuid not null,payment_id uuid,actor_id uuid,
  action text not null,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default clock_timestamp(),
  foreign key(tenant_id,payment_id) references private.billing_payments(tenant_id,id)
);
create table private.billing_check_usage (
  tenant_id uuid not null,actor_id uuid not null,phone_key text not null,request_key uuid not null,payment_id uuid,
  created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,actor_id,request_key),
  foreign key(tenant_id,payment_id) references private.billing_payments(tenant_id,id)
);
create table private.billing_subscriptions (
  tenant_id uuid not null,vehicle_id uuid not null,actor_id uuid not null,expires_at timestamptz not null,
  grace_until timestamptz not null,remind_at timestamptz not null,reminder_created boolean not null default false,
  state text not null default 'ACTIVE' check(state in ('ACTIVE','GRACE','SUSPENDED')),payment_id uuid not null,
  primary key(tenant_id,vehicle_id,actor_id),foreign key(tenant_id,payment_id) references private.billing_payments(tenant_id,id),
  foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id)
);
create table private.billing_reminders (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,actor_id uuid not null,vehicle_id uuid not null,
  payment_id uuid not null,created_at timestamptz not null default clock_timestamp(),acknowledged_at timestamptz,
  unique(tenant_id,payment_id),foreign key(tenant_id,payment_id) references private.billing_payments(tenant_id,id)
);
do $$declare t text;begin
  foreach t in array array['billing_configuration','billing_payments','billing_events','billing_check_usage','billing_subscriptions','billing_reminders'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role,autoguardian_identity_login,autoguardian_billing_worker',t);
    execute format('grant select,insert on private.%I to autoguardian_billing_executor',t);
    execute format('create policy billing_read on private.%I for select to autoguardian_billing_executor using(tenant_id=private.request_tenant_id())',t);
    execute format('create policy billing_append on private.%I for insert to autoguardian_billing_executor with check(tenant_id=private.request_tenant_id())',t);
  end loop;
  foreach t in array array['billing_configuration','billing_payments','billing_subscriptions','billing_reminders'] loop
    execute format('grant update on private.%I to autoguardian_billing_executor',t);
    execute format('create policy billing_update on private.%I for update to autoguardian_billing_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id())',t);
  end loop;
end $$;
grant usage,select on sequence private.billing_events_id_seq to autoguardian_billing_executor;

-- Only a one-way quota fingerprint is exposed, never an Auth phone number.
create function private.billing_phone_key() returns text language sql stable security definer set search_path='' as $$
 select md5(private.request_tenant_id()::text||':'||regexp_replace(phone,'[^0-9]','','g')) from auth.users
 where id=private.request_auth_user_id() and nullif(phone,'') is not null and phone_confirmed_at is not null
$$;
revoke all on function private.billing_phone_key() from public,anon,authenticated,service_role,autoguardian_identity_login;
grant execute on function private.billing_phone_key() to autoguardian_billing_executor;

create function private.billing_actor(p_admin boolean default false) returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid;begin
 select u.id into actor from app.users u join app.tenants t on t.id=u.tenant_id
 where u.auth_user_id=private.request_auth_user_id() and u.status='ACTIVE' and u.deleted_at is null and t.status='ACTIVE' and t.deleted_at is null;
 if actor is null or not private.access_session_valid(p_admin) or (p_admin and not exists(select 1 from app.role_assignments r
   where r.user_id=actor and r.role_code='TENANT_ADMIN' and r.organization_id is null and r.deleted_at is null
     and r.valid_from<=clock_timestamp() and (r.valid_to is null or r.valid_to>clock_timestamp()))) then
   raise exception 'BILLING_ACCESS_DENIED' using errcode='AG403';end if;
 return actor;
end $$;

create function private.billing_settings(p_body jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.billing_configuration;begin
 actor:=private.billing_actor(p_body is not null);
 if p_body is not null then
   perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text,24));
   select * into c from private.billing_configuration for update;
   if p_revision is distinct from coalesce(c.revision,0) then raise exception 'BILLING_CHANGED' using errcode='AG409';end if;
   if jsonb_typeof(p_body)<>'object' or (select count(*) from jsonb_object_keys(p_body))<>10
      or p_body-array['sandboxEnabled','currency','registrationFee','checkFee','renewalFee','freeMonthly','periodDays','graceDays','reminderDays','policyAcknowledged']<>'{}'::jsonb
      or p_body->>'policyAcknowledged'<>'false' then raise exception 'INVALID_BILLING_SETTINGS' using errcode='AG400';end if;
   insert into private.billing_configuration(tenant_id,revision,sandbox_enabled,currency,registration_fee,check_fee,renewal_fee,free_monthly,period_days,grace_days,reminder_days)
   values(private.request_tenant_id(),coalesce(c.revision,0)+1,(p_body->>'sandboxEnabled')::boolean,p_body->>'currency',
    (p_body->>'registrationFee')::numeric,(p_body->>'checkFee')::numeric,(p_body->>'renewalFee')::numeric,
    (p_body->>'freeMonthly')::integer,(p_body->>'periodDays')::integer,(p_body->>'graceDays')::integer,(p_body->>'reminderDays')::integer)
   on conflict(tenant_id) do update set revision=excluded.revision,sandbox_enabled=excluded.sandbox_enabled,currency=excluded.currency,
    registration_fee=excluded.registration_fee,check_fee=excluded.check_fee,renewal_fee=excluded.renewal_fee,free_monthly=excluded.free_monthly,
    period_days=excluded.period_days,grace_days=excluded.grace_days,reminder_days=excluded.reminder_days,updated_at=clock_timestamp();
   insert into private.billing_events(tenant_id,actor_id,action,details) values(private.request_tenant_id(),actor,'SETTINGS_CHANGED',jsonb_build_object('revision',coalesce(c.revision,0)+1));
 end if;
 select * into c from private.billing_configuration;
 return case when c.tenant_id is null then null else jsonb_build_object('revision',c.revision,'sandboxEnabled',c.sandbox_enabled,'currency',c.currency,
  'registrationFee',c.registration_fee::text,'checkFee',c.check_fee::text,'renewalFee',c.renewal_fee::text,
  'freeMonthly',c.free_monthly,'periodDays',c.period_days,'graceDays',c.grace_days,'reminderDays',c.reminder_days,'sampleOnly',true) end;
end $$;

create function private.billing_payment_view(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'purpose',p.purpose,'targetId',p.target_id,'targetRevision',p.target_revision,
 'amount',p.amount::text,'currency',p.currency,'status',p.status,'createdAt',p.created_at,'confirmedAt',p.confirmed_at,
 'providerReference',p.provider_reference,'receiptNumber',case when p.status='COMPLETED' then 'SANDBOX-'||p.id::text else null end,'sampleOnly',true)
 from private.billing_payments p where p.id=p_id
$$;

create function private.billing_begin(p_key uuid,p_purpose text,p_target uuid,p_revision integer,p_ciphertext text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.billing_configuration;p private.billing_payments;d app.enrollment_drafts;fee numeric;begin
 actor:=private.billing_actor(false);
 if p_key is null or p_target is null or p_revision is null or p_revision<0 or p_purpose not in ('REGISTRATION','CHECK','SUBSCRIPTION') then raise exception 'INVALID_BILLING_INPUT' using errcode='AG400';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text||p_purpose||p_target::text||p_revision::text,24));
 select * into p from private.billing_payments where actor_id=actor and request_key=p_key;
 if p.id is not null then
  if p.fingerprint<>p_fingerprint or p.purpose<>p_purpose or p.target_id<>p_target or p.target_revision<>p_revision then raise exception 'BILLING_KEY_CONFLICT' using errcode='AG409';end if;
  return private.billing_payment_view(p.id);
 end if;
 -- Recovery after losing the create response must not create a second charge.
 select * into p from private.billing_payments where actor_id=actor and purpose=p_purpose and target_id=p_target and target_revision=p_revision
   and (status in ('CREATED','PROCESSING') or (status='COMPLETED' and p_purpose<>'SUBSCRIPTION')) order by created_at desc limit 1;
 if p.id is not null then
  if p.fingerprint<>p_fingerprint then raise exception 'BILLING_OPERATION_PENDING' using errcode='AG409';end if;
  return private.billing_payment_view(p.id);
 end if;
 select * into c from private.billing_configuration where sandbox_enabled;
 if c.tenant_id is null then raise exception 'BILLING_SETUP_REQUIRED' using errcode='AG409';end if;
 if p_purpose='REGISTRATION' then
  select * into d from app.enrollment_drafts where id=p_target;
  if d.id is null or d.created_by<>actor or private.enrollment_agent_id(d.organization_id) is distinct from actor then raise exception 'BILLING_TARGET_DENIED' using errcode='AG403';end if;
  if d.enrollment_snapshot_revision<>p_revision then raise exception 'BILLING_TARGET_CHANGED' using errcode='AG409';end if;
  fee:=c.registration_fee;
 elsif p_purpose='SUBSCRIPTION' then
  if not exists(select 1 from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
    where s.vehicle_id=p_target and o.user_id=actor and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp() and o.deleted_at is null) then
    raise exception 'BILLING_TARGET_DENIED' using errcode='AG403';end if;
  if p_revision<>0 then raise exception 'INVALID_BILLING_INPUT' using errcode='AG400';end if;
  fee:=c.renewal_fee;
 else
  if private.billing_phone_key() is null or p_revision<>0 or not exists(select 1 from app.role_assignments where user_id=actor and role_code='VERIFIER' and organization_id is null and deleted_at is null and valid_from<=clock_timestamp() and (valid_to is null or valid_to>clock_timestamp())) then
    raise exception 'BILLING_TARGET_DENIED' using errcode='AG403';end if;
  fee:=c.check_fee;
 end if;
 insert into private.billing_payments(tenant_id,actor_id,request_key,purpose,target_id,target_revision,amount,currency,config_revision,
  period_days,grace_days,reminder_days,payer_ciphertext,fingerprint)
 values(c.tenant_id,actor,p_key,p_purpose,p_target,p_revision,fee,c.currency,c.revision,c.period_days,c.grace_days,c.reminder_days,p_ciphertext,p_fingerprint) returning * into p;
 insert into private.billing_events(tenant_id,payment_id,actor_id,action) values(c.tenant_id,p.id,actor,'CREATED');
 return private.billing_payment_view(p.id);
end $$;

create function private.billing_read(p_id uuid,p_admin boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 actor:=private.billing_actor(p_admin);
 if p_id is not null then
  if not exists(select 1 from private.billing_payments where id=p_id and (actor_id=actor or p_admin)) then raise exception 'PAYMENT_NOT_FOUND' using errcode='AG404';end if;
  return private.billing_payment_view(p_id);
 end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(private.billing_payment_view(id) order by created_at desc) from
  (select id,created_at from private.billing_payments where actor_id=actor or p_admin order by created_at desc limit 100) p),'[]'::jsonb),'sampleOnly',true);
end $$;

create function private.billing_reconcile(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;p private.billing_payments;begin
 actor:=private.billing_actor(true);
 select * into p from private.billing_payments where id=p_id for update;
 if p.id is null then raise exception 'PAYMENT_NOT_FOUND' using errcode='AG404';end if;
 if p.status in ('COMPLETED','FAILED') then return private.billing_payment_view(p.id);end if;
 if p.lease_until>clock_timestamp() then raise exception 'PAYMENT_LEASE_CHANGED' using errcode='AG409';end if;
 update private.billing_payments set status='PROCESSING',attempts=0,available_at=clock_timestamp(),lease_id=null,lease_until=null where id=p.id;
 insert into private.billing_events(tenant_id,payment_id,actor_id,action) values(p.tenant_id,p.id,actor,'RECONCILIATION_REQUESTED');
 return private.billing_payment_view(p.id);
end $$;

create function private.billing_claim(p_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.billing_payments;lease uuid:=gen_random_uuid();begin
 select * into p from private.billing_payments where status in ('CREATED','PROCESSING') and attempts<12
  and available_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()) and (p_id is null or id=p_id)
  order by created_at for update skip locked limit 1;
 if p.id is null then return null;end if;
 update private.billing_payments set lease_id=lease,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 where id=p.id;
 return jsonb_build_object('id',p.id,'amount',p.amount::text,'currency',p.currency,'ciphertext',p.payer_ciphertext,'leaseId',lease,'status',p.status);
end $$;

create function private.billing_finish(p_id uuid,p_lease uuid,p_status text,p_amount numeric,p_currency text,p_reference text) returns void
language plpgsql security definer set search_path='' as $$
declare p private.billing_payments;s private.billing_subscriptions;stamp timestamptz:=clock_timestamp();until_at timestamptz;begin
 select * into p from private.billing_payments where id=p_id for update;
 if p.id is null or p.lease_id is distinct from p_lease or p.lease_until<stamp then raise exception 'PAYMENT_LEASE_CHANGED' using errcode='AG409';end if;
 if p.status in ('COMPLETED','FAILED','DISCREPANCY') then return;end if;
 if p_status not in ('PROCESSING','COMPLETED','FAILED','DISCREPANCY') or p_status is null then raise exception 'INVALID_PAYMENT_STATUS' using errcode='AG400';end if;
 if p_amount is distinct from p.amount or p_currency is distinct from p.currency then p_status:='DISCREPANCY';end if;
 update private.billing_payments set status=p_status,provider_reference=left(p_reference,128),lease_id=null,lease_until=null,
  available_at=stamp+make_interval(secs=>least(3600,15*(2^least(p.attempts,7))::integer)),
  confirmed_at=case when p_status='COMPLETED' then stamp else null end where id=p.id;
 insert into private.billing_events(tenant_id,payment_id,action) values(p.tenant_id,p.id,p_status);
 if p_status='COMPLETED' and p.purpose='SUBSCRIPTION' then
  -- Subscription belongs to the purchasing owner; transfer never gives the former owner new access.
  perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||p.target_id::text||p.actor_id::text,24));
  select * into s from private.billing_subscriptions where vehicle_id=p.target_id and actor_id=p.actor_id for update;
  until_at:=greatest(stamp,coalesce(s.expires_at,stamp))+make_interval(days=>p.period_days);
  insert into private.billing_subscriptions(tenant_id,vehicle_id,actor_id,expires_at,grace_until,remind_at,payment_id)
   values(p.tenant_id,p.target_id,p.actor_id,until_at,until_at+make_interval(days=>p.grace_days),until_at-make_interval(days=>p.reminder_days),p.id)
   on conflict(tenant_id,vehicle_id,actor_id) do update set expires_at=excluded.expires_at,grace_until=excluded.grace_until,remind_at=excluded.remind_at,
    state='ACTIVE',reminder_created=false,payment_id=excluded.payment_id;
  update private.billing_reminders set acknowledged_at=stamp where vehicle_id=p.target_id and actor_id=p.actor_id and acknowledged_at is null;
 end if;
 -- Sandbox money NEVER writes private.enrollment_prerequisite_receipts.
end $$;

create function private.billing_check_allowance(p_key uuid,p_consume boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;phone text;c private.billing_configuration;used integer;paid uuid;begin
 actor:=private.billing_actor(false);phone:=private.billing_phone_key();
 if phone is null or p_key is null or p_consume is null then raise exception 'BILLING_ACCESS_DENIED' using errcode='AG403';end if;
 select * into c from private.billing_configuration where sandbox_enabled;
 if c.tenant_id is null then return jsonb_build_object('configured',false,'sampleOnly',true);end if;
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||phone,24));
 if exists(select 1 from private.billing_check_usage where actor_id=actor and request_key=p_key) then return jsonb_build_object('configured',true,'allowed',true,'sampleOnly',true);end if;
 select count(*) into used from private.billing_check_usage where phone_key=phone and payment_id is null and created_at>=date_trunc('month',clock_timestamp() at time zone 'Africa/Kinshasa') at time zone 'Africa/Kinshasa';
 select id into paid from private.billing_payments where actor_id=actor and purpose='CHECK' and target_id=p_key and status='COMPLETED'
  and not exists(select 1 from private.billing_check_usage u where u.payment_id=billing_payments.id) order by created_at limit 1;
 if p_consume then
  if used>=c.free_monthly and paid is null then raise exception 'CHECK_PAYMENT_REQUIRED' using errcode='AG409';end if;
  insert into private.billing_check_usage(tenant_id,actor_id,phone_key,request_key,payment_id) values(c.tenant_id,actor,phone,p_key,case when used<c.free_monthly then null else paid end);
 end if;
 return jsonb_build_object('configured',true,'allowed',used<c.free_monthly or paid is not null,'freeRemaining',greatest(0,c.free_monthly-used),
  'amount',c.check_fee::text,'currency',c.currency,'sampleOnly',true);
end $$;

-- Billing is optional for older synthetic tests, and mandatory once sandbox billing is enabled.
alter function private.create_vehicle_check(uuid,uuid) rename to create_vehicle_check_before_billing;
revoke execute on function private.create_vehicle_check_before_billing(uuid,uuid) from autoguardian_identity_login;
create function private.create_vehicle_check(p_vehicle uuid,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.billing_configuration where sandbox_enabled) then perform private.billing_check_allowance(p_key,true);end if;
 return private.create_vehicle_check_before_billing(p_vehicle,p_key);
end $$;

create function private.billing_quote(p_key uuid) returns jsonb language sql security definer set search_path='' as $$
 select private.billing_check_allowance(p_key,false)
$$;

create function private.billing_subscription_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 actor:=private.billing_actor(false);
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('vehicleId',s.vehicle_id,'expiresAt',s.expires_at,'graceUntil',s.grace_until,
  'state',case when clock_timestamp()<s.expires_at then 'ACTIVE' when clock_timestamp()<s.grace_until then 'GRACE' else 'SUSPENDED' end))
  from private.billing_subscriptions s where s.actor_id=actor and exists(select 1 from app.ownerships o join private.owners w on w.id=o.owner_id and w.tenant_id=o.tenant_id
   where o.vehicle_id=s.vehicle_id and w.user_id=actor and o.end_at is null and o.deleted_at is null and o.start_at<=clock_timestamp() and w.deleted_at is null)),'[]'::jsonb),
  'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'vehicleId',r.vehicle_id,'createdAt',r.created_at)) from private.billing_reminders r where r.actor_id=actor and r.acknowledged_at is null
    and exists(select 1 from app.ownerships o join private.owners w on w.id=o.owner_id and w.tenant_id=o.tenant_id
      where o.vehicle_id=r.vehicle_id and w.user_id=actor and o.end_at is null and o.deleted_at is null and o.start_at<=clock_timestamp() and w.deleted_at is null)),'[]'::jsonb),'sampleOnly',true);
end $$;
create function private.billing_sweep() returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;begin
 update private.billing_subscriptions set state=case when clock_timestamp()<expires_at then 'ACTIVE' when clock_timestamp()<grace_until then 'GRACE' else 'SUSPENDED' end;
 insert into private.billing_reminders(tenant_id,actor_id,vehicle_id,payment_id)
 select tenant_id,actor_id,vehicle_id,payment_id from private.billing_subscriptions where remind_at<=clock_timestamp() and not reminder_created
 on conflict(tenant_id,payment_id) do nothing;
 get diagnostics changed=row_count;
 update private.billing_subscriptions set reminder_created=true where remind_at<=clock_timestamp() and not reminder_created;
 -- Administrative subscription suspension NEVER stops resale alerts or rewrites vehicle status.
 return changed;
end $$;

-- Explicit ownership/grants: runtime can execute reviewed entrypoints but cannot write tables.
do $$declare f record;begin
 for f in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname like 'billing_%' and p.proname<>'billing_phone_key' loop
  execute format('alter function %s owner to autoguardian_billing_executor',f.name);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,autoguardian_identity_login',f.name);
 end loop;
end $$;
grant execute on function private.billing_reconcile(uuid),private.billing_settings(jsonb,integer),private.billing_begin(uuid,text,uuid,integer,text,text),private.billing_read(uuid,boolean),
 private.billing_check_allowance(uuid,boolean),private.billing_subscription_state(),private.billing_quote(uuid) to autoguardian_identity_login;
revoke execute on function private.billing_check_allowance(uuid,boolean) from autoguardian_identity_login;
grant execute on function private.billing_check_allowance(uuid,boolean) to autoguardian_check_executor;
revoke all on function private.create_vehicle_check_before_billing(uuid,uuid) from public,anon,authenticated,service_role,autoguardian_identity_login;
grant execute on function private.create_vehicle_check_before_billing(uuid,uuid) to autoguardian_billing_executor;
alter function private.create_vehicle_check(uuid,uuid) owner to autoguardian_billing_executor;
revoke all on function private.create_vehicle_check(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_vehicle_check(uuid,uuid) to autoguardian_identity_login,autoguardian_check_executor;
grant execute on function private.billing_claim(uuid),private.billing_finish(uuid,uuid,text,numeric,text,text),private.billing_sweep() to autoguardian_billing_worker;
revoke create on schema private from autoguardian_billing_executor;
revoke autoguardian_billing_executor from current_user;
commit;
