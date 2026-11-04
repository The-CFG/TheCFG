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
    get duration() { return this._get().duration; },
    get paused() { return this._get().paused; },

    get currentTime() { return this._get().currentTime; },
    set currentTime(v) { this._get().currentTime = v; },

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