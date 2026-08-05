// ── CloudLikes: 난이도(beat_charts)별 좋아요 ────────────────────────────────
// beat.html 에서 auth.js 다음에 로드된다. _supabase 는 auth.js에서 선언된 전역 변수.
//
// 필요한 테이블 (Supabase에 아직 없다면 아래 SQL을 먼저 실행해야 함):
//
//   create table if not exists beat_chart_likes (
//       chart_id   uuid not null references beat_charts(id) on delete cascade,
//       user_id    uuid not null references auth.users(id) on delete cascade,
//       created_at timestamptz not null default now(),
//       primary key (chart_id, user_id)
//   );
//
//   alter table beat_chart_likes enable row level security;
//
//   -- 좋아요 개수 집계를 위해 누구나 조회 가능
//   create policy beat_chart_likes_select on beat_chart_likes
//       for select using (true);
//
//   -- 본인 좋아요만 추가 가능
//   create policy beat_chart_likes_insert on beat_chart_likes
//       for insert with check (auth.uid() = user_id);
//
//   -- 본인 좋아요만 취소 가능
//   create policy beat_chart_likes_delete on beat_chart_likes
//       for delete using (auth.uid() = user_id);

const CloudLikes = {

    // ── 차트(난이도) 여러 개의 좋아요 개수 + 내가 눌렀는지 여부를 한 번에 조회 ──
    // chartIds: string[] — 반환값: { [chartId]: { count, likedByMe } }
    async getLikeInfo(chartIds) {
        const ids = (chartIds || []).filter(Boolean);
        if (ids.length === 0) return { data: {}, error: null };

        const { data: rows, error } = await _supabase
            .from('beat_chart_likes')
            .select('chart_id, user_id')
            .in('chart_id', ids);
        if (error) return { data: null, error };

        const user = await CloudAuth.getUser();

        const info = {};
        ids.forEach(id => { info[id] = { count: 0, likedByMe: false }; });
        (rows || []).forEach(r => {
            if (!info[r.chart_id]) info[r.chart_id] = { count: 0, likedByMe: false };
            info[r.chart_id].count += 1;
            if (user && r.user_id === user.id) info[r.chart_id].likedByMe = true;
        });

        return { data: info, error: null };
    },

    // ── 차트 하나의 좋아요 개수만 조회 (로그인 여부 무관) ──────────────────
    async getLikeCount(chartId) {
        const { count, error } = await _supabase
            .from('beat_chart_likes')
            .select('chart_id', { count: 'exact', head: true })
            .eq('chart_id', chartId);
        return { data: count || 0, error };
    },

    // ── 좋아요 누르기 ─────────────────────────────────────────────────────
    async like(chartId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { error } = await _supabase
            .from('beat_chart_likes')
            .insert({ chart_id: chartId, user_id: user.id });

        // 이미 눌러둔 상태(유니크 제약 위반, 23505)는 실패로 취급하지 않는다
        if (error && error.code === '23505') return { error: null };
        return { error };
    },

    // ── 좋아요 취소 ───────────────────────────────────────────────────────
    async unlike(chartId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { error } = await _supabase
            .from('beat_chart_likes')
            .delete()
            .eq('chart_id', chartId)
            .eq('user_id', user.id);

        return { error };
    },

    // ── 현재 상태 기준으로 좋아요 on/off 토글 ────────────────────────────
    async toggle(chartId, currentlyLiked) {
        return currentlyLiked ? this.unlike(chartId) : this.like(chartId);
    },
};