const Editor = {
    state: {
        notes: [],
        triggers: [], // BPM/속도 변경 트리거
        bpm: 120,
        snapDivision: 4,
        history: [],
        isDirty: false,
        startTimeOffset: 0,
        audioFileName: '',
        isPlaying: false,
        animationFrameId: null,
        selectedNoteType: 'tap',
        isPlacingLongNote: false,
        longNoteStart: null,
        // 미리보기 관련 상태
        previewNotes: [],
        previewAnimationId: null,
        previewStartTime: 0,
        previewLaneCount: 4,
    },

    init() {
        try {
            this.state.isPlaying = false;
            UI.showScreen('editor');
            this.resetEditorState();
            
            // 미리보기 레인 선택 변경 시 하이라이트 업데이트
            if (DOM.editor.previewLanesSelector && !this._previewLanesListenerAttached) {
                DOM.editor.previewLanesSelector.addEventListener('change', () => {
                    const laneCount = parseInt(DOM.editor.previewLanesSelector.value) || 4;
                    this.highlightEditorLanes(laneCount);
                });
                this._previewLanesListenerAttached = true;
            }

            // 오디오 엘리먼트에서 발생하는 실제 재생 오류(코덱 미지원, 디코딩 실패 등)를
            // 잡아서 보여준다. 기존에는 이 이벤트를 듣지 않아 재생이 조용히 멈춰도
            // 원인을 알 수 없었다.
            if (!this._musicErrorListenerAttached) {
                DOM.musicPlayer.addEventListener('error', () => {
                    const mediaError = DOM.musicPlayer.error;
                    if (!mediaError) return;
                    const codeNames = {
                        1: 'MEDIA_ERR_ABORTED',
                        2: 'MEDIA_ERR_NETWORK',
                        3: 'MEDIA_ERR_DECODE',
                        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
                    };
                    const name = codeNames[mediaError.code] || `code ${mediaError.code}`;
                    console.error('[music-player error]', name, mediaError.message);
                    UI.showMessage('editor', `음악 파일을 재생할 수 없습니다 (${name}). 다른 파일로 시도해보세요.`);
                    this.state.isPlaying = false;
                    DOM.editor.playBtn.textContent = "재생";
                });

                // 별다른 동작 없이 재생이 끊기면(예: 버퍼링 중단) 콘솔에 남겨 진단에 활용한다.
                DOM.musicPlayer.addEventListener('stalled', () => {
                    console.warn('[music-player] stalled - 데이터 수신이 중단되었습니다.');
                });
                DOM.musicPlayer.addEventListener('pause', () => {
                    if (this.state.isPlaying) {
                        console.warn('[music-player] 재생 중 예기치 않게 pause 이벤트가 발생했습니다.');
                    }
                });

                this._musicErrorListenerAttached = true;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.init');
        }
    },

    resetEditorState() {
        try {
            this.state.history = [];
            this.state.notes = [];
            this.state.bpm = 120;
            this.state.snapDivision = 4;
            this.state.startTimeOffset = 0;
            this.state.audioFileName = '';
            this.state.selectedNoteType = 'tap';
            this.state.totalMeasures = 100;

            DOM.musicPlayer.pause();
            if (DOM.musicPlayer.src && DOM.musicPlayer.src.startsWith('blob:')) {
                URL.revokeObjectURL(DOM.musicPlayer.src);
            }
            DOM.musicPlayer.removeAttribute('src');
            DOM.musicPlayer.load();
            DOM.editor.bpmInput.value = this.state.bpm;
            DOM.editor.snapSelector.value = this.state.snapDivision;
            DOM.editor.startTimeInput.value = this.state.startTimeOffset;
            DOM.editor.audioFileNameEl.textContent = '선택된 파일 없음';
            DOM.editor.chartFilenameInput.value = '';

            this.updateNoteTypeUI();
            this.drawTimeline();
            this.renderNotes();
            this.setDirty(false);
        } catch (err) {
            Debugger.logError(err, 'Editor.resetEditorState');
        }
    },

    _getAdjustedBeatHeight() {
        const scaleFactor = Math.max(1, this.state.snapDivision / 4);
        return CONFIG.EDITOR_BEAT_HEIGHT * scaleFactor;
    },

    _updateDirtyIndicator() {
        DOM.editor.dirtyIndicator.textContent = this.state.isDirty ? '*' : '';
    },

    setDirty(isDirty) {
        if (this.state.isDirty === isDirty) return;
        this.state.isDirty = isDirty;
        this._updateDirtyIndicator();
    },

    _confirmDiscardChanges(message = '저장하지 않은 변경사항이 있습니다. 정말로 나가시겠습니까?') {
        if (!this.state.isDirty) {
            return true;
        }
        return confirm(message);
    },

    _saveStateForUndo() {
        this.state.history.push(JSON.parse(JSON.stringify(this.state.notes)));
        if (this.state.history.length > CONFIG.EDITOR_UNDO_HISTORY_LIMIT) {
            this.state.history.shift();
        }
    },

    clearNotes() {
        this._saveStateForUndo();
        this.setDirty(true);
        this.state.notes = [];
        this.renderNotes();
        UI.showMessage('editor', '모든 노트를 삭제했습니다.');
    },

    addMeasure() {
        try {
            this._saveStateForUndo();
            this.setDirty(true);
            this.state.totalMeasures++;
            this.drawGrid();
            this.renderNotes();
        } catch (err) {
            Debugger.logError(err, 'Editor.addMeasure');
        }
    },

    removeMeasure() {
        try {
            if (this.state.totalMeasures > 1) {
                this._saveStateForUndo();
                this.setDirty(true);
                const measureToRemove = this.state.totalMeasures - 1;
                this.state.notes = this.state.notes.filter(note => this._getMeasureFromTime(note.time) !== measureToRemove);
                this.state.totalMeasures--;
                this.drawGrid();
                this.renderNotes();
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.removeMeasure');
        }
    },

    _getMeasureFromTime(timeInMs) {
        const beatsPerMeasure = 4;
        const beatsPerSecond = this.state.bpm / 60;
        const totalBeats = (timeInMs / 1000) * beatsPerSecond;
        return Math.floor(totalBeats / beatsPerMeasure);
    },

    drawTimeline() {
        try {
            const gridContainer = DOM.editor.gridContainer;
            gridContainer.innerHTML = '';

            CONFIG.EDITOR_LANE_IDS.forEach((id, index) => {
                const laneEl = document.createElement('div');
                laneEl.className = 'editor-lane';
                laneEl.dataset.laneId = id;
                gridContainer.appendChild(laneEl);
            });

            this.drawGrid();
            this.addLaneLabels();
            
            // 초기 하이라이트 적용
            const laneCount = parseInt(DOM.editor.previewLanesSelector?.value) || 4;
            this.highlightEditorLanes(laneCount);
        } catch (err) {
            Debugger.logError(err, 'Editor.drawTimeline');
        }
    },

    drawGrid() {
        try {
            DOM.editor.notesContainer.querySelectorAll('.beat-line').forEach(l => l.remove());
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerMeasure = 4;
            const totalBeats = this.state.totalMeasures * beatsPerMeasure;
            const timelineHeight = totalBeats * adjustedBeatHeight;

            DOM.editor.timeline.style.height = `${timelineHeight}px`;
            DOM.editor.notesContainer.style.height = `${timelineHeight}px`;
            DOM.editor.gridContainer.style.height = `${timelineHeight}px`;

            const measureHeight = beatsPerMeasure * adjustedBeatHeight;

            for (let i = 0; i < this.state.totalMeasures; i++) {
                for (let j = 0; j < this.state.snapDivision; j++) {
                    const line = document.createElement('div');
                    line.className = 'beat-line';
                    if (j === 0) {
                        line.classList.add('measure');
                    } else if (j % (this.state.snapDivision / 4) === 0) {
                        line.style.backgroundColor = '#6b7280';
                    } else {
                        line.style.backgroundColor = '#4a5568';
                    }
                    const yPosition = (i * measureHeight) + (j / this.state.snapDivision) * measureHeight;
                    line.style.top = `${yPosition}px`;
                    line.style.width = '100%';
                    DOM.editor.notesContainer.insertBefore(line, DOM.editor.playhead);
                }
            }
            
            // 레인 라벨 재생성
            this.addLaneLabels();
        } catch (err) {
            Debugger.logError(err, 'Editor.drawGrid');
        }
    },

    // 파일 확장자 -> MIME 타입 매핑. <input> 이나 OS/모바일 파일 선택기가
    // file.type을 비워서 주는 경우(특히 모바일)가 많아, blob URL만으로는
    // <audio>가 포맷을 인식하지 못해 MEDIA_ERR_SRC_NOT_SUPPORTED가 발생한다.
    _resolveAudioMimeType(file) {
        const knownTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/webm', 'audio/x-m4a'];
        if (file.type && knownTypes.includes(file.type)) return file.type;

        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const extToMime = {
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            ogg: 'audio/ogg',
            oga: 'audio/ogg',
            m4a: 'audio/mp4',
            mp4: 'audio/mp4',
            aac: 'audio/aac',
            flac: 'audio/flac',
            webm: 'audio/webm',
        };
        return extToMime[ext] || file.type || 'audio/mpeg';
    },

    handleAudioLoad(e) {
        try {
            const file = e.target.files[0];
            if (file) {
                this.setDirty(true);

                // 이전에 만들어둔 blob URL이 남아있으면 메모리 누수 및
                // 일부 브라우저에서의 재생 충돌을 막기 위해 미리 해제한다.
                if (DOM.musicPlayer.src && DOM.musicPlayer.src.startsWith('blob:')) {
                    URL.revokeObjectURL(DOM.musicPlayer.src);
                }

                // 재생 중이던 상태를 완전히 정리한 뒤 새 파일을 로드한다.
                DOM.musicPlayer.pause();
                this.state.isPlaying = false;
                cancelAnimationFrame(this.state.animationFrameId);

                // file.type이 비어있거나 잘못된 경우를 대비해, 정확한 MIME 타입을
                // 명시한 새 Blob을 만들어 createObjectURL에 사용한다.
                const mimeType = this._resolveAudioMimeType(file);
                const typedBlob = (file.type === mimeType) ? file : file.slice(0, file.size, mimeType);
                DOM.musicPlayer.src = URL.createObjectURL(typedBlob);
                // 새 소스를 명시적으로 로드해 이전 상태(readyState)를 깨끗하게 리셋한다.
                DOM.musicPlayer.load();

                this.state.audioFileName = file.name;
                DOM.editor.audioFileNameEl.textContent = file.name;
                DOM.musicPlayer.onloadedmetadata = () => this.drawGrid();
            }
            e.target.value = null;
        } catch (err) {
            Debugger.logError(err, 'Editor.handleAudioLoad');
        }
    },

    handleChartLoad(e) {
        // 실제 로직은 js/main.js의 이벤트 리스너에서 처리
    },

    handleReset() {
        const confirmMessage = this.state.isDirty
            ? '저장하지 않은 변경사항이 있습니다. 모든 노트를 삭제하고 재설정하시겠습니까?'
            : '모든 노트를 삭제합니다. 정말로 재설정하시겠습니까?';

        if (confirm(confirmMessage)) {
            this._saveStateForUndo();
            this.state.notes = [];
            this.renderNotes();
            UI.showMessage('editor', '모든 노트를 삭제했습니다.');
            this.setDirty(true);
        }
    },

    handleTimelineClick(e) {
        try {
            if (this.state.isPlaying) return;
            this.setDirty(true);
            this._saveStateForUndo();

            if (e.target.classList.contains('editor-note')) {
                const time = parseFloat(e.target.dataset.time);
                const lane = e.target.dataset.lane;
                this.state.notes = this.state.notes.filter(note => note.time !== time || note.lane !== lane);
                this.renderNotes();
                return;
            }

            const container = DOM.editor.container;
            const rect = container.getBoundingClientRect();
            const laneWidth = container.clientWidth / CONFIG.EDITOR_LANE_IDS.length;
            const x = e.clientX - rect.left;
            const laneIndex = Math.floor(x / laneWidth);
            const laneId = CONFIG.EDITOR_LANE_IDS[laneIndex];
            const y = e.clientY - rect.top + container.scrollTop;
            
            // 그리드 라인과 정확히 일치하는 계산
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerMeasure = 4;
            const measureHeight = beatsPerMeasure * adjustedBeatHeight;
            const snapHeight = measureHeight / this.state.snapDivision;
            
            // 가장 가까운 스냅 포인트 찾기
            const snapIndex = Math.round(y / snapHeight);
            const snappedY = snapIndex * snapHeight;
            
            // 시간 계산 (비트 -> 밀리초)
            const beatsPerSecond = this.state.bpm / 60;
            const totalBeats = snappedY / adjustedBeatHeight;
            const timeInMs = Math.round((totalBeats / beatsPerSecond) * 1000);

            switch (this.state.selectedNoteType) {
                case 'long': this.placeLongNote(timeInMs, laneId); break;
                case 'trigger': this.placeTrigger(timeInMs); break;
                case 'tap': case 'false': this.placeSimpleNote(timeInMs, laneId); break;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.handleTimelineClick');
        }
    },

    placeSimpleNote(time, laneId) {
        if (!this.state.notes.some(n => Math.abs(n.time - time) < 10 && n.lane === laneId)) {
            const measure = this._getMeasureFromTime(time);
            this.state.notes.push({ time, lane: laneId, type: this.state.selectedNoteType, measure });
            this.renderNotes();
        }
    },

    placeLongNote(time, laneId) {
        if (!this.state.isPlacingLongNote) {
            this.state.longNoteStart = { time, lane: laneId };
            this.state.isPlacingLongNote = true;
            DOM.editor.statusLabel.textContent = '롱노트의 끝 지점을 지정해주세요.';
        } else {
            if (laneId !== this.state.longNoteStart.lane) {
                UI.showMessage('editor', '시작 지점과 같은 레인을 선택해주세요.');
                return;
            }
            if (time <= this.state.longNoteStart.time) {
                UI.showMessage('editor', '끝 지점은 시작 지점보다 뒤에 있어야 합니다.');
                return;
            }
            const duration = time - this.state.longNoteStart.time;
            const measure = this._getMeasureFromTime(this.state.longNoteStart.time);
            this.state.notes.push({ ...this.state.longNoteStart, duration, type: 'long_head', measure });
            this.renderNotes();
            this.resetLongNotePlacement();
            DOM.editor.statusLabel.textContent = '롱노트의 시작 지점을 지정해주세요.';
        }
    },

    placeTrigger(time) {
        this.state.pendingTriggerTime = time;
        this.showTriggerModal();
    },

    showTriggerModal() {
        // 현재 설정값으로 모달 초기화
        DOM.triggerModal.bpmInput.value = this.state.bpm;
        DOM.triggerModal.spawnSpeedInput.value = parseFloat(DOM.editor.noteSpawnSpeedInput?.value) || 1.5;
        DOM.triggerModal.fallSpeedInput.value = parseFloat(DOM.editor.noteFallSpeedInput?.value) || 7;
        DOM.triggerModal.container.classList.remove('hidden');
    },

    hideTriggerModal() {
        DOM.triggerModal.container.classList.add('hidden');
        this.state.pendingTriggerTime = null;
    },

    confirmTrigger() {
        const time = this.state.pendingTriggerTime;
        if (time == null) return;

        const bpm = parseFloat(DOM.triggerModal.bpmInput.value);
        const spawnSpeed = parseFloat(DOM.triggerModal.spawnSpeedInput.value);
        const fallSpeed = parseFloat(DOM.triggerModal.fallSpeedInput.value);

        // 기존 동일 시간 트리거 제거
        this.state.triggers = this.state.triggers.filter(t => Math.abs(t.time - time) >= 10);
        
        // 새 트리거 추가
        this.state.triggers.push({
            time,
            bpm,
            spawnSpeed,
            fallSpeed
        });

        this.state.triggers.sort((a, b) => a.time - b.time);
        this.renderTriggers();
        this.hideTriggerModal();
        this.setDirty(true);
    },

    renderTriggers() {
        try {
            DOM.editor.notesContainer.querySelectorAll('.editor-trigger').forEach(t => t.remove());
            const container = DOM.editor.container;
            if (container.clientWidth === 0) return;
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerSecond = this.state.bpm / 60;

            this.state.triggers.forEach(trigger => {
                const triggerEl = document.createElement('div');
                triggerEl.className = 'editor-trigger';
                triggerEl.style.width = '100%';
                triggerEl.style.height = '3px';
                triggerEl.style.backgroundColor = '#fbbf24';
                triggerEl.style.position = 'absolute';
                triggerEl.style.left = '0';
                triggerEl.style.cursor = 'pointer';
                triggerEl.style.zIndex = '5';
                
                const beats = (trigger.time / 1000) * beatsPerSecond;
                const yPosition = beats * adjustedBeatHeight;
                triggerEl.style.top = `${yPosition}px`;
                
                triggerEl.dataset.time = trigger.time;
                triggerEl.title = `BPM: ${trigger.bpm}, 속도: ${trigger.spawnSpeed}x, 하강: ${trigger.fallSpeed}`;
                
                // 클릭 시 삭제
                triggerEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.state.triggers = this.state.triggers.filter(t => t.time !== trigger.time);
                    this.renderTriggers();
                    this.setDirty(true);
                });
                
                DOM.editor.notesContainer.appendChild(triggerEl);
            });
        } catch (err) {
            Debugger.logError(err, 'Editor.renderTriggers');
        }
    },

    renderNotes() {
        try {
            DOM.editor.notesContainer.querySelectorAll('.editor-note').forEach(n => n.remove());
            const container = DOM.editor.container;
            if (container.clientWidth === 0) return;
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const laneWidth = container.clientWidth / CONFIG.EDITOR_LANE_IDS.length;
            const beatsPerSecond = this.state.bpm / 60;

            this.state.notes.forEach(note => {
                const noteEl = document.createElement('div');
                noteEl.className = 'editor-note';
                if (note.duration) noteEl.classList.add('long');
                if (note.type === 'false') noteEl.classList.add('false');
                const laneIndex = CONFIG.EDITOR_LANE_IDS.indexOf(note.lane);
                if (laneIndex === -1) return;
                noteEl.style.width = `${laneWidth}px`;
                noteEl.style.left = `${laneIndex * laneWidth}px`;
                
                // 그리드 라인과 정확히 일치하도록 위치 계산
                const beats = (note.time / 1000) * beatsPerSecond;
                const yPosition = beats * adjustedBeatHeight;
                noteEl.style.top = `${yPosition}px`;
                
                if (note.duration) {
                    const durationInBeats = (note.duration / 1000) * beatsPerSecond;
                    noteEl.style.height = `${durationInBeats * adjustedBeatHeight}px`;
                }
                noteEl.dataset.time = note.time;
                noteEl.dataset.lane = note.lane;
                
                // 레인별 색상 모드일 때 인라인 스타일 적용
                if (Appearance.settings.colorMode === 'lane' && note.lane) {
                    const color = Appearance.settings.laneColors[note.lane];
                    if (color) {
                        if (note.duration) {
                            const gradientStart = Appearance.adjustColor(color, -20);
                            noteEl.style.background = `linear-gradient(to top, ${gradientStart}, ${color})`;
                        } else {
                            noteEl.style.backgroundColor = color;
                            if (note.type === 'false') {
                                noteEl.style.boxShadow = `0 0 4px ${color}`;
                            }
                        }
                    }
                }
                
                DOM.editor.notesContainer.appendChild(noteEl);
            });
            
            // 트리거도 함께 렌더링
            this.renderTriggers();
        } catch (err) {
            Debugger.logError(err, 'Editor.renderNotes');
        }
    },

    saveChart() {
        try {
            if (!this.state.audioFileName) {
                UI.showMessage('editor', '음악 파일을 로딩해주세요!');
                return;
            }
            let chartFilename = DOM.editor.chartFilenameInput.value.trim();
            if (!chartFilename) {
                chartFilename = this.state.audioFileName.split('.').slice(0, -1).join('.');
            }
            const gameNotes = this.state.notes.map(note => {
                if (note.type === 'long_head') return { time: note.time, lane: note.lane, duration: note.duration };
                if (note.type === 'tap') return { time: note.time, lane: note.lane };
                return { time: note.time, lane: note.lane, type: note.type };
            }).filter(note => note.type !== 'long_tail');
            const chart = {
                songName: this.state.audioFileName,
                bpm: this.state.bpm,
                startTimeOffset: this.state.startTimeOffset,
                notes: gameNotes.sort((a, b) => a.time - b.time),
                triggers: this.state.triggers || []
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(chart, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", chartFilename + ".json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            this.setDirty(false);
        } catch (err) {
            Debugger.logError(err, 'Editor.saveChart');
            UI.showMessage('editor', `저장 실패: ${err.message}`);
        }
    },

    loadChart(chartData, loadedFileName) {
        try {
            this.resetEditorState();
            this.state.history = [];
            this.state.bpm = chartData.bpm || 120;
            this.state.triggers = chartData.triggers || [];
            this.state.notes = chartData.notes.map(note => {
                const measure = this._getMeasureFromTime(note.time);
                let newNote = { ...note, measure };
                if (note.duration) newNote.type = 'long_head';
                else if (note.type === 'false') newNote.type = 'false';
                else newNote.type = 'tap';
                return newNote;
            });
            let maxMeasure = 0;
            if (this.state.notes.length > 0) {
                maxMeasure = Math.max(...this.state.notes.map(n => n.measure));
            }
            this.state.totalMeasures = maxMeasure + 5;
            this.state.startTimeOffset = chartData.startTimeOffset || 0;
            DOM.editor.bpmInput.value = this.state.bpm;
            DOM.editor.startTimeInput.value = this.state.startTimeOffset;
            DOM.editor.audioFileNameEl.textContent = `요구 파일: ${chartData.songName || '없음'}`;
            if (loadedFileName) {
                DOM.editor.chartFilenameInput.value = loadedFileName.split('.').slice(0, -1).join('.');
            }
            this.drawTimeline();
            this.renderNotes();
            this.setDirty(false);
        } catch (err) {
            Debugger.logError(err, 'Editor.loadChart');
            UI.showMessage('editor', `차트 해석 오류: ${err.message}`);
        }
    },

    async handlePlayPause() {
        try {
            const isMusicLoaded = !!DOM.musicPlayer.src;
            if (!isMusicLoaded && this.state.notes.length === 0) {
                UI.showMessage('editor', '음악을 불러오거나 노트를 추가해주세요.');
                return;
            }

            if (!this.state.isPlaying) {
                this.state.playbackStartTime = performance.now() - (this.state.timeWhenPaused || 0);
                if (isMusicLoaded) {
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
                
                // 게임 화면 미리보기 시작
                this.startPreview();
                
                setTimeout(() => { if (this.state.isPlaying) this.loop(); }, 0);
            } else {
                this.state.timeWhenPaused = performance.now() - this.state.playbackStartTime;
                if (isMusicLoaded) DOM.musicPlayer.pause();
                DOM.editor.playBtn.textContent = "재생";
                this.state.isPlaying = false;
                cancelAnimationFrame(this.state.animationFrameId);
                
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
            
            this.state.playbackStartTime = 0;
            this.state.timeWhenPaused = 0;
            if (DOM.musicPlayer.src) {
                DOM.musicPlayer.pause();
                DOM.musicPlayer.currentTime = this.state.startTimeOffset;
            }
            DOM.editor.playBtn.textContent = "재생";
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerSecond = this.state.bpm / 60;
            const offsetBeats = this.state.startTimeOffset * beatsPerSecond;
            const playheadPosition = offsetBeats * adjustedBeatHeight;
            DOM.editor.playhead.style.top = `${playheadPosition}px`;
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
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerSecond = this.state.bpm / 60;
            const beats = ((isMusicLoaded ? elapsedSeconds : this.state.startTimeOffset + elapsedSeconds)) * beatsPerSecond;
            const playheadPosition = beats * adjustedBeatHeight;
            DOM.editor.playhead.style.top = `${playheadPosition}px`;
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

    resetLongNotePlacement(clearMessage = true) {
        this.state.isPlacingLongNote = false;
        this.state.longNoteStart = null;
        if (clearMessage && DOM.editor.statusLabel) {
            DOM.editor.statusLabel.textContent = '';
        }
    },

    updateNoteTypeUI() {
        DOM.editor.noteTypeSelector.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === this.state.selectedNoteType);
        });
    },

    handleNoteTypeSelect(e) {
        if (e.target.tagName !== 'BUTTON') return;
        this.setSelectedNoteType(e.target.dataset.type);
    },

    handleSnapChange(e) {
        this.setDirty(true);
        this.state.snapDivision = parseInt(e.target.value) || 4;
        this.drawGrid();
        this.renderNotes();
    },

    setSelectedNoteType(type) {
        this.state.selectedNoteType = type;
        this.updateNoteTypeUI();
        if (type === 'long') {
            this.state.isPlacingLongNote = false;
            DOM.editor.statusLabel.textContent = '롱노트의 시작 지점을 지정해주세요.';
        } else {
            this.resetLongNotePlacement();
        }
    },

    placeNoteAtPlayhead(laneId) {
        if (!laneId) return;
        this.setDirty(true);
        this._saveStateForUndo();
        const playheadTop = parseFloat(DOM.editor.playhead.style.top) || 0;
        const adjustedBeatHeight = this._getAdjustedBeatHeight();
        const beatsPerSecond = this.state.bpm / 60;
        const snapsPerBeat = this.state.snapDivision / 4;
        const snapHeight = adjustedBeatHeight / snapsPerBeat;
        const snapIndex = Math.round(playheadTop / snapHeight);
        const snappedBeat = snapIndex / snapsPerBeat;
        const timeInMs = Math.round((snappedBeat / beatsPerSecond) * 1000);
        this.placeSimpleNote(timeInMs, laneId);
    },

    handleUndo() {
        if (this.state.history.length > 0) {
            this.setDirty(true);
            const previousNotes = this.state.history.pop();
            this.state.notes = previousNotes;
            this.renderNotes();
        }
    },

    // ===== 에디터 미리보기 기능 =====
    
    startPreview() {
        try {
            // 선택된 레인 수 가져오기
            const laneCount = parseInt(DOM.editor.previewLanesSelector.value) || 4;
            
            // 레인 ID 매핑 가져오기
            const laneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
            
            // 게임 화면 레인 설정
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
                
                const judgementLine = document.createElement('div');
                judgementLine.className = 'judgement-line';
                lane.appendChild(judgementLine);
                
                DOM.lanesContainer.appendChild(lane);
            }
            
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
                            element: null
                        };
                        this.state.previewNotes.push(newNote);
                        
                        // long_tail 노트 추가
                        this.state.previewNotes.push({
                            time: note.time + note.duration,
                            lane: gameLaneIndex,
                            type: 'long_tail',
                            noteId: newNote.noteId,
                            processed: false,
                            element: null
                        });
                    } else {
                        // 일반 노트 (tap, false)
                        const newNote = {
                            time: note.time,
                            lane: gameLaneIndex,
                            type: note.type || 'tap',
                            processed: false,
                            element: null
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
            let elapsedTime;
            const isMusicLoaded = !!DOM.musicPlayer.src;
            
            if (isMusicLoaded && !DOM.musicPlayer.paused) {
                elapsedTime = (DOM.musicPlayer.currentTime - this.state.startTimeOffset) * 1000;
            } else {
                const elapsedMs = performance.now() - this.state.playbackStartTime;
                elapsedTime = elapsedMs;
            }
            
            // 게임 영역 높이
            const gameHeight = DOM.lanesContainer.clientHeight || 600;
            
            // 노트 하강 속도 설정 (에디터 입력값 사용, 기본값은 BPM 기반)
            let noteSpeed = parseFloat(DOM.editor.noteFallSpeedInput?.value) || Math.max(1, Math.min(20, Math.round(this.state.bpm / 20)));
            
            // 노트 생성 및 업데이트
            this.state.previewNotes.forEach(note => {
                const timeToHit = note.time - elapsedTime;
                
                // 롱노트 여부 확인 및 높이 계산
                const isLongNote = note.type === 'long_head';
                const noteHeight = isLongNote && note.duration ? (note.duration / 10) * noteSpeed : 25;
                
                const noteBottomPosition = gameHeight - 100 - (timeToHit * noteSpeed / 10);
                const noteTopPosition = noteBottomPosition - noteHeight;
                
                // 노트 생성
                if (!note.element && !note.processed && (note.type === 'tap' || isLongNote || note.type === 'false')) {
                    if (noteTopPosition < gameHeight && noteBottomPosition > -50) {
                        this.createPreviewNoteElement(note, gameHeight, noteHeight);
                    }
                }
                
                // 노트 위치 업데이트
                if (note.element && note.element.isConnected) {
                    note.element.style.transform = `translateY(${noteTopPosition}px)`;
                    
                    // 화면 밖으로 나가면 제거
                    if (noteTopPosition > gameHeight + 100) {
                        note.element.remove();
                        note.element = null;
                        note.processed = true;
                    }
                } else if (note.processed && note.element) {
                    note.element.remove();
                    note.element = null;
                }
            });
            
            this.state.previewAnimationId = requestAnimationFrame(this.previewLoop.bind(this));
        } catch (err) {
            Debugger.logError(err, 'Editor.previewLoop');
        }
    },
    
    createPreviewNoteElement(note, gameHeight, noteHeight) {
        try {
            const lane = DOM.lanesContainer.querySelector(`[data-lane-index="${note.lane}"]`);
            if (!lane) return;
            
            const noteEl = document.createElement('div');
            noteEl.className = 'note';
            
            // 레인 ID 저장
            const laneId = lane.dataset.laneId;
            if (laneId) {
                noteEl.dataset.lane = laneId;
            }
            
            const isLongNote = note.type === 'long_head';
            
            if (isLongNote) {
                noteEl.classList.add('long');
                // 롱노트의 경우 높이 설정
                if (noteHeight) {
                    noteEl.style.height = `${noteHeight}px`;
                }
            }
            if (note.type === 'false') {
                noteEl.classList.add('false');
            }
            
            // 레인별 색상 모드일 때 인라인 스타일 적용
            if (Appearance.settings.colorMode === 'lane' && laneId) {
                const color = Appearance.settings.laneColors[laneId];
                if (color) {
                    if (isLongNote) {
                        const gradientStart = Appearance.adjustColor(color, -20);
                        noteEl.style.background = `linear-gradient(to top, ${gradientStart}, ${color})`;
                    } else {
                        noteEl.style.backgroundColor = color;
                        if (note.type === 'false') {
                            noteEl.style.boxShadow = `0 0 8px ${color}`;
                        }
                    }
                }
            }
            
            lane.appendChild(noteEl);
            note.element = noteEl;
        } catch (err) {
            Debugger.logError(err, 'Editor.createPreviewNoteElement');
        }
    },
    
    clearPreview() {
        try {
            // 모든 노트 요소 제거
            if (this.state.previewNotes) {
                this.state.previewNotes.forEach(note => {
                    if (note.element) {
                        note.element.remove();
                        note.element = null;
                    }
                });
            }
            
            // 레인 초기화
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
    
    highlightEditorLanes(laneCount) {
        try {
            // 먼저 모든 하이라이트 제거
            this.clearEditorLaneHighlight();
            
            // 선택된 레인에 해당하는 레인 ID 가져오기
            const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
            if (!requiredLaneIds) return;
            
            // 해당 레인들 하이라이트
            requiredLaneIds.forEach(laneId => {
                const laneEl = DOM.editor.gridContainer.querySelector(`[data-lane-id="${laneId}"]`);
                if (laneEl) {
                    laneEl.classList.add('highlighted');
                }
            });
        } catch (err) {
            Debugger.logError(err, 'Editor.highlightEditorLanes');
        }
    },
    
    clearEditorLaneHighlight() {
        try {
            const lanes = DOM.editor.gridContainer.querySelectorAll('.editor-lane');
            lanes.forEach(lane => lane.classList.remove('highlighted'));
        } catch (err) {
            Debugger.logError(err, 'Editor.clearEditorLaneHighlight');
        }
    },
    
    addLaneLabels() {
        try {
            // 기존 라벨 제거
            DOM.editor.gridContainer.querySelectorAll('.editor-lane-label').forEach(label => label.remove());
            
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerMeasure = 4;
            const measureHeight = beatsPerMeasure * adjustedBeatHeight;
            
            // 8마디마다 라벨 추가
            const lanes = DOM.editor.gridContainer.querySelectorAll('.editor-lane');
            lanes.forEach((laneEl, index) => {
                const laneId = CONFIG.EDITOR_LANE_IDS[index];
                
                for (let measure = 0; measure < this.state.totalMeasures; measure += 8) {
                    const label = document.createElement('div');
                    label.className = 'editor-lane-label';
                    label.textContent = `${laneId} - ${measure}`;
                    label.style.top = `${measure * measureHeight}px`;
                    laneEl.appendChild(label);
                }
            });
        } catch (err) {
            Debugger.logError(err, 'Editor.addLaneLabels');
        }
    },

    handleEditorKeyPress(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.handleUndo();
            return;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return;

        switch (e.key) {
            case '1': e.preventDefault(); this.setSelectedNoteType('tap'); return;
            case '2': e.preventDefault(); this.setSelectedNoteType('long'); return;
            case '3': e.preventDefault(); this.setSelectedNoteType('false'); return;
        }

        const laneId = CONFIG.EDITOR_KEY_LANE_MAP[e.code];
        if (laneId) {
            e.preventDefault();
            this.placeNoteAtPlayhead(laneId);
        }
    }
};
