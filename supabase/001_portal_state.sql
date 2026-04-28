create table if not exists public.portal_state (
  id integer primary key check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.portal_state enable row level security;

drop policy if exists "anon_select_portal_state" on public.portal_state;
drop policy if exists "anon_insert_portal_state" on public.portal_state;
drop policy if exists "anon_update_portal_state" on public.portal_state;

create policy "anon_select_portal_state"
on public.portal_state
for select
to anon
using (true);

create policy "anon_insert_portal_state"
on public.portal_state
for insert
to anon
with check (id = 1);

create policy "anon_update_portal_state"
on public.portal_state
for update
to anon
using (id = 1)
with check (id = 1);
