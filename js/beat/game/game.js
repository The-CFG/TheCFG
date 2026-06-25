const Game = {
    state: {
        gameState: 'menu',
        settings: {
            mode: 'random',
            difficulty: 'normal',
            noteSpeed: CONFIG.DIFFICULTY_SPEED.normal, // 노트 하강 속도
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
            bpm: 120,
            startTimeOffset: 0,
            userKeyMappings: null,
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
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

            // 활성 레인 피드백
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            for (let i = 0; i < laneCount; i++) {
                if (activeLanes[i]) {
                    ctx.fillRect(i * laneW + 1, 0, laneW - 2, this.h);
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
        this.state.gameState = 'countdown';
        this.state.audioReady = false; // Fix 2: 오디오가 실제로 진행 중일 때만 오디오 클럭 사용

        if (this.state.settings.mode === 'music') {
            if (this.state.settings.musicFileObject) {
                const musicUrl = URL.createObjectURL(this.state.settings.musicFileObject);
                DOM.musicPlayer.src = musicUrl;
            } else if (this.state.settings.musicSrc) {
                DOM.musicPlayer.src = this.state.settings.musicSrc;
            }

            // Fix 1: 카운트다운 중에 오디오 시스템을 선행 워밍업
            DOM.musicPlayer.currentTime = this.state.settings.startTimeOffset;
            DOM.musicPlayer.play().then(() => {
                DOM.musicPlayer.pause();
                DOM.musicPlayer.currentTime = this.state.settings.startTimeOffset;
            }).catch(() => {});
        }

        const COUNTDOWN_DURATION_MS = 4000;
        this.state.gameStartTime = performance.now() + COUNTDOWN_DURATION_MS;

        this.loop(performance.now());

        this.runCountdown(() => {
            this.state.gameState = 'playing';
            if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                DOM.musicPlayer.currentTime = this.state.settings.startTimeOffset;
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

            self.updateNotes(elapsedTime);

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
            if (laneEl) laneEl.classList.add('active-feedback');

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
        } else {
            DOM.pauseGameBtn.classList.remove('hidden');
            DOM.resumeGameBtn.classList.add('hidden');
            DOM.playingStatusLabel.textContent = '플레이 중';
            DOM.settings.iconPlaying.classList.add('hidden');
            this.runCountdown(() => {
                this.state.totalPausedTime += performance.now() - this.state.pauseStartTime;
                if (this.state.settings.mode === 'music') DOM.musicPlayer.play();
                this.state.gameState = 'playing';
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
        const activeKeyMap = this.state.settings.userKeyMappings || CONFIG.DEFAULT_KEYS;
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
            const chartBPM = chartData.bpm || 120;
            this.state.settings.bpm = chartBPM;
            const calculatedSpeed = Math.round(chartBPM / 20);
            this.state.settings.noteSpeed = Math.max(1, Math.min(20, calculatedSpeed));
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
