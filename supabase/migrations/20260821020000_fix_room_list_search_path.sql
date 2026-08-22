-- ════════════════════════════════════════════════════════════════════════
--  "relation beat_rooms does not exist" 수정
--
--  원인: join_listed_room / set_room_password가 SECURITY DEFINER 함수 안에서
--  beat_rooms / beat_room_players / beat_room_passwords / crypt / gen_salt를
--  스키마 명시 없이(search_path 의존) 참조하고 있었다. REST로 직접 호출하는
--  .from('beat_rooms') 계열(방 만들기/코드로 참가)은 PostgREST가 매 쿼리마다
--  스키마를 명시해서 호출하므로 영향이 없었지만, 이 두 RPC는 함수 본문 내부의
--  SET search_path 설정에 의존하다 보니 배포 시점/환경에 따라 search_path가
--  기대와 다르게 걸려 "relation ... does not exist"로 통째로 실패할 수 있었다.
--
--  해결: search_path에 기대는 대신 모든 테이블/함수 참조를 스키마까지 완전히
--  명시(public.xxx, extensions.crypt 등)한다. CREATE OR REPLACE라 기존 함수를
--  그대로 덮어쓴다 — 시그니처는 안 바뀌므로 클라이언트 코드 수정 불필요.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_room_password(_room_id uuid, _password text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_host_id uuid;
begin
  select host_id into v_host_id from public.beat_rooms where id = _room_id;
  if v_host_id is null then
    raise exception '방을 찾을 수 없습니다.';
  end if;
  if v_host_id <> auth.uid() then
    raise exception '호스트만 비밀번호를 설정할 수 있습니다.';
  end if;

  if _password is null or length(trim(_password)) = 0 then
    delete from public.beat_room_passwords where room_id = _room_id;
    update public.beat_rooms set has_password = false where id = _room_id;
  else
    insert into public.beat_room_passwords (room_id, password_hash, updated_at)
    values (_room_id, extensions.crypt(_password, extensions.gen_salt('bf')), now())
    on conflict (room_id) do update
      set password_hash = excluded.password_hash, updated_at = now();
    update public.beat_rooms set has_password = true where id = _room_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_listed_room(_room_id uuid, _password text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

  select status into v_status from public.beat_rooms where id = _room_id;
  if v_status is null then
    raise exception '방을 찾을 수 없습니다.';
  end if;
  if v_status <> 'waiting' then
    raise exception '이미 시작됐거나 종료된 방이라 참가할 수 없습니다.';
  end if;

  select password_hash into v_hash from public.beat_room_passwords where room_id = _room_id;
  if v_hash is not null then
    if _password is null or extensions.crypt(_password, v_hash) <> v_hash then
      raise exception '비밀번호가 올바르지 않습니다.';
    end if;
  end if;

  if not public.room_has_space(_room_id) then
    raise exception '방이 가득 찼습니다.';
  end if;

  select raw_user_meta_data ->> 'display_name' into v_nickname
  from auth.users where id = v_user_id;

  insert into public.beat_room_players (room_id, user_id, nickname)
  values (_room_id, v_user_id, v_nickname)
  on conflict (room_id, user_id) do nothing;
end;
$function$;

-- room_has_space도 같은 이유로 같이 굳혀둔다(join_listed_room이 내부에서 호출).
CREATE OR REPLACE FUNCTION public.room_has_space(_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (
    select count(*) from public.beat_room_players where room_id = _room_id
  ) < (
    select max_players from public.beat_rooms where id = _room_id
  );
$function$;
