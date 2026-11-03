-- Read-only after 029. No PIN hashes, OTPs or proof tokens returned.
select
 (select count(*)=6 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class where relnamespace='private'::regnamespace
  and relname in ('owner_pin_policy','owner_pin_credentials','owner_pin_enrollments','owner_pin_proofs','owner_pin_sale_proofs','owner_pin_events')) as pin_tables_forced_rls,
 not exists(select 1 from pg_class c cross join(values('anon'),('authenticated'),('service_role'),('autoguardian_identity_login')) r(name)
  where c.relnamespace='private'::regnamespace and c.relname in ('owner_pin_policy','owner_pin_credentials','owner_pin_enrollments','owner_pin_proofs','owner_pin_sale_proofs','owner_pin_events')
  and (has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE'))) as direct_access_denied,
 (select not rolcanlogin and not rolsuper and not rolbypassrls and not has_schema_privilege(rolname,'private','CREATE') from pg_roles
  where rolname='autoguardian_pin_executor') as pin_executor_restricted,
 not pg_has_role('autoguardian_identity_login','autoguardian_pin_executor','MEMBER') as pin_executor_not_inherited,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join(values('anon'),('authenticated'),('service_role')) r(name)
  where n.nspname='private' and p.proname like 'owner_pin_%' and has_function_privilege(r.name,p.oid,'EXECUTE')) as client_operations_denied,
 not has_function_privilege('autoguardian_identity_login','private.owner_pin_consume(uuid,text,text)','EXECUTE')
  and not has_function_privilege('autoguardian_identity_login','private.owner_pin_consume_sale(uuid,uuid,text,text,text,text)','EXECUTE') as proof_helpers_denied,
 not has_function_privilege('autoguardian_identity_login','private.decide_vehicle_check_without_pin(uuid,text)','EXECUTE')
  and not has_function_privilege('autoguardian_identity_login','private.change_vehicle_sale_without_pin(uuid,uuid,text,text,text)','EXECUTE') as legacy_bypasses_denied,
 not has_function_privilege('autoguardian_telecom_executor','private.decide_vehicle_check_without_pin(uuid,text)','EXECUTE') as channel_bypass_denied,
 not has_table_privilege('autoguardian_pin_executor','private.owner_pin_events','UPDATE,DELETE') as pin_history_append_only;
