-- Moderated guide submissions. No contributor receives table or Storage write permissions.
begin;

alter table public.portal_library_items add column if not exists review_status text not null default 'approved' check (review_status in ('pending','approved','rejected'));
alter table public.portal_library_items add column if not exists submitted_by text;
alter table public.portal_library_items add column if not exists submitted_at timestamptz;
alter table public.portal_library_items add constraint library_review_before_publish check (not is_published or review_status = 'approved');

create table public.library_contributor_config (
 id integer primary key check(id=1), password_hash text not null, version bigint not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
-- Initial hash is provisioned by the deployment script; a fresh unprovisioned install stays closed.
create table public.library_contributor_sessions (
 token_hash text primary key, parent_hash text not null, version bigint not null,
 author text not null check(char_length(author) between 1 and 150),
 created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table public.library_contribution_limits (
 key text primary key, started_at timestamptz not null, used bigint not null check(used>=0)
);
create table public.library_contribution_jobs (
 id uuid primary key, parent_hash text not null, author text not null,
 state text not null default 'open' check(state in ('open','submitted')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour'
);
create table public.library_contribution_assets (
 job_id uuid not null references public.library_contribution_jobs(id) on delete cascade,
 block_id uuid not null, path text not null unique, bytes integer not null check(bytes between 1 and 4194304),
 checksum text not null, ready boolean not null default false, primary key(job_id,block_id)
);
create index library_contributor_parent on public.library_contributor_sessions(parent_hash);
create index library_contribution_pending on public.portal_library_items(review_status,submitted_at) where review_status='pending';

alter table public.library_contributor_config enable row level security;
alter table public.library_contributor_sessions enable row level security;
alter table public.library_contribution_limits enable row level security;
alter table public.library_contribution_jobs enable row level security;
alter table public.library_contribution_assets enable row level security;
revoke all on public.library_contributor_config,public.library_contributor_sessions,public.library_contribution_limits,public.library_contribution_jobs,public.library_contribution_assets from public,anon,authenticated;
grant all on public.library_contributor_config,public.library_contributor_sessions,public.library_contribution_limits,public.library_contribution_jobs,public.library_contribution_assets to service_role;

create function public.library_take_limit(p_key text,p_limit bigint,p_seconds integer,p_amount bigint default 1)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.library_contribution_limits%rowtype;
begin
 if p_amount<1 or p_amount>p_limit then return false; end if;
 insert into public.library_contribution_limits(key,started_at,used) values(p_key,now(),0) on conflict do nothing;
 select * into r from public.library_contribution_limits where key=p_key for update;
 if r.started_at + make_interval(secs=>p_seconds) <= now() then r.started_at:=now(); r.used:=0; end if;
 if r.used+p_amount>p_limit then return false; end if;
 update public.library_contribution_limits set used=r.used+p_amount,started_at=r.started_at where key=p_key;
 return true;
end; $$;

create function public.library_contributor_context(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
 select jsonb_build_object('parentHash',s.parent_hash,'author',s.author,'expiresAt',s.expires_at) into result
 from public.library_contributor_sessions s
 join public.library_contributor_config c on c.id=1 and s.version=c.version
 join public.assistant_access_sessions a on a.token_hash=s.parent_hash
 join public.assistant_access_config ac on ac.id=1 and a.password_version=ac.password_version
 where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.expires_at>now()
 and (a.expires_at is null or a.expires_at>now());
 return result;
end; $$;

create function public.library_contributor_login(p_parent_token text,p_password text,p_author text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare parent text; v public.library_contributor_config%rowtype; token text;
begin
 if not public.library_take_limit('login-global',300,3600) then return '{"error":"rate-limited"}'; end if;
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or not public.library_take_limit('login-ip:'||p_ip_hash,30,3600) then return '{"error":"rate-limited"}'; end if;
 if p_parent_token is null or p_parent_token !~ '^[0-9a-f]{64}$' then return '{"error":"assistant-login-required"}'; end if;
 parent:=encode(extensions.digest(p_parent_token,'sha256'),'hex');
 if not exists(select 1 from public.assistant_access_sessions s join public.assistant_access_config c on c.id=1 and s.password_version=c.password_version where s.token_hash=parent and (s.expires_at is null or s.expires_at>now())) then return '{"error":"assistant-login-required"}'; end if;
 if not public.library_take_limit('login-parent:'||parent,5,900) then return '{"error":"rate-limited"}'; end if;
 if p_author is null or char_length(trim(p_author)) not between 1 and 150 then return '{"error":"invalid-content"}'; end if;
 select * into v from public.library_contributor_config where id=1;
 if not found then return '{"error":"not-configured"}'; end if;
 if p_password is null or octet_length(p_password)>72 or char_length(p_password)<8 or extensions.crypt(p_password,v.password_hash)<>v.password_hash then return '{"error":"invalid-password"}'; end if;
 delete from public.library_contributor_sessions where expires_at<now() or version<>v.version;
 delete from public.library_contribution_limits where started_at<now()-interval '2 days';
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.library_contributor_sessions(token_hash,parent_hash,version,author,expires_at) values(encode(extensions.digest(token,'sha256'),'hex'),parent,v.version,trim(p_author),now()+interval '8 hours');
 return jsonb_build_object('token',token,'expiresAt',now()+interval '8 hours');
end; $$;

create function public.library_begin_submission(p_token text,p_id uuid,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; job public.library_contribution_jobs%rowtype; parent text;
begin
 ctx:=public.library_contributor_context(p_token); if ctx is null then return '{"error":"session-expired"}'; end if;
 parent:=ctx->>'parentHash';
 perform pg_advisory_xact_lock(59181301);
 select * into job from public.library_contribution_jobs where id=p_id;
 if found then
  if job.parent_hash<>parent then return '{"error":"forbidden"}'; end if;
  if job.state='submitted' then return jsonb_build_object('id',p_id,'submitted',true); end if;
  if job.expires_at>now() then return jsonb_build_object('id',p_id); end if;
  return '{"error":"submission-expired"}';
 end if;
 if (select count(*) from public.portal_library_items where review_status='pending' and archived_at is null)>=100 then return '{"error":"queue-full"}'; end if;
 if not public.library_take_limit('submit-global-hour',30,3600) or not public.library_take_limit('submit-global-day',100,86400)
 or not public.library_take_limit('submit-ip:'||p_ip_hash,15,3600)
 or not public.library_take_limit('submit-hour:'||parent,3,3600) or not public.library_take_limit('submit-day:'||parent,10,86400) then return '{"error":"submission-limit"}'; end if;
 insert into public.library_contribution_jobs(id,parent_hash,author) values(p_id,parent,ctx->>'author');
 return jsonb_build_object('id',p_id);
end; $$;

create function public.library_reserve_asset(p_token text,p_job uuid,p_block uuid,p_bytes integer,p_checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; job public.library_contribution_jobs%rowtype; asset public.library_contribution_assets%rowtype; newpath text;
begin
 ctx:=public.library_contributor_context(p_token); if ctx is null then return '{"error":"session-expired"}'; end if;
 select * into job from public.library_contribution_jobs where id=p_job for update;
 if not found or job.parent_hash<>ctx->>'parentHash' or job.state<>'open' or job.expires_at<=now() then return '{"error":"submission-expired"}'; end if;
 select * into asset from public.library_contribution_assets where job_id=p_job and block_id=p_block;
 if found then
  if asset.checksum=p_checksum then return jsonb_build_object('path',asset.path,'ready',asset.ready); end if;
  return '{"error":"upload-retry"}';
 end if;
 if p_bytes is null or p_checksum is null or p_bytes not between 1 and 4194304 or p_checksum !~ '^[0-9a-f]{64}$' then return '{"error":"invalid-file"}'; end if;
 if (select count(*) from public.library_contribution_assets where job_id=p_job)>=8
 or (select coalesce(sum(bytes),0) from public.library_contribution_assets where job_id=p_job)+p_bytes>16777216 then return '{"error":"file-limit"}'; end if;
 if not public.library_take_limit('upload-global-day',209715200,86400,p_bytes)
 or not public.library_take_limit('upload-day:'||(ctx->>'parentHash'),33554432,86400,p_bytes) then return '{"error":"file-limit"}'; end if;
 newpath:=p_job::text||'/'||gen_random_uuid()::text||'.png';
 insert into public.library_contribution_assets(job_id,block_id,path,bytes,checksum) values(p_job,p_block,newpath,p_bytes,p_checksum);
 return jsonb_build_object('path',newpath,'ready',false);
end; $$;

create function public.library_commit_submission(p_token text,p_job uuid,p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; job public.library_contribution_jobs%rowtype; b jsonb;
begin
 ctx:=public.library_contributor_context(p_token); if ctx is null then return '{"error":"session-expired"}'; end if;
 select * into job from public.library_contribution_jobs where id=p_job for update;
 if not found or job.parent_hash<>ctx->>'parentHash' then return '{"error":"forbidden"}'; end if;
 if job.state='submitted' then return jsonb_build_object('id',p_job,'submitted',true); end if;
 if job.expires_at<=now() then return '{"error":"submission-expired"}'; end if;
 if p_entry is null or jsonb_typeof(p_entry)<>'object' or octet_length(p_entry::text)>524288 or p_entry->>'id' is distinct from p_job::text
 or p_entry->>'title' is null or char_length(trim(p_entry->>'title')) not between 1 and 120 or jsonb_typeof(p_entry->'blocks') is distinct from 'array' then return '{"error":"invalid-content"}'; end if;
 if jsonb_array_length(p_entry->'blocks') not between 1 and 20 then return '{"error":"invalid-content"}'; end if;
 for b in select value from jsonb_array_elements(p_entry->'blocks') loop
  if b->>'type' is null or b->>'type' not in ('text','table','section','image') then return '{"error":"invalid-content"}'; end if;
  if b->>'type'='image' and not exists(select 1 from public.library_contribution_assets where job_id=p_job and block_id::text=b->>'id' and path=b->>'path' and ready) then return '{"error":"invalid-file"}'; end if;
 end loop;
 perform pg_advisory_xact_lock(59181301);
 if (select count(*) from public.portal_library_items where review_status='pending' and archived_at is null)>=100 then return '{"error":"queue-full"}'; end if;
 insert into public.portal_library_items(id,title,summary,category,kind,pinned,is_published,blocks,source_label,source_url,review_status,submitted_by,submitted_at)
 values(p_job,trim(p_entry->>'title'),coalesce(p_entry->>'summary',''),'Genel','reference',false,false,p_entry->'blocks',coalesce(p_entry->>'source_label',''),coalesce(p_entry->>'source_url',''),'pending',job.author,now());
 update public.library_contribution_jobs set state='submitted' where id=p_job;
 return jsonb_build_object('id',p_job,'submitted',true);
end; $$;

create function public.change_library_contributor_password(p_new_password text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.portal_admins where user_id=auth.uid()) then raise exception 'Admin required' using errcode='42501'; end if;
 if p_new_password is null or char_length(p_new_password)<8 or octet_length(p_new_password)>72 then raise exception 'Password must be 8 to 72 bytes' using errcode='22023'; end if;
 insert into public.library_contributor_config(id,password_hash,updated_by) values(1,extensions.crypt(p_new_password,extensions.gen_salt('bf',12)),auth.uid())
 on conflict(id) do update set password_hash=excluded.password_hash,version=public.library_contributor_config.version+1,updated_at=now(),updated_by=auth.uid() returning version into v;
 delete from public.library_contributor_sessions;
 return v;
end; $$;

revoke all on function public.library_take_limit(text,bigint,integer,bigint),public.library_contributor_context(text),public.library_contributor_login(text,text,text,text),public.library_begin_submission(text,uuid,text),public.library_reserve_asset(text,uuid,uuid,integer,text),public.library_commit_submission(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.library_take_limit(text,bigint,integer,bigint),public.library_contributor_context(text),public.library_contributor_login(text,text,text,text),public.library_begin_submission(text,uuid,text),public.library_reserve_asset(text,uuid,uuid,integer,text),public.library_commit_submission(text,uuid,jsonb) to service_role;
revoke all on function public.change_library_contributor_password(text) from public,anon;
grant execute on function public.change_library_contributor_password(text) to authenticated;
notify pgrst,'reload schema';
commit;
