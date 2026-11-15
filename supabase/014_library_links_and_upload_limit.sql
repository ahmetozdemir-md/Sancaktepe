-- Direct link guides and a one-MiB limit on all new library uploads.
-- Existing stored files remain readable. New reservations/uploads enforce the lower limit.
begin;
alter table public.portal_library_items add column if not exists entry_type text not null default 'content' check(entry_type in ('content','link'));
alter table public.portal_library_items add column if not exists external_url text not null default '';
alter table public.portal_library_items add constraint library_external_link_valid check (
 (entry_type='content' and external_url='') or
 (entry_type='link' and blocks='[]'::jsonb and char_length(external_url) between 8 and 2000
  and external_url ~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' and external_url !~ '[[:cntrl:]]')
);
update storage.buckets set file_size_limit=1048576 where id='portal-library';
alter table public.library_contribution_assets add constraint library_contribution_assets_one_mb check(bytes<=1048576) not valid;

create or replace function public.library_reserve_asset(p_token text,p_job uuid,p_block uuid,p_bytes integer,p_checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; job public.library_contribution_jobs%rowtype; asset public.library_contribution_assets%rowtype; newpath text;
begin
 ctx:=public.library_contributor_context(p_token); if ctx is null then return '{"error":"session-expired"}'; end if;
 select * into job from public.library_contribution_jobs where id=p_job for update;
 if not found or job.parent_hash<>ctx->>'parentHash' or job.state<>'open' or job.expires_at<=now() then return '{"error":"submission-expired"}'; end if;
 if p_bytes>1048576 then return '{"error":"file-too-large"}'; end if;
 if p_bytes is null or p_checksum is null or p_bytes not between 1 and 1048576 or p_checksum !~ '^[0-9a-f]{64}$' then return '{"error":"invalid-file"}'; end if;
 select * into asset from public.library_contribution_assets where job_id=p_job and block_id=p_block;
 if found then
  if asset.checksum=p_checksum then return jsonb_build_object('path',asset.path,'ready',asset.ready); end if;
  return '{"error":"upload-retry"}';
 end if;
 if (select count(*) from public.library_contribution_assets where job_id=p_job)>=8
 or (select coalesce(sum(bytes),0) from public.library_contribution_assets where job_id=p_job)+p_bytes>8388608 then return '{"error":"file-limit"}'; end if;
 if not public.library_take_limit('upload-global-day',209715200,86400,p_bytes)
 or not public.library_take_limit('upload-day:'||(ctx->>'parentHash'),33554432,86400,p_bytes) then return '{"error":"file-limit"}'; end if;
 newpath:=p_job::text||'/'||gen_random_uuid()::text||'.png';
 insert into public.library_contribution_assets(job_id,block_id,path,bytes,checksum) values(p_job,p_block,newpath,p_bytes,p_checksum);
 return jsonb_build_object('path',newpath,'ready',false);
end; $$;

create or replace function public.library_commit_submission(p_token text,p_job uuid,p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; job public.library_contribution_jobs%rowtype; b jsonb; entry_type text; external_url text;
begin
 ctx:=public.library_contributor_context(p_token); if ctx is null then return '{"error":"session-expired"}'; end if;
 select * into job from public.library_contribution_jobs where id=p_job for update;
 if not found or job.parent_hash<>ctx->>'parentHash' then return '{"error":"forbidden"}'; end if;
 if job.state='submitted' then return jsonb_build_object('id',p_job,'submitted',true); end if;
 if job.expires_at<=now() then return '{"error":"submission-expired"}'; end if;
 if p_entry is null or jsonb_typeof(p_entry)<>'object' or octet_length(p_entry::text)>524288 or p_entry->>'id' is distinct from p_job::text
 or p_entry->>'title' is null or char_length(trim(p_entry->>'title')) not between 1 and 120 or jsonb_typeof(p_entry->'blocks') is distinct from 'array' then return '{"error":"invalid-content"}'; end if;
 entry_type:=coalesce(p_entry->>'entry_type','content'); external_url:=coalesce(p_entry->>'external_url','');
 if entry_type not in ('content','link') then return '{"error":"invalid-content"}'; end if;
 if entry_type='link' then
  if jsonb_array_length(p_entry->'blocks')<>0 or char_length(external_url) not between 8 and 2000
  or external_url !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' or external_url ~ '[[:cntrl:]]' then return '{"error":"invalid-content"}'; end if;
 else
  if external_url<>'' or jsonb_array_length(p_entry->'blocks') not between 1 and 20 then return '{"error":"invalid-content"}'; end if;
 end if;
 for b in select value from jsonb_array_elements(p_entry->'blocks') loop
  if b->>'type' is null or b->>'type' not in ('text','table','section','image') then return '{"error":"invalid-content"}'; end if;
  if b->>'type'='image' and not exists(select 1 from public.library_contribution_assets where job_id=p_job and block_id::text=b->>'id' and path=b->>'path' and ready and bytes<=1048576) then return '{"error":"invalid-file"}'; end if;
 end loop;
 perform pg_advisory_xact_lock(59181301);
 if (select count(*) from public.portal_library_items where review_status='pending' and archived_at is null)>=100 then return '{"error":"queue-full"}'; end if;
 insert into public.portal_library_items(id,title,summary,category,kind,pinned,is_published,blocks,source_label,source_url,review_status,submitted_by,submitted_at,entry_type,external_url)
 values(p_job,trim(p_entry->>'title'),coalesce(p_entry->>'summary',''),'Genel','reference',false,false,p_entry->'blocks',coalesce(p_entry->>'source_label',''),coalesce(p_entry->>'source_url',''),'pending',job.author,now(),entry_type,external_url);
 update public.library_contribution_jobs set state='submitted' where id=p_job;
 return jsonb_build_object('id',p_job,'submitted',true);
end; $$;

notify pgrst,'reload schema';
commit;
