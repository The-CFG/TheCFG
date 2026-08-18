-- TheBeat "플레이" 탭의 여러 설정(게임플레이 이미지 표시, 레인 배경, 하이라이트,
-- 판정 보정 등)을 계정에 저장하기 위한 컬럼.
--
-- 기존 beat_music_volume / beat_sfx_volume처럼 값마다 컬럼을 새로 만들면 설정이
-- 늘어날 때마다 매번 스키마 마이그레이션이 필요해지므로, jsonb 한 컬럼에 객체
-- 형태로 묶어서 저장한다. HOI4Editor가 이미 쓰고 있는 user_profiles.settings
-- 컬럼과는 이름이 겹치지 않도록 beat_settings로 분리한다(같은 Supabase 프로젝트를
-- HOI4Editor와 공유하기 때문).
alter table "public"."user_profiles"
    add column if not exists "beat_settings" jsonb not null default '{}'::jsonb;
