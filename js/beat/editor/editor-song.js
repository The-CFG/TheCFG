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
            const cloudBadge = bm.cloudChartId ? ' ☁' : '';
            label.textContent = `${bm.difficultyLabel || '기본'}${cloudBadge}`;
            const meta = document.createElement('p');
            meta.className = 'text-xs text-gray-400';
            const noteCountLabel = bm._loaded === false ? '노트 —' : `노트 ${(bm.notes || []).length}개`;
            meta.textContent = `${bm.laneCount || 4}레인 · BPM ${bm.bpm || 120} · ${noteCountLabel}`;
            info.append(label, meta);

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

    // 오디오는 노래(song) 단위로 한 번만 고르면 모든 난이도가 공유해서 쓴다.
    handleAudioSelect(file) {
        if (!file) return;
        Editor.state.song.audioFileObject = file;
        Editor.state.song.audioFileName = file.name;
        if (DOM.editorSong.audioNameEl) DOM.editorSong.audioNameEl.textContent = file.name;
        // 실제 AudioEngine 로드는 비트맵 창 진입 시(Editor.loadBeatmapIntoFlatState)로 미룬다.
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

    loadLocalFile(file) {
        if (!file) return;
        if (Editor.state.beatmaps.length > 0 &&
            !confirm('현재 작업 중인 노래가 있습니다. 불러오면 저장하지 않은 내용은 사라집니다. 계속할까요?')) {
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const raw = JSON.parse(e.target.result);
                const normalized = ChartFormat.normalizeAll(raw);
                Editor.resetSongState();
                Editor.state.song.title = normalized.songName;
                Editor.state.song.artist = normalized.artist || '';
                Editor.state.beatmaps = normalized.beatmaps.map(bm => ({ ...bm, cloudChartId: null }));
                Editor.state.activeBeatmapIndex = 0;
                this.render();
                UI.showMessage('editorSong', `${normalized.beatmaps.length}개 난이도를 불러왔습니다. 오디오는 따로 선택해주세요.`);
            } catch (err) {
                Debugger.logError(err, 'EditorSong.loadLocalFile');
                UI.showMessage('editorSong', `차트 해석 오류: ${err.message}`);
            }
        };
        reader.readAsText(file);
    },

    // ── Phase 3d: 클라우드 업로드 ─────────────────────────────────────
    // 신규 노래(song.cloudSongId 없음)면 CloudCharts.uploadSong으로 노래+오디오를 먼저 만들고,
    // 기존 노래면 오디오는 건드리지 않고 아직 안 올라간(cloudChartId 없는) 난이도들만
    // addBeatmapToSong으로 추가한다. 이미 클라우드에 올라간 난이도(수정분 포함)는 이번 단계에서
    // 갱신하지 않는다 — 난이도 수정 반영은 이후 단계 과제로 남겨둔다.
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
            if (!Editor.state.song.cloudSongId && !Editor.state.song.audioFileObject) {
                // 신규 노래 업로드 — 오디오 필수
                UI.showMessage('editorSong', '먼저 오디오 파일을 선택해주세요.');
                return;
            }
            if (pendingBeatmaps.length === 0) {
                UI.showMessage('editorSong', '이미 모든 난이도가 클라우드에 업로드되어 있습니다.');
                return;
            }

            if (DOM.editorSong.uploadCloudBtn) {
                DOM.editorSong.uploadCloudBtn.disabled = true;
                DOM.editorSong.uploadCloudBtn.textContent = '업로드 중…';
            }

            // 1) 노래 자체가 아직 클라우드에 없으면 먼저 생성
            if (!Editor.state.song.cloudSongId) {
                const { data, error } = await CloudCharts.uploadSong(
                    { title: Editor.state.song.title, artist: Editor.state.song.artist },
                    Editor.state.song.audioFileObject
                );
                if (error) {
                    UI.showMessage('editorSong', `노래 업로드 실패: ${error.message}`);
                    return;
                }
                Editor.state.song.cloudSongId = data.id;
            }

            // 2) 아직 안 올라간 난이도들을 순서대로 추가
            let uploadedCount = 0;
            let failure = null;
            for (const bm of pendingBeatmaps) {
                const chartData = {
                    bpm: bm.bpm,
                    startTimeOffset: bm.startTimeOffset,
                    laneCount: bm.laneCount,
                    notes: bm.notes || [],
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
                uploadedCount++;
            }

            this.render();
            if (failure) {
                // 실패 전에 일부는 성공했을 수 있으니 진행 상황도 같이 알려준다.
                const progressNote = uploadedCount > 0 ? ` (이전 ${uploadedCount}개는 성공)` : '';
                UI.showMessage('editorSong', `"${failure.label}" 업로드 실패: ${failure.message}${progressNote}`);
            } else {
                UI.showMessage('editorSong', `클라우드에 난이도 ${uploadedCount}개를 업로드했습니다.`);
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