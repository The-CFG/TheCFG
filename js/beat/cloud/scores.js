// ── CloudScores: 점수 제출 / 리더보드 조회 ────────────────────────────────
// 점수 제출은 반드시 submit_score RPC를 통해서만 가능하다.
// 직접 INSERT/UPDATE는 RLS 정책으로 차단되어 있다.

const CloudScores = {

    // ── 점수 제출 (로그인 필요) ───────────────────────────────────────────────
    // 기존 최고 기록보다 낮으면 서버에서 자동으로 무시됨 (is_new_best: false 반환)
    async submitScore({ chartId, score, accuracy, maxCombo, judgePerfect, judgeGood, judgeMiss }) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { data, error } = await _supabase.rpc('submit_score', {
            p_chart_id:      chartId,
            p_score:         score,
            p_accuracy:      accuracy,
            p_max_combo:     maxCombo,
            p_judge_perfect: judgePerfect ?? null,
            p_judge_good:    judgeGood    ?? null,
            p_judge_miss:    judgeMiss    ?? null,
        });

        return { data: data?.[0] ?? null, error };
    },

    // ── 리더보드 조회 (비로그인 가능) ────────────────────────────────────────
    async getLeaderboard(chartId, limit = 10) {
        const { data, error } = await _supabase
            .from('beat_scores')
            .select('user_id, score, accuracy, max_combo, achieved_at')
            .eq('chart_id', chartId)
            .order('score', { ascending: false })
            .limit(limit);

        if (error || !data) return { data, error };

        // user_id → 닉네임 일괄 조회 후 각 기록에 붙여서 반환
        const nickMap = await CloudAuth._fetchNicknameMap(data.map(s => s.user_id));
        const withNicknames = data.map(s => ({ ...s, nickname: nickMap[s.user_id] || null }));

        return { data: withNicknames, error: null };
    },

    // ── 내 기록 조회 ──────────────────────────────────────────────────────────
    async getMyScore(chartId) {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null };

        const { data, error } = await _supabase
            .from('beat_scores')
            .select('score, accuracy, max_combo, achieved_at')
            .eq('chart_id', chartId)
            .eq('user_id', user.id)
            .single();

        // 기록 없음은 에러가 아니므로 null 반환
        if (error?.code === 'PGRST116') return { data: null };
        return { data, error };
    },
};