const Game = {
    state: {
        gameState: 'menu',
        settings: {
            mode: 'random',
            difficulty: 'normal',
            noteSpeed: 0, // 노트 하강 속도
            noteSpawnSpeed: CONFIG.NOTE_SPAWN_SPEED.normal, // 노트 생성 속도
            dongtaProbability: CONFIG.SIMULTANEOUS_NOTE_PROBABILITY.normal,
            maxSimultaneousNotes: CONFIG.MAX_SIMULTANEOUS_NOTES.normal,
            dongtaNoteTypeProbabilities: CONFIG.SIMULTANEOUS_NOTE_TYPE_PROBABILITY.normal,
            longNoteProbability: CONFIG.LONG_NOTE_PROBABILITY.normal,
            falseNoteProbability: 0,
            lanes: 4,
            musicSrc: null,
            musicFileObject: null,
            musicVolume: 100,
            sfxVolume: 100,
            // 게임플레이 중 노래 커버 이미지를 배경으로 표시할지 여부. 새로고침해도 유지되도록
            // localStorage에서 미리 읽어둔다 (계정 볼륨과 달리 계정 연동은 하지 않음).
            showGameplayImage: localStorage.getItem('theBeat_showGameplayImage') !== 'false',
            // 입력 시 레인이 하얗게 하이라이트되는 피드백을 표시할지 여부
            laneHighlightOnInput: localStorage.getItem('theBeat_laneHighlightOnInput') !== 'false',
            // 게임플레이 중 우측 메뉴/점수 패널(#ui-area)을 자동으로 접을지 여부. 기본값 false(끔).
            autoHideUiOnPlay: localStorage.getItem('theBeat_autoHideUiOnPlay') === 'true',
            bpm: 120,
            startTimeOffset: 0, // 채보 박자 계산 기준점 (bpm/noteoffset 등 노트 타이밍용)
            songStartOffset: 0, // 실제 오디오 재생을 시작할 지점 (종합 창의 "시작(초)")
            // 새로고침해도 유지되도록 config.js가 localStorage에서 미리 읽어둔 값으로 초기화한다.
            userKeyMappingsByLanes: CONFIG.PERSISTED_USER_KEY_MAPPINGS || null,
            requiredSongName: null,
        },
        keyMapping: [],
        activeLanes: [],
        notes: [],
        score: 0,
        combo: 0,
        maxCombo: 0,
        judgements: { perfect: 0, good: 0, bad: 0, miss: 0 },
        gameStartTime: 0,
        animationFrameId: null,
        totalNotes: 0,
        processedNotes: 0,
        isPaused: false,
        pauseStartTime: 0,
        totalPausedTime: 0,
        previousScreen: 'menu',
        countdownIntervalId: null,
        unprocessedNoteIndex: 0,
        chartData: null,
        triggers: [],       // 구간별 BPM/하강 속도 변경 트리거
        baseBpm: 120,
        baseNoteSpeed: 6,
    },

    // ─── Canvas 렌더러 ───────────────────────────────────────────────────────
    canvas: {
        el: null,   // <canvas> 엘리먼트
        ctx: null,  // 2D 컨텍스트
        w: 0,       // 현재 캔버스 너비
        h: 0,       // 현재 캔버스 높이

        LANE_BORDER_COLOR: '#4a5568',
        JUDGEMENT_LINE_Y_FROM_BOTTOM: 100, // 판정선 하단 여백(px)
        JUDGEMENT_LINE_H: 4,
        NOTE_BAR_H: 25,
        NOTE_CIRCLE_D: 90,  // 원형 노트 지름
        NOTE_RADIUS: 5,     // 바 노트 모서리 둥글기

        init() {
            this.el = DOM.gameCanvas;
            this.ctx = this.el.getContext('2d');
        },

        // 레인 수·게임 영역 크기에 맞게 캔버스 크기 동기화
        resize(laneCount) {
            const laneW = 100;
            this.w = laneCount * laneW;
            this.h = DOM.lanesContainer.clientHeight || DOM.gameArea.clientHeight;
            // devicePixelRatio 반영으로 Retina/모바일 선명하게
            const dpr = window.devicePixelRatio || 1;
            this.el.width  = this.w * dpr;
            this.el.height = this.h * dpr;
            this.el.style.width  = `${this.w}px`;
            this.el.style.height = `${this.h}px`;

            // 업스크롤: 모든 그리기 로직(다운스크롤 기준 좌표 계산)은 그대로 두고,
            // 캔버스 좌표계 자체를 세로로 뒤집어서 렌더링만 반전시킨다.
            // (판정선 Y는 항상 h - margin으로 계산되지만, 뒤집힌 좌표계에서는
            //  화면상 위쪽에 그려지고, 노트는 아래에서 위로 올라오게 된다)
            const isUpscroll = Appearance.settings.scrollDirection === 'up';
            if (isUpscroll) {
                this.ctx.setTransform(dpr, 0, 0, -dpr, 0, this.h * dpr);
            } else {
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        },

        // 판정선 Y 좌표 (상단 기준)
        judgementLineY() {
            return this.h - this.JUDGEMENT_LINE_Y_FROM_BOTTOM;
        },

        // 노트 색상 결정 (Appearance 설정 반영)
        _noteColor(noteType, laneId, isLong) {
            const ap = Appearance.settings;
            if (ap.colorMode === 'lane' && laneId && ap.laneColors[laneId]) {
                return ap.laneColors[laneId];
            }
            if (noteType === 'long_head' || isLong) return ap.colors.long;
            if (noteType === 'false') return ap.colors.false;
            return ap.colors.tap;
        },

        // 레인 배경(경계선) + 판정선 그리기
        drawLaneBackground(laneCount, activeLanes) {
            const ctx = this.ctx;
            const laneW = 100;
            const jY = this.judgementLineY();
            const isCircle = document.body.classList.contains('circle-notes');

            // 레인 구분선
            ctx.strokeStyle = this.LANE_BORDER_COLOR;
            ctx.lineWidth = 1;
            for (let i = 0; i <= laneCount; i++) {
                // 마지막 선(i === laneCount)은 canvas 오른쪽 끝과 겹쳐 잘리므로
                // 0.5px 안쪽으로 당겨서 완전히 표시되게 한다
                const x = (i === laneCount) ? this.w - 0.5 : i * laneW + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.h);
                ctx.stroke();
            }

            // 활성 레인 피드백 (설정에서 끌 수 있음)
            if (Game.state.settings.laneHighlightOnInput) {
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                for (let i = 0; i < laneCount; i++) {
                    if (activeLanes[i]) {
                        ctx.fillRect(i * laneW + 1, 0, laneW - 2, this.h);
                    }
                }
            }

            // 판정선
            if (isCircle) {
                // 원형 노트: 레인마다 원형 판정선
                for (let i = 0; i < laneCount; i++) {
                    const cx = i * laneW + laneW / 2;
                    const cy = jY - this.NOTE_CIRCLE_D / 2;
                    const r = this.NOTE_CIRCLE_D / 2;
                    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                    grad.addColorStop(0, 'rgba(255,255,255,0.8)');
                    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
                    grad.addColorStop(1, 'rgba(255,255,255,0.1)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                // 바 노트: 전체 너비 가로선
                const totalW = laneCount * laneW;
                const grad = ctx.createLinearGradient(0, 0, totalW, 0);
                grad.addColorStop(0,   'rgba(255,255,255,0.2)');
                grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
                grad.addColorStop(1,   'rgba(255,255,255,0.2)');
                ctx.fillStyle = grad;
                ctx.shadowColor = '#fff';
                ctx.shadowBlur  = 10;
                ctx.fillRect(0, jY, totalW, this.JUDGEMENT_LINE_H);
                ctx.shadowBlur = 0;
            }
        },

        // 노트 한 개 그리기
        // elapsedTime, noteSpeed를 받아 위치를 직접 계산 → _drawH/_drawTop 불일치 버그 원천 제거
        drawNote(note, laneIdMapping, elapsedTime, noteSpeed) {
            if (!note._visible) return;

            const ctx = this.ctx;
            const laneW = 100;
            const laneIndex = note.lane;
            const laneId = laneIdMapping ? laneIdMapping[laneIndex] : null;
            const isCircle = document.body.classList.contains('circle-notes');
            const jY = this.judgementLineY();

            const color = this._noteColor(note.type, laneId, note.type === 'long_head');
            const darkerColor = Appearance.adjustColor(color, -20);

            const noteBarH   = this.NOTE_BAR_H;
            const noteCircleD = this.NOTE_CIRCLE_D;
            const minH = isCircle ? noteCircleD : noteBarH;

            // 위치/높이 계산
            let topY, bodyH;

            if (note.type === 'long_head') {
                if (note.shrinking && note.tailTime !== undefined) {
                    // 수축 중: 하단을 판정선에 고정하고 남은 duration으로 높이 계산
                    const timeUntilTail = note.tailTime - elapsedTime;
                    const currentDuration = Math.max(0, timeUntilTail);
                    bodyH = Math.max((currentDuration / 10) * noteSpeed, minH);
                    topY  = jY - bodyH;
                } else {
                    // 일반 하강: note.time 기준으로 하단 Y 계산
                    const timeToHit = note.time - elapsedTime;
                    const noteBottomY = jY - (timeToHit * noteSpeed / 10);
                    bodyH = Math.max((note.duration / 10) * noteSpeed, minH);
                    topY  = noteBottomY - bodyH;
                }
            } else {
                // tap / false
                const timeToHit = note.time - elapsedTime;
                const noteBottomY = jY - (timeToHit * noteSpeed / 10);
                bodyH = minH;
                topY  = noteBottomY - bodyH;
            }

            if (isCircle) {
                const D = noteCircleD;
                const R = D / 2;
                const cx = laneIndex * laneW + laneW / 2;

                if (note.type === 'long_head') {
                    const grad = ctx.createLinearGradient(cx - R, topY + bodyH, cx - R, topY);
                    grad.addColorStop(0, darkerColor);
                    grad.addColorStop(1, color);
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(cx, topY + R,         R, Math.PI, 0);
                    ctx.lineTo(cx + R, topY + bodyH - R);
                    ctx.arc(cx, topY + bodyH - R, R, 0, Math.PI);
                    ctx.closePath();
                    ctx.fill();
                } else if (note.type !== 'long_tail') {
                    const cy = topY + R;
                    ctx.beginPath();
                    ctx.arc(cx, cy, R, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    if (note.type === 'false') {
                        ctx.shadowColor = color;
                        ctx.shadowBlur  = 12;
                        ctx.fill();
                        ctx.shadowBlur  = 0;
                    }
                }
            } else {
                const x = laneIndex * laneW + 1;
                const w = laneW - 2;

                if (note.type === 'long_head') {
                    const grad = ctx.createLinearGradient(x, topY + bodyH, x, topY);
                    grad.addColorStop(0, darkerColor);
                    grad.addColorStop(1, color);
                    ctx.fillStyle  = grad;
                    ctx.globalAlpha = 0.9;
                    this._roundRect(ctx, x, topY, w, bodyH, this.NOTE_RADIUS);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                } else if (note.type !== 'long_tail') {
                    ctx.fillStyle = color;
                    if (note.type === 'false') {
                        ctx.shadowColor = color;
                        ctx.shadowBlur  = 8;
                    }
                    this._roundRect(ctx, x, topY, w, noteBarH, this.NOTE_RADIUS);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
        },

        // 둥근 사각형 path 헬퍼 (Path2D 미지원 구형 브라우저 대응)
        _roundRect(ctx, x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arcTo(x + w, y,     x + w, y + r,     r);
            ctx.lineTo(x + w, y + h - r);
            ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h);
            ctx.arcTo(x,     y + h, x,     y + h - r, r);
            ctx.lineTo(x,     y + r);
            ctx.arcTo(x,     y,     x + r, y,         r);
            ctx.closePath();
        },

        // 매 프레임 전체 씬 렌더링
        render(notes, laneCount, activeLanes, laneIdMapping, elapsedTime, noteSpeed) {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.w, this.h);
            this.drawLaneBackground(laneCount, activeLanes);
            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (note._visible) {
                    this.drawNote(note, laneIdMapping, elapsedTime, noteSpeed);
                }
            }
        },
    },
    // ────────────────────────────────────────────────────────────────────────

    // 트리거 전환 기본 소요 시간(ms) — 트리거에 개별 transitionMs가 없을 때(구버전 차트) 사용하는 기본값
    TRIGGER_TRANSITION_MS: 700,

    // 특정 시점 기준으로, 몇 번째 트리거가 적용 중인지 인덱스를 찾는다.
    // (-1이면 아직 첫 트리거에 도달하지 않음)
    _findActiveTriggerIndex(elapsedTime) {
        const triggers = this.state.triggers;
        if (!triggers || triggers.length === 0) return -1;
        let idx = -1;
        for (let i = 0; i < triggers.length; i++) {
            if (triggers[i].time <= elapsedTime) idx = i;
            else break; // triggers는 시간순 정렬되어 있음
        }
        return idx;
    },

    // 특정 시점에 적용 중인 트리거(가장 최근에 지난 트리거)를 찾는다.
    // 트리거가 없거나 아직 첫 트리거에 도달하지 않았으면 null.
    getActiveTrigger(elapsedTime) {
        const idx = this._findActiveTriggerIndex(elapsedTime);
        return idx >= 0 ? this.state.triggers[idx] : null;
    },

    // 트리거에 따라 현재 BPM/하강 속도를 갱신한다.
    // 트리거 시점부터 TRIGGER_TRANSITION_MS 동안 이전 값 → 목표 값으로 부드럽게(ease-in-out) 전환한다.
    applyActiveTrigger(elapsedTime) {
        const triggers = this.state.triggers;
        if (!triggers || triggers.length === 0) return;

        const base = { bpm: this.state.baseBpm, fallSpeed: this.state.baseNoteSpeed };
        const idx = this._findActiveTriggerIndex(elapsedTime);

        const target = idx >= 0 ? triggers[idx] : base;
        const from   = idx >= 1 ? triggers[idx - 1] : base;
        const transitionStart = idx >= 0 ? triggers[idx].time : 0;

        const progress = Math.min(1, Math.max(0, (elapsedTime - transitionStart) / (target.transitionMs ?? this.TRIGGER_TRANSITION_MS)));
        // ease-in-out (급가속/급감속 없이 부드럽게 목표 속도에 도달)
        const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        this.state.settings.bpm       = from.bpm       + (target.bpm       - from.bpm)       * eased;
        this.state.settings.noteSpeed = from.fallSpeed + (target.fallSpeed - from.fallSpeed) * eased;
    },

    resetState() {
        this.state.score = 0;
        this.state.combo = 0;
        this.state.maxCombo = 0;
        this.state.judgements = { perfect: 0, good: 0, bad: 0, miss: 0 };
        this.state.processedNotes = 0;
        this.state.isPaused = false;
        this.state.totalPausedTime = 0;
        this.state.unprocessedNoteIndex = 0;
        this.state.settings.requiredSongName = null;
        this.state.animationFrameId = null;
        this.state.countdownIntervalId = null;
        this.state.audioReady = false;
    },

    runCountdown(onComplete) {
        this.cancelCountdown();
        let count = 3;
        const countdownEl = DOM.countdownTextEl;
        const tick = () => {
            countdownEl.classList.remove('show');
            void countdownEl.offsetWidth;
            if (count >= 0) {
                if (count > 0) {
                    countdownEl.textContent = count;
                    Audio.playCountdownTick();
                } else {
                    countdownEl.textContent = 'START!';
                    Audio.playCountdownStart();
                }
                countdownEl.classList.add('show');
                count--;
            } else {
                this.cancelCountdown();
                onComplete();
            }
        };
        tick();
        this.state.countdownIntervalId = setInterval(tick, 1000);
    },

    cancelCountdown() {
        if (this.state.countdownIntervalId) {
            clearInterval(this.state.countdownIntervalId);
            this.state.countdownIntervalId = null;
        }
        DOM.countdownTextEl.classList.remove('show');
    },

    async start() {
        await Audio.start();
        this.resetState();
        resetPlayingScreenUI();

        if (this.state.settings.mode === 'random') {
            this.generateRandomNotes();
        } else { // Music Mode
            if (!this.state.chartData) {
                UI.showMessage('menu', '뮤직 모드를 시작하려면 차트 파일을 먼저 불러와주세요.');
                return;
            }
            if (!this.state.settings.musicFileObject && !this.state.settings.musicSrc) {
                UI.showMessage('menu', '뮤직 모드를 시작하려면 음악 파일을 먼저 불러와주세요.');
                return;
            }
            this.prepareNotesFromChartData();
        }

        this.setupLanes();

        // Canvas 초기화 (레인 생성 후 크기 확정)
        this.canvas.init();
        this.canvas.resize(this.state.settings.lanes);

        UI.showScreen('playing');
        UI.updateScoreboard();
        {
            const lastNote = this.state.notes.length ? this.state.notes[this.state.notes.length - 1] : null;
            UI.updateHud(lastNote ? lastNote.time : 0, 100);
        }
        this.state.gameState = 'countdown';
        this.state.audioReady = false; // Fix 2: 오디오가 실제로 진행 중일 때만 오디오 클럭 사용

        if (this.state.settings.mode === 'music') {
            if (this.state.settings.musicFileObject) {
                const musicUrl = URL.createObjectURL(this.state.settings.musicFileObject);
                DOM.musicPlayer.src = musicUrl;
            } else if (this.state.settings.musicSrc) {
                DOM.musicPlayer.src = this.state.settings.musicSrc;
            }

            // AudioEngine은 src 할당 시점에 이미 fetch+decode를 시작하므로,
            // 카운트다운 4초 동안 디코딩이 끝나 재생 시작 시 버퍼링 지연이 없다.
            // (기존의 "미리 play 후 pause" 워밍업 트릭은 더 이상 필요 없음)
            DOM.musicPlayer.currentTime = this.state.settings.songStartOffset || 0;
        }

        const COUNTDOWN_DURATION_MS = 4000;
        this.state.gameStartTime = performance.now() + COUNTDOWN_DURATION_MS;

        this.loop(performance.now());

        this.runCountdown(() => {
            this.state.gameState = 'playing';
            if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                DOM.musicPlayer.currentTime = this.state.settings.songStartOffset || 0;
                DOM.musicPlayer.play().then(() => {
                    this.state.audioReady = true;
                }).catch(() => {});
            }
        });
    },

    end() {
        try {
            const activeStates = ['playing', 'countdown'];
            if (!activeStates.includes(this.state.gameState) && !this.state.isPaused) return;

            this.cancelCountdown();

            cancelAnimationFrame(this.state.animationFrameId);
            this.state.animationFrameId = null;

            if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                DOM.musicPlayer.pause();
                DOM.musicPlayer.load();

                if (DOM.musicPlayer.src.startsWith('blob:')) {
                    URL.revokeObjectURL(DOM.musicPlayer.src);
                }
            }

            // Canvas 클리어
            if (this.canvas.ctx) {
                this.canvas.ctx.clearRect(0, 0, this.canvas.w, this.canvas.h);
            }

            this.state.gameState = 'result';
            resetPlayingScreenUI();
            UI.updateResultScreen();
            UI.showScreen('result');

            if (this.state._onlineChartId) {
                const resultEl = document.getElementById('online-score-result');
                if (resultEl) {
                    resultEl.textContent = '점수 등록 중…';
                    resultEl.className = 'text-sm text-gray-400 mt-2';
                    resultEl.classList.remove('hidden');
                }
                submitOnlineScore().catch(() => {});
            }
        } catch (err) {
            Debugger.logError(err, 'Game.end');
        }
    },

    prepareNotesFromChartData() {
        const chartData = JSON.parse(JSON.stringify(this.state.chartData));

        // loadChartNotes()가 미리 settings.lanes를 chartData.laneCount로 맞춰주지만,
        // 이 함수가 실제 게임플레이 노트를 최종적으로 만드는 지점이므로
        // 여기서도 직접 한 번 더 확인해 어떤 호출 경로로 오든 항상 정확한 레인 수를 쓰도록 한다.
        if (chartData.laneCount && CONFIG.LANE_KEY_MAPPING_ORDER[chartData.laneCount]) {
            this.state.settings.lanes = chartData.laneCount;
        }
        const playerLaneCount = this.state.settings.lanes;
        const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[playerLaneCount];

        const processedNotes = [];
        let noteIdCounter = 0;

        chartData.notes.forEach(note => {
            const laneId = note.lane;
            const gameLaneIndex = requiredLaneIds.indexOf(laneId);
            if (gameLaneIndex !== -1) {
                const newNoteBase = { time: note.time, lane: gameLaneIndex, processed: false };
                const type = note.type || 'tap';
                if (note.duration) {
                    const noteId = noteIdCounter++;
                    processedNotes.push({ ...newNoteBase, type: 'long_head', duration: note.duration, noteId, headProcessed: false });
                    processedNotes.push({ ...newNoteBase, time: note.time + note.duration, type: 'long_tail', noteId });
                } else {
                    processedNotes.push({ ...newNoteBase, type: type });
                }
            }
        });

        this.state.notes = processedNotes.sort((a, b) => a.time - b.time);
        this.state.totalNotes = this.state.notes.filter(n => n.type !== 'long_tail').length;
    },

    loop(timestamp) {
        try {
            Debugger.profileStart('Game.loop');
            if (this.state.isPaused) return;

            const self = this;
            let elapsedTime;

            if (self.state.settings.mode === 'music' && self.state.audioReady) {
                elapsedTime = Math.max(0, (DOM.musicPlayer.currentTime - self.state.settings.startTimeOffset) * 1000);
            } else {
                elapsedTime = timestamp - self.state.gameStartTime - self.state.totalPausedTime;
            }

            self.applyActiveTrigger(elapsedTime);

            self.updateNotes(elapsedTime);

            // 인게임 HUD: 남은 시간(마지막 노트 기준) / 현재 정확도(판정 가중 평균)
            const lastNote = self.state.notes.length ? self.state.notes[self.state.notes.length - 1] : null;
            const totalMs = lastNote ? lastNote.time : 0;
            const remainingMs = totalMs - elapsedTime;
            const j = self.state.judgements;
            const judgedCount = j.perfect + j.good + j.bad + j.miss;
            const accuracyPercent = judgedCount === 0
                ? 100
                : ((j.perfect * CONFIG.POINTS.perfect + j.good * CONFIG.POINTS.good + j.bad * CONFIG.POINTS.bad) / (judgedCount * CONFIG.POINTS.perfect)) * 100;
            UI.updateHud(remainingMs, accuracyPercent);

            // Canvas 렌더
            self.canvas.render(
                self.state.notes,
                self.state.settings.lanes,
                self.state.activeLanes,
                self.state.laneIdMapping,
                elapsedTime,
                self.state.settings.noteSpeed
            );

            if (self.state.processedNotes >= self.state.totalNotes && self.state.totalNotes > 0) {
                setTimeout(() => self.end(), 500);
                return;
            }
            self.state.animationFrameId = requestAnimationFrame(self.loop.bind(self));
        } catch (err) {
            Debugger.logError(err, 'Game.loop');
        } finally {
            Debugger.profileEnd('Game.loop');
            if (this.state.gameState === 'playing' || this.state.gameState === 'countdown') {
                Debugger.updatePerf(timestamp);
                Debugger.updateState(this.state);
            }
        }
    },

    updateNotes(elapsedTime) {
        try {
            Debugger.profileStart('Game.updateNotes');
            const gameHeight = this.canvas.h || DOM.lanesContainer.clientHeight;
            if (gameHeight === 0) return;

            const isCircle = document.body.classList.contains('circle-notes');
            const noteH    = isCircle ? this.canvas.NOTE_CIRCLE_D : this.canvas.NOTE_BAR_H;
            const jY       = this.canvas.judgementLineY(); // 판정선 top Y

            for (let i = this.state.unprocessedNoteIndex; i < this.state.notes.length; i++) {
                const note = this.state.notes[i];

                // 이미 처리 완료되고 visible도 false면 인덱스 전진
                if (note.processed && !note._visible) {
                    if (i === this.state.unprocessedNoteIndex) {
                        this.state.unprocessedNoteIndex++;
                    }
                    continue;
                }

                // long_head 처리 완료 → 롱노트 꼬리 미처리 감지
                if (note.type === 'long_head' && note.processed) {
                    const tailNote = this.state.notes.find(n => n.noteId === note.noteId && n.type === 'long_tail');
                    if (tailNote && !tailNote.processed && !this.state.activeLanes[note.lane]) {
                        this.handleJudgement('miss', tailNote);
                    }
                }

                const timeToHit = note.time - elapsedTime;
                // 노트 하단 Y (판정선 기준: 0ms = jY, 음수 = 판정선 아래)
                const noteBottomY = jY - (timeToHit * this.state.settings.noteSpeed / 10);

                // 아직 화면 밖(위)이고 처리 안됐으면 이후 노트도 마찬가지 → 중단
                // long_tail은 건너뜀: tail.time이 멀어도 그 뒤에 있는 다른 노트들은
                // 실제로는 head보다 먼저 등장할 수 있으므로 break 판단에서 제외한다
                if (note.type !== 'long_tail' && !note._visible && !note.processed && noteBottomY <= -noteH) {
                    break;
                }

                // 롱노트 높이 계산
                let drawH;
                if (note.type === 'long_head') {
                    const minH = isCircle ? this.canvas.NOTE_CIRCLE_D : this.canvas.NOTE_BAR_H;
                    drawH = Math.max((note.duration / 10) * this.state.settings.noteSpeed, minH);
                } else {
                    drawH = noteH;
                }

                const noteTopY = noteBottomY - drawH;

                // 화면 안에 들어왔는지 여부
                const inView = noteBottomY > -noteH && noteTopY < gameHeight;

                if (!note.processed && (note.type === 'tap' || note.type === 'long_head' || note.type === 'false')) {
                    if (inView) {
                        note._visible = true;
                    } else {
                        note._visible = false;
                    }
                }

                // 롱노트 수축 처리: _visible만 관리 (위치/높이는 drawNote에서 직접 계산)
                if (note.type === 'long_head' && note.shrinking && note.tailTime !== undefined) {
                    const timeUntilTail = note.tailTime - elapsedTime;
                    note._visible = timeUntilTail > 0;
                }

                // MISS 판정 (판정선을 완전히 지난 노트)
                // false 노트는 안 눌렀을 때 perfect이므로 판정선을 막 지난 순간 바로 처리
                if (!note.processed) {
                    const autoMissThreshold = note.type === 'false'
                        ? -CONFIG.JUDGEMENT_WINDOWS_MS.perfect
                        : -CONFIG.JUDGEMENT_WINDOWS_MS.miss;
                    if (timeToHit < autoMissThreshold) {
                        this.handleJudgement('miss', note);
                    }
                }
            }
        } catch (err) {
            Debugger.logError(err, 'Game.updateNotes');
        } finally {
            Debugger.profileEnd('Game.updateNotes');
        }
    },

    _processSingleJudgement(judgement, note) {
        note.processed = true;
        // long_head + perfect/good: shrinking 수축 애니메이션 → updateNotes가 _visible 관리
        // 그 외(miss/bad 포함 모든 타입): 즉시 숨김
        const willShrink = note.type === 'long_head' && judgement !== 'miss';
        if (!willShrink) {
            note._visible = false;
        }

        if (note.type === 'long_tail') {
            // 헤드도 숨김 처리
            const headNote = this.state.notes.find(n => n.noteId === note.noteId && n.type === 'long_head');
            if (headNote) headNote._visible = false;
        }

        this.state.judgements[judgement]++;
        if (note.type !== 'long_head') {
            this.state.processedNotes++;
        }
        this.state.score += CONFIG.POINTS[judgement];
        if (judgement === 'miss' || judgement === 'bad') {
            this.state.combo = 0;
        } else {
            this.state.combo++;
            if (this.state.combo > this.state.maxCombo) this.state.maxCombo = this.state.combo;
            if (note.type === 'long_head') {
                // 롱노트 헤드 성공 → 수축 시작
                note.shrinking = true;
                const tailNote = this.state.notes.find(n => n.noteId === note.noteId && n.type === 'long_tail');
                if (tailNote) {
                    tailNote.headProcessed = true;
                    note.tailTime = tailNote.time;
                }
            }
        }
    },

    handleJudgement(judgement, note) {
        try {
            if (note.processed) return;
            if (note.type === 'false') {
                judgement = (judgement === 'miss') ? 'perfect' : 'miss';
            }
            if (judgement === 'miss' && note.time > 0) {
                if (note.type === 'tap' || note.type === 'false') {
                    const notesAtSameTime = this.state.notes.filter(n =>
                        !n.processed && n.time === note.time && (n.type === 'tap' || n.type === 'false')
                    );
                    notesAtSameTime.forEach(n => this._processSingleJudgement('miss', n));
                } else {
                    this._processSingleJudgement('miss', note);
                }
                UI.showJudgementFeedback('MISS', 0);
                UI.updateScoreboard();
            } else {
                this._processSingleJudgement(judgement, note);
                UI.showJudgementFeedback(judgement.toUpperCase(), this.state.combo);
                UI.updateScoreboard();
            }
        } catch (err) {
            Debugger.logError(err, 'Game.handleJudgement');
        }
    },

    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.togglePause();
            return;
        }
        if (this.state.gameState !== 'playing' || this.state.isPaused) return;
        const laneIndex = this.state.keyMapping.findIndex(code => code === e.keyCode || code === e.key.toUpperCase().charCodeAt(0));
        if (laneIndex === -1 || this.state.activeLanes[laneIndex]) return;
        this.handleInputDown(laneIndex);
    },

    handleKeyUp(e) {
        if (this.state.gameState !== 'playing' || this.state.isPaused) return;
        const laneIndex = this.state.keyMapping.findIndex(code => code === e.keyCode || code === e.key.toUpperCase().charCodeAt(0));
        if (laneIndex === -1) return;
        this.handleInputUp(laneIndex);
    },

    handleInputDown(laneIndex) {
        try {
            if (this.state.gameState !== 'playing') return;

            this.state.activeLanes[laneIndex] = true;
            const laneEl = DOM.lanesContainer.children[laneIndex];
            if (laneEl && this.state.settings.laneHighlightOnInput) laneEl.classList.add('active-feedback');

            let elapsedTime;
            if (this.state.settings.mode === 'music') {
                elapsedTime = Math.max(0, (DOM.musicPlayer.currentTime - this.state.settings.startTimeOffset) * 1000);
            } else {
                elapsedTime = performance.now() - this.state.gameStartTime - this.state.totalPausedTime;
            }

            const isCircleMode = document.body.classList.contains('circle-notes');
            const noteSize = isCircleMode ? 90 : 25;
            const extraWindow = isCircleMode ? (noteSize / 2) * (10 / this.state.settings.noteSpeed) : 0;
            const judgementWindow = {
                perfect: CONFIG.JUDGEMENT_WINDOWS_MS.perfect + extraWindow,
                good: CONFIG.JUDGEMENT_WINDOWS_MS.good + extraWindow,
                bad: CONFIG.JUDGEMENT_WINDOWS_MS.bad + extraWindow,
                miss: CONFIG.JUDGEMENT_WINDOWS_MS.miss + extraWindow
            };

            let bestMatch = null;
            let smallestDiff = Infinity;
            for (let i = this.state.unprocessedNoteIndex; i < this.state.notes.length; i++) {
                const note = this.state.notes[i];
                if (note.time - elapsedTime > judgementWindow.miss) break;
                if (!note.processed && note.lane === laneIndex && (note.type === 'tap' || note.type === 'long_head' || note.type === 'false')) {
                    const timeDiff = Math.abs(note.time - elapsedTime);
                    if (timeDiff <= judgementWindow.miss && timeDiff < smallestDiff) {
                        smallestDiff = timeDiff;
                        bestMatch = note;
                    }
                }
            }
            if (bestMatch) {
                if (smallestDiff <= judgementWindow.perfect) this.handleJudgement('perfect', bestMatch);
                else if (smallestDiff <= judgementWindow.good) this.handleJudgement('good', bestMatch);
                else if (smallestDiff <= judgementWindow.bad) this.handleJudgement('bad', bestMatch);
            }
        } catch (err) {
            Debugger.logError(err, 'Game.handleInputDown');
        }
    },

    handleInputUp(laneIndex) {
        this.state.activeLanes[laneIndex] = false;
        const laneEl = DOM.lanesContainer.children[laneIndex];
        if (laneEl) laneEl.classList.remove('active-feedback');

        if (this.state.gameState !== 'playing') return;

        let elapsedTime;
        if (this.state.settings.mode === 'music') {
            elapsedTime = Math.max(0, (DOM.musicPlayer.currentTime - this.state.settings.startTimeOffset) * 1000);
        } else {
            elapsedTime = performance.now() - this.state.gameStartTime - this.state.totalPausedTime;
        }

        const isCircleMode = document.body.classList.contains('circle-notes');
        const noteSize = isCircleMode ? 90 : 25;
        const extraWindow = isCircleMode ? (noteSize / 2) * (10 / this.state.settings.noteSpeed) : 0;
        const judgementWindow = {
            perfect: CONFIG.JUDGEMENT_WINDOWS_MS.perfect + extraWindow,
            good: CONFIG.JUDGEMENT_WINDOWS_MS.good + extraWindow,
            bad: CONFIG.JUDGEMENT_WINDOWS_MS.bad + extraWindow,
            miss: CONFIG.JUDGEMENT_WINDOWS_MS.miss + extraWindow
        };

        let bestMatch = null;
        let smallestDiff = Infinity;
        for (let i = this.state.unprocessedNoteIndex; i < this.state.notes.length; i++) {
            const note = this.state.notes[i];
            if (note.time - elapsedTime > judgementWindow.miss) break;
            if (!note.processed && note.lane === laneIndex && note.type === 'long_tail' && note.headProcessed) {
                const timeDiff = Math.abs(note.time - elapsedTime);
                if (timeDiff <= judgementWindow.miss && timeDiff < smallestDiff) {
                    smallestDiff = timeDiff;
                    bestMatch = note;
                }
            }
        }
        if (bestMatch) {
            if (smallestDiff <= judgementWindow.perfect) this.handleJudgement('perfect', bestMatch);
            else if (smallestDiff <= judgementWindow.good) this.handleJudgement('good', bestMatch);
            else if (smallestDiff <= judgementWindow.bad) this.handleJudgement('bad', bestMatch);
        }
    },

    togglePause() {
        if (this.state.gameState !== 'playing' && this.state.gameState !== 'countdown') return;
        this.state.isPaused = !this.state.isPaused;
        if (this.state.isPaused) {
            this.cancelCountdown();
            this.state.pauseStartTime = performance.now();
            cancelAnimationFrame(this.state.animationFrameId);
            if (this.state.settings.mode === 'music') DOM.musicPlayer.pause();
            DOM.pauseGameBtn.classList.add('hidden');
            DOM.resumeGameBtn.classList.remove('hidden');
            DOM.playingStatusLabel.textContent = '일시 정지 중';
            DOM.settings.iconPlaying.classList.remove('hidden');
            // 자동 숨김 설정과 무관하게, 일시정지 중에는 우측 패널을 잠깐 다시 보여준다.
            UI.setPanelCollapsed(false);
        } else {
            DOM.pauseGameBtn.classList.remove('hidden');
            DOM.resumeGameBtn.classList.add('hidden');
            DOM.playingStatusLabel.textContent = '플레이 중';
            DOM.settings.iconPlaying.classList.add('hidden');
            this.runCountdown(() => {
                this.state.totalPausedTime += performance.now() - this.state.pauseStartTime;
                if (this.state.settings.mode === 'music') DOM.musicPlayer.play();
                this.state.gameState = 'playing';
                // 재개되면 "게임플레이 시 우측 화면 숨기기" 설정에 맞춰 다시 접는다.
                UI.setPanelCollapsed(this.state.settings.autoHideUiOnPlay === true);
                this.loop(performance.now());
            });
        }
    },

    setupLanes() {
        DOM.lanesContainer.innerHTML = '';
        DOM.lanesContainer.style.width = `${this.state.settings.lanes * 100}px`;
        this.state.activeLanes = Array(this.state.settings.lanes).fill(false);
        const laneCount = this.state.settings.lanes;
        const keyOrder = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        const activeKeyMap = (this.state.settings.userKeyMappingsByLanes && this.state.settings.userKeyMappingsByLanes[laneCount])
            || CONFIG.getDefaultKeyMap(laneCount);
        if (!keyOrder) {
            console.error(`Invalid number of lanes: ${laneCount}.`);
            UI.showScreen('menu');
            return;
        }

        this.state.laneIdMapping = keyOrder;

        const keysForCurrentLanes = keyOrder.map(keyId => activeKeyMap[keyId]);
        this.state.keyMapping = keysForCurrentLanes.map(keyName => {
            const upperKeyName = keyName.charAt(0).toUpperCase() + keyName.slice(1);
            return CONFIG.KEY_CODES[upperKeyName] || keyName.toUpperCase().charCodeAt(0);
        });
        const keyHintMap = { 'Space': '⎵', 'Semicolon': ';' };

        for (let i = 0; i < laneCount; i++) {
            const lane = document.createElement('div');
            lane.className = 'lane';
            lane.style.width = '100px';
            lane.dataset.laneIndex = i;
            lane.dataset.laneId = keyOrder[i];

            // 키 힌트 (DOM 텍스트, Canvas 아님)
            const keyHint = document.createElement('div');
            keyHint.className = 'key-hint';
            const keyName = keysForCurrentLanes[i];
            keyHint.textContent = keyHintMap[keyName] || keyName.toUpperCase();
            lane.appendChild(keyHint);

            // 이벤트: 클릭/터치 처리
            lane.addEventListener('mousedown',  (e) => { e.preventDefault(); this.handleInputDown(i); });
            lane.addEventListener('mouseup',    (e) => { e.preventDefault(); this.handleInputUp(i); });
            lane.addEventListener('mouseleave', (e) => { if (this.state.activeLanes[i]) this.handleInputUp(i); });
            lane.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleInputDown(i); });
            lane.addEventListener('touchend',   (e) => { e.preventDefault(); this.handleInputUp(i); });
            DOM.lanesContainer.appendChild(lane);
        }
    },

    generateRandomNotes() {
        this.state.notes = [];
        let totalNotesToGenerate = parseInt(DOM.noteCountInput.value) || CONFIG.DEFAULT_NOTE_COUNT;
        if (totalNotesToGenerate < CONFIG.NOTE_COUNT_MIN) totalNotesToGenerate = CONFIG.NOTE_COUNT_MIN;
        if (totalNotesToGenerate > CONFIG.NOTE_COUNT_MAX) totalNotesToGenerate = CONFIG.NOTE_COUNT_MAX;
        const simProbability = this.state.settings.dongtaProbability;
        const maxSimultaneous = this.state.settings.maxSimultaneousNotes;
        const dongtaTypeProbs = this.state.settings.dongtaNoteTypeProbabilities;
        const longNoteProbability = this.state.settings.longNoteProbability;
        const falseNoteProbability = this.state.settings.falseNoteProbability;
        let generatedNotesCount = 0;
        let currentTime = 1000;
        let noteIdCounter = 0;

        const determineNoteType = () => {
            const rand = Math.random();
            const cumulative = {
                tap: dongtaTypeProbs.tap,
                long: dongtaTypeProbs.tap + dongtaTypeProbs.long,
                false: dongtaTypeProbs.tap + dongtaTypeProbs.long + dongtaTypeProbs.false
            };
            if (rand < cumulative.tap) return 'tap';
            if (rand < cumulative.long) return 'long';
            return 'false';
        };

        const activeLongNotes = new Map();

        while (generatedNotesCount < totalNotesToGenerate) {
            const remainingNotes = totalNotesToGenerate - generatedNotesCount;
            const canGenerateSimultaneous = this.state.settings.lanes > 1 && remainingNotes >= 2;
            const canGenerateLongNote = remainingNotes >= 1;

            const getAvailableLanes = () => {
                const available = [];
                for (let i = 0; i < this.state.settings.lanes; i++) {
                    const longNoteEndTime = activeLongNotes.get(i);
                    if (!longNoteEndTime || currentTime >= longNoteEndTime) {
                        available.push(i);
                    }
                }
                return available;
            };

            if (canGenerateSimultaneous && Math.random() < simProbability) {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length < 2) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const numSimultaneous = Math.min(maxSimultaneous, availableLanes.length, remainingNotes);
                const actualCount = Math.max(2, Math.floor(Math.random() * (numSimultaneous - 1)) + 2);
                for (let i = availableLanes.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [availableLanes[i], availableLanes[j]] = [availableLanes[j], availableLanes[i]];
                }
                for (let i = 0; i < actualCount && i < availableLanes.length; i++) {
                    const lane = availableLanes[i];
                    const noteType = determineNoteType();
                    if (noteType === 'long') {
                        const duration = 500 + Math.random() * 1000;
                        const noteId = noteIdCounter++;
                        this.state.notes.push({ lane, time: currentTime, duration, type: 'long_head', noteId });
                        this.state.notes.push({ lane, time: currentTime + duration, type: 'long_tail', noteId });
                        activeLongNotes.set(lane, currentTime + duration);
                    } else {
                        this.state.notes.push({ lane, time: currentTime, type: noteType });
                    }
                }
                generatedNotesCount += actualCount;
            } else if (canGenerateLongNote && Math.random() < longNoteProbability) {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length === 0) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
                const duration = 500 + Math.random() * 1000;
                const noteId = noteIdCounter++;
                this.state.notes.push({ lane, time: currentTime, duration, type: 'long_head', noteId });
                this.state.notes.push({ lane, time: currentTime + duration, type: 'long_tail', noteId });
                activeLongNotes.set(lane, currentTime + duration);
                generatedNotesCount += 1;
            } else if (falseNoteProbability > 0 && Math.random() < falseNoteProbability) {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length === 0) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
                this.state.notes.push({ lane, time: currentTime, type: 'false' });
                generatedNotesCount++;
            } else {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length === 0) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
                this.state.notes.push({ lane, time: currentTime, type: 'tap' });
                generatedNotesCount++;
            }
            const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
            currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
        }
        this.state.totalNotes = generatedNotesCount;
        this.state.notes.sort((a, b) => a.time - b.time);
    },

    loadChartNotes(chartData) {
        try {
            this.state.chartData = chartData;
            this.state.settings.requiredSongName = chartData.songName || null;
            this.state.settings.startTimeOffset = chartData.startTimeOffset || 0;
            this.state.settings.songStartOffset = 0;
            const chartBPM = chartData.bpm || 120;
            this.state.settings.bpm = chartBPM;
            // 차트에 저장된 기본 하강 속도(에디터에서 설정)가 있으면 그것을 쓰고,
            // 없으면(구버전 차트 등) 기존처럼 BPM에서 계산한 값으로 대체한다.
            const speedSource = (typeof chartData.fallSpeed === 'number' && chartData.fallSpeed > 0)
                ? chartData.fallSpeed
                : Math.round(chartBPM / 20);
            this.state.settings.noteSpeed = Math.max(1, Math.min(20, speedSource));

            // 트리거(구간별 BPM/하강 속도 변경) 로드 — 시간순 정렬 보장
            this.state.triggers = Array.isArray(chartData.triggers)
                ? [...chartData.triggers].sort((a, b) => a.time - b.time)
                : [];
            this.state.baseBpm = chartBPM;
            this.state.baseNoteSpeed = this.state.settings.noteSpeed;

            // 버그 수정: 지금까지 여기서 settings.lanes(기본값 4)를 그대로 썼기 때문에,
            // 5키 이상으로 저장된 차트를 불러와도 항상 4키 매핑으로 강제되어
            // 5번째 레인 이상의 노트가 전부 누락되는 문제가 있었다.
            // 차트에 저장된 laneCount를 실제 플레이 레인 수로 반영한다.
            const chartLaneCount = chartData.laneCount;
            if (chartLaneCount && CONFIG.LANE_KEY_MAPPING_ORDER[chartLaneCount]) {
                this.state.settings.lanes = chartLaneCount;
            }
            const playerLaneCount = this.state.settings.lanes;
            const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[playerLaneCount];
            if (!requiredLaneIds) {
                throw new Error(`${playerLaneCount}레인에 대한 키 매핑 정보가 없습니다.`);
            }
            const processedNotes = [];
            let noteIdCounter = 0;
            chartData.notes.forEach(note => {
                const laneId = note.lane;
                const gameLaneIndex = requiredLaneIds.indexOf(laneId);
                if (gameLaneIndex !== -1) {
                    const newNoteBase = { time: note.time, lane: gameLaneIndex, processed: false };
                    const type = note.type || 'tap';
                    if (note.duration) {
                        const noteId = noteIdCounter++;
                        processedNotes.push({ ...newNoteBase, type: 'long_head', duration: note.duration, noteId });
                        processedNotes.push({ ...newNoteBase, time: note.time + note.duration, type: 'long_tail', noteId });
                    } else {
                        processedNotes.push({ ...newNoteBase, type: type });
                    }
                }
            });
            this.state.notes = processedNotes.sort((a, b) => a.time - b.time);
            this.state.totalNotes = this.state.notes.filter(n => n.type !== 'long_tail').length;
            return true;
        } catch (err) {
            Debugger.logError(err, 'Game.loadChartNotes');
            UI.showMessage('menu', `차트 로딩 오류: ${err.message}`);
            return false;
        }
    },
};