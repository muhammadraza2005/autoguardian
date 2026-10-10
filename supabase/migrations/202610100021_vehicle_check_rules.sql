-- Run once as postgres after existing migrations through 020. No hosted changes
-- or provider setup are performed by this file. Only synthetic checks can be
-- enabled until billing and owner step-up rules are integrated.
begin;
create role autoguardian_check_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_check_executor to current_user;
grant usage on schema app, private to autoguardian_check_executor;
grant execute on function private.request_tenant_id(),private.request_auth_user_id() to autoguardian_check_executor;

create table private.vehicle_check_configuration (
  tenant_id uuid primary key references app.tenants(id),
  sample_enabled boolean not null default false,
  response_seconds integer not null check(response_seconds between 1 and 86400),
  result_validity_seconds integer not null check(result_validity_seconds between 1 and 604800)
);
create table private.vehicle_check_requests (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
  buyer_id uuid not null,vehicle_id uuid not null,ownership_id uuid not null,owner_id uuid not null,
  request_key uuid not null,outcome text not null default 'pending'
    check(outcome in ('pending','approved','refused','timed_out')),
  created_at timestamptz not null,response_deadline_at timestamptz not null,
  responded_at timestamptz,result_expires_at timestamptz,
  result_validity_seconds integer not null check(result_validity_seconds between 1 and 604800),
  unique(tenant_id,id),unique(tenant_id,buyer_id,request_key),
  foreign key(tenant_id,buyer_id) references app.users(tenant_id,id),
  foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id),
  foreign key(tenant_id,ownership_id) references app.ownerships(tenant_id,id),
  foreign key(tenant_id,owner_id) references private.owners(tenant_id,id),
  check(response_deadline_at>created_at),
  check((outcome='pending' and responded_at is null and result_expires_at is null)
    or (outcome in ('approved','refused') and responded_at is not null and result_expires_at is not null and responded_at>=created_at
      and responded_at<response_deadline_at and result_expires_at=responded_at+make_interval(secs=>result_validity_seconds))
    or (outcome='timed_out' and responded_at is null and result_expires_at is not null
      and result_expires_at=response_deadline_at+make_interval(secs=>result_validity_seconds)))
);
create index vehicle_check_pending_deadlines on private.vehicle_check_requests(response_deadline_at) where outcome='pending';
create index vehicle_check_owner_queue on private.vehicle_check_requests(tenant_id,owner_id,created_at);
create table private.vehicle_check_decisions (
  request_id uuid primary key,tenant_id uuid not null,actor_id uuid not null,
  decision text not null check(decision in ('approved','refused')),decided_at timestamptz not null,
  foreign key(tenant_id,request_id) references private.vehicle_check_requests(tenant_id,id),
  foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
create table private.vehicle_check_events (
  id bigint generated always as identity primary key,tenant_id uuid not null,request_id uuid not null,
  actor_id uuid not null,action text not null check(action in ('created','approved','refused','timed_out')),
  created_at timestamptz not null,
  unique(request_id,action),
  foreign key(tenant_id,request_id) references private.vehicle_check_requests(tenant_id,id),
  foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
-- Durable outbox, not a decision record. No phone, owner name or provider secret.
-- Twilio module will add restricted dispatch/receipt operations.
create table private.vehicle_check_notifications (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,request_id uuid not null,
  recipient_id uuid not null,kind text not null check(kind in ('owner_request','buyer_result')),
  delivery_status text not null default 'queued' check(delivery_status in ('queued','sent','delivered','failed','cancelled')),
  attempts integer not null default 0 check(attempts>=0),available_at timestamptz not null,
  provider_message_id text,last_error_code text,
  unique(request_id,kind),
  foreign key(tenant_id,request_id) references private.vehicle_check_requests(tenant_id,id),
  foreign key(tenant_id,recipient_id) references app.users(tenant_id,id)
);

-- Auth is provider-owned. This administrator-owned gateway exposes only a
-- Boolean for the verified request actor, never Auth rows or phone numbers.
create function private.check_phone_verified() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=private.request_auth_user_id()
    and nullif(phone,'') is not null and phone_confirmed_at is not null)
$$;
revoke all on function private.check_phone_verified() from public,anon,authenticated,service_role;
grant execute on function private.check_phone_verified() to autoguardian_check_executor;

-- Executor policies scope all dependencies to the trusted backend tenant.
-- This role is never granted to the runtime login; only reviewed functions run
-- as it. Actor/relationship rules are enforced inside those functions.
grant select(id,status,deleted_at) on app.tenants to autoguardian_check_executor;
grant select(id,tenant_id,auth_user_id,status,deleted_at) on app.users to autoguardian_check_executor;
grant select(tenant_id,user_id,role_code,organization_id,valid_from,valid_to,deleted_at)
  on app.role_assignments to autoguardian_check_executor;
grant select(id,tenant_id,user_id,deleted_at) on private.owners to autoguardian_check_executor;
grant select on app.ownerships to autoguardian_check_executor;
grant select(id,tenant_id,chassis_identifier,current_plate,category,make,model,manufacture_year,color,
  sale_status,record_status,deleted_at) on app.vehicles to autoguardian_check_executor;
grant update(id) on app.vehicles to autoguardian_check_executor;
do $$ declare t text; begin
  foreach t in array array['app.tenants','app.users','app.role_assignments','app.vehicles','app.ownerships','private.owners'] loop
    execute format('create policy check_executor_read on %s for select to autoguardian_check_executor using (%s = private.request_tenant_id())',t,case when t='app.tenants' then 'id' else 'tenant_id' end);
  end loop;
end $$;
create policy check_executor_vehicle_lock on app.vehicles for update to autoguardian_check_executor
  using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
do $$ declare t text; begin
  foreach t in array array['vehicle_check_configuration','vehicle_check_requests','vehicle_check_decisions','vehicle_check_events','vehicle_check_notifications'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on private.%I to autoguardian_check_executor',t);
    execute format('create policy check_executor_read on private.%I for select to autoguardian_check_executor using(tenant_id=private.request_tenant_id())',t);
    if t<>'vehicle_check_configuration' then
      execute format('grant insert on private.%I to autoguardian_check_executor',t);
      execute format('create policy check_executor_append on private.%I for insert to autoguardian_check_executor with check(tenant_id=private.request_tenant_id())',t);
    end if;
  end loop;
end $$;
grant usage on sequence private.vehicle_check_events_id_seq to autoguardian_check_executor;
grant update(outcome,responded_at,result_expires_at) on private.vehicle_check_requests to autoguardian_check_executor;
grant update(delivery_status) on private.vehicle_check_notifications to autoguardian_check_executor;
create policy check_executor_transition on private.vehicle_check_requests for update to autoguardian_check_executor
  using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create policy check_executor_cancel on private.vehicle_check_notifications for update to autoguardian_check_executor
  using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());

create function private.check_actor(p_role text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid;
begin
  select u.id into actor from app.users u join app.tenants t on t.id=u.tenant_id
    where u.auth_user_id=private.request_auth_user_id() and u.status='ACTIVE' and u.deleted_at is null
      and t.status='ACTIVE' and t.deleted_at is null;
  if actor is null or not private.check_phone_verified() or not exists(select 1 from app.role_assignments
    where user_id=actor and role_code=p_role and organization_id is null and deleted_at is null
      and valid_from<=clock_timestamp() and (valid_to is null or valid_to>clock_timestamp())) then
    raise exception 'CHECK_ACCESS_DENIED' using errcode='42501';
  end if;
  return actor;
end $$;

create function private.finish_vehicle_check(p_id uuid,p_outcome text,p_actor uuid,p_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare r private.vehicle_check_requests;
begin
  select * into strict r from private.vehicle_check_requests where id=p_id for update;
  if r.outcome<>'pending' then raise exception 'CHECK_ALREADY_ANSWERED' using errcode='23514'; end if;
  update private.vehicle_check_requests set outcome=p_outcome,
    responded_at=case when p_outcome='timed_out' then null else p_at end,
    result_expires_at=(case when p_outcome='timed_out' then r.response_deadline_at else p_at end)
      +make_interval(secs=>r.result_validity_seconds) where id=p_id;
  if p_outcome in ('approved','refused') then
    insert into private.vehicle_check_decisions values(p_id,r.tenant_id,p_actor,p_outcome,p_at);
  end if;
  insert into private.vehicle_check_events(tenant_id,request_id,actor_id,action,created_at)
    values(r.tenant_id,p_id,p_actor,p_outcome,p_at);
  update private.vehicle_check_notifications set delivery_status='cancelled'
    where request_id=p_id and kind='owner_request' and delivery_status='queued';
  insert into private.vehicle_check_notifications(tenant_id,request_id,recipient_id,kind,available_at)
    values(r.tenant_id,p_id,r.buyer_id,'buyer_result',p_at);
end $$;

create function private.create_vehicle_check(p_vehicle uuid,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; r private.vehicle_check_requests; c private.vehicle_check_configuration;
  own app.ownerships; recipient uuid; stamp timestamptz; result uuid;
begin
  actor:=private.check_actor('VERIFIER');
  select * into c from private.vehicle_check_configuration where sample_enabled;
  if c.tenant_id is null then raise exception 'CHECKS_NOT_CONFIGURED' using errcode='23514'; end if;
  if p_key is null then raise exception 'CHECK_KEY_REQUIRED' using errcode='23514'; end if;
  -- Same key is serialized even when concurrent callers specify different vehicles.
  perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||actor::text||p_key::text,0));
  select * into r from private.vehicle_check_requests where buyer_id=actor and request_key=p_key;
  if r.id is not null then
    if r.vehicle_id<>p_vehicle then raise exception 'CHECK_KEY_CONFLICT' using errcode='23514'; end if;
    return r.id;
  end if;
  perform 1 from app.vehicles where id=p_vehicle and deleted_at is null and record_status<>'ARCHIVED' for update;
  if not found then raise exception 'CHECK_NOT_FOUND' using errcode='P0002'; end if;
  actor:=private.check_actor('VERIFIER');
  select s.* into own from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
    join app.users u on u.id=o.user_id and u.tenant_id=o.tenant_id
    where s.vehicle_id=p_vehicle and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp()
      and o.deleted_at is null and u.status='ACTIVE' and u.deleted_at is null;
  if own.id is null then raise exception 'CHECK_NOT_FOUND' using errcode='P0002'; end if;
  select user_id into recipient from private.owners where id=own.owner_id;
  stamp:=clock_timestamp();
  insert into private.vehicle_check_requests(tenant_id,buyer_id,vehicle_id,ownership_id,owner_id,request_key,
    created_at,response_deadline_at,result_validity_seconds)
    values(c.tenant_id,actor,p_vehicle,own.id,own.owner_id,p_key,stamp,
      stamp+make_interval(secs=>c.response_seconds),c.result_validity_seconds) returning id into result;
  insert into private.vehicle_check_events(tenant_id,request_id,actor_id,action,created_at)
    values(c.tenant_id,result,actor,'created',stamp);
  insert into private.vehicle_check_notifications(tenant_id,request_id,recipient_id,kind,available_at)
    values(c.tenant_id,result,recipient,'owner_request',stamp);
  return result;
end $$;

create function private.decide_vehicle_check(p_id uuid,p_decision text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; r private.vehicle_check_requests; stamp timestamptz; vehicle uuid;
begin
  actor:=private.check_actor('OWNER');
  if p_decision is null or p_decision not in ('approved','refused') then raise exception 'INVALID_CHECK_DECISION' using errcode='23514'; end if;
  select vehicle_id into vehicle from private.vehicle_check_requests where id=p_id;
  -- Match transfer lock order: vehicle, then request. Recheck after lock waits.
  perform 1 from app.vehicles where id=vehicle for update;
  select * into r from private.vehicle_check_requests where id=p_id for update;
  actor:=private.check_actor('OWNER');
  if r.id is null or not exists(select 1 from private.owners o join app.ownerships s
    on s.owner_id=o.id and s.tenant_id=o.tenant_id where o.id=r.owner_id and o.user_id=actor
      and o.deleted_at is null and s.id=r.ownership_id and s.vehicle_id=r.vehicle_id
      and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp()) then
    raise exception 'CHECK_NOT_FOUND' using errcode='P0002';
  end if;
  if r.outcome<>'pending' then raise exception 'CHECK_ALREADY_ANSWERED' using errcode='23514'; end if;
  stamp:=clock_timestamp();
  if stamp>=r.response_deadline_at then raise exception 'CHECK_RESPONSE_LATE' using errcode='23514'; end if;
  -- Conservative unresolved SRS policy: unsafe records cannot authorize a sale.
  if p_decision='approved' and not exists(select 1 from app.vehicles where id=r.vehicle_id
    and deleted_at is null and record_status='ACTIVE' and sale_status<>'REPORTED_MISSING') then
    raise exception 'CHECK_APPROVAL_UNAVAILABLE' using errcode='23514';
  end if;
  perform private.finish_vehicle_check(p_id,p_decision,actor,stamp);
end $$;

create function private.read_vehicle_check(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; r private.vehicle_check_requests; stamp timestamptz; current_owner boolean;
  v record; safe jsonb; usable boolean; vehicle uuid;
begin
  -- Buyer reads only: owner inbox belongs to the later owner-alert module.
  actor:=private.check_actor('VERIFIER');
  select vehicle_id into vehicle from private.vehicle_check_requests where id=p_id and buyer_id=actor;
  select id,chassis_identifier,current_plate,category,make,model,manufacture_year,color,
    sale_status,record_status,deleted_at into v from app.vehicles where id=vehicle for update;
  select * into r from private.vehicle_check_requests where id=p_id and buyer_id=actor for update;
  actor:=private.check_actor('VERIFIER');
  if r.id is null then raise exception 'CHECK_NOT_FOUND' using errcode='P0002'; end if;
  stamp:=clock_timestamp();
  if r.outcome='pending' and stamp>=r.response_deadline_at then
    perform private.finish_vehicle_check(p_id,'timed_out',actor,stamp);
    select * into r from private.vehicle_check_requests where id=p_id;
  end if;
  current_owner:=exists(select 1 from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
    where s.id=r.ownership_id and s.vehicle_id=r.vehicle_id and s.owner_id=r.owner_id and s.end_at is null
      and s.deleted_at is null and s.start_at<=stamp and o.deleted_at is null);
  if v.deleted_at is null and v.record_status<>'ARCHIVED' and current_owner
      and (r.result_expires_at is null or r.result_expires_at>stamp) then
    safe:=jsonb_build_object('id',v.id,'chassisIdentifier',v.chassis_identifier,'plate',v.current_plate,
      'category',v.category,'make',v.make,'model',v.model,'manufactureYear',v.manufacture_year,
      'color',v.color,'saleStatus',v.sale_status,'recordStatus',v.record_status);
  end if;
  usable:=r.outcome='approved' and r.result_expires_at>stamp and safe is not null
    and v.record_status='ACTIVE' and v.sale_status<>'REPORTED_MISSING';
  return jsonb_build_object('id',r.id,'outcome',r.outcome,'responseDeadlineAt',r.response_deadline_at,
    'respondedAt',r.responded_at,'resultExpiresAt',r.result_expires_at,
    'expired',coalesce(r.result_expires_at<=stamp,false),'authorizationUsable',usable,
    'sampleOnly',true,'vehicle',safe);
end $$;

-- Restrict all newly created functions, including internal helpers. Only the
-- three reviewed operations are callable by the existing backend login.
-- A non-superuser schema owner (including hosted Supabase postgres) must grant
-- CREATE to the destination owner for ALTER FUNCTION OWNER. Remove it below.
grant create on schema private to autoguardian_check_executor;
do $$ declare f regprocedure; begin
  foreach f in array array['private.check_actor(text)'::regprocedure,
    'private.finish_vehicle_check(uuid,text,uuid,timestamptz)'::regprocedure,
    'private.create_vehicle_check(uuid,uuid)'::regprocedure,
    'private.decide_vehicle_check(uuid,text)'::regprocedure,
    'private.read_vehicle_check(uuid)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('alter function %s owner to autoguardian_check_executor',f);
  end loop;
end $$;
revoke create on schema private from autoguardian_check_executor;
grant usage on schema private to autoguardian_identity_login;
grant execute on function private.create_vehicle_check(uuid,uuid),private.decide_vehicle_check(uuid,text),
  private.read_vehicle_check(uuid) to autoguardian_identity_login;
commit;
