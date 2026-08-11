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
        // 온라인 차트를 "편집"으로 불러온 경우, 그 차트의 메타 정보가 들어간다.
        // null이면 일반적인(신규) 차트 작업 상태. 업로드 버튼이 이 값에 따라
        // "신규 업로드" / "기존 차트 업데이트"를 자동으로 분기한다.
        cloudChart: null,

        // ── Phase 3: 종합 창 / 비트맵 창 상태 모델 ─────────────────────────
        // 노래 메타(제목/가수/오디오). 종합 창에서 편집. 비트맵 창의 flat 상태(위쪽 notes/bpm/...)와는
        // 별개로, "노래 전체"를 다루는 종합 창이 만들어지기 전까지는 채워지지 않는다.
        song: {
            title: '',
            artist: '',
            audioFileObject: null,  // 로컬 File 객체
            audioFileName: '',
            cloudSongId: null,      // 클라우드에 이미 존재하는 노래면 beat_songs.id
            previewStartSec: 0,     // 온라인 화면 미리듣기 시작 시각(초). 0이면 처음부터.
        },
        // 노래에 딸린 난이도(비트맵) 목록. 각 항목은
        // { difficultyLabel, laneCount, bpm, startTimeOffset, notes, triggers, cloudChartId } 형태.
        // 비트맵 창에 들어가 있는 동안은 activeBeatmapIndex가 가리키는 항목이 지금의 flat 편집 상태
        // (notes/bpm/triggers/startTimeOffset)와 동기화된다 — loadBeatmapIntoFlatState/saveFlatStateToBeatmap 참고.
        beatmaps: [],
        activeBeatmapIndex: 0,
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
            this.state.triggers = [];
            this.state.bpm = 120;
            this.state.snapDivision = 4;
            this.state.startTimeOffset = 0;
            this.state.audioFileName = '';
            this.state.selectedNoteType = 'tap';
            this.state.totalMeasures = 100;
            this.state.cloudChart = null;

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
            this._updateCloudUI();
        } catch (err) {
            Debugger.logError(err, 'Editor.resetEditorState');
        }
    },

    // ── 온라인 차트 "편집" 연동 ──────────────────────────────────────────────
    // 이미 서버에 업로드된 차트를 불러와 편집할 때, 그 차트의 메타를 기억해둔다.
    // meta: { id, title, artist, bpm, lane_count, difficulty_label } | null
    setCloudChart(meta) {
        this.state.cloudChart = meta;
        this._updateCloudUI();
    },

    _updateCloudUI() {
        const statusEl = DOM.editor.cloudStatusEl;
        const uploadBtn = DOM.editor.uploadBtn;
        const cloudChart = this.state.cloudChart;
        if (statusEl) {
            if (cloudChart) {
                statusEl.textContent = `✏️ "${cloudChart.title}" 편집 중 — 업로드 시 기존 차트가 업데이트됩니다.`;
                statusEl.classList.remove('hidden');
            } else {
                statusEl.textContent = '';
                statusEl.classList.add('hidden');
            }
        }
        if (uploadBtn) {
            uploadBtn.textContent = cloudChart ? '☁ 차트 업데이트' : '☁ 서버에 업로드';
        }
    },

    // 이미 디코딩된 오디오 Blob을 에디터에 적용한다 (온라인 차트 편집 시 사용).
    // <input type=file> 변경 이벤트 없이도 음악 플레이어/상태를 설정할 수 있도록
    // handleAudioLoad의 핵심 로직만 분리한 헬퍼.
    loadAudioFromBlob(blob, fileName) {
        try {
            if (DOM.musicPlayer.src && DOM.musicPlayer.src.startsWith('blob:')) {
                URL.revokeObjectURL(DOM.musicPlayer.src);
            }
            DOM.musicPlayer.pause();
            this.state.isPlaying = false;
            cancelAnimationFrame(this.state.animationFrameId);

            DOM.musicPlayer.src = URL.createObjectURL(blob);
            DOM.musicPlayer.load();

            this.state.audioFileName = fileName;
            DOM.editor.audioFileNameEl.textContent = fileName;
            DOM.musicPlayer.onloadedmetadata = () => this.drawGrid();
        } catch (err) {
            Debugger.logError(err, 'Editor.loadAudioFromBlob');
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
            if (!file) {
                e.target.value = null;
                return;
            }

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

            const fileName = file.name;
            const mimeType = this._resolveAudioMimeType(file);

            // input.value를 리셋하거나(아래) 파일 선택기 컨텍스트가 닫히면
            // 일부 모바일 브라우저(특히 Android의 콘텐츠 프로바이더 기반 파일)에서
            // 원본 File 핸들이 비동기 로드 시점에 무효화되어 blob URL이
            // "net::ERR_FILE_NOT_FOUND"로 실패하는 경우가 있다.
            // 이를 피하기 위해 파일을 메모리(ArrayBuffer)로 완전히 읽어들인 뒤,
            // 그 데이터로만 Blob을 만들어 input/파일 핸들 수명과 완전히 분리한다.
            const reader = new FileReader();
            reader.onerror = () => {
                Debugger.logError(reader.error || new Error('FileReader error'), 'Editor.handleAudioLoad:read');
                UI.showMessage('editor', '파일을 읽는 중 오류가 발생했습니다.');
            };
            reader.onload = () => {
                try {
                    const arrayBuffer = reader.result;
                    const typedBlob = new Blob([arrayBuffer], { type: mimeType });

                    DOM.musicPlayer.src = URL.createObjectURL(typedBlob);
                    // 새 소스를 명시적으로 로드해 이전 상태(readyState)를 깨끗하게 리셋한다.
                    DOM.musicPlayer.load();

                    this.state.audioFileName = fileName;
                    DOM.editor.audioFileNameEl.textContent = fileName;
                    DOM.musicPlayer.onloadedmetadata = () => this.drawGrid();
                } catch (err) {
                    Debugger.logError(err, 'Editor.handleAudioLoad:onload');
                }
            };
            reader.readAsArrayBuffer(file);

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
        DOM.triggerModal.fallSpeedInput.value = parseFloat(DOM.editor.noteFallSpeedInput?.value) || 7;
        DOM.triggerModal.transitionInput.value = 0.7;
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
        const fallSpeed = parseFloat(DOM.triggerModal.fallSpeedInput.value);
        const transitionSec = parseFloat(DOM.triggerModal.transitionInput.value);
        const transitionMs = Math.max(0, (isNaN(transitionSec) ? 0.7 : transitionSec) * 1000);

        // 기존 동일 시간 트리거 제거
        this.state.triggers = this.state.triggers.filter(t => Math.abs(t.time - time) >= 10);
        
        // 새 트리거 추가
        this.state.triggers.push({
            time,
            bpm,
            fallSpeed,
            transitionMs
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
                triggerEl.title = `BPM: ${trigger.bpm}, 하강: ${trigger.fallSpeed}, 전환: ${((trigger.transitionMs ?? 700) / 1000).toFixed(1)}s`;
                
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

    getChartData() {
        const gameNotes = this.state.notes.map(note => {
            if (note.type === 'long_head') return { time: note.time, lane: note.lane, duration: note.duration };
            if (note.type === 'tap') return { time: note.time, lane: note.lane };
            return { time: note.time, lane: note.lane, type: note.type };
        }).filter(note => note.type !== 'long_tail');
        return {
            songName: this.state.audioFileName || '',
            bpm: this.state.bpm,
            startTimeOffset: this.state.startTimeOffset,
            laneCount: parseInt(DOM.editor.previewLanesSelector?.value) || 4,
            notes: gameNotes.sort((a, b) => a.time - b.time),
            triggers: this.state.triggers || [],
        };
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
            const laneCount = parseInt(DOM.editor.previewLanesSelector?.value) || 4;
            const chart = ChartFormat.wrap({
                songName: this.state.audioFileName,
                artist: null, // 종합 창(Phase 3)이 생기기 전까지는 가수 입력 UI가 없음
                difficultyLabel: null,
                laneCount,
                bpm: this.state.bpm,
                startTimeOffset: this.state.startTimeOffset,
                notes: gameNotes.sort((a, b) => a.time - b.time),
                triggers: this.state.triggers || []
            });
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

    loadChart(rawChartData, loadedFileName) {
        try {
            const normalized = ChartFormat.normalize(rawChartData);
            if (normalized.beatmapCount > 1) {
                UI.showMessage('editor', `이 파일에는 난이도가 ${normalized.beatmapCount}개 있습니다. 지금 에디터는 첫 번째 난이도만 불러옵니다 (다중 난이도 관리는 다음 업데이트 예정).`);
            }
            const chartData = { songName: normalized.songName, ...normalized.beatmap };

            this.resetEditorState();
            this.state.history = [];
            this.state.bpm = chartData.bpm || 120;
            this.state.triggers = (chartData.triggers || []).slice().sort((a, b) => a.time - b.time);
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
            // 불러온 차트에 레인 수 정보가 있으면 미리보기 선택값을 맞춰준다.
            if (chartData.laneCount && DOM.editor.previewLanesSelector) {
                DOM.editor.previewLanesSelector.value = chartData.laneCount;
                this.highlightEditorLanes(chartData.laneCount);
            }
            this.drawTimeline();
            this.renderNotes();
            this.setDirty(false);
        } catch (err) {
            Debugger.logError(err, 'Editor.loadChart');
            UI.showMessage('editor', `차트 해석 오류: ${err.message}`);
        }
    },

    // ── Phase 3: 종합 창 ↔ 비트맵 창 동기화 ──────────────────────────────
    // (화면 자체는 아직 없음 — 3a/3c/3e에서 이 함수들을 호출하도록 연결 예정)

    // 빈 난이도(비트맵) 객체를 하나 만든다. "새 노래 만들기"/"난이도 추가"에서 쓸 기본값.
    createDefaultBeatmap(difficultyLabel) {
        return {
            difficultyLabel: difficultyLabel || '기본',
            laneCount: 4,
            bpm: 120,
            startTimeOffset: 0,
            notes: [],
            triggers: [],
            cloudChartId: null,
        };
    },

    // state.song을 빈 상태로 되돌린다. resetEditorState()는 flat 편집 상태만 초기화하므로
    // 종합 창 쪽 노래 메타는 별도로 이 함수로 초기화한다.
    resetSongState() {
        this.state.song = {
            title: '',
            artist: '',
            audioFileObject: null,
            audioFileName: '',
            cloudSongId: null,
            previewStartSec: 0,
        };
        this.state.beatmaps = [];
        this.state.activeBeatmapIndex = 0;
    },

    // Phase 3d: 클라우드에서 불러온 노래는 getSongWithBeatmaps()로 난이도 "메타"만 받아오고
    // (notes/triggers는 안 옴), 실제로 편집/복제/전체저장이 필요해지는 시점에만 이 함수로
    // chart_storage_path를 다운로드해서 채운다. bm._loaded === false 인 항목에서만 동작한다.
    async ensureBeatmapLoaded(bm) {
        if (!bm || bm._loaded === undefined || bm._loaded !== false) return true; // 이미 로컬에 있는(신규/로컬불러오기) 난이도
        if (!bm.chartStoragePath) {
            Debugger.logError(new Error('chartStoragePath 없음'), 'Editor.ensureBeatmapLoaded');
            return false;
        }
        const { data, error } = await CloudCharts.downloadChartData(bm.chartStoragePath);
        if (error) {
            UI.showMessage('editorSong', `난이도 데이터 다운로드 실패: ${error.message}`);
            return false;
        }
        bm.notes = data.notes || [];
        bm.triggers = data.triggers || [];
        bm.startTimeOffset = data.startTimeOffset || 0;
        if (data.bpm) bm.bpm = data.bpm;
        if (data.laneCount) bm.laneCount = data.laneCount;
        bm._loaded = true;
        return true;
    },

    // beatmaps[index]에 저장된 난이도 데이터를 지금의 flat 편집 상태(notes/bpm/triggers/startTimeOffset)로
    // 복사한다. 비트맵 창 진입 시 호출. loadChart()와 동일한 방식으로 노트에 measure/type을 재계산해 채운다.
    loadBeatmapIntoFlatState(index) {
        try {
            const bm = this.state.beatmaps[index];
            if (!bm) {
                Debugger.logError(new Error(`beatmaps[${index}] 없음`), 'Editor.loadBeatmapIntoFlatState');
                return;
            }
            this.resetEditorState(); // notes/오디오까지 전부 비움 — 아래에서 노래 단위 오디오를 다시 로드한다.
            this.state.activeBeatmapIndex = index;
            this.state.history = [];
            this.state.bpm = bm.bpm || 120;
            this.state.startTimeOffset = bm.startTimeOffset || 0;
            this.state.triggers = (bm.triggers || []).slice().sort((a, b) => a.time - b.time);
            this.state.notes = (bm.notes || []).map(note => {
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

            // 오디오는 비트맵이 아니라 노래(song) 단위로 관리된다. 종합 창에서 이미 골라뒀다면
            // 여기서 다시 로드해준다 (resetEditorState()가 위에서 플레이어를 비웠기 때문).
            if (this.state.song.audioFileObject) {
                this.loadAudioFromBlob(this.state.song.audioFileObject, this.state.song.audioFileName);
            } else {
                DOM.editor.audioFileNameEl.textContent = '선택된 파일 없음';
            }

            DOM.editor.bpmInput.value = this.state.bpm;
            DOM.editor.startTimeInput.value = this.state.startTimeOffset;
            DOM.editor.chartFilenameInput.value = bm.difficultyLabel || '';
            if (bm.laneCount && DOM.editor.previewLanesSelector) {
                DOM.editor.previewLanesSelector.value = bm.laneCount;
                this.highlightEditorLanes(bm.laneCount);
            }
            this.drawTimeline();
            this.renderNotes();
            this.setDirty(false);
        } catch (err) {
            Debugger.logError(err, 'Editor.loadBeatmapIntoFlatState');
        }
    },

    // 지금의 flat 편집 상태를 beatmaps[index](기본값: activeBeatmapIndex)에 반영한다.
    // 비트맵 창 이탈("← 종합 창") 또는 "현재 난이도만 빠르게 저장" 시 호출.
    // getChartData()와 같은 방식으로 노트를 게임용 형태로 축약해 저장한다.
    saveFlatStateToBeatmap(index) {
        try {
            const i = (index === undefined || index === null) ? this.state.activeBeatmapIndex : index;
            const bm = this.state.beatmaps[i];
            if (!bm) {
                Debugger.logError(new Error(`beatmaps[${i}] 없음`), 'Editor.saveFlatStateToBeatmap');
                return;
            }
            const gameNotes = this.state.notes.map(note => {
                if (note.type === 'long_head') return { time: note.time, lane: note.lane, duration: note.duration };
                if (note.type === 'tap') return { time: note.time, lane: note.lane };
                return { time: note.time, lane: note.lane, type: note.type };
            }).filter(note => note.type !== 'long_tail');

            bm.laneCount = parseInt(DOM.editor.previewLanesSelector?.value) || 4;
            bm.bpm = this.state.bpm;
            bm.startTimeOffset = this.state.startTimeOffset;
            bm.notes = gameNotes.sort((a, b) => a.time - b.time);
            bm.triggers = this.state.triggers || [];
            if (bm.cloudChartId) bm._cloudDirty = true; // 이미 올라간 난이도면 다음 업로드 시 갱신이 필요함
        } catch (err) {
            Debugger.logError(err, 'Editor.saveFlatStateToBeatmap');
        }
    },

    // Phase 3e: 비트맵 창의 "⚡ 빠른 저장" 버튼. saveFlatStateToBeatmap()과 달리 종합 창으로
    // 돌아가지 않고 그 자리에서 beatmaps[activeBeatmapIndex]만 갱신한다.
    quickSaveBeatmap() {
        try {
            this.saveFlatStateToBeatmap();
            this.setDirty(false);
            UI.showMessage('editor', '현재 난이도를 저장했습니다. (종합 창에서 "로컬에 저장"/"클라우드에 업로드"로 전체 반영)');
        } catch (err) {
            Debugger.logError(err, 'Editor.quickSaveBeatmap');
            UI.showMessage('editor', `저장 실패: ${err.message}`);
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
            let elapsedTime;
            const isMusicLoaded = !!DOM.musicPlayer.src;
            
            if (isMusicLoaded && !DOM.musicPlayer.paused) {
                elapsedTime = (DOM.musicPlayer.currentTime - this.state.startTimeOffset) * 1000;
            } else {
                const elapsedMs = performance.now() - this.state.playbackStartTime;
                elapsedTime = elapsedMs;
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