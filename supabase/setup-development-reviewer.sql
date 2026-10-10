-- Optional manual development acceptance setup. No Auth identity is created.
-- Sign up/sign in with a SEPARATE test account first so /v1/me/profile creates
-- its tenant profile. Replace the UUID below with that account's profile ID.
-- Run as postgres after 017. Never use the enrolling agent's profile.
begin;
do $$
declare reviewer uuid:=null; -- REPLACE null WITH 'the separate account profile UUID'::uuid
  authority uuid:='ce31527e-d1b5-4379-9ddd-1458cfb73431';
begin
  if reviewer is null then raise exception 'Set reviewer to the separate test account profile UUID first'; end if;
  if not exists(select 1 from app.tenants where id=authority and code='AUTOGUARDIAN_DEV' and status='ACTIVE' and deleted_at is null)
    then raise exception 'Active development tenant required'; end if;
  if not exists(select 1 from app.users where id=reviewer and tenant_id=authority and status='ACTIVE' and deleted_at is null)
    then raise exception 'Sign into the separate account first and use its profile ID'; end if;
  if exists(select 1 from app.role_assignments where tenant_id=authority and user_id=reviewer and role_code='ENROLLMENT_AGENT' and deleted_at is null)
    then raise exception 'Choose a separate reviewer account without an agent grant'; end if;
  if exists(select 1 from app.role_assignments where tenant_id=authority and user_id=reviewer and role_code='TENANT_ADMIN' and organization_id is null) then
    if not exists(select 1 from app.role_assignments where tenant_id=authority and user_id=reviewer and role_code='TENANT_ADMIN' and organization_id is null
      and deleted_at is null and valid_from<=now() and (valid_to is null or valid_to>now())) then raise exception 'Existing reviewer grant is inactive; inspect it manually'; end if;
  else
    insert into app.role_assignments(tenant_id,user_id,role_code) values(authority,reviewer,'TENANT_ADMIN');
  end if;
end; $$;
commit;
