-- Asistan giriş kayıtları.
-- Bu tablo portal_state veya ana planlama verisini değiştirmez.

begin;

create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  person_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists login_events_created_at_idx
on public.login_events (created_at desc);

create index if not exists login_events_person_created_at_idx
on public.login_events (person_name, created_at desc);

alter table public.login_events enable row level security;

drop policy if exists "login_events_insert_for_app" on public.login_events;
drop policy if exists "login_events_select_for_admins" on public.login_events;

create policy "login_events_insert_for_app"
on public.login_events
for insert
to anon, authenticated
with check (
  length(trim(person_name)) > 0
  and length(person_name) <= 160
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

grant insert on public.login_events to anon, authenticated;
grant select on public.login_events to authenticated;

commit;
