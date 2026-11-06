-- Execute as one transaction. All fixture and publication changes are rolled back.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
create temporary table recovery_test_results(label text not null) on commit drop;
create function pg_temp.recovery_assert(ok boolean,label text) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if ok is distinct from true then raise exception 'TEST FAILED: %',label; end if;
 insert into pg_temp.recovery_test_results values(label);
end;
$$;
do $tests$
declare
 admin_id uuid; stamp timestamptz:='2026-11-06T00:00:00Z'; result jsonb; room_id uuid; before_history bigint; payload jsonb; eligible jsonb;
 draft jsonb:='{"schemaVersion":1,"updatedAt":"2026-11-06T00:00:00Z","people":[{"id":"a","name":"Asistan A","groupId":"g","from":"2026-01-01","until":null},{"id":"b","name":"Asistan B","groupId":"g","from":"2026-01-01","until":null}],"groups":[{"id":"g","order":1,"from":"2026-01","until":null}],"assignments":[{"id":"d","personId":"a","date":"2026-11-02","site":"Sancaktepe"}],"targets":[],"requests":[],"absences":[],"rotations":[],"holidays":[],"months":{"2026-11":{"completedAt":null}}}'::jsonb;
 duties jsonb:='{"2026-11-02":[{"name":"Asistan A","site":"Sancaktepe"}]}'::jsonb;
 original jsonb:='{"userBindings":{"keep":"value"},"plannerState":{"assistants":["Asistan A","Asistan B"],"assistantRanks":{"Asistan A":1,"Asistan B":2},"locations":[{"id":"r","kind":"normal","site":"Sancaktepe","name":"Oda"},{"id":"other","kind":"normal","site":"Feriha Öz","name":"Diğer"},{"id":"leave","kind":"leave","site":"Diğer","name":"İzin"}],"manualAssignments":{"2026-11-03":{"r":["Asistan A","Asistan B"],"leave":[]},"2026-12-01":{"r":["Asistan A"]},"2026-10-20":{"r":["Asistan B"]}},"dutyRoster":{"2026-10-01":[{"name":"Asistan B","site":"Çekmeköy"}],"2026-12-04":[{"name":"Asistan B","site":"Çekmeköy"}]},"specialistDutyRoster":{"2026-11-02":[{"name":"Uzman","site":"Sancaktepe"}]},"sentinel":"keep"}}'::jsonb;
begin
 select user_id into admin_id from public.portal_admins order by user_id limit 1;
 if admin_id is null then raise exception 'An existing admin is required'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.publish_duty_planner_v2('2026-11',1,stamp,duties,'{}');raise exception 'Expected anonymous denial';exception when insufficient_privilege then null;end;
 perform pg_temp.recovery_assert(true,'v2 RPC requires admin');
 execute 'set local role anon';
 begin perform count(*) from public.duty_planner_room_changes;raise exception 'Expected journal read denial';exception when insufficient_privilege then null;end;
 execute 'reset role';
 perform pg_temp.recovery_assert(true,'anonymous journal reads denied');
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 execute 'set local role authenticated';
 perform pg_temp.recovery_assert((select count(*)=0 from public.duty_planner_room_changes),'nonadmin journal RLS denied');
 begin perform public.publish_duty_planner_base('2026-11',1,stamp,duties);raise exception 'Expected base denial';exception when insufficient_privilege then null;end;
 execute 'reset role';
 perform pg_temp.recovery_assert(true,'inner publication is not directly callable');
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 delete from public.duty_planner_room_changes;
 update public.duty_planner_state set state=draft,revision=1 where id=1;
 update public.portal_state set payload=original,updated_at=stamp where id=1;
 select count(*) into before_history from public.portal_state_history;
 result:=public.publish_duty_planner('2026-11',1,stamp,duties);
 select id into room_id from public.duty_planner_room_changes;
 perform pg_temp.recovery_assert((select count(*)=1 from public.duty_planner_room_changes),'legacy publication records exact removals');
 perform pg_temp.recovery_assert(result#>'{payload,plannerState,manualAssignments,2026-11-03,r}'='["Asistan B"]'::jsonb,'normal room still removed');
 perform pg_temp.recovery_assert((select room_before='["Asistan A","Asistan B"]'::jsonb and day_after=result#>'{payload,plannerState,manualAssignments,2026-11-03}' and invalidated_at is null from public.duty_planner_room_changes where id=room_id),'provenance stores before and untouched final day');
 perform pg_temp.recovery_assert((select count(*)=before_history+1 from public.portal_state_history),'publication still creates portal backup');
 eligible:=public.restorable_duty_room_changes(result->'payload','2026-11','{}');
 perform pg_temp.recovery_assert(jsonb_array_length(eligible)=1,'cancelled duty has one safe suggestion');
 update public.duty_planner_state set state=jsonb_set(draft,'{assignments}','[]'),revision=2 where id=1;
 result:=public.publish_duty_planner_v2('2026-11',2,(result->>'portalRevision')::timestamptz,'{}','{}');
 perform pg_temp.recovery_assert(result->>'restoredRoomAssignments'='0' and result#>'{payload,plannerState,manualAssignments,2026-11-03,r}'='["Asistan B"]'::jsonb,'unchecked recovery never restores');
 begin perform public.publish_duty_planner_v2('2026-11',1,(result->>'portalRevision')::timestamptz,'{}',array[room_id]);raise exception 'Expected stale draft';exception when serialization_failure then null;end;
 perform pg_temp.recovery_assert(true,'recovery retains draft CAS');
 begin perform public.publish_duty_planner_v2('2026-11',2,stamp,'{}',array[room_id]);raise exception 'Expected stale portal';exception when serialization_failure then null;end;
 perform pg_temp.recovery_assert(true,'recovery retains portal CAS');
 begin perform public.publish_duty_planner_v2('2026-11',2,(result->>'portalRevision')::timestamptz,'{}',array[room_id,room_id]);raise exception 'Expected duplicate selection denial';exception when invalid_parameter_value then null;end;
 perform pg_temp.recovery_assert(true,'duplicate restoration IDs rejected');
 begin perform public.publish_duty_planner_v2('2026-11',2,(result->>'portalRevision')::timestamptz,'{}',array[gen_random_uuid()]);raise exception 'Expected forged selection denial';exception when invalid_parameter_value then null;end;
 perform pg_temp.recovery_assert(true,'unknown restoration ID rejected');
 result:=public.publish_duty_planner_v2('2026-11',2,(result->>'portalRevision')::timestamptz,'{}',array[room_id]);
 perform pg_temp.recovery_assert(result->>'restoredRoomAssignments'='1' and result#>'{payload,plannerState,manualAssignments,2026-11-03,r}'='["Asistan B","Asistan A"]'::jsonb,'selected suggestion restores one exact room');
 perform pg_temp.recovery_assert((select restored_at is not null from public.duty_planner_room_changes where id=room_id),'restoration consumed journal row');
 perform pg_temp.recovery_assert((select p.payload=result->'payload' and p.updated_at=(result->>'portalRevision')::timestamptz from public.portal_state p),'authoritative payload and revision include restoration');
 perform pg_temp.recovery_assert(result#>'{payload,plannerState,dutyRoster,2026-10-01}'=original#>'{plannerState,dutyRoster,2026-10-01}' and result#>'{payload,plannerState,dutyRoster,2026-12-04}'=original#>'{plannerState,dutyRoster,2026-12-04}' and result#>'{payload,plannerState,specialistDutyRoster}'=original#>'{plannerState,specialistDutyRoster}' and result#>'{payload,userBindings}'=original->'userBindings','other months specialists and bindings preserved');
 begin perform public.publish_duty_planner_v2('2026-11',2,(result->>'portalRevision')::timestamptz,'{}',array[room_id]);raise exception 'Expected consumed selection denial';exception when invalid_parameter_value then null;end;
 perform pg_temp.recovery_assert(true,'one suggestion cannot restore twice');

 -- Record another removal, then edit a different room on that same day.
 delete from public.duty_planner_room_changes;
 update public.duty_planner_state set state=draft,revision=10 where id=1;
 update public.portal_state set payload=original,updated_at=stamp where id=1;
 result:=public.publish_duty_planner('2026-11',10,stamp,duties);
 select id into room_id from public.duty_planner_room_changes;
 update public.portal_state p set payload=jsonb_set(p.payload,'{plannerState,manualAssignments,2026-11-03,other}','["Asistan B"]') where id=1;
 perform pg_temp.recovery_assert((select invalidated_at is not null from public.duty_planner_room_changes where id=room_id),'later manual day edit retires suggestion');
 select p.payload into payload from public.portal_state p where id=1;
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(payload,'2026-11','{}')='[]'::jsonb,'manual edits cannot be overwritten by recovery');

 -- Fresh provenance for rejection checks that do not mutate the source payload.
 delete from public.duty_planner_room_changes;
 update public.portal_state set payload=original,updated_at=stamp where id=1;
 update public.duty_planner_state set state=draft,revision=20 where id=1;
 result:=public.publish_duty_planner('2026-11',20,stamp,duties);
 payload:=result->'payload';
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(payload,'2026-11',duties)='[]'::jsonb,'remaining previous-day duty blocks restore');
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(payload,'2026-11','{"2026-11-03":[{"name":"Asistan A","site":"Feriha Öz"}]}')='[]'::jsonb,'same-day duty at another hospital blocks restore');
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(jsonb_set(payload,'{plannerState,locations,0,activeUntil}','"2026-11-03"'),'2026-11','{}')='[]'::jsonb,'exclusive room closure blocks restore');
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(jsonb_set(payload,'{plannerState,locations,0,activeFrom}','"2026-11-04"'),'2026-11','{}')='[]'::jsonb,'future room opening blocks restore');
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(jsonb_set(payload,'{plannerState,locations,0,site}','"Feriha Öz"'),'2026-11','{}')='[]'::jsonb,'room hospital move blocks restore');
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(payload,'2026-12','{}')='[]'::jsonb,'journal is scoped to original duty month');
 update public.duty_planner_state set state=jsonb_set(state,'{absences}','[{"personId":"a","type":"annual","start":"2026-11-03","end":"2026-11-03"}]') where id=1;
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(payload,'2026-11','{}')='[]'::jsonb,'known planner annual leave blocks restoration');
 update public.duty_planner_state set state=draft where id=1;
 update public.duty_planner_room_changes set day_after=jsonb_set(day_after,'{leave}','["Asistan A"]') where invalidated_at is null and restored_at is null;
 payload:=jsonb_set(payload,'{plannerState,manualAssignments,2026-11-03,leave}','["Asistan A"]');
 perform pg_temp.recovery_assert(public.restorable_duty_room_changes(payload,'2026-11','{}')='[]'::jsonb,'leave placement blocks even a matching recorded day');
end;
$tests$;
select count(*) as assertions_passed,jsonb_agg(label) as passed_cases from pg_temp.recovery_test_results;
rollback;
select true as synthetic_changes_rolled_back;
