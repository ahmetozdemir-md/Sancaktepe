-- Suggest recovery only for working-room placements removed by a recorded duty publication.
-- Requires 008. Existing four-argument callers keep working and also record provenance.
begin;

create table if not exists public.duty_planner_room_changes (
  id uuid primary key default gen_random_uuid(),
  publication_month text not null check (publication_month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  duty_date date not null,
  date date not null check (date = duty_date + 1),
  name text not null check (length(btrim(name)) > 0),
  location_id text not null,
  site text not null,
  room_before jsonb not null check (jsonb_typeof(room_before) = 'array'),
  day_after jsonb not null check (jsonb_typeof(day_after) = 'object'),
  removed_at timestamptz not null default now(),
  invalidated_at timestamptz,
  restored_at timestamptz
);
create index if not exists duty_planner_room_changes_open_idx
  on public.duty_planner_room_changes(publication_month,date) where invalidated_at is null and restored_at is null;
alter table public.duty_planner_room_changes enable row level security;
revoke all on public.duty_planner_room_changes from public,anon,authenticated;
grant select on public.duty_planner_room_changes to authenticated;
drop policy if exists duty_planner_room_changes_admin_read on public.duty_planner_room_changes;
create policy duty_planner_room_changes_admin_read on public.duty_planner_room_changes for select to authenticated
  using (exists(select 1 from public.portal_admins where user_id=auth.uid()));

-- A later manual edit of the affected day retires recovery suggestions, including an edit
-- that intentionally clears a room. System publication writes are tracked below instead.
create or replace function public.invalidate_duty_room_recovery()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if current_setting('nobet.publication_transaction',true) is distinct from 'on' then
    update public.duty_planner_room_changes r set invalidated_at=clock_timestamp()
      where r.invalidated_at is null and r.restored_at is null
      and (old.payload#>array['plannerState','manualAssignments',to_char(r.date,'YYYY-MM-DD')])
        is distinct from (new.payload#>array['plannerState','manualAssignments',to_char(r.date,'YYYY-MM-DD')]);
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_duty_room_recovery() from public,anon,authenticated;
drop trigger if exists invalidate_duty_room_recovery on public.portal_state;
create trigger invalidate_duty_room_recovery before update of payload on public.portal_state
  for each row execute function public.invalidate_duty_room_recovery();

-- The same conservative checks are repeated by the client for the preview. This private
-- function is the authority when a selected suggestion is actually applied.
create or replace function public.restorable_duty_room_changes(p_payload jsonb,p_month text,p_month_duties jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare
  r record; v_state jsonb:=p_payload->'plannerState'; v_roster jsonb; v_day jsonb; v_location jsonb;
  v_name text; v_names integer; v_draft jsonb; v_key text; v_date_key text; v_active date; v_result jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(v_state) is distinct from 'object' or jsonb_typeof(v_state->'assistants') is distinct from 'array'
    or jsonb_typeof(v_state->'locations') is distinct from 'array' or jsonb_typeof(p_month_duties) is distinct from 'object' then return v_result; end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_roster
    from jsonb_each(coalesce(v_state->'dutyRoster','{}'::jsonb)) where left(key,7)<>p_month;
  v_roster:=v_roster||p_month_duties;
  select state into v_draft from public.duty_planner_state where id=1;
  <<candidate>>
  for r in select * from public.duty_planner_room_changes
      where publication_month=p_month and invalidated_at is null and restored_at is null order by date,name,location_id loop
    if left(to_char(r.duty_date,'YYYY-MM-DD'),7)<>p_month or extract(isodow from r.date)>5 then continue; end if;
    v_key:=public.duty_planner_name_key(r.name);
    select count(*),min(value) into v_names,v_name from jsonb_array_elements_text(v_state->'assistants')
      where public.duty_planner_name_key(value)=v_key;
    if v_names<>1 then continue; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(v_draft->'people','[]'::jsonb)) person
      join lateral jsonb_array_elements(coalesce(v_draft->'absences','[]'::jsonb)) absence on absence.value->>'personId'=person.value->>'id'
      where public.duty_planner_name_key(person.value->>'name')=v_key and absence.value->>'type' in ('annual','excused')
        and absence.value->>'start'<=to_char(r.date,'YYYY-MM-DD') and absence.value->>'end'>=to_char(r.date,'YYYY-MM-DD')) then continue; end if;
    select value into v_location from jsonb_array_elements(v_state->'locations') where value->>'id'=r.location_id;
    if not found or v_location->>'kind' is distinct from 'normal' or v_location->>'site' is distinct from r.site or r.site not in ('Sancaktepe','Feriha Öz','Çekmeköy') then continue; end if;
    begin
      if nullif(v_location->>'activeFrom','') is not null then
        v_active:=(v_location->>'activeFrom')::date;if v_active>r.date then continue candidate; end if;
      end if;
      if nullif(v_location->>'activeUntil','') is not null then
        v_active:=(v_location->>'activeUntil')::date;if v_active<=r.date then continue candidate; end if;
      end if;
    exception when datetime_field_overflow or invalid_datetime_format then continue candidate; end;
    if not exists(select 1 from jsonb_array_elements_text(r.room_before) where public.duty_planner_name_key(value)=v_key) then continue; end if;
    v_day:=v_state#>array['manualAssignments',to_char(r.date,'YYYY-MM-DD')];
    if jsonb_typeof(v_day) is distinct from 'object' or v_day is distinct from r.day_after then continue; end if;
    if exists(select 1 from jsonb_each(v_day) where jsonb_typeof(value)<>'array') then continue; end if;
    if exists(select 1 from jsonb_each(v_day) room cross join lateral jsonb_array_elements(room.value) person
      where jsonb_typeof(person.value)<>'string' or public.duty_planner_name_key(person.value#>>'{}')=v_key) then continue; end if;
    foreach v_date_key in array array[to_char(r.date,'YYYY-MM-DD'),to_char(r.date-1,'YYYY-MM-DD')] loop
      if jsonb_typeof(coalesce(v_roster->v_date_key,'[]'::jsonb)) is distinct from 'array' then continue candidate; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(v_roster->v_date_key,'[]'::jsonb)) where public.duty_planner_name_key(value->>'name')=v_key) then continue candidate; end if;
    end loop;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('id',r.id,'date',to_char(r.date,'YYYY-MM-DD'),'name',v_name,'locationId',r.location_id));
  end loop;
  return v_result;
end;
$$;
revoke all on function public.restorable_duty_room_changes(jsonb,text,jsonb) from public,anon,authenticated;

-- Keep the fully validated original publication as the inner transaction step.
do $$ begin
  if to_regprocedure('public.publish_duty_planner_base(text,bigint,timestamp with time zone,jsonb)') is null then
    alter function public.publish_duty_planner(text,bigint,timestamptz,jsonb) rename to publish_duty_planner_base;
  end if;
end $$;
revoke all on function public.publish_duty_planner_base(text,bigint,timestamptz,jsonb) from public,anon,authenticated;

create or replace function public.publish_duty_planner_v2(
  p_month text,p_draft_revision bigint,p_portal_revision timestamptz,p_month_duties jsonb,p_restore_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_before jsonb; v_payload jsonb; v_result jsonb; v_revision timestamptz; v_draft_revision bigint;
  v_eligible jsonb; v_restores jsonb:='[]'::jsonb; v_restore jsonb; v_room record; v_day record; v_person jsonb; v_location jsonb;
  v_manual jsonb; v_before_day jsonb; v_after_day jsonb; v_names jsonb; v_date text; v_now timestamptz; v_previous_flag text;
begin
  if auth.uid() is null or not exists(select 1 from public.portal_admins where user_id=auth.uid()) then
    raise exception 'Nöbet yayınlamak için yetkili admin girişi gerekir.' using errcode='42501';
  end if;
  if p_restore_ids is null or cardinality(p_restore_ids)>1000 or array_position(p_restore_ids,null) is not null
    or cardinality(p_restore_ids)<>(select count(distinct value) from unnest(p_restore_ids) value) then
    raise exception 'Geri konulacak çalışma atamaları geçerli değil.' using errcode='22023';
  end if;
  -- Never reverse the established draft -> portal lock order.
  select revision into v_draft_revision from public.duty_planner_state where id=1 for update;
  if not found or v_draft_revision is distinct from p_draft_revision then raise exception 'Nöbet taslağı değişti. Yeniden yükleyin.' using errcode='40001'; end if;
  select payload,updated_at into v_before,v_revision from public.portal_state where id=1 for update;
  if not found or v_revision is distinct from p_portal_revision then raise exception 'Asistan listesi değişti. Yeniden önizleyin.' using errcode='40001'; end if;
  if cardinality(p_restore_ids)>0 then
    v_eligible:=public.restorable_duty_room_changes(v_before,p_month,p_month_duties);
    select coalesce(jsonb_agg(value),'[]'::jsonb) into v_restores from jsonb_array_elements(v_eligible)
      where (value->>'id')::uuid=any(p_restore_ids);
    if jsonb_array_length(v_restores)<>cardinality(p_restore_ids) then
      raise exception 'Seçilen eski çalışma ataması artık güvenli biçimde geri konulamıyor. Önizlemeyi yenileyin.' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(v_restores) group by value->>'date',public.duty_planner_name_key(value->>'name') having count(*)>1) then
      raise exception 'Bir asistan aynı gün yalnız bir çalışma yerine geri konulabilir.' using errcode='22023';
    end if;
  end if;
  v_previous_flag:=current_setting('nobet.publication_transaction',true);
  perform set_config('nobet.publication_transaction','on',true);
  v_result:=public.publish_duty_planner_base(p_month,p_draft_revision,p_portal_revision,p_month_duties);
  v_payload:=v_result->'payload';v_now:=(v_result->>'publishedAt')::timestamptz;
  v_manual:=v_payload#>'{plannerState,manualAssignments}';
  for v_restore in select value from jsonb_array_elements(v_restores) loop
    v_date:=v_restore->>'date';v_after_day:=coalesce(v_manual->v_date,'{}'::jsonb);
    v_names:=coalesce(v_after_day->(v_restore->>'locationId'),'[]'::jsonb)||jsonb_build_array(v_restore->>'name');
    v_after_day:=jsonb_set(v_after_day,array[v_restore->>'locationId'],v_names,true);
    v_manual:=jsonb_set(v_manual,array[v_date],v_after_day,true);
    update public.duty_planner_room_changes set restored_at=v_now where id=(v_restore->>'id')::uuid;
    update public.duty_planner_room_changes set invalidated_at=v_now
      where id<>(v_restore->>'id')::uuid and date=v_date::date and public.duty_planner_name_key(name)=public.duty_planner_name_key(v_restore->>'name')
        and invalidated_at is null and restored_at is null;
  end loop;
  v_payload:=jsonb_set(v_payload,'{plannerState,manualAssignments}',v_manual,true);
  if jsonb_array_length(v_restores)>0 then update public.portal_state set payload=v_payload where id=1; end if;
  -- Follow additional automatic removals/restores without treating them as manual edits.
  update public.duty_planner_room_changes r set day_after=coalesce(v_manual->to_char(r.date,'YYYY-MM-DD'),'{}'::jsonb)
    where r.invalidated_at is null and r.restored_at is null
      and r.day_after is not distinct from (v_before#>array['plannerState','manualAssignments',to_char(r.date,'YYYY-MM-DD')]);
  -- Record only actual normal-room names removed by this month's new duty list.
  for v_day in select key,value from jsonb_each(p_month_duties) where jsonb_array_length(value)>0 loop
    v_date:=to_char(v_day.key::date+1,'YYYY-MM-DD');
    v_before_day:=coalesce(v_before#>array['plannerState','manualAssignments',v_date],'{}'::jsonb);
    v_after_day:=coalesce(v_manual->v_date,'{}'::jsonb);
    for v_room in select key,value from jsonb_each(v_before_day) loop
      select value into v_location from jsonb_array_elements(v_before#>'{plannerState,locations}') where value->>'id'=v_room.key and value->>'kind'='normal';
      if not found then continue; end if;
      for v_person in select value from jsonb_array_elements(v_room.value) loop
        if not exists(select 1 from jsonb_array_elements(v_day.value) where public.duty_planner_name_key(value->>'name')=public.duty_planner_name_key(v_person#>>'{}')) then continue; end if;
        if exists(select 1 from jsonb_array_elements(coalesce(v_after_day->v_room.key,'[]'::jsonb)) where public.duty_planner_name_key(value#>>'{}')=public.duty_planner_name_key(v_person#>>'{}')) then continue; end if;
        update public.duty_planner_room_changes set invalidated_at=v_now
          where date=v_date::date and public.duty_planner_name_key(name)=public.duty_planner_name_key(v_person#>>'{}')
            and invalidated_at is null and restored_at is null and removed_at<v_now;
        insert into public.duty_planner_room_changes(publication_month,duty_date,date,name,location_id,site,room_before,day_after,removed_at)
          values(p_month,v_day.key::date,v_date::date,v_person#>>'{}',v_room.key,coalesce(v_location->>'site',''),v_room.value,v_after_day,v_now);
      end loop;
    end loop;
  end loop;
  perform set_config('nobet.publication_transaction',coalesce(v_previous_flag,''),true);
  return v_result||jsonb_build_object('payload',v_payload,'restoredRoomAssignments',jsonb_array_length(v_restores));
end;
$$;
revoke all on function public.publish_duty_planner_v2(text,bigint,timestamptz,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.publish_duty_planner_v2(text,bigint,timestamptz,jsonb,uuid[]) to authenticated;

create or replace function public.publish_duty_planner(p_month text,p_draft_revision bigint,p_portal_revision timestamptz,p_month_duties jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select public.publish_duty_planner_v2(p_month,p_draft_revision,p_portal_revision,p_month_duties,'{}'::uuid[]);
$$;
revoke all on function public.publish_duty_planner(text,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.publish_duty_planner(text,bigint,timestamptz,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
