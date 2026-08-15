create extension if not exists "pg_cron" with schema "pg_catalog";

drop extension if exists "pg_net";


  create table "public"."beat_chart_likes" (
    "chart_id" uuid not null,
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."beat_chart_likes" enable row level security;


  create table "public"."beat_charts" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "title" text not null,
    "artist" text,
    "bpm" numeric,
    "lane_count" integer not null default 4,
    "difficulty_label" text,
    "duration_seconds" numeric,
    "note_count" integer not null default 0,
    "chart_storage_path" text not null,
    "chart_file_size_bytes" integer,
    "audio_storage_path" text,
    "audio_mime" text,
    "is_public" boolean not null default true,
    "play_count" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "song_id" uuid not null,
    "note_speed" real,
    "difficulty_score" real,
    "sort_order" integer,
    "use_custom_fall_speed" boolean not null default false
      );


alter table "public"."beat_charts" enable row level security;


  create table "public"."beat_room_players" (
    "room_id" uuid not null,
    "user_id" uuid not null,
    "nickname" text,
    "joined_at" timestamp with time zone not null default now(),
    "ready" boolean not null default false,
    "final_score" integer,
    "final_combo" integer
      );


alter table "public"."beat_room_players" enable row level security;


  create table "public"."beat_rooms" (
    "id" uuid not null default gen_random_uuid(),
    "chart_id" uuid not null,
    "host_id" uuid not null,
    "status" text not null default 'waiting'::text,
    "started_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "max_players" smallint not null default 8,
    "invite_code" text default public.generate_invite_code(),
    "chart_queue" jsonb not null default '[]'::jsonb
      );


alter table "public"."beat_rooms" enable row level security;


  create table "public"."beat_scores" (
    "id" uuid not null default gen_random_uuid(),
    "chart_id" uuid not null,
    "user_id" uuid not null,
    "score" integer not null,
    "accuracy" numeric(5,2),
    "max_combo" integer,
    "judge_perfect" integer,
    "judge_good" integer,
    "judge_miss" integer,
    "achieved_at" timestamp with time zone not null default now(),
    "judge_bad" integer
      );


alter table "public"."beat_scores" enable row level security;


  create table "public"."beat_songs" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "title" text not null,
    "artist" text,
    "audio_storage_path" text not null,
    "audio_mime" text,
    "is_public" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "preview_start_ms" integer not null default 0,
    "start_offset_ms" integer default 0,
    "cover_storage_path" text,
    "timing_start_ms" integer not null default 0
      );


alter table "public"."beat_songs" enable row level security;


  create table "public"."project_files" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "project_name" text not null,
    "file_path" text not null,
    "file_type" text not null,
    "content" text,
    "storage_path" text,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."project_files" enable row level security;


  create table "public"."project_invites" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "project_name" text not null,
    "invited_email" text not null,
    "role" text not null,
    "status" text not null default 'pending'::text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."project_invites" enable row level security;


  create table "public"."project_members" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "project_name" text not null,
    "member_id" uuid not null,
    "role" text not null,
    "joined_at" timestamp with time zone default now()
      );


alter table "public"."project_members" enable row level security;


  create table "public"."projects" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "name" text not null,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."projects" enable row level security;


  create table "public"."user_profiles" (
    "user_id" uuid not null,
    "settings" jsonb default '{}'::jsonb,
    "updated_at" timestamp with time zone default now(),
    "beat_music_volume" smallint not null default 100,
    "beat_sfx_volume" smallint not null default 100
      );


alter table "public"."user_profiles" enable row level security;

CREATE UNIQUE INDEX beat_chart_likes_pkey ON public.beat_chart_likes USING btree (chart_id, user_id);

CREATE UNIQUE INDEX beat_charts_pkey ON public.beat_charts USING btree (id);

CREATE UNIQUE INDEX beat_room_players_pkey ON public.beat_room_players USING btree (room_id, user_id);

CREATE UNIQUE INDEX beat_rooms_invite_code_key ON public.beat_rooms USING btree (invite_code);

CREATE UNIQUE INDEX beat_rooms_pkey ON public.beat_rooms USING btree (id);

CREATE UNIQUE INDEX beat_scores_chart_id_user_id_key ON public.beat_scores USING btree (chart_id, user_id);

CREATE UNIQUE INDEX beat_scores_pkey ON public.beat_scores USING btree (id);

CREATE UNIQUE INDEX beat_songs_pkey ON public.beat_songs USING btree (id);

CREATE INDEX idx_beat_charts_owner ON public.beat_charts USING btree (owner_id);

CREATE INDEX idx_beat_charts_public_created ON public.beat_charts USING btree (is_public, created_at DESC);

CREATE INDEX idx_beat_charts_public_playcount ON public.beat_charts USING btree (is_public, play_count DESC);

CREATE INDEX idx_beat_scores_chart_rank ON public.beat_scores USING btree (chart_id, score DESC);

CREATE UNIQUE INDEX project_files_pkey ON public.project_files USING btree (id);

CREATE UNIQUE INDEX project_files_user_id_project_name_file_path_key ON public.project_files USING btree (user_id, project_name, file_path);

CREATE UNIQUE INDEX project_invites_owner_id_project_name_invited_email_key ON public.project_invites USING btree (owner_id, project_name, invited_email);

CREATE UNIQUE INDEX project_invites_pkey ON public.project_invites USING btree (id);

CREATE UNIQUE INDEX project_members_owner_id_project_name_member_id_key ON public.project_members USING btree (owner_id, project_name, member_id);

CREATE UNIQUE INDEX project_members_pkey ON public.project_members USING btree (id);

CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id);

CREATE UNIQUE INDEX projects_user_id_name_key ON public.projects USING btree (user_id, name);

CREATE UNIQUE INDEX user_profiles_pkey ON public.user_profiles USING btree (user_id);

alter table "public"."beat_chart_likes" add constraint "beat_chart_likes_pkey" PRIMARY KEY using index "beat_chart_likes_pkey";

alter table "public"."beat_charts" add constraint "beat_charts_pkey" PRIMARY KEY using index "beat_charts_pkey";

alter table "public"."beat_room_players" add constraint "beat_room_players_pkey" PRIMARY KEY using index "beat_room_players_pkey";

alter table "public"."beat_rooms" add constraint "beat_rooms_pkey" PRIMARY KEY using index "beat_rooms_pkey";

alter table "public"."beat_scores" add constraint "beat_scores_pkey" PRIMARY KEY using index "beat_scores_pkey";

alter table "public"."beat_songs" add constraint "beat_songs_pkey" PRIMARY KEY using index "beat_songs_pkey";

alter table "public"."project_files" add constraint "project_files_pkey" PRIMARY KEY using index "project_files_pkey";

alter table "public"."project_invites" add constraint "project_invites_pkey" PRIMARY KEY using index "project_invites_pkey";

alter table "public"."project_members" add constraint "project_members_pkey" PRIMARY KEY using index "project_members_pkey";

alter table "public"."projects" add constraint "projects_pkey" PRIMARY KEY using index "projects_pkey";

alter table "public"."user_profiles" add constraint "user_profiles_pkey" PRIMARY KEY using index "user_profiles_pkey";

alter table "public"."beat_chart_likes" add constraint "beat_chart_likes_chart_id_fkey" FOREIGN KEY (chart_id) REFERENCES public.beat_charts(id) ON DELETE CASCADE not valid;

alter table "public"."beat_chart_likes" validate constraint "beat_chart_likes_chart_id_fkey";

alter table "public"."beat_chart_likes" add constraint "beat_chart_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."beat_chart_likes" validate constraint "beat_chart_likes_user_id_fkey";

alter table "public"."beat_charts" add constraint "beat_charts_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."beat_charts" validate constraint "beat_charts_owner_id_fkey";

alter table "public"."beat_charts" add constraint "beat_charts_song_id_fkey" FOREIGN KEY (song_id) REFERENCES public.beat_songs(id) ON DELETE CASCADE not valid;

alter table "public"."beat_charts" validate constraint "beat_charts_song_id_fkey";

alter table "public"."beat_room_players" add constraint "beat_room_players_room_id_fkey" FOREIGN KEY (room_id) REFERENCES public.beat_rooms(id) ON DELETE CASCADE not valid;

alter table "public"."beat_room_players" validate constraint "beat_room_players_room_id_fkey";

alter table "public"."beat_room_players" add constraint "beat_room_players_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."beat_room_players" validate constraint "beat_room_players_user_id_fkey";

alter table "public"."beat_rooms" add constraint "beat_rooms_chart_id_fkey" FOREIGN KEY (chart_id) REFERENCES public.beat_charts(id) ON DELETE CASCADE not valid;

alter table "public"."beat_rooms" validate constraint "beat_rooms_chart_id_fkey";

alter table "public"."beat_rooms" add constraint "beat_rooms_host_id_fkey" FOREIGN KEY (host_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."beat_rooms" validate constraint "beat_rooms_host_id_fkey";

alter table "public"."beat_rooms" add constraint "beat_rooms_invite_code_key" UNIQUE using index "beat_rooms_invite_code_key";

alter table "public"."beat_rooms" add constraint "beat_rooms_status_check" CHECK ((status = ANY (ARRAY['waiting'::text, 'countdown'::text, 'playing'::text, 'finished'::text]))) not valid;

alter table "public"."beat_rooms" validate constraint "beat_rooms_status_check";

alter table "public"."beat_scores" add constraint "beat_scores_chart_id_fkey" FOREIGN KEY (chart_id) REFERENCES public.beat_charts(id) ON DELETE CASCADE not valid;

alter table "public"."beat_scores" validate constraint "beat_scores_chart_id_fkey";

alter table "public"."beat_scores" add constraint "beat_scores_chart_id_user_id_key" UNIQUE using index "beat_scores_chart_id_user_id_key";

alter table "public"."beat_scores" add constraint "beat_scores_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."beat_scores" validate constraint "beat_scores_user_id_fkey";

alter table "public"."beat_songs" add constraint "beat_songs_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."beat_songs" validate constraint "beat_songs_owner_id_fkey";

alter table "public"."project_files" add constraint "project_files_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."project_files" validate constraint "project_files_user_id_fkey";

alter table "public"."project_files" add constraint "project_files_user_id_project_name_file_path_key" UNIQUE using index "project_files_user_id_project_name_file_path_key";

alter table "public"."project_invites" add constraint "project_invites_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."project_invites" validate constraint "project_invites_owner_id_fkey";

alter table "public"."project_invites" add constraint "project_invites_owner_id_fkey2" FOREIGN KEY (owner_id) REFERENCES public.user_profiles(user_id) not valid;

alter table "public"."project_invites" validate constraint "project_invites_owner_id_fkey2";

alter table "public"."project_invites" add constraint "project_invites_owner_id_project_name_invited_email_key" UNIQUE using index "project_invites_owner_id_project_name_invited_email_key";

alter table "public"."project_invites" add constraint "project_invites_role_check" CHECK ((role = ANY (ARRAY['editor'::text, 'viewer'::text]))) not valid;

alter table "public"."project_invites" validate constraint "project_invites_role_check";

alter table "public"."project_invites" add constraint "project_invites_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))) not valid;

alter table "public"."project_invites" validate constraint "project_invites_status_check";

alter table "public"."project_members" add constraint "project_members_member_id_fkey" FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."project_members" validate constraint "project_members_member_id_fkey";

alter table "public"."project_members" add constraint "project_members_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."project_members" validate constraint "project_members_owner_id_fkey";

alter table "public"."project_members" add constraint "project_members_owner_id_fkey2" FOREIGN KEY (owner_id) REFERENCES public.user_profiles(user_id) not valid;

alter table "public"."project_members" validate constraint "project_members_owner_id_fkey2";

alter table "public"."project_members" add constraint "project_members_owner_id_project_name_member_id_key" UNIQUE using index "project_members_owner_id_project_name_member_id_key";

alter table "public"."project_members" add constraint "project_members_project_fkey" FOREIGN KEY (owner_id, project_name) REFERENCES public.projects(user_id, name) ON DELETE CASCADE not valid;

alter table "public"."project_members" validate constraint "project_members_project_fkey";

alter table "public"."project_members" add constraint "project_members_role_check" CHECK ((role = ANY (ARRAY['editor'::text, 'viewer'::text]))) not valid;

alter table "public"."project_members" validate constraint "project_members_role_check";

alter table "public"."projects" add constraint "projects_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."projects" validate constraint "projects_user_id_fkey";

alter table "public"."projects" add constraint "projects_user_id_name_key" UNIQUE using index "projects_user_id_name_key";

alter table "public"."user_profiles" add constraint "user_profiles_beat_music_volume_check" CHECK (((beat_music_volume >= 0) AND (beat_music_volume <= 100))) not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_beat_music_volume_check";

alter table "public"."user_profiles" add constraint "user_profiles_beat_sfx_volume_check" CHECK (((beat_sfx_volume >= 0) AND (beat_sfx_volume <= 100))) not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_beat_sfx_volume_check";

alter table "public"."user_profiles" add constraint "user_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.accept_project_invite(invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    inv project_invites%rowtype;
BEGIN
    SELECT * INTO inv
    FROM project_invites
    WHERE id = invite_id
      AND status = 'pending'
      AND invited_email = auth.email();

    IF NOT FOUND THEN
        RAISE EXCEPTION '유효하지 않은 초대이거나 이미 처리된 초대입니다.';
    END IF;

    INSERT INTO project_members (owner_id, project_name, member_id, role)
    VALUES (inv.owner_id, inv.project_name, auth.uid(), inv.role)
    ON CONFLICT (owner_id, project_name, member_id)
    DO UPDATE SET role = excluded.role;

    UPDATE project_invites
    SET status = 'accepted'
    WHERE id = invite_id;
END;
$function$
;

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

CREATE OR REPLACE FUNCTION public.cleanup_stale_beat_rooms()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from beat_room_players
  where room_id in (
    select id from beat_rooms
    where status in ('waiting', 'abandoned')
      and created_at < now() - interval '30 minutes'
  );

  delete from beat_rooms
  where status in ('waiting', 'abandoned')
    and created_at < now() - interval '30 minutes';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_user()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
    delete from auth.users where id = auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_invite_code()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 헷갈리는 문자(0,O,1,I) 제외
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_nicknames_by_ids(user_ids uuid[])
 RETURNS TABLE(user_id uuid, nickname text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id as user_id, raw_user_meta_data->>'display_name' as nickname
  from auth.users
  where id = any(user_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    insert into public.user_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
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

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.room_has_space(_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (
    select count(*) from beat_room_players where room_id = _room_id
  ) < (
    select max_players from beat_rooms where id = _room_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.set_invite_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.invite_code is null then
    new.invite_code := generate_invite_code();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_score(p_chart_id uuid, p_score integer, p_accuracy numeric, p_max_combo integer, p_judge_perfect integer DEFAULT NULL::integer, p_judge_good integer DEFAULT NULL::integer, p_judge_bad integer DEFAULT NULL::integer, p_judge_miss integer DEFAULT NULL::integer)
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
        insert into beat_scores (chart_id, user_id, score, accuracy, max_combo, judge_perfect, judge_good, judge_bad, judge_miss)
        values (p_chart_id, v_user_id, p_score, p_accuracy, p_max_combo, p_judge_perfect, p_judge_good, p_judge_bad, p_judge_miss);
        return query select true, p_score;
    elsif p_score > v_existing then
        update beat_scores
        set score = p_score, accuracy = p_accuracy, max_combo = p_max_combo,
            judge_perfect = p_judge_perfect, judge_good = p_judge_good, judge_bad = p_judge_bad, judge_miss = p_judge_miss,
            achieved_at = now()
        where chart_id = p_chart_id and user_id = v_user_id;
        return query select true, p_score;
    else
        return query select false, v_existing;
    end if;
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

CREATE OR REPLACE FUNCTION public.transfer_host(_room_id uuid, _new_host_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update beat_rooms
  set host_id = _new_host_id
  where id = _room_id and status = 'waiting';
$function$
;

grant delete on table "public"."beat_chart_likes" to "anon";

grant insert on table "public"."beat_chart_likes" to "anon";

grant references on table "public"."beat_chart_likes" to "anon";

grant select on table "public"."beat_chart_likes" to "anon";

grant trigger on table "public"."beat_chart_likes" to "anon";

grant truncate on table "public"."beat_chart_likes" to "anon";

grant update on table "public"."beat_chart_likes" to "anon";

grant delete on table "public"."beat_chart_likes" to "authenticated";

grant insert on table "public"."beat_chart_likes" to "authenticated";

grant references on table "public"."beat_chart_likes" to "authenticated";

grant select on table "public"."beat_chart_likes" to "authenticated";

grant trigger on table "public"."beat_chart_likes" to "authenticated";

grant truncate on table "public"."beat_chart_likes" to "authenticated";

grant update on table "public"."beat_chart_likes" to "authenticated";

grant delete on table "public"."beat_chart_likes" to "service_role";

grant insert on table "public"."beat_chart_likes" to "service_role";

grant references on table "public"."beat_chart_likes" to "service_role";

grant select on table "public"."beat_chart_likes" to "service_role";

grant trigger on table "public"."beat_chart_likes" to "service_role";

grant truncate on table "public"."beat_chart_likes" to "service_role";

grant update on table "public"."beat_chart_likes" to "service_role";

grant delete on table "public"."beat_charts" to "anon";

grant insert on table "public"."beat_charts" to "anon";

grant references on table "public"."beat_charts" to "anon";

grant select on table "public"."beat_charts" to "anon";

grant trigger on table "public"."beat_charts" to "anon";

grant truncate on table "public"."beat_charts" to "anon";

grant update on table "public"."beat_charts" to "anon";

grant delete on table "public"."beat_charts" to "authenticated";

grant insert on table "public"."beat_charts" to "authenticated";

grant references on table "public"."beat_charts" to "authenticated";

grant select on table "public"."beat_charts" to "authenticated";

grant trigger on table "public"."beat_charts" to "authenticated";

grant truncate on table "public"."beat_charts" to "authenticated";

grant update on table "public"."beat_charts" to "authenticated";

grant delete on table "public"."beat_charts" to "service_role";

grant insert on table "public"."beat_charts" to "service_role";

grant references on table "public"."beat_charts" to "service_role";

grant select on table "public"."beat_charts" to "service_role";

grant trigger on table "public"."beat_charts" to "service_role";

grant truncate on table "public"."beat_charts" to "service_role";

grant update on table "public"."beat_charts" to "service_role";

grant delete on table "public"."beat_room_players" to "anon";

grant insert on table "public"."beat_room_players" to "anon";

grant references on table "public"."beat_room_players" to "anon";

grant select on table "public"."beat_room_players" to "anon";

grant trigger on table "public"."beat_room_players" to "anon";

grant truncate on table "public"."beat_room_players" to "anon";

grant update on table "public"."beat_room_players" to "anon";

grant delete on table "public"."beat_room_players" to "authenticated";

grant insert on table "public"."beat_room_players" to "authenticated";

grant references on table "public"."beat_room_players" to "authenticated";

grant select on table "public"."beat_room_players" to "authenticated";

grant trigger on table "public"."beat_room_players" to "authenticated";

grant truncate on table "public"."beat_room_players" to "authenticated";

grant update on table "public"."beat_room_players" to "authenticated";

grant delete on table "public"."beat_room_players" to "service_role";

grant insert on table "public"."beat_room_players" to "service_role";

grant references on table "public"."beat_room_players" to "service_role";

grant select on table "public"."beat_room_players" to "service_role";

grant trigger on table "public"."beat_room_players" to "service_role";

grant truncate on table "public"."beat_room_players" to "service_role";

grant update on table "public"."beat_room_players" to "service_role";

grant delete on table "public"."beat_rooms" to "anon";

grant insert on table "public"."beat_rooms" to "anon";

grant references on table "public"."beat_rooms" to "anon";

grant select on table "public"."beat_rooms" to "anon";

grant trigger on table "public"."beat_rooms" to "anon";

grant truncate on table "public"."beat_rooms" to "anon";

grant update on table "public"."beat_rooms" to "anon";

grant delete on table "public"."beat_rooms" to "authenticated";

grant insert on table "public"."beat_rooms" to "authenticated";

grant references on table "public"."beat_rooms" to "authenticated";

grant select on table "public"."beat_rooms" to "authenticated";

grant trigger on table "public"."beat_rooms" to "authenticated";

grant truncate on table "public"."beat_rooms" to "authenticated";

grant update on table "public"."beat_rooms" to "authenticated";

grant delete on table "public"."beat_rooms" to "service_role";

grant insert on table "public"."beat_rooms" to "service_role";

grant references on table "public"."beat_rooms" to "service_role";

grant select on table "public"."beat_rooms" to "service_role";

grant trigger on table "public"."beat_rooms" to "service_role";

grant truncate on table "public"."beat_rooms" to "service_role";

grant update on table "public"."beat_rooms" to "service_role";

grant delete on table "public"."beat_scores" to "anon";

grant insert on table "public"."beat_scores" to "anon";

grant references on table "public"."beat_scores" to "anon";

grant select on table "public"."beat_scores" to "anon";

grant trigger on table "public"."beat_scores" to "anon";

grant truncate on table "public"."beat_scores" to "anon";

grant update on table "public"."beat_scores" to "anon";

grant delete on table "public"."beat_scores" to "authenticated";

grant insert on table "public"."beat_scores" to "authenticated";

grant references on table "public"."beat_scores" to "authenticated";

grant select on table "public"."beat_scores" to "authenticated";

grant trigger on table "public"."beat_scores" to "authenticated";

grant truncate on table "public"."beat_scores" to "authenticated";

grant update on table "public"."beat_scores" to "authenticated";

grant delete on table "public"."beat_scores" to "service_role";

grant insert on table "public"."beat_scores" to "service_role";

grant references on table "public"."beat_scores" to "service_role";

grant select on table "public"."beat_scores" to "service_role";

grant trigger on table "public"."beat_scores" to "service_role";

grant truncate on table "public"."beat_scores" to "service_role";

grant update on table "public"."beat_scores" to "service_role";

grant delete on table "public"."beat_songs" to "anon";

grant insert on table "public"."beat_songs" to "anon";

grant references on table "public"."beat_songs" to "anon";

grant select on table "public"."beat_songs" to "anon";

grant trigger on table "public"."beat_songs" to "anon";

grant truncate on table "public"."beat_songs" to "anon";

grant update on table "public"."beat_songs" to "anon";

grant delete on table "public"."beat_songs" to "authenticated";

grant insert on table "public"."beat_songs" to "authenticated";

grant references on table "public"."beat_songs" to "authenticated";

grant select on table "public"."beat_songs" to "authenticated";

grant trigger on table "public"."beat_songs" to "authenticated";

grant truncate on table "public"."beat_songs" to "authenticated";

grant update on table "public"."beat_songs" to "authenticated";

grant delete on table "public"."beat_songs" to "service_role";

grant insert on table "public"."beat_songs" to "service_role";

grant references on table "public"."beat_songs" to "service_role";

grant select on table "public"."beat_songs" to "service_role";

grant trigger on table "public"."beat_songs" to "service_role";

grant truncate on table "public"."beat_songs" to "service_role";

grant update on table "public"."beat_songs" to "service_role";

grant delete on table "public"."project_files" to "anon";

grant insert on table "public"."project_files" to "anon";

grant references on table "public"."project_files" to "anon";

grant select on table "public"."project_files" to "anon";

grant trigger on table "public"."project_files" to "anon";

grant truncate on table "public"."project_files" to "anon";

grant update on table "public"."project_files" to "anon";

grant delete on table "public"."project_files" to "authenticated";

grant insert on table "public"."project_files" to "authenticated";

grant references on table "public"."project_files" to "authenticated";

grant select on table "public"."project_files" to "authenticated";

grant trigger on table "public"."project_files" to "authenticated";

grant truncate on table "public"."project_files" to "authenticated";

grant update on table "public"."project_files" to "authenticated";

grant delete on table "public"."project_files" to "service_role";

grant insert on table "public"."project_files" to "service_role";

grant references on table "public"."project_files" to "service_role";

grant select on table "public"."project_files" to "service_role";

grant trigger on table "public"."project_files" to "service_role";

grant truncate on table "public"."project_files" to "service_role";

grant update on table "public"."project_files" to "service_role";

grant delete on table "public"."project_invites" to "anon";

grant insert on table "public"."project_invites" to "anon";

grant references on table "public"."project_invites" to "anon";

grant select on table "public"."project_invites" to "anon";

grant trigger on table "public"."project_invites" to "anon";

grant truncate on table "public"."project_invites" to "anon";

grant update on table "public"."project_invites" to "anon";

grant delete on table "public"."project_invites" to "authenticated";

grant insert on table "public"."project_invites" to "authenticated";

grant references on table "public"."project_invites" to "authenticated";

grant select on table "public"."project_invites" to "authenticated";

grant trigger on table "public"."project_invites" to "authenticated";

grant truncate on table "public"."project_invites" to "authenticated";

grant update on table "public"."project_invites" to "authenticated";

grant delete on table "public"."project_invites" to "service_role";

grant insert on table "public"."project_invites" to "service_role";

grant references on table "public"."project_invites" to "service_role";

grant select on table "public"."project_invites" to "service_role";

grant trigger on table "public"."project_invites" to "service_role";

grant truncate on table "public"."project_invites" to "service_role";

grant update on table "public"."project_invites" to "service_role";

grant delete on table "public"."project_members" to "anon";

grant insert on table "public"."project_members" to "anon";

grant references on table "public"."project_members" to "anon";

grant select on table "public"."project_members" to "anon";

grant trigger on table "public"."project_members" to "anon";

grant truncate on table "public"."project_members" to "anon";

grant update on table "public"."project_members" to "anon";

grant delete on table "public"."project_members" to "authenticated";

grant insert on table "public"."project_members" to "authenticated";

grant references on table "public"."project_members" to "authenticated";

grant select on table "public"."project_members" to "authenticated";

grant trigger on table "public"."project_members" to "authenticated";

grant truncate on table "public"."project_members" to "authenticated";

grant update on table "public"."project_members" to "authenticated";

grant delete on table "public"."project_members" to "service_role";

grant insert on table "public"."project_members" to "service_role";

grant references on table "public"."project_members" to "service_role";

grant select on table "public"."project_members" to "service_role";

grant trigger on table "public"."project_members" to "service_role";

grant truncate on table "public"."project_members" to "service_role";

grant update on table "public"."project_members" to "service_role";

grant delete on table "public"."projects" to "anon";

grant insert on table "public"."projects" to "anon";

grant references on table "public"."projects" to "anon";

grant select on table "public"."projects" to "anon";

grant trigger on table "public"."projects" to "anon";

grant truncate on table "public"."projects" to "anon";

grant update on table "public"."projects" to "anon";

grant delete on table "public"."projects" to "authenticated";

grant insert on table "public"."projects" to "authenticated";

grant references on table "public"."projects" to "authenticated";

grant select on table "public"."projects" to "authenticated";

grant trigger on table "public"."projects" to "authenticated";

grant truncate on table "public"."projects" to "authenticated";

grant update on table "public"."projects" to "authenticated";

grant delete on table "public"."projects" to "service_role";

grant insert on table "public"."projects" to "service_role";

grant references on table "public"."projects" to "service_role";

grant select on table "public"."projects" to "service_role";

grant trigger on table "public"."projects" to "service_role";

grant truncate on table "public"."projects" to "service_role";

grant update on table "public"."projects" to "service_role";

grant delete on table "public"."user_profiles" to "anon";

grant insert on table "public"."user_profiles" to "anon";

grant references on table "public"."user_profiles" to "anon";

grant select on table "public"."user_profiles" to "anon";

grant trigger on table "public"."user_profiles" to "anon";

grant truncate on table "public"."user_profiles" to "anon";

grant update on table "public"."user_profiles" to "anon";

grant delete on table "public"."user_profiles" to "authenticated";

grant insert on table "public"."user_profiles" to "authenticated";

grant references on table "public"."user_profiles" to "authenticated";

grant select on table "public"."user_profiles" to "authenticated";

grant trigger on table "public"."user_profiles" to "authenticated";

grant truncate on table "public"."user_profiles" to "authenticated";

grant update on table "public"."user_profiles" to "authenticated";

grant delete on table "public"."user_profiles" to "service_role";

grant insert on table "public"."user_profiles" to "service_role";

grant references on table "public"."user_profiles" to "service_role";

grant select on table "public"."user_profiles" to "service_role";

grant trigger on table "public"."user_profiles" to "service_role";

grant truncate on table "public"."user_profiles" to "service_role";

grant update on table "public"."user_profiles" to "service_role";


  create policy "beat_chart_likes_delete"
  on "public"."beat_chart_likes"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "beat_chart_likes_insert"
  on "public"."beat_chart_likes"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "beat_chart_likes_select"
  on "public"."beat_chart_likes"
  as permissive
  for select
  to public
using (true);



  create policy "charts_delete"
  on "public"."beat_charts"
  as permissive
  for delete
  to public
using ((owner_id = auth.uid()));



  create policy "charts_insert"
  on "public"."beat_charts"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = owner_id));



  create policy "charts_select"
  on "public"."beat_charts"
  as permissive
  for select
  to public
using (((is_public = true) OR (owner_id = auth.uid())));



  create policy "charts_update"
  on "public"."beat_charts"
  as permissive
  for update
  to public
using ((owner_id = auth.uid()))
with check ((owner_id = auth.uid()));



  create policy "authenticated can join a room as self"
  on "public"."beat_room_players"
  as permissive
  for insert
  to public
with check (((user_id = ( SELECT auth.uid() AS uid)) AND public.room_has_space(room_id)));



  create policy "host can remove a player from own room"
  on "public"."beat_room_players"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.beat_rooms r
  WHERE ((r.id = beat_room_players.room_id) AND (r.host_id = ( SELECT auth.uid() AS uid))))));



  create policy "host can reset player state in own room"
  on "public"."beat_room_players"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.beat_rooms r
  WHERE ((r.id = beat_room_players.room_id) AND (r.host_id = ( SELECT auth.uid() AS uid))))))
with check (true);



  create policy "player can leave (delete own row)"
  on "public"."beat_room_players"
  as permissive
  for delete
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "player can update own row (ready / final score)"
  on "public"."beat_room_players"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "room members can read player list of their room"
  on "public"."beat_room_players"
  as permissive
  for select
  to public
using (public.is_room_member(room_id, auth.uid()));



  create policy "authenticated can create own room"
  on "public"."beat_rooms"
  as permissive
  for insert
  to authenticated
with check ((( SELECT auth.uid() AS uid) = host_id));



  create policy "authenticated can read waiting rooms or rooms they joined"
  on "public"."beat_rooms"
  as permissive
  for select
  to authenticated
using (((status = 'waiting'::text) OR (host_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.beat_room_players p
  WHERE ((p.room_id = beat_rooms.id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));



  create policy "host can delete own room"
  on "public"."beat_rooms"
  as permissive
  for delete
  to authenticated
using ((host_id = ( SELECT auth.uid() AS uid)));



  create policy "host can update own room"
  on "public"."beat_rooms"
  as permissive
  for update
  to authenticated
using ((host_id = ( SELECT auth.uid() AS uid)))
with check ((host_id = ( SELECT auth.uid() AS uid)));



  create policy "participants can finalize room"
  on "public"."beat_rooms"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.beat_room_players p
  WHERE ((p.room_id = beat_rooms.id) AND (p.user_id = auth.uid())))))
with check ((status = 'finished'::text));



  create policy "scores_select"
  on "public"."beat_scores"
  as permissive
  for select
  to public
using (true);



  create policy "beat_songs_delete_own"
  on "public"."beat_songs"
  as permissive
  for delete
  to public
using ((owner_id = auth.uid()));



  create policy "beat_songs_insert_own"
  on "public"."beat_songs"
  as permissive
  for insert
  to public
with check ((owner_id = auth.uid()));



  create policy "beat_songs_select_own"
  on "public"."beat_songs"
  as permissive
  for select
  to public
using ((owner_id = auth.uid()));



  create policy "beat_songs_select_public"
  on "public"."beat_songs"
  as permissive
  for select
  to public
using ((is_public = true));



  create policy "beat_songs_update_own"
  on "public"."beat_songs"
  as permissive
  for update
  to public
using ((owner_id = auth.uid()))
with check ((owner_id = auth.uid()));



  create policy "files_editor_insert"
  on "public"."project_files"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.project_members
  WHERE ((project_members.owner_id = project_files.user_id) AND (project_members.project_name = project_files.project_name) AND (project_members.member_id = auth.uid()) AND (project_members.role = 'editor'::text)))));



  create policy "files_editor_update"
  on "public"."project_files"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.project_members
  WHERE ((project_members.owner_id = project_files.user_id) AND (project_members.project_name = project_files.project_name) AND (project_members.member_id = auth.uid()) AND (project_members.role = 'editor'::text)))));



  create policy "files_member_select"
  on "public"."project_files"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.project_members
  WHERE ((project_members.owner_id = project_files.user_id) AND (project_members.project_name = project_files.project_name) AND (project_members.member_id = auth.uid())))));



  create policy "files_owner"
  on "public"."project_files"
  as permissive
  for all
  to public
using ((auth.uid() = user_id));



  create policy "members can read shared project files"
  on "public"."project_files"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.project_members
  WHERE ((project_members.owner_id = project_files.user_id) AND (project_members.project_name = project_files.project_name) AND (project_members.member_id = auth.uid())))));



  create policy "invites_owner"
  on "public"."project_invites"
  as permissive
  for all
  to public
using ((auth.uid() = owner_id));



  create policy "invites_self_select"
  on "public"."project_invites"
  as permissive
  for select
  to public
using (((owner_id = auth.uid()) OR (invited_email = auth.email())));



  create policy "invites_self_update"
  on "public"."project_invites"
  as permissive
  for update
  to public
using ((invited_email = auth.email()));



  create policy "members_delete"
  on "public"."project_members"
  as permissive
  for delete
  to public
using (((owner_id = auth.uid()) OR (member_id = auth.uid())));



  create policy "members_insert"
  on "public"."project_members"
  as permissive
  for insert
  to public
with check ((owner_id = auth.uid()));



  create policy "members_select"
  on "public"."project_members"
  as permissive
  for select
  to public
using (((owner_id = auth.uid()) OR (member_id = auth.uid())));



  create policy "members_update"
  on "public"."project_members"
  as permissive
  for update
  to public
using ((owner_id = auth.uid()));



  create policy "projects_delete"
  on "public"."projects"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "projects_insert"
  on "public"."projects"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "projects_select"
  on "public"."projects"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "projects_update"
  on "public"."projects"
  as permissive
  for update
  to public
using ((user_id = auth.uid()));



  create policy "own_profile"
  on "public"."user_profiles"
  as permissive
  for all
  to public
using ((auth.uid() = user_id));



  create policy "profile_peer_select"
  on "public"."user_profiles"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.project_members pm_me
     JOIN public.project_members pm_them ON (((pm_me.owner_id = pm_them.owner_id) AND (pm_me.project_name = pm_them.project_name))))
  WHERE ((pm_me.member_id = auth.uid()) AND (pm_them.member_id = user_profiles.user_id)))));


CREATE TRIGGER trg_beat_charts_updated_at BEFORE UPDATE ON public.beat_charts FOR EACH ROW EXECUTE FUNCTION public.beat_charts_set_updated_at();

CREATE TRIGGER beat_rooms_set_invite_code BEFORE INSERT ON public.beat_rooms FOR EACH ROW EXECUTE FUNCTION public.set_invite_code();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "room members can receive broadcast and presence"
  on "realtime"."messages"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.beat_room_players p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.room_id = (split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid) AND (messages.extension = ANY (ARRAY['broadcast'::text, 'presence'::text]))))));



  create policy "room members can send broadcast and presence"
  on "realtime"."messages"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.beat_room_players p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.room_id = (split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid) AND (messages.extension = ANY (ARRAY['broadcast'::text, 'presence'::text]))))));



  create policy "beat_files_owner_delete"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'beat-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "beat_files_owner_insert"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'beat-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "beat_files_owner_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'beat-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "beat_files_owner_update"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'beat-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "delete own files"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'mod-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "members can read shared images"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'mod-images'::text) AND (EXISTS ( SELECT 1
   FROM public.project_members pm
  WHERE ((pm.member_id = auth.uid()) AND ((storage.foldername(objects.name))[1] = (pm.owner_id)::text) AND ((storage.foldername(objects.name))[2] = pm.project_name))))));



  create policy "read own files"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'mod-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "update own files"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'mod-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "upload own files"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'mod-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



