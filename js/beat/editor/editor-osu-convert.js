/**
 * EditorOsuConvert
 * ----------------
 * 에디터 홈의 "🧪 베타 - .osu 파일 변환하기" 버튼으로 들어가는 osu-convert-screen을 다룬다.
 *
 * - OsuImport.parse()(js/beat/editor/osu-import.js, 순수 변환 함수)로 .osu 텍스트를
 *   TheBeat v2 차트 포맷으로 바꾼다. 파일을 고르는 즉시(별도 "변환" 버튼 없이) 전부 파싱해서
 *   카드로 나열하고, 실패한 파일은 에러 메시지만 보여준 채 나머지는 계속 진행한다.
 * - 카드별 "JSON 다운로드"는 changer.py가 만들던 것과 동일한 결과물을 브라우저에서 바로 받는다.
 * - 성공한 카드마다 대상 난이도 선택 드롭다운이 붙는다: 현재 작업 중인 노래(Editor.state.beatmaps)의
 *   기존 난이도 중 하나를 골라 "덮어쓰기"하거나, "+ 새 난이도 만들기"를 골라 신규 추가할 수 있다.
 *   덮어쓰기를 고르면 대상 난이도의 cloudChartId/chartStoragePath는 그대로 유지하고 notes/triggers/
 *   laneCount/bpm/fallSpeed만 osu 데이터로 교체한다 — 이미 서버에 올라간 난이도라면 _cloudDirty를
 *   세워서 다음 저장 때 같은 서버 채보가 갱신되게 한다(신규 채보로 따로 안 만들어짐).
 *   기본 선택값은 파일의 difficultyLabel과 이름이 같은 기존 난이도가 있으면 그걸로, 없으면
 *   "+ 새 난이도 만들기"로 잡는다.
 *   osu-import 자체는 fallSpeed를 정하지 않으므로(=BPM 기반 자동 계산), 여기서는 화면의
 *   하강속도 슬라이더 값을 가져온 모든 난이도에 일괄 적용한다.
 */
const EditorOsuConvert = {
    // { fileName, success, data, error, targetIndex }[]
    // data는 OsuImport.parse()의 반환값 그대로(formatVersion 2, beatmaps 1개).
    // targetIndex: 'new'(새 난이도) 또는 Editor.state.beatmaps의 인덱스(그 난이도를 덮어씀). 성공한 카드에만 있음.
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
                    return { fileName: file.name, success: true, data, targetIndex: this._defaultTarget(data) };
                } catch (err) {
                    return { fileName: file.name, success: false, error: err.message };
                }
            });
            this._render();
        });
    },

    // difficultyLabel이 현재 작업 중인 노래의 기존 난이도와 이름이 같으면 그 인덱스를,
    // 아니면 'new'(새 난이도 만들기)를 기본값으로 잡는다.
    _defaultTarget(data) {
        const label = data.beatmaps[0]?.difficultyLabel || '';
        const beatmaps = Editor.state.beatmaps || [];
        const idx = beatmaps.findIndex(bm => bm.difficultyLabel === label);
        return idx >= 0 ? idx : 'new';
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

                // 대상 난이도 선택: 현재 작업 중인 노래의 기존 난이도를 덮어쓰거나, 새 난이도로 추가.
                const targetLabel = document.createElement('p');
                targetLabel.className = 'text-xs text-gray-500 mt-1';
                targetLabel.textContent = '이 osu 채보로 덮어씌울 난이도를 선택하세요.';
                info.appendChild(targetLabel);

                const select = document.createElement('select');
                select.className = 'mt-1 w-full text-xs bg-gray-700 border border-gray-600 rounded px-1 py-1';
                const newOpt = document.createElement('option');
                newOpt.value = 'new';
                newOpt.textContent = '+ 새 난이도 만들기';
                select.appendChild(newOpt);
                (Editor.state.beatmaps || []).forEach((existingBm, bmIndex) => {
                    const opt = document.createElement('option');
                    opt.value = String(bmIndex);
                    const cloudBadge = existingBm.cloudChartId ? ' ☁' : '';
                    opt.textContent = `${bmIndex + 1}. ${existingBm.difficultyLabel}${cloudBadge}`;
                    select.appendChild(opt);
                });
                select.value = result.targetIndex === 'new' ? 'new' : String(result.targetIndex);
                select.addEventListener('change', (e) => {
                    const v = e.target.value;
                    result.targetIndex = v === 'new' ? 'new' : parseInt(v, 10);
                });
                info.appendChild(select);

                const dlBtn = document.createElement('button');
                dlBtn.type = 'button';
                dlBtn.textContent = 'JSON 다운로드';
                dlBtn.className = 'py-1 px-2 text-xs rounded whitespace-nowrap bg-blue-600 hover:bg-blue-500 flex-shrink-0 self-start';
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

    // 성공한 결과들을 각자 고른 대상(targetIndex)에 따라 처리한다.
    //   'new'  → Editor.state.beatmaps에 새 난이도로 추가
    //   숫자   → 해당 인덱스의 기존 난이도를 덮어씀 (cloudChartId 등 서버 연결 정보는 유지)
    // 작업 중인 노래가 없을 때(처음 진입)는 첫 성공 파일의 노래 메타(제목/가수)를 그대로 채택한다.
    importAsNewSong() {
        const succeeded = this._results.filter(r => r.success);
        if (succeeded.length === 0) return;

        const overwriteCount = succeeded.filter(r => r.targetIndex !== 'new').length;
        if (overwriteCount > 0 &&
            !confirm(`기존 난이도 ${overwriteCount}개를 osu 채보로 덮어씁니다. 저장하지 않은 편집 내용은 사라집니다. 계속할까요?`)) {
            return;
        }

        const fallSpeed = parseFloat(DOM.osuConvert.fallSpeedSlider?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
        const isFreshSong = Editor.state.beatmaps.length === 0;

        if (isFreshSong) {
            Editor.resetSongState();
        }

        let songMetaSet = !isFreshSong; // 이미 노래가 열려 있으면 메타는 건드리지 않는다.
        let firstAffectedIndex = null;

        succeeded.forEach(({ data, targetIndex }) => {
            if (!songMetaSet) {
                Editor.state.song.title = data.songName || '';
                Editor.state.song.artist = data.artist || '';
                songMetaSet = true;
            }
            const [parsedBm] = data.beatmaps;

            if (targetIndex === 'new' || targetIndex === undefined || !Editor.state.beatmaps[targetIndex]) {
                Editor.state.beatmaps.push({ ...parsedBm, fallSpeed, cloudChartId: null });
                if (firstAffectedIndex === null) firstAffectedIndex = Editor.state.beatmaps.length - 1;
            } else {
                // 덮어쓰기: 대상 난이도의 이름/서버 연결 정보(cloudChartId, chartStoragePath)는 유지하고
                // 채보 내용(레인 수/BPM/노트/트리거/하강속도)만 osu 데이터로 교체한다.
                const target = Editor.state.beatmaps[targetIndex];
                target.laneCount = parsedBm.laneCount;
                target.bpm = parsedBm.bpm;
                target.startTimeOffset = parsedBm.startTimeOffset;
                target.notes = parsedBm.notes;
                target.triggers = parsedBm.triggers;
                target.fallSpeed = fallSpeed;
                target._loaded = true;
                if (target.cloudChartId) target._cloudDirty = true;
                if (firstAffectedIndex === null) firstAffectedIndex = targetIndex;
            }
        });

        if (firstAffectedIndex !== null &&
            (Editor.state.activeBeatmapIndex >= Editor.state.beatmaps.length || isFreshSong)) {
            Editor.state.activeBeatmapIndex = firstAffectedIndex;
        }

        UI.showScreen('editorSong');
        EditorSong.render();
        const newCount = succeeded.length - overwriteCount;
        const parts = [];
        if (newCount > 0) parts.push(`새 난이도 ${newCount}개 추가`);
        if (overwriteCount > 0) parts.push(`기존 난이도 ${overwriteCount}개 덮어씀`);
        UI.showMessage('editorSong', `.osu 파일 ${succeeded.length}개 처리 완료 (${parts.join(', ')}). 오디오는 따로 선택해주세요.`);
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorOsuConvert;
}