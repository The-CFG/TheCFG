-- ════════════════════════════════════════════════════════════════════════
--  방 정리 크론 실제 스케줄 등록 + countdown/playing 상태 방 정리 추가
--
--  문제 1: cleanup_stale_beat_rooms() 함수는 있었지만 cron.schedule(...)로
--  실제 등록된 적이 없어서 자동으로는 절대 안 돌고 있었다(수동 호출 시에만 동작).
--  waiting 상태는 lobby.js가 명시적으로 나갈 때 직접 delete로 우회했지만,
--  그것도 "앱 안에서 뒤로가기를 눌렀을 때"만 해당 — 탭을 그냥 닫거나
--  새로고침하면 그 경로도 안 타서 row가 영원히 남는다.
--
--  문제 2: 함수 자체도 status in ('waiting','abandoned')만 대상으로 해서,
--  countdown/playing 상태에서 호스트나 참가자가 전부 탭을 닫아버리면(재접속 없이)
--  그 방은 어떤 정리 경로로도 절대 지워지지 않았다.
--
--  수정:
--   - countdown/playing/finished 상태도 정리 대상에 포함(오래 걸리는 합주도 있을
--     수 있으니 waiting/abandoned보다는 넉넉하게 2시간 기준으로).
--   - pg_cron으로 5분마다 실제로 돌게 등록.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cleanup_stale_beat_rooms()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- waiting/abandoned: 대기실에서 30분 넘게 방치된 방(대부분 탭 닫기로 인한 고아 상태).
  delete from public.beat_room_players
  where room_id in (
    select id from public.beat_rooms
    where status in ('waiting', 'abandoned')
      and created_at < now() - interval '30 minutes'
  );
  delete from public.beat_rooms
  where status in ('waiting', 'abandoned')
    and created_at < now() - interval '30 minutes';

  -- countdown/playing: 시작은 됐는데 아무도 안 끝내고 전원 이탈해 영영 안 끝나는 방.
  -- 정상적인 합주도 있을 수 있으니 여유 있게 2시간 기준.
  delete from public.beat_room_players
  where room_id in (
    select id from public.beat_rooms
    where status in ('countdown', 'playing')
      and coalesce(started_at, created_at) < now() - interval '2 hours'
  );
  delete from public.beat_rooms
  where status in ('countdown', 'playing')
    and coalesce(started_at, created_at) < now() - interval '2 hours';

  -- finished: 결과 화면에서 아무도 안 나가고 방치된 방. 하루 지나면 정리.
  delete from public.beat_room_players
  where room_id in (
    select id from public.beat_rooms
    where status = 'finished'
      and created_at < now() - interval '1 day'
  );
  delete from public.beat_rooms
  where status = 'finished'
    and created_at < now() - interval '1 day';
end;
$function$;

-- 이 마이그레이션을 다시 돌려도(로컬 재적용 등) 중복 등록되지 않도록 기존 걸 먼저 지운다.
select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-stale-beat-rooms';

select cron.schedule(
  'cleanup-stale-beat-rooms',
  '*/5 * * * *',
  $$select public.cleanup_stale_beat_rooms();$$
);
