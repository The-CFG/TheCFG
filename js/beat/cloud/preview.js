/**
 * SongPreview
 * -----------
 * 온라인 화면(난이도 선택 / 플레이 전 화면)에서 쓰는 "미리듣기" 재생기.
 * DOM.musicPlayer(AudioEngine)로 오디오를 재생하고, 노트 미리보기는 항상 화면에
 * 떠 있는 좌측 게임 화면(#game-area의 Game.canvas / DOM.lanesContainer)에
 * 그대로 그린다 — Editor.startPreview()/previewLoop()와 동일한 방식.
 *
 * - playAudio(): 오디오만 재생 (난이도 선택 화면 = 노래 상세)
 * - start(): 오디오 + 좌측 게임 화면에 노트 낙하 미리보기 (플레이 전 화면 = 난이도 상세)
 * - stop(): 오디오/애니메이션/게임 화면 모두 정리. 온라인 화면을 벗어날 때 반드시 호출해야 한다.
 */
const SongPreview = {
    _animId: null,
    _notes: [],
    _laneCount: 4,
    _laneIdMapping: [],
    _triggers: [],
    _baseBpm: 120,
    _baseNoteSpeed: 6,
    _active: false,
    _noteMode: false,
    // playAudio()/start() 둘 다 stop() 후 resumeContext()/play() 같은 await 구간을 거친다.
    // 그 사이에 다른 곡으로 playAudio/start가 다시 호출되면(빠르게 연속 탭) 먼저 시작된
    // 호출이 나중에 깨어나면서 방금 재생 시작한 곡의 src/currentTime을 자기 것으로
    // 덮어써버리는 상태 누수가 생긴다. AudioEngine._loadToken과 동일한 패턴으로
    // 호출마다 토큰을 발급하고, await 이후 여전히 최신 호출인지 확인한 뒤에만 적용한다.
    _loadToken: 0,

    // ── 오디오만 미리듣기 (난이도 선택 = 노래 상세 화면) ────────────────────
    async playAudio(audioUrl, previewStartMs = 0) {
        this.stop();
        if (!audioUrl) return;
        const token = ++this._loadToken;
        try { await AudioEngine.resumeContext(); } catch (e) { /* 제스처 없이 호출된 경우 무시 */ }
        if (token !== this._loadToken) return; // 그 사이 다른 곡 요청이 들어옴 — 이 호출은 폐기
        try {
            DOM.musicPlayer.src = audioUrl;
            DOM.musicPlayer.currentTime = Math.max(0, (previewStartMs || 0) / 1000);
            await DOM.musicPlayer.play();
            if (token !== this._loadToken) { DOM.musicPlayer.pause(); return; }
            this._active = true;
        } catch (err) {
            Debugger?.logError?.(err, 'SongPreview.playAudio');
        }
    },

    // ── 오디오 + 좌측 게임 화면 노트 낙하 미리보기 (플레이 전 = 난이도 상세 화면) ──
    // opts: { chartData: {bpm, laneCount, notes, triggers}, audioUrl, previewStartMs, laneCount }
    async start(opts) {
        this.stop();
        const token = ++this._loadToken;
        const { chartData, audioUrl, previewStartMs = 0 } = opts || {};
        const laneCount = (opts && opts.laneCount) || chartData?.laneCount || 4;
        const laneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        if (!laneIds) {
            // 알 수 없는 레인 수면 노트 미리보기 없이 오디오만이라도 재생
            await this.playAudio(audioUrl, previewStartMs);
            return;
        }

        this._laneCount = laneCount;
        this._laneIdMapping = laneIds;
        this._baseBpm = (chartData && chartData.bpm) || 120;
        const speedSource = (chartData && typeof chartData.fallSpeed === 'number' && chartData.fallSpeed > 0)
            ? chartData.fallSpeed
            : Math.round(this._baseBpm / 20);
        this._baseNoteSpeed = Math.max(1, Math.min(20, speedSource));
        this._triggers = Array.isArray(chartData?.triggers)
            ? [...chartData.triggers].sort((a, b) => a.time - b.time)
            : [];
        this._notes = this._buildNotes(chartData?.notes || [], laneIds);
        this._noteMode = true;

        // 좌측 게임 화면(레인 히트박스 전용 — 렌더링은 Game.canvas가 담당) 준비
        DOM.lanesContainer.innerHTML = '';
        DOM.lanesContainer.style.width = `${laneCount * 100}px`;
        for (let i = 0; i < laneCount; i++) {
            const lane = document.createElement('div');
            lane.className = 'lane';
            lane.style.width = '100px';
            lane.dataset.laneIndex = i;
            if (laneIds[i]) lane.dataset.laneId = laneIds[i];
            DOM.lanesContainer.appendChild(lane);
        }
        Game.canvas.init();
        Game.canvas.resize(laneCount);

        try { await AudioEngine.resumeContext(); } catch (e) { /* 무시 */ }
        if (token !== this._loadToken) return; // 그 사이 다른 곡 요청이 들어옴 — 이 호출은 폐기
        try {
            if (audioUrl) {
                DOM.musicPlayer.src = audioUrl;
                DOM.musicPlayer.currentTime = Math.max(0, (previewStartMs || 0) / 1000);
                await DOM.musicPlayer.play();
            }
        } catch (err) {
            Debugger?.logError?.(err, 'SongPreview.start');
        }
        if (token !== this._loadToken) { DOM.musicPlayer.pause(); return; }

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
                    const transitionMs = target.transitionMs ?? (Game.TRIGGER_TRANSITION_MS || 700);
                    const progress = Math.min(1, Math.max(0, (elapsedTime - target.time) / transitionMs));
                    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                    noteSpeed = from + (target.fallSpeed - from) * eased;
                }
            }

            const canvas = Game.canvas;
            const gameHeight = canvas.h || DOM.lanesContainer.clientHeight || 600;
            const isCircle = document.body.classList.contains('circle-notes');
            const noteH = isCircle ? canvas.NOTE_CIRCLE_D : canvas.NOTE_BAR_H;
            const jY = canvas.judgementLineY();

            this._notes.forEach(note => {
                if (note.type === 'long_tail') { note._visible = false; return; }
                const timeToHit = note.time - elapsedTime;
                const bodyH = note.type === 'long_head'
                    ? Math.max((note.duration / 10) * noteSpeed, noteH)
                    : noteH;
                const noteBottomY = jY - (timeToHit * noteSpeed / 10);
                const noteTopY = noteBottomY - bodyH;
                note._visible = noteBottomY > -noteH && noteTopY < gameHeight;
            });

            canvas.render(this._notes, this._laneCount, {}, this._laneIdMapping, elapsedTime, noteSpeed);

            // 오디오가 끝까지 재생되어 멈추면 미리보기 루프도 함께 종료
            if (!DOM.musicPlayer.paused) {
                this._animId = requestAnimationFrame(this._loop.bind(this));
            } else {
                this._active = false;
                this._clearCanvas();
            }
        } catch (err) {
            Debugger?.logError?.(err, 'SongPreview._loop');
            this._active = false;
        }
    },

    _clearCanvas() {
        if (Game.canvas.ctx) {
            Game.canvas.ctx.clearRect(0, 0, Game.canvas.w, Game.canvas.h);
        }
    },

    stopAudio() {
        try { DOM.musicPlayer.pause(); } catch (e) { /* 무시 */ }
    },

    stop() {
        this._loadToken++; // 진행 중이던 playAudio()/start() 호출을 전부 무효화
        this._active = false;
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
        this.stopAudio();
        if (this._noteMode) {
            this._clearCanvas();
            DOM.lanesContainer.innerHTML = '';
        }
        this._noteMode = false;
        this._notes = [];
        this._triggers = [];
    },
};