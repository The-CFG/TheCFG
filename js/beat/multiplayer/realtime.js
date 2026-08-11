/**
 * MultiplayerRealtime
 * -------------------
 * beat_rooms 하나에 대응하는 Supabase Realtime private 채널('room:<roomId>')을 감싼다.
 * 이 파일은 game/room UI를 전혀 모른다 — 순수 통신 계층. 로비/대전 화면은 이 위에 얹는다.
 *
 * 전제(RLS): beat_multiplayer_foundation_migration.sql의 realtime.messages 정책은
 * "beat_room_players에 내 row가 있어야 그 방 채널에 붙을 수 있다"는 조건이다.
 * 즉 connect(roomId)를 부르기 전에 MultiplayerRooms.joinRoom(roomId)(또는 createRoom)이
 * 먼저 성공해 있어야 한다 — 안 그러면 subscribe가 인가 실패로 거부된다.
 *
 * 제공 기능:
 *   - connect(roomId) / disconnect()
 *   - presence: trackPresence(meta), onPresenceChange(cb) — 누가 붙어있는지
 *   - broadcast: send(event, payload), on(event, cb) / off(event, cb)
 *   - 클록 동기화: syncClockWithHost({ isHost }) — 호스트 시계를 기준으로 로컬-호스트 시간 오프셋 추정.
 *     오프셋 확보 후 toHostTime(localMs) / toLocalTime(hostMs)로 상호 변환.
 *     동시 시작 시각(hostTime)을 AudioEngine.play(when)에 넘길 로컬 audioContext 시각으로
 *     바꾸는 건 이 모듈의 책임이 아니다(오디오 컨텍스트 시계와 performance.now()는 또 다른 축) —
 *     여기서는 어디까지나 "내 performance.now() 기준 호스트 시각 추정치"만 제공한다.
 */
const MultiplayerRealtime = {
    _channel: null,
    _roomId: null,
    _broadcastListeners: {},   // event -> Set<cb>
    _presenceListeners: [],    // cb(state)[]
    _clockOffsetMs: 0,         // hostTime ≈ localTime(performance.now()) + offset
    _clockSynced: false,

    // roomId의 채널에 연결한다. 연결 완료(SUBSCRIBED) 시 resolve.
    // presenceKey: presence 상태에서 나를 구분할 키(보통 user.id). 생략하면 Supabase가 임의 키를 준다.
    connect(roomId, { presenceKey } = {}) {
        if (this._channel) this.disconnect();

        this._roomId = roomId;
        this._broadcastListeners = {};
        this._presenceListeners = [];
        this._clockOffsetMs = 0;
        this._clockSynced = false;

        return new Promise((resolve, reject) => {
            const channel = _supabase.channel(`room:${roomId}`, {
                config: {
                    private: true,
                    broadcast: { self: false },
                    presence: presenceKey ? { key: presenceKey } : {},
                },
            });

            channel.on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                this._presenceListeners.forEach(cb => {
                    try { cb(state); } catch (err) { Debugger?.logError?.(err, 'MultiplayerRealtime:presence'); }
                });
            });

            channel.on('broadcast', { event: '*' }, ({ event, payload }) => {
                const set = this._broadcastListeners[event];
                if (!set) return;
                set.forEach(cb => {
                    try { cb(payload); } catch (err) { Debugger?.logError?.(err, `MultiplayerRealtime:broadcast:${event}`); }
                });
            });

            channel.subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                    this._channel = channel;
                    resolve();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    reject(err || new Error(`Realtime 채널 연결 실패: ${status}`));
                }
            });
        });
    },

    disconnect() {
        if (this._channel) {
            _supabase.removeChannel(this._channel);
            this._channel = null;
        }
        this._roomId = null;
        this._broadcastListeners = {};
        this._presenceListeners = [];
    },

    // ── Presence ──────────────────────────────────────────────────────────
    async trackPresence(meta) {
        if (!this._channel) return;
        await this._channel.track(meta);
    },

    async untrackPresence() {
        if (!this._channel) return;
        await this._channel.untrack();
    },

    onPresenceChange(cb) {
        this._presenceListeners.push(cb);
    },

    // ── Broadcast ─────────────────────────────────────────────────────────
    async send(event, payload) {
        if (!this._channel) return;
        await this._channel.send({ type: 'broadcast', event, payload });
    },

    on(event, cb) {
        if (!this._broadcastListeners[event]) this._broadcastListeners[event] = new Set();
        this._broadcastListeners[event].add(cb);
    },

    off(event, cb) {
        this._broadcastListeners[event]?.delete(cb);
    },

    // ── 클록 동기화 (호스트 기준) ─────────────────────────────────────────
    // 호스트: 'clock_ping'을 받으면 즉시 자기 performance.now()를 실어 'clock_pong'으로 되돌려준다.
    // 참가자: clock_ping을 SAMPLE_COUNT번 보내 RTT가 가장 작은 샘플로 오프셋을 계산한다.
    //         (RTT가 작을수록 편도 지연 추정 오차가 작다는 전제의 간이 NTP 방식)
    syncClockWithHost({ isHost, sampleCount = 5, intervalMs = 150 } = {}) {
        if (isHost) {
            if (this._hostPongHandler) return Promise.resolve(0); // 이미 등록됨
            this._hostPongHandler = (payload) => {
                this.send('clock_pong', { pingId: payload.pingId, hostTime: performance.now() });
            };
            this.on('clock_ping', this._hostPongHandler);
            this._clockOffsetMs = 0;
            this._clockSynced = true;
            return Promise.resolve(0);
        }

        return new Promise((resolve) => {
            const samples = [];
            let received = 0;

            const pongHandler = (payload) => {
                const t2 = performance.now();
                const sample = samples[payload.pingId];
                if (!sample) return;
                const rtt = t2 - sample.t0;
                const estimatedOffset = (payload.hostTime + rtt / 2) - t2; // hostTime ≈ localTime + offset
                samples[payload.pingId].rtt = rtt;
                samples[payload.pingId].offset = estimatedOffset;
                received++;
                if (received >= sampleCount) {
                    this.off('clock_pong', pongHandler);
                    const best = samples.filter(Boolean).reduce((a, b) => (b.rtt < a.rtt ? b : a));
                    this._clockOffsetMs = best.offset;
                    this._clockSynced = true;
                    resolve(this._clockOffsetMs);
                }
            };
            this.on('clock_pong', pongHandler);

            for (let i = 0; i < sampleCount; i++) {
                setTimeout(() => {
                    samples[i] = { t0: performance.now() };
                    this.send('clock_ping', { pingId: i });
                }, i * intervalMs);
            }

            // 안전장치: 네트워크 문제 등으로 응답이 부족하면 받은 샘플만으로(하나도 없으면 오프셋 0으로) 마무리한다.
            setTimeout(() => {
                if (received >= sampleCount) return; // 이미 정상 완료됨
                this.off('clock_pong', pongHandler);
                const got = samples.filter(Boolean).filter(s => s.rtt !== undefined);
                this._clockOffsetMs = got.length > 0
                    ? got.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset
                    : 0;
                this._clockSynced = true;
                resolve(this._clockOffsetMs);
            }, sampleCount * intervalMs + 2000);
        });
    },

    // 로컬 performance.now() 기준 시각 → 추정 호스트 시각
    toHostTime(localMs) {
        return localMs + this._clockOffsetMs;
    },

    // 추정 호스트 시각 → 로컬 performance.now() 기준 시각
    toLocalTime(hostMs) {
        return hostMs - this._clockOffsetMs;
    },

    get isConnected() {
        return !!this._channel;
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerRealtime;
}