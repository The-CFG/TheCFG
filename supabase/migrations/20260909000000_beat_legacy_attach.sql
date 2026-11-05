-- ════════════════════════════════════════════════════════════════════════
-- TheBeat S6: 기존(legacy hosted) 곡에 운영자가 YouTube 링크를 일괄 첨부하고, 기존 오디오를 정리한다.
--   · 모더레이터(=운영자)만 사용 가능 (beat_mod_require)
--   · 첨부 = 곡을 youtube 소스로 전환 + DB의 오디오 경로 제거 + 옛 경로를 정리 대기열에 적재
--   · 정리 대기열의 파일은 모더레이터 도구에서 Storage에서 실제 삭제 후 대기열에서 비운다
--   · 창작곡 선언(original_declared=true)된 hosted 곡은 대상이 아니다
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.beat_audio_purge_queue (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid,
  storage_path  text not null unique,
  queued_at     timestamptz not null default now(),
  queued_by     uuid default auth.uid()
);
alter table public.beat_audio_purge_queue enable row level security;
-- 정책 없음 → 직접 접근 불가, 아래 RPC로만

-- 모더레이터는 beat-files 버킷의 파일을 삭제할 수 있다 (정리 대기열 처리용)
drop policy if exists beat_files_moderator_delete on storage.objects;
create policy beat_files_moderator_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'beat-files' and public.beat_is_moderator());

-- 모더레이터는 legacy 음원을 듣고 YouTube 영상과 오프셋을 맞춰 볼 수 있어야 한다 (비공개 전환 후에도)
drop policy if exists beat_files_moderator_select on storage.objects;
create policy beat_files_moderator_select on storage.objects
  for select to authenticated
  using (bucket_id = 'beat-files' and public.beat_is_moderator());

-- legacy 곡 목록: 아직 YouTube로 전환되지 않은 hosted 곡
create or replace function public.beat_mod_list_legacy_songs(p_q text default null, p_limit int default 20, p_offset int default 0)
returns table (
  song_id uuid, title text, artist text, owner_handle text, is_public boolean,
  audio_storage_path text, start_offset_ms int, preview_start_ms int, chart_count bigint, created_at timestamptz, total bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  return query
  with base as (
    select s.* from public.beat_songs s
     where s.source_type = 'hosted'
       and s.original_declared is not true
       and s.audio_storage_path is not null
       and (p_q is null or btrim(p_q) = '' or s.title ilike '%' || btrim(p_q) || '%' or coalesce(s.artist, '') ilike '%' || btrim(p_q) || '%')
  )
  select b.id, b.title, b.artist, up.handle, b.is_public,
         b.audio_storage_path, coalesce(b.start_offset_ms, 0), coalesce(b.preview_start_ms, 0),
         (select count(*) from public.beat_charts c where c.song_id = b.id),
         b.created_at,
         (select count(*) from base)
    from base b
    left join public.user_profiles up on up.user_id = b.owner_id
   order by b.created_at asc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- YouTube 링크 첨부: hosted(legacy) → youtube 전환. 옛 오디오 경로는 정리 대기열로.
create or replace function public.beat_mod_attach_youtube(p_song_id uuid, p_youtube_id text, p_offset_ms int, p_duration_ms int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _song public.beat_songs%rowtype;
begin
  perform public.beat_mod_require();
  if p_youtube_id is null or p_youtube_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid youtube id';
  end if;
  if coalesce(p_offset_ms, 0) < 0 then raise exception 'invalid offset'; end if;
  if p_duration_ms is null or p_duration_ms <= 0 then raise exception 'invalid duration'; end if;

  select * into _song from public.beat_songs
   where id = p_song_id and source_type = 'hosted' and original_declared is not true
   for update;
  if not found then raise exception 'not a legacy song'; end if;

  -- 정리 대기열 적재 (곡 + 차트에 붙은 서로 다른 오디오 경로)
  insert into public.beat_audio_purge_queue (song_id, storage_path)
  select p_song_id, p from (
    select _song.audio_storage_path as p
    union
    select c.audio_storage_path from public.beat_charts c where c.song_id = p_song_id
  ) x
  where p is not null
  on conflict (storage_path) do nothing;

  update public.beat_charts set audio_storage_path = null, audio_mime = null where song_id = p_song_id;

  update public.beat_songs
     set source_type = 'youtube',
         youtube_id = p_youtube_id,
         yt_offset_ms = coalesce(p_offset_ms, 0),
         yt_duration_ms = p_duration_ms,
         audio_storage_path = null,
         audio_mime = null
   where id = p_song_id;
end;
$$;

-- 정리 대기열 조회: 아직 어떤 곡/차트도 참조하지 않는 경로만 (안전장치)
create or replace function public.beat_mod_purge_list(p_limit int default 200)
returns table (id uuid, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  return query
  select q.id, q.storage_path from public.beat_audio_purge_queue q
   where not exists (select 1 from public.beat_songs s where s.audio_storage_path = q.storage_path)
     and not exists (select 1 from public.beat_charts c where c.audio_storage_path = q.storage_path)
   order by q.queued_at
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

create or replace function public.beat_mod_purge_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  perform public.beat_mod_require();
  select count(*) into n from public.beat_audio_purge_queue;
  return n;
end;
$$;

-- Storage에서 실제 삭제가 끝난 항목을 대기열에서 비운다
create or replace function public.beat_mod_purge_done(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beat_mod_require();
  delete from public.beat_audio_purge_queue where id = any(p_ids);
end;
$$;

revoke all on function public.beat_mod_list_legacy_songs(text, int, int) from public;
revoke all on function public.beat_mod_attach_youtube(uuid, text, int, int) from public;
revoke all on function public.beat_mod_purge_list(int) from public;
revoke all on function public.beat_mod_purge_count() from public;
revoke all on function public.beat_mod_purge_done(uuid[]) from public;
grant execute on function public.beat_mod_list_legacy_songs(text, int, int) to authenticated;
grant execute on function public.beat_mod_attach_youtube(uuid, text, int, int) to authenticated;
grant execute on function public.beat_mod_purge_list(int) to authenticated;
grant execute on function public.beat_mod_purge_count() to authenticated;
grant execute on function public.beat_mod_purge_done(uuid[]) to authenticated;
