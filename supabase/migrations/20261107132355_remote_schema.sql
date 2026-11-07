set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.beat_attach_youtube_own(p_song_id uuid, p_youtube_id text, p_offset_ms integer, p_duration_ms integer)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.beat_charts_guard_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (auth.uid() is null) or public.beat_is_moderator() then
    return new;
  end if;
  if exists (select 1 from public.beat_songs s where s.id = new.song_id and s.moderation_status = 'removed') then
    new.is_public := false;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_is_moderator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.beat_moderators where user_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_attach_youtube(p_song_id uuid, p_youtube_id text, p_offset_ms integer, p_duration_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_dismiss_report(p_report_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.beat_mod_require();
  update public.beat_reports
     set status = 'dismissed', handled_by = auth.uid(), handled_at = now(),
         mod_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_report_id and status = 'open';
  if not found then raise exception 'report not found or already handled'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_list_legacy_songs(p_q text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(song_id uuid, title text, artist text, owner_handle text, is_public boolean, audio_storage_path text, start_offset_ms integer, preview_start_ms integer, chart_count bigint, created_at timestamp with time zone, total bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_list_reports(p_status text DEFAULT 'open'::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(report_id uuid, song_id uuid, chart_id uuid, reason text, detail text, status text, created_at timestamp with time zone, handled_at timestamp with time zone, mod_note text, song_title text, song_artist text, source_type text, youtube_id text, is_public boolean, moderation_status text, moderation_reason text, owner_id uuid, owner_handle text, reporter_id uuid, reporter_handle text, reporter_dismissed_count bigint, reports_on_song bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.beat_mod_require();
  return query
  select r.id, r.song_id, r.chart_id, r.reason, r.detail, r.status,
         r.created_at, r.handled_at, r.mod_note,
         s.title, s.artist, s.source_type, s.youtube_id, s.is_public,
         s.moderation_status, s.moderation_reason,
         s.owner_id, op.handle,
         r.reporter_id, rp.handle,
         (select count(*) from public.beat_reports x where x.reporter_id = r.reporter_id and x.status = 'dismissed'),
         (select count(*) from public.beat_reports y where y.song_id = r.song_id)
    from public.beat_reports r
    left join public.beat_songs s on s.id = r.song_id
    left join public.user_profiles op on op.user_id = s.owner_id
    left join public.user_profiles rp on rp.user_id = r.reporter_id
   where r.status = p_status
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_purge_count()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint;
begin
  perform public.beat_mod_require();
  select count(*) into n from public.beat_audio_purge_queue;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_purge_done(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.beat_mod_require();
  delete from public.beat_audio_purge_queue where id = any(p_ids);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_purge_list(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.beat_mod_require();
  return query
  select q.id, q.storage_path from public.beat_audio_purge_queue q
   where not exists (select 1 from public.beat_songs s where s.audio_storage_path = q.storage_path)
     and not exists (select 1 from public.beat_charts c where c.audio_storage_path = q.storage_path)
   order by q.queued_at
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_require()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.beat_is_moderator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_restore_song(p_song_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.beat_mod_require();
  update public.beat_songs
     set moderation_status = 'ok',
         moderation_reason = nullif(btrim(coalesce(p_note, '')), ''),
         moderated_by = auth.uid(),
         moderated_at = now()
   where id = p_song_id and moderation_status = 'removed';
  if not found then raise exception 'song not removed'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_mod_takedown_song(p_song_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.beat_mod_require();
  update public.beat_songs
     set moderation_status = 'removed',
         moderation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         moderated_by = auth.uid(),
         moderated_at = now(),
         is_public = false
   where id = p_song_id;
  if not found then raise exception 'song not found'; end if;
  update public.beat_charts set is_public = false where song_id = p_song_id;
  update public.beat_reports
     set status = 'actioned', handled_by = auth.uid(), handled_at = now(),
         mod_note = coalesce(mod_note, nullif(btrim(coalesce(p_reason, '')), ''))
   where song_id = p_song_id and status = 'open';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_own_purge_done(p_paths text[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.beat_audio_purge_queue
   where storage_path = any(p_paths) and queued_by = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.beat_report_song_ads(p_song_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.beat_songs
     set has_ads = true
   where id = p_song_id
     and source_type = 'youtube'
     and has_ads is distinct from true;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_reports_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.beat_songs where id = new.song_id) then
    raise exception 'song not found';
  end if;
  if (select count(*) from public.beat_reports
       where reporter_id = new.reporter_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many reports';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.beat_songs_enforce_music_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  if NEW.source_type in ('youtube', 'local') then
    if NEW.youtube_id is null then
      raise exception 'YouTube 링크가 필요합니다. (source_type=%)', NEW.source_type
        using errcode = 'check_violation';
    end if;
    if NEW.audio_storage_path is not null then
      raise exception '% 곡은 서버에 음원 파일을 둘 수 없습니다.', NEW.source_type
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
$function$
;

CREATE OR REPLACE FUNCTION public.beat_songs_guard_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  _privileged boolean := (auth.uid() is null) or public.beat_is_moderator();
begin
  if _privileged then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_status := 'ok';
    new.moderation_reason := null;
    new.moderated_by := null;
    new.moderated_at := null;
  else
    new.moderation_status := old.moderation_status;
    new.moderation_reason := old.moderation_reason;
    new.moderated_by := old.moderated_by;
    new.moderated_at := old.moderated_at;
    if old.moderation_status = 'removed' then
      new.is_public := false;
    end if;
  end if;
  return new;
end;
$function$
;

grant delete on table "public"."beat_audio_purge_queue" to "anon";

grant insert on table "public"."beat_audio_purge_queue" to "anon";

grant select on table "public"."beat_audio_purge_queue" to "anon";

grant update on table "public"."beat_audio_purge_queue" to "anon";

grant delete on table "public"."beat_audio_purge_queue" to "authenticated";

grant insert on table "public"."beat_audio_purge_queue" to "authenticated";

grant select on table "public"."beat_audio_purge_queue" to "authenticated";

grant update on table "public"."beat_audio_purge_queue" to "authenticated";

grant delete on table "public"."beat_audio_purge_queue" to "service_role";

grant insert on table "public"."beat_audio_purge_queue" to "service_role";

grant select on table "public"."beat_audio_purge_queue" to "service_role";

grant update on table "public"."beat_audio_purge_queue" to "service_role";

grant delete on table "public"."beat_moderators" to "anon";

grant insert on table "public"."beat_moderators" to "anon";

grant select on table "public"."beat_moderators" to "anon";

grant update on table "public"."beat_moderators" to "anon";

grant delete on table "public"."beat_moderators" to "authenticated";

grant insert on table "public"."beat_moderators" to "authenticated";

grant select on table "public"."beat_moderators" to "authenticated";

grant update on table "public"."beat_moderators" to "authenticated";

grant delete on table "public"."beat_moderators" to "service_role";

grant insert on table "public"."beat_moderators" to "service_role";

grant select on table "public"."beat_moderators" to "service_role";

grant update on table "public"."beat_moderators" to "service_role";

grant delete on table "public"."beat_reports" to "anon";

grant insert on table "public"."beat_reports" to "anon";

grant select on table "public"."beat_reports" to "anon";

grant update on table "public"."beat_reports" to "anon";

grant delete on table "public"."beat_reports" to "authenticated";

grant insert on table "public"."beat_reports" to "authenticated";

grant select on table "public"."beat_reports" to "authenticated";

grant update on table "public"."beat_reports" to "authenticated";

grant delete on table "public"."beat_reports" to "service_role";

grant insert on table "public"."beat_reports" to "service_role";

grant select on table "public"."beat_reports" to "service_role";

grant update on table "public"."beat_reports" to "service_role";

CREATE TRIGGER enforce_versioning_status_transition BEFORE UPDATE OF versioning_status ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_versioning_status_transition();

CREATE TRIGGER protect_active_lifecycle_states BEFORE DELETE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_active_lifecycle_states();

CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');

CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();

CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role');

CREATE TRIGGER wake_lifecycle_on_policy_write AFTER INSERT OR UPDATE OF lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.wake_lifecycle_state();

CREATE TRIGGER wake_lifecycle_on_versioning_enable AFTER UPDATE OF versioning_status ON storage.buckets FOR EACH ROW WHEN ((new.lifecycle_configuration IS NOT NULL)) EXECUTE FUNCTION storage.wake_lifecycle_state();


