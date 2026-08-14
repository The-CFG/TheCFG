// ── Editor: persistence 관련 메서드 ──
// editor.js에서 분리됨. editor-core.js 이후에 로드되어야 한다.
Object.assign(Editor, {
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
            useCustomFallSpeed: !!DOM.editor.useCustomFallSpeedToggle?.checked,
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
                useCustomFallSpeed: !!DOM.editor.useCustomFallSpeedToggle?.checked,
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
            if (DOM.editor.noteFallSpeedInput) {
                DOM.editor.noteFallSpeedInput.value = (typeof chartData.fallSpeed === 'number' && chartData.fallSpeed > 0)
                    ? chartData.fallSpeed
                    : CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
            }
            if (DOM.editor.useCustomFallSpeedToggle) {
                DOM.editor.useCustomFallSpeedToggle.checked = chartData.useCustomFallSpeed === true;
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
            useCustomFallSpeed: false,
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
            audioUrl: null,
            coverFileObject: null,
            coverFileName: '',
            coverUrl: null,
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
        if (typeof data.fallSpeed === 'number' && data.fallSpeed > 0) bm.fallSpeed = data.fallSpeed;
        bm.useCustomFallSpeed = data.useCustomFallSpeed === true;
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
            this.state.noteSpeed = bm.fallSpeed || 7;
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

            // 오디오는 비트맵이 아니라 노래(song) 단위로 관리된다. 로컬에서 새로 고른 파일이
            // 있으면 그걸 우선 쓰고, 없으면 클라우드 노래를 열 때 자동으로 채워진 audioUrl로
            // 로드한다(EditorHome.open 참고). 둘 다 없으면 신규 로컬 노래에서 아직 오디오를
            // 안 고른 상태.
            if (this.state.song.audioFileObject) {
                this.loadAudioFromBlob(this.state.song.audioFileObject, this.state.song.audioFileName);
            } else if (this.state.song.audioUrl) {
                this.loadAudioFromUrl(this.state.song.audioUrl, this.state.song.audioFileName);
            } else {
                DOM.editor.audioFileNameEl.textContent = '선택된 파일 없음';
            }

            DOM.editor.bpmInput.value = this.state.bpm;
            if (DOM.editor.noteFallSpeedInput) {
                DOM.editor.noteFallSpeedInput.value = (typeof bm.fallSpeed === 'number' && bm.fallSpeed > 0)
                    ? bm.fallSpeed
                    : CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
            }
            if (DOM.editor.useCustomFallSpeedToggle) {
                DOM.editor.useCustomFallSpeedToggle.checked = bm.useCustomFallSpeed === true;
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
            bm.useCustomFallSpeed = !!DOM.editor.useCustomFallSpeedToggle?.checked;
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

});