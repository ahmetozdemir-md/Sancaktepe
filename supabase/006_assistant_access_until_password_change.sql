-- Keep remembered assistant devices valid until the shared password changes.
-- Run this migration after 005_assistant_access_password.sql.

alter table public.assistant_access_sessions
  alter column expires_at drop not null;

update public.assistant_access_sessions
set expires_at = null
where expires_at is not null;

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
    where password_version <> v_config.password_version;

    v_access_token := encode(extensions.gen_random_bytes(32), 'hex');

    insert into public.assistant_access_sessions (
      token_hash,
      password_version
    )
    values (
      encode(extensions.digest(v_access_token, 'sha256'), 'hex'),
      v_config.password_version
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
  returning true into v_valid;

  return coalesce(v_valid, false);
end;
$$;

revoke all on function public.verify_assistant_access(text, text) from public;
revoke all on function public.validate_assistant_access(text) from public;

grant execute on function public.verify_assistant_access(text, text) to anon, authenticated;
grant execute on function public.validate_assistant_access(text) to anon, authenticated;

comment on table public.assistant_access_sessions is
  'Stores hashes of remembered-device tokens until the shared password changes.';
comment on function public.validate_assistant_access(text) is
  'Validates a remembered-device token against the current shared-password version.';
