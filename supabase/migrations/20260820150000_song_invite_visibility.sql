-- ════════════════════════════════════════════════════════════════════════
--  초대받은 노래의 최소 정보(제목/아티스트/소유자) 조회 — 비공개 노래 대응
--
--  문제: CloudCharts.listMyInvites()가 beat_songs(title, artist)를 임베드
--  조회하는데, 초대를 아직 수락하기 전이라 초대받은 사람은 beat_songs의
--  RLS(songs_member_select 등)를 통과하지 못한다. 그 결과 비공개 노래로
--  초대받으면 title/artist가 전부 null로 와서 Inbox에 "비공개 노래"로만
--  표시되고 무슨 노래인지, 누가 초대했는지 알 수 없었다.
--
--  해결: beat_songs 테이블 자체에 초대받은 사람용 SELECT 정책을 추가하는
--  대신(그러면 audio_storage_path 등 테이블 전체 컬럼이 노출됨), 꼭 필요한
--  최소 정보(제목/아티스트/소유자 user_id)만 반환하는 SECURITY DEFINER RPC를
--  별도로 둔다. 소유자 닉네임은 클라이언트에서 기존 get_nicknames_by_ids로
--  붙인다.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_my_song_invites()
 RETURNS TABLE(
   id uuid,
   song_id uuid,
   role text,
   created_at timestamptz,
   song_title text,
   song_artist text,
   owner_id uuid
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
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
  where i.invited_email = auth.email()
    and i.status = 'pending'
  order by i.created_at desc;
$$;
