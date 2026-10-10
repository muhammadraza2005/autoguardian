-- Read-only after 023. Every column should be true.
with tables as (
 select c.oid,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='private' and c.relname=any(array['check_alert_jobs','vehicle_reports','vehicle_report_events','vehicle_status_events','vehicle_report_evidence'])
),roles as (select unnest(array['anon','authenticated','service_role','autoguardian_identity_login']) name)
select
 (select count(*)=5 and bool_and(relrowsecurity and relforcerowsecurity) from tables) as forced_rls,
 not exists(select 1 from tables cross join roles where has_table_privilege(roles.name,tables.oid,'SELECT,INSERT,UPDATE,DELETE')) as direct_access_denied,
 not pg_has_role('autoguardian_identity_login','autoguardian_check_executor','MEMBER') as no_executor_membership,
 not has_schema_privilege('autoguardian_check_executor','private','CREATE') as executor_cannot_create,
 (select not rolcanlogin and not rolbypassrls and not rolsuper from pg_roles where rolname='autoguardian_check_executor') as executor_restricted,
 not has_function_privilege('autoguardian_identity_login','private.create_vehicle_check_unlimited(uuid,uuid)','EXECUTE')
   and not has_function_privilege('autoguardian_identity_login','private.workflow_owner(uuid)','EXECUTE')
   and not has_function_privilege('autoguardian_identity_login','private.workflow_reviewer()','EXECUTE') as helpers_private,
 not has_table_privilege('autoguardian_check_executor','private.vehicle_report_events','UPDATE,DELETE')
   and not has_table_privilege('autoguardian_check_executor','private.vehicle_status_events','UPDATE,DELETE')
   and not has_table_privilege('autoguardian_check_executor','private.vehicle_report_evidence','UPDATE,DELETE') as history_append_only,
 has_function_privilege('autoguardian_identity_login','private.lookup_vehicle_check(text,text,text,uuid)','EXECUTE')
   and has_function_privilege('autoguardian_identity_login','private.list_vehicle_checks(boolean,uuid,integer)','EXECUTE')
   and has_function_privilege('autoguardian_identity_login','private.sweep_vehicle_checks(integer)','EXECUTE') as workflow_operations_granted;
