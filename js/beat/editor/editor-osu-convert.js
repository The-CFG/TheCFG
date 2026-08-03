/**
 * EditorOsuConvert
 * ----------------
 * 에디터 홈의 "🧪 베타 - .osu 파일 변환하기" 버튼으로 들어가는 osu-convert-screen을 다룬다.
 *
 * - OsuImport.parse()(js/beat/editor/osu-import.js, 순수 변환 함수)로 .osu 텍스트를
 *   TheBeat v2 차트 포맷으로 바꾼다. 파일을 고르는 즉시(별도 "변환" 버튼 없이) 전부 파싱해서
 *   카드로 나열하고, 실패한 파일은 에러 메시지만 보여준 채 나머지는 계속 진행한다.
 * - 카드별 "JSON 다운로드"는 changer.py가 만들던 것과 동일한 결과물을 브라우저에서 바로 받는다.
 * - "새 노래로 가져오기"는 성공한 결과들의 beatmaps를 전부 합쳐 Editor.state에 넣고 종합 창
 *   (editorSong)으로 이동한다 — EditorSong.loadLocalFiles()와 동일한 병합 정책(노래 메타는 첫
 *   성공 파일 것을 채택, 오디오는 이 화면에서 받지 않으므로 종합 창에서 따로 선택해야 함).
 *   osu-import 자체는 fallSpeed를 정하지 않으므로(=BPM 기반 자동 계산), 여기서는 화면의
 *   하강속도 슬라이더 값을 가져온 모든 난이도에 일괄 적용한다.
 */
const EditorOsuConvert = {
    // { fileName, success, data, error }[]
    // data는 OsuImport.parse()의 반환값 그대로(formatVersion 2, beatmaps 1개).
    _results: [],

    // 화면 진입 시(에디터 홈에서 버튼 클릭)마다 이전 결과를 비우고 새로 시작한다.
    reset() {
        this._results = [];
        this._render();
        if (DOM.osuConvert.fileInput) DOM.osuConvert.fileInput.value = '';
        if (DOM.osuConvert.fallSpeedSlider) {
            DOM.osuConvert.fallSpeedSlider.value = CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
        }
        if (DOM.osuConvert.fallSpeedValue) {
            DOM.osuConvert.fallSpeedValue.textContent = CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
        }
    },

    onFallSpeedInput(value) {
        if (DOM.osuConvert.fallSpeedValue) DOM.osuConvert.fallSpeedValue.textContent = value;
    },

    // 파일 선택 즉시(변환 버튼 없이) 전부 파싱한다. 여러 파일 중 일부가 실패해도 나머지는 계속 진행.
    handleFiles(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;

        const readAsText = (file) => new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve({ file, text: e.target.result, readError: null });
            reader.onerror = () => resolve({ file, text: null, readError: '파일을 읽을 수 없습니다.' });
            reader.readAsText(file);
        });

        Promise.all(files.map(readAsText)).then((reads) => {
            this._results = reads.map(({ file, text, readError }) => {
                if (readError) {
                    return { fileName: file.name, success: false, error: readError };
                }
                try {
                    const data = OsuImport.parse(text, file.name);
                    return { fileName: file.name, success: true, data };
                } catch (err) {
                    return { fileName: file.name, success: false, error: err.message };
                }
            });
            this._render();
        });
    },

    _render() {
        const container = DOM.osuConvert.resultList;
        if (!container) return;
        container.innerHTML = '';

        if (this._results.length === 0) {
            const p = document.createElement('p');
            p.className = 'text-gray-400 text-sm text-center mt-8';
            p.textContent = '.osu 파일을 선택하면 여기 결과가 표시됩니다.';
            container.appendChild(p);
            if (DOM.osuConvert.importBtn) DOM.osuConvert.importBtn.disabled = true;
            return;
        }

        this._results.forEach((result, i) => {
            const card = document.createElement('div');
            card.className = result.success
                ? 'p-3 bg-gray-800 rounded-lg flex items-center justify-between gap-2'
                : 'p-3 bg-gray-800 border border-red-700 rounded-lg flex items-center justify-between gap-2';

            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';
            const name = document.createElement('p');
            name.className = 'font-semibold truncate';
            name.textContent = result.fileName;
            info.appendChild(name);

            if (result.success) {
                const bm = result.data.beatmaps[0];
                const meta = document.createElement('p');
                meta.className = 'text-xs text-gray-400 truncate';
                const titleArtist = [result.data.songName, result.data.artist].filter(Boolean).join(' - ');
                meta.textContent = `${titleArtist || '(제목 없음)'} · ${bm.difficultyLabel} · ${bm.laneCount}레인 · BPM ${bm.bpm} · 노트 ${(bm.notes || []).length}개`;
                info.appendChild(meta);

                const dlBtn = document.createElement('button');
                dlBtn.type = 'button';
                dlBtn.textContent = 'JSON 다운로드';
                dlBtn.className = 'py-1 px-2 text-xs rounded whitespace-nowrap bg-blue-600 hover:bg-blue-500 flex-shrink-0';
                dlBtn.addEventListener('click', () => this._downloadJson(i));

                card.append(info, dlBtn);
            } else {
                const err = document.createElement('p');
                err.className = 'text-xs text-red-400 truncate';
                err.textContent = result.error;
                info.appendChild(err);
                card.appendChild(info);
            }

            container.appendChild(card);
        });

        const successCount = this._results.filter(r => r.success).length;
        if (DOM.osuConvert.importBtn) DOM.osuConvert.importBtn.disabled = successCount === 0;
    },

    _downloadJson(index) {
        const result = this._results[index];
        if (!result || !result.success) return;
        const filename = (result.fileName || 'untitled').replace(/\.osu$/i, '');
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.data, null, 2));
        const a = document.createElement('a');
        a.setAttribute('href', dataStr);
        a.setAttribute('download', `${filename}.json`);
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    // 성공한 결과들의 beatmaps를 전부 합쳐 Editor.state에 넣고 종합 창으로 이동한다.
    importAsNewSong() {
        const succeeded = this._results.filter(r => r.success);
        if (succeeded.length === 0) return;

        if (Editor.state.beatmaps.length > 0 &&
            !confirm('현재 작업 중인 노래가 있습니다. 가져오면 저장하지 않은 내용은 사라집니다. 계속할까요?')) {
            return;
        }

        const fallSpeed = parseFloat(DOM.osuConvert.fallSpeedSlider?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;

        Editor.resetSongState();
        let songMetaSet = false;
        succeeded.forEach(({ data }) => {
            if (!songMetaSet) {
                Editor.state.song.title = data.songName || '';
                Editor.state.song.artist = data.artist || '';
                songMetaSet = true;
            }
            const newBeatmaps = data.beatmaps.map(bm => ({ ...bm, fallSpeed, cloudChartId: null }));
            Editor.state.beatmaps.push(...newBeatmaps);
        });
        Editor.state.activeBeatmapIndex = 0;

        UI.showScreen('editorSong');
        EditorSong.render();
        UI.showMessage('editorSong', `.osu 파일 ${succeeded.length}개에서 난이도를 가져왔습니다. 오디오는 따로 선택해주세요.`);
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorOsuConvert;
}