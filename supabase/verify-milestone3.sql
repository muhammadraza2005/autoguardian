-- Read-only checks after 024 and 025. All columns should be true.
select
 (select count(*)=8 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='private' and c.relname in ('billing_configuration','billing_payments','billing_events','billing_check_usage',
    'billing_subscriptions','billing_reminders','pilot_admin_events','pilot_configuration')) as forced_private_rls,
 not has_table_privilege('autoguardian_identity_login','private.billing_payments','INSERT,UPDATE,DELETE') as runtime_cannot_confirm,
 not has_function_privilege('autoguardian_identity_login','private.billing_finish(uuid,uuid,text,numeric,text,text)','EXECUTE') as runtime_cannot_finish,
 not pg_has_role('autoguardian_identity_login','autoguardian_billing_worker','MEMBER') as worker_is_separate,
 not has_function_privilege('autoguardian_identity_login','private.create_vehicle_check_before_billing(uuid,uuid)','EXECUTE') as original_check_gate_private,
 has_function_privilege('autoguardian_identity_login','private.create_vehicle_check(uuid,uuid)','EXECUTE') as check_gate_connected,
 not has_schema_privilege('autoguardian_billing_executor','private','CREATE') as billing_temporary_create_removed;
