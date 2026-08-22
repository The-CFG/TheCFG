-- ════════════════════════════════════════════════════════════════════════
--  transfer_host 버그 수정
--
--  기존 문제:
--   1) where ... and status = 'waiting' 제한 때문에 countdown/playing/finished
--      상태에서 호스트가 나가면 0 rows update(에러 없이 조용히 실패)인데도
--      클라이언트(rooms.js transferHost)는 성공으로 간주하고 host_transferred를
--      브로드캐스트 -> 클라이언트 로컬 상태(_isHost)만 바뀌고 실제 DB host_id는
--      그대로라 이후 호스트 전용 RPC가 전부 RLS에 막혀 조용히 실패.
--   2) 호출자가 실제 현재 호스트인지 전혀 검증 안 함(SECURITY DEFINER라 RLS도
--      안 걸림) -> 누구든 room_id/새 host_id만 알면 임의로 호스트를 바꿔치기 가능.
--
--  수정: status 제한 제거, 호출자 = 현재 host_id인지 확인, 실제 갱신 행 수 기준
--  boolean 리턴으로 바꿔서 클라이언트가 "진짜로 넘어갔는지" 확인할 수 있게 한다.
--
--  참고: 리턴 타입이 void -> boolean으로 바뀌어서 CREATE OR REPLACE로는 안 먹는다
--  (42P13 cannot change return type of existing function). DROP 먼저 해야 함.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.transfer_host(uuid, uuid);

CREATE OR REPLACE FUNCTION public.transfer_host(_room_id uuid, _new_host_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count int;
begin
  update public.beat_rooms
  set host_id = _new_host_id
  where id = _room_id
    and host_id = auth.uid()
    and exists (
      select 1 from public.beat_room_players
      where room_id = _room_id and user_id = _new_host_id
    );
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$function$;