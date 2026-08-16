-- beat_rooms.status CHECK 제약조건에 'abandoned'가 빠져 있던 걸 바로잡는다.
--
-- 배경: MultiplayerLobby._leaveRoom()은 방장이 방을 나가고 남은 인원이 없으면
-- beat_rooms.status를 'abandoned'로 업데이트한다(이후 cleanup_stale_beat_rooms
-- 크론 함수가 30분 뒤 완전히 삭제). 하지만 20260815115428_remote_schema.sql에서
-- 생성된 beat_rooms_status_check 제약조건은 'waiting' | 'countdown' | 'playing' |
-- 'finished' 네 값만 허용하고 있어서, 이 UPDATE가 23514(check_violation)로 실패했다.
--
-- cleanup_stale_beat_rooms() 자체는 이미 status in ('waiting', 'abandoned')를
-- 전제로 짜여 있으므로(같은 마이그레이션 파일 참고), 'abandoned'는 원래 의도된
-- 상태값이었다 — 제약조건 생성 시 누락된 것으로 보인다.

alter table "public"."beat_rooms" drop constraint if exists "beat_rooms_status_check";

alter table "public"."beat_rooms"
    add constraint "beat_rooms_status_check"
    CHECK ((status = ANY (ARRAY['waiting'::text, 'countdown'::text, 'playing'::text, 'finished'::text, 'abandoned'::text])))
    not valid;

alter table "public"."beat_rooms" validate constraint "beat_rooms_status_check";
