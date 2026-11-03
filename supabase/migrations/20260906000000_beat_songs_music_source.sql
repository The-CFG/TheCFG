-- ════════════════════════════════════════════════════════════════════════
-- TheBeat 음원 시스템 개편 S2: beat_songs 음원 소스 컬럼 + 신규 업로드 서버측 차단
--
--  source_type
--    youtube : 상용곡. YouTube 영상 ID만 저장, 서버에 음원 없음
--    local   : 유저가 자기 파일을 직접 올려 재생(BYO). 서버에 음원 없음, YouTube 링크 불필요.
--              (youtube_id가 같이 있어도 무방. audio_hash는 재생 시 파일 검증용)
--    hosted  : 창작곡 한정. 창작곡 선언 + 약관 동의 시에만 서버 저장
--
--  기존 곡은 전부 source_type='hosted'(선언 없음)으로 백필된다.
--  → 트리거는 INSERT 또는 "음원 관련 컬럼이 바뀌는 UPDATE"만 검사하므로
--    기존 곡의 제목/공개여부 수정, 협업 저장은 그대로 동작한다.
--  → S6에서 운영자가 기존 곡을 youtube로 전환할 때는
--    (source_type='youtube', youtube_id=..., audio_storage_path=null)을 한 번의 UPDATE로 넣는다.
-- ════════════════════════════════════════════════════════════════════════

-- 1. 컬럼 추가 ----------------------------------------------------------
alter table public.beat_songs
  add column if not exists source_type        text        not null default 'hosted',
  add column if not exists youtube_id         text,
  add column if not exists yt_offset_ms       integer     not null default 0,
  add column if not exists yt_duration_ms     integer,
  add column if not exists has_ads            boolean,
  add column if not exists audio_hash         text,
  add column if not exists original_declared  boolean     not null default false,
  add column if not exists terms_version      text,
  add column if not exists terms_agreed_at    timestamptz;

-- youtube/local 곡은 서버 음원이 없으므로 NOT NULL 해제
alter table public.beat_songs
  alter column audio_storage_path drop not null;

-- 2. 값 형식 제약 (기존 행에 영향 없음) ----------------------------------
alter table public.beat_songs
  add constraint beat_songs_source_type_check
    check (source_type in ('youtube', 'local', 'hosted')),
  add constraint beat_songs_youtube_id_format_check
    check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  add constraint beat_songs_yt_duration_check
    check (yt_duration_ms is null or yt_duration_ms > 0);

create index if not exists beat_songs_youtube_id_idx
  on public.beat_songs (youtube_id) where youtube_id is not null;

-- 3. 신규 업로드 차단 트리거 -------------------------------------------
--    CHECK 제약은 기존(legacy hosted) 행을 수정할 때도 걸려서 쓸 수 없으므로 트리거로 구현.
create or replace function public.beat_songs_enforce_music_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _check boolean;
begin
  if tg_op = 'INSERT' then
    _check := true;
  else
    _check := (NEW.source_type, NEW.youtube_id, NEW.audio_storage_path, NEW.original_declared)
              is distinct from
              (OLD.source_type, OLD.youtube_id, OLD.audio_storage_path, OLD.original_declared);
  end if;

  if not _check then
    return NEW;   -- 음원 관련 변경 없음 (legacy 곡의 메타 수정 등)
  end if;

  if NEW.source_type = 'youtube' then
    if NEW.youtube_id is null then
      raise exception 'YouTube 링크가 필요합니다.'
        using errcode = 'check_violation';
    end if;
    if NEW.audio_storage_path is not null then
      raise exception 'youtube 곡은 서버에 음원 파일을 둘 수 없습니다.'
        using errcode = 'check_violation';
    end if;

  elsif NEW.source_type = 'local' then
    if NEW.audio_storage_path is not null then
      raise exception 'local 곡은 서버에 음원 파일을 둘 수 없습니다.'
        using errcode = 'check_violation';
    end if;

  elsif NEW.source_type = 'hosted' then
    if NEW.original_declared is not true then
      raise exception '서버 호스팅은 창작곡 선언이 필요합니다. YouTube 링크를 사용하세요.'
        using errcode = 'check_violation';
    end if;
    if NEW.terms_version is null or length(btrim(NEW.terms_version)) = 0 then
      raise exception '이용약관 동의가 필요합니다.'
        using errcode = 'check_violation';
    end if;
    if NEW.audio_storage_path is null then
      raise exception 'hosted 곡에는 음원 파일 경로가 필요합니다.'
        using errcode = 'check_violation';
    end if;
    -- 동의 시각은 서버 시계로 기록 (클라이언트 값 무시)
    if tg_op = 'INSERT' or OLD.original_declared is distinct from true then
      NEW.terms_agreed_at := now();
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_beat_songs_enforce_music_source on public.beat_songs;
create trigger trg_beat_songs_enforce_music_source
  before insert or update on public.beat_songs
  for each row execute function public.beat_songs_enforce_music_source();

-- ════════════════════════════════════════════════════════════════════════
-- 롤백(필요 시):
--   drop trigger trg_beat_songs_enforce_music_source on public.beat_songs;
--   drop function public.beat_songs_enforce_music_source();
--   alter table public.beat_songs drop column source_type, drop column youtube_id, ...;
--   (audio_storage_path NOT NULL 복구는 youtube/local 행이 없을 때만 가능)
-- ════════════════════════════════════════════════════════════════════════