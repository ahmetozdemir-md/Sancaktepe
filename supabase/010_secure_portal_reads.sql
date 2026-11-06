-- Published schedules require the existing admin or shared assistant-device login.
-- Apply after 006_assistant_access_until_password_change.sql and the matching client release.
-- This migration changes read access only; admin writes and private planner data stay intact.
begin;

create or replace function public.portal_schedule_read_allowed(p_access_token text default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select exists (select 1 from public.portal_admins where user_id = auth.uid())
    or (
      p_access_token ~ '^[0-9a-f]{64}$'
      and exists (
        select 1 from public.assistant_access_sessions sessions
        join public.assistant_access_config config on config.id = 1
          and sessions.password_version = config.password_version
        where sessions.token_hash = encode(extensions.digest(p_access_token, 'sha256'), 'hex')
          and (sessions.expires_at is null or sessions.expires_at > now())
      )
    );
$$;
revoke all on function public.portal_schedule_read_allowed(text) from public, anon, authenticated;

-- Keep the credential-bearing RPCs VOLATILE (POST-only in PostgREST); no token in GET URLs.
create or replace function public.read_portal_state(p_access_token text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not coalesce(public.portal_schedule_read_allowed(p_access_token), false) then
    raise exception 'Listeyi görmek için admin veya asistan girişi gerekir.' using errcode = '42501';
  end if;
  select jsonb_build_object('payload', payload, 'updatedAt', updated_at) into result
    from public.portal_state where id = 1;
  return result;
end;
$$;

create or replace function public.read_portal_revision(p_access_token text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not coalesce(public.portal_schedule_read_allowed(p_access_token), false) then
    raise exception 'Listeyi görmek için admin veya asistan girişi gerekir.' using errcode = '42501';
  end if;
  select jsonb_build_object('updatedAt', updated_at) into result from public.portal_state where id = 1;
  return result;
end;
$$;
revoke all on function public.read_portal_state(text), public.read_portal_revision(text) from public, anon, authenticated;
grant execute on function public.read_portal_state(text), public.read_portal_revision(text) to anon, authenticated;

-- Assistants use the guarded RPC. Direct table reads are only for verified portal admins.
revoke select on public.portal_state from public, anon, authenticated;
grant select on public.portal_state to authenticated;
drop policy if exists anon_select_portal_state on public.portal_state;
drop policy if exists portal_state_read_for_app on public.portal_state;
drop policy if exists portal_state_read_for_admins on public.portal_state;
create policy portal_state_read_for_admins on public.portal_state for select to authenticated
  using (exists (select 1 from public.portal_admins where user_id = (select auth.uid())));
-- The restrictive guard also prevents an older/custom permissive read policy from reopening it.
drop policy if exists portal_state_read_guard on public.portal_state;
create policy portal_state_read_guard on public.portal_state as restrictive for select to authenticated
  using (exists (select 1 from public.portal_admins where user_id = (select auth.uid())));

notify pgrst, 'reload schema';
commit;
