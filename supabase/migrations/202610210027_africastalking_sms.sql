-- Run once after 026 as the migration/schema owner. No credentials or enablement.
-- Preserve historical Twilio attempts while introducing namespaced AT accounts.
begin;
grant create on schema private to autoguardian_sms_executor;
alter table private.sms_notification_attempts rename column account_sid to provider_account;
alter table private.sms_notification_attempts drop constraint sms_notification_attempts_account_sid_check;
alter table private.sms_notification_attempts add constraint sms_provider_account_check
 check(provider_account ~ '^(AC[0-9a-fA-F]{32}|at:(sandbox|production):[A-Za-z0-9_-]{1,64})$');
alter table private.sms_notification_attempts drop constraint sms_notification_attempts_provider_message_id_check;
alter table private.sms_notification_attempts add constraint sms_provider_message_check
 check(provider_message_id ~ '^[A-Za-z0-9_.:-]{1,200}$');
-- Update installed function bodies rather than changing applied migration files.
do $$ declare f regprocedure;definition text;begin
 foreach f in array array['private.sms_claim_notification(text,text[])'::regprocedure,
  'private.sms_apply_status(uuid,text,text,text,text,text,text)'::regprocedure,
  'private.sms_record_submission(uuid,text,text,text)'::regprocedure] loop
  select pg_get_functiondef(f) into definition;
  definition:=replace(definition,'account_sid','provider_account');
  definition:=replace(definition,'''^AC[0-9a-fA-F]{32}$''','''^(AC[0-9a-fA-F]{32}|at:(sandbox|production):[A-Za-z0-9_-]{1,64})$''');
  definition:=replace(definition,'''^(SM|MM)[0-9a-fA-F]{32}$''','''^[A-Za-z0-9_.:-]{1,200}$''');
  definition:=replace(definition,'''^[0-9]{0,6}$''','''^[A-Z0-9_]{0,64}$''');
  execute definition;
 end loop;
end $$;
create table private.sms_unmatched_receipts (
 tenant_id uuid not null references app.tenants(id),provider_account text not null,
 message_id text not null check(message_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('accepted','queued','sending','sent','delivered','failed','undelivered','canceled')),
 error_code text not null check(error_code ~ '^[A-Z0-9_]{0,64}$'),
 received_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,provider_account,message_id,recipient_hash,status,error_code)
);
alter table private.sms_unmatched_receipts enable row level security;
alter table private.sms_unmatched_receipts force row level security;
revoke all on private.sms_unmatched_receipts from public,anon,authenticated,service_role,autoguardian_identity_login;
grant select,insert,delete on private.sms_unmatched_receipts to autoguardian_sms_executor;
create policy sms_receipt_scope on private.sms_unmatched_receipts to autoguardian_sms_executor
 using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create function private.sms_receive_delivery(p_account text,p_message text,p_phone text,p_status text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare a private.sms_notification_attempts;h text;begin
 if p_account is null or p_account !~ '^at:(sandbox|production):[A-Za-z0-9_-]{1,64}$'
  or p_message is null or p_message !~ '^[A-Za-z0-9_.:-]{1,200}$' or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
  or p_status is null or p_status not in ('accepted','queued','sending','sent','delivered','failed','undelivered','canceled')
  or p_error is null or p_error !~ '^[A-Z0-9_]{0,64}$' then raise exception 'SMS_INVALID_RECEIPT' using errcode='23514';end if;
 if not exists(select 1 from app.tenants where status='ACTIVE' and deleted_at is null) then raise exception 'SMS_AUTHORITY_UNAVAILABLE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||p_account||p_message,27));
 h:=encode(sha256(convert_to(p_phone,'UTF8')),'hex');
 select * into a from private.sms_notification_attempts where provider_account=p_account and provider_message_id=p_message;
 if a.id is null then
  delete from private.sms_unmatched_receipts where received_at<clock_timestamp()-interval '1 day';
  if (select count(*) from private.sms_unmatched_receipts)>=10000 then raise exception 'SMS_RECEIPT_LIMIT' using errcode='23514';end if;
  insert into private.sms_unmatched_receipts(tenant_id,provider_account,message_id,recipient_hash,status,error_code)
   values(private.request_tenant_id(),p_account,p_message,h,p_status,p_error) on conflict do nothing;
 else perform private.sms_apply_status(a.id,p_account,p_message,p_status,p_error,'callback',h);end if;
end $$;
-- Submission and callbacks share a message lock, covering early-receipt races.
create or replace function private.sms_record_submission(p_attempt uuid,p_sid text,p_status text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare a private.sms_notification_attempts;r private.sms_unmatched_receipts;begin
 select * into a from private.sms_notification_attempts where id=p_attempt;
 if a.id is null then raise exception 'SMS_ATTEMPT_NOT_FOUND' using errcode='P0002';end if;
 perform pg_advisory_xact_lock(hashtextextended(private.request_tenant_id()::text||a.provider_account||p_sid,27));
 perform private.sms_apply_status(p_attempt,a.provider_account,p_sid,p_status,p_error,'api',null);
 for r in select * from private.sms_unmatched_receipts where provider_account=a.provider_account and message_id=p_sid
  order by received_at,status loop
  if r.recipient_hash=a.recipient_hash then
   perform private.sms_apply_status(p_attempt,a.provider_account,p_sid,r.status,r.error_code,'callback',r.recipient_hash);
  end if;
 end loop;
 delete from private.sms_unmatched_receipts where provider_account=a.provider_account and message_id=p_sid;
end $$;
revoke all on function private.sms_receive_delivery(text,text,text,text,text) from public,anon,authenticated,service_role;
alter function private.sms_receive_delivery(text,text,text,text,text) owner to autoguardian_sms_executor;
grant execute on function private.sms_receive_delivery(text,text,text,text,text) to autoguardian_identity_login;
revoke create on schema private from autoguardian_sms_executor;
commit;
