-- READ ONLY. Run before choosing which migration files to apply.
-- Function presence is an installation indicator, not full integrity verification.
select
 to_regprocedure('private.create_vehicle_check(uuid,uuid)') is not null as checks_021_present,
 to_regprocedure('private.sms_claim_notification(text,text[])') is not null as sms_022_present,
 to_regprocedure('private.lookup_vehicle_check(text,text,text,uuid)') is not null as workflows_023_present,
 to_regprocedure('private.billing_settings(jsonb,integer)') is not null as billing_024_present,
 to_regprocedure('private.pilot_read(text,integer,integer)') is not null as administration_025_present,
 to_regprocedure('private.billing_policy(jsonb,integer)') is not null as billing_operations_026_present,
 to_regprocedure('private.sms_receive_delivery(text,text,text,text,text)') is not null as africastalking_027_present,
 to_regprocedure('private.telecom_operation(text,text,text,jsonb)') is not null as channels_028_present,
 to_regprocedure('private.owner_pin_status()') is not null as owner_pin_029_present,
 to_regprocedure('private.relationship_list()') is not null as relationships_030_present,
 exists(select 1 from pg_namespace where nspname='private' and pg_has_role(current_user,nspowner,'MEMBER')) as owns_private_schema,
 (select rolcreaterole or rolsuper from pg_roles where rolname=current_user) as can_manage_migration_roles;
