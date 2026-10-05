-- Optional setup for running the backend. First apply migration 003.
-- Replace ONLY PASTE_PASSWORD_HERE on the declaration line in your SQL Editor copy.
-- Keep the surrounding $password$ markers. Do not change the other lines.
-- Never save the real password in this repository or share it in chat.
begin;
do $setup$
declare login_password text := $password$PASTE_PASSWORD_HERE$password$;
begin
    if login_password is null or length(login_password) < 24 then
        raise exception using message = 'Enter a random password of at least 24 characters on the declaration line.';
    end if;
    execute format('create role autoguardian_identity_login login noinherit nosuperuser nocreatedb nocreaterole nobypassrls password %L', login_password);
end;
$setup$;
grant autoguardian_identity_api to autoguardian_identity_login;
commit;
