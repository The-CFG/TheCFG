-- ════════════════════════════════════════════════════════════════════════
-- TheBeat 모더레이션: 모더레이터 권한 + 신고 접수 + 수동 삭제 처리
--
--  원칙: 신고는 "접수"만 한다. 신고가 들어와도 곡/차트에는 아무 일도 일어나지 않는다(자동 숨김 없음).
--        모더레이터가 검토 후 직접 "삭제 처리"해야 비공개+잠금이 걸린다(악용 방지).
--  모더레이터 지정: 클라이언트에서는 불가. SQL 에디터/서비스 롤에서
--        insert into public.beat_moderators (user_id, note) values ('<uuid>', '메모');
--  "삭제 처리" = moderation_status 'removed' + is_public=false(곡/차트 전부). 행은 증거로 남기고,
--        소유자가 다시 공개로 돌릴 수 없다. 모더레이터는 복구(restore)로 잠금만 풀 수 있다(공개 전환은 소유자가).
-- ════════════════════════════════════════════════════════════════════════

-- 1. 모더레이터 -----------------------------------------------------------
create table if not exists public.beat_moderators (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  note        text
);
alter table public.beat_moderators enable row level security;

drop policy if exists beat_moderators_select_self on public.beat_moderators;
create policy beat_moderators_select_self on public.beat_moderators
  for select to authenticated using (user_id = auth.uid());
-- insert/update/delete 정책 없음 → 클라이언트에서 모더레이터 지정/해제 불가

create or replace function public.beat_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.beat_moderators where user_id = auth.uid());
$$;
revoke all on function public.beat_is_moderator() from public;
grant execute on function public.beat_is_moderator() to authenticated;

-- 2. 곡 모더레이션 컬럼 ------------------------------------------------------
alter table public.beat_songs
  add column if not exists moderation_status text not null default 'ok',
  add column if not exists moderation_reason text,
  add column if not exists moderated_by      uuid,
  add column if not exists moderated_at      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'beat_songs_moderation_status_check') then
    alter table public.beat_songs
      add constraint beat_songs_moderation_status_check check (moderation_status in ('ok', 'removed'));
  end if;
end $$;

-- 모더레이터(또는 SQL 에디터/서비스 롤)가 아니면 모더레이션 컬럼을 못 바꾸고,
-- 삭제 처리된 곡은 공개로 되돌릴 수 없다.
create or replace function public.beat_songs_guard_moderation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _privileged boolean := (auth.uid() is null) or public.beat_is_moderator();
begin
  if _privileged then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_status := 'ok';
    new.moderation_reason := null;
    new.moderated_by := null;
    new.moderated_at := null;
  else
    new.moderation_status := old.moderation_status;
    new.moderation_reason := old.moderation_reason;
    new.moderated_by := old.moderated_by;
    new.moderated_at := old.moderated_at;
    if old.moderation_status = 'removed' then
      new.is_public := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists beat_songs_guard_moderation_trg on public.beat_songs;
create trigger beat_songs_guard_moderation_trg
  before insert or update on public.beat_songs
  for each row execute function public.beat_songs_guard_moderation();

-- 삭제 처리된 곡의 차트는 공개로 만들 수 없다.
create or replace function public.beat_charts_guard_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.uid() is null) or public.beat_is_moderator() then
    return new;
  end if;
  if exists (select 1 from public.beat_songs s where s.id = new.song_id and s.moderation_status = 'removed') then
    new.is_public := false;
  end if;
  return new;
end;
$$;

drop trigger if exists beat_charts_guard_moderation_trg on public.beat_charts;
create trigger beat_charts_guard_moderation_trg
  before insert or update on public.beat_charts
  for each row execute function public.beat_charts_guard_moderation();

-- 3. 신고 -----------------------------------------------------------------
create table if not exists public.beat_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null default auth.uid(),
  song_id      uuid not null,
  chart_id     uuid,
  reason       text not null check (reason in ('copyright', 'inappropriate', 'spam', 'other')),
  detail       text check (detail is null or char_length(detail) <= 1000),
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now(),
  handled_by   uuid,
  handled_at   timestamptz,
  mod_note     text
);
-- 같은 사람이 같은 곡에 처리 대기 신고를 중복으로 쌓지 못하게
create unique index if not exists beat_reports_one_open_per_reporter
  on public.beat_reports (reporter_id, song_id) where status = 'open';
create index if not exists beat_reports_status_created_idx on public.beat_reports (status, created_at desc);
create index if not exists beat_reports_song_idx on public.beat_reports (song_id);

alter table public.beat_reports enable row level security;

drop policy if exists beat_reports_insert_own on public.beat_reports;
create policy beat_reports_insert_own on public.beat_reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open' and handled_by is null and handled_at is null and mod_note is null);

-- 신고자는 자기 신고만, 모더레이터는 전부. (곡 소유자는 신고자를 볼 수 없다)
drop policy if exists beat_reports_select on public.beat_reports;
create policy beat_reports_select on public.beat_reports
  for select to authenticated using (reporter_id = auth.uid() or public.beat_is_moderator());
-- update/delete 정책 없음 → 처리는 아래 RPC로만

-- 접수 검증: 곡 존재 확인 + 하루 20건 제한(스팸 신고 방지)
create or replace function public.beat_reports_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.beat_songs where id = new.song_id) then
    raise exception 'song not found';
  end if;
  if (select count(*) from public.beat_reports
       where reporter_id = new.reporter_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many reports';
  end if;
  return new;
end;
$$;

drop trigger if exists beat_reports_validate_trg on public.beat_reports;
create trigger beat_reports_validate_trg
  before insert on public.beat_reports
  for each row execute function public.beat_reports_validate();

-- 4. 모더레이터 RPC (전부 beat_is_moderator() 검사) ---------------------------
create or replace function public.beat_mod_require()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.beat_is_moderator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.beat_mod_list_reports(p_status text default 'open', p_limit int default 50)
returns table (
  report_id uuid, song_id uuid, chart_id uuid, reason text, detail text, status text,
  created_at timestamptz, handled_at timestamptz, mod_note text,
  song_title text, song_artist text, source_type text, youtube_id text, is_public boolean,
  moderation_status text, moderation_reason text,
  owner_id uuid, owner_handle text,
  reporter_id uuid, reporter_handle text, reporter_dismissed_count bigint, reports_on_song bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  return query
  select r.id, r.song_id, r.chart_id, r.reason, r.detail, r.status,
         r.created_at, r.handled_at, r.mod_note,
         s.title, s.artist, s.source_type, s.youtube_id, s.is_public,
         s.moderation_status, s.moderation_reason,
         s.owner_id, op.handle,
         r.reporter_id, rp.handle,
         (select count(*) from public.beat_reports x where x.reporter_id = r.reporter_id and x.status = 'dismissed'),
         (select count(*) from public.beat_reports y where y.song_id = r.song_id)
    from public.beat_reports r
    left join public.beat_songs s on s.id = r.song_id
    left join public.user_profiles op on op.user_id = s.owner_id
    left join public.user_profiles rp on rp.user_id = r.reporter_id
   where r.status = p_status
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- 삭제 처리: 곡+차트 비공개 + 잠금, 그 곡의 대기 신고는 처리 완료로
create or replace function public.beat_mod_takedown_song(p_song_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  update public.beat_songs
     set moderation_status = 'removed',
         moderation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         moderated_by = auth.uid(),
         moderated_at = now(),
         is_public = false
   where id = p_song_id;
  if not found then raise exception 'song not found'; end if;
  update public.beat_charts set is_public = false where song_id = p_song_id;
  update public.beat_reports
     set status = 'actioned', handled_by = auth.uid(), handled_at = now(),
         mod_note = coalesce(mod_note, nullif(btrim(coalesce(p_reason, '')), ''))
   where song_id = p_song_id and status = 'open';
end;
$$;

-- 신고 기각 (처리 이력은 남긴다)
create or replace function public.beat_mod_dismiss_report(p_report_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  update public.beat_reports
     set status = 'dismissed', handled_by = auth.uid(), handled_at = now(),
         mod_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_report_id and status = 'open';
  if not found then raise exception 'report not found or already handled'; end if;
end;
$$;

-- 삭제 처리 복구: 잠금만 푼다. 공개 전환은 소유자가 직접 해야 한다.
create or replace function public.beat_mod_restore_song(p_song_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  update public.beat_songs
     set moderation_status = 'ok',
         moderation_reason = nullif(btrim(coalesce(p_note, '')), ''),
         moderated_by = auth.uid(),
         moderated_at = now()
   where id = p_song_id and moderation_status = 'removed';
  if not found then raise exception 'song not removed'; end if;
end;
$$;

revoke all on function public.beat_mod_require() from public;
revoke all on function public.beat_mod_list_reports(text, int) from public;
revoke all on function public.beat_mod_takedown_song(uuid, text) from public;
revoke all on function public.beat_mod_dismiss_report(uuid, text) from public;
revoke all on function public.beat_mod_restore_song(uuid, text) from public;
grant execute on function public.beat_mod_list_reports(text, int) to authenticated;
grant execute on function public.beat_mod_takedown_song(uuid, text) to authenticated;
grant execute on function public.beat_mod_dismiss_report(uuid, text) to authenticated;
grant execute on function public.beat_mod_restore_song(uuid, text) to authenticated;
