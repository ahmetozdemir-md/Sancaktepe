create table if not exists public.portal_state_history (
  id bigint generated always as identity primary key,
  state_id integer not null default 1 check (state_id = 1),
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  source text not null default 'auto-save'
);

create index if not exists portal_state_history_saved_at_idx
on public.portal_state_history (saved_at desc);

alter table public.portal_state_history enable row level security;

drop policy if exists "anon_select_portal_state_history" on public.portal_state_history;
drop policy if exists "anon_insert_portal_state_history" on public.portal_state_history;

create policy "anon_select_portal_state_history"
on public.portal_state_history
for select
to anon
using (true);

create policy "anon_insert_portal_state_history"
on public.portal_state_history
for insert
to anon
with check (state_id = 1);
