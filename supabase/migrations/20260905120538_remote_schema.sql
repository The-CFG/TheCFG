drop function if exists "public"."get_profile_header"(p_user_id uuid);

alter table "public"."user_profiles" add column "bio" text;

alter table "public"."user_profiles" add constraint "user_profiles_bio_length" CHECK ((char_length(bio) <= 200)) not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_bio_length";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.beat_charts_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_song_owner(_song_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select owner_id from beat_songs where id = _song_id;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_song_role(_song_id uuid, _user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when (select owner_id from beat_songs where id = _song_id) = _user_id then 'owner'
    else (select role from beat_song_members
          where song_id = _song_id and member_id = _user_id)
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_nicknames_by_ids(user_ids uuid[])
 RETURNS TABLE(user_id uuid, nickname text, handle text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id, u.raw_user_meta_data->>'display_name', p.handle
  from auth.users u
  left join public.user_profiles p on p.user_id = u.id
  where u.id = any(user_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_beat_highest(p_user_id uuid)
 RETURNS TABLE(title text, difficulty_label text, difficulty_score real)
 LANGUAGE sql
AS $function$
  select c.title, c.difficulty_label, c.difficulty_score
  from public.beat_scores s
  join public.beat_charts c on c.id = s.chart_id
  where s.user_id = p_user_id
  order by c.difficulty_score desc nulls last
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_collab_projects(p_user_id uuid)
 RETURNS TABLE(project_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pm.project_name
  from public.project_members pm
  where pm.member_id = p_user_id
  order by pm.joined_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_header(p_user_id uuid)
 RETURNS TABLE(user_id uuid, nickname text, handle text, bio text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id, u.raw_user_meta_data->>'display_name', p.handle, p.bio, u.created_at
  from auth.users u
  join public.user_profiles p on p.user_id = u.id
  where u.id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_own_projects(p_user_id uuid)
 RETURNS TABLE(name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select name from public.projects
  where user_id = p_user_id order by updated_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_id_by_handle(p_handle text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select user_id from public.user_profiles where lower(handle) = lower(p_handle) limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.is_handle_available(p_handle text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not exists (
    select 1 from public.user_profiles where lower(handle) = lower(p_handle)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_room_member(_room_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from beat_room_players
    where room_id = _room_id and user_id = _user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.record_chart_contribution(_chart_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into beat_chart_contributors (chart_id, user_id, first_edited_at, last_edited_at)
  values (_chart_id, auth.uid(), now(), now())
  on conflict (chart_id, user_id)
  do update set last_edited_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_score(p_chart_id uuid, p_score integer, p_accuracy numeric, p_max_combo integer, p_judge_perfect integer DEFAULT NULL::integer, p_judge_good integer DEFAULT NULL::integer, p_judge_miss integer DEFAULT NULL::integer)
 RETURNS TABLE(is_new_best boolean, best_score integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id  uuid := auth.uid();
    v_existing int;
begin
    if v_user_id is null then
        raise exception '로그인이 필요합니다.';
    end if;

    select score into v_existing
    from beat_scores
    where chart_id = p_chart_id and user_id = v_user_id;

    update beat_charts set play_count = play_count + 1 where id = p_chart_id;

    if v_existing is null then
        insert into beat_scores (chart_id, user_id, score, accuracy, max_combo, judge_perfect, judge_good, judge_miss)
        values (p_chart_id, v_user_id, p_score, p_accuracy, p_max_combo, p_judge_perfect, p_judge_good, p_judge_miss);
        return query select true, p_score;

    elsif p_score > v_existing then
        update beat_scores
        set score = p_score, accuracy = p_accuracy, max_combo = p_max_combo,
            judge_perfect = p_judge_perfect, judge_good = p_judge_good, judge_miss = p_judge_miss,
            achieved_at = now()
        where chart_id = p_chart_id and user_id = v_user_id;
        return query select true, p_score;

    else
        return query select false, v_existing;
    end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_beat_room_player_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'INSERT' then
    update beat_rooms set player_count = player_count + 1 where id = new.room_id;
  elsif TG_OP = 'DELETE' then
    update beat_rooms set player_count = greatest(player_count - 1, 0) where id = old.room_id;
  end if;
  return null;
end;
$function$
;

grant delete on table "public"."beat_chart_contributors" to "anon";

grant insert on table "public"."beat_chart_contributors" to "anon";

grant select on table "public"."beat_chart_contributors" to "anon";

grant update on table "public"."beat_chart_contributors" to "anon";

grant delete on table "public"."beat_chart_contributors" to "authenticated";

grant insert on table "public"."beat_chart_contributors" to "authenticated";

grant select on table "public"."beat_chart_contributors" to "authenticated";

grant update on table "public"."beat_chart_contributors" to "authenticated";

grant delete on table "public"."beat_chart_contributors" to "service_role";

grant insert on table "public"."beat_chart_contributors" to "service_role";

grant select on table "public"."beat_chart_contributors" to "service_role";

grant update on table "public"."beat_chart_contributors" to "service_role";

grant delete on table "public"."beat_room_passwords" to "service_role";

grant insert on table "public"."beat_room_passwords" to "service_role";

grant select on table "public"."beat_room_passwords" to "service_role";

grant update on table "public"."beat_room_passwords" to "service_role";

grant delete on table "public"."beat_song_invites" to "anon";

grant insert on table "public"."beat_song_invites" to "anon";

grant select on table "public"."beat_song_invites" to "anon";

grant update on table "public"."beat_song_invites" to "anon";

grant delete on table "public"."beat_song_invites" to "authenticated";

grant insert on table "public"."beat_song_invites" to "authenticated";

grant select on table "public"."beat_song_invites" to "authenticated";

grant update on table "public"."beat_song_invites" to "authenticated";

grant delete on table "public"."beat_song_invites" to "service_role";

grant insert on table "public"."beat_song_invites" to "service_role";

grant select on table "public"."beat_song_invites" to "service_role";

grant update on table "public"."beat_song_invites" to "service_role";

grant delete on table "public"."beat_song_members" to "anon";

grant insert on table "public"."beat_song_members" to "anon";

grant select on table "public"."beat_song_members" to "anon";

grant update on table "public"."beat_song_members" to "anon";

grant delete on table "public"."beat_song_members" to "authenticated";

grant insert on table "public"."beat_song_members" to "authenticated";

grant select on table "public"."beat_song_members" to "authenticated";

grant update on table "public"."beat_song_members" to "authenticated";

grant delete on table "public"."beat_song_members" to "service_role";

grant insert on table "public"."beat_song_members" to "service_role";

grant select on table "public"."beat_song_members" to "service_role";

grant update on table "public"."beat_song_members" to "service_role";


