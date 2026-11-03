-- Read-only after 030. Every result should be true; no policy is enabled here.
select
 (select count(*)=4 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class where relnamespace='private'::regnamespace
  and relname in ('vehicle_relationships','relationship_challenges','relationship_events','vehicle_sale_listings')) as tables_forced_rls,
 not exists(select 1 from pg_class c cross join(values('anon'),('authenticated'),('service_role'),('autoguardian_identity_login')) r(name)
  where c.relnamespace='private'::regnamespace and c.relname in ('vehicle_relationships','relationship_challenges','relationship_events','vehicle_sale_listings')
  and (has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE'))) as direct_access_denied,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join(values('anon'),('authenticated'),('service_role')) r(name)
  where n.nspname='private' and (p.proname like 'relationship_%' or p.proname in ('track_vehicle_listing','expire_vehicle_listing','backup_alert_recipient_valid','owned_vehicle_sale_status','vehicle_listing_current'))
  and has_function_privilege(r.name,p.oid,'EXECUTE')) as client_operations_denied,
 not has_function_privilege('autoguardian_identity_login','private.relationship_actor()','EXECUTE')
  and not has_function_privilege('autoguardian_identity_login','private.relationship_current(uuid)','EXECUTE')
  and not has_function_privilege('autoguardian_identity_login','private.backup_alert_recipient_valid(uuid,uuid)','EXECUTE') as helpers_denied,
 not has_function_privilege('autoguardian_identity_login','private.read_vehicle_check_before_listing_expiry(uuid)','EXECUTE')
  and not has_function_privilege('autoguardian_identity_login','private.sweep_vehicle_checks_before_relationships(integer)','EXECUTE') as legacy_bypasses_denied,
 exists(select 1 from pg_trigger where tgrelid='app.vehicles'::regclass and tgname='vehicle_listing_duration' and tgenabled='O') as listing_trigger_enabled,
 not has_table_privilege('autoguardian_check_executor','private.relationship_events','UPDATE,DELETE') as history_append_only,
 not has_schema_privilege('autoguardian_check_executor','private','CREATE')
  and not has_schema_privilege('autoguardian_sms_executor','private','CREATE') as executors_cannot_create;
