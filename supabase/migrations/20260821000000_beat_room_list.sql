-- ════════════════════════════════════════════════════════════════════════
--  멀티플레이 "방 목록" 기능 — 초대 코드 없이도 공개된 방을 검색해서 참가
--
--  기존엔 방에 들어가는 방법이 초대 코드(6자리) 입력뿐이었다. 이 마이그레이션은
--  호스트가 "방 목록에 공개"를 켠 방들을 아무나 검색해서 볼 수 있게 하고,
--  그중 비밀번호가 걸린 방(비공개)은 비밀번호를 알아야 참가할 수 있게 한다.
--
--  설계:
--  - beat_rooms.is_listed  : 방 목록에 노출할지 여부(호스트가 설정, 기본 false).
--    UPDATE는 기존 "host can update own room" RLS 정책이 그대로 커버한다
--    (컬럼 단위 정책이 아니라 행 단위라 새 정책 불필요).
--  - beat_rooms.has_password : 비밀번호 설정 여부만 나타내는 플래그. 실제
--    해시는 절대 이 테이블에 두지 않는다 — beat_rooms는 "waiting 상태면 누구나
--    읽을 수 있음" 정책(authenticated can read waiting rooms or rooms they
--    joined)이 이미 걸려 있어서, 여기 해시를 두면 방 목록을 스캔하는 모두에게
--    해시가 그대로 노출된다.
--  - beat_room_passwords : 실제 비밀번호 해시(bcrypt, pgcrypto)를 담는 별도
--    테이블. RLS는 켜두고 SELECT/INSERT/UPDATE/DELETE 정책을 하나도 안 만든다
--    → anon/authenticated는 PostgREST로 직접 이 테이블에 어떤 요청을 해도
--    전부 거부된다. 오직 SECURITY DEFINER 함수(테이블 소유자 권한으로 실행,
--    RLS 우회)를 통해서만 접근 가능.
--  - beat_rooms.player_count : beat_room_players insert/delete 트리거로
--    실시간 동기화되는 인원수 캐시. 방 목록 화면에서 "3/6명"을 보여주려면
--    beat_room_players를 직접 세야 하는데, 그 테이블의 SELECT 정책
--    (room members can read player list of their room)은 "그 방 멤버만"
--    읽을 수 있어서 남의 방을 구경하는 사람은 count조차 못 읽는다. 매번
--    새 정책/RPC를 만드는 대신, beat_rooms 쪽에 캐시 컬럼을 두고 트리거로
--    맞춰주는 편이 간단하고, 이미 누구나 읽을 수 있는 컬럼들과 같이 나간다.
--
--  참가/비밀번호 설정은 반드시 RPC(join_listed_room / set_room_password)를
--  거치게 한다 — 클라이언트가 beat_room_players에 직접 INSERT하는 기존 경로
--  (초대 코드 참가)는 비밀번호를 검증할 수 없기 때문이다.
-- ════════════════════════════════════════════════════════════════════════

-- pgcrypto: 비밀번호 해시(crypt/gen_salt)에 사용. Supabase 프로젝트엔 보통
-- 이미 설치돼 있지만(gen_random_uuid() 등에 이미 의존 중), 혹시 몰라 명시.
-- 이미 설치돼 있으면(다른 스키마여도) IF NOT EXISTS라 조용히 스킵된다.
create extension if not exists "pgcrypto" with schema "extensions";

alter table "public"."beat_rooms"
    add column "is_listed" boolean not null default false,
    add column "has_password" boolean not null default false,
    add column "player_count" smallint not null default 0;

create table "public"."beat_room_passwords" (
    "room_id" uuid not null primary key references public.beat_rooms(id) on delete cascade,
    "password_hash" text not null,
    "updated_at" timestamp with time zone not null default now()
);

alter table "public"."beat_room_passwords" enable row level security;
-- 의도적으로 SELECT/INSERT/UPDATE/DELETE 정책을 하나도 만들지 않는다.
-- (RLS는 켜져 있고 정책이 없으면 owner를 제외한 모든 접근이 기본 거부된다.)
-- rls_auto_enable 이벤트 트리거가 어차피 새 테이블에 RLS를 자동으로 켜주지만,
-- 마이그레이션 실행 시점에 명시적으로 한 번 더 켜서 이 파일만 봐도 의도가
-- 분명하도록 한다.
revoke all on table "public"."beat_room_passwords" from "anon", "authenticated";

-- ── 인원수 캐시 동기화 트리거 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_beat_room_player_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'INSERT' then
    update beat_rooms set player_count = player_count + 1 where id = new.room_id;
  elsif TG_OP = 'DELETE' then
    update beat_rooms set player_count = greatest(player_count - 1, 0) where id = old.room_id;
  end if;
  return null;
end;
$function$;

drop trigger if exists beat_room_players_count_sync on "public"."beat_room_players";
create trigger beat_room_players_count_sync
    after insert or delete on "public"."beat_room_players"
    for each row execute function public.sync_beat_room_player_count();

-- 기존에 이미 만들어져 있던 방들의 player_count를 한 번 맞춰준다(신규 컬럼 기본값 0 보정).
update public.beat_rooms r
set player_count = (select count(*) from public.beat_room_players p where p.room_id = r.id);

-- ── 호스트 전용: 비밀번호 설정/변경/해제 ───────────────────────────────────
-- _password가 null이거나 공백만 있으면 비밀번호를 해제(공개 상태로 전환)한다.
CREATE OR REPLACE FUNCTION public.set_room_password(_room_id uuid, _password text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, extensions'
AS $function$
declare
  v_host_id uuid;
begin
  select host_id into v_host_id from beat_rooms where id = _room_id;
  if v_host_id is null then
    raise exception '방을 찾을 수 없습니다.';
  end if;
  if v_host_id <> auth.uid() then
    raise exception '호스트만 비밀번호를 설정할 수 있습니다.';
  end if;

  if _password is null or length(trim(_password)) = 0 then
    delete from beat_room_passwords where room_id = _room_id;
    update beat_rooms set has_password = false where id = _room_id;
  else
    insert into beat_room_passwords (room_id, password_hash, updated_at)
    values (_room_id, crypt(_password, gen_salt('bf')), now())
    on conflict (room_id) do update
      set password_hash = excluded.password_hash, updated_at = now();
    update beat_rooms set has_password = true where id = _room_id;
  end if;
end;
$function$;

-- ── 방 목록에서 참가 (비밀번호 검증 포함) ──────────────────────────────────
-- 초대 코드 참가(MultiplayerRooms.joinRoom)는 그대로 두고 건드리지 않는다 —
-- 초대 코드 자체가 이미 호스트에게 직접 전달받은 비밀 값이라 별도 비밀번호
-- 검증이 필요 없다는 기존 설계를 유지. 이 함수는 "방 목록"에서 들어올 때만 쓴다.
CREATE OR REPLACE FUNCTION public.join_listed_room(_room_id uuid, _password text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, extensions'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_hash text;
  v_nickname text;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select status into v_status from beat_rooms where id = _room_id;
  if v_status is null then
    raise exception '방을 찾을 수 없습니다.';
  end if;
  if v_status <> 'waiting' then
    raise exception '이미 시작됐거나 종료된 방이라 참가할 수 없습니다.';
  end if;

  select password_hash into v_hash from beat_room_passwords where room_id = _room_id;
  if v_hash is not null then
    if _password is null or crypt(_password, v_hash) <> v_hash then
      raise exception '비밀번호가 올바르지 않습니다.';
    end if;
  end if;

  if not room_has_space(_room_id) then
    raise exception '방이 가득 찼습니다.';
  end if;

  select raw_user_meta_data ->> 'display_name' into v_nickname
  from auth.users where id = v_user_id;

  insert into beat_room_players (room_id, user_id, nickname)
  values (_room_id, v_user_id, v_nickname)
  on conflict (room_id, user_id) do nothing;
end;
$function$;
