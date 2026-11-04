/**
 * CloudModeration — 신고 접수 + 모더레이터 도구 (supabase/migrations/20260908000000_beat_moderation.sql)
 * 신고는 접수만 한다(자동 숨김 없음). 삭제 처리는 모더레이터가 직접 한다.
 * 모더레이터 지정은 서버(SQL)에서만 가능하다 — 여기의 isModerator()는 UI 표시용이고, 실제 권한은 RPC가 검사한다.
 */
const CloudModeration = {
    REASONS: {
        copyright: '저작권 침해',
        inappropriate: '부적절한 콘텐츠',
        spam: '스팸/도배',
        other: '기타',
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
        if (error && error.code === '23505') return '이미 접수된 신고입니다. 처리될 때까지 기다려 주세요.';
        if (/too many reports/i.test(m)) return '하루에 접수할 수 있는 신고 수를 넘었습니다.';
        if (/song not found/i.test(m)) return '대상 곡을 찾을 수 없습니다.';
        if (/forbidden/i.test(m) || (error && error.code === '42501')) return '권한이 없습니다.';
        return m || '요청에 실패했습니다.';
    },

    // 신고 접수. 반환: { ok, error }
    async reportSong({ songId, chartId = null, reason, detail = '' }) {
        const user = await CloudAuth.getUser();
        if (!user) return { ok: false, error: '신고하려면 로그인이 필요합니다.' };
        if (!this.REASONS[reason]) return { ok: false, error: '신고 사유를 선택해 주세요.' };
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
    async restoreSong(songId, note) {
        const { error } = await _supabase.rpc('beat_mod_restore_song', { p_song_id: songId, p_note: note || null });
        return { ok: !error, error: error ? this._errMsg(error) : null };
    },
};
