-- Real RPC integration tests with synthetic fixtures. Everything ends in ROLLBACK.
-- Never execute a subset that omits the final rollback; production fixtures are temporary.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';
create temporary table duty_db_test_results(label text not null) on commit drop;
create function pg_temp.assert_that(p_condition boolean, p_label text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_condition is distinct from true then raise exception 'TEST FAILED: %',p_label; end if;
  insert into pg_temp.duty_db_test_results values(p_label);
end;
$$;

do $tests$
declare
  v_admin uuid;
  v_result jsonb;
  v_draft jsonb := '{"schemaVersion":1,"updatedAt":"2026-11-06T00:00:00Z",
    "people":[{"id":"p1","name":"  İSMAİL  ","groupId":"g","from":"2026-01-01","until":null},
      {"id":"p2","name":"Çağla","groupId":"g","from":"2026-01-01","until":null},
      {"id":"p3","name":"Bora","groupId":"g","from":"2026-01-01","until":null}],
    "groups":[{"id":"g","order":1,"from":"2026-01","until":null}],
    "targets":[],"assignments":[
      {"id":"a1","personId":"p1","date":"2026-11-05","site":"Sancaktepe"},
      {"id":"a2","personId":"p2","date":"2026-11-30","site":"Feriha Öz"},
      {"id":"outside","personId":"p3","date":"2026-10-30","site":"Çekmeköy"}],
    "absences":[],"requests":[],"rotations":[],"holidays":[],"months":{"2026-11":{"completedAt":null}}}'::jsonb;
  v_duties jsonb := '{"2026-11-05":[{"name":"İsmail","site":"Sancaktepe"}],
    "2026-11-30":[{"name":"Çağla","site":"Feriha Öz"}]}'::jsonb;
  v_portal jsonb := '{"userBindings":{"synthetic":"keep"},"unknownRoot":{"keep":true},"plannerState":{
    "assistants":["İsmail","Çağla","Bora"],"assistantRanks":{"İsmail":1,"Çağla":2,"Bora":3},
    "locations":[{"id":"room","kind":"normal"},{"id":"other-room","kind":"normal"},
      {"id":"leave","kind":"leave"},{"id":"status","kind":"postDuty"}],
    "manualAssignments":{"2026-11-06":{"room":[" İSMAİL ","Bora"],"leave":["İsmail"],"status":["İsmail"],"other-room":["Çağla"]},
      "2026-12-01":{"room":["Çağla","Bora"],"leave":["Çağla"]},"2026-11-16":{"room":["Bora"]},"2026-10-20":{"room":["Çağla"]}},
    "dutyRoster":{"2026-10-10":[{"name":"İsmail","site":"Feriha Öz"}],"2026-10-11":[{"name":"İsmail","site":"Feriha Öz"}],
      "2026-10-31":[{"name":"Bora","site":"Çekmeköy"}],"2026-11-01":[{"name":"Bora","site":"Çekmeköy"}],
      "2026-11-15":[{"name":"Bora","site":"Feriha Öz"}],"2026-12-01":[{"name":"Bora","site":"Sancaktepe"}],
      "2026-12-05":[{"name":"İsmail","site":"Çekmeköy"}]},
    "specialistDutyRoster":{"2026-11-05":[{"name":"Synthetic Specialist","site":"Sancaktepe"}]},
    "specialistWorkAssignments":{"2026-11-06":{"room":["Synthetic Specialist"]}},
    "rotatorAssignments":{"2026-11-06":{"room":["Synthetic Rotator"]}},"sentinel":"unchanged"}}'::jsonb;
  v_changed jsonb;
  v_saved jsonb;
  v_portal_stamp timestamptz := '2026-11-06T00:00:00Z';
  v_day date := (clock_timestamp() at time zone 'Europe/Istanbul')::date;
  v_count bigint;
  v_portal_history bigint;
  i integer;
begin
  select user_id into v_admin from public.portal_admins order by user_id limit 1;
  if v_admin is null then raise exception 'Test requires an existing authorized portal admin.'; end if;

  -- The same JWT claim functions used by real Supabase RPCs; no tokens/passwords are read.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.save_duty_planner(v_draft,1);
    raise exception 'Expected unauthorized save to fail';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_that(true,'save rejects missing authenticated admin');
  begin
    perform public.publish_duty_planner('2026-11',1,v_portal_stamp,v_duties);
    raise exception 'Expected unauthorized publish to fail';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_that(true,'publish rejects missing authenticated admin');

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_that((select count(*)=0 from public.duty_planner_state),'non-admin cannot read private draft through RLS');
  perform pg_temp.assert_that((select count(*)=0 from public.duty_planner_history),'non-admin cannot read private history through RLS');
  begin
    perform public.save_duty_planner(v_draft,1);
    raise exception 'Expected non-admin save to fail';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_that(true,'non-admin authenticated user cannot save');
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform count(*) from public.duty_planner_state;
    raise exception 'Expected anonymous draft SELECT to fail';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_that(true,'anonymous role has no private draft SELECT grant');
  begin
    perform public.publish_duty_planner('2026-11',1,v_portal_stamp,v_duties);
    raise exception 'Expected anonymous RPC EXECUTE to fail';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_that(true,'anonymous role has no publish EXECUTE grant');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_that((select count(*)=1 from public.duty_planner_state),'authorized admin can read draft');
  begin
    update public.duty_planner_state set state=state where id=1;
    raise exception 'Expected direct draft UPDATE to fail';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_that(true,'even admin writes must use guarded RPC');
  execute 'reset role';

  -- Synthetic replacement is visible only in this transaction and restored by rollback.
  delete from public.duty_planner_state;
  delete from public.duty_planner_history;
  execute 'set local role authenticated';
  v_result := public.save_duty_planner(v_draft,0);
  perform pg_temp.assert_that(v_result->>'revision'='1','first save inserts singleton at revision1');
  execute 'reset role';
  update public.duty_planner_state set revision=100,state=v_draft where id=1;
  delete from public.duty_planner_history;
  for i in 1..14 loop
    insert into public.duty_planner_history(kind,revision,state) values('rolling',i,v_draft);
  end loop;
  insert into public.duty_planner_history(kind,revision,state,snapshot_day) values
    ('daily',80,v_draft,v_day-30),('day-start',80,v_draft,v_day-30),
    ('daily',81,v_draft,v_day-29),('day-start',81,v_draft,v_day-29);
  insert into public.duty_planner_history(kind,revision,state,month,snapshot_day)
    values('completed',70,v_draft,'2020-01',v_day-100);
  execute 'set local role authenticated';
  v_result := public.save_duty_planner(v_draft,100);
  perform pg_temp.assert_that(v_result->>'revision'='101','save increments expected revision');
  begin
    perform public.save_duty_planner(v_draft,100);
    raise exception 'Expected stale save to fail';
  exception when serialization_failure then null; end;
  perform pg_temp.assert_that((select revision=101 from public.duty_planner_state),'stale save leaves revision unchanged');
  v_result := public.save_duty_planner(v_draft,101);
  perform pg_temp.assert_that((select count(*)=10 from public.duty_planner_history where kind='rolling'),'only10 rolling snapshots retained');
  perform pg_temp.assert_that((select count(*)=0 from public.duty_planner_history where kind in ('daily','day-start') and snapshot_day<v_day-29),'expired daily and day-start snapshots pruned');
  perform pg_temp.assert_that((select count(*)=2 from public.duty_planner_history where snapshot_day=v_day-29),'30day retention boundary preserved');
  perform pg_temp.assert_that((select count(*)=1 from public.duty_planner_history where kind='day-start' and snapshot_day=v_day and revision=100),'first state of day preserved across multiple saves');
  perform pg_temp.assert_that((select count(*)=1 from public.duty_planner_history where kind='daily' and snapshot_day=v_day and revision=102),'daily snapshot advances to latest save');
  perform pg_temp.assert_that((select count(*)=1 from public.duty_planner_history where kind='completed' and month='2020-01'),'old completed snapshots retained');
  begin
    perform public.save_duty_planner('{"schemaVersion":1}'::jsonb,102);
    raise exception 'Expected malformed state save to fail';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_that((select revision=102 from public.duty_planner_state),'invalid shape cannot alter saved draft');
  execute 'reset role';

  update public.portal_state set payload=v_portal,updated_at=v_portal_stamp where id=1;
  select count(*) into v_portal_history from public.portal_state_history;
  execute 'set local role authenticated';
  begin
    perform public.publish_duty_planner('2026-11',101,v_portal_stamp,v_duties);
    raise exception 'Expected stale draft publication to fail';
  exception when serialization_failure then null; end;
  perform pg_temp.assert_that(true,'publication rejects stale draft revision');
  begin
    perform public.publish_duty_planner('2026-11',102,v_portal_stamp-interval '1 microsecond',v_duties);
    raise exception 'Expected stale portal publication to fail';
  exception when serialization_failure then null; end;
  perform pg_temp.assert_that(true,'publication rejects stale portal revision');
  begin
    perform public.publish_duty_planner('2026-11',102,v_portal_stamp,v_duties||'{"2026-11-12":[{"name":"Bora","site":"Sancaktepe"}]}'::jsonb);
    raise exception 'Expected projection mismatch to fail';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_that(true,'client cannot publish assignments absent from saved draft');
  begin
    perform public.publish_duty_planner('2026-11',102,v_portal_stamp,v_duties||'{"2026-11-31":[]}'::jsonb);
    raise exception 'Expected invalid calendar date to fail';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_that(true,'publication rejects nonexistent calendar day');
  perform pg_temp.assert_that((select payload=v_portal and updated_at=v_portal_stamp from public.portal_state),'rejected publications preserve portal state');
  execute 'reset role';

  v_changed := jsonb_set(v_draft,'{assignments}',v_draft->'assignments'||
    '[{"id":"dup","personId":"p1","date":"2026-11-05","site":"Feriha Öz"}]'::jsonb);
  update public.duty_planner_state set state=v_changed where id=1;
  execute 'set local role authenticated';
  begin
    perform public.publish_duty_planner('2026-11',102,v_portal_stamp,jsonb_set(v_duties,'{2026-11-05}',
      '[{"name":"İsmail","site":"Sancaktepe"},{"name":"İsmail","site":"Feriha Öz"}]'::jsonb));
    raise exception 'Expected duplicate person/day publication to fail';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_that(true,'publication rejects duplicate person/day even when draft matches');
  execute 'reset role';
  v_changed := jsonb_set(v_draft,'{assignments}',v_draft->'assignments'||
    '[{"id":"adjacent","personId":"p3","date":"2026-11-01","site":"Feriha Öz"}]'::jsonb);
  update public.duty_planner_state set state=v_changed where id=1;
  execute 'set local role authenticated';
  begin
    perform public.publish_duty_planner('2026-11',102,v_portal_stamp,v_duties||'{"2026-11-01":[{"name":"Bora","site":"Feriha Öz"}]}'::jsonb);
    raise exception 'Expected previous-month consecutive publication to fail';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_that(true,'publication blocks consecutive duty across previous-month boundary');
  execute 'reset role';
  update public.duty_planner_state set state=v_draft where id=1;
  update public.portal_state set payload=jsonb_set(v_portal,'{plannerState,dutyRoster,2026-12-01}',
    '[{"name":"Çağla","site":"Sancaktepe"}]'::jsonb) where id=1;
  execute 'set local role authenticated';
  begin
    perform public.publish_duty_planner('2026-11',102,v_portal_stamp,v_duties);
    raise exception 'Expected following-month consecutive publication to fail';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_that(true,'publication blocks consecutive duty across next-month boundary');
  execute 'reset role';
  update public.portal_state set payload=v_portal where id=1;
  execute 'set local role authenticated';
  v_result := public.publish_duty_planner('2026-11',102,v_portal_stamp,v_duties);
  v_saved := v_result->'payload';
  perform pg_temp.assert_that((select payload=v_saved from public.portal_state),'publish returns authoritative saved portal payload');
  perform pg_temp.assert_that(v_saved->'plannerState'->'dutyRoster' @> v_duties,'selected-month assignments published');
  perform pg_temp.assert_that(not (v_saved->'plannerState'->'dutyRoster' ? '2026-11-01') and
    not (v_saved->'plannerState'->'dutyRoster' ? '2026-11-15'),'old selected-month days explicitly removed');
  perform pg_temp.assert_that(v_saved#>'{plannerState,dutyRoster,2026-10-31}'=v_portal#>'{plannerState,dutyRoster,2026-10-31}' and
    v_saved#>'{plannerState,dutyRoster,2026-12-01}'=v_portal#>'{plannerState,dutyRoster,2026-12-01}','other-month duty rosters preserved');
  perform pg_temp.assert_that(v_saved->'userBindings'=v_portal->'userBindings' and v_saved->'unknownRoot'=v_portal->'unknownRoot','user bindings and unknown root fields preserved');
  perform pg_temp.assert_that(v_saved#>'{plannerState,specialistDutyRoster}'=v_portal#>'{plannerState,specialistDutyRoster}' and
    v_saved#>'{plannerState,specialistWorkAssignments}'=v_portal#>'{plannerState,specialistWorkAssignments}' and
    v_saved#>'{plannerState,rotatorAssignments}'=v_portal#>'{plannerState,rotatorAssignments}','specialist and rotator records preserved');
  perform pg_temp.assert_that(v_saved#>'{plannerState,manualAssignments,2026-11-06,room}'='["Bora"]'::jsonb and
    v_saved#>'{plannerState,manualAssignments,2026-12-01,room}'='["Bora"]'::jsonb and v_result->>'removedRoomAssignments'='2','next-day normal rooms cleaned including next-month date and name case');
  perform pg_temp.assert_that(v_saved#>'{plannerState,manualAssignments,2026-11-06,leave}'='["İsmail"]'::jsonb and
    v_saved#>'{plannerState,manualAssignments,2026-11-06,status}'='["İsmail"]'::jsonb and
    v_saved#>'{plannerState,manualAssignments,2026-12-01,leave}'='["Çağla"]'::jsonb,'leave and status entries preserved');
  perform pg_temp.assert_that(v_saved#>'{plannerState,manualAssignments,2026-11-16}'=v_portal#>'{plannerState,manualAssignments,2026-11-16}' and
    v_saved#>'{plannerState,manualAssignments,2026-10-20}'=v_portal#>'{plannerState,manualAssignments,2026-10-20}','unaffected manual assignments preserved');
  perform pg_temp.assert_that((select count(*)=v_portal_history+1 from public.portal_state_history),'publication backs up previous portal payload');
  perform pg_temp.assert_that((select last_published_month='2026-11' and last_published_revision=102 and last_published_at is not null from public.duty_planner_state),'publication metadata records draft revision');
  perform pg_temp.assert_that((select count(*)=1 from public.duty_planner_history where kind='completed' and month='2026-11' and revision=102),'published draft has completed backup');
  execute 'reset role';

  -- An intentionally empty month removes only that month, without restoring stale rooms.
  update public.duty_planner_state set state=jsonb_set(v_draft,'{assignments}','[]'::jsonb) where id=1;
  execute 'set local role authenticated';
  v_result := public.publish_duty_planner('2026-11',102,(v_result->>'portalRevision')::timestamptz,'{}'::jsonb);
  perform pg_temp.assert_that(not exists(select 1 from jsonb_each(v_result#>'{payload,plannerState,dutyRoster}') where left(key,7)='2026-11'),'empty saved month clears published month explicitly');
  perform pg_temp.assert_that(v_result#>'{payload,plannerState,dutyRoster,2026-12-01}'=v_portal#>'{plannerState,dutyRoster,2026-12-01}','empty publication preserves next-month duties');
  execute 'reset role';
end;
$tests$;
select count(*) as assertions_passed, jsonb_agg(label) as passed_cases from pg_temp.duty_db_test_results;
rollback;
select true as synthetic_changes_rolled_back;
