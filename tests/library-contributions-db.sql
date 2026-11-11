-- Run after 013_library_contributions.sql. Fixtures, credentials and all changes roll back.
begin;
create function pg_temp.contribution_assert(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Contribution assertion failed: %',message; end if; end; $$;
do $$ declare parent text:=encode(extensions.gen_random_bytes(32),'hex'); token text; admin_id text; result jsonb; begin
 perform set_config('qa.portal_before',(select md5(payload::text) from public.portal_state where id=1),true);
 select user_id::text into admin_id from public.portal_admins limit 1;
 perform pg_temp.contribution_assert(admin_id is not null,'admin fixture required');
 perform set_config('qa.admin',admin_id,true);
 perform set_config('qa.parent',parent,true);
 insert into public.assistant_access_sessions(token_hash,password_version) select encode(extensions.digest(parent,'sha256'),'hex'),password_version from public.assistant_access_config where id=1;
 insert into public.library_contributor_config(id,password_hash) values(1,extensions.crypt('QA-only-password',extensions.gen_salt('bf',4))) on conflict(id) do update set password_hash=excluded.password_hash;
 -- Isolated counters in this transaction; existing production counters return on rollback.
 delete from public.library_contribution_limits;
 result:=public.library_contributor_login(repeat('0',64),'QA-only-password','QA',repeat('b',64));
 perform pg_temp.contribution_assert(result->>'error'='assistant-login-required','parent session required');
 result:=public.library_contributor_login(parent,'wrong-password','QA',repeat('b',64));
 perform pg_temp.contribution_assert(result->>'error'='invalid-password','wrong password rejected');
 perform pg_temp.contribution_assert((select used=1 from public.library_contribution_limits where key='login-parent:'||encode(extensions.digest(parent,'sha256'),'hex')),'failed attempts persist');
 result:=public.library_contributor_login(parent,'QA-only-password','QA contributor',repeat('b',64));
 token:=result->>'token';perform pg_temp.contribution_assert(token ~ '^[0-9a-f]{64}$','valid contributor token issued');
 perform set_config('qa.token',token,true);
 perform pg_temp.contribution_assert(public.library_contributor_context(token)->>'author'='QA contributor','session context preserves provided name');
 perform pg_temp.contribution_assert((select expires_at>now()+interval '7 hours' and expires_at<=now()+interval '8 hours' from public.library_contributor_sessions where token_hash=encode(extensions.digest(token,'sha256'),'hex')),'session lifetime is bounded');
end $$;
set local role anon;
do $$ begin
 begin perform public.library_contributor_context(current_setting('qa.token'));raise exception 'anon accessed internal function';exception when insufficient_privilege then null;end;
 begin perform * from public.library_contributor_config;raise exception 'anon read password hash';exception when insufficient_privilege then null;end;
 begin insert into public.portal_library_items(title,kind) values('Unauthorized','reference');raise exception 'anon inserted guide';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub','c9130921-a111-4111-8111-000000000099',true);end $$;
set local role authenticated;
do $$ begin
 begin perform public.change_library_contributor_password('unauthorized-password');raise exception 'non-admin changed password';exception when insufficient_privilege then null;end;
 begin perform public.library_begin_submission(current_setting('qa.token'),'c9130921-a111-4111-8111-000000000001',repeat('b',64));raise exception 'non-admin called internal function';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ declare result jsonb; path text; entry jsonb; token text:=current_setting('qa.token'); begin
 result:=public.library_begin_submission(token,'c9130921-a111-4111-8111-000000000001',repeat('b',64));perform pg_temp.contribution_assert(result->>'id' is not null,'submission starts');
 result:=public.library_begin_submission(token,'c9130921-a111-4111-8111-000000000001',repeat('b',64));perform pg_temp.contribution_assert(result->>'id' is not null,'begin is idempotent');
 perform pg_temp.contribution_assert((select used=1 from public.library_contribution_limits where key like 'submit-hour:%'),'retry uses no additional quota');
 result:=public.library_reserve_asset(token,'c9130921-a111-4111-8111-000000000001','c9130921-a111-4111-8111-000000000010',128,repeat('c',64));path:=result->>'path';perform pg_temp.contribution_assert(path is not null,'server generates private asset path');
 perform pg_temp.contribution_assert((public.library_reserve_asset(token,'c9130921-a111-4111-8111-000000000001','c9130921-a111-4111-8111-000000000010',128,repeat('c',64))->>'path')=path,'upload reservation is idempotent');
 perform pg_temp.contribution_assert((public.library_reserve_asset(token,'c9130921-a111-4111-8111-000000000001','c9130921-a111-4111-8111-000000000010',128,repeat('d',64))->>'error')='upload-retry','reserved assets cannot be overwritten');
 entry:=jsonb_build_object('id','c9130921-a111-4111-8111-000000000001','title','QA pending','is_published',true,'review_status','approved','submitted_by','FORGED','blocks',jsonb_build_array(jsonb_build_object('id','c9130921-a111-4111-8111-000000000010','type','image','path',path,'fileName','test.png','caption','QA')));
 perform pg_temp.contribution_assert((public.library_commit_submission(token,'c9130921-a111-4111-8111-000000000001',entry)->>'error')='invalid-file','unfinished uploads cannot be submitted');
 update public.library_contribution_assets set ready=true where job_id='c9130921-a111-4111-8111-000000000001';
 result:=public.library_commit_submission(token,'c9130921-a111-4111-8111-000000000001',entry);perform pg_temp.contribution_assert(result->>'submitted'='true','submission commits');
 result:=public.library_commit_submission(token,'c9130921-a111-4111-8111-000000000001',entry);perform pg_temp.contribution_assert(result->>'submitted'='true','submit retry is idempotent');
 perform pg_temp.contribution_assert((select not is_published and review_status='pending' and submitted_by='QA contributor' from public.portal_library_items where id='c9130921-a111-4111-8111-000000000001'),'forged approval and author cannot bypass moderation');
 perform public.library_begin_submission(token,'c9130921-a111-4111-8111-000000000002',repeat('b',64));
 perform public.library_begin_submission(token,'c9130921-a111-4111-8111-000000000003',repeat('b',64));
 result:=public.library_begin_submission(token,'c9130921-a111-4111-8111-000000000004',repeat('b',64));perform pg_temp.contribution_assert(result->>'error'='submission-limit','fourth hourly submission blocked');
 -- An asset from a different submission is never accepted.
 entry:=jsonb_set(entry,'{id}','"c9130921-a111-4111-8111-000000000002"');
 perform pg_temp.contribution_assert((public.library_commit_submission(token,'c9130921-a111-4111-8111-000000000002',entry)->>'error')='invalid-file','cross-job asset rejected');
 perform pg_temp.contribution_assert((public.library_commit_submission(token,'c9130921-a111-4111-8111-000000000002','{}')->>'error')='invalid-content','missing fields fail closed');
end $$;
reset role;
insert into storage.objects(bucket_id,name) select 'portal-library',path from public.library_contribution_assets where job_id='c9130921-a111-4111-8111-000000000001';
set local role anon;
select pg_temp.contribution_assert((select count(*)=0 from public.portal_library_items where id='c9130921-a111-4111-8111-000000000001'),'pending content invisible');
select pg_temp.contribution_assert((select count(*)=0 from storage.objects where bucket_id='portal-library' and name like 'c9130921-a111-4111-8111-000000000001/%'),'pending files invisible');
reset role;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);end $$;
set local role authenticated;
do $$ begin
 perform pg_temp.contribution_assert((select count(*)=1 from public.portal_library_items where id='c9130921-a111-4111-8111-000000000001'),'admin can inspect pending content');
 begin update public.portal_library_items set is_published=true where id='c9130921-a111-4111-8111-000000000001';raise exception 'pending guide published without approval';exception when check_violation then null;end;
 update public.portal_library_items set title='QA reviewed',review_status='approved',is_published=true where id='c9130921-a111-4111-8111-000000000001';
end $$;
reset role;
set local role anon;
select pg_temp.contribution_assert((select count(*)=1 from public.portal_library_items where id='c9130921-a111-4111-8111-000000000001' and title='QA reviewed'),'approved edited guide visible');
select pg_temp.contribution_assert((select count(*)=1 from storage.objects where bucket_id='portal-library' and name like 'c9130921-a111-4111-8111-000000000001/%'),'approved files visible');
reset role;
do $$ declare token text:=current_setting('qa.token'); hash text:=encode(extensions.digest(token,'sha256'),'hex'); begin
 update public.library_contributor_sessions set expires_at=now()-interval '1 second' where token_hash=hash;
 perform pg_temp.contribution_assert(public.library_contributor_context(token) is null,'expired session blocked');
 update public.library_contributor_sessions set expires_at=now()+interval '1 hour' where token_hash=hash;
 update public.assistant_access_sessions set password_version=password_version-1 where token_hash=encode(extensions.digest(current_setting('qa.parent'),'sha256'),'hex');
 perform pg_temp.contribution_assert(public.library_contributor_context(token) is null,'parent password rotation revokes contribution access');
 update public.assistant_access_sessions set password_version=password_version+1 where token_hash=encode(extensions.digest(current_setting('qa.parent'),'sha256'),'hex');
 perform pg_temp.contribution_assert(public.library_contributor_context(token) is not null,'parent fixture restored');
end $$;
set local role authenticated;
select public.change_library_contributor_password('QA-only-new-password');
reset role;
select pg_temp.contribution_assert(public.library_contributor_context(current_setting('qa.token')) is null,'contributor password rotation revokes all sessions');
select pg_temp.contribution_assert((select md5(payload::text) from public.portal_state where id=1)=current_setting('qa.portal_before'),'clinical schedules unchanged');
rollback;
select 'Contribution security, quotas, moderation and credential rotation passed; all fixtures rolled back.' as result;
