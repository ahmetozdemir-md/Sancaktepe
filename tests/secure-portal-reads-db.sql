-- Run after 010_secure_portal_reads.sql. Synthetic token rows and all changes roll back.
begin;
create function pg_temp.portal_read_assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'Portal read assertion failed: %', message; end if;
  perform set_config('qa.portal_read_assertions', (coalesce(nullif(current_setting('qa.portal_read_assertions',true),''),'0')::integer + 1)::text, true);
end;
$$;
do $$ begin
  perform set_config('qa.portal_admin', (select user_id::text from public.portal_admins limit 1), true);
  perform pg_temp.portal_read_assert(coalesce(current_setting('qa.portal_admin',true),'') <> '', 'an existing admin is required');
  perform set_config('qa.portal_read_hash',(select md5(payload::text || updated_at::text) from public.portal_state where id=1),true);
  perform pg_temp.portal_read_assert(exists(select 1 from public.assistant_access_config where id=1),'assistant access config exists');
end $$;
insert into public.assistant_access_sessions(token_hash,password_version,expires_at)
select encode(extensions.digest(repeat('a',64),'sha256'),'hex'),password_version,null from public.assistant_access_config where id=1
union all
select encode(extensions.digest(repeat('b',64),'sha256'),'hex'),password_version,now()-interval '1 minute' from public.assistant_access_config where id=1
union all
select encode(extensions.digest(repeat('c',64),'sha256'),'hex'),password_version+1,null from public.assistant_access_config where id=1
union all
select encode(extensions.digest(repeat('d',64),'sha256'),'hex'),password_version,now()+interval '1 day' from public.assistant_access_config where id=1;

do $$ begin perform set_config('request.jwt.claim.sub','',true); end $$;
set local role anon;
do $$ begin
  begin perform count(*) from public.portal_state; raise exception 'Anonymous table read was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  perform pg_temp.portal_read_assert(not has_table_privilege('anon','public.portal_state','SELECT'),'anon has no raw table read grant');
  begin perform public.read_portal_state(); raise exception 'Anonymous read without login was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  begin perform public.read_portal_revision(); raise exception 'Anonymous version read without login was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  begin perform public.read_portal_state('bad-token'); raise exception 'Malformed token was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  begin perform public.read_portal_revision(repeat('e',64)); raise exception 'Unknown token was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  begin perform public.read_portal_state(repeat('b',64)); raise exception 'Expired token was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  begin perform public.read_portal_revision(repeat('c',64)); raise exception 'Old password-version token was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  begin perform public.portal_schedule_read_allowed(repeat('a',64)); raise exception 'Private helper was exposed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  perform pg_temp.portal_read_assert(public.read_portal_state(repeat('a',64)) ? 'payload','remembered assistant device can read payload');
  perform pg_temp.portal_read_assert(public.read_portal_revision(repeat('a',64)) ? 'updatedAt','remembered assistant device can read revision');
  perform pg_temp.portal_read_assert(public.read_portal_state(repeat('d',64)) ? 'payload','valid bounded device session works too');
  perform pg_temp.portal_read_assert((public.read_portal_state(repeat('a',64))->>'updatedAt')=(public.read_portal_revision(repeat('a',64))->>'updatedAt'),'payload and version read use the same source revision');
end $$;
reset role;

-- A Supabase login alone is insufficient; it must be an admin or use the assistant gate.
do $$ begin perform set_config('request.jwt.claim.sub','f19e2901-69ba-4e1c-8100-000000000098',true); end $$;
set local role authenticated;
do $$ begin
  perform pg_temp.portal_read_assert((select count(*)=0 from public.portal_state),'non-admin raw table read exposes no rows');
  begin perform public.read_portal_state(); raise exception 'Non-admin without assistant gate was allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
  perform pg_temp.portal_read_assert(public.read_portal_state(repeat('a',64)) ? 'payload','authenticated non-admin may use a valid assistant device token');
end $$;
reset role;

do $$ begin perform set_config('request.jwt.claim.sub',current_setting('qa.portal_admin'),true); end $$;
set local role authenticated;
do $$ begin
  perform pg_temp.portal_read_assert((select count(*)=1 from public.portal_state where id=1),'verified admin retains direct table read');
  perform pg_temp.portal_read_assert(public.read_portal_state() ? 'payload','verified admin RPC does not require the shared password');
  perform pg_temp.portal_read_assert(public.read_portal_revision() ? 'updatedAt','verified admin may check revision');
  perform pg_temp.portal_read_assert(has_table_privilege('authenticated','public.portal_state','UPDATE'),'existing admin write table grant remains');
  perform pg_temp.portal_read_assert((public.read_portal_state()->'payload')=(select payload from public.portal_state where id=1),'admin RPC returns the authoritative payload unchanged');
end $$;
reset role;

-- Revocation/deletion and password changes invalidate remembered tokens without editing app state.
delete from public.assistant_access_sessions where token_hash=encode(extensions.digest(repeat('a',64),'sha256'),'hex');
do $$ begin perform set_config('request.jwt.claim.sub','',true); end $$;
set local role anon;
do $$ begin
  begin perform public.read_portal_state(repeat('a',64)); raise exception 'Deleted device token was still allowed'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
end $$;
reset role;
update public.assistant_access_config set password_version=password_version+1 where id=1;
set local role anon;
do $$ begin
  begin perform public.read_portal_revision(repeat('d',64)); raise exception 'Token survived password-version change'; exception when insufficient_privilege then perform pg_temp.portal_read_assert(true,'unauthorized access rejected'); end;
end $$;
reset role;
select pg_temp.portal_read_assert((select md5(payload::text || updated_at::text) from public.portal_state where id=1)=current_setting('qa.portal_read_hash'),'schedule payload and revision remain untouched');
select jsonb_build_object('assertions',current_setting('qa.portal_read_assertions')::integer,'synthetic_changes_rolled_back',true) as secure_reads_test;
rollback;
