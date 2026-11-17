/**
 * CloudModeration — 신고 접수 + 모더레이터 도구 (supabase/migrations/20260908000000_beat_moderation.sql)
 * 신고는 접수만 한다(자동 숨김 없음). 삭제 처리는 모더레이터가 직접 한다.
 * 모더레이터 지정은 서버(SQL)에서만 가능하다 — 여기의 isModerator()는 UI 표시용이고, 실제 권한은 RPC가 검사한다.
 */
const CloudModeration = {
    REASONS: {
        // 사용 시점에 번역되도록 getter로 정의 (키 이름은 서버에 저장되는 사유 코드)
        get copyright() { return I18n.t("j_copyright_infringement"); },
        get inappropriate() { return I18n.t("j_inappropriate_content"); },
        get spam() { return I18n.t("j_spam_flooding"); },
        get other() { return I18n.t("j_other"); },
    },
    _modCache: { uid: null, value: false },

    async isModerator() {
        const user = await CloudAuth.getUser();
        if (!user) return false;
        if (this._modCache.uid === user.id) return this._modCache.value;
        const { data, error } = await _supabase
            .from('beat_moderators').select('user_id').eq('user_id', user.id).maybeSingle();
        const value = !error && !!data;
        this._modCache = { uid: user.id, value };
        return value;
    },

    _errMsg(error) {
        const m = (error && (error.message || '')) || '';
        if (error && error.code === '23505') return I18n.t("j_this_has_already_been_reported");
        if (/too many reports/i.test(m)) return I18n.t("j_you_have_reached_the_daily");
        if (/song not found/i.test(m)) return I18n.t("j_could_not_find_the_target");
        if (/forbidden/i.test(m) || (error && error.code === '42501')) return I18n.t("j_you_don_t_have_permission");
        return m || I18n.t("j_the_request_failed");
    },

    // 신고 접수. 반환: { ok, error }
    async reportSong({ songId, chartId = null, reason, detail = '' }) {
        const user = await CloudAuth.getUser();
        if (!user) return { ok: false, error: I18n.t("j_you_need_to_log_in_2") };
        if (!this.REASONS[reason]) return { ok: false, error: I18n.t("j_please_select_a_reason_for") };
        const { error } = await _supabase.from('beat_reports').insert({
            song_id: songId,
            chart_id: chartId,
            reason,
            detail: (detail || '').trim().slice(0, 1000) || null,
        });
        if (error) return { ok: false, error: this._errMsg(error) };
        return { ok: true };
    },

    // ── 모더레이터 전용 ──
    async listReports(status = 'open', limit = 50) {
        const { data, error } = await _supabase.rpc('beat_mod_list_reports', { p_status: status, p_limit: limit });
        if (error) return { data: [], error: this._errMsg(error) };
        return { data: data || [], error: null };
    },
    async takedownSong(songId, reason) {
        const { error } = await _supabase.rpc('beat_mod_takedown_song', { p_song_id: songId, p_reason: reason || null });
        return { ok: !error, error: error ? this._errMsg(error) : null };
    },
    async dismissReport(reportId, note) {
        const { error } = await _supabase.rpc('beat_mod_dismiss_report', { p_report_id: reportId, p_note: note || null });
        return { ok: !error, error: error ? this._errMsg(error) : null };
    },
    // ── 기존(legacy) 곡 → YouTube 링크 일괄 첨부 / 기존 오디오 정리 (S6) ──
    async listLegacySongs(q = '', limit = 20, offset = 0) {
        const { data, error } = await _supabase.rpc('beat_mod_list_legacy_songs', { p_q: q || null, p_limit: limit, p_offset: offset });
        if (error) return { data: [], total: 0, error: this._errMsg(error) };
        return { data: data || [], total: data && data.length ? Number(data[0].total) : 0, error: null };
    },
    async attachYoutube(songId, youtubeId, offsetMs, durationMs) {
        const { error } = await _supabase.rpc('beat_mod_attach_youtube', {
            p_song_id: songId, p_youtube_id: youtubeId, p_offset_ms: Math.max(0, Math.round(offsetMs || 0)), p_duration_ms: Math.round(durationMs),
        });
        return { ok: !error, error: error ? this._errMsg(error) : null };
    },
    async purgeCount() {
        const { data, error } = await _supabase.rpc('beat_mod_purge_count');
        return error ? 0 : Number(data || 0);
    },
    // 정리 대기열의 옛 오디오를 Storage에서 실제로 삭제하고 대기열을 비운다. 반환: { removed, failed, error }
    async purgeFiles(onProgress) {
        let removed = 0, failed = 0;
        for (let round = 0; round < 50; round++) {
            const { data, error } = await _supabase.rpc('beat_mod_purge_list', { p_limit: 100 });
            if (error) return { removed, failed, error: this._errMsg(error) };
            if (!data || data.length === 0) break;
            const done = [];
            for (let i = 0; i < data.length; i += 50) {
                const chunk = data.slice(i, i + 50);
                const { error: rmErr } = await _supabase.storage.from('beat-files').remove(chunk.map(r => r.storage_path));
                if (rmErr) failed += chunk.length;
                else { done.push(...chunk.map(r => r.id)); removed += chunk.length; }
                if (onProgress) onProgress(removed, failed);
            }
            if (done.length) await _supabase.rpc('beat_mod_purge_done', { p_ids: done });
            if (done.length === 0) break; // 전부 실패하면 무한 반복 방지
        }
        return { removed, failed, error: null };
    },
    // legacy 음원 재생용 URL: 비공개 전환 후에도 모더레이터는 서명 URL로 들을 수 있다 (실패 시 공개 URL)
    async legacyAudioUrl(path) {
        const { data } = await _supabase.storage.from('beat-files').createSignedUrl(path, 3600);
        return (data && data.signedUrl) || CloudCharts.getAudioUrl(path);
    },

    async restoreSong(songId, note) {
        const { error } = await _supabase.rpc('beat_mod_restore_song', { p_song_id: songId, p_note: note || null });
        return { ok: !error, error: error ? this._errMsg(error) : null };
    },
};