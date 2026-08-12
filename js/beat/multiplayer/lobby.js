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
    _starting: false,        // 동시 시작 진행 중 중복 트리거 방지

    // ── 진입점 ────────────────────────────────────────────────────────────────
    show() {
        this._teardownRealtime();
        this._room = null;
        this._chart = null;
        this._players = [];
        this._isHost = false;
        this._preload = null;
        this._preloadPromise = null;
        this._starting = false;
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
        if (this._view === 'waiting') {
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

        const { data: room, error: roomErr } = await MultiplayerRooms.getRoom(roomId);
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
        this._setContent('<p class="text-gray-400 text-sm mt-8 text-center animate-pulse">방 만드는 중…</p>');

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
        // DB에서 한 번 초기 스냅샷을 가져와 닉네임/준비 상태를 seed한다 —
        // 이후 실시간 갱신은 Presence sync가 담당한다.
        await this._refreshPlayers();
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
    _preloadChart() {
        if (this._preload || this._preloadPromise) return this._preloadPromise || Promise.resolve(true);
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
        MultiplayerRealtime.on('rematch', () => this._onRematchBroadcast());

        // 호스트 기준 시간 오프셋 추정 — "시작" 버튼을 누르기 한참 전부터 미리 해둬야
        // 실제 시작 시점엔 이미 값이 준비돼 있다(참가자는 ping 왕복에 ~1초 걸림).
        MultiplayerRealtime.syncClockWithHost({ isHost: this._isHost }).catch(() => {});

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

    async _refreshPlayers() {
        if (!this._room) return;
        const { data } = await MultiplayerRooms.listPlayers(this._room.id);
        this._players = data || [];
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

    _renderWaiting() {
        const room = this._room;
        const chart = this._chart;
        if (!room) return;

        const self = this._players.find(p => p.user_id === this._userId);
        const selfReady = !!(self && self.ready);
        const allReady = this._players.length > 0 && this._players.every(p => p.ready);
        const canStart = this._isHost && this._players.length >= 2 && allReady;

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
            <p class="font-semibold text-white truncate">${_esc(chart.title)}</p>
            <p class="text-sm text-gray-400 truncate">${_esc(chart.artist || '—')}</p>
            ` : ''}
            <div class="flex items-center gap-2 mt-2">
                <span class="text-xs text-gray-400 flex-shrink-0">초대 코드</span>
                <code id="mp-room-code" class="flex-1 min-w-0 px-2 py-1 bg-gray-900 rounded text-teal-300 text-sm tracking-widest text-center truncate">${_esc(room.invite_code || room.id)}</code>
                <button id="mp-copy-code-btn" class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs flex-shrink-0 transition">복사</button>
            </div>
        </div>
        <h3 class="text-sm font-semibold text-gray-300 mb-2">플레이어 (${this._players.length}/${room.max_players || 6}명)</h3>
        <div class="space-y-1.5 mb-4">${rows || '<p class="text-gray-500 text-xs text-center py-4">불러오는 중…</p>'}</div>
        <button id="mp-ready-btn" class="w-full py-3 mb-3 rounded-lg font-bold transition ${selfReady ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-teal-600 hover:bg-teal-500 text-white'}">
            ${selfReady ? '준비 취소' : '✓ 준비 완료'}
        </button>
        ${this._isHost ? `
        <button id="mp-start-btn" ${canStart ? '' : 'disabled'}
            class="w-full py-3 rounded-lg font-bold transition ${canStart ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}">
            ▶ 시작${this._players.length < 2 ? ' (2명 이상 필요)' : (allReady ? '' : ' (전원 준비 대기 중)')}
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
        await MultiplayerRealtime.send('start', { hostStartTime });

        this._beginSyncedStart(hostStartTime);
    },

    // broadcast('self:false')라 호스트는 자기 자신의 'start' 이벤트를 받지 못한다 —
    // 참가자 쪽에서만 이 핸들러로 들어온다.
    _onStartBroadcast(payload) {
        if (this._isHost || this._view !== 'waiting' || this._starting) return;
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

    // 결과 화면에서 호스트가 "재도전"을 눌렀을 때. DB를 초기화하고 다른 클라이언트에게 알린 뒤
    // 자신도 대기실로 복귀한다.
    async rematch() {
        if (!this._room || !this._isHost) return;
        const btn = document.getElementById('mp-rematch-btn');
        if (btn) { btn.disabled = true; btn.textContent = '준비하는 중…'; }

        const { error } = await MultiplayerRooms.resetForRematch(this._room.id);
        if (error) {
            if (btn) {
                btn.textContent = '재도전 실패: ' + error.message;
                setTimeout(() => {
                    if (btn) { btn.disabled = false; btn.textContent = '🔁 재도전 (같은 멤버로 다시 시작)'; }
                }, 2500);
            }
            return;
        }

        await MultiplayerRealtime.send('rematch', {}).catch(() => {});
        await this._afterRematchReset();
    },

    // 호스트가 아닌 클라이언트가 'rematch' broadcast를 받았을 때(broadcast self:false라
    // 호스트 자신은 이 핸들러를 타지 않음 — 호스트는 rematch()에서 직접 처리).
    _onRematchBroadcast() {
        if (this._isHost || !this._room) return;
        this._afterRematchReset();
    },

    // 재도전 진입 공통 처리 — 결과 화면 정리 + 게임 시작 전 대기실 상태로 복귀.
    async _afterRematchReset() {
        Game._teardownMultiplayerFinish(); // 내부에서 UI.hideMultiplayerResultCompare()까지 정리됨
        this._room.status = 'waiting';
        this._room.started_at = null;
        this._starting = false;
        this._preload = null;
        this._preloadPromise = null;

        UI.showScreen('multiplayer');
        await this._enterWaitingRoom();
    },

    async _leaveRoom() {
        this._teardownRealtime();
        const roomId = this._room?.id;
        const wasHost = this._isHost;

        if (roomId) {
            await MultiplayerRooms.leaveRoom(roomId);
            if (wasHost) {
                const { data: newHost } = await MultiplayerRooms.transferHost(roomId);
                if (!newHost) {
                    // 남은 사람이 없음 — 방을 abandoned로 정리(크론이 나중에 완전히 삭제)
                    await MultiplayerRooms.updateRoomStatus(roomId, 'abandoned');
                } else {
                    await MultiplayerRealtime.send('host_transferred', { newHostId: newHost.user_id }).catch(() => {});
                }
            }
        }

        this._room = null;
        this._chart = null;
        this._players = [];
        this._isHost = false;
        this._preload = null;
        this._preloadPromise = null;
        this._starting = false;
        this._renderMenu();
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerLobby;
}