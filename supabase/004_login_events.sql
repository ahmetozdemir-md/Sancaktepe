-- Asistan giriş kayıtları.
-- Bu tablo portal_state veya ana planlama verisini değiştirmez.

begin;

create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  person_name text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);

alter table public.login_events
add column if not exists ip_hash text;

create index if not exists login_events_created_at_idx
on public.login_events (created_at desc);

create index if not exists login_events_person_created_at_idx
on public.login_events (person_name, created_at desc);

create index if not exists login_events_ip_hash_created_at_idx
on public.login_events (ip_hash, created_at desc)
where ip_hash is not null;

alter table public.login_events enable row level security;

drop policy if exists "login_events_insert_for_app" on public.login_events;
drop policy if exists "login_events_delete_old_for_app" on public.login_events;
drop policy if exists "login_events_select_for_admins" on public.login_events;

create policy "login_events_insert_for_app"
on public.login_events
for insert
to anon, authenticated
with check (
  length(trim(person_name)) > 0
  and length(person_name) <= 160
  and (ip_hash is null or length(ip_hash) between 16 and 128)
);

create policy "login_events_select_for_admins"
on public.login_events
for select
to authenticated
using (
  exists (
    select 1
    from public.portal_admins admin
    where admin.user_id = auth.uid()
  )
);

create policy "login_events_delete_old_for_app"
on public.login_events
for delete
to anon, authenticated
using (created_at < now() - interval '14 days');

grant insert on public.login_events to anon, authenticated;
grant delete on public.login_events to anon, authenticated;
grant select on public.login_events to authenticated;

commit;
