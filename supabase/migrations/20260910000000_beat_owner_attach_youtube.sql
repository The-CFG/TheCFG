-- ════════════════════════════════════════════════════════════════════════
-- TheBeat: 이미 올린 곡의 소유자가 직접 YouTube 링크 기반으로 전환한다.
--   · 대상: 본인 소유의 hosted/local 곡 (삭제 처리(removed)된 곡은 제외)
--   · 전환 = source_type 'youtube' + 링크/오프셋/길이 저장 + 서버 오디오 경로 제거(곡/차트)
--   · 옛 오디오 경로는 함수가 반환하고 정리 대기열에도 적재 → 클라이언트가 바로 Storage에서 삭제,
--     실패하면 대기열에 남아 모더레이터의 "파일 삭제 실행"으로 정리된다.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.beat_attach_youtube_own(p_song_id uuid, p_youtube_id text, p_offset_ms int, p_duration_ms int)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  _song  public.beat_songs%rowtype;
  _paths text[];
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_youtube_id is null or p_youtube_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'invalid youtube id'; end if;
  if coalesce(p_offset_ms, 0) < 0 then raise exception 'invalid offset'; end if;
  if p_duration_ms is null or p_duration_ms <= 0 then raise exception 'invalid duration'; end if;

  select * into _song from public.beat_songs
   where id = p_song_id
     and owner_id = auth.uid()
     and source_type in ('hosted', 'local')
     and moderation_status <> 'removed'
   for update;
  if not found then raise exception 'song not convertible'; end if;

  select coalesce(array_agg(distinct p), '{}') into _paths from (
    select _song.audio_storage_path as p
    union
    select c.audio_storage_path from public.beat_charts c where c.song_id = p_song_id
  ) x where p is not null;

  if array_length(_paths, 1) is not null then
    insert into public.beat_audio_purge_queue (song_id, storage_path)
    select p_song_id, unnest(_paths)
    on conflict (storage_path) do nothing;
  end if;

  update public.beat_charts set audio_storage_path = null, audio_mime = null where song_id = p_song_id;

  update public.beat_songs
     set source_type = 'youtube',
         youtube_id = p_youtube_id,
         yt_offset_ms = coalesce(p_offset_ms, 0),
         yt_duration_ms = p_duration_ms,
         audio_storage_path = null,
         audio_mime = null,
         audio_hash = null
   where id = p_song_id;

  return _paths;
end;
$$;

-- 클라이언트가 Storage에서 옛 오디오를 지운 뒤 호출 — 본인이 적재한 대기열 항목만 비운다
create or replace function public.beat_own_purge_done(p_paths text[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.beat_audio_purge_queue
   where storage_path = any(p_paths) and queued_by = auth.uid();
$$;

revoke all on function public.beat_attach_youtube_own(uuid, text, int, int) from public;
revoke all on function public.beat_own_purge_done(text[]) from public;
grant execute on function public.beat_attach_youtube_own(uuid, text, int, int) to authenticated;
grant execute on function public.beat_own_purge_done(text[]) to authenticated;
