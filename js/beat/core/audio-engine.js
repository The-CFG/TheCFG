/**
 * AudioEngine
 * -----------
 * <audio> 엘리먼트를 대체하기 위한 Web Audio API 기반 래퍼.
 * DOM.musicPlayer 자리에 그대로 꽂아 쓸 수 있도록 <audio>와 비슷한
 * 인터페이스(src, currentTime, volume, play/pause/load, 이벤트 리스너)를 제공한다.
 *
 * <audio> 대비 핵심 차이:
 * - src 할당 시 fetch → decodeAudioData로 전체를 미리 디코딩해서 AudioBuffer로 들고 있는다.
 * - AudioBufferSourceNode는 한 번만 start()할 수 있으므로, pause/resume/seek 때마다
 *   내부적으로 새 소스 노드를 만들어 저장해둔 오프셋(pausedAt)부터 다시 시작한다.
 * - currentTime은 실제 프로퍼티가 아니라 (재생 시작 시점의 컨텍스트 시간, 오프셋)을
 *   기준으로 매번 계산한다.
 * - play(when)에 초 단위 지연을 넘기면 audioContext.currentTime 기준으로 정확히
 *   그 시점에 재생을 예약할 수 있다 (카운트다운 종료 시점에 맞춰 미리 예약 가능).
 */
const AudioEngine = {
    _ctx: null,
    _gainNode: null,
    _buffer: null,
    _source: null,
    _startContextTime: 0,
    _startOffset: 0,
    _pausedAt: 0,
    _isPlaying: false,
    _duration: 0,
    _src: '',
    _loadToken: 0,
    _loadPromise: null,
    _listeners: {},

    error: null,
    onloadedmetadata: null,

    _ensureContext() {
        if (this._ctx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this._ctx = new Ctx();
        this._gainNode = this._ctx.createGain();
        this._gainNode.connect(this._ctx.destination);
    },

    // 사용자 제스처(재생 버튼 클릭 등) 안에서 한 번 호출해 AudioContext를 활성화한다.
    async resumeContext() {
        this._ensureContext();
        if (this._ctx.state === 'suspended') {
            await this._ctx.resume();
        }
    },

    get src() {
        return this._src;
    },
    set src(url) {
        this._src = url || '';
        this._stopSourceNode();
        this._isPlaying = false;
        this._pausedAt = 0;
        this._duration = 0;
        this._buffer = null;
        this.error = null;

        if (!url) {
            this._loadPromise = null;
            return;
        }

        this._ensureContext();
        const token = ++this._loadToken;
        this._loadPromise = (async () => {
            let arrayBuffer;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                arrayBuffer = await res.arrayBuffer();
            } catch (err) {
                if (token !== this._loadToken) return;
                this.error = { code: 2, message: err.message || String(err) }; // MEDIA_ERR_NETWORK 상당
                this._emit('error');
                return;
            }
            try {
                const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);
                if (token !== this._loadToken) return; // 그 사이 src가 바뀐 경우 무시
                this._buffer = audioBuffer;
                this._duration = audioBuffer.duration;
                if (typeof this.onloadedmetadata === 'function') this.onloadedmetadata();
            } catch (err) {
                if (token !== this._loadToken) return;
                this.error = { code: 3, message: err.message || String(err) }; // MEDIA_ERR_DECODE 상당
                this._emit('error');
            }
        })();
    },

    // <audio>.load()에 대응: 진행 중인 재생을 멈춘다. 실제 로드는 src setter가 담당.
    load() {
        this._stopSourceNode();
        this._isPlaying = false;
    },

    removeAttribute(name) {
        if (name === 'src') this.src = '';
    },

    get duration() {
        return this._duration;
    },

    get paused() {
        return !this._isPlaying;
    },

    get currentTime() {
        if (this._isPlaying && this._ctx) {
            // play(when)으로 미래 시점 재생을 예약해둔 뒤, 그 시점이 오기 전에
            // currentTime을 읽으면(pause() 등) ctx.currentTime이 아직
            // _startContextTime에 못 미쳐 음수가 나온다. 아직 재생 시작 전이므로
            // 의미상 0이 맞다 — 클램프 안 하면 이 음수가 _pausedAt에 저장되고,
            // 다음 play() 때 AudioBufferSourceNode.start()의 offset으로 그대로
            // 들어가 RangeError를 던진다.
            return Math.max(0, this._startOffset + (this._ctx.currentTime - this._startContextTime));
        }
        return this._pausedAt;
    },
    set currentTime(value) {
        const wasPlaying = this._isPlaying;
        const target = Math.max(0, value);
        if (wasPlaying) {
            this._stopSourceNode();
            this._isPlaying = false;
        }
        this._pausedAt = target;
        if (wasPlaying) {
            this._startSourceNode(0);
        }
    },

    get volume() {
        return this._gainNode ? this._gainNode.gain.value : 1;
    },
    set volume(value) {
        this._ensureContext();
        this._gainNode.gain.value = value;
    },

    // when: 지금부터 몇 초 뒤에 재생을 시작할지 (기본 0 = 즉시).
    // 카운트다운 종료 시점처럼 미래 시점에 정확히 맞춰 예약할 때 사용.
    async play(when = 0) {
        this._ensureContext();
        if (this._ctx.state === 'suspended') {
            await this._ctx.resume();
        }
        if (this._loadPromise) await this._loadPromise;
        if (!this._buffer) return; // 로드 실패했거나 src가 비어있음
        this._startSourceNode(when);
    },

    pause() {
        if (!this._isPlaying) return;
        this._pausedAt = this.currentTime;
        this._stopSourceNode();
        this._isPlaying = false;
        this._emit('pause');
    },

    _startSourceNode(when) {
        this._stopSourceNode();
        const source = this._ctx.createBufferSource();
        source.buffer = this._buffer;
        source.connect(this._gainNode);
        const startAt = this._ctx.currentTime + Math.max(0, when);
        // 하한 0 클램프: _pausedAt이 어떤 경로로든 음수가 되어 있으면
        // AudioBufferSourceNode.start(startAt, offset)의 offset이 음수가 되어
        // "offset ... is less than the minimum bound (0)" RangeError가 난다.
        const offset = Math.min(Math.max(0, this._pausedAt), this._buffer.duration);
        source.start(startAt, offset);
        source.onended = () => {
            if (this._source === source) {
                this._isPlaying = false;
                this._source = null;
            }
        };
        this._source = source;
        this._startContextTime = startAt;
        this._startOffset = offset;
        this._isPlaying = true;
    },

    _stopSourceNode() {
        if (this._source) {
            this._source.onended = null;
            try { this._source.stop(); } catch (e) { /* 이미 정지된 경우 무시 */ }
            this._source = null;
        }
    },

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
    }
};