-- ════════════════════════════════════════════════════════════════════════
--  TheBeat 채보 공동작업 기능 — 마이그레이션
--  적용 순서: 테이블 → 헬퍼 함수 → RLS 정책 → RPC 함수 → 트리거 → (1회성) 백필
--  이 파일 전체를 한 번에 실행해도 순서가 맞도록 정렬해 두었음.
-- ════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────
-- 1. 신규 테이블
-- ────────────────────────────────────────────────────────────────────────

-- 공동 작업 멤버 (song 단위). owner는 이 테이블에 행이 없다 — beat_songs.owner_id로 판별.
create table public.beat_song_members (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.beat_songs(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  joined_at timestamptz not null default now(),
  unique (song_id, member_id)
);
alter table public.beat_song_members enable row level security;

-- 초대 (project_invites와 동일 패턴)
create table public.beat_song_invites (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.beat_songs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invited_email text not null,
  role text not null check (role in ('editor','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
alter table public.beat_song_invites enable row level security;

-- 난이도(beatmap)별 기여자 기록 — 라이브러리 "채보자" 표시용
create table public.beat_chart_contributors (
  chart_id uuid not null references public.beat_charts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_edited_at timestamptz not null default now(),
  last_edited_at timestamptz not null default now(),
  primary key (chart_id, user_id)
);
alter table public.beat_chart_contributors enable row level security;

create index idx_beat_song_members_member on public.beat_song_members(member_id);
create index idx_beat_song_invites_email on public.beat_song_invites(invited_email);
create index idx_beat_chart_contributors_chart on public.beat_chart_contributors(chart_id);


-- ────────────────────────────────────────────────────────────────────────
-- 2. 헬퍼 함수 (재귀 RLS 방지 — 기존 is_room_member()와 동일 패턴)
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.beat_song_owner(_song_id uuid)
 RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select owner_id from beat_songs where id = _song_id;
$$;

CREATE OR REPLACE FUNCTION public.beat_song_role(_song_id uuid, _user_id uuid)
 RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select case
    when (select owner_id from beat_songs where id = _song_id) = _user_id then 'owner'
    else (select role from beat_song_members
          where song_id = _song_id and member_id = _user_id)
  end;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- 3. RLS 정책 — beat_song_members
-- ────────────────────────────────────────────────────────────────────────

create policy members_select on public.beat_song_members for select
  using (beat_song_owner(song_id) = auth.uid() or member_id = auth.uid());

create policy members_insert on public.beat_song_members for insert
  with check (beat_song_owner(song_id) = auth.uid());

create policy members_update on public.beat_song_members for update
  using (beat_song_owner(song_id) = auth.uid());

create policy members_delete on public.beat_song_members for delete
  using (beat_song_owner(song_id) = auth.uid() or member_id = auth.uid()); -- 본인 탈퇴 허용


-- ────────────────────────────────────────────────────────────────────────
-- 4. RLS 정책 — beat_song_invites
-- ────────────────────────────────────────────────────────────────────────

create policy invites_owner on public.beat_song_invites for all
  using (owner_id = auth.uid());

create policy invites_self_select on public.beat_song_invites for select
  using (owner_id = auth.uid() or invited_email = auth.email());

create policy invites_self_update on public.beat_song_invites for update
  using (invited_email = auth.email()); -- 수락/거절


-- ────────────────────────────────────────────────────────────────────────
-- 5. RLS 정책 — beat_songs / beat_charts 확장
--    (기존 owner 기반 정책은 그대로 두고 OR로 추가되는 형태)
-- ────────────────────────────────────────────────────────────────────────

-- beat_songs: editor 역할이면 수정 가능
create policy songs_editor_update on public.beat_songs for update
  using (beat_song_role(id, auth.uid()) = 'editor')
  with check (beat_song_role(id, auth.uid()) = 'editor');

-- beat_songs: 멤버(editor/viewer)면 비공개여도 조회 가능
create policy songs_member_select on public.beat_songs for select
  using (beat_song_role(id, auth.uid()) in ('editor','viewer'));

-- beat_charts: editor면 CRUD 가능
create policy charts_editor_all on public.beat_charts for all
  using (beat_song_role(song_id, auth.uid()) = 'editor')
  with check (beat_song_role(song_id, auth.uid()) = 'editor');

-- beat_charts: 멤버(editor/viewer)면 비공개여도 조회 가능
create policy charts_member_select on public.beat_charts for select
  using (beat_song_role(song_id, auth.uid()) in ('editor','viewer'));


-- ────────────────────────────────────────────────────────────────────────
-- 6. RLS 정책 — beat_chart_contributors
-- ────────────────────────────────────────────────────────────────────────

-- 공개 채보 / 내가 멤버(owner/editor/viewer)인 채보의 기여자 목록은 조회 가능
create policy contributors_select on public.beat_chart_contributors for select
  using (
    exists (select 1 from beat_charts c where c.id = chart_id and c.is_public = true)
    or exists (select 1 from beat_charts c
               where c.id = chart_id
                 and beat_song_role(c.song_id, auth.uid()) in ('owner','editor','viewer'))
  );

-- 기여 기록은 본인 행만 upsert 가능 (record_chart_contribution RPC를 통해서만 호출)
create policy contributors_upsert on public.beat_chart_contributors for insert
  with check (user_id = auth.uid());

create policy contributors_touch on public.beat_chart_contributors for update
  using (user_id = auth.uid());


-- ────────────────────────────────────────────────────────────────────────
-- 7. RPC 함수
-- ────────────────────────────────────────────────────────────────────────

-- 저장 성공 시 클라이언트가 호출 — 기여자 기록 upsert
CREATE OR REPLACE FUNCTION public.record_chart_contribution(_chart_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  insert into beat_chart_contributors (chart_id, user_id, first_edited_at, last_edited_at)
  values (_chart_id, auth.uid(), now(), now())
  on conflict (chart_id, user_id)
  do update set last_edited_at = now();
end;
$$;

-- 초대 수락 — insert(members) + update(invites)를 원자적으로 처리
CREATE OR REPLACE FUNCTION public.accept_song_invite(_invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  inv record;
begin
  select * into inv from beat_song_invites
    where id = _invite_id and invited_email = auth.email() and status = 'pending';
  if not found then raise exception '초대를 찾을 수 없습니다.'; end if;

  insert into beat_song_members (song_id, member_id, role)
  values (inv.song_id, auth.uid(), inv.role)
  on conflict (song_id, member_id) do update set role = excluded.role;

  update beat_song_invites set status = 'accepted' where id = _invite_id;
end;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- 8. beat_songs.updated_at 자동 갱신 트리거 (누락분 보완)
--    beat_charts에는 이미 trg_beat_charts_updated_at이 있지만 beat_songs엔 없었음.
--    A안(낙관적 잠금)이 updated_at에 의존하므로 반드시 필요.
--    beat_charts_set_updated_at()은 범용 함수라 그대로 재사용 가능.
-- ────────────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_beat_songs_updated_at
  BEFORE UPDATE ON public.beat_songs
  FOR EACH ROW EXECUTE FUNCTION public.beat_charts_set_updated_at();


-- ────────────────────────────────────────────────────────────────────────
-- 9. (1회성) 백필 — 기존 beat_charts의 owner_id를 최초 기여자로 기록
--    배포 직후엔 beat_chart_contributors가 비어있어 채보자 표시가 빈 값이 되므로 필요.
--    ON CONFLICT DO NOTHING이라 재실행해도 안전(idempotent).
-- ────────────────────────────────────────────────────────────────────────

insert into public.beat_chart_contributors (chart_id, user_id, first_edited_at, last_edited_at)
select id, owner_id, created_at, updated_at from public.beat_charts
on conflict (chart_id, user_id) do nothing;
