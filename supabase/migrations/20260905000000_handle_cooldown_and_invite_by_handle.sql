-- ════════════════════════════════════════════════
-- 스프린트 1: 아이디(handle) 변경 쿨다운 + 아이디로 초대하기
-- ════════════════════════════════════════════════

-- ────────────────────────────────────────────────
-- A. 아이디 변경 쿨다운 (14일)
-- ────────────────────────────────────────────────

alter table public.user_profiles
  add column if not exists handle_changed_at timestamptz;

-- set_own_handle 재정의: 마지막 변경으로부터 14일이 지나지 않았으면 거부.
-- 최초 설정(handle_changed_at이 null)은 쿨다운 없이 바로 허용한다.
create or replace function public.set_own_handle(p_handle text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_last_changed timestamptz;
  v_cooldown constant interval := interval '14 days';
  v_remaining interval;
  v_remaining_days int;
begin
  if p_handle !~ '^[A-Za-z0-9._]{4,10}$' then
    raise exception 'invalid_handle_format';
  end if;

  select handle_changed_at into v_last_changed
  from public.user_profiles where user_id = auth.uid();
  if not found then
    raise exception 'profile_not_found';
  end if;

  if v_last_changed is not null and now() - v_last_changed < v_cooldown then
    v_remaining := v_cooldown - (now() - v_last_changed);
    v_remaining_days := greatest(1, ceil(extract(epoch from v_remaining) / 86400)::int);
    -- 클라이언트가 남은 일수를 그대로 안내 문구에 쓸 수 있도록 메시지에 함께 실어 보낸다
    -- (js/home/auth.js가 'handle_cooldown:' 접두사로 파싱).
    raise exception 'handle_cooldown:%', v_remaining_days;
  end if;

  update public.user_profiles
    set handle = p_handle, handle_changed_at = now()
    where user_id = auth.uid();
exception
  when unique_violation then raise exception 'handle_taken';
end;
$$;

-- ────────────────────────────────────────────────
-- B. 아이디로 초대하기 — beat_song_invites / project_invites에
--    invited_user_id 추가(이메일과 양자택일). get_user_id_by_handle을
--    재사용해 클라이언트가 아이디를 user_id로 미리 변환한 뒤 이 컬럼에 넣는다.
-- ────────────────────────────────────────────────

alter table public.beat_song_invites
  alter column invited_email drop not null,
  add column if not exists invited_user_id uuid references auth.users(id) on delete cascade;

alter table public.beat_song_invites
  add constraint beat_song_invites_target_check
  check (invited_email is not null or invited_user_id is not null);

alter table public.project_invites
  alter column invited_email drop not null,
  add column if not exists invited_user_id uuid references auth.users(id) on delete cascade;

alter table public.project_invites
  add constraint project_invites_target_check
  check (invited_email is not null or invited_user_id is not null);

create index if not exists idx_beat_song_invites_user on public.beat_song_invites(invited_user_id);
create index if not exists idx_project_invites_user on public.project_invites(invited_user_id);

-- ── RLS 재정의: 이메일 매칭에 invited_user_id 매칭을 OR로 추가 ──

drop policy if exists invites_self_select on public.beat_song_invites;
create policy invites_self_select on public.beat_song_invites for select
  using (owner_id = auth.uid() or invited_email = auth.email() or invited_user_id = auth.uid());

drop policy if exists invites_self_update on public.beat_song_invites;
create policy invites_self_update on public.beat_song_invites for update
  using (invited_email = auth.email() or invited_user_id = auth.uid());

drop policy if exists "invites_self_select" on public.project_invites;
create policy "invites_self_select" on public.project_invites for select
  using (owner_id = auth.uid() or invited_email = auth.email() or invited_user_id = auth.uid());

drop policy if exists "invites_self_update" on public.project_invites;
create policy "invites_self_update" on public.project_invites for update
  using (invited_email = auth.email() or invited_user_id = auth.uid());

-- ── RPC 재정의: 이메일 OR 아이디(invited_user_id) 매칭 ──

create or replace function public.accept_song_invite(_invite_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  inv record;
begin
  select * into inv from beat_song_invites
    where id = _invite_id and status = 'pending'
      and (invited_email = auth.email() or invited_user_id = auth.uid());
  if not found then raise exception '초대를 찾을 수 없습니다.'; end if;

  insert into beat_song_members (song_id, member_id, role)
  values (inv.song_id, auth.uid(), inv.role)
  on conflict (song_id, member_id) do update set role = excluded.role;

  update beat_song_invites set status = 'accepted' where id = _invite_id;
end;
$$;

create or replace function public.list_my_song_invites()
 returns table(
   id uuid,
   song_id uuid,
   role text,
   created_at timestamptz,
   song_title text,
   song_artist text,
   owner_id uuid
 )
 language sql stable security definer set search_path to 'public'
as $$
  select
    i.id,
    i.song_id,
    i.role,
    i.created_at,
    s.title as song_title,
    s.artist as song_artist,
    s.owner_id
  from beat_song_invites i
  join beat_songs s on s.id = i.song_id
  where (i.invited_email = auth.email() or i.invited_user_id = auth.uid())
    and i.status = 'pending'
  order by i.created_at desc;
$$;

create or replace function public.accept_project_invite(invite_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    inv project_invites%rowtype;
begin
    select * into inv
    from project_invites
    where id = invite_id
      and status = 'pending'
      and (invited_email = auth.email() or invited_user_id = auth.uid());

    if not found then
        raise exception '유효하지 않은 초대이거나 이미 처리된 초대입니다.';
    end if;

    insert into project_members (owner_id, project_name, member_id, role)
    values (inv.owner_id, inv.project_name, auth.uid(), inv.role)
    on conflict (owner_id, project_name, member_id)
    do update set role = excluded.role;

    update project_invites
    set status = 'accepted'
    where id = invite_id;
end;
$function$;
