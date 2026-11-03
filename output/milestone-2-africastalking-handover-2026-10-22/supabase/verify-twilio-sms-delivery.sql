-- Read-only: run as postgres after 022. No credentials or phone data returned.
select
  (select count(*)=2 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where relnamespace='private'::regnamespace and relname in ('sms_notification_attempts','sms_delivery_events')) as tables_forced_rls,
  not exists(select 1 from pg_class c cross join(values('anon'),('authenticated'),('service_role'),('autoguardian_identity_login')) r(name)
    where c.relnamespace='private'::regnamespace and c.relname in ('sms_notification_attempts','sms_delivery_events')
      and (has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE'))) as direct_access_denied,
  (select not rolcanlogin and not rolsuper and not rolbypassrls
    and not has_schema_privilege(rolname,'private','CREATE') from pg_roles where rolname='autoguardian_sms_executor') as executor_restricted,
  not pg_has_role('autoguardian_identity_login','autoguardian_sms_executor','MEMBER') as executor_not_inherited,
  (select count(*)=4 and bool_and(prosecdef and proowner='autoguardian_sms_executor'::regrole
    and has_function_privilege('autoguardian_identity_login',oid,'EXECUTE')) from pg_proc where oid in (
      'private.sms_claim_notification(text,text[])'::regprocedure,'private.sms_record_submission(uuid,text,text,text)'::regprocedure,
      'private.sms_record_callback(uuid,uuid,text,text,text,text,text)'::regprocedure,'private.sms_record_send_error(uuid,text,text)'::regprocedure)) as operations_owned_and_granted,
  not exists(select 1 from pg_proc p cross join(values('anon'),('authenticated'),('service_role')) r(name)
    where p.oid in ('private.sms_claim_notification(text,text[])'::regprocedure,'private.sms_record_submission(uuid,text,text,text)'::regprocedure,
      'private.sms_record_callback(uuid,uuid,text,text,text,text,text)'::regprocedure,'private.sms_record_send_error(uuid,text,text)'::regprocedure,
      'private.sms_apply_status(uuid,text,text,text,text,text,text)'::regprocedure,'private.sms_verified_phone(uuid)'::regprocedure)
      and has_function_privilege(r.name,p.oid,'EXECUTE')) as client_operations_denied,
  not has_function_privilege('autoguardian_identity_login','private.sms_apply_status(uuid,text,text,text,text,text,text)','EXECUTE')
    and not has_function_privilege('autoguardian_identity_login','private.sms_verified_phone(uuid)','EXECUTE') as helpers_denied,
  not has_table_privilege('autoguardian_sms_executor','private.sms_delivery_events','UPDATE,DELETE') as history_append_only;
