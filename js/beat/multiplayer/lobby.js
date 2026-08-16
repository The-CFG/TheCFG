// ── MultiplayerLobby: 방 생성/참가/대기실 화면 ────────────────────────────────
// Phase 4: 클록 동기화 결과를 실제 동시 시작에 연결한다.
// 대기실 진입 시 채보/오디오를 미리 프리로드하고 호스트 기준 클록 오프셋을 추정해둔다.
// 호스트가 "시작"을 누르면 목표 시각(hostStartTime)을 broadcast('start')로 전파하고,
// 각 클라이언트는 자신의 오프셋으로 로컬 시각으로 변환해 Game.startMultiplayer()로 동시 시작한다.
// Phase 5: 시작 시점의 _players 스냅샷(나를 제외한 상대 목록)을 Game.startMultiplayer에 넘겨,
// 진행 중 상대 점수/콤보 관전 HUD(Game.loop의 progress broadcast/구독)가 이 채널 위에서 동작한다.
// Phase 6: room.id도 함께 넘긴다 — 결과 화면에서 전원이 finish를 broadcast하면
// Game이 beat_rooms.status를 finished로 정리한다(방 row 자체는 지우지 않음).

const MultiplayerLobby = {
    _view: 'menu',   // 'menu' | 'join' | 'waiting'
    _room: null,     // beat_rooms row
    _chart: null,    // CloudBrowse.getBeatmapDetail() 결과
    _players: [],
    _isHost: false,
    _userId: null,
    _preload: null,          // { chartData, audioUrl } — 대기실 진입 시 미리 받아둠
    _preloadPromise: null,
    _preloading: false,      // 채보/오디오 다운로드 중 여부 — true면 준비/시작 버튼을 막는다
    _starting: false,        // 동시 시작 진행 중 중복 트리거 방지
    _queueDetails: [],       // room.chart_queue(id 배열) 각각의 표시용 요약(난이도 라벨/키수/산정 난이도)
    _chartAdvancePromise: null, // 참가자 쪽에서 'chart_advanced' 수신 후 다음 채보 상세를 받아오는 중인 promise
    _clockSyncPromise: null, // 호스트 기준 클록 오프셋 추정이 끝나는 시점을 알기 위한 promise —
                              // 'start'/'restart_start' 수신 시 이게 끝나기 전이면 반드시 먼저 기다려야 한다.
                              // (버그: 참가자가 유난히 빨리 준비를 마쳐 방장이 그만큼 빨리 시작을 누르면
                              //  이 추정이 채 끝나기 전에 브로드캐스트가 도착 — 오프셋 초기값(0)을 그대로
                              //  쓰면 목표 시각이 완전히 어긋나 시작하자마자 전 노트가 미스 처리되며
                              //  0점으로 강제 종료됐다.)
    _hasPlayedOnce: false,   // 이 방에서 한 판이라도 끝난 적이 있는지(첫 시작인지 구분용)
    _pendingQueueAdvance: false, // 방금 판이 끝나서 대기실 복귀 시 큐를 아직 안 넘겼는지(1회성 소비 플래그)

    // ── 결과 화면 "재시작" 투표(관전형 — 서버 검증 없음, 클라이언트끼리 broadcast로만 집계) ──
    _restartVotes: new Set(),  // 재시작에 동의한 user_id 집합
    _restartRequested: false,  // 내가 재시작 버튼을 눌렀는지
    _restarting: false,        // 전원 동의 후 실제 재시작 진행 중(중복 트리거 방지)
    _resultTotal: 0,           // 이번 판 결과 화면 기준 총 참가자 수(나 포함)

    // ── 진입점 ────────────────────────────────────────────────────────────────
    show() {
        this._teardownRealtime();
        this._room = null;
        this._chart = null;
        this._players = [];
        this._isHost = false;
        this._preload = null;
        this._preloadPromise = null;
        this._preloading = false;
        this._starting = false;
        this._restartVotes = new Set();
        this._restartRequested = false;
        this._restarting = false;
        this._resultTotal = 0;
        this._queueDetails = [];
        this._chartAdvancePromise = null;
        this._clockSyncPromise = null;
        this._hasPlayedOnce = false;
        this._pendingQueueAdvance = false;
        GameBackground.clear();
        UI.showScreen('multiplayer');
        this._renderShell();
        this._renderMenu();
    },

    // ── 공통 레이아웃 쉘 ─────────────────────────────────────────────────────
    _renderShell() {
        const el = document.getElementById('multiplayer-screen');
        el.innerHTML = `
        <div class="flex flex-col h-full text-white">
            <div class="flex items-center mb-4 flex-shrink-0">
                <button id="mp-back-btn" class="p-2 -ml-2 rounded-full hover:bg-gray-700 transition mr-2" aria-label="뒤로">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h2 class="text-xl font-bold text-white">멀티플레이</h2>
            </div>
            <div id="mp-message" class="hidden p-3 mb-3 text-center text-sm text-white bg-red-500/90 rounded-lg flex-shrink-0"></div>
            <div id="mp-content" class="flex-1 min-h-0 overflow-y-auto"></div>
        </div>`;

        document.getElementById('mp-back-btn').addEventListener('click', () => this._handleBack());
    },

    _setContent(html) { document.getElementById('mp-content').innerHTML = html; },

    _showMsg(msg) {
        const el = document.getElementById('mp-message');
        if (!el) return;
        if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
        el.textContent = msg;
        el.classList.remove('hidden');
    },

    _handleBack() {
        if (this._starting) return; // 동시 시작 진행 중에는 뒤로가기 무시
        if (this._view === 'add-difficulty') {
            this._view = 'waiting';
            this._renderWaiting();
        } else if (this._view === 'waiting') {
            this._leaveRoom();
        } else if (this._view === 'join') {
            this._renderMenu();
        } else {
            this._teardownRealtime();
            Game.state.gameState = 'menu';
            UI.showScreen('menu');
        }
    },

    // ════════════════════════════════════════════════════════════════════════
    // 메뉴 — 방 만들기 / 코드로 참가
    // ════════════════════════════════════════════════════════════════════════
    _renderMenu() {
        this._view = 'menu';
        this._showMsg('');
        this._setContent(`
        <p class="text-sm text-gray-400 mb-6">같은 채보를 동시에 시작해서 서로의 점수와 콤보를 실시간으로 볼 수 있어요.
        (관전형 — 상대의 플레이가 내 판정에 영향을 주지는 않아요)</p>
        <div class="space-y-4">
            <button id="mp-host-btn" class="w-full py-6 flex flex-col items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-xl transition">
                <span class="text-3xl mb-1">🎮</span>
                <span class="text-xl font-bold text-white">방 만들기</span>
                <span class="text-sm text-gray-400 mt-0.5">채보를 골라 새 방 열기</span>
            </button>
            <button id="mp-join-btn" class="w-full py-6 flex flex-col items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-xl transition">
                <span class="text-3xl mb-1">🔑</span>
                <span class="text-xl font-bold text-white">코드로 참가</span>
                <span class="text-sm text-gray-400 mt-0.5">받은 초대 코드로 들어가기</span>
            </button>
        </div>`);

        document.getElementById('mp-host-btn').addEventListener('click', async () => {
            const user = await CloudAuth.getUser();
            if (!user) { this._showMsg('로그인이 필요합니다.'); return; }
            Online.show('browse', null, { pickMode: true });
        });
        document.getElementById('mp-join-btn').addEventListener('click', () => this._renderJoin());
    },

    // ════════════════════════════════════════════════════════════════════════
    // 참가 — 초대 코드 입력
    // ════════════════════════════════════════════════════════════════════════
    _renderJoin() {
        this._view = 'join';
        this._showMsg('');
        this._setContent(`
        <p class="text-sm text-gray-400 mb-4">호스트에게 받은 초대 코드를 입력하세요.</p>
        <input id="mp-join-code" type="text" placeholder="초대 코드 (6자리)" autocomplete="off" spellcheck="false" maxlength="6"
            class="w-full p-3 mb-4 bg-gray-700 rounded-lg text-white text-sm text-center tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-teal-500">
        <button id="mp-join-submit-btn" class="w-full py-3 bg-teal-600 hover:bg-teal-500 rounded-lg font-bold transition">
            참가하기
        </button>`);

        const input = document.getElementById('mp-join-code');
        const submitBtn = document.getElementById('mp-join-submit-btn');
        input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
        const submit = () => this._joinRoom(input.value.trim(), submitBtn);
        submitBtn.addEventListener('click', submit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        input.focus();
    },

    async _joinRoom(roomId, submitBtn) {
        this._showMsg('');
        if (!roomId) { this._showMsg('초대 코드를 입력하세요.'); return; }

        const user = await CloudAuth.getUser();
        if (!user) { this._showMsg('로그인이 필요합니다.'); return; }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '참가하는 중…'; }

        // 입력값은 6자리 "초대 코드"이지 방의 UUID(id)가 아니다.
        // getRoom()에 그대로 넘기면 UUID 형식이 아니라서 Postgres가 400을 던진다 —
        // 반드시 초대 코드 전용 조회 함수를 써야 한다.
        const { data: room, error: roomErr } = await MultiplayerRooms.getRoomByInviteCode(roomId);
        if (roomErr || !room) {
            this._showMsg('방을 찾을 수 없습니다. 코드를 확인해주세요.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '참가하기'; }
            return;
        }
        if (room.status !== 'waiting') {
            this._showMsg('이미 시작됐거나 종료된 방이라 참가할 수 없습니다.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '참가하기'; }
            return;
        }

        // 이미 참가한 방에 재입장하는 경우는 중복 insert 에러를 무시하고 진행한다.
        const { error: joinErr } = await MultiplayerRooms.joinRoom(room.id);
        if (joinErr && !/duplicate|already/i.test(joinErr.message || '')) {
            const msg = /row-level security|policy/i.test(joinErr.message || '')
                ? '방이 가득 찼습니다.'
                : '참가에 실패했습니다: ' + joinErr.message;
            this._showMsg(msg);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '참가하기'; }
            return;
        }

        const { data: chart, error: chartErr } = await CloudBrowse.getBeatmapDetail(room.chart_id);
        if (chartErr) {
            this._showMsg('채보 정보를 불러오지 못했습니다.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '참가하기'; }
            return;
        }

        this._room = room;
        this._chart = chart;
        this._userId = user.id;
        this._isHost = room.host_id === user.id;
        await this._enterWaitingRoom();
    },

    // ════════════════════════════════════════════════════════════════════════
    // 호스트 — 방 생성 (Online 채보 선택 모드에서 호출됨)
    // ════════════════════════════════════════════════════════════════════════
    // 성공 시 true, 실패 시 false를 반환. 화면 전환은 이 안에서 모두 처리한다.
    async hostRoom(chart) {
        this._teardownRealtime();
        UI.showScreen('multiplayer');
        this._renderShell();
        this._view = 'waiting';
        this._setContent(UI.loadingBlockHtml('방 만드는 중…'));

        const user = await CloudAuth.getUser();
        if (!user) {
            // _renderMenu()가 내부에서 _showMsg('')를 호출해 메시지를 지우므로,
            // 반드시 _renderMenu() 이후에 _showMsg()를 불러야 에러가 화면에 남는다.
            this._renderMenu();
            this._showMsg('로그인이 필요합니다.');
            return false;
        }

        const { data: room, error } = await MultiplayerRooms.createRoom(chart.id);
        if (error) {
            this._renderMenu();
            this._showMsg('방 생성에 실패했습니다: ' + error.message);
            return false;
        }

        this._room = room;
        this._chart = chart;
        this._userId = user.id;
        this._isHost = true;
        await this._enterWaitingRoom();
        return true;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 대기실
    // ════════════════════════════════════════════════════════════════════════
    async _enterWaitingRoom() {
        this._view = 'waiting';
        this._showMsg('');
        GameBackground.set(CloudCharts.getCoverUrl(this._chart.cover_storage_path));
        // DB에서 한 번 초기 스냅샷을 가져와 닉네임/준비 상태를 seed한다 —
        // 이후 실시간 갱신은 Presence sync가 담당한다.
        await this._refreshPlayers();
        await this._refreshQueueDetails();
        this._renderWaiting();

        // 채보/오디오는 미리 받아둔다 — "시작" 버튼을 눌렀을 때 다운로드/디코딩 대기 없이
        // 바로 예약 재생(AudioEngine.play(when))할 수 있어야 동시 시작 정확도가 올라간다.
        this._preloadChart();

        const ok = await this._connectRealtime();
        if (!ok) {
            this._showMsg('실시간 연결에 실패했습니다. 목록이 자동으로 갱신되지 않을 수 있어요.');
            this._renderReconnectButton();
        }
    },

    // 채보 데이터 다운로드 + 오디오 디코딩을 미리 시작해둔다. 여러 번 불려도 한 번만 실행됨.
    // 진행 중에는 _preloading을 켜서 대기실 화면이 준비/시작 버튼을 막고 로딩 표시를 보여주게 한다.
    _preloadChart() {
        if (this._preload || this._preloadPromise) return this._preloadPromise || Promise.resolve(true);
        this._preloading = true;
        if (this._view === 'waiting') this._renderWaiting();
        this._preloadPromise = (async () => {
            try {
                const { data: chartData, error } = await CloudCharts.downloadChartData(this._chart.chart_storage_path);
                if (error) throw error;
                const audioUrl = CloudCharts.getAudioUrl(this._chart.audio_storage_path);
                // 오디오 fetch+decode를 지금 미리 시작해둔다(실제 재생은 나중에 when으로 예약).
                DOM.musicPlayer.src = audioUrl;
                this._preload = { chartData, audioUrl };
                return true;
            } catch (err) {
                Debugger?.logError?.(err, 'MultiplayerLobby:preload');
                this._preload = null;
                return false;
            } finally {
                this._preloadPromise = null;
                this._preloading = false;
                if (this._view === 'waiting') this._renderWaiting();
            }
        })();
        return this._preloadPromise;
    },

    // Realtime 채널 연결 + 내 상태 Presence로 track + 호스트 기준 클록 동기화 시작.
    // 전제: 이 시점엔 이미 beat_room_players에 내 row가 있어야 한다(RLS) —
    // createRoom/joinRoom이 항상 connect보다 먼저 끝나 있으므로 순서는 보장됨.
    async _connectRealtime() {
        try {
            await MultiplayerRealtime.connect(this._room.id, { presenceKey: this._userId });
        } catch (err) {
            Debugger?.logError?.(err, 'MultiplayerLobby:connect');
            return false;
        }

        MultiplayerRealtime.onPresenceChange(state => this._onPresenceSync(state));
        MultiplayerRealtime.on('start', payload => this._onStartBroadcast(payload));
        MultiplayerRealtime.on('host_transferred', payload => this._onHostTransferred(payload));
        MultiplayerRealtime.on('preload_failed', payload => this._onPeerPreloadFailed(payload));
        MultiplayerRealtime.on('kicked', payload => this._onKicked(payload));
        MultiplayerRealtime.on('restart_vote', payload => this._onRestartVote(payload));
        MultiplayerRealtime.on('restart_start', payload => this._onRestartStartBroadcast(payload));
        MultiplayerRealtime.on('max_players_updated', payload => this._onMaxPlayersUpdated(payload));
        MultiplayerRealtime.on('queue_updated', () => this._onQueueUpdated());
        MultiplayerRealtime.on('chart_advanced', payload => this._onChartAdvanced(payload));

        // 호스트 기준 시간 오프셋 추정 — "시작" 버튼을 누르기 한참 전부터 미리 해둬야
        // 실제 시작 시점엔 이미 값이 준비돼 있다(참가자는 ping 왕복에 ~1초 걸림).
        // 이 promise를 들고 있다가, 혹시 아직 안 끝난 채로 'start'가 도착하면
        // _onStartBroadcast/_onRestartStartBroadcast에서 반드시 먼저 기다린다.
        this._clockSyncPromise = MultiplayerRealtime.syncClockWithHost({ isHost: this._isHost }).catch(() => {});

        const self = this._players.find(p => p.user_id === this._userId);
        await MultiplayerRealtime.trackPresence({
            user_id: this._userId,
            nickname: self?.nickname || null,
            ready: !!self?.ready,
        });
        return true;
    },

    _teardownRealtime() {
        if (MultiplayerRealtime.isConnected) {
            MultiplayerRealtime.untrackPresence();
            MultiplayerRealtime.disconnect();
        }
    },

    // 연결 실패 시 대기실 하단에 "다시 연결" 버튼을 붙인다.
    _renderReconnectButton() {
        const el = document.getElementById('mp-content');
        if (!el || document.getElementById('mp-reconnect-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'mp-reconnect-btn';
        btn.textContent = '다시 연결';
        btn.className = 'w-full py-2 mt-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '연결하는 중…';
            const ok = await this._connectRealtime();
            if (ok) {
                this._showMsg('');
                btn.remove();
            } else {
                btn.disabled = false;
                btn.textContent = '다시 연결';
            }
        });
        el.appendChild(btn);
    },

    // Presence sync 스냅샷 → 플레이어 목록. presence가 실시간 소스이므로
    // 이 시점부터는 DB 폴링 없이 이 콜백만으로 대기실 목록이 갱신된다.
    _onPresenceSync(state) {
        if (this._view !== 'waiting' || !this._room) return;
        const hostId = this._room.host_id;
        const list = Object.values(state)
            .map(metas => metas[metas.length - 1])
            .filter(Boolean)
            .map(m => ({ user_id: m.user_id, nickname: m.nickname, ready: !!m.ready }));
        list.sort((a, b) => (a.user_id === hostId ? -1 : b.user_id === hostId ? 1 : 0));
        this._players = list;
        this._renderWaiting();
    },

    // 나간 호스트를 대신해 새 호스트가 정해졌을 때 — 로컬 상태와 화면을 즉시 갱신한다.
    _onHostTransferred(payload) {
        if (!this._room || this._view !== 'waiting') return;
        this._room.host_id = payload.newHostId;
        this._isHost = (this._userId === payload.newHostId);
        this._renderWaiting();
    },

    // 산정 난이도(difficulty_score) → 색상. Online._ratingColor와 동일한 팔레트를 그대로 씀.
    _ratingColor(rating) {
        if (rating >= 8) return '#fc8181';
        if (rating >= 6) return '#f6ad55';
        if (rating >= 4) return '#ffd700';
        if (rating >= 2) return '#68d391';
        return '#63b3ed';
    },

    // 별점 배지 하나. 대기실에서는 곡보다 난이도 정보(별점/난이도명/키 수)를 우선 보여주기 위해 씀.
    _diffBadgeHtml(difficultyScore, sizeCls = 'text-xs') {
        const rating = Difficulty.toRating(difficultyScore || 0);
        const color = this._ratingColor(rating);
        return `<span class="inline-flex items-center ${sizeCls} font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0" style="background:${color}22;color:${color};border:1px solid ${color}66;">★ ${rating.toFixed(2)}</span>`;
    },

    async _refreshPlayers() {
        if (!this._room) return;
        const { data } = await MultiplayerRooms.listPlayers(this._room.id);
        this._players = data || [];
    },

    // room.chart_queue(id 배열)에 대응하는 표시용 요약(난이도 라벨/키수/산정 난이도)을 받아온다.
    // 큐 순서를 그대로 유지하기 위해 반환된 결과를 id 순서대로 다시 정렬한다.
    async _refreshQueueDetails() {
        const ids = Array.isArray(this._room?.chart_queue) ? this._room.chart_queue : [];
        if (ids.length === 0) { this._queueDetails = []; return; }
        const { data } = await CloudBrowse.getChartsByIds(ids);
        const byId = {};
        (data || []).forEach(c => { byId[c.id] = c; });
        this._queueDetails = ids.map(id => byId[id]).filter(Boolean);
    },

    // ── 대기열 추가 — 대기실 "+ 채보 추가" → Online 채보 선택(pickMode:'queue')에서 호출됨.
    // 성공/실패 관계없이 대기실로 돌아간다(방을 나가지 않음).
    async addToQueue(chartId) {
        if (!this._room || !this._isHost) { this.show(); return; }

        const { data, error } = await MultiplayerRooms.addChartToQueue(this._room.id, chartId);

        UI.showScreen('multiplayer');
        this._renderShell();
        this._view = 'waiting';
        if (this._chart) GameBackground.set(CloudCharts.getCoverUrl(this._chart.cover_storage_path));

        if (error) {
            await this._refreshQueueDetails();
            this._renderWaiting();
            this._showMsg('대기열 추가에 실패했습니다: ' + error.message);
            return;
        }

        this._room.chart_queue = data.chart_queue;
        await this._refreshQueueDetails();
        this._renderWaiting();
        await MultiplayerRealtime.send('queue_updated', {}).catch(() => {});
    },

    // 호스트 전용: 대기열에서 항목 하나 제거.
    async _removeFromQueue(chartId) {
        if (!this._room || !this._isHost) return;
        const nextQueue = (Array.isArray(this._room.chart_queue) ? this._room.chart_queue : [])
            .filter(id => id !== chartId);
        const { error } = await MultiplayerRooms.setChartQueue(this._room.id, nextQueue);
        if (error) { this._showMsg('대기열 제거에 실패했습니다: ' + error.message); return; }
        this._room.chart_queue = nextQueue;
        await this._refreshQueueDetails();
        this._renderWaiting();
        await MultiplayerRealtime.send('queue_updated', {}).catch(() => {});
    },

    // Online 채보 선택 화면(pickMode:'queue')에서 뒤로가기를 눌렀을 때 — 방은 그대로 두고
    // 대기실 화면으로만 복귀한다(hostRoom의 pickMode처럼 show()로 전체 리셋하지 않음).
    cancelQueuePick() {
        if (!this._room) { this.show(); return; }
        UI.showScreen('multiplayer');
        this._renderShell();
        this._view = 'waiting';
        if (this._chart) GameBackground.set(CloudCharts.getCoverUrl(this._chart.cover_storage_path));
        this._renderWaiting();
    },

    // 호스트가 대기열을 추가/제거했을 때 — 참가자 쪽 화면도 갱신한다.
    async _onQueueUpdated() {
        if (this._isHost || !this._room || this._view !== 'waiting') return;
        const { data: room } = await MultiplayerRooms.getRoom(this._room.id);
        if (room) this._room.chart_queue = room.chart_queue;
        await this._refreshQueueDetails();
        this._renderWaiting();
    },

    // 호스트가 대기열의 다음 채보로 넘어갔을 때(참가자 쪽에서만 수신) — 내 화면의 현재 채보를
    // 갱신하고 바로 프리로드를 시작해둔다. 'restart_start'가 뒤이어 도착하며,
    // 그 핸들러(_onRestartStartBroadcast)가 이 갱신이 끝나길 기다린 뒤 시작을 진행한다.
    _onChartAdvanced(payload) {
        if (this._isHost || !this._room || !payload?.chartId) return;
        this._chartAdvancePromise = (async () => {
            try {
                const { data: chart, error } = await CloudBrowse.getBeatmapDetail(payload.chartId);
                if (error || !chart) return;
                this._room.chart_id = payload.chartId;
                // 소비되고 남은 대기열도 같이 반영해야 "다음 순서 대기열" 목록이 갱신된다.
                if (Array.isArray(payload.chartQueue)) this._room.chart_queue = payload.chartQueue;
                this._chart = chart;
                this._preload = null;
                this._preloadPromise = null;
                GameBackground.set(CloudCharts.getCoverUrl(chart.cover_storage_path));
                await this._refreshQueueDetails();
                if (this._view === 'waiting') this._renderWaiting();
                this._preloadChart(); // 미리 받아두기 시작(대기는 안 함)
            } catch (err) {
                Debugger?.logError?.(err, 'MultiplayerLobby:chartAdvanced');
            } finally {
                this._chartAdvancePromise = null;
            }
        })();
    },

    // 같은 방의 누군가가 이번 판 프리로드에 실패했을 때 — 대기실/관전 중인 화면에 알려준다.
    // (게임에 이미 진입한 경우엔 UI가 다른 화면이라 이 메시지는 대기실에 남아있는 사람에게만 보인다.)
    _onPeerPreloadFailed(payload) {
        if (this._view !== 'waiting') return;
        const name = this._players.find(p => p.user_id === payload.userId)?.nickname || '누군가';
        this._showMsg(`${name}님이 로딩에 실패해 이번 판에 참가하지 못했습니다.`);
    },

    // 내가 강퇴당했을 때 — 방을 즉시 떠난다.
    _onKicked(payload) {
        if (payload.userId !== this._userId) return;
        this._showMsg('호스트에 의해 방에서 나가졌습니다.');
        this._leaveRoom();
    },

    // 호스트가 정원을 바꿨을 때(broadcast self:false라 호스트 자신은 안 받음).
    _onMaxPlayersUpdated(payload) {
        if (this._isHost || !this._room) return;
        this._room.max_players = payload.maxPlayers;
        this._renderWaiting();
    },

    _renderWaiting() {
        const room = this._room;
        const chart = this._chart;
        if (!room) return;

        const self = this._players.find(p => p.user_id === this._userId);
        const selfReady = !!(self && self.ready);
        const allReady = this._players.length > 0 && this._players.every(p => p.ready);
        const canStart = this._isHost && this._players.length >= 2 && allReady && !this._preloading;
        const loading = this._preloading;

        const rows = this._players.map(p => {
            const isSelf = p.user_id === this._userId;
            const isHostRow = p.user_id === room.host_id;
            const name = p.nickname ? _esc(p.nickname) : `${_esc(p.user_id.slice(0, 8))}…`;
            return `
            <div class="flex items-center justify-between py-2 px-3 rounded-lg text-sm ${isSelf ? 'bg-teal-900 border border-teal-600' : 'bg-gray-800'}">
                <span class="flex items-center gap-1 text-gray-200 truncate min-w-0">
                    ${isHostRow ? '<span title="호스트">👑</span>' : ''}
                    <span class="truncate">${name}</span>
                    ${isSelf ? '<span class="text-xs text-teal-400 flex-shrink-0">(나)</span>' : ''}
                </span>
                <span class="flex items-center gap-2 flex-shrink-0">
                    <span class="text-xs font-semibold ${p.ready ? 'text-green-400' : 'text-gray-500'}">
                        ${p.ready ? '준비 완료' : '대기 중'}
                    </span>
                    ${this._isHost && !isSelf ? `<button class="mp-kick-btn text-xs text-red-400 hover:text-red-300" data-user-id="${_esc(p.user_id)}">내보내기</button>` : ''}
                </span>
            </div>`;
        }).join('');

        this._setContent(`
        <div class="p-4 bg-gray-800 rounded-lg mb-4">
            ${chart ? `
            <p class="text-xs text-gray-500 truncate mb-1.5">${_esc(chart.artist || '—')} — ${_esc(chart.title)}</p>
            <div class="flex flex-wrap items-center gap-2">
                ${this._diffBadgeHtml(chart.difficulty_score, 'text-sm')}
                <span class="text-base font-bold text-teal-300 truncate">${_esc(chart.difficulty_label || '난이도 미지정')}</span>
                <span class="text-xs text-gray-400 flex-shrink-0">${chart.lane_count}키</span>
            </div>
            ` : ''}
            ${loading ? `
            <div class="flex items-center gap-2 mt-2 text-xs text-teal-300">
                ${UI.spinnerHtml('w-4 h-4')}
                음악과 채보를 불러오는 중…
            </div>` : ''}
            <div class="flex items-center gap-2 mt-2">
                <span class="text-xs text-gray-400 flex-shrink-0">초대 코드</span>
                <code id="mp-room-code" class="flex-1 min-w-0 px-2 py-1 bg-gray-900 rounded text-teal-300 text-sm tracking-widest text-center truncate">${_esc(room.invite_code || room.id)}</code>
                <button id="mp-copy-code-btn" class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs flex-shrink-0 transition">복사</button>
            </div>
        </div>
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-300">플레이어 (${this._players.length}/${room.max_players || 6}명)</h3>
            ${this._isHost ? `
            <select id="mp-max-players-select" class="bg-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-500">
                ${[2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${n === (room.max_players || 6) ? 'selected' : ''}>정원 ${n}명</option>`).join('')}
            </select>` : ''}
        </div>
        <div class="space-y-1.5 mb-4">${rows || `<p class="text-gray-500 text-xs text-center py-4 flex items-center justify-center gap-2">${UI.spinnerHtml('w-3.5 h-3.5')}불러오는 중…</p>`}</div>
        ${(this._isHost || this._queueDetails.length > 0) ? `
        <div class="mb-4">
            <div class="flex items-center justify-between mb-1.5">
                <h3 class="text-sm font-semibold text-gray-300">다음 순서 대기열${this._queueDetails.length ? ` (${this._queueDetails.length})` : ''}</h3>
                ${this._isHost ? `<button id="mp-add-queue-btn" class="text-xs text-teal-400 hover:text-teal-300 transition">+ 채보 추가</button>` : ''}
            </div>
            ${this._queueDetails.length > 0 ? `
            <div class="space-y-1">
                ${this._queueDetails.map((q, i) => `
                <div class="flex items-center justify-between py-1.5 px-2 bg-gray-800 rounded-lg text-xs gap-2">
                    <div class="min-w-0 flex-1">
                        <p class="text-gray-500 truncate">${i + 1}. ${_esc(q.artist || '—')} — ${_esc(q.title || '(제목 없음)')}</p>
                        <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
                            ${this._diffBadgeHtml(q.difficulty_score, 'text-[10px]')}
                            <span class="font-semibold text-teal-300">${_esc(q.difficulty_label || '난이도 미지정')}</span>
                            <span class="text-gray-400">${q.lane_count}키</span>
                        </div>
                    </div>
                    ${this._isHost ? `<button class="mp-remove-queue-btn text-red-400 hover:text-red-300 flex-shrink-0 px-1" data-id="${_esc(q.id)}" aria-label="대기열에서 제거">✕</button>` : ''}
                </div>`).join('')}
            </div>` : `<p class="text-xs text-gray-500">대기열이 비어 있어요. 다음 판은 지금 채보를 다시 플레이해요.</p>`}
        </div>` : ''}
        <button id="mp-ready-btn" ${loading ? 'disabled' : ''}
            class="w-full py-3 mb-3 rounded-lg font-bold transition ${loading ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : (selfReady ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-teal-600 hover:bg-teal-500 text-white')}">
            ${loading ? UI.loadingInlineHtml('불러오는 중…') : (selfReady ? '준비 취소' : '✓ 준비 완료')}
        </button>
        ${this._isHost ? `
        <button id="mp-start-btn" ${canStart ? '' : 'disabled'}
            class="w-full py-3 rounded-lg font-bold transition ${canStart ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}">
            ${loading ? UI.loadingInlineHtml('불러오는 중…') : `▶ 시작${this._players.length < 2 ? ' (2명 이상 필요)' : (allReady ? '' : ' (전원 준비 대기 중)')}`}
        </button>` : `
        <p class="text-center text-xs text-gray-500 py-2">호스트가 시작하기를 기다리는 중…</p>`}
        <p class="mt-4 text-xs text-gray-600 text-center">시작하면 화면 좌측 상단에서 상대 점수/콤보를 실시간으로 볼 수 있어요.</p>
        `);

        document.getElementById('mp-copy-code-btn').addEventListener('click', () => {
            const btn = document.getElementById('mp-copy-code-btn');
            navigator.clipboard?.writeText(room.invite_code || room.id).then(() => {
                if (!btn) return;
                btn.textContent = '복사됨';
                setTimeout(() => { if (btn) btn.textContent = '복사'; }, 1200);
            }).catch(() => {});
        });
        document.getElementById('mp-max-players-select')?.addEventListener('change', async (e) => {
            const next = parseInt(e.target.value, 10);
            if (next < this._players.length) {
                this._showMsg(`현재 인원(${this._players.length}명)보다 작게 설정할 수 없습니다.`);
                e.target.value = String(room.max_players || 6);
                return;
            }
            e.target.disabled = true;
            const { error } = await MultiplayerRooms.setMaxPlayers(this._room.id, next);
            if (error) {
                this._showMsg('정원 변경에 실패했습니다: ' + error.message);
                e.target.value = String(room.max_players || 6);
                e.target.disabled = false;
                return;
            }
            this._room.max_players = next;
            await MultiplayerRealtime.send('max_players_updated', { maxPlayers: next }).catch(() => {});
            this._renderWaiting();
        });
        document.getElementById('mp-add-queue-btn')?.addEventListener('click', () => {
            Online.show('browse', null, { pickMode: 'queue' });
        });
        document.querySelectorAll('.mp-remove-queue-btn').forEach(btn => {
            btn.addEventListener('click', () => this._removeFromQueue(btn.dataset.id));
        });
        document.getElementById('mp-ready-btn').addEventListener('click', () => this._toggleReady(!selfReady));
        document.getElementById('mp-start-btn')?.addEventListener('click', () => this._startRoom());
        document.querySelectorAll('.mp-kick-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const targetId = btn.dataset.userId;
                btn.disabled = true;
                const { error } = await MultiplayerRooms.kickPlayer(this._room.id, targetId);
                if (error) { this._showMsg('내보내기에 실패했습니다: ' + error.message); btn.disabled = false; return; }
                await MultiplayerRealtime.send('kicked', { userId: targetId }).catch(() => {});
            });
        });
    },

    async _toggleReady(ready) {
        if (!this._room) return;
        const { error } = await MultiplayerRooms.setReady(this._room.id, ready);
        if (error) { this._showMsg('상태 변경에 실패했습니다: ' + error.message); return; }

        // 준비 완료는 실제 사용자 제스처이므로, 여기서 AudioContext를 미리 리쥼해둔다 —
        // 나중에 실제 동시 시작 시점에 resume 대기 시간 없이 바로 정확하게 예약 재생할 수 있다.
        if (ready) AudioEngine.resumeContext().catch(() => {});

        // 낙관적 갱신 — presence sync 왕복을 기다리지 않고 내 상태를 바로 반영
        const self = this._players.find(p => p.user_id === this._userId);
        if (self) self.ready = ready;
        this._renderWaiting();

        if (MultiplayerRealtime.isConnected) {
            await MultiplayerRealtime.trackPresence({
                user_id: this._userId,
                nickname: self?.nickname || null,
                ready,
            });
        }
    },

    // 호스트 전용. 대기열에 다음 채보가 있으면 그쪽으로 넘어간다. 반환값: true면 계속
    // 진행해도 됨(넘어갔거나 큐가 비어 원래 채보 유지), false면 실패해서 메시지까지 띄운 상태.
    async _advanceQueueIfNeeded() {
        const { data: advanced, error: advanceErr } = await MultiplayerRooms.advanceChartQueue(this._room.id);
        if (advanceErr) {
            this._showMsg('다음 채보로 넘어가지 못했습니다: ' + advanceErr.message);
            return false;
        }
        if (!advanced) return true; // 큐가 비어있음 — 같은 채보로 계속 진행

        const { data: chart, error: chartErr } = await CloudBrowse.getBeatmapDetail(advanced.chart_id);
        if (chartErr || !chart) {
            this._showMsg('다음 채보 정보를 불러오지 못했습니다: ' + (chartErr?.message || ''));
            return false;
        }
        this._room.chart_id = advanced.chart_id;
        this._room.chart_queue = advanced.chart_queue;
        this._chart = chart;
        this._preload = null;
        this._preloadPromise = null;
        GameBackground.set(CloudCharts.getCoverUrl(chart.cover_storage_path));
        await this._refreshQueueDetails();
        // 남은 대기열도 같이 보내야 멤버(비호스트) 쪽 화면의 "다음 순서 대기열" 목록이
        // 같이 갱신된다 — chartId만 보내면 현재 곡 표시만 바뀌고 대기열 목록은 그대로 남는다.
        await MultiplayerRealtime.send('chart_advanced', { chartId: advanced.chart_id, chartQueue: advanced.chart_queue }).catch(() => {});
        // 나(방장)의 대기실 화면도 곧바로 새 곡 정보로 다시 그려준다 — 이걸 안 하면 실제
        // 플레이는 새 곡으로 시작되는데도 "시작하는 중…" 동안 화면엔 예전 곡이 그대로 보인다.
        if (this._view === 'waiting') this._renderWaiting();
        return true;
    },

    // 호스트 전용. 목표 시작 시각(내 performance.now() 기준)을 정해 broadcast('start')로
    // 전파한 뒤, 호스트 자신도(자기 브로드캐스트는 못 받으므로) 곧바로 동시 시작을 진행한다.
    async _startRoom() {
        if (!this._room || !this._isHost || this._starting) return;
        const startBtn = document.getElementById('mp-start-btn');
        if (startBtn) { startBtn.disabled = true; startBtn.textContent = '시작하는 중…'; }
        this._showMsg('');

        await AudioEngine.resumeContext().catch(() => {});

        const ok = await this._preloadChart();
        if (!ok) {
            this._showMsg('채보를 불러오지 못해 시작할 수 없습니다.');
            if (startBtn) { startBtn.disabled = false; startBtn.textContent = '▶ 시작'; }
            return;
        }

        // 브로드캐스트 전파 + 참가자 쪽 프리로드 여유를 감안한 리드 타임.
        const LEAD_MS = 4500;
        const hostStartTime = performance.now() + LEAD_MS;

        await MultiplayerRooms.updateRoomStatus(this._room.id, 'countdown');
        // chartId를 같이 보내서, chart_advanced가 유실되거나 순서가 뒤바뀌어도 참가자 쪽이
        // 자가 교정할 수 있게 한다(_onStartBroadcast 참고).
        await MultiplayerRealtime.send('start', { hostStartTime, chartId: this._room.chart_id });

        this._beginSyncedStart(hostStartTime);
    },

    // broadcast('self:false')라 호스트는 자기 자신의 'start' 이벤트를 받지 못한다 —
    // 참가자 쪽에서만 이 핸들러로 들어온다. payload의 chartId가 내 현재 채보와 다르면(대기열
    // 전환 broadcast를 놓쳤거나 순서가 뒤바뀐 경우) 여기서 직접 다시 받아와 바로잡는다.
    //
    // 클록 오프셋 추정(_clockSyncPromise)이 아직 안 끝났으면 toLocalTime() 변환에 초기값(0)이
    // 쓰여 목표 시각이 완전히 어긋난다 — 참가자가 대기실에 들어오자마자 프리로드를 빨리 끝내고
    // 방장도 그만큼 빨리 "시작"을 누르면(=참가자 준비 완료가 빨라 클록 동기화용 ping 왕복이
    // 끝나기 전에 브로드캐스트가 도착) 발생하며, 그 상태로 시작하면 진행 시간이 처음부터
    // 크게 어긋나 있어 노트가 시작하자마자 전부 미스 처리되고 0점으로 강제 종료된다.
    // 그래서 반드시 이 promise가 끝난 뒤에(늦어도 syncClockWithHost의 자체 타임아웃 내에)
    // toLocalTime()을 호출해야 한다.
    async _onStartBroadcast(payload) {
        if (this._isHost || this._view !== 'waiting' || this._starting) return;
        if (this._clockSyncPromise) await this._clockSyncPromise.catch(() => {});
        if (this._isHost || this._view !== 'waiting' || this._starting) return;
        if (this._chartAdvancePromise) await this._chartAdvancePromise.catch(() => {});
        if (payload?.chartId && this._chart?.id !== payload.chartId) {
            const { data: chart, error } = await CloudBrowse.getBeatmapDetail(payload.chartId);
            if (!error && chart) {
                this._room.chart_id = payload.chartId;
                this._chart = chart;
                this._preload = null;
                this._preloadPromise = null;
                GameBackground.set(CloudCharts.getCoverUrl(chart.cover_storage_path));
            }
        }
        const targetLocalTime = MultiplayerRealtime.toLocalTime(payload.hostStartTime);
        this._beginSyncedStart(targetLocalTime);
    },

    // targetPerfTime: 이 클라이언트의 performance.now() 기준 목표 시작 시각.
    async _beginSyncedStart(targetPerfTime) {
        if (this._starting) return;
        this._starting = true;
        this._view = 'starting';

        let ok = await this._preloadChart();
        if (!ok) {
            // 첫 실패는 조용히 한 번 더 시도 — 일시적 네트워크 지연일 수 있음.
            this._preload = null;
            ok = await this._preloadChart();
        }
        if (!ok) {
            await MultiplayerRealtime.send('preload_failed', { userId: this._userId }).catch(() => {});
            this._showMsg('채보를 불러오지 못해 이번 판에 참가할 수 없습니다. 다음 판을 기다려주세요.');
            this._starting = false;
            this._view = 'waiting';
            this._renderWaiting();
            return;
        }
        await AudioEngine.resumeContext().catch(() => {});

        // 대기실 Realtime 연결은 유지한다 — 진행 중 관전 HUD가 이 채널을 그대로 쓴다.
        // 상대 목록(나를 제외)은 대기실에서 이미 갖고 있던 _players 스냅샷으로 넘긴다 —
        // 게임 중에는 presence sync를 다시 안 쓰므로 시작 시점 스냅샷이면 충분하다.
        await Game.startMultiplayer({
            chartData: this._preload.chartData,
            audioUrl: this._preload.audioUrl,
            startOffsetMs: this._chart.start_offset_ms || 0,
            targetPerfTime,
            onlineChartId: this._chart.id,
            userId: this._userId,
            roomId: this._room.id,
            opponents: this._players
                .filter(p => p.user_id !== this._userId)
                .map(p => ({ user_id: p.user_id, nickname: p.nickname })),
        });
    },

    // 결과 화면에서 "방으로 돌아가기"를 눌렀을 때 쓰는 진입점.
    // show()와 달리 방을 나가는 게 아니라 대기실로 되돌아간다 — 방 row는 게임이 끝나도
    // 지워지지 않으므로(status만 finished), 굳이 나갈 필요가 없다.
    // 내 준비 상태만 해제한다(다른 사람 상태는 그대로 둔다) — 대기실에서 다시
    // "준비 완료"를 눌러야 이후 시작이 가능해진다.
    async returnToWaitingRoom() {
        if (!this._room) { this.show(); return; }
        await MultiplayerRooms.setReady(this._room.id, false).catch(() => {});
        await this._afterReturnToRoom();
    },

    // 결과 화면 진입 시(게임 종료) game.js에서 호출한다 — 재시작 투표 상태를 초기화하고
    // "재시작" 버튼 표시를 리셋한다.
    resetResultButtons() {
        this._restartVotes = new Set();
        this._restartRequested = false;
        this._restarting = false;
        this._resultTotal = (Game.state._multiplayerOpponents?.length || 0) + 1;
        this._hasPlayedOnce = true;
        this._pendingQueueAdvance = true; // 대기실로 돌아가면(또는 즉시 재시작하면) 큐를 한 번 소비해야 함
        this._updateRestartButton();
    },

    // 결과 화면 "재시작" 버튼. 누르면 내 투표를 등록하고 broadcast로 알린다.
    // 전원(나 + opponents)이 동의하면 방(대기실) 화면을 거치지 않고 바로 다시 시작한다.
    requestRestart() {
        if (!this._room || !this._userId || this._restartRequested) return;
        this._restartRequested = true;
        this._restartVotes.add(this._userId);
        MultiplayerRealtime.send('restart_vote', { userId: this._userId }).catch(() => {});
        this._updateRestartButton();
        this._maybeStartRestart();
    },

    // 상대가 "재시작"을 눌러 'restart_vote'를 broadcast했을 때.
    _onRestartVote(payload) {
        if (!this._room || !payload?.userId) return;
        this._restartVotes.add(payload.userId);
        this._updateRestartButton();
        this._maybeStartRestart();
    },

    _updateRestartButton() {
        const btn = document.getElementById('mp-restart-btn');
        if (!btn) return;
        const total = this._resultTotal || ((Game.state._multiplayerOpponents?.length || 0) + 1);
        if (this._restartVotes.size === 0) {
            btn.disabled = false;
            btn.textContent = '🔁 재시작';
        } else {
            btn.disabled = true;
            btn.textContent = `재시작 요청됨 (${this._restartVotes.size}/${total})`;
        }
    },

    // 전원이 재시작에 동의하면 호스트가 새 목표 시각을 broadcast('restart_start')로 전파하고
    // 대기실 화면을 거치지 않은 채 바로 동시 시작을 진행한다(_startRoom()과 원리는 동일).
    // 대기열에 다음 채보가 있으면 먼저 그쪽으로 넘어간다 — 큐가 비어있을 때만 같은 채보로 재도전한다.
    async _maybeStartRestart() {
        const total = this._resultTotal || ((Game.state._multiplayerOpponents?.length || 0) + 1);
        if (this._restartVotes.size < total) return;
        if (!this._isHost || !this._room || this._restarting) return;
        this._restarting = true;

        const advanceOk = await this._advanceQueueIfNeeded();
        if (advanceOk) this._pendingQueueAdvance = false; // 성공했을 때만 소비 처리(실패하면 대기실 복귀 시 재시도)
        if (!advanceOk) {
            this._restarting = false;
            this._restartVotes.delete(this._userId);
            this._restartRequested = false;
            this._updateRestartButton();
            return;
        }

        const ok = await this._preloadChart(); // 이미 캐시돼 있으면 즉시 true로 resolve됨
        if (!ok) {
            this._restarting = false;
            this._restartVotes.delete(this._userId);
            this._restartRequested = false;
            this._updateRestartButton();
            this._showMsg('채보를 다시 불러오지 못해 재시작할 수 없습니다.');
            return;
        }

        const LEAD_MS = 4500;
        const hostStartTime = performance.now() + LEAD_MS;
        await MultiplayerRooms.updateRoomStatus(this._room.id, 'countdown');
        // chartId를 같이 보내서, 참가자 쪽에서 chart_advanced가 어떤 이유로든(메시지 순서 뒤바뀜,
        // 유실 등) 아직 반영되기 전에 이 broadcast를 먼저 처리하더라도 자기 자신을 교정할 수 있게 한다.
        await MultiplayerRealtime.send('restart_start', { hostStartTime, chartId: this._room.chart_id }).catch(() => {});
        this._beginInstantRestart(hostStartTime);
    },

    // broadcast('self:false')라 호스트는 자기 자신의 'restart_start' 이벤트를 받지 못한다 —
    // 참가자 쪽에서만 이 핸들러로 들어온다. 큐가 다음 채보로 넘어간 경우 'chart_advanced'가
    // 먼저 도착해 있어야 하므로, 아직 처리 중이면(_chartAdvancePromise) 끝날 때까지 기다린다.
    // 그래도 payload의 chartId와 내 현재 채보가 다르면(메시지 순서가 뒤바뀌었거나 chart_advanced
    // 자체를 못 받은 경우) 여기서 직접 다시 받아와 스스로 바로잡는다 — 그렇지 않으면
    // "다음 채보가 있는데 안 넘어가고 이전 곡이 반복 재생되는" 현상이 생긴다.
    async _onRestartStartBroadcast(payload) {
        if (this._isHost || !this._room || this._restarting) return;
        this._restarting = true;
        // 재시작 시점엔 보통 이미 오래전에 끝나있지만(첫 판 클록 동기화가 이미 완료됐을 것이므로),
        // 혹시 모를 경합을 막기 위해 _onStartBroadcast와 동일하게 한 번 더 확인한다.
        if (this._clockSyncPromise) await this._clockSyncPromise.catch(() => {});
        if (this._chartAdvancePromise) await this._chartAdvancePromise.catch(() => {});
        if (payload?.chartId && this._chart?.id !== payload.chartId) {
            const { data: chart, error } = await CloudBrowse.getBeatmapDetail(payload.chartId);
            if (!error && chart) {
                this._room.chart_id = payload.chartId;
                this._chart = chart;
                this._preload = null;
                this._preloadPromise = null;
                GameBackground.set(CloudCharts.getCoverUrl(chart.cover_storage_path));
            }
        }
        const targetLocalTime = MultiplayerRealtime.toLocalTime(payload.hostStartTime);
        this._beginInstantRestart(targetLocalTime);
    },

    // 결과 화면에서 바로 재시작 — 대기실을 거치지 않는다는 점만 빼면 _beginSyncedStart와 동일하다.
    // 이전 판이 끝난 뒤에도 _starting이 true로 남아있으므로 여기서 직접 풀어준다.
    _beginInstantRestart(targetPerfTime) {
        this._starting = false;
        this._restartVotes = new Set();
        this._restartRequested = false;
        this._beginSyncedStart(targetPerfTime);
    },

    // 방으로 돌아가기 진입 공통 처리 — 결과 화면 정리 + 게임 시작 전 대기실 상태로 복귀.
    async _afterReturnToRoom() {
        Game._teardownMultiplayerFinish(); // 내부에서 UI.hideMultiplayerResultCompare()까지 정리됨
        this._restartVotes = new Set();
        this._restartRequested = false;
        this._restarting = false;
        this._room.status = 'waiting';
        this._room.started_at = null;
        this._starting = false;
        this._preload = null;
        this._preloadPromise = null;
        this._preloading = false;

        // 대기열에 다음 채보가 있으면 대기실로 돌아가는 시점에 그걸 "현재 채보"로 승격해서
        // 초대 코드 위 곡 정보 카드에 갖다 붙인다 — "즉시 재시작"(전원 투표 → _maybeStartRestart)
        // 흐름에서는 이미 하던 걸, "방으로 돌아가기" 흐름에도 동일하게 적용한다.
        // _pendingQueueAdvance는 이번 판이 끝난 뒤(resetResultButtons) 아직 큐를 소비하지
        // 않았음을 나타내는 1회성 플래그 — 성공했을 때만 꺼서, 실패 시 다음에 다시 시도되게 한다.
        // 큐 승격은 방장만 DB에 반영할 수 있다(advanceChartQueue가 호스트 전용) — 참가자는
        // 방장이 broadcast하는 'chart_advanced'를 _onChartAdvanced에서 그대로 받아 반영한다.
        if (this._isHost && this._pendingQueueAdvance) {
            const advanceOk = await this._advanceQueueIfNeeded();
            if (advanceOk) this._pendingQueueAdvance = false;
        }

        UI.showScreen('multiplayer');
        await this._enterWaitingRoom();
    },

    async _leaveRoom() {
        this._teardownRealtime();
        GameBackground.clear();
        const roomId = this._room?.id;
        const wasHost = this._isHost;

        if (roomId) {
            // 순서 중요: 호스트 위임 판단(transferHost → listPlayers)은 반드시 내(호스트) 자신의
            // beat_room_players row가 아직 있는 상태에서 먼저 해야 한다. beat_room_players의
            // SELECT RLS가 "그 방의 멤버만 목록을 읽을 수 있다"는 조건이라, 내 row를 먼저
            // 지워버리면(= leaveRoom을 먼저 호출하면) 그 순간부터 나는 더 이상 그 방의 멤버가
            // 아니게 되어 다른 참가자가 남아있어도 listPlayers가 항상 빈 배열을 돌려준다 —
            // 즉 호스트가 나갈 때마다 참가자가 남아있는지와 무관하게 무조건 방이 abandoned
            // 처리되던 버그가 있었다. 그래서 transferHost를 먼저 하고, 내 row 삭제(leaveRoom)는
            // 그다음에 한다.
            if (wasHost) {
                const { data: newHost } = await MultiplayerRooms.transferHost(roomId);
                if (newHost) {
                    await MultiplayerRealtime.send('host_transferred', { newHostId: newHost.user_id }).catch(() => {});
                } else {
                    // 남은 사람이 없음 — 방을 abandoned로 정리(크론이 나중에 완전히 삭제)
                    await MultiplayerRooms.updateRoomStatus(roomId, 'abandoned');
                }
            }
            await MultiplayerRooms.leaveRoom(roomId);
        }

        this._room = null;
        this._chart = null;
        this._players = [];
        this._isHost = false;
        this._preload = null;
        this._preloadPromise = null;
        this._preloading = false;
        this._starting = false;
        this._restartVotes = new Set();
        this._restartRequested = false;
        this._restarting = false;
        this._resultTotal = 0;
        this._renderMenu();
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerLobby;
}