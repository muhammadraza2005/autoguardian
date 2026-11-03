-- Run once after 027. Trusted backend-only state; no channel is enabled by SQL.
begin;
grant autoguardian_billing_executor to current_user;
create role autoguardian_telecom_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_telecom_executor to current_user;
grant usage on schema app,private to autoguardian_telecom_executor;
grant execute on function private.request_tenant_id(),private.request_auth_user_id() to autoguardian_telecom_executor;
create table private.telecom_state (
 tenant_id uuid not null references app.tenants(id),state_key text not null check(state_key ~ '^[a-f0-9]{64}$'),
 ciphertext text not null check(length(ciphertext) between 40 and 16000),expires_at timestamptz not null,
 primary key(tenant_id,state_key)
);
create table private.telecom_dispatches (
 tenant_id uuid not null references app.tenants(id),dispatch_key text not null check(dispatch_key ~ '^[a-f0-9]{64}$'),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('sending','sent','failed','unknown')),provider_reference text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,dispatch_key)
);
create table private.telecom_channels (
 tenant_id uuid not null references app.tenants(id),channel_key text not null check(channel_key ~ '^[a-f0-9]{64}$'),
 auth_user_id uuid not null,phone_hash text not null check(phone_hash ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 primary key(tenant_id,channel_key)
);
create table private.telecom_references (
 tenant_id uuid not null,auth_user_id uuid not null,request_id uuid not null,
 reference text not null check(reference ~ '^[A-F0-9]{12}$'),expires_at timestamptz not null,
 primary key(tenant_id,auth_user_id,request_id),unique(tenant_id,auth_user_id,reference),
 foreign key(tenant_id,request_id) references private.vehicle_check_requests(tenant_id,id)
);
do $$ declare t text;begin
 foreach t in array array['telecom_state','telecom_dispatches','telecom_channels','telecom_references'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,autoguardian_identity_login',t);
  execute format('grant select,insert,update,delete on private.%I to autoguardian_telecom_executor',t);
  execute format('create policy telecom_scope on private.%I to autoguardian_telecom_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id())',t);
 end loop;
end $$;
grant select(id,status,deleted_at) on app.tenants to autoguardian_telecom_executor;
grant select(id,tenant_id,auth_user_id,status,deleted_at,preferred_language) on app.users to autoguardian_telecom_executor;
grant select on private.vehicle_check_configuration to autoguardian_telecom_executor;
create policy telecom_tenant on app.tenants for select to autoguardian_telecom_executor using(id=private.request_tenant_id());
create policy telecom_users on app.users for select to autoguardian_telecom_executor using(tenant_id=private.request_tenant_id());
create policy telecom_configuration on private.vehicle_check_configuration for select to autoguardian_telecom_executor using(tenant_id=private.request_tenant_id());
-- Owner-owned Auth gateway, never callable by runtime or client roles directly.
-- Match a UNIQUE confirmed phone globally; account creation/role assignment stays
-- in enrollment. No arbitrary actor id is trusted from a callback.
create function private.telecom_phone_account(p_phone text) returns uuid
language sql stable security definer set search_path='' as $$
 select case when count(*)=1 then (array_agg(u.id))[1] else null end from auth.users u
 where phone_confirmed_at is not null and '+'||ltrim(phone,'+')=p_phone and phone ~ '^\+?[1-9][0-9]{7,14}$'
  and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp()
  and to_jsonb(u)->>'deleted_at' is null
$$;
revoke all on function private.telecom_phone_account(text) from public,anon,authenticated,service_role,autoguardian_identity_login;
grant execute on function private.telecom_phone_account(text) to autoguardian_telecom_executor;
create function private.telecom_resolve(p_phone text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;u record;begin
 if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_PHONE' using errcode='23514';end if;
 actor:=private.telecom_phone_account(p_phone);
 select id,preferred_language into u from app.users where auth_user_id=actor and status='ACTIVE' and deleted_at is null;
 if u.id is null or not exists(select 1 from app.tenants where status='ACTIVE' and deleted_at is null) then return null;end if;
 return jsonb_build_object('authUserId',actor,'language',u.preferred_language);
end $$;
create function private.telecom_state_read(p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.telecom_state;begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_TELECOM_KEY' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||p_key,28));
 select * into s from private.telecom_state where state_key=p_key and expires_at>clock_timestamp();
 return case when s.state_key is null then null else jsonb_build_object('ciphertext',s.ciphertext) end;
end $$;
create function private.telecom_state_write(p_key text,p_ciphertext text,p_seconds integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_seconds is null or p_seconds not between 1 and 86400
  or p_ciphertext is null or length(p_ciphertext) not between 40 and 16000 then raise exception 'INVALID_TELECOM_STATE' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||p_key,28));
 delete from private.telecom_state where expires_at<=clock_timestamp();
 if (select count(*) from private.telecom_state)>=10000 and not exists(select 1 from private.telecom_state where state_key=p_key) then raise exception 'TELECOM_STATE_LIMIT' using errcode='23514';end if;
 insert into private.telecom_state values(private.request_tenant_id(),p_key,p_ciphertext,clock_timestamp()+make_interval(secs=>p_seconds))
 on conflict(tenant_id,state_key) do update set ciphertext=excluded.ciphertext,expires_at=excluded.expires_at;
end $$;
create function private.telecom_dispatch_claim(p_key text,p_hash text) returns text language plpgsql security definer set search_path='' as $$
declare d private.telecom_dispatches;begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||p_key,29));
 select * into d from private.telecom_dispatches where dispatch_key=p_key;
 if d.dispatch_key is not null then
  if d.payload_hash<>p_hash then raise exception 'TELECOM_KEY_CONFLICT' using errcode='23514';end if;
  return d.state;
 end if;
 if (select count(*) from private.telecom_dispatches where created_at>clock_timestamp()-interval '1 hour')>=10000 then raise exception 'TELECOM_SEND_LIMIT' using errcode='23514';end if;
 insert into private.telecom_dispatches(tenant_id,dispatch_key,payload_hash,state) values(private.request_tenant_id(),p_key,p_hash,'sending');
 return 'claimed';
end $$;
create function private.telecom_dispatch_finish(p_key text,p_state text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_state is null or p_state not in ('sent','failed','unknown') or length(p_reference)>200 then raise exception 'INVALID_DISPATCH' using errcode='23514';end if;
 update private.telecom_dispatches set state=p_state,provider_reference=p_reference,updated_at=clock_timestamp() where dispatch_key=p_key and state='sending';
 if not found then raise exception 'DISPATCH_NOT_CLAIMED' using errcode='23514';end if;
end $$;
create function private.telecom_verify_channel(p_key text,p_phone text,p_actor uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_actor is null or private.telecom_phone_account(p_phone) is distinct from p_actor then return false;end if;
 if private.telecom_resolve(p_phone) is null then return false;end if;
 insert into private.telecom_channels values(private.request_tenant_id(),p_key,p_actor,encode(sha256(convert_to(p_phone,'UTF8')),'hex'),clock_timestamp(),clock_timestamp()+interval '10 minutes')
 on conflict(tenant_id,channel_key) do update set auth_user_id=excluded.auth_user_id,phone_hash=excluded.phone_hash,verified_at=excluded.verified_at,expires_at=excluded.expires_at;
 return true;
end $$;
create function private.telecom_operation(p_channel text,p_phone text,p_name text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.telecom_channels;result jsonb;v_request uuid;ref text;item jsonb;items jsonb:='[]';begin
 select * into c from private.telecom_channels where channel_key=p_channel and expires_at>clock_timestamp();
 if c.channel_key is null or private.telecom_phone_account(p_phone) is distinct from c.auth_user_id
  or private.telecom_resolve(p_phone) is null then raise exception 'CHANNEL_VERIFICATION_REQUIRED' using errcode='42501';end if;
 -- Keep the established production gates: approved PIN/step-up and live billing
 -- rules are not invented by a telecom adapter. Synthetic checks remain TEST.
 if not exists(select 1 from private.vehicle_check_configuration where sample_enabled) then raise exception 'PRODUCTION_CHANNEL_POLICY_REQUIRED' using errcode='42501';end if;
 if p_name='decision' and c.verified_at<=clock_timestamp()-interval '5 minutes' then raise exception 'FRESH_CHALLENGE_REQUIRED' using errcode='42501';end if;
 perform set_config('autoguardian.auth_user_id',c.auth_user_id::text,true);
 perform set_config('autoguardian.telecom_channel',p_channel,true);
 if p_name in ('status','decision') then
  select r.request_id into v_request from private.telecom_references r where r.auth_user_id=c.auth_user_id
   and r.reference=upper(p_args->>'id') and r.expires_at>clock_timestamp();
  if v_request is null then raise exception 'CHANNEL_REFERENCE_INVALID' using errcode='P0002';end if;
 end if;
 if p_name='check' then
  -- Existing create path also enforces configured sandbox allowances atomically.
  result:=private.lookup_vehicle_check(p_args->>'method',p_args->>'value',null,(p_args->>'key')::uuid);
 elsif p_name='status' then result:=private.read_vehicle_check(v_request);
 elsif p_name='pending' then
  result:=private.list_vehicle_checks(true,null,2);
  for item in select value from jsonb_array_elements(result->'items') loop
   insert into private.telecom_references values(private.request_tenant_id(),c.auth_user_id,(item->>'id')::uuid,
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),clock_timestamp()+interval '1 day')
    on conflict(tenant_id,auth_user_id,request_id) do update set expires_at=excluded.expires_at returning reference into ref;
   items:=items||jsonb_build_array(jsonb_build_object('reference',ref,'plate',item->>'plate'));
  end loop;
  result:=jsonb_build_object('items',items);
 elsif p_name='decision' then
  perform private.decide_vehicle_check(v_request,p_args->>'decision');result:=jsonb_build_object('recorded',true);
 else raise exception 'INVALID_CHANNEL_OPERATION' using errcode='23514';end if;
 if p_name='check' then
  insert into private.telecom_references values(private.request_tenant_id(),c.auth_user_id,(result->>'id')::uuid,
   upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),clock_timestamp()+interval '1 day')
   on conflict(tenant_id,auth_user_id,request_id) do update set expires_at=excluded.expires_at returning reference into ref;
  result:=result||jsonb_build_object('reference',ref);
 end if;
 perform set_config('autoguardian.auth_user_id','',true);
 perform set_config('autoguardian.telecom_channel','',true);
 return result;
exception when sqlstate '42501' or sqlstate 'P0002' or sqlstate '23514' or sqlstate 'AG403' or sqlstate 'AG409' or sqlstate 'AG429' then
 return jsonb_build_object('error','CHANNEL_OPERATION_DENIED');
end $$;
-- Aggregate operational monitoring only; current TENANT_ADMIN/MFA is mandatory.
grant execute on function private.billing_actor(boolean) to autoguardian_telecom_executor;
grant select on private.vehicle_check_notifications to autoguardian_telecom_executor;
create policy telecom_notification_health on private.vehicle_check_notifications for select to autoguardian_telecom_executor
 using(tenant_id=private.request_tenant_id());
create function private.telecom_health() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.billing_actor(true);
 return jsonb_build_object(
  'smsQueue',coalesce((select jsonb_object_agg(delivery_status,n) from
   (select delivery_status,count(*) n from private.vehicle_check_notifications group by delivery_status) q),'{}'::jsonb),
  'directSends24h',coalesce((select jsonb_object_agg(state,n) from
   (select state,count(*) n from private.telecom_dispatches where created_at>clock_timestamp()-interval '1 day' group by state) q),'{}'::jsonb),
  'activeVerifiedChannels',(select count(*) from private.telecom_channels where expires_at>clock_timestamp()),
  'activeStateRecords',(select count(*) from private.telecom_state where expires_at>clock_timestamp()));
end $$;
grant execute on function private.lookup_vehicle_check(text,text,text,uuid),private.read_vehicle_check(uuid),
 private.list_vehicle_checks(boolean,uuid,integer),private.decide_vehicle_check(uuid,text) to autoguardian_telecom_executor;
grant create on schema private to autoguardian_telecom_executor;
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname like 'telecom_%' and p.proname<>'telecom_phone_account' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  execute format('alter function %s owner to autoguardian_telecom_executor',f);
  execute format('grant execute on function %s to autoguardian_identity_login',f);
 end loop;
end $$;
revoke create on schema private from autoguardian_telecom_executor;
-- A verified basic-phone session can consume the SAME existing sandbox check
-- allowance; it can never act as staff or satisfy general Supabase/MFA proof.
grant create on schema private to autoguardian_billing_executor;
create function private.telecom_billing_session_valid() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.telecom_channels c where c.channel_key=current_setting('autoguardian.telecom_channel',true)
  and c.auth_user_id=private.request_auth_user_id() and c.expires_at>clock_timestamp()
  and c.phone_hash=encode(sha256(convert_to(private.sms_verified_phone(c.auth_user_id),'UTF8')),'hex'))
$$;
revoke all on function private.telecom_billing_session_valid() from public,anon,authenticated,service_role,autoguardian_identity_login;
grant execute on function private.telecom_billing_session_valid() to autoguardian_billing_executor;
grant create on schema private to autoguardian_telecom_executor;
grant execute on function private.sms_verified_phone(uuid) to autoguardian_telecom_executor;
alter function private.telecom_billing_session_valid() owner to autoguardian_telecom_executor;
revoke create on schema private from autoguardian_telecom_executor;
do $$ declare definition text;begin
 select pg_get_functiondef('private.billing_actor(boolean)'::regprocedure) into definition;
 if position('not private.access_session_valid(p_admin)' in definition)=0 then raise exception 'BILLING_ACTOR_DEFINITION_CHANGED';end if;
 execute replace(definition,'not private.access_session_valid(p_admin)',
  'not (private.access_session_valid(p_admin) or (not p_admin and private.telecom_billing_session_valid()))');
end $$;
revoke create on schema private from autoguardian_billing_executor;
revoke autoguardian_billing_executor from current_user;
commit;
