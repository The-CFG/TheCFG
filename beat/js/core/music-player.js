/**
 * MusicPlayer (파사드)
 * --------------------
 * DOM.musicPlayer 자리에 꽂는 얇은 래퍼. 기존 호출부 108곳(src/currentTime/play/pause/...)을
 * 하나도 고치지 않고 음원 백엔드를 바꿔 끼우기 위한 것이다.
 *
 *   src = 'yt:<11자 영상 ID>'  → YouTubeSource
 *   그 외(URL, blob: 등)        → AudioEngine (기존 Web Audio, local/hosted 공용)
 *
 * 로드 순서: audio-engine.js → youtube-source.js → music-player.js → dom.js
 */
const MusicPlayer = {
    _active: null,      // 현재 백엔드
    _onMeta: null,

    _backends() { return [AudioEngine, YouTubeSource]; },
    _get() { return this._active || AudioEngine; },

    // 지금 어떤 백엔드를 쓰는지 ('local' | 'yt') — 레이아웃(S3)이 플레이어 패널 표시 여부를 정할 때 사용
    get kind() { return this._get() === YouTubeSource ? 'yt' : 'local'; },

    get src() { return this._get().src; },
    set src(url) {
        const next = YouTubeSource.isYtSrc(url) ? YouTubeSource : AudioEngine;
        const prev = this._get();
        if (prev !== next) {
            // 백엔드가 바뀌면 이전 쪽은 확실히 정리한다 (소리 겹침/플레이어 잔류 방지)
            try { prev.pause(); } catch (e) { /* 무시 */ }
            prev.src = '';
        }
        this._active = next;
        next.src = url || '';
        if (!url) {
            // 비우기: 양쪽 다 비워서 YouTube 호스트도 숨긴다
            this._backends().forEach(b => { if (b !== next) b.src = ''; });
        }
    },

    get downloadProgress() { return this._get().downloadProgress; },
    get error() { return this._get().error; },
    // ── 시계 통일: MusicPlayer의 currentTime/duration은 항상 "곡 시간(song time)"이다 ──
    // YouTube 곡은 영상 시간 = 곡 시간 + yt_offset_ms. 호출부(게임/에디터/미리듣기/멀티플레이)는 영상 오프셋을 따로
    // 더하거나 빼지 않고 이 파사드의 ytOffsetMs만 곡을 불러올 때 한 번 지정한다. (local/hosted는 오프셋 0과 동일)
    _ytOffsetMs: 0,
    get ytOffsetMs() { return this._ytOffsetMs; },
    set ytOffsetMs(ms) { this._ytOffsetMs = Number(ms) || 0; },
    _off() { return this._get() === YouTubeSource ? this._ytOffsetMs / 1000 : 0; },
    // 영상 쪽 원래 시간(초) — 진단/디버그용
    get videoTime() { return this._get().currentTime; },

    get duration() {
        const d = this._get().duration;
        return (this._get() === YouTubeSource && isFinite(d)) ? Math.max(0, d - this._off()) : d;
    },
    get paused() { return this._get().paused; },

    get currentTime() { return this._get().currentTime - this._off(); },
    set currentTime(v) { this._get().currentTime = v + this._off(); },

    get volume() { return this._get().volume; },
    set volume(v) { this._backends().forEach(b => { b.volume = v; }); },

    setMuffled(active) { this._backends().forEach(b => b.setMuffled(active)); },
    get muffled() { return this._get().muffled; },

    get playbackRate() { return this._get() === YouTubeSource ? YouTubeSource.playbackRate : 1; },
    set playbackRate(v) { if (this._get() === YouTubeSource) YouTubeSource.playbackRate = v; },

    play(when = 0) { return this._get().play(when); },
    pause() { return this._get().pause(); },
    load() { return this._get().load(); },
    removeAttribute(name) { return this._get().removeAttribute(name); },
    whenReady() { return this._get().whenReady(); },

    // YouTube 곡 전용 (S4): 광고 감지 기준 길이 / 모바일 제스처 잠금 해제 / 광고 관찰 콜백
    set expectedDurationMs(ms) { YouTubeSource.expectedDurationMs = Number(ms) || 0; },
    unlockYouTube() { YouTubeSource.unlock(); },
    // 멀티플레이 ready 배리어: YouTube면 광고를 먼저 소화하고 본영상 준비를 확인, 그 외는 즉시 true
    warmUp(maxMs) { return this.kind === 'yt' ? YouTubeSource.warmUp(maxMs) : Promise.resolve(true); },
    set onAdDetected(fn) { YouTubeSource.onAdDetected = fn; },
    get inAd() { return this.kind === 'yt' && YouTubeSource.inAd; },
    get buffering() { return this.kind === 'yt' && YouTubeSource.buffering; },

    // 사용자 제스처 안에서 호출. AudioContext는 항상 깨워둔다 (효과음/전환 대비).
    async resumeContext() {
        await AudioEngine.resumeContext();
        await YouTubeSource.resumeContext();
    },

    // onloadedmetadata는 어느 백엔드든 같은 콜백이 불리도록 양쪽에 건다
    get onloadedmetadata() { return this._onMeta; },
    set onloadedmetadata(fn) {
        this._onMeta = fn;
        this._backends().forEach(b => { b.onloadedmetadata = fn; });
    },

    // 이벤트 리스너는 양쪽에 등록하고, 실제로는 활성 백엔드만 이벤트를 쏜다
    addEventListener(evt, cb) { this._backends().forEach(b => b.addEventListener(evt, cb)); },
    removeEventListener(evt, cb) { this._backends().forEach(b => b.removeEventListener(evt, cb)); }
};

/**
 * GameClock — 게임 화면용 "매끈한 곡 시계"
 * -----------------------------------------
 * 문제: 음원 시계(AudioContext.currentTime, YouTube getCurrentTime)는 10~20ms 단위로 "계단식"으로만 갱신된다.
 *       그 값을 그대로 노트 위치/판정에 쓰면, 화면 주사율과 어긋난 프레임마다 노트가 이동하는 양이 들쭉날쭉해져
 *       (예: 144Hz에서 어떤 프레임은 0ms, 어떤 프레임은 10ms만큼 이동) FPS가 높아도 뚝뚝 끊겨 보인다.
 *       PC 성능과 무관하게 모든 환경에서 똑같이 생기는 끊김이다.
 * 해결: 프레임마다 performance.now() 기준으로 시계를 "자유 진행"시키고, 음원 시계 값과의 차이만큼만 아주 조금씩(τ=0.1s)
 *       끌어당겨 맞춘다(PLL). 평균 시각은 원래 음원 시계와 같아서 사용자가 맞춰 둔 판정 보정값은 그대로 유효하다.
 *       (시뮬레이션: 프레임 간 움직임 오차 4.6~8.2ms → 0.2~0.9ms, 입력 판정 시각 흔들림 σ 2.7~5.6ms → 0.2~0.5ms)
 *
 *   tick(nowMs, rawSec, rate) : 프레임마다 한 번 (nowMs는 requestAnimationFrame 타임스탬프). 보정된 곡 시간(초)을 돌려준다.
 *   read(nowMs, rawSec)       : 입력 이벤트처럼 프레임 사이의 시각에 곡 시간이 필요할 때. 마지막 tick 기준으로 외삽한다.
 *   reset()                   : 시작/종료/시크 때 새로 시작.
 * 끄기(문제 확인용): localStorage.setItem('theBeat_clockSmoothing', 'off') 후 새로고침 — 예전처럼 음원 시계를 그대로 쓴다.
 */
const GameClock = {
    TAU_S: 0.1,        // 보정 시정수(초). 작을수록 어긋남을 빨리 따라가고(0.26초 복구), 클수록 더 매끈하다
    SNAP_S: 0.06,      // 오차가 이보다 크면 보정 대신 즉시 맞춘다 (시크 / 버퍼링 / 장치 전환 등)
    MAX_GAP_MS: 250,   // 이보다 오래 tick이 없었으면(일시정지 등) 새로 시작한다

    enabled: (() => { try { return localStorage.getItem('theBeat_clockSmoothing') !== 'off'; } catch (e) { return true; } })(),

    _init: false,
    _t: 0,             // 마지막 tick 시점의 보정된 곡 시간(초)
    _at: 0,            // 그 시점의 타임스탬프(ms)
    _rate: 1,
    _lastRaw: NaN,
    _lastRawAt: 0,
    stats: { rawStepMs: 0, frameMs: 0, maxFrameMs: 0, longFrames: 0, corrMs: 0, snaps: 0 },   // 디버그 오버레이용 (디버그 모드에서만 갱신)

    reset() { this._init = false; this._lastRaw = NaN; },

    tick(nowMs, rawSec, rate = 1) {
        if (!this.enabled || !isFinite(rawSec)) { this._init = false; return rawSec; }
        const dbg = typeof Debugger !== 'undefined' && Debugger.isActive;
        if (!this._init || nowMs - this._at > this.MAX_GAP_MS || nowMs < this._at) {
            this._init = true; this._t = rawSec; this._at = nowMs; this._rate = rate;
            this._lastRaw = rawSec; this._lastRawAt = nowMs;
            if (dbg) this.stats.snaps++;
            return rawSec;
        }
        const dt = (nowMs - this._at) / 1000;
        if (dt <= 0) return this._t;
        let est = this._t + dt * this._rate;          // 직전 프레임의 속도로 자유 진행
        const err = rawSec - est;                     // 음원 시계와의 차이 (계단식이라 0~갱신간격만큼 뒤처져 보인다)
        if (Math.abs(err) > this.SNAP_S) {
            est = rawSec;
            if (dbg) this.stats.snaps++;
        } else {
            est += err * (1 - Math.exp(-dt / this.TAU_S));
        }
        if (dbg) {
            const s = this.stats;
            if (rawSec !== this._lastRaw) { s.rawStepMs += ((nowMs - this._lastRawAt) - s.rawStepMs) * 0.1; this._lastRaw = rawSec; this._lastRawAt = nowMs; }
            const fm = dt * 1000;
            s.frameMs += (fm - s.frameMs) * 0.05;
            s.maxFrameMs = fm > s.maxFrameMs ? fm : s.maxFrameMs * 0.995;          // 최근 프레임 중 가장 느렸던 값(서서히 감소)
            if (fm > Math.max(12, s.frameMs * 1.5)) s.longFrames++;                // 평소보다 확 늘어진 프레임 수 = 진짜 프레임 드랍
            s.corrMs += (Math.abs(err) * 1000 - s.corrMs) * 0.05;
        }
        this._t = est; this._at = nowMs; this._rate = rate;
        return est;
    },

    read(nowMs, rawSec) {
        if (!this.enabled || !this._init) return rawSec;
        const d = nowMs - this._at;
        if (d > this.MAX_GAP_MS || d < -100) return rawSec;   // 오래된 기준이면 신뢰하지 않는다
        return this._t + (d / 1000) * this._rate;
    }
};