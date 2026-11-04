-- TheBeat S4: YouTube 곡 재생 중 광고가 관찰되면 has_ads=true로 자동 누적.
-- 클라이언트가 직접 UPDATE하면 소유자만 가능하므로, has_ads를 true로만 올리는 좁은 RPC를 둔다.
create or replace function public.beat_report_song_ads(p_song_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.beat_songs
     set has_ads = true
   where id = p_song_id
     and source_type = 'youtube'
     and has_ads is distinct from true;
$$;

revoke all on function public.beat_report_song_ads(uuid) from public;
grant execute on function public.beat_report_song_ads(uuid) to authenticated;
