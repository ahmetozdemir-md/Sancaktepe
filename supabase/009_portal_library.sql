-- Duyurular ve hızlı referans kütüphanesi. 003_auth_harden_portal_state.sql sonrası.
-- Çalışma listesi verisinden bağımsızdır; mevcut tablo ve politikalara dokunmaz.
begin;

create table if not exists public.portal_library_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 240),
  category text not null default 'Genel' check (char_length(category) between 1 and 50),
  kind text not null check (kind in ('reference', 'announcement')),
  pinned boolean not null default false,
  is_published boolean not null default false,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 20),
  source_label text not null default '',
  source_url text not null default '' check (source_url = '' or source_url ~ '^https?://'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.portal_library_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists portal_library_updated_at on public.portal_library_items;
create trigger portal_library_updated_at before update on public.portal_library_items
for each row execute function public.portal_library_touch_updated_at();

alter table public.portal_library_items enable row level security;
drop policy if exists library_read_published on public.portal_library_items;
create policy library_read_published on public.portal_library_items for select to anon, authenticated
using (is_published = true and archived_at is null);
drop policy if exists library_admin_read on public.portal_library_items;
create policy library_admin_read on public.portal_library_items for select to authenticated
using (exists (select 1 from public.portal_admins where user_id = (select auth.uid())));
drop policy if exists library_admin_insert on public.portal_library_items;
create policy library_admin_insert on public.portal_library_items for insert to authenticated
with check (exists (select 1 from public.portal_admins where user_id = (select auth.uid())));
drop policy if exists library_admin_update on public.portal_library_items;
create policy library_admin_update on public.portal_library_items for update to authenticated
using (exists (select 1 from public.portal_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.portal_admins where user_id = (select auth.uid())));
grant select on public.portal_library_items to anon, authenticated;
grant insert, update on public.portal_library_items to authenticated;
revoke delete on public.portal_library_items from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-library', 'portal-library', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists library_assets_published_read on storage.objects;
create policy library_assets_published_read on storage.objects for select to anon, authenticated
using (
  bucket_id = 'portal-library'
  and exists (
    select 1 from public.portal_library_items item
    where item.is_published and item.archived_at is null
      and item.blocks @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
  )
);
drop policy if exists library_assets_admin_read on storage.objects;
create policy library_assets_admin_read on storage.objects for select to authenticated
using (bucket_id = 'portal-library' and exists (select 1 from public.portal_admins where user_id = (select auth.uid())));
drop policy if exists library_assets_admin_insert on storage.objects;
create policy library_assets_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'portal-library' and exists (select 1 from public.portal_admins where user_id = (select auth.uid())));
drop policy if exists library_assets_admin_delete on storage.objects;
create policy library_assets_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'portal-library' and exists (select 1 from public.portal_admins where user_id = (select auth.uid())));

commit;
