-- Read-only after 027/028. No phone numbers, credentials or message bodies.
select
 (select count(*)=7 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where relnamespace='private'::regnamespace and relname in ('sms_notification_attempts','sms_delivery_events',
   'sms_unmatched_receipts','telecom_state','telecom_dispatches','telecom_channels','telecom_references')) as tables_forced_rls,
 not exists(select 1 from pg_class c cross join(values('anon'),('authenticated'),('service_role'),('autoguardian_identity_login')) r(name)
  where c.relnamespace='private'::regnamespace and c.relname in ('sms_notification_attempts','sms_delivery_events',
   'sms_unmatched_receipts','telecom_state','telecom_dispatches','telecom_channels','telecom_references')
  and (has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE'))) as direct_access_denied,
 (select count(*)=2 and bool_and(not rolcanlogin and not rolsuper and not rolbypassrls
  and not has_schema_privilege(rolname,'private','CREATE')) from pg_roles where rolname in ('autoguardian_sms_executor','autoguardian_telecom_executor')) as executors_restricted,
 not pg_has_role('autoguardian_identity_login','autoguardian_telecom_executor','MEMBER')
  and not pg_has_role('autoguardian_identity_login','autoguardian_sms_executor','MEMBER') as executors_not_inherited,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join(values('anon'),('authenticated'),('service_role')) r(name)
  where n.nspname='private' and (p.proname like 'telecom_%' or p.proname='sms_receive_delivery')
  and has_function_privilege(r.name,p.oid,'EXECUTE')) as client_operations_denied,
 not has_function_privilege('autoguardian_identity_login','private.telecom_phone_account(text)','EXECUTE')
  and not has_function_privilege('autoguardian_identity_login','private.telecom_billing_session_valid()','EXECUTE') as identity_helpers_denied,
 exists(select 1 from information_schema.columns where table_schema='private' and table_name='sms_notification_attempts' and column_name='provider_account') as provider_account_generalized,
 not has_table_privilege('autoguardian_sms_executor','private.sms_delivery_events','UPDATE,DELETE') as delivery_history_append_only;
