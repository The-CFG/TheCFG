/**
 * EditorSong
 * ----------
 * 종합 창(노래 단위로 제목/가수/오디오와 난이도 목록을 관리하는 화면)의 로컬 기능을 다룬다.
 *
 * - 새 노래 만들기: Editor.state.song / beatmaps를 초기화하고 빈 난이도 1개로 시작
 * - 난이도 카드 목록: 추가 / 이름변경 / 복제 / 삭제 / 편집(비트맵 창 진입)
 * - 로컬 파일로 저장(ChartFormat.wrapAll) / 불러오기(ChartFormat.normalizeAll)
 * - Phase 3d: 클라우드 업로드(uploadToCloud) — 신규 노래면 CloudCharts.uploadSong으로 노래+오디오를
 *   먼저 만들고, cloudChartId가 없는(=아직 안 올라간) 난이도들만 addBeatmapToSong으로 추가한다.
 *   에디터 홈에서 클라우드 노래를 열면(EditorHome.open) 난이도는 메타만 채워지고 notes/triggers는
 *   비어있는 채(_loaded: false)로 들어오는데, 편집/복제/전체저장 시점에 Editor.ensureBeatmapLoaded()로
 *   그때그때 내려받는다.
 */
const EditorSong = {
    // "새 노래 만들기" — 에디터 홈의 "+ 새 노래 만들기" 버튼에서 호출.
    newSong() {
        if (Editor.state.beatmaps.length > 0 &&
            !confirm('현재 작업 중인 노래가 있습니다. 새 노래를 만들면 저장하지 않은 내용은 사라집니다. 계속할까요?')) {
            return;
        }
        Editor.resetSongState();
        Editor.state.beatmaps.push(Editor.createDefaultBeatmap('기본'));
        Editor.state.activeBeatmapIndex = 0;
        UI.showScreen('editorSong');
        this.render();
    },

    // 현재 Editor.state를 기준으로 종합 창을 다시 그린다. 화면 진입/변경마다 호출.
    render() {
        const song = Editor.state.song;
        if (DOM.editorSong.titleInput) DOM.editorSong.titleInput.value = song.title || '';
        if (DOM.editorSong.artistInput) DOM.editorSong.artistInput.value = song.artist || '';
        if (DOM.editorSong.audioNameEl) {
            DOM.editorSong.audioNameEl.textContent = song.audioFileName || '선택된 파일 없음';
        }
        if (DOM.editorSong.coverNameEl) {
            DOM.editorSong.coverNameEl.textContent = song.coverFileName || '선택된 파일 없음 (선택)';
        }
        if (DOM.editorSong.previewStartInput) {
            DOM.editorSong.previewStartInput.value = song.previewStartSec || 0;
        }
        if (DOM.editorSong.startTimeInput) {
            DOM.editorSong.startTimeInput.value = song.startOffsetSec || 0;
        }
        if (DOM.editorSong.timingStartInput) {
            DOM.editorSong.timingStartInput.value = song.timingStartSec || 0;
        }
        if (DOM.editorSong.titleHeading) {
            DOM.editorSong.titleHeading.textContent = song.title ? song.title : '종합 창';
        }
        this._renderBeatmapList();
    },

    _renderBeatmapList() {
        const container = DOM.editorSong.beatmapList;
        if (!container) return;
        container.innerHTML = '';

        if (Editor.state.beatmaps.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'text-gray-400 text-sm text-center mt-4';
            empty.textContent = '난이도가 없습니다. "+ 새 난이도 추가"로 만들어보세요.';
            container.appendChild(empty);
            return;
        }

        Editor.state.beatmaps.forEach((bm, i) => {
            const card = document.createElement('div');
            card.className = 'p-3 bg-gray-800 rounded-lg flex items-center justify-between gap-2';

            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';
            const label = document.createElement('p');
            label.className = 'font-semibold truncate';
            const cloudBadge = bm.cloudChartId ? (bm._cloudDirty ? ' ☁·수정됨' : ' ☁') : '';
            label.textContent = `${bm.difficultyLabel || '기본'}${cloudBadge}`;
            const meta = document.createElement('p');
            meta.className = 'text-xs text-gray-400';
            const noteCountLabel = bm._loaded === false ? '노트 —' : `노트 ${(bm.notes || []).length}개`;
            meta.textContent = `${bm.laneCount || 4}레인 · BPM ${bm.bpm || 120} · ${noteCountLabel}`;
            info.append(label, meta);

            if (bm.updatedAt) {
                const updated = document.createElement('p');
                updated.className = 'text-xs text-gray-500';
                updated.textContent = `최근 수정: ${this._formatUpdatedAt(bm.updatedAt)}`;
                info.append(updated);
            }

            const btns = document.createElement('div');
            btns.className = 'flex gap-1 flex-shrink-0';
            btns.append(
                this._makeBtn('편집', 'bg-teal-600 hover:bg-teal-500', () => this.editBeatmap(i)),
                this._makeBtn('복제', 'bg-gray-600 hover:bg-gray-500', () => this.duplicateBeatmap(i)),
                this._makeBtn('이름변경', 'bg-gray-600 hover:bg-gray-500', () => this.renameBeatmap(i)),
                this._makeBtn('삭제', 'bg-red-700 hover:bg-red-600', () => this.deleteBeatmap(i)),
            );

            card.append(info, btns);
            container.appendChild(card);
        });
    },

    _makeBtn(label, colorClasses, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = `py-1 px-2 text-xs rounded whitespace-nowrap ${colorClasses}`;
        btn.addEventListener('click', onClick);
        return btn;
    },

    // 난이도 카드에 표시할 "최근 수정" 시각을 사람이 읽기 좋은 형태로 변환
    _formatUpdatedAt(isoString) {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    },

    // ── 난이도 카드 액션 ──────────────────────────────────────────────
    addBeatmap() {
        const label = prompt('새 난이도 이름을 입력하세요.', `난이도 ${Editor.state.beatmaps.length + 1}`);
        if (label === null) return; // 취소
        const bm = Editor.createDefaultBeatmap(label.trim() || '기본');
        Editor.state.beatmaps.push(bm);
        this.editBeatmap(Editor.state.beatmaps.length - 1);
    },

    renameBeatmap(index) {
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        const label = prompt('난이도 이름을 입력하세요.', bm.difficultyLabel || '');
        if (label === null) return;
        bm.difficultyLabel = label.trim() || '기본';
        if (bm.cloudChartId) bm._cloudDirty = true; // 이미 올라간 난이도면 다음 업로드 시 메타를 다시 보내야 함
        this.render();
    },

    async duplicateBeatmap(index) {
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        if (bm._loaded === false) {
            UI.showMessage('editorSong', '난이도 데이터를 불러오는 중…');
            const ok = await Editor.ensureBeatmapLoaded(bm);
            if (!ok) return;
            this.render();
        }
        const copy = JSON.parse(JSON.stringify(bm));
        copy.cloudChartId = null;
        copy.updatedAt = null;
        copy._loaded = true;
        copy.difficultyLabel = `${bm.difficultyLabel || '기본'} 사본`;
        Editor.state.beatmaps.splice(index + 1, 0, copy);
        this.render();
    },

    deleteBeatmap(index) {
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        if (Editor.state.beatmaps.length <= 1) {
            UI.showMessage('editorSong', '난이도는 최소 1개 이상 있어야 합니다.');
            return;
        }
        const cloudNote = bm.cloudChartId
            ? '\n(이 난이도는 클라우드에도 올라가 있습니다. 목록에서만 제거되며 클라우드 데이터는 남습니다.)'
            : '';
        if (!confirm(`"${bm.difficultyLabel || '기본'}" 난이도를 삭제할까요? 되돌릴 수 없습니다.${cloudNote}`)) return;
        Editor.state.beatmaps.splice(index, 1);
        if (Editor.state.activeBeatmapIndex >= Editor.state.beatmaps.length) {
            Editor.state.activeBeatmapIndex = Editor.state.beatmaps.length - 1;
        }
        this.render();
    },

    // 비트맵 창으로 들어가서 이 난이도를 편집한다.
    // 클라우드에서 메타만 받아온(_loaded: false) 난이도면 편집 진입 전에 notes/triggers를 먼저 내려받는다.
    async editBeatmap(index) {
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        if (bm._loaded === false) {
            UI.showMessage('editorSong', '난이도 데이터를 불러오는 중…');
            const ok = await Editor.ensureBeatmapLoaded(bm);
            if (!ok) { this.render(); return; }
        }
        UI.showScreen('editor');
        Editor.loadBeatmapIntoFlatState(index);
        // 화면 전환 직후 캔버스 레이아웃이 아직 안 잡혀있을 수 있어 한 프레임 뒤 다시 그린다.
        setTimeout(() => {
            Editor.drawTimeline();
            Editor.renderNotes();
        }, 0);
    },

    // ── 노래 메타 입력 ────────────────────────────────────────────────
    onTitleInput(value) {
        Editor.state.song.title = value;
        if (DOM.editorSong.titleHeading) {
            DOM.editorSong.titleHeading.textContent = value ? value : '종합 창';
        }
    },

    onArtistInput(value) {
        Editor.state.song.artist = value;
    },

    onPreviewStartInput(value) {
        const sec = Math.max(0, parseFloat(value) || 0);
        Editor.state.song.previewStartSec = sec;
    },

    // 실제 플레이 시 노래가 재생되기 시작하는 지점(초). 비트맵 창의 "미리보기 시작(초)"와
    // 별개이며, 여기 값만 실제 게임 재생(Game.start)에 쓰인다.
    // Editor.setStartOffsetSec()을 그대로 재사용한다 — 이 값이 바뀌면 이미 찍혀있는 모든
    // 난이도의 note.time/trigger.time(오프셋 기준 상대시간)도 델타만큼 같이 보정해줘야
    // 노트들의 실제 위치가 밀리지 않는다. (비트맵 창의 동일 입력과 로직을 공유)
    // 종합 창에는 오디오가 아직 안 로드돼있을 수 있어 오디오 seek는 건너뛴다.
    onStartTimeInput(value) {
        const sec = Math.max(0, parseFloat(value) || 0);
        Editor.setStartOffsetSec(sec, { seekAudio: false });
    },

    // "타이밍 시작(초)" — startOffsetSec과 완전히 독립된 값. BPM 그리드/박자 계산은
    // 항상 이 시각을 0박째로 삼아 세어나간다(Editor._yToSeconds/_secondsToY 참고).
    // 다만 note.time/trigger.time 자체는 startOffsetSec 기준 상대시간으로 저장되는
    // 별개의 좌표계라, Editor.setStartOffsetSec()과 달리 이 값이 바뀌어도 note.time을
    // 보정할 필요는 없다 — 그리드가 다시 그려지는 것만으로 충분하다.
    onTimingStartInput(value) {
        const sec = Math.max(0, parseFloat(value) || 0);
        Editor.setTimingStartSec(sec);
    },

    // 오디오는 노래(song) 단위로 한 번만 고르면 모든 난이도가 공유해서 쓴다.
    handleAudioSelect(file) {
        if (!file) return;
        Editor.state.song.audioFileObject = file;
        Editor.state.song.audioFileName = file.name;
        if (DOM.editorSong.audioNameEl) DOM.editorSong.audioNameEl.textContent = file.name;
        // 실제 AudioEngine 로드는 비트맵 창 진입 시(Editor.loadBeatmapIntoFlatState)로 미룬다.
    },

    // 노래 커버 이미지(선택) — 노래 선택 화면부터 결과 화면까지 왼쪽 game-area 배경으로 쓰인다.
    handleCoverSelect(file) {
        if (!file) return;
        Editor.state.song.coverFileObject = file;
        Editor.state.song.coverFileName = file.name;
        if (DOM.editorSong.coverNameEl) DOM.editorSong.coverNameEl.textContent = file.name;
    },

    // ── 로컬 파일 저장/불러오기 ───────────────────────────────────────
    async saveLocal() {
        try {
            if (Editor.state.beatmaps.length === 0) {
                UI.showMessage('editorSong', '저장할 난이도가 없습니다.');
                return;
            }
            const unloaded = Editor.state.beatmaps.filter(bm => bm._loaded === false);
            if (unloaded.length > 0) {
                UI.showMessage('editorSong', '난이도 데이터를 불러오는 중…');
                for (const bm of unloaded) {
                    const ok = await Editor.ensureBeatmapLoaded(bm);
                    if (!ok) return;
                }
                this.render();
            }
            const chart = ChartFormat.wrapAll(Editor.state.song, Editor.state.beatmaps);
            const filename = (Editor.state.song.title || '').trim() || 'untitled';
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(chart, null, 2));
            const a = document.createElement('a');
            a.setAttribute('href', dataStr);
            a.setAttribute('download', `${filename}.json`);
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err) {
            Debugger.logError(err, 'EditorSong.saveLocal');
            UI.showMessage('editorSong', `저장 실패: ${err.message}`);
        }
    },

    // 파일 여러 개를 한 번에 골라도 각 파일의 난이도(비트맵)를 모두 모아 하나의 노래에 합친다.
    // 파일 하나에 난이도가 여러 개 들어있는 v2 포맷도, 옛 포맷(파일당 난이도 1개)도 섞어서 줄 수 있다.
    // 노래 메타(제목/가수/미리듣기 시작 등)는 맨 처음 파일 것을 채택한다.
    loadLocalFiles(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        if (Editor.state.beatmaps.length > 0 &&
            !confirm('현재 작업 중인 노래가 있습니다. 불러오면 저장하지 않은 내용은 사라집니다. 계속할까요?')) {
            return;
        }

        const readAsJson = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    resolve({ file, raw: JSON.parse(e.target.result) });
                } catch (err) {
                    reject(new Error(`${file.name}: JSON 해석 실패`));
                }
            };
            reader.onerror = () => reject(new Error(`${file.name}: 파일을 읽을 수 없습니다.`));
            reader.readAsText(file);
        });

        // 선택한 순서를 보장하기 위해 allSettled로 다 읽은 뒤 순서대로 처리한다.
        Promise.allSettled(files.map(readAsJson)).then((results) => {
            Editor.resetSongState();
            let songMetaSet = false;
            let totalBeatmaps = 0;
            const failed = [];

            results.forEach((result) => {
                if (result.status !== 'fulfilled') {
                    failed.push(result.reason?.message || '알 수 없는 오류');
                    return;
                }
                const { file, raw } = result.value;
                try {
                    const normalized = ChartFormat.normalizeAll(raw);
                    if (!songMetaSet) {
                        Editor.state.song.title = normalized.songName;
                        Editor.state.song.artist = normalized.artist || '';
                        Editor.state.song.previewStartSec = (normalized.previewStartMs || 0) / 1000;
                        Editor.state.song.startOffsetSec = (normalized.startOffsetMs || 0) / 1000;
                        Editor.state.song.timingStartSec = (normalized.timingStartMs || 0) / 1000;
                        songMetaSet = true;
                    }
                    const newBeatmaps = normalized.beatmaps.map(bm => ({ ...bm, cloudChartId: null }));
                    Editor.state.beatmaps.push(...newBeatmaps);
                    totalBeatmaps += newBeatmaps.length;
                } catch (err) {
                    failed.push(`${file.name}: ${err.message}`);
                }
            });

            Editor.state.activeBeatmapIndex = 0;
            this.render();

            if (totalBeatmaps === 0) {
                UI.showMessage('editorSong', `불러오기 실패: ${failed.join(', ') || '유효한 난이도가 없습니다.'}`);
                return;
            }
            const suffix = failed.length > 0 ? ` (실패 ${failed.length}개: ${failed.join(', ')})` : '';
            UI.showMessage('editorSong', `파일 ${files.length}개에서 난이도 ${totalBeatmaps}개를 불러왔습니다. 오디오는 따로 선택해주세요.${suffix}`);
        });
    },

    // ── Phase 3d/4d: 클라우드 업로드 ────────────────────────────────────
    // 신규 노래(song.cloudSongId 없음)면 CloudCharts.uploadSong으로 노래+오디오를 먼저 만들고,
    // 기존 노래면 오디오는 건드리지 않는다. 그 다음 두 종류의 난이도를 처리한다:
    //   - 아직 안 올라간(cloudChartId 없는) 난이도 → addBeatmapToSong으로 신규 추가
    //   - 이미 올라갔지만 이름변경/편집 후 손대지 않은(cloudChartId 있고 _cloudDirty === true) 난이도
    //     → updateBeatmap으로 메타(+ 편집 화면을 열었다면 notes/triggers까지) 갱신
    async uploadToCloud() {
        try {
            const user = await CloudAuth.getUser();
            if (!user) {
                UI.showMessage('editorSong', '로그인이 필요합니다. 우측 상단 계정 아이콘을 클릭해주세요.');
                return;
            }
            if (!(Editor.state.song.title || '').trim()) {
                UI.showMessage('editorSong', '노래 제목을 입력해주세요.');
                return;
            }
            const pendingBeatmaps = Editor.state.beatmaps.filter(bm => !bm.cloudChartId);
            const dirtyBeatmaps = Editor.state.beatmaps.filter(bm => bm.cloudChartId && bm._cloudDirty);
            if (!Editor.state.song.cloudSongId && !Editor.state.song.audioFileObject) {
                // 신규 노래 업로드 — 오디오 필수
                UI.showMessage('editorSong', '먼저 오디오 파일을 선택해주세요.');
                return;
            }
            // 난이도 변경사항이 없어도, 이미 클라우드에 있는 노래라면 제목/가수/미리듣기 시작 시각이
            // 바뀌었을 수 있으니 아래로 계속 진행해서 노래 메타는 항상 갱신한다.
            const noBeatmapChanges = pendingBeatmaps.length === 0 && dirtyBeatmaps.length === 0;
            if (noBeatmapChanges && !Editor.state.song.cloudSongId) {
                UI.showMessage('editorSong', '이미 모든 난이도가 클라우드와 동기화되어 있습니다.');
                return;
            }

            if (DOM.editorSong.uploadCloudBtn) {
                DOM.editorSong.uploadCloudBtn.disabled = true;
                DOM.editorSong.uploadCloudBtn.textContent = '업로드 중…';
            }

            // 1) 노래 자체가 아직 클라우드에 없으면 먼저 생성
            const previewStartMs = Math.round((Editor.state.song.previewStartSec || 0) * 1000);
            const startOffsetMs = Math.round((Editor.state.song.startOffsetSec || 0) * 1000);
            const timingStartMs = Math.round((Editor.state.song.timingStartSec || 0) * 1000);
            if (!Editor.state.song.cloudSongId) {
                const { data, error } = await CloudCharts.uploadSong(
                    { title: Editor.state.song.title, artist: Editor.state.song.artist, preview_start_ms: previewStartMs, start_offset_ms: startOffsetMs, timing_start_ms: timingStartMs },
                    Editor.state.song.audioFileObject,
                    Editor.state.song.coverFileObject
                );
                if (error) {
                    UI.showMessage('editorSong', `노래 업로드 실패: ${error.message}`);
                    return;
                }
                Editor.state.song.cloudSongId = data.id;
            } else {
                // 이미 클라우드에 있는 노래면 제목/가수/미리듣기 시작 시각/시작(초)/타이밍 시작(초)/커버 이미지(고른 경우)만 갱신해준다.
                const { error: metaErr } = await CloudCharts.updateSongMeta(Editor.state.song.cloudSongId, {
                    title: Editor.state.song.title,
                    artist: Editor.state.song.artist,
                    preview_start_ms: previewStartMs,
                    start_offset_ms: startOffsetMs,
                    timing_start_ms: timingStartMs,
                }, Editor.state.song.coverFileObject);
                if (metaErr) {
                    UI.showMessage('editorSong', `노래 정보 갱신 실패: ${metaErr.message}`);
                    return;
                }
            }

            // 2) 아직 안 올라간 난이도들을 순서대로 신규 추가
            let addedCount = 0;
            let failure = null;
            for (const bm of pendingBeatmaps) {
                const chartData = {
                    bpm: bm.bpm,
                    startTimeOffset: bm.startTimeOffset,
                    fallSpeed: bm.fallSpeed,
                    laneCount: bm.laneCount,
                    notes: bm.notes || [],
                    noteSpeed: bm.fallSpeed,
                    triggers: bm.triggers || [],
                };
                const meta = {
                    difficulty_label: bm.difficultyLabel,
                    lane_count: bm.laneCount,
                    bpm: bm.bpm,
                };
                const { data, error } = await CloudCharts.addBeatmapToSong(Editor.state.song.cloudSongId, meta, chartData);
                if (error) {
                    failure = { label: bm.difficultyLabel, message: error.message };
                    break;
                }
                bm.cloudChartId = data.id;
                bm.updatedAt = data.updated_at || new Date().toISOString();
                addedCount++;
            }

            // 3) 이미 올라갔지만 이름변경/편집으로 바뀐 난이도들을 갱신
            //    (1)에서 실패했다면 굳이 더 진행하지 않고 여기서 멈춘다.
            let updatedCount = 0;
            if (!failure) {
                for (const bm of dirtyBeatmaps) {
                    const meta = {
                        difficulty_label: bm.difficultyLabel,
                        lane_count: bm.laneCount,
                        bpm: bm.bpm,
                    };
                    // 편집 화면을 열어 notes/triggers를 갖고 있는 상태(_loaded !== false)일 때만
                    // 차트 데이터도 같이 보낸다. 이름변경만 했다면 메타만 보내 기존 노트를 보존한다.
                    const chartData = bm._loaded === false ? null : {
                        bpm: bm.bpm,
                        startTimeOffset: bm.startTimeOffset,
                        fallSpeed: bm.fallSpeed,
                        laneCount: bm.laneCount,
                        notes: bm.notes || [],
                        triggers: bm.triggers || [],
                    };
                    const { data, error } = await CloudCharts.updateBeatmap(bm.cloudChartId, meta, chartData);
                    if (error) {
                        failure = { label: bm.difficultyLabel, message: error.message };
                        break;
                    }
                    bm._cloudDirty = false;
                    bm.updatedAt = data?.updated_at || new Date().toISOString();
                    updatedCount++;
                }
            }

            this.render();
            if (failure) {
                // 실패 전에 일부는 성공했을 수 있으니 진행 상황도 같이 알려준다.
                const progressParts = [];
                if (addedCount > 0) progressParts.push(`신규 ${addedCount}개`);
                if (updatedCount > 0) progressParts.push(`수정 ${updatedCount}개`);
                const progressNote = progressParts.length > 0 ? ` (이전에 ${progressParts.join(', ')} 성공)` : '';
                UI.showMessage('editorSong', `"${failure.label}" 업로드 실패: ${failure.message}${progressNote}`);
            } else {
                const parts = [];
                if (addedCount > 0) parts.push(`신규 ${addedCount}개`);
                if (updatedCount > 0) parts.push(`수정 ${updatedCount}개`);
                UI.showMessage('editorSong', parts.length > 0
                    ? `클라우드에 ${parts.join(', ')} 반영했습니다.`
                    : '노래 정보(제목/가수/미리듣기 시작 시각)를 갱신했습니다.');
            }
        } catch (err) {
            Debugger.logError(err, 'EditorSong.uploadToCloud');
            UI.showMessage('editorSong', `업로드 중 오류: ${err.message}`);
        } finally {
            if (DOM.editorSong.uploadCloudBtn) {
                DOM.editorSong.uploadCloudBtn.disabled = false;
                DOM.editorSong.uploadCloudBtn.textContent = '☁ 클라우드에 업로드';
            }
        }
    },
};