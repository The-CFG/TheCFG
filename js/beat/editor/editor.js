const Editor = {
    state: {
        notes: [],
        triggers: [], // BPM/속도 변경 트리거
        bpm: CONFIG.EDITOR_DEFAULT_SETTINGS.bpm,
        snapDivision: CONFIG.EDITOR_DEFAULT_SETTINGS.snapDivision,
        history: [],
        isDirty: false,
        audioFileName: '',
        isPlaying: false,
        animationFrameId: null,
        selectedNoteType: 'tap',
        // 타임라인 클릭이 어떤 동작을 할지 결정하는 도구. 'create'(생성) 아래에서
        // selectedNoteType이 "무엇을 찍을지"를 고른다. 'edit'는 아직 옮길 기능이
        // 없어 자리만 마련해둔 상태 — placeholder.
        activeTool: 'create',
        // Edit 도구에서 드래그/클릭으로 선택된 노트들 — [{ time, lane }, ...]
        selectedNotes: [],
        // Ctrl+C로 복사된 노트의 전체 데이터. Ctrl+V(pasteNotes)가 재생헤드 위치를 기준으로 붙여넣는다.
        clipboardNotes: [],
        isPlacingLongNote: false,
        longNoteStart: null,
        // 미리보기 관련 상태
        previewNotes: [],
        previewAnimationId: null,
        previewStartTime: 0,
        previewLaneCount: 4,
        // 오디오 파일이 없을 때(가짜 시계로 재생) previewSeekSec 위치에서 재생을
        // 시작하기 위한 기준값(ms, startOffsetSec 기준 상대시간). 재생을 새로
        // 시작할 때만 갱신되고, 일시정지 후 재개할 때는 그대로 유지된다.
        playbackBaseMs: 0,
        // 비트맵 창 자체의 "미리보기 시작(초)" — 재생헤드 드래그/화살표 이동/이 필드 직접
        // 입력, 이 셋만 이 값을 바꾼다. song.startOffsetSec(=종합 창의 "시작(초)")과는
        // 완전히 별개의 값으로, 서로 절대 덮어쓰지 않는다. 비트맵 창을 새로 열 때
        // 초기값만 song.startOffsetSec을 참고해서 채워준다(편의상 시작점 근처에서
        // 미리듣기를 시작하도록) — 그 이후로는 독립적으로 움직인다.
        previewSeekSec: 0,
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
            coverFileObject: null,  // 로컬 File 객체 (선택)
            coverFileName: '',
            cloudSongId: null,      // 클라우드에 이미 존재하는 노래면 beat_songs.id
            previewStartSec: 0,     // 온라인 화면 미리듣기 시작 시각(초). 0이면 처음부터.
            startOffsetSec: 0,      // 실제 플레이 시 노래가 재생되기 시작하는 지점(초). 0이면 처음부터.
            timingStartSec: 0,      // 그리드(격자선)가 존재하기 시작하는 노래 절대 시각(초). startOffsetSec과 독립적. 0이면 기존과 동일(제약 없음).
        },
        // 노래에 딸린 난이도(비트맵) 목록. 각 항목은
        // { difficultyLabel, laneCount, bpm, startTimeOffset, notes, triggers, cloudChartId } 형태.
        // 비트맵 창에 들어가 있는 동안은 activeBeatmapIndex가 가리키는 항목이 지금의 flat 편집 상태
        // (notes/bpm/triggers/startTimeOffset)와 동기화된다 — loadBeatmapIntoFlatState/saveFlatStateToBeatmap 참고.
        beatmaps: [],
        activeBeatmapIndex: 0,
        // 지금 state.notes/state.triggers(flat 상태)가 실제로 beatmaps[] 중 어느 항목의
        // 내용을 대표하고 있는지. loadBeatmapIntoFlatState()에서 그 인덱스로 채워지고,
        // resetSongState()에서 null로 비워진다. setStartOffsetSec()이 오프셋 변경분을
        // 다른 난이도들에도 전파할 때, 이 인덱스와 같은 항목은 flat 상태 쪽에서 이미
        // 보정하므로 건너뛰기 위해 쓴다.
        _flatBeatmapIndex: null,
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
            this.state.bpm = CONFIG.EDITOR_DEFAULT_SETTINGS.bpm;
            this.state.noteSpeed = CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
            this.state.snapDivision = CONFIG.EDITOR_DEFAULT_SETTINGS.snapDivision;
            this.state.audioFileName = '';
            this.state.selectedNoteType = 'tap';
            this.state.activeTool = 'create';
            this.state.selectedNotes = [];
            this.state.clipboardNotes = [];
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
            if (DOM.editor.noteFallSpeedInput) DOM.editor.noteFallSpeedInput.value = this.state.noteSpeed;
            this.state.previewSeekSec = this.state.song.startOffsetSec || 0;
            DOM.editor.startTimeInput.value = this.state.previewSeekSec;
            if (DOM.editor.timingStartInput) DOM.editor.timingStartInput.value = this.state.song.timingStartSec || 0;
            DOM.editor.audioFileNameEl.textContent = '선택된 파일 없음';
            DOM.editor.chartFilenameInput.value = '';

            this.updateNoteTypeUI();
            this.updateToolUI();
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
        // 줌은 더 이상 snapDivision(스냅 선택)에 연동되지 않고 항상 1/32 기준으로 고정된다.
        const scaleFactor = Math.max(1, CONFIG.EDITOR_ZOOM_DIVISION / 4);
        return CONFIG.EDITOR_BEAT_HEIGHT * scaleFactor;
    },

    // ===== 재생 위치 탐색(seek): 재생헤드 드래그 / 시크 거터 클릭·드래그 =====

    _setPlayheadTop(px) {
        DOM.editor.playhead.style.top = `${px}px`;
    },

    // y=0을 "타이밍 시작(초)"에 고정한다 — 박자(BPM) 계산은 항상 이 지점을 0박째로 삼아
    // 세어나간다. (기존에는 y=0이 노래 절대 0초였고 timingStartSec은 그 이전 구간을
    // 가려주는 하한선 역할만 해서, 그리드의 "위상"이 timingStartSec만큼 어긋나 있었다.)
    _yToSeconds(y) {
        const adjustedBeatHeight = this._getAdjustedBeatHeight();
        const beatsPerSecond = this.state.bpm / 60;
        const timingStartSec = this.state.song.timingStartSec || 0;
        const totalBeats = Math.max(0, y) / adjustedBeatHeight;
        return timingStartSec + (totalBeats / beatsPerSecond);
    },

    // Y좌표(px)를 노트 배치와 같은 그리드(snapDivision) 기준으로 스냅한 뒤 절대 초로 변환한다.
    // 재생헤드를 클릭/드래그로 옮길 때 가장 가까운 구분선에 딱 맞춰지도록 seekToClientY에서 쓴다.
    _snapYToSeconds(y) {
        const adjustedBeatHeight = this._getAdjustedBeatHeight();
        const beatsPerMeasure = 4;
        const measureHeight = beatsPerMeasure * adjustedBeatHeight;
        const snapHeight = measureHeight / this.state.snapDivision;
        const snapIndex = Math.round(Math.max(0, y) / snapHeight);
        const snappedY = snapIndex * snapHeight;
        return this._yToSeconds(snappedY);
    },

    // 주의: 여기서는 (seconds - timingStartSec)를 0으로 clamp하지 않는다. 재생헤드/미리보기
    // 시작(초)처럼 타이밍 시작(초)보다 앞선 시각도 있을 수 있는데, 여기서 0으로 눌러버리면
    // 그 앞 구간 전체가 타이밍 시작 위치(y=0)에 눌러붙어 보인다 — 재생헤드가 실제 재생 위치
    // 대신 타이밍 시작(초)에 멈춰있는 것처럼 보이는 버그의 원인이었다. 좌표가 음수(그리드
    // 맨 위보다 위)가 되는 건 정상이며, 실제로 그 구간엔 그리드/노트가 없을 뿐이다.
    _secondsToY(seconds) {
        const adjustedBeatHeight = this._getAdjustedBeatHeight();
        const beatsPerSecond = this.state.bpm / 60;
        const timingStartSec = this.state.song.timingStartSec || 0;
        return (seconds - timingStartSec) * beatsPerSecond * adjustedBeatHeight;
    },

    // container 기준 스크롤 보정된 Y 좌표(px) → 그리드에 스냅되고 오프셋(빨간선) 기준으로
    // 변환된 상대 시간(ms). handleTimelineClick과 노트 드래그 이동에서 공통으로 쓴다.
    // 오프셋보다 앞선 위치는 0으로 clamp한다(호출부에서 필요하면 별도로 막을 것).
    _yToSnappedRelativeTimeMs(y) {
        const adjustedBeatHeight = this._getAdjustedBeatHeight();
        const beatsPerMeasure = 4;
        const measureHeight = beatsPerMeasure * adjustedBeatHeight;
        const snapHeight = measureHeight / this.state.snapDivision;
        const snapIndex = Math.round(y / snapHeight);
        const snappedY = snapIndex * snapHeight;
        const absoluteTimeInMs = Math.round(this._yToSeconds(snappedY) * 1000);
        const offsetMs = Math.round((this.state.song.startOffsetSec || 0) * 1000);
        return absoluteTimeInMs - offsetMs; // 0 미만일 수 있음 — clamp/경고는 호출부에서 처리
    },

    // 화면 좌표(clientX) → 타임라인 레인 ID. 범위를 벗어나면 가장 가까운 레인으로 clamp한다.
    _xToLaneId(clientX) {
        const gridRect = DOM.editor.gridContainer.getBoundingClientRect();
        const laneWidth = gridRect.width / CONFIG.EDITOR_LANE_IDS.length;
        const x = clientX - gridRect.left;
        const laneIndex = Math.min(
            CONFIG.EDITOR_LANE_IDS.length - 1,
            Math.max(0, Math.floor(x / laneWidth))
        );
        return CONFIG.EDITOR_LANE_IDS[laneIndex];
    },

    // 정지 상태에서만 호출됨. isPlaying이면 드래그 시작 시점에 먼저 멈춘다.
    _pauseForSeek() {
        if (!this.state.isPlaying) return;
        this.state.isPlaying = false;
        cancelAnimationFrame(this.state.animationFrameId);
        if (this.state.previewAnimationId) {
            cancelAnimationFrame(this.state.previewAnimationId);
            this.state.previewAnimationId = null;
        }
        if (DOM.musicPlayer.src) DOM.musicPlayer.pause();
        DOM.editor.playBtn.textContent = "재생";
    },

    // "미리보기 시작(초)"(=state.song.startOffsetSec)을 바꾼다. 이제 이 값은 종합 창의
    // "시작(초)" 입력창(EditorSong.onStartTimeInput)에서만 바꿔야 한다 — 비트맵 창의
    // 재생헤드 드래그/화살표 이동은 더 이상 이 함수를 호출하지 않는다(순수 seek로 분리됨,
    // seekPreviewTo() 참고).
    // note.time/trigger.time은 이 오프셋 기준 "상대시간"으로 저장되기 때문에, 오프셋만
    // 바꾸고 이 값들을 그대로 두면 이미 찍어놓은 모든 노트의 절대(실제) 위치가 오프셋이
    // 바뀐 만큼 그대로 밀려버린다 — 그러면 재생/미리보기 시작 시점(경과시간 0)이 항상
    // 방금 옮긴 위치와 거의 일치하게 되어, 노트 낙하 계산은 매번 "차트 맨 처음" 노트들만
    // 보여주는 것처럼 보이는 버그가 생긴다. 그래서 오프셋이 바뀐 만큼 note.time/trigger.time을
    // 반대 방향으로 같이 보정해서, 노트들의 실제 위치(그리고 재생 시 낙하 타이밍)는 그대로
    // 유지한 채 "게임이 시작되는 지점"만 옮겨지도록 한다.
    setStartOffsetSec(newOffsetSec, { seekAudio = true } = {}) {
        const oldOffsetSec = this.state.song.startOffsetSec || 0;
        const deltaMs = Math.round((newOffsetSec - oldOffsetSec) * 1000);
        if (deltaMs !== 0) {
            this.state.notes.forEach(note => { note.time -= deltaMs; });
            this.state.triggers.forEach(trigger => { trigger.time -= deltaMs; });
            // startOffsetSec은 노래 전체가 공유하는 단일 값이므로, 지금 flat 상태로 열려있지
            // 않은 다른 난이도들의 notes/triggers도 같은 만큼 같이 보정해야 한다. 안 그러면
            // 나중에 그 난이도를 열었을 때(또는 그대로 저장/업로드했을 때) 노트가 델타만큼
            // 밀린 채로 나타난다 — 종합 창에서 시작 시각만 바꾸고 바로 저장하는 경우가 대표적.
            this._applyOffsetDeltaToOtherBeatmaps(deltaMs);
        }
        this.state.song.startOffsetSec = newOffsetSec;
        if (DOM.editorSong.startTimeInput) DOM.editorSong.startTimeInput.value = newOffsetSec.toFixed(2);
        if (seekAudio && DOM.musicPlayer.src) {
            DOM.musicPlayer.currentTime = newOffsetSec;
        }
        if (deltaMs !== 0) {
            this.setDirty(true);
            this.renderNotes(); // 노트/트리거를 보정된 시간으로 다시 그림 (절대 위치는 그대로 보임)
        }
        // 타이밍 시작 하한선(_minAllowedRelativeTimeMs)이 startOffsetSec에도 의존하므로
        // 그리드도 다시 그려서 "노트 못 찍는 구간" 표시를 최신 상태로 맞춘다.
        this.drawGrid();
    },

    // "타이밍 시작(초)"(=state.song.timingStartSec)을 바꾼다. BPM 그리드는 이 값을
    // 0박째 기준으로 삼아 계산되므로(_yToSeconds/_secondsToY 참고) 그리드 위상이 바뀌지만,
    // note.time/trigger.time은 startOffsetSec 기준의 별개 좌표계(상대시간)로 저장되어
    // 있어서 startOffsetSec과 달리 그 값들 자체를 보정할 필요는 없다 — 그리드와
    // "노트 못 찍는 구간" 표시만 다시 그리면 된다.
    setTimingStartSec(newTimingStartSec) {
        const sec = Math.max(0, newTimingStartSec || 0);
        this.state.song.timingStartSec = sec;
        if (DOM.editorSong.timingStartInput) DOM.editorSong.timingStartInput.value = sec.toFixed(2);
        if (DOM.editor.timingStartInput) DOM.editor.timingStartInput.value = sec.toFixed(2);
        this.setDirty(true);
        this.drawGrid();
        this.renderNotes();
    },

    // startOffsetSec 기준 "상대시간"(ms)으로, 실제 노트를 찍을 수 있는 하한선.
    // 두 제약(시작 지점 이전 금지 / 타이밍 시작 이전 그리드 없음) 중 더 엄격한 쪽 = 큰 값.
    // = max(0, (timingStartSec - startOffsetSec)를 ms로 환산한 값).
    _minAllowedRelativeTimeMs() {
        const startOffsetSec = this.state.song.startOffsetSec || 0;
        const timingStartSec = this.state.song.timingStartSec || 0;
        const timingStartRelativeMs = Math.round((timingStartSec - startOffsetSec) * 1000);
        return Math.max(0, timingStartRelativeMs);
    },

    // startOffsetSec 변경분(deltaMs)을 지금 flat 상태가 대표하지 않는 다른 난이도들에 전파한다.
    // - 이미 로컬에 데이터가 있는 난이도(_loaded !== false): notes/triggers를 바로 보정하고,
    //   클라우드에 이미 올라간 난이도라면 다음 업로드 때 갱신되도록 dirty 표시한다.
    // - 아직 서버에서 안 받아온 난이도(_loaded === false): 지금은 보정할 데이터가 없으므로
    //   _pendingOffsetDeltaMs에 누적해두고, ensureBeatmapLoaded()가 실제로 데이터를
    //   받아온 직후 한 번에 적용한다.
    _applyOffsetDeltaToOtherBeatmaps(deltaMs) {
        if (!deltaMs) return;
        const liveIndex = this.state._flatBeatmapIndex;
        this.state.beatmaps.forEach((bm, i) => {
            if (i === liveIndex) return; // flat 상태 쪽에서 이미 보정됨
            if (bm._loaded === false) {
                bm._pendingOffsetDeltaMs = (bm._pendingOffsetDeltaMs || 0) + deltaMs;
                return;
            }
            (bm.notes || []).forEach(note => { note.time -= deltaMs; });
            (bm.triggers || []).forEach(trigger => { trigger.time -= deltaMs; });
            if (bm.cloudChartId) bm._cloudDirty = true;
        });
    },

    // 재생헤드를 seconds 위치로 옮기고, 비트맵 창 자체의 "미리보기 시작(초)"
    // (state.previewSeekSec)과 오디오 미리듣기 위치를 갱신하는 순수 seek.
    // song.startOffsetSec(=종합 창의 "시작(초)")은 절대 건드리지 않는다 — 그 값은
    // 종합 창의 입력창(EditorSong.onStartTimeInput)에서만 바꿀 수 있다. 노트 위치
    // 보정도 하지 않으므로 setDirty()도 호출하지 않는다.
    seekPreviewTo(seconds) {
        this.state.previewSeekSec = seconds;
        DOM.editor.startTimeInput.value = seconds.toFixed(2);
        this._setPlayheadTop(this._secondsToY(seconds));
        if (DOM.musicPlayer.src) {
            DOM.musicPlayer.currentTime = seconds;
        }
    },

    // clientY(화면 좌표)를 재생 위치(초)로 변환해 playhead/오디오 미리듣기 위치만 갱신한다.
    // (Phase: 재생헤드 드래그를 순수 seek로 분리 — song.startOffsetSec은 더 이상 바뀌지 않음)
    seekToClientY(clientY) {
        try {
            const container = DOM.editor.container;
            const rect = container.getBoundingClientRect();
            const rawY = clientY - rect.top + container.scrollTop;
            let seconds = this._snapYToSeconds(rawY);

            const isMusicLoaded = !!DOM.musicPlayer.src;
            if (isMusicLoaded && isFinite(DOM.musicPlayer.duration) && DOM.musicPlayer.duration > 0) {
                seconds = Math.min(seconds, DOM.musicPlayer.duration);
            }
            seconds = Math.max(0, seconds);

            this.seekPreviewTo(seconds);
        } catch (err) {
            Debugger.logError(err, 'Editor.seekToClientY');
        }
    },

    // 재생헤드 핸들 또는 시크 거터에서 mousedown/touchstart 시 호출.
    handleSeekPointerDown(e) {
        try {
            e.preventDefault();
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            this._pauseForSeek();
            DOM.editor.playhead.classList.add('dragging');
            this.seekToClientY(clientY);

            const onMove = (moveEvt) => {
                const y = moveEvt.touches ? moveEvt.touches[0].clientY : moveEvt.clientY;
                this.seekToClientY(y);
            };
            const onUp = () => {
                DOM.editor.playhead.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        } catch (err) {
            Debugger.logError(err, 'Editor.handleSeekPointerDown');
        }
    },

    _updateDirtyIndicator() {
        DOM.editor.dirtyIndicator.textContent = this.state.isDirty ? '*' : '';
    },

    // 위/아래 화살표 키: 재생헤드를 현재 스냅 격자(snapDivision 기준 그리드 선) 상에서
    // 한 칸 전/다음 선으로 옮긴다. direction: -1 = 이전(위) 선, 1 = 다음(아래) 선.
    movePlayheadBySnapStep(direction) {
        try {
            if (this.state.isPlaying) return;
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerMeasure = 4;
            const measureHeight = beatsPerMeasure * adjustedBeatHeight;
            const snapHeight = measureHeight / this.state.snapDivision;

            const currentY = parseFloat(DOM.editor.playhead.style.top) || 0;
            // 현재 위치가 정확히 격자 선 위가 아닐 수도 있으니(오디오 로드 등으로 어긋난 경우)
            // 먼저 가장 가까운 선으로 스냅한 뒤 한 칸 이동한다.
            const currentIndex = Math.round(currentY / snapHeight);
            const newIndex = Math.max(0, currentIndex + direction);
            const newY = newIndex * snapHeight;

            let seconds = this._yToSeconds(newY);
            const isMusicLoaded = !!DOM.musicPlayer.src;
            if (isMusicLoaded && isFinite(DOM.musicPlayer.duration) && DOM.musicPlayer.duration > 0) {
                seconds = Math.min(seconds, DOM.musicPlayer.duration);
            }
            seconds = Math.max(0, seconds);

            this._pauseForSeek();
            this.seekPreviewTo(seconds);
            DOM.editor.container.scrollTop = newY - DOM.editor.container.clientHeight / 2;
        } catch (err) {
            Debugger.logError(err, 'Editor.movePlayheadBySnapStep');
        }
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

    // notes와 triggers를 함께 스냅샷한다. 이전에는 notes만 저장해서 트리거 추가/삭제가
    // Ctrl+Z로 되돌려지지 않는 문제가 있었다.
    _saveStateForUndo() {
        this.state.history.push({
            notes: JSON.parse(JSON.stringify(this.state.notes)),
            triggers: JSON.parse(JSON.stringify(this.state.triggers)),
        });
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
        const timingStartSec = this.state.song.timingStartSec || 0;
        const totalBeats = ((timeInMs / 1000) - timingStartSec) * beatsPerSecond;
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

    // j/total을 기약분수로 줄였을 때의 분모를 구한다 (예: snapDivision=8일 때 j=4 → 1/2 → 분모 2)
    _gcd(a, b) {
        return b === 0 ? a : this._gcd(b, a % b);
    },

    // 분모(1/2, 1/4, 1/8, 1/16, 1/32)에 따른 선 색상. 그 외(3연음 등 32에 안 맞아떨어지는 분할)는 노랑으로 처리.
    _beatLineColorForDenominator(denominator) {
        if (denominator <= 2) return '#6b7280';  // 1/2 — 기존 회색 그대로
        if (denominator <= 4) return '#ef4444';  // 1/4 — 빨강
        if (denominator <= 8) return '#3b82f6';  // 1/8 — 파랑
        if (denominator <= 16) return '#a855f7'; // 1/16 — 보라
        return '#eab308';                        // 1/32 이하 — 노랑
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
            // 재생헤드 드래그용 좌측 거터(#editor-seek-gutter)는 flex 자식이라 명시적으로
            // 높이를 지정해주지 않으면 컨테이너에 보이는 영역까지만 늘어나고, 그 아래로
            // 스크롤되는 나머지 타임라인 구간에는 따라오지 않는다 (마디가 늘어도 첫 화면
            // 높이에서 끊겨 보이는 원인). 타임라인과 항상 같은 높이로 맞춰준다.
            if (DOM.editor.seekGutter) {
                DOM.editor.seekGutter.style.height = `${timelineHeight}px`;
            }

            const measureHeight = beatsPerMeasure * adjustedBeatHeight;
            const snapDivision = this.state.snapDivision; // 현재 선택된 분할 — 이 값까지의 선만 그린다
            const offsetMs = Math.round((this.state.song.startOffsetSec || 0) * 1000);
            const minAllowedMs = this._minAllowedRelativeTimeMs();

            for (let i = 0; i < this.state.totalMeasures; i++) {
                for (let j = 0; j < snapDivision; j++) {
                    const yPosition = (i * measureHeight) + (j / snapDivision) * measureHeight;
                    // 이 선의 상대시간(시작 지점 기준)이 하한(시작 지점 자체 또는 타이밍 시작 중
                    // 더 엄격한 쪽)보다 앞이면 그리지 않는다 — 어차피 여기엔 노트를 못 찍는다.
                    const lineRelativeMs = Math.round(this._yToSeconds(yPosition) * 1000) - offsetMs;
                    if (lineRelativeMs < minAllowedMs) continue;

                    const line = document.createElement('div');
                    line.className = 'beat-line';
                    if (j === 0) {
                        line.classList.add('measure');
                    } else {
                        const denominator = snapDivision / this._gcd(j, snapDivision);
                        line.style.backgroundColor = this._beatLineColorForDenominator(denominator);
                    }
                    line.style.top = `${yPosition}px`;
                    line.style.width = '100%';
                    DOM.editor.notesContainer.insertBefore(line, DOM.editor.playhead);
                }
            }
            
            // 레인 라벨 재생성
            this.addLaneLabels();

            // 타이밍 시작 경계선 마커 — timingStartSec이 0(제약 없음)이면 숨긴다.
            if (DOM.editor.timingStartMarker) {
                const timingStartSec = this.state.song.timingStartSec || 0;
                if (timingStartSec > 0) {
                    DOM.editor.timingStartMarker.style.display = 'block';
                    DOM.editor.timingStartMarker.style.top = `${this._secondsToY(timingStartSec)}px`;
                } else {
                    DOM.editor.timingStartMarker.style.display = 'none';
                }
            }
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
            // 재생헤드 선은 pointer-events:none이라 e.target이 될 수 없음 —
            // 드래그는 시크 거터(#editor-seek-gutter)에서만 가능 (handleSeekPointerDown 참고)

            // 기존 노트를 좌클릭한 경우: 아무 동작도 하지 않는다.
            // 삭제는 우클릭(컨텍스트 메뉴) 전용 — handleTimelineContextMenu 참고.
            if (e.target.classList.contains('editor-note')) return;

            // 빈 칸 클릭: Create 도구일 때만 새 노트를 찍는다.
            // Edit 도구는 아직 담을 기능이 없어 자리만 마련해둔 상태다.
            if (this.state.activeTool !== 'create') return;

            // setDirty/undo 저장은 여기서 미리 하지 않는다 — 트리거 클릭(모달만 열림)이나
            // 롱노트 시작점 클릭(아직 노트 미생성)처럼 실제로는 아무것도 안 바뀌는 클릭까지
            // undo 히스토리를 채우던 문제가 있었다. 대신 각 place*() 함수가 실제로 데이터를
            // 바꾸는 시점에 알아서 저장한다.
            const container = DOM.editor.container;
            // 시간(Y)은 반드시 스크롤되지 않는 container의 rect를 기준으로 + scrollTop을 더해야 한다.
            // gridContainer는 스크롤되는 내용물 안에 있어서 자신의 rect.top 자체가 스크롤할 때마다
            // 바뀌므로, 여기에 scrollTop을 또 더하면 스크롤량이 두 번 반영돼 롱노트처럼 스크롤 위치가
            // 달라진 두 지점을 연속 클릭하는 경우 시간 계산이 크게 어긋나는 버그가 있었다.
            const containerRect = container.getBoundingClientRect();
            const y = e.clientY - containerRect.top + container.scrollTop;

            const laneId = this._xToLaneId(e.clientX);
            const timeInMs = this._yToSnappedRelativeTimeMs(y);
            if (timeInMs < this._minAllowedRelativeTimeMs()) {
                UI.showMessage('editor', '시작 지점 또는 타이밍 시작보다 앞에는 노트를 찍을 수 없습니다.');
                return;
            }

            switch (this.state.selectedNoteType) {
                case 'long': this.placeLongNote(timeInMs, laneId); break;
                case 'trigger': this.placeTrigger(timeInMs); break;
                case 'tap': case 'false': this.placeSimpleNote(timeInMs, laneId); break;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.handleTimelineClick');
        }
    },

    // 우클릭(컨텍스트 메뉴)으로 기존 노트를 삭제한다. 도구(생성/편집)와 무관하게 항상 동작한다.
    // preventDefault는 조건과 무관하게 항상 먼저 호출한다 — 안 그러면 노트가 아닌 빈 칸을
    // 우클릭하거나(삭제 대상 없음) 재생 중일 때(isPlaying) 브라우저 기본 컨텍스트 메뉴가 뜬다.
    handleTimelineContextMenu(e) {
        try {
            e.preventDefault();
            if (this.state.isPlaying) return;
            if (!e.target.classList.contains('editor-note')) return;
            this.setDirty(true);
            this._saveStateForUndo();
            const time = parseFloat(e.target.dataset.time);
            const lane = e.target.dataset.lane;
            this.state.notes = this.state.notes.filter(note => note.time !== time || note.lane !== lane);
            this.state.selectedNotes = this.state.selectedNotes.filter(n => n.time !== time || n.lane !== lane);
            this.renderNotes();
        } catch (err) {
            Debugger.logError(err, 'Editor.handleTimelineContextMenu');
        }
    },

    // ── Edit 도구: 노트 선택(드래그 박스 / 클릭) ─────────────────────────
    // 빈 칸에서 mousedown하면 드래그로 사각 영역을 그려 겹치는 노트를 모두 선택하고,
    // 노트를 직접 mousedown하면 그 노트 하나를 선택한다. Shift를 누른 채로 하면 기존
    // 선택에 추가/제거된다.
    handleEditorMouseDown(e) {
        try {
            if (this.state.activeTool !== 'edit') return;
            if (this.state.isPlaying) return;
            if (e.button !== 0) return; // 좌클릭만 (우클릭은 삭제 컨텍스트 메뉴)

            if (e.target.classList.contains('editor-note')) {
                e.preventDefault();
                const time = parseFloat(e.target.dataset.time);
                const lane = e.target.dataset.lane;

                if (e.shiftKey) {
                    // Shift-클릭은 다중 선택 구성 전용 — 드래그로 넘어가지 않는다.
                    this._toggleNoteSelection(time, lane, true);
                    return;
                }

                const alreadySelected = this.state.selectedNotes.some(n => n.time === time && n.lane === lane);
                if (!alreadySelected) {
                    // 선택 안 된 노트를 클릭 → 그 노트 하나만 선택
                    this.state.selectedNotes = [{ time, lane }];
                    this.renderNotes();
                }
                // 이미 여러 개가 선택된 상태에서 그중 하나를 클릭한 경우엔 선택을 그대로
                // 유지해서 전체를 함께 드래그할 수 있게 한다.
                this._startNoteDrag(e, time, lane);
                return;
            }

            if (!e.shiftKey) {
                this.state.selectedNotes = [];
                this.renderNotes();
            }

            const gridRect = DOM.editor.gridContainer.getBoundingClientRect();
            const containerRect = DOM.editor.container.getBoundingClientRect();
            const startX = e.clientX - gridRect.left;
            const startY = e.clientY - containerRect.top + DOM.editor.container.scrollTop;

            const boxEl = document.createElement('div');
            boxEl.className = 'editor-selection-box';
            DOM.editor.notesContainer.appendChild(boxEl);

            const updateBox = (curX, curY) => {
                const left = Math.min(startX, curX);
                const top = Math.min(startY, curY);
                const width = Math.abs(curX - startX);
                const height = Math.abs(curY - startY);
                boxEl.style.left = `${left}px`;
                boxEl.style.top = `${top}px`;
                boxEl.style.width = `${width}px`;
                boxEl.style.height = `${height}px`;
                return { left, top, width, height };
            };
            let lastRect = updateBox(startX, startY);

            const onMove = (moveEvt) => {
                const curX = moveEvt.clientX - gridRect.left;
                const curY = moveEvt.clientY - containerRect.top + DOM.editor.container.scrollTop;
                lastRect = updateBox(curX, curY);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                boxEl.remove();
                this._applyBoxSelection(lastRect, e.shiftKey);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        } catch (err) {
            Debugger.logError(err, 'Editor.handleEditorMouseDown');
        }
    },

    _toggleNoteSelection(time, lane, additive) {
        const idx = this.state.selectedNotes.findIndex(n => n.time === time && n.lane === lane);
        if (additive) {
            if (idx === -1) this.state.selectedNotes.push({ time, lane });
            else this.state.selectedNotes.splice(idx, 1);
        } else {
            this.state.selectedNotes = [{ time, lane }];
        }
        this.renderNotes();
    },

    // ── Edit 도구: 선택한 노트를 드래그로 이동 ─────────────────────────
    // 여러 노트가 선택된 상태면 시간(Y)만 옮기고 레인(X)은 고정한다 — 서로 다른 레인의
    // 노트를 한꺼번에 옆 레인으로 옮기면 뭘 어디로 보낼지 모호해지기 때문이다.
    // 선택이 하나뿐이면 레인 이동도 허용한다.
    _startNoteDrag(e, clickedTime, clickedLane) {
        const containerRect = DOM.editor.container.getBoundingClientRect();
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const isSingle = this.state.selectedNotes.length <= 1;

        // 드래그 대상 노트들의 실제 state.notes 참조를 찾아 원본 time/lane을 기억해둔다.
        // 참조를 직접 들고 있어야 드래그 중 실시간으로 위치를 바꿔가며 미리보기를 그릴 수 있다.
        const draggedKeys = new Set(this.state.selectedNotes.map(n => `${n.time}|${n.lane}`));
        const originals = this.state.notes
            .filter(n => draggedKeys.has(`${n.time}|${n.lane}`))
            .map(n => ({ ref: n, time: n.time, lane: n.lane }));
        if (!originals.length) return;

        const DRAG_THRESHOLD_PX = 4;
        let isDragging = false;

        const onMove = (moveEvt) => {
            const dx = moveEvt.clientX - startClientX;
            const dy = moveEvt.clientY - startClientY;
            if (!isDragging) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                isDragging = true;
                this._saveStateForUndo(); // 실제로 옮기기 시작하는 순간에만 undo 스냅샷 1회 저장
            }

            const curY = moveEvt.clientY - containerRect.top + DOM.editor.container.scrollTop;
            const newTimeAtCursor = this._yToSnappedRelativeTimeMs(curY);
            let deltaMs = newTimeAtCursor - clickedTime;

            // 그룹 전체가 허용 하한(시작 지점/타이밍 시작)보다 앞으로 밀리지 않도록,
            // "가장 앞선 노트" 기준으로 delta 자체를 한 번만 제한한다. 노트마다 따로
            // clamp하면 하한에 걸리는 노트들이 전부 같은 값으로 끌려가 뭉쳐버린다 —
            // 여기서는 delta를 제한해서 선택된 노트들 사이의 간격(상대 위치)을 그대로 유지한다.
            const minAllowedMs = this._minAllowedRelativeTimeMs();
            const earliestOriginalTime = Math.min(...originals.map(o => o.time));
            deltaMs = Math.max(deltaMs, minAllowedMs - earliestOriginalTime);

            let deltaLaneIndex = 0;
            if (isSingle) {
                const newLaneId = this._xToLaneId(moveEvt.clientX);
                const fromIdx = CONFIG.EDITOR_LANE_IDS.indexOf(clickedLane);
                const toIdx = CONFIG.EDITOR_LANE_IDS.indexOf(newLaneId);
                deltaLaneIndex = toIdx - fromIdx;
            }

            originals.forEach(o => {
                o.ref.time = o.time + deltaMs;
                if (deltaLaneIndex !== 0) {
                    const idx = CONFIG.EDITOR_LANE_IDS.indexOf(o.lane);
                    const clampedIdx = Math.min(CONFIG.EDITOR_LANE_IDS.length - 1, Math.max(0, idx + deltaLaneIndex));
                    o.ref.lane = CONFIG.EDITOR_LANE_IDS[clampedIdx];
                }
            });
            this.state.selectedNotes = originals.map(o => ({ time: o.ref.time, lane: o.ref.lane }));
            this.renderNotes();
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            if (!isDragging) {
                // 실제로는 안 움직인 순수 클릭 — 클릭한 노트 하나로 선택을 좁힌다.
                this.state.selectedNotes = [{ time: clickedTime, lane: clickedLane }];
                this.renderNotes();
                return;
            }
            this._finishNoteDrag(originals);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    },

    _finishNoteDrag(originals) {
        const draggedRefs = new Set(originals.map(o => o.ref));
        // 옮긴 자리에 드래그 대상이 아닌 다른 노트가 이미 있으면(같은 레인, 10ms 이내) 충돌로
        // 보고 전체 이동을 취소한다 — 노트가 겹쳐써지는 것을 막기 위함.
        const collided = originals.some(o =>
            this.state.notes.some(n => !draggedRefs.has(n) && n.lane === o.ref.lane && Math.abs(n.time - o.ref.time) < 10)
        );
        if (collided) {
            originals.forEach(o => { o.ref.time = o.time; o.ref.lane = o.lane; });
            this.state.selectedNotes = originals.map(o => ({ time: o.ref.time, lane: o.ref.lane }));
            // 취소된 이동이라 undo 스냅샷도 의미가 없으니 방금 저장한 것을 버린다.
            this.state.history.pop();
            UI.showMessage('editor', '다른 노트와 겹쳐서 이동을 취소했습니다.');
            this.renderNotes();
            return;
        }
        // measure 필드도 새 시간 기준으로 갱신 — 타임라인 길이 계산(마디 자동 늘리기 등)이
        // 이 필드를 참조하므로 이동 후에도 정확해야 한다.
        originals.forEach(o => { o.ref.measure = this._getMeasureFromTime(o.ref.time); });
        this.state.selectedNotes = originals.map(o => ({ time: o.ref.time, lane: o.ref.lane }));
        this.setDirty(true);
        this.renderNotes();
    },

    _applyBoxSelection(rect, additive) {
        // 실질적으로 클릭에 가까운(거의 움직이지 않은) 드래그는 새로 선택할 노트가 없다 —
        // additive가 아니면 이미 위에서 선택을 비워뒀으므로 다시 그리기만 한다.
        if (rect.width < 2 && rect.height < 2) {
            this.renderNotes();
            return;
        }
        const boxLeft = rect.left, boxTop = rect.top;
        const boxRight = rect.left + rect.width, boxBottom = rect.top + rect.height;
        const picked = [];
        DOM.editor.notesContainer.querySelectorAll('.editor-note').forEach(noteEl => {
            const left = parseFloat(noteEl.style.left) || 0;
            const top = parseFloat(noteEl.style.top) || 0;
            const right = left + noteEl.offsetWidth;
            const bottom = top + noteEl.offsetHeight;
            const intersects = left < boxRight && right > boxLeft && top < boxBottom && bottom > boxTop;
            if (intersects) {
                picked.push({ time: parseFloat(noteEl.dataset.time), lane: noteEl.dataset.lane });
            }
        });
        if (additive) {
            picked.forEach(p => {
                if (!this.state.selectedNotes.some(n => n.time === p.time && n.lane === p.lane)) {
                    this.state.selectedNotes.push(p);
                }
            });
        } else {
            this.state.selectedNotes = picked;
        }
        this.renderNotes();
    },

    // ── Edit 도구: 복사 / 붙여넣기 ─────────────────────────────────────
    copySelectedNotes() {
        if (!this.state.selectedNotes.length) return;
        const selectedKeys = new Set(this.state.selectedNotes.map(n => `${n.time}|${n.lane}`));
        this.state.clipboardNotes = this.state.notes
            .filter(note => selectedKeys.has(`${note.time}|${note.lane}`))
            .map(note => ({ ...note }));
        if (DOM.editor.statusLabel) {
            DOM.editor.statusLabel.textContent = `${this.state.clipboardNotes.length}개 노트를 복사했습니다.`;
        }
    },

    // 클립보드에 복사해 둔 노트들을 (스냅 격자에 맞춘) 현재 재생헤드 위치를 기준으로
    // 붙여넣는다. 복사한 노트들 중 가장 이른 시각을 기준점 삼아, 그 노트가 재생헤드
    // 위치에 오도록 나머지 노트들도 같은 만큼 통째로 시간축을 밀어서 배치한다 —
    // 복사했던 노트들 사이의 상대적인 배치(간격/레인 구성)는 그대로 유지된다.
    pasteNotes() {
        try {
            if (!this.state.clipboardNotes.length) {
                UI.showMessage('editor', '복사된 노트가 없습니다. 먼저 Ctrl+C로 복사하세요.');
                return;
            }

            const playheadTop = parseFloat(DOM.editor.playhead.style.top) || 0;
            const targetTimeMs = this._yToSnappedRelativeTimeMs(playheadTop);

            const anchorTime = Math.min(...this.state.clipboardNotes.map(n => n.time));
            const deltaMs = targetTimeMs - anchorTime;

            const newNotes = this.state.clipboardNotes.map(note => {
                const newTime = note.time + deltaMs;
                return { ...note, time: newTime, measure: this._getMeasureFromTime(newTime) };
            });

            // 시작 지점(오프셋) 또는 타이밍 시작보다 앞으로 밀려나는 노트가 하나라도 있으면
            // 전체를 취소한다 — 일부만 잘려서 붙여넣어지면 오히려 헷갈리기 때문.
            const minAllowedMs = this._minAllowedRelativeTimeMs();
            if (newNotes.some(n => n.time < minAllowedMs)) {
                UI.showMessage('editor', '재생헤드 위치가 너무 앞이라 붙여넣을 수 없습니다 (시작 지점 또는 타이밍 시작보다 앞).');
                return;
            }

            // 이미 노트가 있는 자리는 덮어쓰지 않고 건너뛴다.
            const existingKeys = new Set(this.state.notes.map(n => `${n.time}|${n.lane}`));
            const toInsert = newNotes.filter(n => !existingKeys.has(`${n.time}|${n.lane}`));

            if (!toInsert.length) {
                UI.showMessage('editor', '붙여넣을 자리에 이미 노트가 있습니다.');
                return;
            }

            this._saveStateForUndo();
            this.setDirty(true);
            this.state.notes.push(...toInsert);
            this.state.selectedNotes = toInsert.map(n => ({ time: n.time, lane: n.lane }));
            this.renderNotes();

            const skipped = newNotes.length - toInsert.length;
            if (DOM.editor.statusLabel) {
                DOM.editor.statusLabel.textContent = skipped > 0
                    ? `${toInsert.length}개 붙여넣음 (${skipped}개는 자리가 겹쳐서 건너뜀)`
                    : `${toInsert.length}개 노트를 붙여넣었습니다.`;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.pasteNotes');
        }
    },

    placeSimpleNote(time, laneId) {
        if (!this.state.notes.some(n => Math.abs(n.time - time) < 10 && n.lane === laneId)) {
            this._saveStateForUndo();
            this.setDirty(true);
            const measure = this._getMeasureFromTime(time);
            this.state.notes.push({ time, lane: laneId, type: this.state.selectedNoteType, measure });
            this.renderNotes();
        }
    },

    placeLongNote(time, laneId) {
        if (!this.state.isPlacingLongNote) {
            // 시작 지점만 지정하는 단계 — 아직 노트가 생기지 않으므로 undo/dirty는 다음
            // (끝 지점을 찍어 실제로 노트가 추가되는) 단계에서만 저장한다.
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
            this._saveStateForUndo();
            this.setDirty(true);
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

    // 기존 트리거 마커를 클릭했을 때 — 같은 모달을 그 트리거의 현재 값으로 채워서 연다.
    // 확인을 누르면 confirmTrigger()가 같은 시간의 트리거를 교체하므로 자연히 "수정"이 된다.
    editTrigger(trigger) {
        this.state.pendingTriggerTime = trigger.time;
        this.showTriggerModal(trigger);
    },

    showTriggerModal(existingTrigger = null) {
        // 기존 트리거를 수정하는 경우 그 트리거의 값으로, 새로 만드는 경우 현재 설정값으로 모달을 채운다.
        DOM.triggerModal.bpmInput.value = existingTrigger ? existingTrigger.bpm : this.state.bpm;
        DOM.triggerModal.fallSpeedInput.value = existingTrigger
            ? existingTrigger.fallSpeed
            : (parseFloat(DOM.editor.noteFallSpeedInput?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed);
        DOM.triggerModal.transitionInput.value = existingTrigger
            ? ((existingTrigger.transitionMs ?? 700) / 1000)
            : 0.7;
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

        this._saveStateForUndo();

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
            const offsetSec = this.state.song.startOffsetSec || 0;

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
                
                // trigger.time도 오프셋 기준 상대시간 — 노트와 동일하게 오프셋을 더해 그린다.
                const yPosition = this._secondsToY((trigger.time / 1000) + offsetSec);
                triggerEl.style.top = `${yPosition}px`;
                
                triggerEl.dataset.time = trigger.time;
                triggerEl.title = `클릭: 수정 / 우클릭: 삭제\nBPM: ${trigger.bpm}, 하강: ${trigger.fallSpeed}, 전환: ${((trigger.transitionMs ?? 700) / 1000).toFixed(1)}s`;
                
                // 좌클릭 — 이 트리거를 수정하는 모달을 연다 (배치 클릭이 아래로 전파되는 것도 막는다).
                // 우클릭(컨텍스트 메뉴) — 삭제. 도구와 무관하게 항상 동작한다.
                triggerEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.editTrigger(trigger);
                });
                triggerEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._saveStateForUndo();
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
            // 노트는 타임라인(시크 거터를 뺀 나머지 영역) 너비를 기준으로 배치해야 한다.
            const timelineWidth = DOM.editor.timeline.clientWidth;
            if (timelineWidth === 0) return;
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const laneWidth = timelineWidth / CONFIG.EDITOR_LANE_IDS.length;
            const beatsPerSecond = this.state.bpm / 60;
            const offsetSec = this.state.song.startOffsetSec || 0;

            this.state.notes.forEach(note => {
                const noteEl = document.createElement('div');
                noteEl.className = 'editor-note';
                if (note.duration) noteEl.classList.add('long');
                if (note.type === 'false') noteEl.classList.add('false');
                if (this.state.selectedNotes.some(n => n.time === note.time && n.lane === note.lane)) {
                    noteEl.classList.add('selected');
                }
                const laneIndex = CONFIG.EDITOR_LANE_IDS.indexOf(note.lane);
                if (laneIndex === -1) return;
                noteEl.style.width = `${laneWidth}px`;
                noteEl.style.left = `${laneIndex * laneWidth}px`;
                
                // note.time은 오프셋(빨간선) 기준 상대시간이므로, 절대 타임라인 좌표로
                // 그리려면 오프셋을 다시 더해줘야 그리드/빨간선과 정확히 일치한다.
                const yPosition = this._secondsToY((note.time / 1000) + offsetSec);
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
            startTimeOffset: this.state.song.startOffsetSec,
            fallSpeed: parseFloat(DOM.editor.noteFallSpeedInput?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed,
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
                startTimeOffset: this.state.song.startOffsetSec,
                fallSpeed: parseFloat(DOM.editor.noteFallSpeedInput?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed,
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
            // 이 파일에 startTimeOffset이 있으면 마이그레이션 기본값으로 채택한다.
            // 단, 종합 창에서 이미 song.startOffsetSec를 잡아둔 상태라면(예: 기존 노래에
            // 새 난이도만 불러오는 경우) 덮어쓰지 않는다.
            if (chartData.startTimeOffset) {
                this.state.song.startOffsetSec = chartData.startTimeOffset;
            }
            DOM.editor.bpmInput.value = this.state.bpm;
            UI.showMessage('editor', `test`);
            if (DOM.editor.noteFallSpeedInput) {
                alert(chartData.fallSpeed);
                DOM.editor.noteFallSpeedInput.value = (typeof chartData.fallSpeed === 'number' && chartData.fallSpeed > 0)
                    ? chartData.fallSpeed
                    : CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
            }
            this.state.previewSeekSec = this.state.song.startOffsetSec || 0;
            DOM.editor.startTimeInput.value = this.state.previewSeekSec;
            if (DOM.editor.timingStartInput) DOM.editor.timingStartInput.value = this.state.song.timingStartSec || 0;
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
            this._setPlayheadTop(this._secondsToY(this.state.previewSeekSec));
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
            bpm: CONFIG.EDITOR_DEFAULT_SETTINGS.bpm,
            startTimeOffset: 0,
            fallSpeed: CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed,
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
            coverFileObject: null,
            coverFileName: '',
            cloudSongId: null,
            previewStartSec: 0,
            startOffsetSec: 0,
            timingStartSec: 0,
        };
        this.state.beatmaps = [];
        this.state.activeBeatmapIndex = 0;
        this.state._flatBeatmapIndex = null;
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
        // 이 난이도를 아직 안 불러온 사이에 종합 창에서 시작 시각(startOffsetSec)이 바뀐 적이
        // 있으면, 그동안 쌓인 델타를 지금 막 받아온 notes/triggers에 한 번에 적용해준다.
        if (bm._pendingOffsetDeltaMs) {
            const delta = bm._pendingOffsetDeltaMs;
            bm.notes.forEach(note => { note.time -= delta; });
            bm.triggers.forEach(trigger => { trigger.time -= delta; });
            bm._pendingOffsetDeltaMs = 0;
            if (bm.cloudChartId) bm._cloudDirty = true;
        }
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
            this.state.noteSpeed = bm.noteSpeed || 7;
            // startTimeOffset은 더 이상 비트맵별로 따로 읽지 않는다 — song.startOffsetSec가
            // 유일한 소스이며 resetEditorState()에서도 건드리지 않으므로 여기 그대로 유지된다.
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
            if (DOM.editor.noteFallSpeedInput) {
                DOM.editor.noteFallSpeedInput.value = (typeof bm.fallSpeed === 'number' && bm.fallSpeed > 0)
                    ? bm.fallSpeed
                    : CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
            }
            this.state.previewSeekSec = this.state.song.startOffsetSec || 0;
            DOM.editor.startTimeInput.value = this.state.previewSeekSec;
            if (DOM.editor.timingStartInput) DOM.editor.timingStartInput.value = this.state.song.timingStartSec || 0;
            DOM.editor.chartFilenameInput.value = bm.difficultyLabel || '';
            if (bm.laneCount && DOM.editor.previewLanesSelector) {
                DOM.editor.previewLanesSelector.value = bm.laneCount;
                this.highlightEditorLanes(bm.laneCount);
            }
            this.drawTimeline();
            this.renderNotes();
            this._setPlayheadTop(this._secondsToY(this.state.previewSeekSec));
            this.setDirty(false);
            // 이 순간부터 flat 상태(notes/triggers)가 beatmaps[index]를 대표한다 —
            // setStartOffsetSec()이 오프셋 변경분을 다른 난이도에 전파할 때 이 인덱스는 건너뛴다.
            this.state._flatBeatmapIndex = index;
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
            bm.fallSpeed = parseFloat(DOM.editor.noteFallSpeedInput?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
            // startTimeOffset은 더 이상 비트맵별 독립값이 아니라 song.startOffsetSec의 미러다.
            // (저장 포맷/game.js 하위호환을 위해 필드 자체는 유지하되 항상 같은 값으로 채운다.)
            bm.startTimeOffset = this.state.song.startOffsetSec;
            // timingStartSec도 같은 패턴 — song.timingStartSec의 미러일 뿐, 비트맵별 독립값이 아니다.
            bm.timingStartSec = this.state.song.timingStartSec || 0;
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

    // ── 도구(Create/Edit/Delete) 선택 ─────────────────────────────────
    updateToolUI() {
        DOM.editor.toolSelector.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === this.state.activeTool);
        });
        // Create 도구가 아닐 때는 노트타입 선택이 의미가 없으므로 비활성/dim 처리한다.
        const isCreate = this.state.activeTool === 'create';
        DOM.editor.noteTypeSelector.classList.toggle('tool-disabled', !isCreate);
        DOM.editor.noteTypeSelector.querySelectorAll('button').forEach(btn => {
            btn.disabled = !isCreate;
        });
    },

    handleToolSelect(e) {
        if (e.target.tagName !== 'BUTTON') return;
        this.setActiveTool(e.target.dataset.tool);
    },

    setActiveTool(tool) {
        this.state.activeTool = tool;
        this.updateToolUI();
        // 도구를 바꾸면 진행 중이던 롱노트 배치는 취소한다.
        this.resetLongNotePlacement();
        // Edit 도구를 벗어나면 선택 상태도 함께 비운다.
        if (tool !== 'edit' && this.state.selectedNotes.length) {
            this.state.selectedNotes = [];
            this.renderNotes();
        }
        if (tool === 'edit') {
            DOM.editor.statusLabel.textContent = '드래그 또는 클릭으로 노트를 선택하세요. (Ctrl+C: 복사, Ctrl+V: 붙여넣기)';
        } else if (DOM.editor.statusLabel) {
            DOM.editor.statusLabel.textContent = '';
        }
    },

    handleSnapChange(e) {
        this.setDirty(true);
        this.state.snapDivision = parseInt(e.target.value) || 4;
        this.drawGrid();
        this.renderNotes();
    },

    // 왼쪽/오른쪽 화살표 키: 스냅 분할(#editor-snap-selector의 <option> 목록 기준)을
    // 이전/다음 단계로 바꾼다. 12·24처럼 2배씩 늘어나지 않는 옵션도 있어서 숫자를 직접
    // 연산하지 않고 select의 실제 옵션 순서를 따라간다. direction: -1 = 더 큰 분할(왼쪽),
    // 1 = 더 작은 분할(오른쪽).
    adjustSnapDivision(direction) {
        try {
            const select = DOM.editor.snapSelector;
            if (!select || !select.options.length) return;
            const options = Array.from(select.options).map(o => parseInt(o.value, 10));
            const currentIndex = options.indexOf(this.state.snapDivision);
            const baseIndex = currentIndex === -1 ? 0 : currentIndex;
            const newIndex = Math.min(options.length - 1, Math.max(0, baseIndex + direction));
            const newDivision = options[newIndex];
            if (newDivision === this.state.snapDivision) return;

            this.state.snapDivision = newDivision;
            select.value = String(newDivision);
            this.setDirty(true);
            this.drawGrid();
            this.renderNotes();
            if (DOM.editor.statusLabel) {
                DOM.editor.statusLabel.textContent = `스냅 분할: 1/${newDivision}`;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.adjustSnapDivision');
        }
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
        const playheadTop = parseFloat(DOM.editor.playhead.style.top) || 0;
        // handleTimelineClick과 동일한 계산이라 중복을 없애고 공용 헬퍼를 재사용한다.
        const timeInMs = this._yToSnappedRelativeTimeMs(playheadTop);
        if (timeInMs < this._minAllowedRelativeTimeMs()) return; // 시작 지점/타이밍 시작보다 앞에는 찍지 않음
        this.placeSimpleNote(timeInMs, laneId);
    },

    handleUndo() {
        if (this.state.history.length > 0) {
            this.setDirty(true);
            const previous = this.state.history.pop();
            this.state.notes = previous.notes;
            this.state.triggers = previous.triggers;
            this.renderNotes(); // 내부에서 renderTriggers()도 함께 호출됨
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

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            this.copySelectedNotes();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            this.pasteNotes();
            return;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return;

        switch (e.key) {
            case ' ':
            case 'Spacebar': // 일부 구형 브라우저 호환
                e.preventDefault();
                if (e.repeat) return; // 꾹 누르고 있을 때 반복 토글되는 것 방지
                this.handlePlayPause();
                return;
            case 'ArrowUp': e.preventDefault(); this.movePlayheadBySnapStep(-1); return;
            case 'ArrowDown': e.preventDefault(); this.movePlayheadBySnapStep(1); return;
            case 'ArrowLeft': e.preventDefault(); this.adjustSnapDivision(-1); return;
            case 'ArrowRight': e.preventDefault(); this.adjustSnapDivision(1); return;
        }

        switch (e.key) {
            case '1': e.preventDefault(); this.setSelectedNoteType('tap'); return;
            case '2': e.preventDefault(); this.setSelectedNoteType('long'); return;
            case '3': e.preventDefault(); this.setSelectedNoteType('false'); return;
        }

        // 도구 전환 단축키. Q/W/E/R/T/Y/U/I/O는 이미 EDITOR_KEY_LANE_MAP에서
        // 레인 배치 키로 쓰이고 있어서 겹치지 않는 Z/X를 사용한다.
        // 삭제는 별도 도구가 아니라 우클릭(컨텍스트 메뉴)으로 대체되었다.
        const pressedKey = e.key.toLowerCase();
        if (pressedKey === CONFIG.EDITOR_TOOL_KEYS.create) { e.preventDefault(); this.setActiveTool('create'); return; }
        if (pressedKey === CONFIG.EDITOR_TOOL_KEYS.edit) { e.preventDefault(); this.setActiveTool('edit'); return; }

        const laneId = CONFIG.EDITOR_KEY_LANE_MAP[e.code];
        if (laneId) {
            e.preventDefault();
            this.placeNoteAtPlayhead(laneId);
        }
    }
};