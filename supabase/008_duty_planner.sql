-- Private online duty drafts. Only the published monthly roster enters portal_state.
-- Requires migrations 002 and 003. All changes below are transactional and repeatable.
begin;

create table if not exists public.duty_planner_state (
  id integer primary key default 1 check (id = 1),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  last_published_month text,
  last_published_at timestamptz,
  last_published_revision bigint
);

create table if not exists public.duty_planner_history (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rolling', 'daily', 'day-start', 'completed')),
  revision bigint not null check (revision >= 1),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  saved_at timestamptz not null default now(),
  month text,
  snapshot_day date
);
create index if not exists duty_planner_history_saved_idx on public.duty_planner_history(saved_at desc);
create unique index if not exists duty_planner_history_day_idx
  on public.duty_planner_history(kind, snapshot_day) where kind in ('daily', 'day-start');
create unique index if not exists duty_planner_history_revision_idx
  on public.duty_planner_history(revision) where kind = 'rolling';

alter table public.duty_planner_state enable row level security;
alter table public.duty_planner_history enable row level security;
revoke all on public.duty_planner_state, public.duty_planner_history from public, anon, authenticated;
grant select on public.duty_planner_state, public.duty_planner_history to authenticated;
drop policy if exists duty_planner_admin_read on public.duty_planner_state;
create policy duty_planner_admin_read on public.duty_planner_state for select to authenticated
  using (exists (select 1 from public.portal_admins where user_id = auth.uid()));
drop policy if exists duty_planner_history_admin_read on public.duty_planner_history;
create policy duty_planner_history_admin_read on public.duty_planner_history for select to authenticated
  using (exists (select 1 from public.portal_admins where user_id = auth.uid()));

-- Match the client: NFC, normalized whitespace and Turkish case; accents remain distinct.
create or replace function public.duty_planner_name_key(p_name text)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select lower(translate(normalize(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), NFC), 'Iİ', 'ıi'));
$$;
revoke all on function public.duty_planner_name_key(text) from public, anon, authenticated;

create or replace function public.save_duty_planner(p_state jsonb, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_old public.duty_planner_state%rowtype;
  v_exists boolean;
  v_next bigint;
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'Europe/Istanbul')::date;
  v_key text;
  v_month record;
begin
  if auth.uid() is null or not exists (select 1 from public.portal_admins where user_id = auth.uid()) then
    raise exception 'Nöbet taslağını kaydetmek için yetkili admin girişi gerekir.' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 0 or p_revision >= 9007199254740991 then
    raise exception 'Geçersiz taslak sürümü.' using errcode = '22023';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object'
     or p_state->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(p_state->'months') is distinct from 'object'
     or jsonb_typeof(p_state->'updatedAt') is distinct from 'string'
     or octet_length(p_state::text) > 10485760 then
    raise exception 'Nöbet taslağı doğrulanamadı veya 10 MB sınırını aşıyor.' using errcode = '22023';
  end if;
  foreach v_key in array array['people','groups','targets','assignments','absences','requests','rotations','holidays'] loop
    if jsonb_typeof(p_state->v_key) is distinct from 'array' then
      raise exception 'Nöbet taslağında % listesi eksik veya hatalı.', v_key using errcode = '22023';
    end if;
  end loop;
  -- The advisory lock also serializes two first saves before singleton row 1 exists.
  perform pg_advisory_xact_lock(hashtextextended('public.duty_planner_state', 0));
  select * into v_old from public.duty_planner_state where id = 1 for update;
  v_exists := found;
  if p_revision <> (case when v_exists then v_old.revision else 0 end) then
    raise exception 'Nöbet taslağı başka bir pencerede değişti. Güncel kaydı yeniden yükleyin.' using errcode = '40001';
  end if;
  v_next := p_revision + 1;
  if v_exists then
    insert into public.duty_planner_history(kind,revision,state,saved_at,snapshot_day)
      values ('day-start',v_old.revision,v_old.state,v_now,v_day) on conflict do nothing;
    insert into public.duty_planner_history(kind,revision,state,saved_at)
      values ('rolling',v_old.revision,v_old.state,v_now) on conflict do nothing;
    update public.duty_planner_state set state=p_state, revision=v_next,
      updated_at=greatest(v_now, v_old.updated_at + interval '1 microsecond'), updated_by=auth.uid() where id=1;
  else
    insert into public.duty_planner_state(id,state,revision,updated_at,updated_by)
      values (1,p_state,v_next,v_now,auth.uid());
  end if;
  insert into public.duty_planner_history(kind,revision,state,saved_at,snapshot_day)
    values ('daily',v_next,p_state,v_now,v_day)
    on conflict (kind,snapshot_day) where kind in ('daily','day-start') do update
      set revision=excluded.revision,state=excluded.state,saved_at=excluded.saved_at;
  for v_month in select key,value from jsonb_each(p_state->'months') loop
    if jsonb_typeof(v_month.value->'completedAt') = 'string'
       and v_month.value->'completedAt' is distinct from v_old.state->'months'->v_month.key->'completedAt' then
      insert into public.duty_planner_history(kind,revision,state,saved_at,month)
        values ('completed',v_next,p_state,v_now,v_month.key);
    end if;
  end loop;
  delete from public.duty_planner_history where kind='rolling' and id not in
    (select id from public.duty_planner_history where kind='rolling' order by revision desc limit 10);
  delete from public.duty_planner_history where kind in ('daily','day-start') and snapshot_day < v_day - 29;
  return jsonb_build_object('revision',v_next);
end;
$$;
revoke all on function public.save_duty_planner(jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_duty_planner(jsonb,bigint) to authenticated;

create or replace function public.publish_duty_planner(
  p_month text, p_draft_revision bigint, p_portal_revision timestamptz, p_month_duties jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_draft public.duty_planner_state%rowtype;
  v_payload jsonb;
  v_portal_revision timestamptz;
  v_roster jsonb;
  v_manual jsonb;
  v_first date;
  v_last date;
  v_date date;
  v_day record;
  v_item jsonb;
  v_source jsonb;
  v_person jsonb;
  v_name text;
  v_matches integer;
  v_posted jsonb := '[]'::jsonb;
  v_expected jsonb := '[]'::jsonb;
  v_locations jsonb;
  v_room record;
  v_names jsonb;
  v_next_names jsonb;
  v_removed integer := 0;
  v_now timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from public.portal_admins where user_id = auth.uid()) then
    raise exception 'Nöbet yayınlamak için yetkili admin girişi gerekir.' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
     or p_month_duties is null or jsonb_typeof(p_month_duties) <> 'object'
     or octet_length(p_month_duties::text) > 10485760 then
    raise exception 'Yayınlanacak ay veya nöbet listesi geçersiz.' using errcode = '22023';
  end if;
  v_first := (p_month||'-01')::date;
  v_last := (v_first + interval '1 month - 1 day')::date;
  -- Lock order matches saves; all following backups/changes roll back together on error.
  select * into v_draft from public.duty_planner_state where id=1 for update;
  if not found or p_draft_revision is distinct from v_draft.revision then
    raise exception 'Nöbet taslağı değişti. Güncel kaydı yeniden yükleyin.' using errcode = '40001';
  end if;
  if not (v_draft.state->'months' ? p_month) then
    raise exception 'Seçilen ay nöbet taslağında bulunamadı.' using errcode = '22023';
  end if;
  select payload,updated_at into v_payload,v_portal_revision from public.portal_state where id=1 for update;
  if not found or p_portal_revision is distinct from v_portal_revision then
    raise exception 'Asistan listesi başka bir pencerede değişti. Yeniden yükleyip yayınlayın.' using errcode = '40001';
  end if;
  if jsonb_typeof(v_payload->'plannerState') is distinct from 'object'
     or jsonb_typeof(v_payload->'plannerState'->'assistants') is distinct from 'array' then
    raise exception 'Asistan sisteminin kişi listesi doğrulanamadı.' using errcode = '22023';
  end if;
  -- Validate dates and canonical names before constructing the selected-month projection.
  for v_day in select key,value from jsonb_each(p_month_duties) loop
    if v_day.key !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       or left(v_day.key,7) <> p_month or jsonb_typeof(v_day.value) <> 'array' then
      raise exception 'Yayın listesinde ay dışı veya hatalı gün var: %.', v_day.key using errcode = '22023';
    end if;
    begin v_date := v_day.key::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'Geçersiz takvim günü: %.',v_day.key using errcode = '22023';
    end;
    for v_item in select value from jsonb_array_elements(v_day.value) loop
      if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'name') is distinct from 'string'
         or jsonb_typeof(v_item->'site') is distinct from 'string'
         or v_item->>'site' not in ('Sancaktepe','Feriha Öz','Çekmeköy')
         or not (v_payload->'plannerState'->'assistants' @> jsonb_build_array(v_item->>'name')) then
        raise exception 'Yayın listesinde tanınmayan kişi veya hastane var.' using errcode = '22023';
      end if;
      v_posted := v_posted || jsonb_build_array(jsonb_build_object('date',v_day.key,'name',v_item->>'name','site',v_item->>'site'));
    end loop;
  end loop;
  -- Check the projection against the SAVED draft, not only a client-supplied headcount.
  for v_source in select value from jsonb_array_elements(v_draft.state->'assignments')
      where left(value->>'date',7)=p_month loop
    select value into v_person from jsonb_array_elements(v_draft.state->'people') where value->>'id'=v_source->>'personId';
    if not found then raise exception 'Taslakta kişi kimliği bulunamadı.' using errcode='22023'; end if;
    select count(*),min(value) into v_matches,v_name from jsonb_array_elements_text(v_payload->'plannerState'->'assistants')
      where public.duty_planner_name_key(value)=public.duty_planner_name_key(v_person->>'name');
    if v_matches <> 1 then
      raise exception 'Kişi eşleştirmesi belirsiz veya eksik: %.',v_person->>'name' using errcode='22023';
    end if;
    v_expected := v_expected || jsonb_build_array(jsonb_build_object('date',v_source->>'date','name',v_name,'site',v_source->>'site'));
  end loop;
  if exists (
    (select value from jsonb_array_elements(v_expected) except all select value from jsonb_array_elements(v_posted))
    union all
    (select value from jsonb_array_elements(v_posted) except all select value from jsonb_array_elements(v_expected))
  ) then raise exception 'Yayın listesi kaydedilmiş nöbet taslağıyla aynı değil.' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(v_posted) group by value->>'date',value->>'name' having count(*)>1) then
    raise exception 'Aynı kişi aynı güne iki kez yazılamaz.' using errcode='22023';
  end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_roster
    from jsonb_each(coalesce(v_payload->'plannerState'->'dutyRoster','{}'::jsonb)) where left(key,7)<>p_month;
  v_roster := v_roster || p_month_duties;
  -- Cross-month adjacent duties matter, but unrelated old problems do not block publication.
  if exists (
    with duties as (
      select day.key::date as date,item.value->>'name' as name from jsonb_each(v_roster) day
      cross join lateral jsonb_array_elements(day.value) item
      where day.key between to_char(v_first-1,'YYYY-MM-DD') and to_char(v_last+1,'YYYY-MM-DD')
    ) select 1 from duties a join duties b on a.name=b.name and b.date=a.date+1
      where a.date between v_first and v_last or b.date between v_first and v_last
  ) then raise exception 'Arka arkaya iki gün nöbet kesinlikle yazılamaz.' using errcode='22023'; end if;
  -- Remove only next-day NORMAL room placements. Leave/status/specialist/other fields survive.
  v_manual := coalesce(v_payload->'plannerState'->'manualAssignments','{}'::jsonb);
  v_locations := coalesce(v_payload->'plannerState'->'locations','[]'::jsonb);
  for v_day in select key,value from jsonb_each(p_month_duties) where jsonb_array_length(value)>0 loop
    v_date := v_day.key::date + 1;
    for v_room in select key,value from jsonb_each(coalesce(v_manual->to_char(v_date,'YYYY-MM-DD'),'{}'::jsonb)) loop
      if exists (select 1 from jsonb_array_elements(v_locations) where value->>'id'=v_room.key and value->>'kind'='normal') then
        v_names := v_room.value;
        if jsonb_typeof(v_names) <> 'array' then raise exception 'Gündüz ataması doğrulanamadı.' using errcode='22023'; end if;
        select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into v_next_names
          from jsonb_array_elements(v_names) with ordinality as names(value,ordinal)
          where not exists (select 1 from jsonb_array_elements(v_day.value) duty
            where public.duty_planner_name_key(duty->>'name')=public.duty_planner_name_key(names.value#>>'{}'));
        v_removed := v_removed + jsonb_array_length(v_names)-jsonb_array_length(v_next_names);
        v_manual := jsonb_set(v_manual,array[to_char(v_date,'YYYY-MM-DD'),v_room.key],v_next_names,false);
      end if;
    end loop;
  end loop;
  v_payload := jsonb_set(v_payload,'{plannerState,dutyRoster}',v_roster,true);
  v_payload := jsonb_set(v_payload,'{plannerState,manualAssignments}',v_manual,true);
  v_now := greatest(clock_timestamp(),v_portal_revision + interval '1 microsecond');
  insert into public.portal_state_history(state_id,payload,saved_at,source)
    select 1,payload,v_now,'duty-planner-publish:'||p_month from public.portal_state where id=1;
  update public.portal_state set payload=v_payload,updated_at=v_now where id=1;
  insert into public.duty_planner_history(kind,revision,state,saved_at,month)
    values ('completed',v_draft.revision,v_draft.state,v_now,p_month);
  update public.duty_planner_state set last_published_month=p_month,last_published_at=v_now,
    last_published_revision=v_draft.revision where id=1;
  return jsonb_build_object('publishedAt',v_now,'portalRevision',v_now,'payload',v_payload,'removedRoomAssignments',v_removed);
end;
$$;
revoke all on function public.publish_duty_planner(text,bigint,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.publish_duty_planner(text,bigint,timestamptz,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
