// ── Editor: 핵심 상태 / 초기화 / 좌표 변환 / 되돌리기 / 타임라인·그리드 렌더링 ──
// editor.js에서 분리됨. 이 파일이 Editor 객체를 선언하며, 나머지 editor-*.js는
// Object.assign(Editor, {...})로 메서드를 덧붙인다. beat.html에서 반드시 이 파일이
// 먼저 로드되어야 한다.
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
    // 환경설정 → 에디터 탭에서 '레거시'를 고르면 분할과 무관하게 예전 그대로의 진한 회색 한 가지로 통일한다.
    _beatLineColorForDenominator(denominator) {
        if (CONFIG.EDITOR_GRID_LINE_STYLE === 'legacy') return '#4a5568'; // 레거시 — 통일된 진한 회색
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

};