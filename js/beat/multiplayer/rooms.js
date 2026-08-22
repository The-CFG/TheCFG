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

    // 방을 완전히 삭제한다(호스트 전용 — RLS "host can delete own room"이 host_id로 검증).
    // beat_room_players는 beat_rooms에 ON DELETE CASCADE로 걸려 있어 같이 삭제된다.
    async deleteRoom(roomId) {
        const { error } = await _supabase
            .from('beat_rooms')
            .delete()
            .eq('id', roomId);
        return { error };
    },

    // 호스트 이탈 시 남은 사람 중 가장 먼저 join한 사람에게 호스트를 넘긴다.
    // 남은 사람이 없으면 { data: null }을 반환 — 호출 측(lobby.js)이 방을 바로 삭제한다.
    //
    // 중요: 반드시 "호스트 자신의 beat_room_players row가 아직 남아있는 상태"에서 호출해야
    // 한다. beat_room_players의 SELECT RLS 정책(room members can read player list of their
    // room)이 is_room_member(room_id, auth.uid())로 호출자 자신이 그 방의 멤버인지부터
    // 검사하기 때문에, 호스트가 자기 row를 먼저 지우고 나서 이 함수를 부르면 listPlayers가
    // (다른 참가자가 남아있어도) 무조건 빈 배열을 돌려받아 항상 "아무도 없음"으로 오판하고
    // 방을 그냥 삭제해버린다 — 실제로는 참가자가 남아있는데도. 호출 순서는
    // lobby.js의 _leaveRoom()에서 leaveRoom()(자기 row 삭제)보다 먼저 오도록 되어 있다.
    async transferHost(roomId) {
        const user = await CloudAuth.getUser();
        const { data: players, error: listErr } = await this.listPlayers(roomId);
        if (listErr) return { error: listErr };
        // joined_at 오름차순 목록에서 나(곧 나갈 호스트) 자신은 후보에서 제외 — 안 그러면
        // 대개 내가 가장 먼저 join한 사람(=호스트 본인)이라 스스로를 다음 호스트로 뽑아버린다.
        const next = players?.find(p => p.user_id !== user?.id);
        if (!next) return { data: null };

        const { data: ok, error } = await _supabase.rpc('transfer_host', {
            _room_id: roomId,
            _new_host_id: next.user_id,
        });
        if (error) return { error };
        // RPC가 boolean으로 실제 갱신 성공 여부를 돌려준다 — false면 DB의 host_id는
        // 안 바뀐 것이므로 성공으로 착각해 broadcast하면 안 된다(로컬 상태와 DB가 어긋남).
        if (!ok) return { data: null, error: new Error('호스트 위임에 실패했습니다.') };
        return { error: null, data: next };
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

    // 호스트 전용: 특정 유저를 방에서 강제로 내보낸다(RLS가 host_id 검증).
    async kickPlayer(roomId, targetUserId) {
        const { error } = await _supabase
            .from('beat_room_players')
            .delete()
            .eq('room_id', roomId)
            .eq('user_id', targetUserId);
        return { error };
    },

    // 호스트 전용: 방 정원 변경.
    async setMaxPlayers(roomId, maxPlayers) {
        const { error } = await _supabase
            .from('beat_rooms')
            .update({ max_players: maxPlayers })
            .eq('id', roomId);
        return { error };
    },

    // 호스트 전용: 같은 멤버로 재도전 — 방을 waiting으로 되돌리고 전원의 ready/최종 결과를 초기화한다.
    async resetForRematch(roomId) {
        const { error: statusErr } = await _supabase
            .from('beat_rooms')
            .update({ status: 'waiting', started_at: null })
            .eq('id', roomId);
        if (statusErr) return { error: statusErr };

        const { error: playersErr } = await _supabase
            .from('beat_room_players')
            .update({ ready: false, final_score: null, final_combo: null })
            .eq('room_id', roomId);
        return { error: playersErr };
    },

    async listPlayers(roomId) {
        const { data, error } = await _supabase
            .from('beat_room_players')
            .select('user_id, nickname, ready, final_score, final_combo, joined_at')
            .eq('room_id', roomId)
            .order('joined_at', { ascending: true });
        return { data, error };
    },

    // 초대 코드(=room id)로 방 하나 조회. 참가 화면에서 코드 유효성 확인 + 대기실 표시에 사용.
    async getRoom(roomId) {
        const { data, error } = await _supabase
            .from('beat_rooms')
            .select('id, chart_id, chart_queue, host_id, status, started_at, created_at, invite_code, max_players, is_listed, has_password, player_count')
            .eq('id', roomId)
            .single();
        return { data, error };
    },
    // 초대 코드로 방 조회(참가 화면 전용). 대소문자 구분 없이 입력받아 대문자로 정규화한다.
    async getRoomByInviteCode(code) {
        const { data, error } = await _supabase
            .from('beat_rooms')
            .select('id, chart_id, chart_queue, host_id, status, started_at, created_at, invite_code, max_players, is_listed, has_password, player_count')
            .eq('invite_code', (code || '').toUpperCase())
            .single();
        return { data, error };
    },

    // 호스트 전용: 방 목록(공개 검색) 노출 여부 토글. beat_rooms의 일반 컬럼이라
    // 기존 "host can update own room" RLS로 이미 커버된다(setMaxPlayers와 동일한 방식).
    async setListed(roomId, listed) {
        const { error } = await _supabase
            .from('beat_rooms')
            .update({ is_listed: !!listed })
            .eq('id', roomId);
        return { error };
    },

    // 호스트 전용: 방 비밀번호 설정/변경. password가 빈 값이면 해제(공개 전환).
    // 실제 해시 저장/검증은 전부 서버 쪽 RPC(set_room_password)가 처리 — 클라이언트는
    // 평문을 딱 한 번 이 호출에만 실어 보내고 그 뒤로는 절대 다루지 않는다.
    async setPassword(roomId, password) {
        const { error } = await _supabase.rpc('set_room_password', {
            _room_id: roomId,
            _password: password || null,
        });
        return { error };
    },

    // 방 목록(공개 검색)에서 방 참가. 초대 코드 참가(joinRoom)와 달리 비밀번호 검증이
    // 필요해서 클라이언트가 직접 insert하지 않고 RPC(join_listed_room)를 거친다 —
    // 비밀번호 해시는 beat_room_passwords에 있고 그 테이블은 클라이언트가 아예
    // 못 읽으므로, 검증은 반드시 서버(SECURITY DEFINER 함수) 쪽에서 이뤄져야 한다.
    async joinListedRoom(roomId, password) {
        const { error } = await _supabase.rpc('join_listed_room', {
            _room_id: roomId,
            _password: password || null,
        });
        return { error };
    },

    // 방 목록 화면: 공개(방 목록에 공개 = true) + 대기 중(waiting) + 30분 이내 생성된
    // 방들을 최신순으로. player_count/has_password는 beat_rooms 컬럼이라 바로 읽힌다
    // (플레이어 목록 자체는 방 멤버만 볼 수 있지만, 인원수 캐시 컬럼은 누구나 읽을 수 있음).
    async listPublicRooms() {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data, error } = await _supabase
            .from('beat_rooms')
            .select('id, chart_id, host_id, max_players, player_count, has_password, created_at')
            .eq('status', 'waiting')
            .eq('is_listed', true)
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(30);
        return { data, error };
    },

    // 호스트 전용: 같은 노래의 다른 난이도를 방의 "다음에 플레이할 목록"(chart_queue)에 추가.
    // 이미 현재 채보이거나 큐에 있으면 조용히 무시(중복 추가 방지). RLS는 beat_rooms의
    // 기존 host-only UPDATE 정책을 그대로 타므로 host가 아니면 이 호출 자체가 실패한다.
    async addChartToQueue(roomId, chartId) {
        const { data: room, error: roomErr } = await this.getRoom(roomId);
        if (roomErr) return { error: roomErr };

        const currentQueue = Array.isArray(room.chart_queue) ? room.chart_queue : [];
        if (room.chart_id === chartId || currentQueue.includes(chartId)) {
            return { data: room, error: null }; // 이미 목록에 있음
        }

        const nextQueue = [...currentQueue, chartId];
        const { data, error } = await _supabase
            .from('beat_rooms')
            .update({ chart_queue: nextQueue })
            .eq('id', roomId)
            .select('id, chart_id, chart_queue')
            .single();
        return { data, error };
    },

    // 호스트 전용: 방금 플레이가 끝난(현재) 채보를 목록에서 완전히 지우고, 큐의 맨 앞
    // 난이도를 다음 "현재 채보"로 승격한다. 큐가 비어있으면(=남은 유일한 난이도였다는 뜻)
    // 아무 것도 바꾸지 않고 { data: null }을 반환한다 — 호출 측(lobby.js)이 기존 재시작
    // 흐름(같은 채보로 다시 시작)으로 처리한다.
    async advanceChartQueue(roomId) {
        const { data: room, error: roomErr } = await this.getRoom(roomId);
        if (roomErr) return { error: roomErr };

        const queue = Array.isArray(room.chart_queue) ? room.chart_queue : [];
        if (queue.length === 0) return { data: null, error: null };

        const [nextChartId, ...rest] = queue;
        const { data, error } = await _supabase
            .from('beat_rooms')
            .update({ chart_id: nextChartId, chart_queue: rest })
            .eq('id', roomId)
            .select('id, chart_id, chart_queue')
            .single();
        return { data, error };
    },

    // 호스트 전용: 대기열 전체를 교체 — 주로 항목 제거/재정렬에 쓰인다.
    async setChartQueue(roomId, chartQueue) {
        const { data, error } = await _supabase
            .from('beat_rooms')
            .update({ chart_queue: chartQueue })
            .eq('id', roomId)
            .select('id, chart_id, chart_queue')
            .single();
        return { data, error };
    },

    async listWaitingRooms(chartId) {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data, error } = await _supabase
            .from('beat_rooms')
            .select('id, chart_id, host_id, status, created_at')
            .eq('chart_id', chartId)
            .eq('status', 'waiting')
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(20);
        return { data, error };
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerRooms;
}