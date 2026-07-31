/**
 * EditorSong
 * ----------
 * 종합 창(노래 단위로 제목/가수/오디오와 난이도 목록을 관리하는 화면)의 로컬 기능을 다룬다.
 *
 * - 새 노래 만들기: Editor.state.song / beatmaps를 초기화하고 빈 난이도 1개로 시작
 * - 난이도 카드 목록: 추가 / 이름변경 / 복제 / 삭제 / 편집(비트맵 창 진입)
 * - 로컬 파일로 저장(ChartFormat.wrapAll) / 불러오기(ChartFormat.normalizeAll)
 *
 * 클라우드 연동(내 노래 목록 / 업로드)은 Phase 3d에서 추가 예정. 지금은 로컬에서만 완결된다.
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
            label.textContent = bm.difficultyLabel || '기본';
            const meta = document.createElement('p');
            meta.className = 'text-xs text-gray-400';
            meta.textContent = `${bm.laneCount || 4}레인 · BPM ${bm.bpm || 120} · 노트 ${(bm.notes || []).length}개`;
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

    duplicateBeatmap(index) {
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        const copy = JSON.parse(JSON.stringify(bm));
        copy.cloudChartId = null;
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
        if (!confirm(`"${bm.difficultyLabel || '기본'}" 난이도를 삭제할까요? 되돌릴 수 없습니다.`)) return;
        Editor.state.beatmaps.splice(index, 1);
        if (Editor.state.activeBeatmapIndex >= Editor.state.beatmaps.length) {
            Editor.state.activeBeatmapIndex = Editor.state.beatmaps.length - 1;
        }
        this.render();
    },

    // 비트맵 창으로 들어가서 이 난이도를 편집한다.
    editBeatmap(index) {
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
    saveLocal() {
        try {
            if (Editor.state.beatmaps.length === 0) {
                UI.showMessage('editorSong', '저장할 난이도가 없습니다.');
                return;
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
};