-- Run after 014_library_links_and_upload_limit.sql. Every fixture rolls back.
begin;
create function pg_temp.link_assert(ok boolean,message text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Library links: %',message;end if;end;$$;
do $$ declare parent text:=encode(extensions.gen_random_bytes(32),'hex'); token text:=encode(extensions.gen_random_bytes(32),'hex'); begin
 perform set_config('qa.link_token',token,true);
 perform set_config('qa.admin',(select user_id::text from public.portal_admins limit 1),true);
 insert into public.assistant_access_sessions(token_hash,password_version) select encode(extensions.digest(parent,'sha256'),'hex'),password_version from public.assistant_access_config where id=1;
 insert into public.library_contributor_sessions(token_hash,parent_hash,version,author,expires_at) select encode(extensions.digest(token,'sha256'),'hex'),encode(extensions.digest(parent,'sha256'),'hex'),version,'QA link test',now()+interval '1 hour' from public.library_contributor_config where id=1;
 delete from public.library_contribution_limits;
 perform pg_temp.link_assert((select file_size_limit=1048576 from storage.buckets where id='portal-library'),'Storage limit is 1 MiB');
end $$;
set local role service_role;
do $$ declare token text:=current_setting('qa.link_token'); result jsonb; begin
 result:=public.library_begin_submission(token,'c8130921-a111-4111-8111-000000000001',repeat('b',64));
 perform pg_temp.link_assert(result->>'id' is not null,'link submission starts');
 result:=public.library_reserve_asset(token,'c8130921-a111-4111-8111-000000000001','c8130921-a111-4111-8111-000000000011',1048576,repeat('c',64));
 perform pg_temp.link_assert(result->>'path' is not null,'exactly 1 MiB accepted');
 result:=public.library_reserve_asset(token,'c8130921-a111-4111-8111-000000000001','c8130921-a111-4111-8111-000000000012',1048577,repeat('c',64));
 perform pg_temp.link_assert(result->>'error'='file-too-large','one extra byte rejected');
 result:=public.library_reserve_asset(token,'c8130921-a111-4111-8111-000000000001','c8130921-a111-4111-8111-000000000011',1048577,repeat('c',64));
 perform pg_temp.link_assert(result->>'error'='file-too-large','idempotent retry cannot bypass new limit');
 begin insert into public.library_contribution_assets(job_id,block_id,path,bytes,checksum) values('c8130921-a111-4111-8111-000000000001','c8130921-a111-4111-8111-000000000013','QA-invalid-overlimit',1048577,repeat('c',64));raise exception 'oversized asset metadata accepted';exception when check_violation then null;end;
 result:=public.library_commit_submission(token,'c8130921-a111-4111-8111-000000000001','{"id":"c8130921-a111-4111-8111-000000000001","title":"QA link","entry_type":"link","external_url":"javascript:alert(1)","blocks":[]}');
 perform pg_temp.link_assert(result->>'error'='invalid-content','script link rejected');
 result:=public.library_commit_submission(token,'c8130921-a111-4111-8111-000000000001','{"id":"c8130921-a111-4111-8111-000000000001","title":"QA link","entry_type":"link","external_url":"https://name:pass@example.org","blocks":[]}');
 perform pg_temp.link_assert(result->>'error'='invalid-content','URL credentials rejected');
 result:=public.library_commit_submission(token,'c8130921-a111-4111-8111-000000000001','{"id":"c8130921-a111-4111-8111-000000000001","title":"QA link","entry_type":"link","external_url":"https://drive.google.com/file/d/example/view","blocks":[],"is_published":true,"review_status":"approved"}');
 perform pg_temp.link_assert(result->>'submitted'='true','link without content can be submitted');
 perform pg_temp.link_assert((select entry_type='link' and review_status='pending' and not is_published and external_url='https://drive.google.com/file/d/example/view' from public.portal_library_items where id='c8130921-a111-4111-8111-000000000001'),'link has forced pending status');
end $$;
reset role;
set local role anon;
select pg_temp.link_assert((select count(*)=0 from public.portal_library_items where id='c8130921-a111-4111-8111-000000000001'),'pending link invisible');
reset role;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);end $$;
set local role authenticated;
do $$ begin
 begin update public.portal_library_items set external_url='data:text/html,test' where id='c8130921-a111-4111-8111-000000000001';raise exception 'unsafe URL accepted by table';exception when check_violation then null;end;
 update public.portal_library_items set external_url='https://example.org/reviewed',review_status='approved',is_published=true where id='c8130921-a111-4111-8111-000000000001';
end $$;
reset role;
set local role anon;
select pg_temp.link_assert((select external_url='https://example.org/reviewed' and entry_type='link' from public.portal_library_items where id='c8130921-a111-4111-8111-000000000001'),'approved edited link visible');
reset role;
rollback;
select 'Link moderation and one-MiB boundaries passed; fixtures rolled back.' as result;
