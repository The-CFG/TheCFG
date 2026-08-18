// ── Editor: preview 관련 메서드 ──
// editor.js에서 분리됨. editor-core.js 이후에 로드되어야 한다.
Object.assign(Editor, {
    async handlePlayPause() {
        try {
            const isMusicLoaded = !!DOM.musicPlayer.src;
            if (!isMusicLoaded && this.state.notes.length === 0) {
                UI.showMessage('editor', '음악을 불러오거나 노트를 추가해주세요.');
                return;
            }

            if (!this.state.isPlaying) {
                // timeWhenPaused가 0이면 일시정지 후 재개가 아니라 새로 재생을 시작하는
                // 경우다 — 이때만 가짜 시계의 기준점을 지금 재생헤드(previewSeekSec) 위치로
                // 다시 잡는다. 그렇지 않으면(재개) 기존 기준점을 그대로 써서 이어서 재생한다.
                if (!this.state.timeWhenPaused) {
                    this.state.playbackBaseMs = ((this.state.previewSeekSec || 0) - (this.state.song.startOffsetSec || 0)) * 1000;
                }
                this.state.playbackStartTime = performance.now() - (this.state.timeWhenPaused || 0);
                if (isMusicLoaded) {
                    // 차트/난이도를 방금 불러온 직후처럼 오디오의 currentTime이 아직
                    // 플레이헤드 위치와 어긋나 있을 수 있으므로(항상 0에서 시작하는 버그의 원인),
                    // 재생 직전에 플레이헤드 위치를 기준으로 currentTime을 맞춰준다.
                    // (일시정지 후 재개인 경우 두 값이 이미 같으므로 별다른 점프 없이 이어서 재생된다.)
                    const playheadTop = parseFloat(DOM.editor.playhead.style.top) || 0;
                    let seekSeconds = this._yToSeconds(playheadTop);
                    if (isFinite(DOM.musicPlayer.duration) && DOM.musicPlayer.duration > 0) {
                        seekSeconds = Math.min(seekSeconds, DOM.musicPlayer.duration);
                    }
                    if (Math.abs(DOM.musicPlayer.currentTime - seekSeconds) > 0.02) {
                        DOM.musicPlayer.currentTime = seekSeconds;
                    }
                    try {
                        await DOM.musicPlayer.play();
                    } catch (playErr) {
                        // play()가 시작 직후 중단(AbortError)되거나 브라우저 정책으로
                        // 거부(NotAllowedError)된 경우를 구분해서 보여준다.
                        Debugger.logError(playErr, 'Editor.handlePlayPause:play');
                        UI.showMessage('editor', `음악 재생 실패 (${playErr.name || 'Error'}): ${playErr.message || ''}`);
                        return;
                    }
                }
                DOM.editor.playBtn.textContent = "일시정지";
                this.state.isPlaying = true;

                // 좌측 오버레이로 옮겨진 채보 편집 UI라면(데스크톱, editor-layout.js) 재생 시작과
                // 함께 페이드아웃시켜, 그 아래에서 바로 시작되는 실제 노트 미리보기가 드러나게 한다.
                // 오버레이가 아닌 경우(좁은 화면)는 이 클래스가 붙어도 CSS상 아무 효과가 없다.
                DOM.editor.container.classList.add('editor-preview-fading');

                // 게임 화면 미리보기 시작
                this.startPreview();
                
                setTimeout(() => { if (this.state.isPlaying) this.loop(); }, 0);
            } else {
                this.state.timeWhenPaused = performance.now() - this.state.playbackStartTime;
                if (isMusicLoaded) DOM.musicPlayer.pause();
                DOM.editor.playBtn.textContent = "재생";
                this.state.isPlaying = false;
                cancelAnimationFrame(this.state.animationFrameId);

                // 일시정지 → 채보 편집 UI 오버레이를 다시 페이드인
                DOM.editor.container.classList.remove('editor-preview-fading');

                // 게임 화면 미리보기 정지 (노트는 유지)
                if (this.state.previewAnimationId) {
                    cancelAnimationFrame(this.state.previewAnimationId);
                    this.state.previewAnimationId = null;
                }
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.handlePlayPause');
            UI.showMessage('editor', '음악을 재생할 수 없습니다.');
        }
    },

    stopPlayback() {
        try {
            this.state.isPlaying = false;
            cancelAnimationFrame(this.state.animationFrameId);
            
            // 게임 화면 미리보기 정지
            if (this.state.previewAnimationId) {
                cancelAnimationFrame(this.state.previewAnimationId);
                this.state.previewAnimationId = null;
            }

            // 정지 → 채보 편집 UI 오버레이를 다시 페이드인
            DOM.editor.container.classList.remove('editor-preview-fading');
            
            this.state.playbackStartTime = 0;
            this.state.timeWhenPaused = 0;
            this.state.playbackBaseMs = 0;
            if (DOM.musicPlayer.src) {
                DOM.musicPlayer.pause();
                DOM.musicPlayer.currentTime = this.state.previewSeekSec || 0;
            }
            DOM.editor.playBtn.textContent = "재생";
            const playheadPosition = this._secondsToY(this.state.previewSeekSec || 0);
            this._setPlayheadTop(playheadPosition);
            DOM.editor.container.scrollTop = playheadPosition - DOM.editor.container.clientHeight / 2;
            
            // 게임 화면 초기화
            this.clearPreview();
        } catch (err) {
            Debugger.logError(err, 'Editor.stopPlayback');
        }
    },

    loop() {
        if (!this.state.isPlaying) return;
        try {
            let elapsedSeconds;
            const isMusicLoaded = !!DOM.musicPlayer.src;
            if (isMusicLoaded && !DOM.musicPlayer.paused) {
                elapsedSeconds = DOM.musicPlayer.currentTime;
            } else {
                const elapsedTimeMs = performance.now() - this.state.playbackStartTime;
                elapsedSeconds = elapsedTimeMs / 1000;
            }
            const absoluteSeconds = isMusicLoaded
                ? elapsedSeconds
                : (this.state.song.startOffsetSec || 0) + (this.state.playbackBaseMs || 0) / 1000 + elapsedSeconds;
            const playheadPosition = this._secondsToY(absoluteSeconds);
            this._setPlayheadTop(playheadPosition);
            DOM.editor.container.scrollTop = playheadPosition - DOM.editor.container.clientHeight / 2;
        } catch (err) {
            // 플레이헤드 표시 등 화면 갱신 중 발생한 오류일 뿐이므로
            // 음악 재생 자체는 멈추지 않고 다음 프레임에 계속 시도한다.
            Debugger.logError(err, 'Editor.loop');
        }
        if (this.state.isPlaying) {
            this.state.animationFrameId = requestAnimationFrame(this.loop.bind(this));
        }
    },

    startPreview() {
        try {
            // 선택된 레인 수 가져오기
            const laneCount = parseInt(DOM.editor.previewLanesSelector.value) || 4;
            
            // 레인 ID 매핑 가져오기
            const laneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
            
            // 게임 화면 레인 설정 (터치 히트박스 전용 — 실제 렌더링은 Canvas가 담당)
            DOM.lanesContainer.innerHTML = '';
            DOM.lanesContainer.style.width = `${laneCount * 100}px`;
            
            for (let i = 0; i < laneCount; i++) {
                const lane = document.createElement('div');
                lane.className = 'lane';
                lane.style.width = '100px';
                lane.dataset.laneIndex = i;
                if (laneIds && laneIds[i]) {
                    lane.dataset.laneId = laneIds[i]; // 레인 ID 저장
                }
                DOM.lanesContainer.appendChild(lane);
            }
            
            // 실제 플레이 화면과 동일한 Canvas 렌더러를 사용
            Game.canvas.init();
            Game.canvas.resize(laneCount);
            
            // 에디터 레인 하이라이트
            this.highlightEditorLanes(laneCount);
            
            // 미리보기 노트 준비
            this.preparePreviewNotes(laneCount);
            
            // 미리보기 시작 시간 기록
            this.state.previewStartTime = performance.now();
            this.state.previewLaneCount = laneCount;
            
            // 미리보기 루프 시작
            this.previewLoop();
        } catch (err) {
            Debugger.logError(err, 'Editor.startPreview');
        }
    },
    
    preparePreviewNotes(laneCount) {
        try {
            // 선택된 레인 수에 맞는 레인 ID 매핑 가져오기
            const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
            if (!requiredLaneIds) {
                console.error(`Invalid lane count: ${laneCount}`);
                return;
            }
            
            // 에디터 노트를 게임 형식으로 변환
            this.state.previewNotes = [];
            let noteIdCounter = 0;
            
            this.state.notes.forEach(note => {
                // 에디터 레인 ID를 게임 레인 인덱스로 변환
                const gameLaneIndex = requiredLaneIds.indexOf(note.lane);
                
                // 현재 선택된 레인 수에 해당하는 노트만 미리보기에 포함
                if (gameLaneIndex !== -1) {
                    // duration이 있는 노트는 롱노트로 처리
                    if (note.duration) {
                        const newNote = {
                            time: note.time,
                            lane: gameLaneIndex,
                            type: 'long_head',
                            duration: note.duration,
                            noteId: noteIdCounter++,
                            processed: false,
                        };
                        this.state.previewNotes.push(newNote);
                        
                        // long_tail 노트 추가
                        this.state.previewNotes.push({
                            time: note.time + note.duration,
                            lane: gameLaneIndex,
                            type: 'long_tail',
                            noteId: newNote.noteId,
                            processed: false,
                        });
                    } else {
                        // 일반 노트 (tap, false)
                        const newNote = {
                            time: note.time,
                            lane: gameLaneIndex,
                            type: note.type || 'tap',
                            processed: false,
                        };
                        this.state.previewNotes.push(newNote);
                    }
                }
            });
            
            // 시간순 정렬
            this.state.previewNotes.sort((a, b) => a.time - b.time);
        } catch (err) {
            Debugger.logError(err, 'Editor.preparePreviewNotes');
        }
    },
    
    previewLoop() {
        try {
            if (!this.state.isPlaying) return;
            
            // 경과 시간 계산
            // note.time은 이제 "오프셋(빨간선) 이후 경과 시간" 기준으로 저장된다(실제 게임의
            // elapsedTime = 오디오위치 - 오프셋 과 동일한 기준). 그래서 여기서도 절대 오디오
            // 위치에서 오프셋을 빼야 note.time과 같은 기준으로 비교할 수 있다.
            let elapsedTime;
            const isMusicLoaded = !!DOM.musicPlayer.src;
            const offsetMs = (this.state.song.startOffsetSec || 0) * 1000;
            
            if (isMusicLoaded && !DOM.musicPlayer.paused) {
                elapsedTime = Math.max(0, DOM.musicPlayer.currentTime * 1000 - offsetMs);
            } else {
                // 오디오 없이 재생 중일 때의 가짜 시계는 재생 시작 시점이 아니라
                // 재생을 누른 순간의 재생헤드(previewSeekSec) 위치(=playbackBaseMs)를
                // 기준으로 흘러가야 한다. 그렇지 않으면 "시작(초)"과 무관하게 항상
                // 0초부터 시작하는 것처럼 보인다.
                elapsedTime = (this.state.playbackBaseMs || 0) + (performance.now() - this.state.playbackStartTime);
            }
            
            const canvas = Game.canvas;
            const gameHeight = canvas.h || DOM.lanesContainer.clientHeight || 600;
            
            // 노트 하강 속도 설정 (트리거가 있으면 우선 적용 — 트리거 시점부터 부드럽게 전환, 없으면 에디터 입력값/BPM 기반 기본값)
            const baseNoteSpeed = parseFloat(DOM.editor.noteFallSpeedInput?.value) || Math.max(1, Math.min(20, Math.round(this.state.bpm / 20)));
            let noteSpeed = baseNoteSpeed;
            if (this.state.triggers && this.state.triggers.length > 0) {
                let idx = -1;
                for (let i = 0; i < this.state.triggers.length; i++) {
                    if (this.state.triggers[i].time <= elapsedTime) idx = i;
                    else break; // triggers는 시간순 정렬되어 있음
                }
                if (idx >= 0) {
                    const target = this.state.triggers[idx];
                    const from   = idx >= 1 ? this.state.triggers[idx - 1].fallSpeed : baseNoteSpeed;
                    const transitionMs = target.transitionMs ?? (Game.TRIGGER_TRANSITION_MS || 700);
                    const progress = Math.min(1, Math.max(0, (elapsedTime - target.time) / transitionMs));
                    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                    noteSpeed = from + (target.fallSpeed - from) * eased;
                }
            }
            
            const isCircle = document.body.classList.contains('circle-notes');
            const noteH = isCircle ? canvas.NOTE_CIRCLE_D : canvas.NOTE_BAR_H;
            const jY = canvas.judgementLineY();
            
            // 노트별 화면 표시 여부만 계산 (판정/점수 없는 순수 미리보기)
            this.state.previewNotes.forEach(note => {
                if (note.type === 'long_tail') { note._visible = false; return; }
                const timeToHit = note.time - elapsedTime;
                const bodyH = note.type === 'long_head'
                    ? Math.max((note.duration / 10) * noteSpeed, noteH)
                    : noteH;
                const noteBottomY = jY - (timeToHit * noteSpeed / 10);
                const noteTopY = noteBottomY - bodyH;
                note._visible = noteBottomY > -noteH && noteTopY < gameHeight;
            });
            
            // 실제 플레이 화면과 동일한 Canvas 렌더러로 그리기
            const laneIdMapping = CONFIG.LANE_KEY_MAPPING_ORDER[this.state.previewLaneCount] || [];
            canvas.render(this.state.previewNotes, this.state.previewLaneCount, {}, laneIdMapping, elapsedTime, noteSpeed);
            
            this.state.previewAnimationId = requestAnimationFrame(this.previewLoop.bind(this));
        } catch (err) {
            Debugger.logError(err, 'Editor.previewLoop');
        }
    },
    
    clearPreview() {
        try {
            // Canvas 지우기
            if (Game.canvas.ctx) {
                Game.canvas.ctx.clearRect(0, 0, Game.canvas.w, Game.canvas.h);
            }
            
            // 레인(히트박스) 초기화
            DOM.lanesContainer.innerHTML = '';
            
            // 하이라이트는 유지 (제거하지 않음)
            
            // 상태 초기화
            this.state.previewNotes = [];
            this.state.previewStartTime = 0;
            this.state.previewLaneCount = 4;
        } catch (err) {
            Debugger.logError(err, 'Editor.clearPreview');
        }
    },
    
});