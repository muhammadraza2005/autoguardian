-- Run as postgres after 007, in the development project only.
-- Private ciphertext objects; no mobile upload/read policies are added.
begin;
do $$
begin
  if not exists (select 1 from app.tenants where code='AUTOGUARDIAN_DEV' and status='ACTIVE' and deleted_at is null) then
    raise exception 'Active development tenant required';
  end if;
  if exists (select 1 from storage.buckets where id='development-enrollment-evidence' and public) then
    raise exception 'Existing evidence bucket is public; stop and review it';
  end if;
end;
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('development-enrollment-evidence','development-enrollment-evidence',false,2097216,array['application/octet-stream'])
on conflict (id) do nothing;
-- Restrictive policy defeats any unrelated broad permissive client policy.
create policy development_evidence_no_client_access on storage.objects as restrictive
  for all to public using (bucket_id<>'development-enrollment-evidence')
  with check (bucket_id<>'development-enrollment-evidence');
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='development-enrollment-evidence';
commit;
