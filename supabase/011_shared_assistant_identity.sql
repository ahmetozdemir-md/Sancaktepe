-- Preserve stable staff identities when an older admin window saves a legacy payload.
begin;
create or replace function public.guard_assistant_registry_payload()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare old_registry jsonb; registry jsonb; entry record; period jsonb; previous_month text; seen_names text[] := '{}'; normalized text;
begin
 if tg_op='UPDATE' then old_registry:=old.payload#>'{plannerState,assistantRegistry}'; end if;
 registry:=new.payload#>'{plannerState,assistantRegistry}';
 if registry is null and jsonb_typeof(old_registry)='object' then
  new.payload:=jsonb_set(new.payload,'{plannerState,assistantRegistry}',old_registry,true);
  registry:=old_registry;
 end if;
 if registry is null then return new; end if;
 if jsonb_typeof(registry)<>'object' then raise exception 'Ortak kişi kayıtları doğrulanamadı.' using errcode='22023'; end if;
 for entry in select key,value from jsonb_each(registry) loop
  if length(entry.key)=0 or length(entry.key)>200 or jsonb_typeof(entry.value)<>'object'
   or jsonb_typeof(entry.value->'name') is distinct from 'string' or btrim(entry.value->>'name')=''
   or jsonb_typeof(entry.value->'dutyEnabled') is distinct from 'boolean'
   or (entry.value ? 'archived' and jsonb_typeof(entry.value->'archived')<>'boolean')
   or (entry.value ? 'plannerPersonId' and jsonb_typeof(entry.value->'plannerPersonId')<>'string') then
   raise exception 'Ortak kişi kaydı geçersiz: %.',entry.key using errcode='22023';
  end if;
  if coalesce((entry.value->>'archived')::boolean,false)=false then
   normalized:=lower(translate(normalize(btrim(regexp_replace(entry.value->>'name','\s+',' ','g')),NFC),'Iİ','ıi'));
   if normalized=any(seen_names) then raise exception 'Ortak kişi listesinde aynı ad iki kez kullanılamaz.' using errcode='22023'; end if;
   seen_names:=array_append(seen_names,normalized);
  end if;
  if entry.value ? 'dutyHistory' then
   if jsonb_typeof(entry.value->'dutyHistory')<>'array' then raise exception 'Nöbete dahil olma geçmişi doğrulanamadı.' using errcode='22023'; end if;
   previous_month:=null;
   for period in select value from jsonb_array_elements(entry.value->'dutyHistory') loop
    if jsonb_typeof(period)<>'object' or coalesce(period->>'from','')!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
     or jsonb_typeof(period->'enabled') is distinct from 'boolean'
     or (previous_month is not null and period->>'from'<=previous_month) then
     raise exception 'Nöbete dahil olma ayları sıralı ve tekil olmalı.' using errcode='22023';
    end if;
    previous_month:=period->>'from';
   end loop;
  end if;
 end loop;
 return new;
end;
$$;
revoke all on function public.guard_assistant_registry_payload() from public,anon,authenticated;
drop trigger if exists guard_assistant_registry_payload on public.portal_state;
create trigger guard_assistant_registry_payload before insert or update of payload on public.portal_state
 for each row execute function public.guard_assistant_registry_payload();
commit;
