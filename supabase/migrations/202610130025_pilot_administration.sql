-- Tenant-scoped pilot operations. No user creation, role grants or production activation.
begin;
create role autoguardian_pilot_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant autoguardian_pilot_executor to current_user;
grant usage on schema app,private to autoguardian_pilot_executor;
grant execute on function private.request_tenant_id(),private.request_auth_user_id(),private.access_session_valid(boolean) to autoguardian_pilot_executor;
alter table app.organizations add column pilot_revision integer not null default 1 check(pilot_revision>0);
alter table app.agent_accreditations add column pilot_revision integer not null default 1 check(pilot_revision>0);
alter table private.development_seal_stock add column pilot_revision integer not null default 1 check(pilot_revision>0);
create table private.pilot_configuration (
 tenant_id uuid primary key references app.tenants(id),revision integer not null check(revision>0),
 enabled boolean not null default false,incident_policy_en text not null,incident_policy_fr text not null,
 emergency_contact text,updated_at timestamptz not null default now(),updated_by uuid not null,
 foreign key(tenant_id,updated_by) references app.users(tenant_id,id),
 check(length(btrim(incident_policy_en)) between 20 and 2000 and length(btrim(incident_policy_fr)) between 20 and 2000),
 check(emergency_contact is null or length(btrim(emergency_contact)) between 3 and 100)
);
create table private.pilot_admin_events (
 sequence bigint generated always as identity primary key,tenant_id uuid not null,actor_id uuid not null,
 request_key uuid not null,action text not null,target_id uuid not null,expected_revision integer not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 unique(tenant_id,actor_id,request_key),foreign key(tenant_id,actor_id) references app.users(tenant_id,id)
);
alter table private.pilot_configuration enable row level security;
alter table private.pilot_configuration force row level security;
alter table private.pilot_admin_events enable row level security;
alter table private.pilot_admin_events force row level security;
grant select on app.users,app.tenants,app.role_assignments,app.organizations,app.agent_accreditations,
 private.development_seal_stock,private.draft_seal_placements,private.pilot_configuration,private.pilot_admin_events to autoguardian_pilot_executor;
grant update(status,pilot_revision,updated_at) on app.organizations,app.agent_accreditations to autoguardian_pilot_executor;
grant update(organization_id,assigned_agent_id,pilot_revision) on private.development_seal_stock to autoguardian_pilot_executor;
grant insert,update on private.pilot_configuration to autoguardian_pilot_executor;
grant insert on private.pilot_admin_events to autoguardian_pilot_executor;
grant usage on sequence private.pilot_admin_events_sequence_seq to autoguardian_pilot_executor;
create policy pilot_tenant on app.tenants for select to autoguardian_pilot_executor using(id=private.request_tenant_id());
do $$declare t text;begin
 foreach t in array array['users','role_assignments','organizations','agent_accreditations'] loop
 execute format('create policy pilot_read on app.%I for select to autoguardian_pilot_executor using(tenant_id=private.request_tenant_id())',t);
 end loop;
 foreach t in array array['organizations','agent_accreditations'] loop
 execute format('create policy pilot_write on app.%I for update to autoguardian_pilot_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id())',t);
 end loop;
 foreach t in array array['development_seal_stock','draft_seal_placements','pilot_configuration','pilot_admin_events'] loop
 execute format('create policy pilot_read on private.%I for select to autoguardian_pilot_executor using(tenant_id=private.request_tenant_id())',t);
 end loop;
end $$;
create policy pilot_seal_write on private.development_seal_stock for update to autoguardian_pilot_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create policy pilot_config_write on private.pilot_configuration for all to autoguardian_pilot_executor using(tenant_id=private.request_tenant_id()) with check(tenant_id=private.request_tenant_id());
create policy pilot_event_write on private.pilot_admin_events for insert to autoguardian_pilot_executor with check(tenant_id=private.request_tenant_id());
create function private.pilot_actor() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 if not private.access_session_valid(true) then raise exception 'STAFF_MFA_REQUIRED' using errcode='AG403';end if;
 select u.id into actor from app.users u join app.tenants t on t.id=u.tenant_id where u.tenant_id=private.request_tenant_id()
 and u.auth_user_id=private.request_auth_user_id() and u.status='ACTIVE' and u.deleted_at is null and t.status='ACTIVE' and t.deleted_at is null
 and exists(select 1 from app.role_assignments r where r.tenant_id=u.tenant_id and r.user_id=u.id and r.role_code='TENANT_ADMIN'
 and r.organization_id is null and r.deleted_at is null and r.valid_from<=now() and (r.valid_to is null or r.valid_to>now()));
 if actor is null then raise exception 'TENANT_ADMIN_REQUIRED' using errcode='AG403';end if;return actor;
end $$;
create function private.pilot_read(p_section text,p_limit integer,p_offset integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;items jsonb;begin
 actor:=private.pilot_actor();
 if p_section is null or p_section not in ('organizations','agents','seals','configuration','history') or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 2147483647 then raise exception 'INVALID_PAGE' using errcode='AG400';end if;
 if p_section='organizations' then
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'status',status,'revision',pilot_revision)),'[]') into items from
 (select * from app.organizations where tenant_id=private.request_tenant_id() and deleted_at is null order by name,id limit p_limit offset p_offset) q;
 elsif p_section='agents' then
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'agentId',user_id,'organizationId',organization_id,'status',status,'revision',pilot_revision)),'[]') into items from
 (select * from app.agent_accreditations where tenant_id=private.request_tenant_id() order by id limit p_limit offset p_offset) q;
 elsif p_section='seals' then
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'type',type,'status',status,'origin',origin,'organizationId',organization_id,'agentId',assigned_agent_id,'revision',pilot_revision,
 'allocated',exists(select 1 from private.draft_seal_placements p where p.seal_id=q.id and (p.released_at is null or q.origin='PRODUCTION')))),'[]') into items from
 (select * from private.development_seal_stock where tenant_id=private.request_tenant_id() order by id limit p_limit offset p_offset) q;
 elsif p_section='history' then
 select coalesce(jsonb_agg(jsonb_build_object('sequence',sequence::text,'actorId',actor_id,'action',action,'targetId',target_id,'payload',payload,'result',result,'createdAt',created_at)),'[]') into items from
 (select * from private.pilot_admin_events where tenant_id=private.request_tenant_id() order by sequence desc limit p_limit offset p_offset) q;
 else
 select coalesce(jsonb_agg(jsonb_build_object('revision',revision,'enabled',enabled,'incidentPolicyEn',incident_policy_en,'incidentPolicyFr',incident_policy_fr,'emergencyContact',emergency_contact)),'[]') into items
 from private.pilot_configuration where tenant_id=private.request_tenant_id();end if;
 return jsonb_build_object('section',p_section,'items',items,'limit',p_limit,'offset',p_offset);
end $$;
create function private.pilot_change(p_key uuid,p_action text,p_target uuid,p_expected integer,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;tenant uuid:=private.request_tenant_id();event private.pilot_admin_events;rev integer;old_status text;result jsonb;agent uuid;org uuid;actual integer;observed integer;begin
 actor:=private.pilot_actor();
 if p_key is null or p_target is null or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_action is null or p_action not in ('ORGANIZATION_STATUS','AGENT_STATUS','SEAL_ALLOCATE','SEAL_RECONCILE','CONFIGURE') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_ADMIN_INPUT' using errcode='AG400';end if;
 select * into event from private.pilot_admin_events where tenant_id=tenant and actor_id=actor and request_key=p_key;
 if found then
 if (event.action,event.target_id,event.expected_revision,event.payload) is distinct from (p_action,p_target,p_expected,p_payload) then raise exception 'KEY_CONFLICT' using errcode='AG409';end if;return event.result;end if;
 if p_action in ('ORGANIZATION_STATUS','AGENT_STATUS') then
 if p_payload-ARRAY['status','reason'] <> '{}'::jsonb or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 500 or (p_payload->>'reason') ~ '[[:cntrl:]]'
 or p_payload->>'status' is null or p_payload->>'status' not in ('ACTIVE','SUSPENDED','REVOKED') or (p_action='ORGANIZATION_STATUS' and p_payload->>'status'='REVOKED') then raise exception 'INVALID_STATUS' using errcode='AG400';end if;
 if p_action='ORGANIZATION_STATUS' then
 select pilot_revision,status into rev,old_status from app.organizations where tenant_id=tenant and id=p_target and deleted_at is null for update;
 else
 select pilot_revision,status,user_id,organization_id into rev,old_status,agent,org from app.agent_accreditations where tenant_id=tenant and id=p_target for update;
 if agent=actor or exists(select 1 from app.role_assignments where tenant_id=tenant and user_id=agent and role_code='TENANT_ADMIN' and deleted_at is null and valid_from<=now() and (valid_to is null or valid_to>now())) then raise exception 'ADMIN_ACCOUNT_PROTECTED' using errcode='AG403';end if;
 if p_payload->>'status'='ACTIVE' and (not exists(select 1 from app.agent_accreditations a where a.tenant_id=tenant and a.id=p_target and a.valid_from<=now() and (a.valid_to is null or a.valid_to>now())) or not exists(select 1 from app.organizations o join app.users u on u.tenant_id=o.tenant_id where o.tenant_id=tenant and o.id=org and o.status='ACTIVE' and o.deleted_at is null and u.id=agent and u.status='ACTIVE' and u.deleted_at is null
 and exists(select 1 from app.role_assignments r where r.tenant_id=tenant and r.user_id=agent and r.organization_id=org and r.role_code='ENROLLMENT_AGENT' and r.deleted_at is null and r.valid_from<=now() and (r.valid_to is null or r.valid_to>now())))) then raise exception 'AGENT_ROLE_REQUIRED' using errcode='AG403';end if;end if;
 if rev is null then raise exception 'NOT_FOUND' using errcode='AG404';end if;
 if rev<>p_expected or old_status=p_payload->>'status' then raise exception 'REVISION_CONFLICT' using errcode='AG409';end if;
 if p_action='ORGANIZATION_STATUS' then update app.organizations set status=p_payload->>'status',pilot_revision=rev+1,updated_at=now() where tenant_id=tenant and id=p_target;
 else update app.agent_accreditations set status=p_payload->>'status',pilot_revision=rev+1,updated_at=now() where tenant_id=tenant and id=p_target;end if;
 result:=jsonb_build_object('id',p_target,'revision',rev+1,'status',p_payload->>'status');
 elsif p_action='SEAL_ALLOCATE' then
 if p_payload-ARRAY['agentId','organizationId','reason']<>'{}'::jsonb or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 500 then raise exception 'INVALID_ALLOCATION' using errcode='AG400';end if;
 agent:=(p_payload->>'agentId')::uuid;org:=(p_payload->>'organizationId')::uuid;
 select pilot_revision,status into rev,old_status from private.development_seal_stock where tenant_id=tenant and id=p_target for update;
 if rev is null then raise exception 'NOT_FOUND' using errcode='AG404';end if;
 if rev<>p_expected or old_status<>'IN_STOCK' or exists(select 1 from private.draft_seal_placements p join private.development_seal_stock s on s.id=p.seal_id where p.tenant_id=tenant and p.seal_id=p_target and (p.released_at is null or s.origin='PRODUCTION')) then raise exception 'SEAL_UNAVAILABLE' using errcode='AG409';end if;
 if not exists(select 1 from app.agent_accreditations a join app.organizations o on o.id=a.organization_id and o.tenant_id=a.tenant_id join app.users u on u.id=a.user_id and u.tenant_id=a.tenant_id
 where a.tenant_id=tenant and a.user_id=agent and a.organization_id=org and a.status='ACTIVE' and a.valid_from<=now() and (a.valid_to is null or a.valid_to>now()) and o.status='ACTIVE' and o.deleted_at is null and u.status='ACTIVE' and u.deleted_at is null
 and exists(select 1 from app.role_assignments r where r.tenant_id=tenant and r.user_id=agent and r.organization_id=org and r.role_code='ENROLLMENT_AGENT' and r.deleted_at is null and r.valid_from<=now() and (r.valid_to is null or r.valid_to>now()))) then raise exception 'AGENT_ROLE_REQUIRED' using errcode='AG403';end if;
 update private.development_seal_stock set organization_id=org,assigned_agent_id=agent,pilot_revision=rev+1 where tenant_id=tenant and id=p_target;
 result:=jsonb_build_object('id',p_target,'revision',rev+1,'agentId',agent,'organizationId',org);
 elsif p_action='SEAL_RECONCILE' then
 if p_payload-ARRAY['observedCount','origin','reason']<>'{}'::jsonb or jsonb_typeof(p_payload->'observedCount') is distinct from 'number' or p_payload->>'observedCount' !~ '^[0-9]+$' or (p_payload->>'observedCount')::numeric>1000000 or p_payload->>'origin' is null or p_payload->>'origin' not in ('DEVELOPMENT','PRODUCTION') or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 500 then raise exception 'INVALID_RECONCILIATION' using errcode='AG400';end if;
 select pilot_revision into rev from app.organizations where tenant_id=tenant and id=p_target and deleted_at is null for update;
 if rev is null then raise exception 'NOT_FOUND' using errcode='AG404';end if;if rev<>p_expected then raise exception 'REVISION_CONFLICT' using errcode='AG409';end if;
 perform 1 from private.development_seal_stock where tenant_id=tenant and organization_id=p_target for update;
 select count(*) into actual from private.development_seal_stock s where s.tenant_id=tenant and s.organization_id=p_target and s.status='IN_STOCK' and s.origin=p_payload->>'origin' and not exists(select 1 from private.draft_seal_placements p where p.tenant_id=tenant and p.seal_id=s.id and (p.released_at is null or s.origin='PRODUCTION'));
 observed:=(p_payload->>'observedCount')::integer;
 result:=jsonb_build_object('id',p_target,'expectedCount',actual,'observedCount',observed,'discrepancy',observed-actual,'origin',p_payload->>'origin');
 else
 if p_target<>tenant or p_payload-ARRAY['enabled','incidentPolicyEn','incidentPolicyFr','emergencyContact']<>'{}'::jsonb or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean'
 or jsonb_typeof(p_payload->'incidentPolicyEn') is distinct from 'string' or jsonb_typeof(p_payload->'incidentPolicyFr') is distinct from 'string'
 or length(btrim(p_payload->>'incidentPolicyEn')) not between 20 and 2000 or length(btrim(p_payload->>'incidentPolicyFr')) not between 20 and 2000
 or not(p_payload ? 'emergencyContact') or (p_payload->'emergencyContact'<>'null'::jsonb and (jsonb_typeof(p_payload->'emergencyContact') is distinct from 'string' or length(btrim(p_payload->>'emergencyContact')) not between 3 and 100)) then raise exception 'INVALID_CONFIGURATION' using errcode='AG400';end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text,25));
 select revision into rev from private.pilot_configuration where tenant_id=tenant for update;rev:=coalesce(rev,0);
 if rev<>p_expected then raise exception 'REVISION_CONFLICT' using errcode='AG409';end if;
 insert into private.pilot_configuration values(tenant,rev+1,(p_payload->>'enabled')::boolean,p_payload->>'incidentPolicyEn',p_payload->>'incidentPolicyFr',p_payload->>'emergencyContact',now(),actor)
 on conflict(tenant_id) do update set revision=excluded.revision,enabled=excluded.enabled,incident_policy_en=excluded.incident_policy_en,incident_policy_fr=excluded.incident_policy_fr,emergency_contact=excluded.emergency_contact,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 result:=jsonb_build_object('id',tenant,'revision',rev+1,'enabled',(p_payload->>'enabled')::boolean);end if;
 insert into private.pilot_admin_events(tenant_id,actor_id,request_key,action,target_id,expected_revision,payload,result) values(tenant,actor,p_key,p_action,p_target,p_expected,p_payload,result);
 return result;
end $$;
create function private.pilot_event_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'IMMUTABLE_AUDIT' using errcode='AG403';end $$;
create trigger pilot_event_immutable before update or delete on private.pilot_admin_events for each row execute function private.pilot_event_immutable();
grant create on schema private to autoguardian_pilot_executor;
alter function private.pilot_actor() owner to autoguardian_pilot_executor;
alter function private.pilot_read(text,integer,integer) owner to autoguardian_pilot_executor;
alter function private.pilot_change(uuid,text,uuid,integer,jsonb) owner to autoguardian_pilot_executor;
revoke create on schema private from autoguardian_pilot_executor;
revoke all on function private.pilot_actor(),private.pilot_read(text,integer,integer),private.pilot_change(uuid,text,uuid,integer,jsonb),private.pilot_event_immutable() from public,anon,authenticated,service_role;
grant execute on function private.pilot_read(text,integer,integer),private.pilot_change(uuid,text,uuid,integer,jsonb) to autoguardian_enrollment_api;
commit;
