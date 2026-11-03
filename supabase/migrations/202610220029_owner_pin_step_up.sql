-- Run once after 028. No PIN policy is enabled or seeded by this migration.
begin;
grant autoguardian_billing_executor to current_user;
create role autoguardian_pin_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_pin_executor to current_user;
grant usage on schema app,private to autoguardian_pin_executor;
grant execute on function private.request_tenant_id(),private.request_auth_user_id(),private.access_session_valid(boolean),
 private.check_actor(text),private.billing_actor(boolean),private.sms_verified_phone(uuid) to autoguardian_pin_executor;
grant execute on function private.telecom_billing_session_valid() to autoguardian_pin_executor;
create table private.owner_pin_policy (
 tenant_id uuid primary key references app.tenants(id),enabled boolean not null,
 max_attempts integer not null check(max_attempts between 1 and 10),lock_seconds integer not null check(lock_seconds between 30 and 86400),
 proof_seconds integer not null check(proof_seconds between 15 and 300),approval_reference text not null check(length(btrim(approval_reference)) between 3 and 200)
);
create table private.owner_pin_credentials (
 tenant_id uuid not null,actor_id uuid not null,credential text not null check(credential ~ '^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$'),
 phone_hash text not null check(phone_hash ~ '^[a-f0-9]{64}$'),failed_attempts integer not null default 0,locked_until timestamptz,
 attempt_nonce uuid,attempt_request uuid,attempt_decision text,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,actor_id),
 foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
create table private.owner_pin_enrollments (
 tenant_id uuid not null,id uuid not null,actor_id uuid not null,session_id text not null,
 credential text not null check(credential ~ '^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$'),phone_hash text not null check(phone_hash ~ '^[a-f0-9]{64}$'),
 otp_hash text not null check(otp_hash ~ '^[a-f0-9]{64}$'),attempts integer not null default 0,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,used boolean not null default false,
 primary key(tenant_id,id),foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
create table private.owner_pin_proofs (
 tenant_id uuid not null,proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),actor_id uuid not null,session_id text not null,
 request_id uuid not null,decision text not null check(decision in ('approved','refused')),phone_hash text not null,
 expires_at timestamptz not null,used boolean not null default false,primary key(tenant_id,proof_hash),
 foreign key(tenant_id,actor_id) references app.users(tenant_id,id),
 foreign key(tenant_id,request_id) references private.vehicle_check_requests(tenant_id,id)
);
create table private.owner_pin_sale_proofs (
 tenant_id uuid not null,proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),actor_id uuid not null,session_id text not null,
 vehicle_id uuid not null,fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),phone_hash text not null,
 expires_at timestamptz not null,used boolean not null default false,primary key(tenant_id,proof_hash),
 foreign key(tenant_id,actor_id) references app.users(tenant_id,id),foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id)
);
create table private.owner_pin_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,actor_id uuid not null,
 action text not null check(action in ('policy_changed','enrollment_started','enrollment_failed','enrollment_confirmed','pin_failed','proof_issued','proof_consumed')),
 target_id uuid,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
alter table private.owner_pin_events enable row level security;
alter table private.owner_pin_events force row level security;
revoke all on private.owner_pin_events from public,anon,authenticated,service_role,autoguardian_identity_login;
grant select,insert on private.owner_pin_events to autoguardian_pin_executor;
create policy pin_audit_read on private.owner_pin_events for select to autoguardian_pin_executor using(tenant_id=private.request_tenant_id());
create policy pin_audit_append on private.owner_pin_events for insert to autoguardian_pin_executor with check(tenant_id=private.request_tenant_id());
do $$ declare t text;begin
 foreach t in array array['owner_pin_policy','owner_pin_credentials','owner_pin_enrollments','owner_pin_proofs','owner_pin_sale_proofs'] loop
  execute format('alter table private.%I enable row level security',t);execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,autoguardian_identity_login',t);
  execute format('grant select,insert,update on private.%I to autoguardian_pin_executor',t);
  execute format('create policy pin_scope on private.%I to autoguardian_pin_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id())',t);
 end loop;
 foreach t in array array['private.vehicle_check_requests','private.owners','app.ownerships'] loop
  execute format('grant select on %s to autoguardian_pin_executor',t);
  execute format('create policy pin_target on %s for select to autoguardian_pin_executor using(tenant_id=private.request_tenant_id())',t);
 end loop;
end $$;
create function private.owner_pin_actor() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not private.access_session_valid(false) and not private.telecom_billing_session_valid() then raise exception 'PIN_SESSION_REQUIRED' using errcode='42501';end if;
 return private.check_actor('OWNER');
end $$;
create function private.owner_pin_session() returns text language sql stable security definer set search_path='' as $$
 select coalesce(nullif(current_setting('autoguardian.session_id',true),''),'channel:'||current_setting('autoguardian.telecom_channel',true))
$$;
create function private.owner_pin_settings(p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.owner_pin_policy;actor uuid;begin
 actor:=private.billing_actor(true);
 if p_body is not null then
  if jsonb_typeof(p_body) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_body))<>5
   or p_body-array['enabled','maxAttempts','lockSeconds','proofSeconds','approvalReference']<>'{}'
   or jsonb_typeof(p_body->'enabled') is distinct from 'boolean' or jsonb_typeof(p_body->'approvalReference') is distinct from 'string'
   or length(btrim(p_body->>'approvalReference')) not between 3 and 200
   or exists(select 1 from unnest(array['maxAttempts','lockSeconds','proofSeconds']) k where jsonb_typeof(p_body->k) is distinct from 'number')
   then raise exception 'INVALID_PIN_POLICY' using errcode='23514';end if;
  insert into private.owner_pin_policy values(private.request_tenant_id(),(p_body->>'enabled')::boolean,
   (p_body->>'maxAttempts')::integer,(p_body->>'lockSeconds')::integer,(p_body->>'proofSeconds')::integer,p_body->>'approvalReference')
  on conflict(tenant_id) do update set enabled=excluded.enabled,max_attempts=excluded.max_attempts,lock_seconds=excluded.lock_seconds,
   proof_seconds=excluded.proof_seconds,approval_reference=excluded.approval_reference;
  insert into private.owner_pin_events(tenant_id,actor_id,action) values(private.request_tenant_id(),actor,'policy_changed');
 end if;
 select * into c from private.owner_pin_policy;
 return case when c.tenant_id is null then null else jsonb_build_object('enabled',c.enabled,'maxAttempts',c.max_attempts,
  'lockSeconds',c.lock_seconds,'proofSeconds',c.proof_seconds,'approvalReference',c.approval_reference) end;
end $$;
create function private.owner_pin_start_enrollment(p_id uuid,p_credential text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;phone text;begin
 actor:=private.owner_pin_actor();phone:=private.sms_verified_phone(private.request_auth_user_id());
 if not exists(select 1 from private.owner_pin_policy where enabled) then raise exception 'PIN_POLICY_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text,30));
 if exists(select 1 from private.owner_pin_credentials where actor_id=actor) then raise exception 'PIN_RECOVERY_POLICY_REQUIRED' using errcode='23514';end if;
 if exists(select 1 from private.owner_pin_enrollments where actor_id=actor and created_at>clock_timestamp()-interval '1 minute') then raise exception 'PIN_RESEND_COOLDOWN' using errcode='23514';end if;
 update private.owner_pin_enrollments set used=true where actor_id=actor;
 insert into private.owner_pin_enrollments(tenant_id,id,actor_id,session_id,credential,phone_hash,otp_hash,expires_at)
 values(private.request_tenant_id(),p_id,actor,private.owner_pin_session(),p_credential,
  encode(sha256(convert_to(phone,'UTF8')),'hex'),p_hash,clock_timestamp()+interval '3 minutes');
 insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'enrollment_started',p_id);
 return jsonb_build_object('challengeId',p_id,'phone',phone);
end $$;
create function private.owner_pin_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid;begin
 actor:=private.owner_pin_actor();
 return jsonb_build_object('policyEnabled',exists(select 1 from private.owner_pin_policy where enabled),
  'configured',exists(select 1 from private.owner_pin_credentials where actor_id=actor),
  'phoneCurrent',exists(select 1 from private.owner_pin_credentials where actor_id=actor and phone_hash=
   encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex')),
  'cooldown',exists(select 1 from private.owner_pin_enrollments where actor_id=actor and created_at>clock_timestamp()-interval '1 minute'));
end $$;
create function private.owner_pin_finish_enrollment(p_id uuid,p_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid;e private.owner_pin_enrollments;begin
 actor:=private.owner_pin_actor();
 if not exists(select 1 from private.owner_pin_policy where enabled) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text,30));
 select * into e from private.owner_pin_enrollments where id=p_id and actor_id=actor for update;
 if e.id is null or e.used or e.expires_at<=clock_timestamp() or e.attempts>=5
  or e.session_id is distinct from private.owner_pin_session()
  or e.phone_hash is distinct from encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex') then return false;end if;
 update private.owner_pin_enrollments set attempts=attempts+1 where id=p_id;
 if e.otp_hash is distinct from p_hash then
  insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'enrollment_failed',p_id);return false;end if;
 insert into private.owner_pin_credentials(tenant_id,actor_id,credential,phone_hash) values(e.tenant_id,actor,e.credential,e.phone_hash)
 on conflict(tenant_id,actor_id) do nothing;
 update private.owner_pin_enrollments set used=true where actor_id=actor;
 insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'enrollment_confirmed',p_id);return true;
end $$;
create function private.owner_pin_begin_attempt(p_request uuid,p_decision text,p_nonce uuid) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.owner_pin_credentials;policy private.owner_pin_policy;begin
 actor:=private.owner_pin_actor();
 select * into policy from private.owner_pin_policy where enabled;
 if policy.tenant_id is null then return null;end if;
 if p_decision is null or (p_decision not in ('approved','refused') and p_decision !~ '^sale:[a-f0-9]{64}$') or p_nonce is null then return null;end if;
 if p_decision ~ '^sale:' then
  if not exists(select 1 from private.owners o join app.ownerships s on s.owner_id=o.id and s.tenant_id=o.tenant_id
   where s.vehicle_id=p_request and o.user_id=actor and o.deleted_at is null and s.deleted_at is null and s.end_at is null and s.start_at<=clock_timestamp()) then return null;end if;
 elsif not exists(select 1 from private.vehicle_check_requests r join private.owners o on o.id=r.owner_id and o.tenant_id=r.tenant_id
  join app.ownerships s on s.id=r.ownership_id and s.tenant_id=r.tenant_id
  where r.id=p_request and o.user_id=actor and o.deleted_at is null and s.deleted_at is null and s.end_at is null
   and s.start_at<=clock_timestamp() and r.outcome='pending' and r.response_deadline_at>clock_timestamp()) then return null;end if;
 select * into c from private.owner_pin_credentials where actor_id=actor for update;
 if c.actor_id is null or c.locked_until>clock_timestamp() or c.phone_hash is distinct from
  encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex') then return null;end if;
 if c.locked_until is not null then c.failed_attempts:=0;end if;
 update private.owner_pin_credentials set failed_attempts=c.failed_attempts+1,attempt_nonce=p_nonce,attempt_request=p_request,attempt_decision=p_decision,
  locked_until=case when c.failed_attempts+1>=policy.max_attempts then clock_timestamp()+make_interval(secs=>policy.lock_seconds) else null end
  where actor_id=actor;
 return c.credential;
end $$;
create function private.owner_pin_finish_attempt(p_request uuid,p_decision text,p_nonce uuid,p_valid boolean,p_proof text) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.owner_pin_credentials;policy private.owner_pin_policy;begin
 actor:=private.owner_pin_actor();select * into policy from private.owner_pin_policy where enabled;
 select * into c from private.owner_pin_credentials where actor_id=actor for update;
 if policy.tenant_id is null or c.actor_id is null or p_nonce is null or c.attempt_nonce is distinct from p_nonce
  or c.attempt_request is distinct from p_request or c.attempt_decision is distinct from p_decision then return false;end if;
 update private.owner_pin_credentials set attempt_nonce=null,attempt_request=null,attempt_decision=null where actor_id=actor;
 if not coalesce(p_valid,false) or p_proof is null or p_proof !~ '^[a-f0-9]{64}$'
  or p_decision is null or (p_decision not in ('approved','refused') and p_decision !~ '^sale:[a-f0-9]{64}$') then
  insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'pin_failed',p_request);return false;end if;
 update private.owner_pin_credentials set failed_attempts=0,locked_until=null where actor_id=actor;
 if p_decision ~ '^sale:' then
  insert into private.owner_pin_sale_proofs values(private.request_tenant_id(),p_proof,actor,private.owner_pin_session(),
   p_request,substr(p_decision,6),c.phone_hash,clock_timestamp()+make_interval(secs=>policy.proof_seconds),false);
 else
  insert into private.owner_pin_proofs values(private.request_tenant_id(),p_proof,actor,private.owner_pin_session(),
   p_request,p_decision,c.phone_hash,clock_timestamp()+make_interval(secs=>policy.proof_seconds),false);
 end if;
 insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'proof_issued',p_request);
 return true;
end $$;
create function private.owner_pin_consume_sale(p_vehicle uuid,p_key uuid,p_expected text,p_status text,p_reason text,p_proof text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid;v_fingerprint text;begin
 if not exists(select 1 from private.owner_pin_policy where enabled) then return;end if;
 actor:=private.owner_pin_actor();
 v_fingerprint:=encode(sha256(convert_to(p_vehicle::text||chr(31)||p_key::text||chr(31)||p_expected||chr(31)||p_status||chr(31)||p_reason,'UTF8')),'hex');
 update private.owner_pin_sale_proofs set used=true where proof_hash=p_proof and actor_id=actor and vehicle_id=p_vehicle
  and fingerprint=v_fingerprint and session_id=private.owner_pin_session()
  and not used and expires_at>clock_timestamp()
  and phone_hash=encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex');
 if not found then raise exception 'OWNER_PIN_PROOF_REQUIRED' using errcode='42501';end if;
 insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'proof_consumed',p_vehicle);
end $$;
create function private.owner_pin_consume(p_request uuid,p_decision text,p_proof text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 if not exists(select 1 from private.owner_pin_policy where enabled) then return;end if;
 actor:=private.owner_pin_actor();
 update private.owner_pin_proofs set used=true where proof_hash=p_proof and actor_id=actor and request_id=p_request
  and decision=p_decision and session_id=private.owner_pin_session() and not used and expires_at>clock_timestamp()
  and phone_hash=encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex');
 if not found then raise exception 'OWNER_PIN_PROOF_REQUIRED' using errcode='42501';end if;
 insert into private.owner_pin_events(tenant_id,actor_id,action,target_id) values(private.request_tenant_id(),actor,'proof_consumed',p_request);
end $$;
grant create on schema private to autoguardian_pin_executor;
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'owner_pin_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,autoguardian_identity_login',f);
  execute format('alter function %s owner to autoguardian_pin_executor',f);
 end loop;
end $$;
revoke create on schema private from autoguardian_pin_executor;
grant execute on function private.owner_pin_status(),private.owner_pin_settings(jsonb),private.owner_pin_start_enrollment(uuid,text,text),private.owner_pin_finish_enrollment(uuid,text),
 private.owner_pin_begin_attempt(uuid,text,uuid),private.owner_pin_finish_attempt(uuid,text,uuid,boolean,text) to autoguardian_identity_login;
grant execute on function private.owner_pin_consume(uuid,text,text),private.owner_pin_consume_sale(uuid,uuid,text,text,text,text) to autoguardian_check_executor;
-- Every decision entry point passes the PIN gate when policy is enabled.
-- A raw legacy SQL call or basic-phone adapter cannot bypass it.
alter function private.decide_vehicle_check(uuid,text) rename to decide_vehicle_check_without_pin;
revoke execute on function private.decide_vehicle_check_without_pin(uuid,text) from autoguardian_identity_login,autoguardian_telecom_executor;
grant create on schema private to autoguardian_check_executor;
create function private.decide_vehicle_check(p_id uuid,p_decision text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.owner_pin_consume(p_id,p_decision,current_setting('autoguardian.owner_pin_proof',true));
 perform private.decide_vehicle_check_without_pin(p_id,p_decision);
end $$;
alter function private.decide_vehicle_check(uuid,text) owner to autoguardian_check_executor;
revoke create on schema private from autoguardian_check_executor;
revoke all on function private.decide_vehicle_check(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.decide_vehicle_check(uuid,text) to autoguardian_identity_login,autoguardian_telecom_executor;
alter function private.change_vehicle_sale(uuid,uuid,text,text,text) rename to change_vehicle_sale_without_pin;
revoke execute on function private.change_vehicle_sale_without_pin(uuid,uuid,text,text,text) from autoguardian_identity_login;
grant create on schema private to autoguardian_check_executor;
create function private.change_vehicle_sale(p_vehicle uuid,p_key uuid,p_expected text,p_status text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.owner_pin_consume_sale(p_vehicle,p_key,p_expected,p_status,p_reason,current_setting('autoguardian.owner_pin_proof',true));
 return private.change_vehicle_sale_without_pin(p_vehicle,p_key,p_expected,p_status,p_reason);
end $$;
alter function private.change_vehicle_sale(uuid,uuid,text,text,text) owner to autoguardian_check_executor;
revoke create on schema private from autoguardian_check_executor;
revoke all on function private.change_vehicle_sale(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.change_vehicle_sale(uuid,uuid,text,text,text) to autoguardian_identity_login;
-- USSD may verify a PIN for one request after the channel OTP. Raw PINs are
-- processed only in the backend and never persisted or accepted in SMS commands.
grant execute on function private.owner_pin_begin_attempt(uuid,text,uuid),private.owner_pin_finish_attempt(uuid,text,uuid,boolean,text) to autoguardian_telecom_executor;
grant select on private.owner_pin_policy to autoguardian_telecom_executor;
create policy telecom_pin_policy on private.owner_pin_policy for select to autoguardian_telecom_executor using(tenant_id=private.request_tenant_id());
create function private.telecom_pin_policy() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.owner_pin_policy where enabled)
$$;
create function private.telecom_pin_begin(p_channel text,p_phone text,p_reference text,p_decision text,p_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.telecom_channels;target uuid;credential text;begin
 if not exists(select 1 from private.vehicle_check_configuration where sample_enabled) then return null;end if;
 select * into c from private.telecom_channels where channel_key=p_channel and expires_at>clock_timestamp() and verified_at>clock_timestamp()-interval '5 minutes';
 if c.channel_key is null or private.telecom_phone_account(p_phone) is distinct from c.auth_user_id or private.telecom_resolve(p_phone) is null then return null;end if;
 select request_id into target from private.telecom_references where auth_user_id=c.auth_user_id and reference=upper(p_reference) and expires_at>clock_timestamp();
 if target is null then return null;end if;
 perform set_config('autoguardian.auth_user_id',c.auth_user_id::text,true);perform set_config('autoguardian.telecom_channel',p_channel,true);
 credential:=private.owner_pin_begin_attempt(target,p_decision,p_nonce);
 return case when credential is null then null else jsonb_build_object('credential',credential,'requestId',target) end;
end $$;
create function private.telecom_pin_finish(p_channel text,p_phone text,p_reference text,p_decision text,p_nonce uuid,p_valid boolean,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.telecom_channels;target uuid;begin
 if not exists(select 1 from private.vehicle_check_configuration where sample_enabled) then return false;end if;
 select * into c from private.telecom_channels where channel_key=p_channel and expires_at>clock_timestamp() and verified_at>clock_timestamp()-interval '5 minutes';
 if c.channel_key is null or private.telecom_phone_account(p_phone) is distinct from c.auth_user_id or private.telecom_resolve(p_phone) is null then return false;end if;
 select request_id into target from private.telecom_references where auth_user_id=c.auth_user_id and reference=upper(p_reference) and expires_at>clock_timestamp();
 if target is null then return false;end if;
 perform set_config('autoguardian.auth_user_id',c.auth_user_id::text,true);perform set_config('autoguardian.telecom_channel',p_channel,true);
 if not private.owner_pin_finish_attempt(target,p_decision,p_nonce,p_valid,p_hash) then return false;end if;
 perform set_config('autoguardian.owner_pin_proof',p_hash,true);perform private.decide_vehicle_check(target,p_decision);
 perform set_config('autoguardian.owner_pin_proof','',true);return true;
exception when sqlstate '42501' or sqlstate '23514' or sqlstate 'P0002' then return false;
end $$;
grant create on schema private to autoguardian_telecom_executor;
do $$ declare f regprocedure;begin
 foreach f in array array['private.telecom_pin_policy()'::regprocedure,'private.telecom_pin_begin(text,text,text,text,uuid)'::regprocedure,
  'private.telecom_pin_finish(text,text,text,text,uuid,boolean,text)'::regprocedure] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  execute format('alter function %s owner to autoguardian_telecom_executor',f);
  execute format('grant execute on function %s to autoguardian_identity_login',f);
 end loop;
end $$;
revoke create on schema private from autoguardian_telecom_executor;
revoke autoguardian_billing_executor from current_user;
commit;
