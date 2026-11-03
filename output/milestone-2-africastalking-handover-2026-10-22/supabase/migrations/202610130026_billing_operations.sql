-- Run after 025. Does not enable payments, SMS or offline access.
begin;
grant autoguardian_billing_executor to current_user;
grant create on schema private to autoguardian_billing_executor;

create table private.billing_policies (
 tenant_id uuid primary key references app.tenants(id),revision integer not null check(revision>0),
 body jsonb not null check(jsonb_typeof(body)='object'),approved_by uuid not null,approved_at timestamptz not null default clock_timestamp()
);
-- Separate durable records prevent sandbox confirmations, renewals and receipts
-- from entering the production pipeline, including during mixed-version rollout.
create table private.live_billing_payments (like private.billing_payments including defaults including constraints including indexes);
alter table private.live_billing_payments add column policy_snapshot jsonb not null;
alter table private.live_billing_payments add column draft_revision integer;
alter table private.live_billing_payments add column owner_generation integer;
alter table private.live_billing_payments add column fitting_revision integer;
create table private.live_billing_subscriptions (like private.billing_subscriptions including defaults including constraints including indexes);
create table private.live_billing_reminders (like private.billing_reminders including defaults including constraints including indexes);
create table private.billing_operations_audit (
 id bigint generated always as identity primary key,tenant_id uuid not null,actor_id uuid,payment_id uuid,
 action text not null,details jsonb not null default '{}',created_at timestamptz not null default clock_timestamp()
);
create table private.billing_settlement_imports (
 tenant_id uuid not null,source_reference text not null,body jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,source_reference)
);
create table private.billing_sms_outbox (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,actor_id uuid not null,vehicle_id uuid not null,payment_id uuid not null,
 status text not null default 'PENDING' check(status in ('PENDING','SENDING','SUBMITTED','FAILED','UNKNOWN','CANCELLED')),
 lease_id uuid,lease_until timestamptz,provider_reference text,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,payment_id)
);
do $$declare t text;begin
 foreach t in array array['billing_policies','live_billing_payments','live_billing_subscriptions','live_billing_reminders','billing_operations_audit','billing_settlement_imports','billing_sms_outbox'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,autoguardian_identity_login,autoguardian_billing_worker',t);
  execute format('grant select,insert on private.%I to autoguardian_billing_executor',t);
  execute format('create policy operations_read on private.%I for select to autoguardian_billing_executor using(tenant_id=private.request_tenant_id())',t);
  execute format('create policy operations_append on private.%I for insert to autoguardian_billing_executor with check(tenant_id=private.request_tenant_id())',t);
 end loop;
 foreach t in array array['billing_policies','live_billing_payments','live_billing_subscriptions','live_billing_reminders','billing_sms_outbox'] loop
  execute format('grant update on private.%I to autoguardian_billing_executor',t);
  execute format('create policy operations_update on private.%I for update to autoguardian_billing_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id())',t);
 end loop;
end $$;
grant usage,select on sequence private.billing_operations_audit_id_seq to autoguardian_billing_executor;
grant select on private.draft_seal_packages to autoguardian_billing_executor;
grant update(id) on app.enrollment_drafts to autoguardian_billing_executor;
create policy billing_draft_lock on app.enrollment_drafts for update to autoguardian_billing_executor
 using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create policy billing_fitting_read on private.draft_seal_packages for select to autoguardian_billing_executor using(tenant_id=private.request_tenant_id());
grant insert on private.enrollment_prerequisite_receipts to autoguardian_billing_executor;
grant usage,select on sequence private.enrollment_prerequisite_receipts_sequence_seq to autoguardian_billing_executor;
create policy billing_payment_receipt_append on private.enrollment_prerequisite_receipts for insert to autoguardian_billing_executor
 with check(tenant_id=private.request_tenant_id() and code='PAYMENT' and accepted and exists(select 1 from private.live_billing_payments p
  where p.target_id=draft_id and p.purpose='REGISTRATION' and p.status='COMPLETED' and p.target_revision=snapshot_revision
    and p.draft_revision=enrollment_prerequisite_receipts.draft_revision and p.owner_generation=enrollment_prerequisite_receipts.owner_generation and p.fitting_revision=enrollment_prerequisite_receipts.fitting_revision
    and trusted_reference='pawapay-live:'||p.id::text));

-- Receipt writers already have code-specific INSERT policies. Locking their
-- parent cannot depend on an interactive agent session: provider workers have
-- none. Other enrollment mutation freeze triggers retain their original owner.
create function private.billing_receipt_append_lock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from app.enrollment_drafts where id=new.draft_id and tenant_id=new.tenant_id for update;
 if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='AG404';end if;
 return new;
end $$;
alter function private.billing_receipt_append_lock() owner to autoguardian_billing_executor;
revoke all on function private.billing_receipt_append_lock() from public,anon,authenticated,service_role,autoguardian_identity_login,autoguardian_billing_worker;
drop trigger prerequisite_append_lock on private.enrollment_prerequisite_receipts;
create trigger prerequisite_append_lock before insert on private.enrollment_prerequisite_receipts for each row execute function private.billing_receipt_append_lock();

create function private.billing_policy(p_body jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.billing_policies;begin
 actor:=private.billing_actor(p_body is not null);
 if p_body is not null then
  perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text,26));
  select * into c from private.billing_policies for update;
  if p_revision is distinct from coalesce(c.revision,0) then raise exception 'POLICY_CHANGED' using errcode='AG409';end if;
  if jsonb_typeof(p_body) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_body))<>12
   or p_body-array['productionEnabled','billingRevision','approvalReference','receiptValidityDays','graceAccess','protectedFeatures','smsEnabled','smsEn','smsFr','receiptIdentity','offlineEnabled','offlineHours']<>'{}'::jsonb
   or jsonb_typeof(p_body->'productionEnabled') is distinct from 'boolean'
   or jsonb_typeof(p_body->'graceAccess') is distinct from 'boolean'
   or jsonb_typeof(p_body->'offlineEnabled') is distinct from 'boolean' or jsonb_typeof(p_body->'smsEnabled') is distinct from 'boolean'
   or exists(select 1 from unnest(array['billingRevision','receiptValidityDays','offlineHours']) k where jsonb_typeof(p_body->k) is distinct from 'number')
   or exists(select 1 from unnest(array['approvalReference','smsEn','smsFr']) k where jsonb_typeof(p_body->k) is distinct from 'string')
   or length(p_body->>'approvalReference')>200 or length(p_body->>'smsEn')>320 or length(p_body->>'smsFr')>320
   or nullif(btrim(p_body->>'approvalReference'),'') is null
   or (p_body->>'receiptValidityDays')::integer not between 1 and 366
   or (p_body->>'offlineHours')::integer not between 0 and 72
   or ((p_body->>'offlineEnabled')::boolean and (p_body->>'offlineHours')::integer=0)
   or jsonb_typeof(p_body->'protectedFeatures') is distinct from 'array'
   or jsonb_array_length(p_body->'protectedFeatures')>1
   or jsonb_typeof(p_body->'receiptIdentity') is distinct from 'object'
   or (select count(*) from jsonb_object_keys(p_body->'receiptIdentity'))<>3
   or exists(select 1 from unnest(array['businessName','address','registrationNumber']) k
     where jsonb_typeof(p_body->'receiptIdentity'->k) is distinct from 'string' or length(p_body->'receiptIdentity'->>k)>300)
   or nullif(btrim(p_body->'receiptIdentity'->>'businessName'),'') is null
   or nullif(btrim(p_body->'receiptIdentity'->>'address'),'') is null
   or nullif(btrim(p_body->'receiptIdentity'->>'registrationNumber'),'') is null
   or ((p_body->>'smsEnabled')::boolean and (nullif(btrim(p_body->>'smsEn'),'') is null or nullif(btrim(p_body->>'smsFr'),'') is null))
   or (p_body->'protectedFeatures') - 'institutional_lock'<>'[]'::jsonb
   then raise exception 'INVALID_POLICY' using errcode='AG400';end if;
  if not exists(select 1 from private.billing_configuration where revision=(p_body->>'billingRevision')::integer) then
   raise exception 'PRICES_CHANGED' using errcode='AG409';end if;
  insert into private.billing_policies(tenant_id,revision,body,approved_by) values(private.request_tenant_id(),coalesce(c.revision,0)+1,p_body,actor)
   on conflict(tenant_id) do update set revision=excluded.revision,body=excluded.body,approved_by=excluded.approved_by,approved_at=clock_timestamp();
  insert into private.billing_operations_audit(tenant_id,actor_id,action,details)
   values(private.request_tenant_id(),actor,'POLICY_APPROVED',jsonb_build_object('revision',coalesce(c.revision,0)+1,'reference',p_body->>'approvalReference'));
 end if;
 select * into c from private.billing_policies;
 return case when c.tenant_id is null then null else jsonb_build_object('revision',c.revision,'policy',c.body,'approvedAt',c.approved_at) end;
end $$;

create function private.billing_live_settings() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.billing_configuration;begin
 actor:=private.billing_actor(false);
 select v.* into c from private.billing_configuration v join private.billing_policies p on p.tenant_id=v.tenant_id
  where (p.body->>'productionEnabled')::boolean and (p.body->>'billingRevision')::integer=v.revision;
 return case when c.tenant_id is null then null else jsonb_build_object('productionEnabled',true,'currency',c.currency,
  'registrationFee',c.registration_fee::text,'renewalFee',c.renewal_fee::text,'sampleOnly',false) end;
end $$;
create function private.billing_live_entitlement(p_vehicle uuid,p_feature text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;policy jsonb;s private.live_billing_subscriptions;allowed boolean;state text;begin
 actor:=private.billing_actor(false);
 if p_feature<>'institutional_lock' or p_feature is null then raise exception 'INVALID_FEATURE' using errcode='AG400';end if;
 if not exists(select 1 from app.ownerships o join private.owners w on w.id=o.owner_id and w.tenant_id=o.tenant_id
   where o.vehicle_id=p_vehicle and w.user_id=actor and o.end_at is null and o.deleted_at is null and o.start_at<=clock_timestamp() and w.deleted_at is null) then
   raise exception 'ENTITLEMENT_DENIED' using errcode='AG403';end if;
 select body into policy from private.billing_policies;
 select * into s from private.live_billing_subscriptions where actor_id=actor and vehicle_id=p_vehicle;
 state:=case when s.vehicle_id is null then 'NONE' when clock_timestamp()<s.expires_at then 'ACTIVE' when clock_timestamp()<s.grace_until then 'GRACE' else 'SUSPENDED' end;
 allowed:=coalesce((policy->>'productionEnabled')::boolean,false) and (not coalesce(policy->'protectedFeatures'?p_feature,false)
   or state='ACTIVE' or (state='GRACE' and coalesce((policy->>'graceAccess')::boolean,false)));
 return jsonb_build_object('vehicleId',p_vehicle,'feature',p_feature,'allowed',allowed,'state',state,'sampleOnly',false);
end $$;

create function private.billing_settlement(p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;prior jsonb;row jsonb;p private.live_billing_payments;results jsonb:='[]';reason text;begin
 actor:=private.billing_actor(true);
 if p_body is null then return jsonb_build_object('items',coalesce((select jsonb_agg(body order by created_at desc) from
   (select body,created_at from private.billing_settlement_imports order by created_at desc limit 50) i),'[]'::jsonb));end if;
 if nullif(btrim(p_body->>'sourceReference'),'') is null or jsonb_typeof(p_body->'items')<>'array'
  or jsonb_array_length(p_body->'items') not between 1 and 1000 then raise exception 'INVALID_STATEMENT' using errcode='AG400';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||(p_body->>'sourceReference'),26));
 select body into prior from private.billing_settlement_imports where source_reference=p_body->>'sourceReference';
 if prior is not null then
  if prior->'input'<>p_body then raise exception 'STATEMENT_CHANGED' using errcode='AG409';end if;
  return prior->'result';
 end if;
 for row in select value from jsonb_array_elements(p_body->'items') loop
  select * into p from private.live_billing_payments where id=(row->>'depositId')::uuid;
  reason:=case when p.id is null then 'UNKNOWN_PAYMENT' when p.amount<>(row->>'amount')::numeric or p.currency<>row->>'currency' then 'AMOUNT_OR_CURRENCY'
   when p.status<>row->>'status' then 'STATUS' when p.provider_reference is distinct from row->>'providerReference' then 'PROVIDER_REFERENCE' else 'MATCHED' end;
  results:=results||jsonb_build_array(jsonb_build_object('depositId',row->>'depositId','result',reason));
 end loop;
 insert into private.billing_settlement_imports values(private.request_tenant_id(),p_body->>'sourceReference',jsonb_build_object('input',p_body,'result',jsonb_build_object('items',results)),clock_timestamp());
 insert into private.billing_operations_audit(tenant_id,actor_id,action,details) values(private.request_tenant_id(),actor,'SETTLEMENT_IMPORTED',jsonb_build_object('sourceReference',p_body->>'sourceReference','items',results));
 -- Imported statements never confirm payments or unlock registrations.
 return jsonb_build_object('items',results);
end $$;

create function private.billing_offline_lease() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;p private.billing_policies;stamp timestamptz:=clock_timestamp();organizations jsonb;begin
 actor:=private.billing_actor(false);
 if not private.access_session_valid(true) then raise exception 'STAFF_SESSION_REQUIRED' using errcode='AG403';end if;
 select * into p from private.billing_policies where (body->>'offlineEnabled')::boolean;
 if p.tenant_id is null then return null;end if;
 select jsonb_agg(r.organization_id) into organizations from app.role_assignments r where r.user_id=actor and r.role_code='ENROLLMENT_AGENT'
   and r.organization_id is not null and r.deleted_at is null and r.valid_from<=stamp and (r.valid_to is null or r.valid_to>stamp)
   and private.enrollment_agent_id(r.organization_id)=actor;
 if organizations is null then raise exception 'AGENT_ACCESS_DENIED' using errcode='AG403';end if;
 return jsonb_build_object('tenantId',private.request_tenant_id(),'actorId',actor,'authUserId',private.request_auth_user_id(),
  'sessionId',current_setting('autoguardian.session_id',true),'organizations',organizations,'policyRevision',p.revision,
  'issuedAt',stamp,'expiresAt',stamp+make_interval(hours=>(p.body->>'offlineHours')::integer),'readOnly',true);
end $$;

-- Production worker functions use isolated live tables.

create function private.billing_live_payment_view(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'purpose',p.purpose,'targetId',p.target_id,'targetRevision',p.target_revision,
 'amount',p.amount::text,'currency',p.currency,'status',p.status,'createdAt',p.created_at,'confirmedAt',p.confirmed_at,
 'providerReference',p.provider_reference,'receiptNumber',case when p.status='COMPLETED' then 'AG-'||p.id::text else null end,
 'receiptIdentity',case when p.status='COMPLETED' then p.policy_snapshot->'receiptIdentity' else null end,'sampleOnly',false)
 from private.live_billing_payments p where p.id=p_id
$$;

create function private.billing_live_begin(p_key uuid,p_purpose text,p_target uuid,p_revision integer,p_ciphertext text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;c private.billing_configuration;p private.live_billing_payments;d app.enrollment_drafts;fee numeric;policy jsonb;fit integer;begin
 actor:=private.billing_actor(false);
 if p_key is null or p_target is null or p_revision is null or p_revision<0 or p_purpose not in ('REGISTRATION','SUBSCRIPTION') then raise exception 'INVALID_BILLING_INPUT' using errcode='AG400';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||actor::text||p_purpose||p_target::text||p_revision::text,24));
 select * into p from private.live_billing_payments where actor_id=actor and request_key=p_key;
 if p.id is not null then
  if p.fingerprint<>p_fingerprint or p.purpose<>p_purpose or p.target_id<>p_target or p.target_revision<>p_revision then raise exception 'BILLING_KEY_CONFLICT' using errcode='AG409';end if;
  return private.billing_live_payment_view(p.id);
 end if;
 -- Recovery after losing the create response must not create a second charge.
 select * into p from private.live_billing_payments where actor_id=actor and purpose=p_purpose and target_id=p_target and target_revision=p_revision
   and (status in ('CREATED','PROCESSING') or (status='COMPLETED' and p_purpose<>'SUBSCRIPTION')) order by created_at desc limit 1;
 if p.id is not null then
  if p.fingerprint<>p_fingerprint then raise exception 'BILLING_OPERATION_PENDING' using errcode='AG409';end if;
  return private.billing_live_payment_view(p.id);
 end if;
 select body into policy from private.billing_policies where (body->>'productionEnabled')::boolean;
 select * into c from private.billing_configuration where revision=(policy->>'billingRevision')::integer;
 if c.tenant_id is null then raise exception 'BILLING_SETUP_REQUIRED' using errcode='AG409';end if;
 if p_purpose='REGISTRATION' then
  select * into d from app.enrollment_drafts where id=p_target for update;
  if d.id is null or d.created_by<>actor or private.enrollment_agent_id(d.organization_id) is distinct from actor then raise exception 'BILLING_TARGET_DENIED' using errcode='AG403';end if;
  if d.enrollment_mode<>'PRODUCTION' then raise exception 'PRODUCTION_DRAFT_REQUIRED' using errcode='AG409';end if;
  select coalesce(max(revision),0) into fit from private.draft_seal_packages where draft_id=d.id;
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
 insert into private.live_billing_payments(tenant_id,actor_id,request_key,purpose,target_id,target_revision,amount,currency,config_revision,
  period_days,grace_days,reminder_days,payer_ciphertext,fingerprint,policy_snapshot,draft_revision,owner_generation,fitting_revision)
 values(c.tenant_id,actor,p_key,p_purpose,p_target,p_revision,fee,c.currency,c.revision,c.period_days,c.grace_days,c.reminder_days,p_ciphertext,p_fingerprint,policy,d.revision,d.owner_generation,fit) returning * into p;
 insert into private.billing_operations_audit(tenant_id,payment_id,actor_id,action) values(c.tenant_id,p.id,actor,'CREATED');
 return private.billing_live_payment_view(p.id);
end $$;

create function private.billing_live_finish(p_id uuid,p_lease uuid,p_status text,p_amount numeric,p_currency text,p_reference text) returns void
language plpgsql security definer set search_path='' as $$
declare p private.live_billing_payments;s private.live_billing_subscriptions;stamp timestamptz:=clock_timestamp();until_at timestamptz;d app.enrollment_drafts;fit integer;begin
 select * into p from private.live_billing_payments where id=p_id for update;
 if p.id is null or p.lease_id is distinct from p_lease or p.lease_until<stamp then raise exception 'PAYMENT_LEASE_CHANGED' using errcode='AG409';end if;
 if p.status in ('COMPLETED','FAILED','DISCREPANCY') then return;end if;
 if p_status not in ('PROCESSING','COMPLETED','FAILED','DISCREPANCY') or p_status is null then raise exception 'INVALID_PAYMENT_STATUS' using errcode='AG400';end if;
 if p_amount is distinct from p.amount or p_currency is distinct from p.currency then p_status:='DISCREPANCY';end if;
 update private.live_billing_payments set status=p_status,provider_reference=left(p_reference,128),lease_id=null,lease_until=null,
  available_at=stamp+make_interval(secs=>least(3600,15*(2^least(p.attempts,7))::integer)),
  confirmed_at=case when p_status='COMPLETED' then stamp else null end where id=p.id;
 insert into private.billing_operations_audit(tenant_id,payment_id,action) values(p.tenant_id,p.id,p_status);
 if p_status='COMPLETED' and p.purpose='SUBSCRIPTION' then
  -- Subscription belongs to the purchasing owner; transfer never gives the former owner new access.
  perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||p.target_id::text||p.actor_id::text,24));
  select * into s from private.live_billing_subscriptions where vehicle_id=p.target_id and actor_id=p.actor_id for update;
  until_at:=greatest(stamp,coalesce(s.expires_at,stamp))+make_interval(days=>p.period_days);
  insert into private.live_billing_subscriptions(tenant_id,vehicle_id,actor_id,expires_at,grace_until,remind_at,payment_id)
   values(p.tenant_id,p.target_id,p.actor_id,until_at,until_at+make_interval(days=>p.grace_days),until_at-make_interval(days=>p.reminder_days),p.id)
   on conflict(tenant_id,vehicle_id,actor_id) do update set expires_at=excluded.expires_at,grace_until=excluded.grace_until,remind_at=excluded.remind_at,
    state='ACTIVE',reminder_created=false,payment_id=excluded.payment_id;
  update private.live_billing_reminders set acknowledged_at=stamp where vehicle_id=p.target_id and actor_id=p.actor_id and acknowledged_at is null;
 end if;
 if p_status='COMPLETED' and p.purpose='REGISTRATION' then
  select * into d from app.enrollment_drafts where id=p.target_id for update;
  select coalesce(max(revision),0) into fit from private.draft_seal_packages where draft_id=d.id;
  if d.enrollment_mode='PRODUCTION' and d.revision=p.draft_revision and d.owner_generation=p.owner_generation
    and d.enrollment_snapshot_revision=p.target_revision and fit=p.fitting_revision then
   insert into private.enrollment_prerequisite_receipts(tenant_id,draft_id,draft_revision,owner_generation,fitting_revision,snapshot_revision,code,accepted,trusted_reference,issued_at,expires_at)
    values(p.tenant_id,p.target_id,p.draft_revision,p.owner_generation,p.fitting_revision,p.target_revision,'PAYMENT',true,'pawapay-live:'||p.id::text,stamp,
      stamp+make_interval(days=>(p.policy_snapshot->>'receiptValidityDays')::integer));
  else
   insert into private.billing_operations_audit(tenant_id,payment_id,action) values(p.tenant_id,p.id,'REGISTRATION_PAYMENT_STALE');
  end if;
 end if;
end $$;

create function private.billing_live_sweep() returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;begin
 update private.live_billing_subscriptions set state=case when clock_timestamp()<expires_at then 'ACTIVE' when clock_timestamp()<grace_until then 'GRACE' else 'SUSPENDED' end;
 insert into private.live_billing_reminders(tenant_id,actor_id,vehicle_id,payment_id)
 select tenant_id,actor_id,vehicle_id,payment_id from private.live_billing_subscriptions where remind_at<=clock_timestamp() and not reminder_created
 on conflict(tenant_id,payment_id) do nothing;
 get diagnostics changed=row_count;
 update private.live_billing_subscriptions set reminder_created=true where remind_at<=clock_timestamp() and not reminder_created;
 -- Administrative subscription suspension NEVER stops resale alerts or rewrites vehicle status.
 return changed;
end $$;

create function private.billing_live_read(p_id uuid,p_admin boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 actor:=private.billing_actor(p_admin);
 if p_id is not null then
  if not exists(select 1 from private.live_billing_payments where id=p_id and (actor_id=actor or p_admin)) then raise exception 'PAYMENT_NOT_FOUND' using errcode='AG404';end if;
  return private.billing_live_payment_view(p_id);
 end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(private.billing_live_payment_view(id) order by created_at desc) from
  (select id,created_at from private.live_billing_payments where actor_id=actor or p_admin order by created_at desc limit 100) p),'[]'::jsonb),'sampleOnly',false);
end $$;

create function private.billing_live_reconcile(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;p private.live_billing_payments;begin
 actor:=private.billing_actor(true);
 select * into p from private.live_billing_payments where id=p_id for update;
 if p.id is null then raise exception 'PAYMENT_NOT_FOUND' using errcode='AG404';end if;
 if p.status in ('COMPLETED','FAILED') then return private.billing_live_payment_view(p.id);end if;
 if p.lease_until>clock_timestamp() then raise exception 'PAYMENT_LEASE_CHANGED' using errcode='AG409';end if;
 update private.live_billing_payments set status='PROCESSING',attempts=0,available_at=clock_timestamp(),lease_id=null,lease_until=null where id=p.id;
 insert into private.billing_operations_audit(tenant_id,payment_id,actor_id,action) values(p.tenant_id,p.id,actor,'RECONCILIATION_REQUESTED');
 return private.billing_live_payment_view(p.id);
end $$;

create function private.billing_live_claim(p_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.live_billing_payments;lease uuid:=gen_random_uuid();begin
 select * into p from private.live_billing_payments where status in ('CREATED','PROCESSING') and attempts<12
  and available_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()) and (p_id is null or id=p_id)
  order by created_at for update skip locked limit 1;
 if p.id is null then return null;end if;
 update private.live_billing_payments set lease_id=lease,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 where id=p.id;
 return jsonb_build_object('id',p.id,'amount',p.amount::text,'currency',p.currency,'ciphertext',p.payer_ciphertext,'leaseId',lease,'status',p.status,
  'initiationAllowed',exists(select 1 from private.billing_policies b join private.billing_configuration c on c.tenant_id=b.tenant_id
   where (b.body->>'productionEnabled')::boolean and (b.body->>'billingRevision')::integer=c.revision and c.revision=p.config_revision));
end $$;

create function private.billing_live_subscription_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 actor:=private.billing_actor(false);
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('vehicleId',s.vehicle_id,'expiresAt',s.expires_at,'graceUntil',s.grace_until,
  'state',case when clock_timestamp()<s.expires_at then 'ACTIVE' when clock_timestamp()<s.grace_until then 'GRACE' else 'SUSPENDED' end))
  from private.live_billing_subscriptions s where s.actor_id=actor and exists(select 1 from app.ownerships o join private.owners w on w.id=o.owner_id and w.tenant_id=o.tenant_id
   where o.vehicle_id=s.vehicle_id and w.user_id=actor and o.end_at is null and o.deleted_at is null and o.start_at<=clock_timestamp() and w.deleted_at is null)),'[]'::jsonb),
  'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'vehicleId',r.vehicle_id,'createdAt',r.created_at)) from private.live_billing_reminders r where r.actor_id=actor and r.acknowledged_at is null
    and exists(select 1 from app.ownerships o join private.owners w on w.id=o.owner_id and w.tenant_id=o.tenant_id
      where o.vehicle_id=r.vehicle_id and w.user_id=actor and o.end_at is null and o.deleted_at is null and o.start_at<=clock_timestamp() and w.deleted_at is null)),'[]'::jsonb),'sampleOnly',false);
end $$;


-- Auth phone access stays behind a private helper, outside runtime grants.
create function private.billing_notification_phone(p_actor uuid) returns text language sql stable security definer set search_path='' as $$
 select case when a.phone like '+%' then a.phone else '+'||a.phone end from auth.users a join app.users u on u.auth_user_id=a.id
 where u.id=p_actor and u.tenant_id=private.request_tenant_id() and u.status='ACTIVE' and u.deleted_at is null and a.phone_confirmed_at is not null
$$;
revoke all on function private.billing_notification_phone(uuid) from public,anon,authenticated,service_role,autoguardian_identity_login,autoguardian_billing_worker;
grant execute on function private.billing_notification_phone(uuid) to autoguardian_billing_executor;

create function private.billing_sms_claim(p_allowed text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.billing_sms_outbox;p jsonb;phone text;language text;lease uuid:=gen_random_uuid();begin
 update private.billing_sms_outbox set status='UNKNOWN',lease_id=null,lease_until=null where status='SENDING' and lease_until<clock_timestamp();
 insert into private.billing_sms_outbox(tenant_id,actor_id,vehicle_id,payment_id)
 select tenant_id,actor_id,vehicle_id,payment_id from private.live_billing_reminders where acknowledged_at is null on conflict(tenant_id,payment_id) do nothing;
 select body into p from private.billing_policies where (body->>'smsEnabled')::boolean and (body->>'productionEnabled')::boolean;
 if p is null then return null;end if;
 select * into j from private.billing_sms_outbox b where status='PENDING'
  and private.billing_notification_phone(actor_id)=any(p_allowed)
  and exists(select 1 from private.live_billing_reminders r where r.payment_id=b.payment_id and r.acknowledged_at is null)
  and exists(select 1 from app.ownerships o join private.owners w on w.id=o.owner_id and w.tenant_id=o.tenant_id
    where o.vehicle_id=b.vehicle_id and w.user_id=b.actor_id and o.end_at is null and o.deleted_at is null and o.start_at<=clock_timestamp() and w.deleted_at is null)
  order by created_at for update skip locked limit 1;
 if j.id is null then return null;end if;
 phone:=private.billing_notification_phone(j.actor_id);
 select preferred_language into language from app.users where id=j.actor_id;
 update private.billing_sms_outbox set status='SENDING',lease_id=lease,lease_until=clock_timestamp()+interval '60 seconds' where id=j.id;
 return jsonb_build_object('id',j.id,'leaseId',lease,'phone',phone,'body',case when language='fr' then p->>'smsFr' else p->>'smsEn' end);
end $$;
create function private.billing_sms_finish(p_id uuid,p_lease uuid,p_status text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('SUBMITTED','FAILED','UNKNOWN') or p_status is null then raise exception 'INVALID_SMS_STATUS' using errcode='AG400';end if;
 update private.billing_sms_outbox set status=p_status,provider_reference=left(p_reference,128),lease_id=null,lease_until=null
 where id=p_id and lease_id=p_lease and status='SENDING' and lease_until>clock_timestamp();
 if not found then raise exception 'SMS_LEASE_CHANGED' using errcode='AG409';end if;
 insert into private.billing_operations_audit(tenant_id,action,details) values(private.request_tenant_id(),'REMINDER_'||p_status,jsonb_build_object('notificationId',p_id));
end $$;

alter table private.live_billing_payments add foreign key(tenant_id,actor_id) references app.users(tenant_id,id);
alter table private.live_billing_subscriptions add foreign key(tenant_id,payment_id) references private.live_billing_payments(tenant_id,id);
alter table private.live_billing_subscriptions add foreign key(tenant_id,vehicle_id) references app.vehicles(tenant_id,id);
alter table private.live_billing_reminders add foreign key(tenant_id,payment_id) references private.live_billing_payments(tenant_id,id);
alter table private.billing_sms_outbox add foreign key(tenant_id,payment_id) references private.live_billing_payments(tenant_id,id);

do $$declare f record;begin
 for f in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and (p.proname like 'billing_live_%' or p.proname in ('billing_policy','billing_settlement','billing_offline_lease','billing_sms_claim','billing_sms_finish')) loop
  execute format('alter function %s owner to autoguardian_billing_executor',f.name);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,autoguardian_identity_login,autoguardian_billing_worker',f.name);
 end loop;
end $$;
grant execute on function private.billing_policy(jsonb,integer),private.billing_settlement(jsonb),private.billing_offline_lease(),
 private.billing_live_begin(uuid,text,uuid,integer,text,text),private.billing_live_read(uuid,boolean),private.billing_live_reconcile(uuid),
 private.billing_live_subscription_state(),private.billing_live_entitlement(uuid,text),private.billing_live_settings() to autoguardian_identity_login;
grant execute on function private.billing_live_claim(uuid),private.billing_live_finish(uuid,uuid,text,numeric,text,text),private.billing_live_sweep(),
 private.billing_sms_claim(text[]),private.billing_sms_finish(uuid,uuid,text,text) to autoguardian_billing_worker;
revoke create on schema private from autoguardian_billing_executor;
revoke autoguardian_billing_executor from current_user;
commit;
