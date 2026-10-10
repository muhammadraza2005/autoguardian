-- Read-only installation checks. Run as postgres after installing 021.
select
  (select count(*)=5 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class c where c.relnamespace='private'::regnamespace and c.relkind='r'
      and c.relname in ('vehicle_check_configuration','vehicle_check_requests','vehicle_check_decisions',
        'vehicle_check_events','vehicle_check_notifications')) as tables_forced_rls,
  not exists(select 1 from pg_class c cross join (values('anon'),('authenticated'),('service_role'),
      ('autoguardian_identity_login')) r(name)
    where c.relnamespace='private'::regnamespace and c.relkind='r' and c.relname like 'vehicle_check_%'
      and (has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE')
        or has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE'))) as direct_access_denied,
  not pg_has_role('autoguardian_identity_login','autoguardian_check_executor','MEMBER') as executor_not_inherited,
  (select not rolcanlogin and not rolbypassrls and not rolsuper
      and not has_schema_privilege('autoguardian_check_executor','private','CREATE') from pg_roles
    where rolname='autoguardian_check_executor') as executor_restricted,
  (select count(*)=3 and bool_and(p.prosecdef and p.proowner='autoguardian_check_executor'::regrole
      and has_function_privilege('autoguardian_identity_login',p.oid,'EXECUTE'))
    from pg_proc p where p.oid in ('private.create_vehicle_check(uuid,uuid)'::regprocedure,
      'private.decide_vehicle_check(uuid,text)'::regprocedure,'private.read_vehicle_check(uuid)'::regprocedure)) as operations_owned_and_granted,
  not exists(select 1 from pg_proc p cross join(values('anon'),('authenticated'),('service_role')) r(name)
    where p.oid in ('private.create_vehicle_check(uuid,uuid)'::regprocedure,
      'private.decide_vehicle_check(uuid,text)'::regprocedure,'private.read_vehicle_check(uuid)'::regprocedure,
      'private.finish_vehicle_check(uuid,text,uuid,timestamptz)'::regprocedure,'private.check_phone_verified()'::regprocedure)
      and has_function_privilege(r.name,p.oid,'EXECUTE')) as client_operations_denied,
  not has_function_privilege('autoguardian_identity_login',
    'private.finish_vehicle_check(uuid,text,uuid,timestamptz)','EXECUTE') as internal_transition_denied,
  not has_table_privilege('autoguardian_check_executor','private.vehicle_check_events','UPDATE,DELETE')
    and not has_table_privilege('autoguardian_check_executor','private.vehicle_check_decisions','UPDATE,DELETE') as history_append_only;
