-- ════════════════════════════════════════════════
-- get_nicknames_by_ids에 handle 컬럼 추가
-- TheBeat/HOI4Editor 쪽 닉네임 표시 부분에서 /profiles?u=핸들 링크를
-- 만들 때 별도 RPC 없이 기존 호출에 얹어서 함께 받아오기 위함
-- (5-5: beat/hoi4 쪽 링크 연결)
-- ════════════════════════════════════════════════

drop function if exists public.get_nicknames_by_ids(uuid[]);

create or replace function public.get_nicknames_by_ids(user_ids uuid[])
returns table(user_id uuid, nickname text, handle text)
language sql security definer set search_path to 'public'
as $$
  select u.id, u.raw_user_meta_data->>'display_name', p.handle
  from auth.users u
  left join public.user_profiles p on p.user_id = u.id
  where u.id = any(user_ids);
$$;
