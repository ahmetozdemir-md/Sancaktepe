-- Güvenli üretim modu:
-- 1. Supabase Dashboard > Authentication > Users bölümünden admin kullanıcı oluştur.
-- 2. Aşağıdaki migration'ı SQL Editor'de çalıştır.
-- 3. En alttaki örnek INSERT satırında e-posta adresini kendi admin e-postanla değiştirip çalıştır.
-- 4. Vercel/local env içinde VITE_REQUIRE_SUPABASE_ADMIN_AUTH=true yap.

begin;

create table if not exists public.portal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.portal_admins enable row level security;

drop policy if exists "portal_admins_select_own" on public.portal_admins;
drop policy if exists "portal_admins_no_client_insert" on public.portal_admins;
drop policy if exists "portal_admins_no_client_update" on public.portal_admins;
drop policy if exists "portal_admins_no_client_delete" on public.portal_admins;

create policy "portal_admins_select_own"
on public.portal_admins
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "anon_select_portal_state" on public.portal_state;
drop policy if exists "anon_insert_portal_state" on public.portal_state;
drop policy if exists "anon_update_portal_state" on public.portal_state;
drop policy if exists "portal_state_read_for_app" on public.portal_state;
drop policy if exists "portal_state_insert_for_admins" on public.portal_state;
drop policy if exists "portal_state_update_for_admins" on public.portal_state;

create policy "portal_state_read_for_app"
on public.portal_state
for select
to anon, authenticated
using (true);

create policy "portal_state_insert_for_admins"
on public.portal_state
for insert
to authenticated
with check (
  id = 1
  and exists (
    select 1
    from public.portal_admins admin
    where admin.user_id = auth.uid()
  )
);

create policy "portal_state_update_for_admins"
on public.portal_state
for update
to authenticated
using (
  id = 1
  and exists (
    select 1
    from public.portal_admins admin
    where admin.user_id = auth.uid()
  )
)
with check (
  id = 1
  and exists (
    select 1
    from public.portal_admins admin
    where admin.user_id = auth.uid()
  )
);

drop policy if exists "anon_select_portal_state_history" on public.portal_state_history;
drop policy if exists "anon_insert_portal_state_history" on public.portal_state_history;
drop policy if exists "portal_state_history_select_for_admins" on public.portal_state_history;
drop policy if exists "portal_state_history_insert_for_admins" on public.portal_state_history;

create policy "portal_state_history_select_for_admins"
on public.portal_state_history
for select
to authenticated
using (
  exists (
    select 1
    from public.portal_admins admin
    where admin.user_id = auth.uid()
  )
);

create policy "portal_state_history_insert_for_admins"
on public.portal_state_history
for insert
to authenticated
with check (
  state_id = 1
  and exists (
    select 1
    from public.portal_admins admin
    where admin.user_id = auth.uid()
  )
);

grant select on public.portal_admins to authenticated;
grant select on public.portal_state to anon, authenticated;
grant insert, update on public.portal_state to authenticated;
grant select, insert on public.portal_state_history to authenticated;

commit;

-- Admin kullanıcısını yetkilendirmek için, Supabase Auth kullanıcısını oluşturduktan sonra
-- aşağıdaki satırı kendi admin e-postanla çalıştır:
--
-- insert into public.portal_admins (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict (user_id) do nothing;
