/**
 * SongPreview
 * -----------
 * 온라인 화면(난이도 선택 / 플레이 전 화면)에서 쓰는 "미리듣기" 재생기.
 * DOM.musicPlayer(AudioEngine)를 그대로 재사용해 오디오를 재생하고,
 * 필요하면 Editor.previewLoop()와 동일한 방식으로 노트 낙하도 함께 그려준다.
 *
 * - playAudio(): 오디오만 재생 (난이도 선택 화면 = 노래 상세)
 * - start(): 오디오 + 노트 낙하 미리보기 (플레이 전 화면 = 난이도 상세)
 * - stop(): 오디오/애니메이션/캔버스 모두 정리. 화면을 벗어날 때 반드시 호출해야 한다.
 */
const SongPreview = {
    _animId: null,
    _canvas: null,
    _ctx: null,
    _notes: [],
    _laneCount: 4,
    _laneIdMapping: [],
    _triggers: [],
    _baseBpm: 120,
    _baseNoteSpeed: 6,
    _active: false,
    _noteMode: false,

    // ── 상수 (Game.canvas와 동일하게 맞춰 실제 플레이 화면과 같은 룩앤필 유지) ──
    JUDGEMENT_LINE_Y_FROM_BOTTOM: 100,
    JUDGEMENT_LINE_H: 4,
    NOTE_BAR_H: 25,
    NOTE_CIRCLE_D: 90,
    NOTE_RADIUS: 5,
    LANE_BORDER_COLOR: '#4a5568',

    // ── 오디오만 미리듣기 (난이도 선택 = 노래 상세 화면) ────────────────────
    async playAudio(audioUrl, previewStartMs = 0) {
        this.stop();
        if (!audioUrl) return;
        try { await AudioEngine.resumeContext(); } catch (e) { /* 제스처 없이 호출된 경우 무시 */ }
        try {
            DOM.musicPlayer.src = audioUrl;
            DOM.musicPlayer.currentTime = Math.max(0, (previewStartMs || 0) / 1000);
            await DOM.musicPlayer.play();
            this._active = true;
        } catch (err) {
            Debugger?.logError?.(err, 'SongPreview.playAudio');
        }
    },

    // ── 오디오 + 노트 낙하 미리보기 (플레이 전 = 난이도 상세 화면) ──────────
    // container: 캔버스를 넣을 DOM 엘리먼트
    // opts: { chartData: {bpm, laneCount, notes, triggers}, audioUrl, previewStartMs, laneCount }
    async start(container, opts) {
        this.stop();
        if (!container) return;
        const { chartData, audioUrl, previewStartMs = 0 } = opts || {};
        const laneCount = opts.laneCount || chartData?.laneCount || 4;
        const laneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        if (!laneIds) return;

        this._laneCount = laneCount;
        this._laneIdMapping = laneIds;
        this._baseBpm = (chartData && chartData.bpm) || 120;
        this._baseNoteSpeed = Math.max(1, Math.min(20, Math.round(this._baseBpm / 20)));
        this._triggers = Array.isArray(chartData?.triggers)
            ? [...chartData.triggers].sort((a, b) => a.time - b.time)
            : [];
        this._notes = this._buildNotes(chartData?.notes || [], laneIds);
        this._noteMode = true;

        this._setupCanvas(container, laneCount);

        try { await AudioEngine.resumeContext(); } catch (e) { /* 무시 */ }
        try {
            if (audioUrl) {
                DOM.musicPlayer.src = audioUrl;
                DOM.musicPlayer.currentTime = Math.max(0, (previewStartMs || 0) / 1000);
                await DOM.musicPlayer.play();
            }
        } catch (err) {
            Debugger?.logError?.(err, 'SongPreview.start');
        }

        this._active = true;
        this._loop();
    },

    // 에디터의 preparePreviewNotes()와 동일한 변환 (레인ID → 게임 레인 인덱스, 롱노트 head/tail 분리)
    _buildNotes(rawNotes, laneIds) {
        const notes = [];
        let noteId = 0;
        rawNotes.forEach(note => {
            const laneIndex = laneIds.indexOf(note.lane);
            if (laneIndex === -1) return;
            if (note.duration) {
                const head = { time: note.time, lane: laneIndex, type: 'long_head', duration: note.duration, noteId: noteId++ };
                notes.push(head);
                notes.push({ time: note.time + note.duration, lane: laneIndex, type: 'long_tail', noteId: head.noteId });
            } else {
                notes.push({ time: note.time, lane: laneIndex, type: note.type || 'tap' });
            }
        });
        notes.sort((a, b) => a.time - b.time);
        return notes;
    },

    _setupCanvas(container, laneCount) {
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width:100%;overflow-x:auto;display:flex;justify-content:center;background:#1a202c;border-radius:0.5rem;';
        const inner = document.createElement('div');
        inner.style.cssText = `position:relative;width:${laneCount * 100}px;height:480px;flex-shrink:0;`;
        const canvas = document.createElement('canvas');
        inner.appendChild(canvas);
        wrap.appendChild(inner);
        container.appendChild(wrap);

        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._w = laneCount * 100;
        this._h = 480;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = this._w * dpr;
        canvas.height = this._h * dpr;
        canvas.style.width = `${this._w}px`;
        canvas.style.height = `${this._h}px`;
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    _judgementLineY() {
        return this._h - this.JUDGEMENT_LINE_Y_FROM_BOTTOM;
    },

    _noteColor(noteType) {
        const ap = (typeof Appearance !== 'undefined') ? Appearance.settings : null;
        if (!ap) return noteType === 'long_head' ? '#48bb78' : (noteType === 'false' ? '#f56565' : '#4299e1');
        if (noteType === 'long_head') return ap.colors.long;
        if (noteType === 'false') return ap.colors.false;
        return ap.colors.tap;
    },

    _loop() {
        if (!this._active) return;
        try {
            const elapsedTime = DOM.musicPlayer.currentTime * 1000;

            let noteSpeed = this._baseNoteSpeed;
            if (this._triggers.length > 0) {
                let idx = -1;
                for (let i = 0; i < this._triggers.length; i++) {
                    if (this._triggers[i].time <= elapsedTime) idx = i;
                    else break;
                }
                if (idx >= 0) {
                    const target = this._triggers[idx];
                    const from = idx >= 1 ? this._triggers[idx - 1].fallSpeed : this._baseNoteSpeed;
                    const transitionMs = target.transitionMs ?? 700;
                    const progress = Math.min(1, Math.max(0, (elapsedTime - target.time) / transitionMs));
                    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                    noteSpeed = from + (target.fallSpeed - from) * eased;
                }
            }

            this._render(elapsedTime, noteSpeed);

            // 오디오가 끝까지 재생되어 멈추면 미리보기 루프도 함께 종료
            if (!DOM.musicPlayer.paused) {
                this._animId = requestAnimationFrame(this._loop.bind(this));
            } else {
                this._active = false;
            }
        } catch (err) {
            Debugger?.logError?.(err, 'SongPreview._loop');
            this._active = false;
        }
    },

    _render(elapsedTime, noteSpeed) {
        const ctx = this._ctx;
        if (!ctx) return;
        const laneW = 100;
        const jY = this._judgementLineY();

        ctx.clearRect(0, 0, this._w, this._h);

        // 레인 구분선
        ctx.strokeStyle = this.LANE_BORDER_COLOR;
        ctx.lineWidth = 1;
        for (let i = 0; i <= this._laneCount; i++) {
            const x = (i === this._laneCount) ? this._w - 0.5 : i * laneW + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this._h);
            ctx.stroke();
        }

        // 판정선
        const totalW = this._laneCount * laneW;
        const grad = ctx.createLinearGradient(0, 0, totalW, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.2)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
        grad.addColorStop(1, 'rgba(255,255,255,0.2)');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 10;
        ctx.fillRect(0, jY, totalW, this.JUDGEMENT_LINE_H);
        ctx.shadowBlur = 0;

        // 노트
        const noteH = this.NOTE_BAR_H;
        this._notes.forEach(note => {
            if (note.type === 'long_tail') return;
            const timeToHit = note.time - elapsedTime;
            const bodyH = note.type === 'long_head'
                ? Math.max((note.duration / 10) * noteSpeed, noteH)
                : noteH;
            const noteBottomY = jY - (timeToHit * noteSpeed / 10);
            const topY = noteBottomY - bodyH;
            if (noteBottomY <= -noteH || topY >= this._h) return;

            const color = this._noteColor(note.type);
            const x = note.lane * laneW + 1;
            const w = laneW - 2;
            ctx.fillStyle = color;
            if (note.type === 'false') {
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
            }
            this._roundRect(ctx, x, topY, w, bodyH, this.NOTE_RADIUS);
            ctx.fill();
            ctx.shadowBlur = 0;
        });
    },

    _roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    },

    stopAudio() {
        try { DOM.musicPlayer.pause(); } catch (e) { /* 무시 */ }
    },

    stop() {
        this._active = false;
        this._noteMode = false;
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
        this.stopAudio();
        if (this._canvas && this._canvas.closest('div')) {
            const wrap = this._canvas.parentElement?.parentElement;
            if (wrap && wrap.parentNode) wrap.remove();
        }
        this._canvas = null;
        this._ctx = null;
        this._notes = [];
        this._triggers = [];
    },
};