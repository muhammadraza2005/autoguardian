-- Run once after 029 as schema owner. User-approved policy: alert-only backups,
-- vehicle-specific seller mandates and listings capped at 30 days. No live gates enabled.
begin;
grant create on schema private to autoguardian_check_executor;
grant execute on function private.sms_verified_phone(uuid),private.telecom_phone_account(text) to autoguardian_check_executor;

create table private.vehicle_relationships (
 id uuid primary key,tenant_id uuid not null,vehicle_id uuid not null,ownership_id uuid not null,
 owner_actor uuid not null,kind text not null check(kind in ('backup','seller')),
 recipient_phone_hash text not null check(recipient_phone_hash ~ '^[a-f0-9]{64}$'),
 recipient_id uuid,state text not null default 'invited' check(state in ('invited','accepted','revoked')),
 created_at timestamptz not null default clock_timestamp(),accepted_at timestamptz,revoked_at timestamptz,
 consent_version text check(consent_version='alert-only-v1'),
 expires_at timestamptz,invitation_expires_at timestamptz not null default clock_timestamp()+interval '30 days',
 foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id),
 foreign key(tenant_id,ownership_id) references app.ownerships(tenant_id,id),
 foreign key(tenant_id,owner_actor) references app.users(tenant_id,id),
 foreign key(tenant_id,recipient_id) references app.users(tenant_id,id),
 check(kind<>'seller' or expires_at is not null)
);
create unique index vehicle_relationship_one_active on private.vehicle_relationships(tenant_id,vehicle_id,kind) where state in ('invited','accepted');
create table private.relationship_challenges (
 id uuid primary key,tenant_id uuid not null,relationship_id uuid not null references private.vehicle_relationships(id),
 actor_id uuid not null,session_id text not null,phone_hash text not null,otp_hash text not null check(otp_hash ~ '^[a-f0-9]{64}$'),
 attempts integer not null default 0,used boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '3 minutes'
);
create table private.relationship_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,relationship_id uuid not null references private.vehicle_relationships(id),
 actor_id uuid not null,action text not null check(action in ('invited','accepted','revoked','expired')),
 created_at timestamptz not null default clock_timestamp()
);
create table private.vehicle_sale_listings (
 tenant_id uuid not null,vehicle_id uuid not null,ownership_id uuid not null,
 listed_at timestamptz not null,expires_at timestamptz not null,active boolean not null,
 primary key(tenant_id,vehicle_id),foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id)
);
do $$ declare t text;begin
 foreach t in array array['vehicle_relationships','relationship_challenges','relationship_events','vehicle_sale_listings'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,autoguardian_identity_login',t);
  execute format('grant select,insert on private.%I to autoguardian_check_executor',t);
  execute format('create policy relationship_scope on private.%I to autoguardian_check_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id())',t);
  if t<>'relationship_events' then execute format('grant update on private.%I to autoguardian_check_executor',t);end if;
 end loop;
end $$;

-- No owner/seller/backup permissions are conferred by a phone number alone.
create function private.relationship_actor() returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid;phone text;begin
 if not private.access_session_valid(false) then raise exception 'RELATIONSHIP_SESSION_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from private.vehicle_check_configuration where sample_enabled) then raise exception 'RELATIONSHIP_SANDBOX_REQUIRED' using errcode='42501';end if;
 phone:=private.sms_verified_phone(private.request_auth_user_id());
 if phone is null or private.telecom_phone_account(phone) is distinct from private.request_auth_user_id() then raise exception 'RELATIONSHIP_PHONE_REQUIRED' using errcode='42501';end if;
 select u.id into actor from app.users u join app.tenants t on t.id=u.tenant_id
  where u.auth_user_id=private.request_auth_user_id() and u.status='ACTIVE' and u.deleted_at is null and t.status='ACTIVE' and t.deleted_at is null;
 if actor is null then raise exception 'RELATIONSHIP_ACCESS_DENIED' using errcode='42501';end if;
 return actor;
end $$;

create function private.relationship_current(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.vehicle_relationships r join app.ownerships s on s.id=r.ownership_id and s.tenant_id=r.tenant_id
  join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id join app.vehicles v on v.id=r.vehicle_id and v.tenant_id=r.tenant_id
  where r.id=p_id and r.state in ('invited','accepted') and (r.expires_at is null or r.expires_at>clock_timestamp())
   and s.vehicle_id=r.vehicle_id and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp()
   and o.user_id=r.owner_actor and o.deleted_at is null and v.deleted_at is null and v.record_status<>'ARCHIVED'
   and (r.state='invited' or exists(select 1 from app.users u where u.id=r.recipient_id and u.tenant_id=r.tenant_id and u.status='ACTIVE' and u.deleted_at is null
    and r.recipient_phone_hash=encode(sha256(convert_to(private.sms_verified_phone(u.auth_user_id),'UTF8')),'hex')
    and private.telecom_phone_account(private.sms_verified_phone(u.auth_user_id))=u.auth_user_id)))
$$;

create function private.relationship_invite(p_id uuid,p_vehicle uuid,p_kind text,p_phone_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;r private.vehicle_relationships;s uuid;begin
 actor:=private.relationship_actor();
 if actor is distinct from private.workflow_owner(p_vehicle) then raise exception 'RELATIONSHIP_OWNER_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text,31));
 if p_id is null or p_kind is null or p_kind not in ('backup','seller') or p_phone_hash is null or p_phone_hash !~ '^[a-f0-9]{64}$'
  or p_phone_hash=encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex') then raise exception 'INVALID_RELATIONSHIP' using errcode='AG400';end if;
 select * into r from private.vehicle_relationships where id=p_id;
 if r.id is not null then
  if (r.vehicle_id,r.owner_actor,r.kind,r.recipient_phone_hash) is distinct from (p_vehicle,actor,p_kind,p_phone_hash) then raise exception 'RELATIONSHIP_KEY_CONFLICT' using errcode='AG409';end if;
  return jsonb_build_object('id',r.id,'state',r.state);
 end if;
 if (select count(*) from private.vehicle_relationships where owner_actor=actor and created_at>clock_timestamp()-interval '1 day')>=10 then raise exception 'RELATIONSHIP_LIMIT' using errcode='AG429';end if;
 select s1.id into s from app.ownerships s1 join private.owners o on o.id=s1.owner_id and o.tenant_id=s1.tenant_id
  where s1.vehicle_id=p_vehicle and s1.end_at is null and s1.deleted_at is null and s1.start_at<=clock_timestamp() and o.user_id=actor and o.deleted_at is null;
 if p_kind='seller' then
  if not exists(select 1 from app.vehicles where id=p_vehicle and sale_status='NOT_FOR_SALE' and record_status='ACTIVE') then raise exception 'STATUS_TRANSITION_DENIED' using errcode='AG409';end if;
  perform private.owner_pin_consume_sale(p_vehicle,p_id,'NOT_FOR_SALE','AGENT_SALE','seller-mandate:'||p_phone_hash,current_setting('autoguardian.owner_pin_proof',true));
 end if;
 -- Free the single active slot only for expired or stale ownership relationships.
 update private.vehicle_relationships set state='revoked',revoked_at=clock_timestamp() where vehicle_id=p_vehicle and kind=p_kind and state in ('invited','accepted')
  and (not private.relationship_current(id) or (state='invited' and invitation_expires_at<=clock_timestamp()));
 insert into private.vehicle_relationships(id,tenant_id,vehicle_id,ownership_id,owner_actor,kind,recipient_phone_hash,expires_at)
  values(p_id,private.request_tenant_id(),p_vehicle,s,actor,p_kind,p_phone_hash,case when p_kind='seller' then clock_timestamp()+interval '30 days' end);
 insert into private.relationship_events(tenant_id,relationship_id,actor_id,action) values(private.request_tenant_id(),p_id,actor,'invited');
 return jsonb_build_object('id',p_id,'state','invited');
end $$;

create function private.relationship_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid;phone_hash text;items jsonb;begin
 actor:=private.relationship_actor();phone_hash:=encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex');
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'vehicleId',r.vehicle_id,'plate',case when private.relationship_current(r.id) then (select current_plate from app.vehicles where id=r.vehicle_id) end,'kind',r.kind,'state',r.state,'asOwner',r.owner_actor=actor,
  'current',private.relationship_current(r.id) and (r.state<>'invited' or r.invitation_expires_at>clock_timestamp()),'expiresAt',r.expires_at,
  'consentVersion','alert-only-v1','canApprove',false) order by r.created_at desc),'[]') into items
  from (select * from private.vehicle_relationships where owner_actor=actor or recipient_id=actor or (state='invited' and recipient_phone_hash=phone_hash) order by created_at desc limit 100) r;
 return jsonb_build_object('items',items,'sampleOnly',true);
end $$;

create function private.relationship_start_acceptance(p_id uuid,p_challenge uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;phone text;r private.vehicle_relationships;begin
 actor:=private.relationship_actor();phone:=private.sms_verified_phone(private.request_auth_user_id());
 select * into r from private.vehicle_relationships where id=p_id;
 perform 1 from app.vehicles where id=r.vehicle_id for update;
 select * into r from private.vehicle_relationships where id=p_id for update;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text,32));
 if not private.relationship_current(p_id) or r.state<>'invited' or r.invitation_expires_at<=clock_timestamp()
  or r.owner_actor=actor or r.recipient_phone_hash<>encode(sha256(convert_to(phone,'UTF8')),'hex') then raise exception 'RELATIONSHIP_UNAVAILABLE' using errcode='42501';end if;
 if p_challenge is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_RELATIONSHIP' using errcode='AG400';end if;
 if exists(select 1 from private.relationship_challenges where actor_id=actor and created_at>clock_timestamp()-interval '1 minute') then raise exception 'RELATIONSHIP_COOLDOWN' using errcode='AG429';end if;
 update private.relationship_challenges set used=true where relationship_id=p_id and actor_id=actor;
 insert into private.relationship_challenges(id,tenant_id,relationship_id,actor_id,session_id,phone_hash,otp_hash)
  values(p_challenge,private.request_tenant_id(),p_id,actor,current_setting('autoguardian.session_id'),r.recipient_phone_hash,p_hash);
 return jsonb_build_object('challengeId',p_challenge,'phone',phone);
end $$;

create function private.relationship_finish_acceptance(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.relationship_challenges;r private.vehicle_relationships;begin
 actor:=private.relationship_actor();select * into c from private.relationship_challenges where id=p_id and actor_id=actor;
 select * into r from private.vehicle_relationships where id=c.relationship_id;
 perform 1 from app.vehicles where id=r.vehicle_id for update;
 select * into r from private.vehicle_relationships where id=c.relationship_id for update;
 select * into c from private.relationship_challenges where id=p_id and actor_id=actor for update;
 if c.id is null or c.used or c.expires_at<=clock_timestamp() or c.attempts>=5 or c.session_id<>current_setting('autoguardian.session_id')
  or c.phone_hash<>encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex')
  or not private.relationship_current(r.id) or r.state<>'invited' or r.invitation_expires_at<=clock_timestamp() then return false;end if;
 update private.relationship_challenges set attempts=attempts+1 where id=p_id;
 if p_hash is null or p_hash<>c.otp_hash then return false;end if;
 if r.kind='seller' then
  if not exists(select 1 from app.vehicles where id=r.vehicle_id and sale_status='NOT_FOR_SALE' and record_status='ACTIVE') then return false;end if;
  update app.vehicles set sale_status='AGENT_SALE' where id=r.vehicle_id;
  update private.vehicle_sale_listings set expires_at=least(expires_at,r.expires_at) where vehicle_id=r.vehicle_id;
  insert into private.vehicle_status_events(tenant_id,vehicle_id,actor_id,request_key,previous_status,new_status,reason)
   values(r.tenant_id,r.vehicle_id,actor,p_id,'NOT_FOR_SALE','AGENT_SALE','Seller mandate accepted by OTP');
 end if;
 update private.relationship_challenges set used=true where id=p_id;
 update private.vehicle_relationships set state='accepted',recipient_id=actor,accepted_at=clock_timestamp(),consent_version='alert-only-v1' where id=r.id;
 insert into private.relationship_events(tenant_id,relationship_id,actor_id,action) values(r.tenant_id,r.id,actor,'accepted');return true;
end $$;

create function private.relationship_revoke(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid;r private.vehicle_relationships;phone_hash text;begin
 actor:=private.relationship_actor();phone_hash:=encode(sha256(convert_to(private.sms_verified_phone(private.request_auth_user_id()),'UTF8')),'hex');
 select * into r from private.vehicle_relationships where id=p_id;
 perform 1 from app.vehicles where id=r.vehicle_id for update;
 select * into r from private.vehicle_relationships where id=p_id for update;
 if r.id is null or (r.owner_actor is distinct from actor and r.recipient_id is distinct from actor
  and not (r.state='invited' and r.recipient_phone_hash=phone_hash)) then raise exception 'RELATIONSHIP_UNAVAILABLE' using errcode='42501';end if;
 -- A former owner can revoke a stale relationship, but cannot change the new owner's sale state.
 if r.kind='seller' and r.state='accepted' and private.relationship_current(r.id) then
  update app.vehicles set sale_status='NOT_FOR_SALE' where id=r.vehicle_id and sale_status='AGENT_SALE';
 end if;
 if r.state<>'revoked' then
  update private.vehicle_relationships set state='revoked',revoked_at=clock_timestamp() where id=p_id;
  insert into private.relationship_events(tenant_id,relationship_id,actor_id,action) values(r.tenant_id,r.id,actor,'revoked');
 end if;
 return true;
end $$;

-- Listing duration is captured at transition time; repeated reads never extend it.
create function private.track_vehicle_listing() returns trigger language plpgsql security definer set search_path='' as $$
declare ownership uuid;begin
 if new.sale_status is not distinct from old.sale_status then return new;end if;
 if new.sale_status in ('FOR_SALE','AGENT_SALE') then
  select id into ownership from app.ownerships where vehicle_id=new.id and end_at is null and deleted_at is null and start_at<=clock_timestamp();
  if ownership is null then raise exception 'LISTING_OWNERSHIP_REQUIRED' using errcode='23514';end if;
  insert into private.vehicle_sale_listings values(new.tenant_id,new.id,ownership,clock_timestamp(),clock_timestamp()+interval '30 days',true)
   on conflict(tenant_id,vehicle_id) do update set ownership_id=excluded.ownership_id,listed_at=excluded.listed_at,expires_at=excluded.expires_at,active=true;
 else
  update private.vehicle_sale_listings set active=false where vehicle_id=new.id;
  update private.vehicle_relationships set state='revoked',revoked_at=clock_timestamp() where vehicle_id=new.id and kind='seller' and state='accepted';
 end if;return new;
end $$;
create trigger vehicle_listing_duration after update of sale_status on app.vehicles for each row execute function private.track_vehicle_listing();

create function private.vehicle_listing_current(p_vehicle uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.vehicle_sale_listings l join app.ownerships s on s.id=l.ownership_id and s.tenant_id=l.tenant_id
  join app.vehicles v on v.id=l.vehicle_id and v.tenant_id=l.tenant_id
  where l.vehicle_id=p_vehicle and l.active and l.expires_at>clock_timestamp() and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp()
   and (v.sale_status='FOR_SALE' or (v.sale_status='AGENT_SALE' and exists(select 1 from private.vehicle_relationships r join app.users u on u.id=r.recipient_id and u.tenant_id=r.tenant_id
    where r.vehicle_id=p_vehicle and r.ownership_id=s.id and r.kind='seller' and r.state='accepted' and private.relationship_current(r.id)
     and u.status='ACTIVE' and u.deleted_at is null and r.recipient_phone_hash=encode(sha256(convert_to(private.sms_verified_phone(u.auth_user_id),'UTF8')),'hex')
     and private.telecom_phone_account(private.sms_verified_phone(u.auth_user_id))=u.auth_user_id))))
$$;

-- Read projection for the existing restricted owned-vehicle reader. It cannot
-- expose other owners' sale status or modify a listing while reading.
create function private.owned_vehicle_sale_status(p_vehicle uuid) returns text language sql stable security definer set search_path='' as $$
 select case when v.sale_status in ('FOR_SALE','AGENT_SALE') and not private.vehicle_listing_current(v.id)
  then 'NOT_FOR_SALE' else v.sale_status end
 from app.vehicles v join app.ownerships s on s.vehicle_id=v.id and s.tenant_id=v.tenant_id
 join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id join app.users u on u.id=o.user_id and u.tenant_id=o.tenant_id
 where v.id=p_vehicle and u.auth_user_id=private.request_auth_user_id() and u.status='ACTIVE' and u.deleted_at is null
  and v.deleted_at is null and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp() and o.deleted_at is null
$$;

create function private.expire_vehicle_listing(p_vehicle uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;previous text;begin
 select sale_status into previous from app.vehicles where id=p_vehicle for update;
 if previous not in ('FOR_SALE','AGENT_SALE') then return;end if;
 if private.vehicle_listing_current(p_vehicle) then return;end if;
 select o.user_id into actor from app.ownerships s join private.owners o on o.id=s.owner_id and o.tenant_id=s.tenant_id
  where s.vehicle_id=p_vehicle and s.end_at is null and s.deleted_at is null and s.start_at<=clock_timestamp() and o.deleted_at is null;
 update app.vehicles set sale_status='NOT_FOR_SALE' where id=p_vehicle;
 if actor is not null then insert into private.vehicle_status_events(tenant_id,vehicle_id,actor_id,request_key,previous_status,new_status,reason)
  values(private.request_tenant_id(),p_vehicle,actor,gen_random_uuid(),previous,'NOT_FOR_SALE','Listing expired or ownership changed');end if;
end $$;

-- Buyer reads enforce expiry even if the periodic worker is delayed.
alter function private.read_vehicle_check(uuid) rename to read_vehicle_check_before_listing_expiry;
revoke all on function private.read_vehicle_check_before_listing_expiry(uuid) from autoguardian_identity_login,autoguardian_telecom_executor;
create function private.read_vehicle_check(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;vehicle uuid;begin
 actor:=private.check_actor('VERIFIER');select vehicle_id into vehicle from private.vehicle_check_requests where id=p_id and buyer_id=actor;
 if vehicle is not null then perform private.expire_vehicle_listing(vehicle);end if;
 return private.read_vehicle_check_before_listing_expiry(p_id);
end $$;

-- The existing durable SMS ledger handles accepted backup alerts as well.
alter table private.vehicle_check_notifications drop constraint vehicle_check_notifications_kind_check;
alter table private.vehicle_check_notifications add constraint vehicle_check_notifications_kind_check check(kind in ('owner_request','owner_reminder','buyer_result','backup_alert'));
create function private.backup_alert_recipient_valid(p_request uuid,p_recipient uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.vehicle_check_requests q join private.vehicle_relationships r on r.vehicle_id=q.vehicle_id and r.tenant_id=q.tenant_id
  join app.users u on u.id=r.recipient_id and u.tenant_id=r.tenant_id
  where q.id=p_request and q.outcome='pending' and q.response_deadline_at>clock_timestamp()
   and r.kind='backup' and r.state='accepted' and r.recipient_id=p_recipient and r.ownership_id=q.ownership_id and private.relationship_current(r.id)
   and u.status='ACTIVE' and u.deleted_at is null
   and r.recipient_phone_hash=encode(sha256(convert_to(private.sms_verified_phone(u.auth_user_id),'UTF8')),'hex')
   and private.telecom_phone_account(private.sms_verified_phone(u.auth_user_id))=u.auth_user_id)
$$;
grant execute on function private.backup_alert_recipient_valid(uuid,uuid) to autoguardian_sms_executor;

alter function private.sweep_vehicle_checks(integer) rename to sweep_vehicle_checks_before_relationships;
revoke all on function private.sweep_vehicle_checks_before_relationships(integer) from autoguardian_identity_login;
create function private.sweep_vehicle_checks(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;v record;j record;recipient uuid;queued integer:=0;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_CHECK_PAGE' using errcode='AG400';end if;
 if not exists(select 1 from app.tenants where status='ACTIVE' and deleted_at is null) then raise exception 'CHECK_ACCESS_DENIED' using errcode='42501';end if;
 for v in select id from app.vehicles where sale_status in ('FOR_SALE','AGENT_SALE') and not private.vehicle_listing_current(id)
  order by id limit p_limit for update skip locked loop perform private.expire_vehicle_listing(v.id);end loop;
 result:=private.sweep_vehicle_checks_before_relationships(p_limit);
 for j in select a.id,a.request_id,q.vehicle_id,q.ownership_id from private.check_alert_jobs a join private.vehicle_check_requests q on q.id=a.request_id and q.tenant_id=a.tenant_id
  where a.kind='backup' and a.state='awaiting_configuration' and a.due_at<=clock_timestamp() and q.outcome='pending' and q.response_deadline_at>clock_timestamp()
  order by a.id limit p_limit loop
  perform 1 from app.vehicles where id=j.vehicle_id for update skip locked;if not found then continue;end if;
  perform 1 from private.vehicle_check_requests where id=j.request_id and outcome='pending' and response_deadline_at>clock_timestamp() for update;
  if not found then continue;end if;
  select r.recipient_id into recipient from private.vehicle_relationships r where r.vehicle_id=j.vehicle_id and r.ownership_id=j.ownership_id and r.kind='backup'
   and r.state='accepted' and private.backup_alert_recipient_valid(j.request_id,r.recipient_id);
  if recipient is not null then
   insert into private.vehicle_check_notifications(tenant_id,request_id,recipient_id,kind,available_at)
    values(private.request_tenant_id(),j.request_id,recipient,'backup_alert',clock_timestamp()) on conflict(request_id,kind) do nothing;
   update private.check_alert_jobs set state='recorded' where id=j.id;queued:=queued+1;
  end if;
 end loop;
 return result||jsonb_build_object('backupAlertsQueued',queued);
end $$;

grant create on schema private to autoguardian_sms_executor;
do $$ declare definition text;begin
 select pg_get_functiondef('private.sms_claim_notification(text,text[])'::regprocedure) into definition;
 if position('or (n.kind=''buyer_result''' in definition)=0 or position('if not exists(select 1 from app.role_assignments' in definition)=0 then raise exception 'SMS_CLAIM_DEFINITION_CHANGED';end if;
 definition:=replace(definition,'or (n.kind=''buyer_result''','or (n.kind=''backup_alert'' and not private.backup_alert_recipient_valid(r.id,n.recipient_id)) or (n.kind=''buyer_result''');
 definition:=replace(definition,'if not exists(select 1 from app.role_assignments','if n.kind<>''backup_alert'' and not exists(select 1 from app.role_assignments');
 execute definition;
end $$;
revoke create on schema private from autoguardian_sms_executor;
-- Existing outcome trigger also cancels queued backup alerts immediately.
do $$ declare definition text;begin
 select pg_get_functiondef('private.cancel_check_alert_jobs()'::regprocedure) into definition;
 execute replace(definition,'kind=''owner_reminder''','kind in (''owner_reminder'',''backup_alert'')');
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array[
  'relationship_actor','relationship_current','relationship_invite','relationship_list','relationship_start_acceptance','relationship_finish_acceptance','relationship_revoke',
  'track_vehicle_listing','vehicle_listing_current','owned_vehicle_sale_status','expire_vehicle_listing','read_vehicle_check','backup_alert_recipient_valid','sweep_vehicle_checks']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  execute format('alter function %s owner to autoguardian_check_executor',f);
 end loop;
end $$;
grant execute on function private.relationship_invite(uuid,uuid,text,text),private.relationship_list(),private.relationship_start_acceptance(uuid,uuid,text),
 private.relationship_finish_acceptance(uuid,text),private.relationship_revoke(uuid),private.read_vehicle_check(uuid),private.sweep_vehicle_checks(integer) to autoguardian_identity_login;
grant execute on function private.read_vehicle_check(uuid) to autoguardian_telecom_executor;
grant execute on function private.owned_vehicle_sale_status(uuid) to autoguardian_vehicle_reader;
revoke create on schema private from autoguardian_check_executor;
commit;
