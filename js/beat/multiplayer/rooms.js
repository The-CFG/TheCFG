/**
 * MultiplayerRooms
 * ----------------
 * beat_rooms / beat_room_players 테이블에 대한 최소 REST CRUD.
 * 아직 로비 UI는 없다 — Realtime 기반(realtime.js)이 붙을 수 있는 최소한의 "방"만 여기서 만든다.
 *
 * 중요: Realtime Authorization RLS(beat_multiplayer_foundation_migration.sql)가
 * "beat_room_players에 내 row가 있어야 그 방의 realtime 채널에 붙을 수 있다"는 조건이라,
 * 방을 만든 host도 반드시 자기 자신을 beat_room_players에 join시켜야 한다.
 * → createRoom()이 방 생성 직후 host를 자동으로 join시키는 이유.
 */
const MultiplayerRooms = {
    // 방 생성 + host를 플레이어로 자동 join. 실패 시 { error }.
    async createRoom(chartId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { data: room, error: roomErr } = await _supabase
            .from('beat_rooms')
            .insert({ chart_id: chartId, host_id: user.id })
            .select()
            .single();
        if (roomErr) return { error: roomErr };

        const { error: joinErr } = await this.joinRoom(room.id);
        if (joinErr) return { error: joinErr };

        return { data: room };
    },

    // 이미 존재하는 방에 참가(자기 자신을 beat_room_players에 insert).
    async joinRoom(roomId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const nickname = user.user_metadata?.display_name || null;

        const { error } = await _supabase
            .from('beat_room_players')
            .insert({ room_id: roomId, user_id: user.id, nickname });
        return { error };
    },

    async leaveRoom(roomId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { error } = await _supabase
            .from('beat_room_players')
            .delete()
            .eq('room_id', roomId)
            .eq('user_id', user.id);
        return { error };
    },

    // 오디오/채보 로드 완료 시 ready 플래그 갱신.
    async setReady(roomId, ready) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { error } = await _supabase
            .from('beat_room_players')
            .update({ ready })
            .eq('room_id', roomId)
            .eq('user_id', user.id);
        return { error };
    },

    // 호스트 전용: 방 상태 전환(waiting → countdown → playing → finished) + 시작 목표 시각 기록.
    async updateRoomStatus(roomId, status, startedAt = null) {
        const patch = { status };
        if (startedAt !== null) patch.started_at = startedAt;
        const { error } = await _supabase
            .from('beat_rooms')
            .update(patch)
            .eq('id', roomId);
        return { error };
    },

    // 종료 시 각자 자기 결과를 기록 (관전용 표시에만 쓰임 — 정식 리더보드는 CloudScores.submitScore 그대로 사용).
    async setFinalResult(roomId, finalScore, finalCombo) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { error } = await _supabase
            .from('beat_room_players')
            .update({ final_score: finalScore, final_combo: finalCombo })
            .eq('room_id', roomId)
            .eq('user_id', user.id);
        return { error };
    },

    async listPlayers(roomId) {
        const { data, error } = await _supabase
            .from('beat_room_players')
            .select('user_id, nickname, ready, final_score, final_combo, joined_at')
            .eq('room_id', roomId)
            .order('joined_at', { ascending: true });
        return { data, error };
    },

    async listWaitingRooms(chartId) {
        const { data, error } = await _supabase
            .from('beat_rooms')
            .select('id, chart_id, host_id, status, created_at')
            .eq('chart_id', chartId)
            .eq('status', 'waiting')
            .order('created_at', { ascending: false })
            .limit(20);
        return { data, error };
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerRooms;
}