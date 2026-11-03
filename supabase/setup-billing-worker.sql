-- Run as postgres after migration 024. Replace only PASTE_PASSWORD_HERE locally.
-- Never save the completed password or connection URL in this repository.
-- Do not use the HTTP identity login, service_role or postgres as a worker.
begin;
do $setup$
declare worker_password text := $password$PASTE_PASSWORD_HERE$password$;
begin
 if worker_password='PASTE_PASSWORD_HERE' or length(worker_password)<24 then
   raise exception 'Enter a random worker password of at least 24 characters.';
 end if;
 execute format('create role autoguardian_billing_login login noinherit nosuperuser nocreatedb nocreaterole nobypassrls password %L',worker_password);
end;
$setup$;
grant autoguardian_billing_worker to autoguardian_billing_login;
grant usage on schema private to autoguardian_billing_login;
commit;
-- Configure BILLING_DATABASE_URL with this login and its password.
