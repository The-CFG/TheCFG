// ── MultiplayerLobby: 방 생성/참가/대기실 화면 ────────────────────────────────
// Phase 3: 대기실 인원/준비 상태를 Realtime Presence로 실시간 갱신한다(폴링 제거).
// 초기 목록은 DB(listPlayers)로 한 번 seed하고, 그 이후는 presence sync 콜백이 갱신을 담당.
// 접속 끊김은 Presence가 자동 감지해 목록에서 제거해준다. 실제 동시 시작(클록 동기화 →
// AudioEngine.play)과 진행 중 관전 HUD는 이후 단계.

const MultiplayerLobby = {
    _view: 'menu',   // 'menu' | 'join' | 'waiting'
    _room: null,     // beat_rooms row
    _chart: null,    // CloudBrowse.getBeatmapDetail() 결과
    _players: [],
    _isHost: false,
    _userId: null,

    // ── 진입점 ────────────────────────────────────────────────────────────────
    show() {
        this._teardownRealtime();
        this._room = null;
        this._chart = null;
        this._players = [];
        this._isHost = false;
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
        <input id="mp-join-code" type="text" placeholder="초대 코드" autocomplete="off" spellcheck="false"
            class="w-full p-3 mb-4 bg-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
        <button id="mp-join-submit-btn" class="w-full py-3 bg-teal-600 hover:bg-teal-500 rounded-lg font-bold transition">
            참가하기
        </button>`);

        const input = document.getElementById('mp-join-code');
        const submitBtn = document.getElementById('mp-join-submit-btn');
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
            this._showMsg('참가에 실패했습니다: ' + joinErr.message);
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
            this._showMsg('로그인이 필요합니다.');
            this._renderMenu();
            return false;
        }

        const { data: room, error } = await MultiplayerRooms.createRoom(chart.id);
        if (error) {
            this._showMsg('방 생성에 실패했습니다: ' + error.message);
            this._renderMenu();
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

        const ok = await this._connectRealtime();
        if (!ok) {
            this._showMsg('실시간 연결에 실패했습니다. 목록이 자동으로 갱신되지 않을 수 있어요.');
        }
    },

    // Realtime 채널 연결 + 내 상태 Presence로 track.
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

    async _refreshPlayers() {
        if (!this._room) return;
        const { data } = await MultiplayerRooms.listPlayers(this._room.id);
        this._players = data || [];
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
                <span class="text-xs font-semibold flex-shrink-0 ${p.ready ? 'text-green-400' : 'text-gray-500'}">
                    ${p.ready ? '준비 완료' : '대기 중'}
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
                <code id="mp-room-code" class="flex-1 min-w-0 px-2 py-1 bg-gray-900 rounded text-teal-300 text-xs truncate">${room.id}</code>
                <button id="mp-copy-code-btn" class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs flex-shrink-0 transition">복사</button>
            </div>
        </div>
        <h3 class="text-sm font-semibold text-gray-300 mb-2">플레이어 (${this._players.length}명)</h3>
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
        <p class="mt-4 text-xs text-gray-600 text-center">실시간 동시 시작(카운트다운)과 관전 HUD는 다음 단계에서 연결됩니다.</p>
        `);

        document.getElementById('mp-copy-code-btn').addEventListener('click', () => {
            const btn = document.getElementById('mp-copy-code-btn');
            navigator.clipboard?.writeText(room.id).then(() => {
                if (!btn) return;
                btn.textContent = '복사됨';
                setTimeout(() => { if (btn) btn.textContent = '복사'; }, 1200);
            }).catch(() => {});
        });
        document.getElementById('mp-ready-btn').addEventListener('click', () => this._toggleReady(!selfReady));
        document.getElementById('mp-start-btn')?.addEventListener('click', () => this._startRoom());
    },

    async _toggleReady(ready) {
        if (!this._room) return;
        const { error } = await MultiplayerRooms.setReady(this._room.id, ready);
        if (error) { this._showMsg('상태 변경에 실패했습니다: ' + error.message); return; }

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

    // 호스트 전용. 지금은 상태만 countdown으로 넘겨두는 스텁 —
    // 실제 클록 동기화·동시 시작은 4단계에서 AudioEngine.play(when)에 연결한다.
    async _startRoom() {
        if (!this._room || !this._isHost) return;
        const { error } = await MultiplayerRooms.updateRoomStatus(this._room.id, 'countdown');
        if (error) { this._showMsg('시작에 실패했습니다: ' + error.message); return; }
        this._showMsg('방이 시작 대기 상태로 전환되었습니다. 실제 동시 시작은 다음 단계에서 구현됩니다.');
    },

    async _leaveRoom() {
        this._teardownRealtime();
        const roomId = this._room?.id;
        if (roomId) await MultiplayerRooms.leaveRoom(roomId);
        this._room = null;
        this._chart = null;
        this._players = [];
        this._isHost = false;
        this._renderMenu();
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerLobby;
}