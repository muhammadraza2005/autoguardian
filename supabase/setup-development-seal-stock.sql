-- Run after 008 as postgres. Adds 20 synthetic seals; reruns preserve existing stock/reservations.
begin;
do $$
declare authority uuid:='ce31527e-d1b5-4379-9ddd-1458cfb73431';
  organization uuid:='014db61a-4c68-48cb-86b6-46837f4da873';
  agent uuid:='369cbe75-32c8-40b4-a9ee-f2d9bde379db';
begin
  if not exists(select 1 from app.tenants t join app.organizations o on o.tenant_id=t.id
    join app.users u on u.tenant_id=t.id join app.agent_accreditations a on a.tenant_id=t.id and a.user_id=u.id and a.organization_id=o.id
    join app.role_assignments r on r.tenant_id=t.id and r.user_id=u.id and r.organization_id=o.id
    where t.id=authority and t.code='AUTOGUARDIAN_DEV' and t.status='ACTIVE' and t.deleted_at is null
    and o.id=organization and o.status='ACTIVE' and o.deleted_at is null and u.id=agent and u.status='ACTIVE' and u.deleted_at is null
    and a.status='ACTIVE' and a.valid_from<=now() and (a.valid_to is null or a.valid_to>now())
    and r.role_code='ENROLLMENT_AGENT' and r.deleted_at is null and r.valid_from<=now() and (r.valid_to is null or r.valid_to>now())) then
    raise exception 'Active development tenant, organization and accredited agent are required'; end if;
  insert into private.development_seal_stock(tenant_id,organization_id,assigned_agent_id,code,batch_code,type)
    select authority,organization,agent,'DEV-SEAL-'||v.prefix||'-'||lpad(n::text,3,'0'),'DEV-BATCH-001',v.type
    from (values ('STD','STANDARD',12),('ALM','ALARM',8)) v(prefix,type,total)
    cross join lateral generate_series(1,v.total) n on conflict(code) do nothing;
  if exists(select 1 from private.development_seal_stock where batch_code='DEV-BATCH-001'
    and (tenant_id<>authority or organization_id<>organization or assigned_agent_id<>agent
      or type<>case when code like 'DEV-SEAL-STD-%' then 'STANDARD' else 'ALARM' end)) then
    raise exception 'Existing sample stock has conflicting assignments; manual review required'; end if;
end;
$$;
select batch_code,type,count(*) as seal_count from private.development_seal_stock
  where tenant_id='ce31527e-d1b5-4379-9ddd-1458cfb73431' and organization_id='014db61a-4c68-48cb-86b6-46837f4da873'
    and assigned_agent_id='369cbe75-32c8-40b4-a9ee-f2d9bde379db' group by batch_code,type order by batch_code,type;
commit;
