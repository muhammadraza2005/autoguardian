-- Read-only. Run as postgres after migrations 001 and 002.
-- One results grid: all six rows should say PASS.
with expected(schema_name, table_name) as (
    values ('app', 'tenants'), ('app', 'roles'), ('app', 'users'), ('app', 'organizations'),
        ('app', 'role_assignments'), ('private', 'owners'), ('app', 'vehicles'), ('app', 'ownerships')
), tables as (
    select c.oid, c.relrowsecurity, c.relforcerowsecurity
    from expected e
    join pg_catalog.pg_namespace n on n.nspname = e.schema_name
    join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = e.table_name
    where c.relkind = 'r'
), clients(role_name) as (
    values ('anon'), ('authenticated'), ('service_role')
), checks(check_name, passed) as (
    select '1. Eight core tables exist', (select count(*) = 8 from tables)
    union all
    select '2. RLS enabled and forced on all eight',
        (select count(*) = 8 from tables where relrowsecurity and relforcerowsecurity)
    union all
    select '3. Fourteen roles; only VERIFIER allows self-registration',
        (select count(*) = 14
            and count(*) filter (where self_registration_allowed) = 1
            and bool_or(code = 'VERIFIER' and self_registration_allowed) from app.roles)
    union all
    select '4. No client table privileges', not exists (
        select 1 from clients r cross join tables t
        cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
            ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
        where has_table_privilege(r.role_name, t.oid, p.privilege))
    union all
    select '5. No client column privileges', not exists (
        select 1 from clients r cross join tables t
        cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
        where has_any_column_privilege(r.role_name, t.oid, p.privilege))
    union all
    select '6. No client access to domain schemas', not exists (
        select 1 from clients r cross join (values ('app'), ('private')) s(schema_name)
        where has_schema_privilege(r.role_name, s.schema_name, 'USAGE')
           or has_schema_privilege(r.role_name, s.schema_name, 'CREATE'))
)
select check_name, case when passed then 'PASS' else 'FAIL' end as result
from checks order by check_name;
