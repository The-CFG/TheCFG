-- TheBeat: YouTube 곡은 다른 음원 종류(hosted 창작곡/local)로 바꿀 수 없다 (서버 측 잠금).
--   · YouTube 링크(youtube_id) / 오프셋 / 길이 변경은 소유자가 자유롭게 할 수 있다.
--   · hosted/local → youtube 전환은 허용(내 곡 목록 전환, 모더레이터 도구).
--   · 예외: auth.uid() 가 null 인 경우(SQL 에디터/서비스 롤)만 운영 목적으로 우회 가능.
create or replace function public.beat_songs_lock_youtube_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source_type = 'youtube'
     and new.source_type is distinct from 'youtube'
     and auth.uid() is not null then
    raise exception 'YouTube 곡은 다른 음원 종류로 변경할 수 없습니다.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists beat_songs_lock_youtube_source_trg on public.beat_songs;
create trigger beat_songs_lock_youtube_source_trg
  before update on public.beat_songs
  for each row execute function public.beat_songs_lock_youtube_source();
