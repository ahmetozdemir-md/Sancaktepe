-- Shared assistant-entry password, remembered-device sessions, and lockout.
-- Run this migration after 003_auth_harden_portal_state.sql.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.assistant_access_config (
  id integer primary key check (id = 1),
  password_hash text not null,
  password_version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.assistant_access_sessions (
  token_hash text primary key,
  password_version bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now()
);

create table if not exists public.assistant_access_attempts (
  device_hash text primary key,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.assistant_access_config (id, password_hash)
values (1, '$2a$12$1F/qolQQJR5hUSNcGn471O5sYrl9kDE/pNM7fG34mBunEK90hjTnK')
on conflict (id) do nothing;

alter table public.assistant_access_config enable row level security;
alter table public.assistant_access_sessions enable row level security;
alter table public.assistant_access_attempts enable row level security;

revoke all on table public.assistant_access_config from public, anon, authenticated;
revoke all on table public.assistant_access_sessions from public, anon, authenticated;
revoke all on table public.assistant_access_attempts from public, anon, authenticated;

create or replace function public.verify_assistant_access(
  p_password text,
  p_device_hash text
)
returns table (
  success boolean,
  access_token text,
  blocked_until timestamptz,
  attempts_remaining integer,
  status_message text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_config public.assistant_access_config%rowtype;
  v_attempt public.assistant_access_attempts%rowtype;
  v_failed_attempts integer;
  v_blocked_until timestamptz;
  v_access_token text;
begin
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    return query
      select false, null::text, null::timestamptz, 0, 'invalid-device'::text;
    return;
  end if;

  insert into public.assistant_access_attempts (device_hash)
  values (p_device_hash)
  on conflict (device_hash) do nothing;

  select *
  into v_attempt
  from public.assistant_access_attempts
  where device_hash = p_device_hash
  for update;

  if v_attempt.blocked_until is not null and v_attempt.blocked_until > now() then
    return query
      select false, null::text, v_attempt.blocked_until, 0, 'blocked'::text;
    return;
  end if;

  if v_attempt.blocked_until is not null then
    update public.assistant_access_attempts
    set failed_attempts = 0,
        blocked_until = null,
        updated_at = now()
    where device_hash = p_device_hash;
    v_attempt.failed_attempts := 0;
    v_attempt.blocked_until := null;
  end if;

  select *
  into strict v_config
  from public.assistant_access_config
  where id = 1;

  if coalesce(p_password, '') <> ''
     and v_config.password_hash = extensions.crypt(p_password, v_config.password_hash) then
    delete from public.assistant_access_attempts
    where device_hash = p_device_hash;

    delete from public.assistant_access_sessions
    where expires_at <= now()
       or password_version <> v_config.password_version;

    v_access_token := encode(extensions.gen_random_bytes(32), 'hex');

    insert into public.assistant_access_sessions (
      token_hash,
      password_version,
      expires_at
    )
    values (
      encode(extensions.digest(v_access_token, 'sha256'), 'hex'),
      v_config.password_version,
      now() + interval '365 days'
    );

    return query
      select true, v_access_token, null::timestamptz, 5, 'verified'::text;
    return;
  end if;

  v_failed_attempts := coalesce(v_attempt.failed_attempts, 0) + 1;

  if v_failed_attempts >= 5 then
    v_blocked_until := now() + interval '1 hour';
    update public.assistant_access_attempts
    set failed_attempts = 0,
        blocked_until = v_blocked_until,
        updated_at = now()
    where device_hash = p_device_hash;

    return query
      select false, null::text, v_blocked_until, 0, 'blocked'::text;
    return;
  end if;

  update public.assistant_access_attempts
  set failed_attempts = v_failed_attempts,
      blocked_until = null,
      updated_at = now()
  where device_hash = p_device_hash;

  return query
    select false, null::text, null::timestamptz, 5 - v_failed_attempts, 'invalid-password'::text;
end;
$$;

create or replace function public.validate_assistant_access(
  p_access_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token_hash text;
  v_valid boolean := false;
begin
  if p_access_token is null or p_access_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  v_token_hash := encode(extensions.digest(p_access_token, 'sha256'), 'hex');

  update public.assistant_access_sessions as sessions
  set last_used_at = now()
  from public.assistant_access_config as config
  where config.id = 1
    and sessions.token_hash = v_token_hash
    and sessions.password_version = config.password_version
    and sessions.expires_at > now()
  returning true into v_valid;

  return coalesce(v_valid, false);
end;
$$;

create or replace function public.change_assistant_access_password(
  p_new_password text
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_new_version bigint;
begin
  if auth.uid() is null
     or not exists (
       select 1
       from public.portal_admins
       where user_id = auth.uid()
     ) then
    raise exception 'Only portal admins can change the assistant password'
      using errcode = '42501';
  end if;

  if p_new_password is null
     or char_length(p_new_password) < 8
     or char_length(p_new_password) > 128 then
    raise exception 'Assistant password must contain 8 to 128 characters'
      using errcode = '22023';
  end if;

  update public.assistant_access_config
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
      password_version = password_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1
  returning password_version into v_new_version;

  delete from public.assistant_access_sessions;
  delete from public.assistant_access_attempts;

  return v_new_version;
end;
$$;

revoke all on function public.verify_assistant_access(text, text) from public;
revoke all on function public.validate_assistant_access(text) from public;
revoke all on function public.change_assistant_access_password(text) from public;

grant execute on function public.verify_assistant_access(text, text) to anon, authenticated;
grant execute on function public.validate_assistant_access(text) to anon, authenticated;
grant execute on function public.change_assistant_access_password(text) to authenticated;

comment on table public.assistant_access_config is
  'Stores only the bcrypt hash and version of the shared assistant-entry password.';
comment on table public.assistant_access_sessions is
  'Stores only hashes of remembered-device tokens. Password changes invalidate all versions.';
comment on function public.verify_assistant_access(text, text) is
  'Verifies the shared assistant password and enforces five-attempt device lockout.';
comment on function public.change_assistant_access_password(text) is
  'Allows portal admins to rotate the shared assistant password and revoke remembered devices.';
