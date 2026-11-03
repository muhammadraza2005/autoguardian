-- Read-only checks after 026. These do not enable production or offline policies.
select
 to_regclass('private.live_billing_payments') is not null as live_payments_installed,
 to_regclass('private.billing_policies') is not null as approval_policy_installed,
 to_regclass('private.billing_sms_outbox') is not null as reminder_outbox_installed,
 to_regclass('private.billing_settlement_imports') is not null as settlement_imports_installed,
 (select count(*)=7 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'
   and c.relname in ('billing_policies','live_billing_payments','live_billing_subscriptions','live_billing_reminders',
    'billing_operations_audit','billing_settlement_imports','billing_sms_outbox') and c.relrowsecurity and c.relforcerowsecurity) as tenant_rls_enforced,
 not has_table_privilege('autoguardian_identity_login','private.live_billing_payments','INSERT,UPDATE,DELETE') as api_cannot_write_payments,
 not has_table_privilege('autoguardian_billing_worker','private.live_billing_payments','INSERT,UPDATE,DELETE') as worker_cannot_write_tables,
 not has_function_privilege('autoguardian_identity_login','private.billing_live_finish(uuid,uuid,text,numeric,text,text)','EXECUTE') as api_cannot_confirm_payments,
 has_function_privilege('autoguardian_billing_worker','private.billing_live_finish(uuid,uuid,text,numeric,text,text)','EXECUTE') as worker_can_confirm,
 has_function_privilege('autoguardian_identity_login','private.billing_offline_lease()','EXECUTE') as bounded_offline_lease_installed,
 not pg_has_role('autoguardian_identity_login','autoguardian_billing_worker','MEMBER') as worker_separated_from_api;
