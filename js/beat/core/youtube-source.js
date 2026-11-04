/**
 * YouTubeSource
 * -------------
 * AudioEngine과 같은 <audio> 유사 인터페이스(src, currentTime, volume, play/pause/load,
 * addEventListener ...)를 제공하는 YouTube IFrame 기반 음원 백엔드.
 * 직접 쓰지 않고 MusicPlayer(music-player.js) 파사드를 통해 DOM.musicPlayer로 사용한다.
 *
 * src 형식: 'yt:<11자 영상 ID>'
 *
 * 설계 메모 (S0 실측 기반)
 * - getCurrentTime()은 프레임 단위(~16ms)로 매끈하고 안정화 후 드리프트가 ±수 ms라서,
 *   performance.now() 보간 없이 getCurrentTime()을 그대로 게임 시계로 쓴다.
 * - 단, play 직후 PLAYING 이벤트 시점의 값은 신뢰할 수 없다(실제보다 ~240ms 앞섰다가 되돌아오는 구간).
 *   그래서 재생 중 currentTime은 단조 증가로 클램프한다 (뒤로 가는 값은 무시하고 멈춘 것처럼 둔다).
 * - 시작 지연(playVideo → PLAYING)이 ~0.7~1.0초라서 play(when)은 지연 추정치만큼 일찍 playVideo를 호출한다.
 *   지연 추정치는 실제 측정값으로 계속 갱신해서 localStorage에 저장한다.
 * - 정책: 플레이어는 재생 중 항상 보여야 한다. 호스트 요소는 src가 있을 때만 표시하고 그 위에 아무것도 얹지 않는다.
 *   기본 위치/크기는 임시(좌하단 356×200)이며 S3에서 레이아웃이 setHost()로 교체한다.
 * - S4: 광고 감지(getDuration ≠ 등록 길이 → 'ad'/'adend', 광고 중 시계 동결), 버퍼링 감지('waiting'),
 *   오류 코드 매핑(unavailable), 모바일 제스처 잠금 해제(unlock: 음소거 재생→즉시 정지).
 */
const YouTubeSource = {
    _player: null,
    _mount: null,
    _host: null,
    _apiPromise: null,
    _videoId: '',
    _src: '',
    _ready: false,
    _readyPromise: null,
    _loadToken: 0,

    _wantPlay: false,   // 재생 "의도" (play() 호출 ~ pause() 호출)
    _playing: false,    // 실제로 PLAYING 상태를 한 번이라도 찍은 뒤의 재생 중 상태
    _pausedAt: 0,
    _lastT: 0,          // 단조 증가 클램프용 마지막 반환값
    _needSeek: false,   // 아직 시작 전이라 seekTo를 play 시점으로 미뤄둔 경우

    _duration: 0,
    _volume: 1,
    _muffled: false,
    _rate: 1,

    _latencyMs: 800,
    _playCalledAt: 0,
    _playTimer: null,
    _durPoll: null,
    _adPoll: null,
    _cued: false,

    // S4 상태
    expectedDurationMs: 0,   // 등록 시 영상 길이 (광고 감지 기준). 0이면 광고 감지 안 함
    _inAd: false,
    _adSeen: false,
    _buffering: false,
    _unlocked: false,
    _unlocking: false,
    _unlockTimer: null,
    onAdDetected: null,      // 광고 최초 관찰 시 콜백 (has_ads 보고용)
    AD_TOLERANCE_SEC: 2,
    _playWaiters: [],

    _listeners: {},
    error: null,
    onloadedmetadata: null,
    _downloadLoaded: 0,
    _downloadTotal: 0,

    LATENCY_KEY: 'theBeat_ytStartLatencyMs',

    isYtSrc(url) {
        return typeof url === 'string' && /^yt:[\w-]{11}$/.test(url);
    },
    _parseId(url) {
        return this.isYtSrc(url) ? url.slice(3) : '';
    },

    // ───── IFrame API 로더 (Promise) ─────
    // 스크립트 태그가 먼저 로드되고 콜백이 나중에 정의되면 콜백을 놓칠 수 있어서
    // 콜백 선등록 + 폴링을 같이 쓴다.
    _loadApi() {
        if (this._apiPromise) return this._apiPromise;
        this._apiPromise = new Promise((resolve, reject) => {
            if (window.YT && window.YT.Player) { resolve(); return; }
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                try { if (typeof prev === 'function') prev(); } catch (e) { console.error(e); }
                resolve();
            };
            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const s = document.createElement('script');
                s.src = 'https://www.youtube.com/iframe_api';
                s.onerror = () => reject(new Error('YouTube IFrame API 로드 실패'));
                document.head.appendChild(s);
            }
            const t0 = Date.now();
            const poll = setInterval(() => {
                if (window.YT && window.YT.Player) { clearInterval(poll); resolve(); }
                else if (Date.now() - t0 > 15000) { clearInterval(poll); reject(new Error('YouTube IFrame API 타임아웃')); }
            }, 200);
        });
        this._apiPromise.catch(() => { this._apiPromise = null; });
        return this._apiPromise;
    },

    // ───── 호스트(플레이어가 들어갈 컨테이너) ─────
    // S3에서 레이아웃이 자체 컨테이너를 넘길 수 있다: YouTubeSource.setHost(el)
    setHost(el) {
        if (this._player) return; // 플레이어 생성 후에는 교체하지 않는다
        this._host = el;
        this._mount = null;
    },
    _ensureHost() {
        if (!this._host) {
            const host = document.createElement('div');
            host.id = 'yt-host';
            host.className = 'yt-host';
            // 임시 기본 배치(S3에서 교체). 정책상 다른 요소가 위를 덮지 않도록 최상단 레이어.
            Object.assign(host.style, {
                position: 'fixed', left: '8px', bottom: '8px', width: '356px', height: '200px',
                zIndex: '9999', display: 'none', background: '#000'
            });
            document.body.appendChild(host);
            this._host = host;
        }
        if (!this._mount) {
            const m = document.createElement('div');
            m.id = 'yt-player';
            this._host.appendChild(m);
            this._mount = m;
        }
        return this._host;
    },
    _show() { this._ensureHost(); if (this._host.dataset.ytManaged !== '1') this._host.style.display = 'block'; this._host.classList.add('yt-active'); },
    _hide() { if (!this._host) return; if (this._host.dataset.ytManaged !== '1') this._host.style.display = 'none'; this._host.classList.remove('yt-active'); },

    // ───── src ─────
    get src() { return this._src; },
    get downloadProgress() { return { loaded: this._downloadLoaded, total: this._downloadTotal }; },
    set src(url) {
        this._clearTimers();
        this._wantPlay = false;
        this._playing = false;
        this._pausedAt = 0;
        this._lastT = 0;
        this._needSeek = false;
        this._duration = 0;
        this.error = null;
        this._cued = false;
        this._inAd = false;
        this._adSeen = false;
        this._buffering = false;
        this._flushPlayWaiters(false);

        const id = this._parseId(url);
        this._src = id ? url : '';
        this._videoId = id;
        const token = ++this._loadToken;

        if (!id) {
            this._readyPromise = null;
            if (this._player && this._ready) { try { this._player.stopVideo(); } catch (e) { /* 무시 */ } }
            this.expectedDurationMs = 0;
            this._hide();
            return;
        }
        this._show();
        this._readyPromise = this._init(id, token);
    },

    async _init(id, token) {
        try {
            await this._loadApi();
        } catch (e) {
            if (token === this._loadToken) this._fail(0, e.message);
            return false;
        }
        if (token !== this._loadToken) return false;

        if (!this._player) {
            this._ensureHost();
            await new Promise(resolve => {
                const vars = { playsinline: 1, rel: 0, controls: 1, modestbranding: 1, disablekb: 1 };
                if (location.protocol.startsWith('http')) vars.origin = location.origin;
                this._player = new window.YT.Player(this._mount, {
                    width: '100%', height: '100%', videoId: id, playerVars: vars,
                    events: {
                        onReady: () => {
                            this._ready = true;
                            // iframe이 키 입력을 가져가 게임 입력이 끊기지 않도록 포커스 대상에서 뺀다.
                            try { this._player.getIframe().tabIndex = -1; } catch (e) { /* 무시 */ }
                            resolve();
                        },
                        onStateChange: ev => this._onState(ev.data),
                        onError: ev => this._onError(ev.data)
                    }
                });
            });
        } else {
            try { this._player.cueVideoById(id); } catch (e) { this._fail(0, e.message); return false; }
        }
        if (token !== this._loadToken) return false;
        this._applyVolume();
        this._startDurationPoll(token);
        // 삭제/임베드 금지(100/101/150) 오류는 cue 직후 비동기로 오므로, 큐 완료(state 5) 또는 오류까지 잠깐 기다린다.
        const t0 = Date.now();
        while (!this._cued && !this.error && Date.now() - t0 < 2500) {
            await new Promise(r => setTimeout(r, 80));
            if (token !== this._loadToken) return false;
        }
        return !this.error;
    },

    // 큐된 영상은 getDuration()이 0일 수 있어서 잠깐 폴링하고, 그래도 0이면 첫 PLAYING에서 채운다.
    _startDurationPoll(token) {
        clearInterval(this._durPoll);
        let tries = 0;
        this._durPoll = setInterval(() => {
            if (token !== this._loadToken || !this._player) { clearInterval(this._durPoll); return; }
            let d = 0;
            try { d = this._player.getDuration(); } catch (e) { /* 무시 */ }
            if (d > 0) { this._setDuration(d); clearInterval(this._durPoll); }
            else if (++tries > 30) clearInterval(this._durPoll);
        }, 100);
    },
    _setDuration(d) {
        if (!(d > 0) || this._duration === d) return;
        this._duration = d;
        if (typeof this.onloadedmetadata === 'function') {
            try { this.onloadedmetadata(); } catch (e) { console.error(e); }
        }
    },

    // ───── 상태 이벤트 ─────
    _onState(st) {
        if (st === 5) this._cued = true;
        // 모바일 잠금 해제 중: 첫 PLAYING에서 바로 멈추고 되돌린다 (게임 상태에는 영향 없음)
        if (this._unlocking && st === 1) {
            this._unlocking = false; this._unlocked = true;
            clearTimeout(this._unlockTimer);
            try { this._player.pauseVideo(); this._player.seekTo(this._pausedAt || 0, true); this._player.unMute(); } catch (e) { /* 무시 */ }
            this._applyVolume();
            return;
        }
        if (this._unlocking && st !== 3 && st !== -1) return;
        if (st !== 3 && this._buffering) this._buffering = false;
        switch (st) {
            case 1: { // PLAYING
                this._playing = true;
                if (this._playCalledAt) {
                    const lat = performance.now() - this._playCalledAt;
                    this._playCalledAt = 0;
                    if (lat > 100 && lat < 4000) {
                        this._latencyMs = Math.round(this._latencyMs * 0.5 + lat * 0.5);
                        try { localStorage.setItem(this.LATENCY_KEY, String(this._latencyMs)); } catch (e) { /* 무시 */ }
                    }
                }
                try { this._setDuration(this._player.getDuration()); } catch (e) { /* 무시 */ }
                this._checkAd();
                this._startAdPoll();
                this._emit('playing');
                this._flushPlayWaiters(true);
                break;
            }
            case 2: // PAUSED
                this._playing = false;
                if (this._inAd) break; // 광고 중 일시정지는 유저 일시정지로 보지 않는다
                // 우리가 멈춘 게 아닌데(= _wantPlay가 아직 true) PAUSED가 오면 유저가 플레이어 컨트롤로 멈춘 것
                if (this._wantPlay) {
                    this._pausedAt = this._lastT;
                    this._wantPlay = false;
                    this._emit('pause');
                }
                break;
            case 3: // BUFFERING
                this._buffering = true;
                this._emit('waiting');
                break;
            case 0: // ENDED
                if (this._inAd) break;
                this._playing = false;
                this._wantPlay = false;
                this._pausedAt = this._duration || this._lastT;
                this._emit('ended');
                break;
            default:
                break;
        }
    },

    _onError(code) {
        const reasons = {
            2: '잘못된 영상 ID', 5: 'HTML5 플레이어 오류', 100: '삭제되었거나 비공개인 영상',
            101: '임베드가 금지되었거나 이 지역에서 재생할 수 없는 영상', 150: '임베드가 금지되었거나 이 지역에서 재생할 수 없는 영상',
            153: 'Referer 없음(file:// 로 열었거나 Referrer-Policy 확인)'
        };
        this._fail(code, reasons[code] || ('YouTube 오류 ' + code));
    },
    _fail(ytCode, message) {
        // unavailable: 영상 자체를 쓸 수 없는 경우(삭제/비공개/임베드 금지/지역 차단) — UI에서 "영상 사용 불가"로 표시
        const unavailable = [100, 101, 150].includes(ytCode);
        this.error = { code: 4, message: unavailable ? '영상 사용 불가: ' + message : message, ytCode, unavailable };
        this._wantPlay = false;
        this._playing = false;
        this._flushPlayWaiters(false);
        this._emit('error');
    },

    // ───── 시계 ─────
    get duration() { return this._duration; },
    get paused() { return !this._wantPlay; },

    get currentTime() {
        if (this._inAd) return this._lastT; // 광고 중엔 광고 시계를 쓰지 않고 곡 시계를 동결
        if (this._wantPlay && this._playing && this._player) {
            let t = 0;
            try { t = this._player.getCurrentTime(); } catch (e) { /* 무시 */ }
            // PLAYING 직후 구간의 되감김/NaN을 막기 위한 단조 증가 클램프
            if (!(t >= this._lastT)) t = this._lastT; else this._lastT = t;
            return t;
        }
        return this._pausedAt;
    },
    set currentTime(value) {
        const t = Math.max(0, Number(value) || 0);
        this._pausedAt = t;
        this._lastT = t;
        if (!this._player || !this._ready) { this._needSeek = true; return; }
        let st = -1;
        try { st = this._player.getPlayerState(); } catch (e) { /* 무시 */ }
        // 재생/버퍼링/일시정지 상태에서는 즉시 시크. 큐/미시작/종료 상태에서 seekTo를 부르면
        // 의도치 않게 재생이 시작되므로 play() 시점으로 미룬다.
        if (st === 1 || st === 2 || st === 3) this._player.seekTo(t, true);
        else this._needSeek = true;
    },

    // ───── 재생 제어 ─────
    // when: 지금부터 몇 초 뒤에 "소리가 나기 시작해야 하는지". 시작 지연 추정치만큼 일찍 playVideo를 호출한다.
    async play(when = 0) {
        const ok = await this.whenReady();
        if (!ok) return;
        this._wantPlay = true;
        if (!this._playing) this._lastT = this._pausedAt;
        clearTimeout(this._playTimer);
        const delayMs = Math.max(0, when * 1000 - this._latencyMs);
        if (when > 0 && delayMs > 10) {
            this._playTimer = setTimeout(() => this._doPlay(), delayMs);
            return;
        }
        this._doPlay();
        if (!(when > 0)) await this._waitPlaying(10000);
    },
    _doPlay() {
        this._playTimer = null;
        if (!this._wantPlay || !this._player) return;
        if (this._unlocking) { this._unlocking = false; clearTimeout(this._unlockTimer); try { this._player.unMute(); } catch (e) { /* 무시 */ } this._applyVolume(); }
        try {
            if (this._needSeek) { this._player.seekTo(this._pausedAt, true); this._needSeek = false; }
            this._player.setPlaybackRate(this._rate);
            this._playCalledAt = performance.now();
            this._player.playVideo();
        } catch (e) {
            this._fail(0, e.message);
        }
    },
    _waitPlaying(ms) {
        return new Promise(resolve => {
            const w = { resolve };
            w.timer = setTimeout(() => { this._playWaiters = this._playWaiters.filter(x => x !== w); resolve(false); }, ms);
            this._playWaiters.push(w);
        });
    },
    _flushPlayWaiters(ok) {
        const ws = this._playWaiters; this._playWaiters = [];
        ws.forEach(w => { clearTimeout(w.timer); w.resolve(ok); });
    },

    pause() {
        clearTimeout(this._playTimer);
        this._playTimer = null;
        if (!this._wantPlay && !this._playing) return;
        const t = this.currentTime; // _wantPlay를 끄기 전에 읽는다
        this._wantPlay = false;
        this._pausedAt = t;
        this._lastT = t;
        this._playing = false;
        try { if (this._player) this._player.pauseVideo(); } catch (e) { /* 무시 */ }
        this._emit('pause');
    },

    // <audio>.load()에 대응: 진행 중인 재생을 멈춘다 (이벤트 없이).
    load() {
        this._clearTimers();
        this._wantPlay = false;
        this._playing = false;
        try { if (this._player && this._ready) this._player.pauseVideo(); } catch (e) { /* 무시 */ }
    },
    removeAttribute(name) { if (name === 'src') this.src = ''; },

    async whenReady() {
        if (!this._readyPromise) return false;
        const ok = await this._readyPromise;
        return !!ok && !this.error;
    },

    // 재생 속도 (S3/S4에서 사용). 지원 속도 밖의 값은 YouTube가 가장 가까운 값으로 맞춘다.
    get playbackRate() { return this._rate; },
    set playbackRate(v) {
        this._rate = Number(v) || 1;
        try { if (this._player && this._ready) this._player.setPlaybackRate(this._rate); } catch (e) { /* 무시 */ }
    },

    // ───── 볼륨 / 먹먹함 ─────
    get volume() { return this._volume; },
    set volume(v) {
        this._volume = Math.min(1, Math.max(0, Number(v)));
        if (Number.isNaN(this._volume)) this._volume = 1;
        this._applyVolume();
    },
    // 로우패스 필터는 못 쓰므로 볼륨만 낮춰서 "배경으로만 들려주기" 용도에 대응한다.
    setMuffled(active) { this._muffled = !!active; this._applyVolume(); },
    get muffled() { return this._muffled; },
    _applyVolume() {
        if (!this._player || !this._ready) return;
        try { this._player.setVolume(Math.round(this._volume * 100 * (this._muffled ? 0.4 : 1))); } catch (e) { /* 무시 */ }
    },

    // AudioEngine과의 호환 + 사용자 제스처 안이면 모바일 잠금 해제
    async resumeContext() { this.unlock(); },

    // ───── 이벤트 ─────
    addEventListener(evt, cb) {
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(cb);
    },
    removeEventListener(evt, cb) {
        if (!this._listeners[evt]) return;
        this._listeners[evt] = this._listeners[evt].filter(fn => fn !== cb);
    },
    _emit(evt) {
        (this._listeners[evt] || []).forEach(cb => {
            try { cb(); } catch (e) { console.error(e); }
        });
    },

    _clearTimers() {
        clearTimeout(this._playTimer); this._playTimer = null;
        clearInterval(this._durPoll); this._durPoll = null;
        clearInterval(this._adPoll); this._adPoll = null;
    },

    // ───── 광고 감지 (S4) ─────
    // 광고 중에는 getDuration()이 광고 길이가 되므로 등록 길이(yt_duration_ms)와 비교해서 판단한다.
    _startAdPoll() {
        if (this._adPoll || !this.expectedDurationMs) return;
        this._adPoll = setInterval(() => {
            if (!this._player || (!this._wantPlay && !this._inAd)) { clearInterval(this._adPoll); this._adPoll = null; return; }
            this._checkAd();
        }, 250);
    },
    _checkAd() {
        if (!this.expectedDurationMs || !this._player) return;
        let d = 0;
        try { d = this._player.getDuration(); } catch (e) { return; }
        if (!(d > 0)) return;
        const isAd = Math.abs(d - this.expectedDurationMs / 1000) > this.AD_TOLERANCE_SEC;
        if (isAd && !this._inAd) {
            this._inAd = true;
            if (!this._adSeen) {
                this._adSeen = true;
                if (typeof this.onAdDetected === 'function') { try { this.onAdDetected(); } catch (e) { console.error(e); } }
            }
            this._emit('ad');
        } else if (!isAd && this._inAd) {
            // 광고 종료: 본 영상이 처음부터 다시 시작할 수 있으므로 동결해 둔 위치로 되돌린다
            this._inAd = false;
            this._setDuration(d);
            try { this._player.seekTo(this._lastT, true); } catch (e) { /* 무시 */ }
            this._emit('adend');
        }
    },
    get inAd() { return this._inAd; },
    get adSeen() { return this._adSeen; },
    get buffering() { return this._buffering; },

    // ───── 멀티플레이 ready 배리어용 워밍업 (S5) ─────
    // 시작 전에 한 번 실제로 재생해서 광고(프리롤)를 먼저 소화하고, 본영상이 재생되는 것을 확인한 뒤 시작 위치로 되돌려 멈춘다.
    // 플레이어가 보이는 화면(플레이 화면)에서 호출해야 한다(광고도 보여야 하므로 숨기지 않는다).
    // 이 재생으로 기기별 시작 지연(_latencyMs)도 실측 갱신된다. 반환: 본영상 준비 완료 여부.
    async warmUp(maxMs = 120000) {
        const ok = await this.whenReady();
        if (!ok) return false;
        const startPos = this._pausedAt;
        const finish = (result) => {
            clearTimeout(this._playTimer); this._playTimer = null;
            this._wantPlay = false; this._playing = false;
            try { if (this._player) this._player.pauseVideo(); } catch (e) { /* 무시 */ }
            this._pausedAt = startPos; this._lastT = startPos; this._needSeek = true;
            return result;
        };
        this._wantPlay = true;
        this._lastT = startPos;
        this._doPlay();
        const t0 = Date.now();
        if (!(await this._waitPlaying(15000))) return finish(false);
        while (Date.now() - t0 < maxMs) {
            if (this.error) return finish(false);
            let d = 0;
            try { d = this._player.getDuration(); } catch (e) { /* 무시 */ }
            const exp = this.expectedDurationMs / 1000;
            const contentOk = !exp || (d > 0 && Math.abs(d - exp) <= this.AD_TOLERANCE_SEC);
            if (!this._inAd && contentOk && this._playing) {
                await new Promise(r => setTimeout(r, 200)); // 광고 직후 상태 안정화
                if (!this._inAd) return finish(true);
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return finish(false);
    },

    // ───── 모바일 제스처 잠금 해제 (S4) ─────
    // 모바일 브라우저는 사용자 제스처 밖의 playVideo()를 막는다. 클릭 핸들러 안(동기)에서 호출하면
    // 음소거 상태로 잠깐 재생했다가 첫 PLAYING에서 바로 멈춰, 이후 카운트다운 뒤의 playVideo()가 통과하게 한다.
    // 플레이어가 아직 준비 전이면 아무 것도 하지 않는다(다음 제스처에서 재시도).
    unlock() {
        if (this._unlocked || this._unlocking || !this._player || !this._ready) return;
        const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
            || (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform || ''));
        if (!mobile) { this._unlocked = true; return; }
        this._unlocking = true;
        try {
            this._player.mute();
            this._player.playVideo();
        } catch (e) { this._unlocking = false; return; }
        clearTimeout(this._unlockTimer);
        this._unlockTimer = setTimeout(() => {
            if (!this._unlocking) return;
            this._unlocking = false;
            try { this._player.unMute(); } catch (e) { /* 무시 */ }
            this._applyVolume();
        }, 3000);
    }
};

// 저장된 시작 지연 추정치 복원
try {
    const saved = Number(localStorage.getItem(YouTubeSource.LATENCY_KEY));
    if (saved > 100 && saved < 4000) YouTubeSource._latencyMs = saved;
} catch (e) { /* 무시 */ }