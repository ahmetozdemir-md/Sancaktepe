-- Run after 009_portal_library.sql. Every fixture is rolled back.
begin;
create function pg_temp.library_assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'Library assertion failed: %', message; end if;
end;
$$;
select pg_temp.library_assert(not public, 'asset bucket must remain private') from storage.buckets where id = 'portal-library';
select set_config('qa.library_admin', (select user_id::text from public.portal_admins limit 1), true);
select pg_temp.library_assert(current_setting('qa.library_admin') <> '', 'an existing portal admin is required');
select set_config('qa.portal_before', (select md5(payload::text) from public.portal_state where id = 1), true);

insert into public.portal_library_items (id, title, kind, is_published, archived_at, blocks) values
('f19e2901-69ba-4e1c-8100-000000000001', 'QA published reference', 'reference', true, null, '[{"id":"asset","type":"image","path":"f19e2901-69ba-4e1c-8100-000000000001/f19e2901-69ba-4e1c-8100-000000000011.png","fileName":"test.png","caption":"QA"}]'),
('f19e2901-69ba-4e1c-8100-000000000002', 'QA draft reference', 'reference', false, null, '[{"id":"asset","type":"image","path":"f19e2901-69ba-4e1c-8100-000000000002/f19e2901-69ba-4e1c-8100-000000000012.png","fileName":"test.png","caption":"QA"}]'),
('f19e2901-69ba-4e1c-8100-000000000003', 'QA archived reference', 'announcement', true, now(), '[]');
-- Metadata only, inside this rolled-back transaction; no actual files are created.
insert into storage.objects (bucket_id, name) values
('portal-library', 'f19e2901-69ba-4e1c-8100-000000000001/f19e2901-69ba-4e1c-8100-000000000011.png'),
('portal-library', 'f19e2901-69ba-4e1c-8100-000000000002/f19e2901-69ba-4e1c-8100-000000000012.png');

set local role anon;
select pg_temp.library_assert((select count(*) = 1 from public.portal_library_items where id::text like 'f19e2901-69ba-4e1c-8100-%'), 'anon can read only published, active content');
select pg_temp.library_assert((select count(*) = 1 from storage.objects where bucket_id = 'portal-library' and name like 'f19e2901-69ba-4e1c-8100-%'), 'anon can read only published assets');
do $$ begin
  begin
    insert into public.portal_library_items (title, kind) values ('QA forbidden', 'reference');
    raise exception 'anon insert was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values ('portal-library','forbidden.png');
    raise exception 'anon upload was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'f19e2901-69ba-4e1c-8100-000000000099', true);
set local role authenticated;
select pg_temp.library_assert((select count(*) = 1 from public.portal_library_items where id::text like 'f19e2901-69ba-4e1c-8100-%'), 'non-admin cannot read drafts');
do $$ declare affected integer; begin
  update public.portal_library_items set title='QA unauthorized edit' where id='f19e2901-69ba-4e1c-8100-000000000001';
  get diagnostics affected = row_count;
  perform pg_temp.library_assert(affected = 0, 'non-admin update must affect no rows');
end $$;
reset role;
select set_config('request.jwt.claim.sub', current_setting('qa.library_admin'), true);
set local role authenticated;
select pg_temp.library_assert((select count(*) = 3 from public.portal_library_items where id::text like 'f19e2901-69ba-4e1c-8100-%'), 'admin can read drafts and archives');
select pg_temp.library_assert((select count(*) = 2 from storage.objects where bucket_id='portal-library' and name like 'f19e2901-69ba-4e1c-8100-%'), 'admin can read draft assets');
insert into public.portal_library_items (id,title,kind,blocks) values ('f19e2901-69ba-4e1c-8100-000000000004','QA admin insert','announcement','[{"id":"text","type":"text","text":"Test only"}]');
do $$ declare old_stamp timestamptz; old_created timestamptz; affected integer; begin
  select updated_at,created_at into old_stamp,old_created from public.portal_library_items where id='f19e2901-69ba-4e1c-8100-000000000002';
  update public.portal_library_items set is_published=true where id='f19e2901-69ba-4e1c-8100-000000000002' and updated_at=old_stamp;
  get diagnostics affected = row_count;
  perform pg_temp.library_assert(affected=1, 'admin can publish');
  perform pg_temp.library_assert((select updated_at>old_stamp and created_at=old_created from public.portal_library_items where id='f19e2901-69ba-4e1c-8100-000000000002'), 'version changes while creation time is preserved');
  update public.portal_library_items set title='Stale overwrite' where id='f19e2901-69ba-4e1c-8100-000000000002' and updated_at=old_stamp;
  get diagnostics affected = row_count;
  perform pg_temp.library_assert(affected=0, 'stale update cannot overwrite newer content');
end $$;
reset role;
set local role anon;
select pg_temp.library_assert((select count(*)=2 from storage.objects where bucket_id='portal-library' and name like 'f19e2901-69ba-4e1c-8100-%'), 'published draft assets become readable');
reset role;
select set_config('request.jwt.claim.sub', current_setting('qa.library_admin'), true);
set local role authenticated;
update public.portal_library_items set is_published=false,archived_at=now() where id='f19e2901-69ba-4e1c-8100-000000000002';
reset role;
set local role anon;
select pg_temp.library_assert((select count(*)=1 from storage.objects where bucket_id='portal-library' and name like 'f19e2901-69ba-4e1c-8100-%'), 'archived asset cannot obtain a new signed URL');
reset role;
select pg_temp.library_assert((select md5(payload::text) from public.portal_state where id=1)=current_setting('qa.portal_before'), 'schedule data remains untouched');
select 'Library RLS, asset access, publishing, archive, conflict and isolation checks passed; fixtures rolled back.' as result;
rollback;
