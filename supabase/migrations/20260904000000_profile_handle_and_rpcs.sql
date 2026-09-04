-- ════════════════════════════════════════════════
-- 프로필 화면: 고유 아이디(handle) + 프로필 조회용 RPC
-- ════════════════════════════════════════════════

-- ── 1. handle 컬럼 추가 (user_profiles) ──────────────────
alter table public.user_profiles
  add column if not exists handle text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_handle_format'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_handle_format
      check (handle ~ '^[A-Za-z0-9._]{4,10}$');
  end if;
end $$;

create unique index if not exists user_profiles_handle_unique_idx
  on public.user_profiles (lower(handle));

-- ── 2. 아이디 관련 RPC ────────────────────────────────────

-- 사용 가능 여부 확인
create or replace function public.is_handle_available(p_handle text)
returns boolean
language sql security definer set search_path to 'public'
as $$
  select not exists (
    select 1 from public.user_profiles where lower(handle) = lower(p_handle)
  );
$$;

-- 본인 아이디 설정/변경
create or replace function public.set_own_handle(p_handle text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_handle !~ '^[A-Za-z0-9._]{4,10}$' then
    raise exception 'invalid_handle_format';
  end if;

  update public.user_profiles set handle = p_handle where user_id = auth.uid();
  if not found then raise exception 'profile_not_found'; end if;
exception
  when unique_violation then raise exception 'handle_taken';
end;
$$;

-- 아이디 → user_id (프로필 라우팅 / 초대 검색 공용)
create or replace function public.get_user_id_by_handle(p_handle text)
returns uuid
language sql security definer set search_path to 'public'
as $$
  select user_id from public.user_profiles where lower(handle) = lower(p_handle) limit 1;
$$;

-- ── 3. 프로필 헤더 (닉네임/아이디/가입일) ──────────────────
create or replace function public.get_profile_header(p_user_id uuid)
returns table(user_id uuid, nickname text, handle text, created_at timestamptz)
language sql security definer set search_path to 'public'
as $$
  select u.id, u.raw_user_meta_data->>'display_name', p.handle, u.created_at
  from auth.users u
  join public.user_profiles p on p.user_id = u.id
  where u.id = p_user_id;
$$;

-- ── 4. HOI4 탭: 프로젝트 이름만 노출 (RLS 우회 필요) ────────
-- projects/project_members select 정책이 본인·당사자로 제한되어 있어
-- 프로필 조회 시 definer 함수로 우회. 비공개 기능 붙기 전까지는
-- 이름 외 정보(수정일/역할/소유자)는 반환하지 않음.
create or replace function public.get_profile_own_projects(p_user_id uuid)
returns table(name text)
language sql security definer set search_path to 'public'
as $$
  select name from public.projects
  where user_id = p_user_id order by updated_at desc;
$$;

create or replace function public.get_profile_collab_projects(p_user_id uuid)
returns table(project_name text)
language sql security definer set search_path to 'public'
as $$
  select pm.project_name
  from public.project_members pm
  where pm.member_id = p_user_id
  order by pm.joined_at desc;
$$;

-- ── 5. TheBeat 탭 보조: 최고 난이도 조회 ──────────────────
-- PostgREST는 조인된(임베디드) 테이블의 컬럼으로 최상위 order를 지원하지 않아
-- (beat_charts.difficulty_score 기준 정렬이 필요한) 이 쿼리만 RPC로 뺌.
-- RLS를 우회할 필요가 없으므로 SECURITY DEFINER를 붙이지 않음(호출자 권한으로 실행,
-- beat_charts의 is_public 정책이 그대로 적용됨).
create or replace function public.get_profile_beat_highest(p_user_id uuid)
returns table(title text, difficulty_label text, difficulty_score real)
language sql
as $$
  select c.title, c.difficulty_label, c.difficulty_score
  from public.beat_scores s
  join public.beat_charts c on c.id = s.chart_id
  where s.user_id = p_user_id
  order by c.difficulty_score desc nulls last
  limit 1;
$$;
