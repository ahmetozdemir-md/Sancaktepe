-- Device passkeys for assistant access.
-- Run this migration after 006_assistant_access_until_password_change.sql.

create table if not exists public.assistant_passkey_credentials (
  credential_id text primary key,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  password_version bigint not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.assistant_passkey_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  challenge text not null unique,
  ceremony text not null check (ceremony in ('register', 'authenticate')),
  access_token_hash text,
  origin text not null,
  rp_id text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists assistant_passkey_credentials_version_idx
  on public.assistant_passkey_credentials (password_version);
create index if not exists assistant_passkey_challenges_expiry_idx
  on public.assistant_passkey_challenges (expires_at);

alter table public.assistant_passkey_credentials enable row level security;
alter table public.assistant_passkey_challenges enable row level security;

revoke all on table public.assistant_passkey_credentials from public, anon, authenticated;
revoke all on table public.assistant_passkey_challenges from public, anon, authenticated;

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
  delete from public.assistant_passkey_credentials;
  delete from public.assistant_passkey_challenges;

  return v_new_version;
end;
$$;

revoke all on function public.change_assistant_access_password(text) from public;
grant execute on function public.change_assistant_access_password(text) to authenticated;

comment on table public.assistant_passkey_credentials is
  'Stores public WebAuthn credentials for remembered assistant devices.';
comment on table public.assistant_passkey_challenges is
  'Stores short-lived, one-time WebAuthn challenges.';
comment on function public.change_assistant_access_password(text) is
  'Rotates the assistant password and revokes browser tokens and passkeys.';
