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
    // 드래그로 난이도 순서를 바꾸는 동안, 드래그를 시작한 카드의 인덱스를 잠깐 들고 있는다.
    _dragFromIndex: null,

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

    // 공동 작업 도입 — 내가 이 노래에서 'viewer'면 편집 관련 UI를 전부 잠근다.
    // (편집자/소유자는 평소와 동일하게 전부 활성화)
    _isReadOnly() {
        return Editor.state.song.myRole === 'viewer';
    },

    // 현재 Editor.state를 기준으로 종합 창을 다시 그린다. 화면 진입/변경마다 호출.
    render() {
        const song = Editor.state.song;
        const readOnly = this._isReadOnly();

        if (DOM.editorSong.readonlyBanner) {
            DOM.editorSong.readonlyBanner.classList.toggle('hidden', !readOnly);
        }

        if (DOM.editorSong.titleInput) DOM.editorSong.titleInput.value = song.title || '';
        if (DOM.editorSong.artistInput) DOM.editorSong.artistInput.value = song.artist || '';
        this._renderSourcePanels();
        if (DOM.editorSong.audioNameEl) {
            DOM.editorSong.audioNameEl.textContent = song.audioFileObject
                ? song.audioFileName
                : (song.audioUrl ? `${song.audioFileName || '원본 음악'} (서버에서 자동 로드됨)` : '선택된 파일 없음');
        }
        if (DOM.editorSong.coverNameEl) {
            DOM.editorSong.coverNameEl.textContent = song.coverFileObject
                ? song.coverFileName
                : (song.coverUrl ? `${song.coverFileName || '커버 이미지'} (서버에서 자동 로드됨)` : '선택된 파일 없음 (선택)');
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
        if (DOM.editorSong.cloudStatusEl) {
            if (!song.cloudSongId) {
                DOM.editorSong.cloudStatusEl.textContent = '아직 서버에 저장되지 않음';
            } else if (song.isPublic) {
                DOM.editorSong.cloudStatusEl.replaceChildren(Icon.el('globe'), ' 라이브러리에 공개됨');
            } else {
                DOM.editorSong.cloudStatusEl.replaceChildren(Icon.el('lock'), ' 서버에 비공개로 저장됨');
            }
        }

        // 메타 편집 폼 + 파일 선택 + 클라우드 저장 버튼 + 새 난이도 추가 버튼을 잠근다.
        [
            DOM.editorSong.titleInput, DOM.editorSong.artistInput,
            DOM.editorSong.previewStartInput, DOM.editorSong.startTimeInput, DOM.editorSong.timingStartInput,
            DOM.editorSong.audioFileInput, DOM.editorSong.coverFileInput,
            DOM.editorSong.ytOffsetInput, DOM.editorSong.declaredCheck, DOM.editorSong.termsCheck,
            DOM.editorSong.uploadCloudBtn, DOM.editorSong.saveDraftBtn,
            DOM.editorSong.addBeatmapBtn,
        ].forEach(el => { if (el) el.disabled = readOnly; });

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
            card.className = 'p-3 bg-gray-800 rounded-lg flex items-center gap-2';
            card.dataset.index = String(i);

            // 순서 조정용 드래그 핸들(점 6개). 라이브러리의 난이도 선택란에 표시될 순서는
            // 이 목록의 순서(=Editor.state.beatmaps 배열 순서)를 그대로 따른다.
            // 뷰어는 순서를 저장할 수 없으므로(저장 버튼 자체가 잠김) 핸들도 안 보여준다.
            if (!this._isReadOnly()) card.appendChild(this._makeDragHandle(i));

            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';
            const label = document.createElement('p');
            label.className = 'font-semibold truncate';
            label.textContent = `${bm.difficultyLabel || '기본'}`;
            if (bm.cloudChartId) {
                if (bm._cloudDirty) label.append(' ', Icon.el('cloud'), '·수정됨');
                else label.append(' ', Icon.el(Editor.state.song.isPublic ? 'globe' : 'lock'));
            }
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
            const readOnly = this._isReadOnly();
            btns.appendChild(this._makeBtn(readOnly ? '보기' : '편집', 'bg-teal-600 hover:bg-teal-500', () => this.editBeatmap(i)));
            if (!readOnly) {
                btns.append(
                    this._makeBtn('복제', 'bg-gray-600 hover:bg-gray-500', () => this.duplicateBeatmap(i)),
                    this._makeBtn('이름변경', 'bg-gray-600 hover:bg-gray-500', () => this.renameBeatmap(i)),
                    this._makeBtn('삭제', 'bg-red-700 hover:bg-red-600', () => this.deleteBeatmap(i)),
                );
            }

            card.append(info, btns);
            this._wireDragEvents(card);
            container.appendChild(card);
        });
    },

    // 드래그 핸들(점 6개 아이콘) — 카드 왼쪽에 붙여서 이 핸들을 잡고 끌 때만 드래그가 시작되게 한다.
    _makeDragHandle(index) {
        const handle = document.createElement('div');
        handle.className = 'drag-handle flex-shrink-0 self-stretch flex items-center px-1 -ml-1 cursor-grab text-gray-500 hover:text-gray-300';
        handle.draggable = true;
        handle.setAttribute('aria-label', '난이도 순서 변경 핸들');
        handle.title = '끌어서 순서 변경';
        handle.innerHTML = `
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
                <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
            </svg>`;
        handle.addEventListener('dragstart', (e) => {
            this._dragFromIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            // 드래그 중인 카드가 반투명해지도록(핸들이 아니라 카드 전체에 표시)
            requestAnimationFrame(() => handle.closest('[data-index]')?.classList.add('opacity-50'));
        });
        handle.addEventListener('dragend', () => {
            this._dragFromIndex = null;
            DOM.editorSong.beatmapList?.querySelectorAll('[data-index]').forEach(el => {
                el.classList.remove('opacity-50', 'ring-2', 'ring-teal-500');
            });
        });
        return handle;
    },

    // 카드(드롭 대상) 쪽 dragover/drop을 연결한다.
    _wireDragEvents(card) {
        card.addEventListener('dragover', (e) => {
            if (this._dragFromIndex === null || this._dragFromIndex === undefined) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('ring-2', 'ring-teal-500');
        });
        card.addEventListener('dragleave', () => {
            card.classList.remove('ring-2', 'ring-teal-500');
        });
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('ring-2', 'ring-teal-500');
            const from = this._dragFromIndex;
            const to = Number(card.dataset.index);
            this._dragFromIndex = null;
            if (from === null || from === undefined || Number.isNaN(to) || from === to) return;
            this.moveBeatmap(from, to);
        });
    },

    // 난이도 카드를 fromIndex에서 toIndex 위치로 옮긴다. 이 배열 순서가 로컬 저장(json)의
    // 난이도 순서이자, 클라우드 업로드 시 각 난이도의 sort_order로 그대로 저장되어 라이브러리의
    // 난이도 선택란 정렬(동일 레인 수 내에서는 sort_order 오름차순)에 반영된다.
    // 이미 클라우드에 올라간 난이도라도 위치가 바뀌면 다음 업로드 시 새 sort_order를
    // 보내야 하므로, 순서가 실제로 바뀐 구간(from~to)에 걸친 것들은 수정됨으로 표시한다.
    moveBeatmap(fromIndex, toIndex) {
        if (this._isReadOnly()) return;
        const list = Editor.state.beatmaps;
        if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
        const [moved] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, moved);

        const lo = Math.min(fromIndex, toIndex);
        const hi = Math.max(fromIndex, toIndex);
        for (let i = lo; i <= hi; i++) {
            if (list[i].cloudChartId) list[i]._cloudDirty = true;
        }

        const active = Editor.state.activeBeatmapIndex;
        if (active === fromIndex) {
            Editor.state.activeBeatmapIndex = toIndex;
        } else if (fromIndex < active && toIndex >= active) {
            Editor.state.activeBeatmapIndex = active - 1;
        } else if (fromIndex > active && toIndex <= active) {
            Editor.state.activeBeatmapIndex = active + 1;
        }

        this.render();
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
        if (this._isReadOnly()) return; // 뷰어 방어(버튼은 이미 disabled지만 다른 경로 호출 대비)
        const label = prompt('새 난이도 이름을 입력하세요.', `난이도 ${Editor.state.beatmaps.length + 1}`);
        if (label === null) return; // 취소
        const bm = Editor.createDefaultBeatmap(label.trim() || '기본');
        Editor.state.beatmaps.push(bm);
        this.editBeatmap(Editor.state.beatmaps.length - 1);
    },

    renameBeatmap(index) {
        if (this._isReadOnly()) return;
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        const label = prompt('난이도 이름을 입력하세요.', bm.difficultyLabel || '');
        if (label === null) return;
        bm.difficultyLabel = label.trim() || '기본';
        if (bm.cloudChartId) bm._cloudDirty = true; // 이미 올라간 난이도면 다음 업로드 시 메타를 다시 보내야 함
        this.render();
    },

    async duplicateBeatmap(index) {
        if (this._isReadOnly()) return;
        const bm = Editor.state.beatmaps[index];
        if (!bm) return;
        if (bm._loaded === false) {
            const ok = await Editor.ensureBeatmapLoaded(bm); // 로딩 표시는 ensureBeatmapLoaded 내부(좌측 game-area)에서 처리
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
        if (this._isReadOnly()) return;
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
            const ok = await Editor.ensureBeatmapLoaded(bm); // 로딩 표시는 ensureBeatmapLoaded 내부(좌측 game-area)에서 처리
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

    // ── 음원 소스 (YouTube / 내 파일 / 창작곡 업로드) ──────────────────────────
    // 약관 문구는 아직 미확정(계획서 7절) — 문구가 확정되면 이 버전 문자열을 올린다.
    TERMS_VERSION: 'draft-2026-11',
    _ytVerifiedId: null,    // 이 세션에서 '확인'(oEmbed + 길이 취득)을 통과한 영상 ID
    _ytPreviewing: false,

    // 공유 링크/영상 ID 문자열 → 11자 영상 ID (실패 시 null)
    parseYoutubeId(input) {
        const s = (input || '').trim();
        if (!s) return null;
        if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
        let u;
        try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch (e) { return null; }
        const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
        let id = null;
        if (host === 'youtu.be') {
            id = u.pathname.slice(1).split('/')[0];
        } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
            if (u.pathname === '/watch') id = u.searchParams.get('v');
            else {
                const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
                if (m) id = m[1];
            }
        }
        return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    },

    _formatDuration(ms) {
        const total = Math.round((ms || 0) / 1000);
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    },

    _setYtStatus(text, isError = false) {
        const el = DOM.editorSong.ytStatusEl;
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('text-red-400', !!isError);
        el.classList.toggle('text-gray-400', !isError);
    },

    // 소스 종류에 맞춰 패널/입력값/체크박스를 현재 state 기준으로 다시 그린다.
    _renderSourcePanels() {
        const song = Editor.state.song;
        const d = DOM.editorSong;
        const src = song.sourceType || 'youtube';
        const isCloud = !!song.cloudSongId;
        if (d.sourceSelect) {
            d.sourceSelect.value = src;
            d.sourceSelect.disabled = isCloud || this._isReadOnly(); // 이미 저장된 노래는 소스 종류를 바꾸지 않는다
        }
        if (d.ytPanel) d.ytPanel.classList.toggle('hidden', src !== 'youtube');
        if (d.filePanel) d.filePanel.classList.toggle('hidden', src === 'youtube');
        if (d.hostedTermsEl) d.hostedTermsEl.classList.toggle('hidden', !(src === 'hosted' && !isCloud));
        if (d.ytInput) {
            d.ytInput.value = song.youtubeId ? `https://youtu.be/${song.youtubeId}` : (d.ytInput.value || '');
            d.ytInput.disabled = this._isReadOnly(); // 저장된 곡도 영상 링크를 바꿀 수 있다 (소스 종류 변경은 계속 막음)
        }
        if (d.ytCheckBtn) d.ytCheckBtn.disabled = this._isReadOnly();
        if (d.ytOffsetInput) d.ytOffsetInput.value = (song.ytOffsetMs || 0) / 1000;
        if (d.declaredCheck) d.declaredCheck.checked = song.originalDeclared === true;
        if (d.termsCheck) d.termsCheck.checked = !!song.termsVersion;
        if (src === 'youtube') {
            if (song.youtubeId && song.ytDurationMs) {
                this._setYtStatus(`✔ 영상 ${song.youtubeId} · 길이 ${this._formatDuration(song.ytDurationMs)}`);
            } else if (song.youtubeId) {
                this._setYtStatus('아직 확인되지 않았습니다. "확인"을 눌러주세요.');
            } else {
                this._setYtStatus('');
            }
        }
        if (d.ytPreviewBtn) d.ytPreviewBtn.textContent = this._ytPreviewing ? '■ 정지' : '▶ 미리듣기';
    },

    onSourceChange(value) {
        if (this._isReadOnly() || Editor.state.song.cloudSongId) return;
        if (!['youtube', 'local', 'hosted'].includes(value)) return;
        const song = Editor.state.song;
        this.stopYtPreview();
        song.sourceType = value;
        if (value === 'youtube') {
            // 비트맵 창은 audioFileObject를 먼저 쓰므로, youtube에서는 비워두고 yt:ID를 재생 소스로 쓴다.
            song.audioFileObject = null;
            song.audioUrl = song.youtubeId ? `yt:${song.youtubeId}` : null;
            song.audioFileName = song.youtubeId ? `YouTube ${song.youtubeId}` : '';
            song.originalDeclared = false;
            song.termsVersion = null;
        } else {
            song.audioUrl = null; // 서버/YouTube 소스는 더 이상 쓰지 않음 — 파일을 직접 골라야 한다
            if (value !== 'hosted') { song.originalDeclared = false; song.termsVersion = null; }
        }
        this.render();
    },

    onYtInput(value) {
        if (this._isReadOnly()) return;
        const song = Editor.state.song;
        const id = this.parseYoutubeId(value);
        if (id !== song.youtubeId) {
            this.stopYtPreview();
            song.youtubeId = id;
            song.ytDurationMs = null;
            song.audioUrl = id ? `yt:${id}` : null;
            song.audioFileName = id ? `YouTube ${id}` : '';
            this._ytVerifiedId = null;
        }
        if (!value.trim()) this._setYtStatus('');
        else if (!id) this._setYtStatus('올바른 YouTube 링크 또는 영상 ID가 아닙니다.', true);
        else if (Editor.state.song.cloudSongId && id !== Editor.state.song.savedYoutubeId) this._setYtStatus('"확인"을 눌러 영상을 검증하세요. 영상을 바꾸면 오프셋도 새 영상에 맞게 다시 조정해야 합니다.');
        else this._setYtStatus('"확인"을 눌러 영상을 검증해주세요.');
    },

    onYtOffsetInput(value) {
        const sec = Math.max(0, parseFloat(value) || 0);
        Editor.state.song.ytOffsetMs = Math.round(sec * 1000);
        DOM.musicPlayer.ytOffsetMs = Editor.state.song.ytOffsetMs; // 에디터의 곡 시간 ↔ 영상 시간 변환에 즉시 반영
    },

    onHostedTermsChange({ declared, terms }) {
        const song = Editor.state.song;
        if (declared !== undefined) song.originalDeclared = declared === true;
        if (terms !== undefined) song.termsVersion = terms ? this.TERMS_VERSION : null;
    },

    // 영상 검증: ① oEmbed(삭제/비공개/임베드 금지 확인) ② IFrame API로 길이 취득
    async checkYoutube() {
        if (this._isReadOnly()) return;
        const song = Editor.state.song;
        const id = song.youtubeId;
        if (!id) { this._setYtStatus('올바른 YouTube 링크 또는 영상 ID가 아닙니다.', true); return; }

        const btn = DOM.editorSong.ytCheckBtn;
        if (btn) btn.disabled = true;
        this._setYtStatus('영상 확인 중…');
        try {
            // ① oEmbed — 404: 없는/비공개 영상, 401/403: 임베드 불가
            let info = null;
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 8000);
                const res = await fetch(
                    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
                    { signal: ctrl.signal });
                clearTimeout(timer);
                if (res.status === 404) throw new Error('영상을 찾을 수 없습니다 (삭제됨/비공개).');
                if (res.status === 401 || res.status === 403) throw new Error('이 영상은 임베드가 허용되지 않아 사용할 수 없습니다.');
                if (res.ok) info = await res.json();
            } catch (err) {
                if (err.name !== 'AbortError' && /영상/.test(err.message)) throw err;
                // 네트워크/시간 초과는 검증을 건너뛰고 ②에서 재생기로 한 번 더 확인한다
            }
            if (id !== song.youtubeId) return; // 확인 중 입력이 바뀜

            // ② 재생기로 로드해서 길이를 얻는다 (좌측 하단에 플레이어가 잠깐 보인다)
            this._setYtStatus('영상 길이 확인 중…');
            const durationMs = await this._probeYoutubeDuration(id);
            if (id !== song.youtubeId) return;

            song.ytDurationMs = durationMs;
            song.audioUrl = `yt:${id}`;
            song.audioFileName = `YouTube ${id}`;
            this._ytVerifiedId = id;
            if (info?.title && !(song.title || '').trim()) {
                song.title = info.title;
                if (DOM.editorSong.titleInput) DOM.editorSong.titleInput.value = info.title;
                if (DOM.editorSong.titleHeading) DOM.editorSong.titleHeading.textContent = info.title;
            }
            this._setYtStatus(`✔ ${info?.title ? info.title + ' · ' : ''}길이 ${this._formatDuration(durationMs)}`);
        } catch (err) {
            this._ytVerifiedId = null;
            song.ytDurationMs = null;
            this._setYtStatus(err.message || '영상을 확인하지 못했습니다.', true);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    // 플레이어를 yt:<ID>로 로드해서 길이(ms)를 읽는다. 에러/시간 초과면 throw.
    _probeYoutubeDuration(id) {
        return new Promise((resolve, reject) => {
            const player = DOM.musicPlayer;
            const prevMeta = player.onloadedmetadata;
            let done = false;
            const finish = (fn, val) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                player.removeEventListener('error', onErr);
                player.onloadedmetadata = prevMeta;
                try { player.pause(); } catch (e) { /* 무시 */ }
                fn(val);
            };
            const onErr = () => finish(reject, new Error(player.error?.message || '영상을 재생할 수 없습니다 (삭제/임베드 금지/지역 차단).'));
            const timer = setTimeout(() => finish(reject, new Error('영상 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')), 12000);
            player.addEventListener('error', onErr);
            player.onloadedmetadata = () => {
                const ms = Math.round((player.duration || 0) * 1000);
                if (ms > 0) finish(resolve, ms);
            };
            player.src = `yt:${id}`;
        });
    },

    // 오프셋 지점부터 재생해서 곡 시작 위치가 맞는지 귀로 확인한다.
    async toggleYtPreview() {
        const song = Editor.state.song;
        if (this._ytPreviewing) { this.stopYtPreview(); return; }
        if (!song.youtubeId) { this._setYtStatus('먼저 YouTube 링크를 입력해주세요.', true); return; }
        try {
            DOM.musicPlayer.ytOffsetMs = song.ytOffsetMs || 0;
            if (DOM.musicPlayer.src !== `yt:${song.youtubeId}`) {
                DOM.musicPlayer.src = `yt:${song.youtubeId}`;
            }
            const ready = await DOM.musicPlayer.whenReady();
            if (!ready) throw new Error('영상을 재생할 수 없습니다.');
            DOM.musicPlayer.currentTime = 0; // 곡 시간 0초 = 영상 오프셋 지점
            await DOM.musicPlayer.play();
            this._ytPreviewing = true;
        } catch (err) {
            this._ytPreviewing = false;
            this._setYtStatus(err.message || '미리듣기에 실패했습니다.', true);
        }
        if (DOM.editorSong.ytPreviewBtn) DOM.editorSong.ytPreviewBtn.textContent = this._ytPreviewing ? '■ 정지' : '▶ 미리듣기';
    },

    stopYtPreview() {
        if (this._ytPreviewing) { try { DOM.musicPlayer.pause(); } catch (e) { /* 무시 */ } }
        this._ytPreviewing = false;
        if (DOM.editorSong.ytPreviewBtn) DOM.editorSong.ytPreviewBtn.textContent = '▶ 미리듣기';
    },

    // local 곡의 파일 검증용 해시(SHA-256 hex). 실패하면 null.
    async _hashFile(file) {
        try {
            const buf = await file.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return null;
        }
    },

    // 오디오는 노래(song) 단위로 한 번만 고르면 모든 난이도가 공유해서 쓴다.
    handleAudioSelect(file) {
        if (!file) return;
        Editor.state.song.audioFileObject = file;
        Editor.state.song.audioFileName = file.name;
        Editor.state.song.audioUrl = null; // 새로 고른 로컬 파일이 우선이므로 서버 URL은 더 이상 쓰지 않음
        if (DOM.editorSong.audioNameEl) DOM.editorSong.audioNameEl.textContent = file.name;
        // 실제 AudioEngine 로드는 비트맵 창 진입 시(Editor.loadBeatmapIntoFlatState)로 미룬다.
    },

    // 노래 커버 이미지(선택) — 노래 선택 화면부터 결과 화면까지 왼쪽 game-area 배경으로 쓰인다.
    handleCoverSelect(file) {
        if (!file) return;
        Editor.state.song.coverFileObject = file;
        Editor.state.song.coverFileName = file.name;
        Editor.state.song.coverUrl = null; // 새로 고른 로컬 파일이 우선
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
                // 로딩 표시는 ensureBeatmapLoaded 내부(좌측 game-area)에서 각 난이도마다 처리
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

    // ── Phase 3d/4d/5a: 클라우드 저장 ────────────────────────────────────
    // publish: true면 "🌐 라이브러리에 공개"(공개 라이브러리에 노출), false면 "🔒 서버에 저장"
    // (미완성 작업물을 서버에만 보관 — 라이브러리에는 안 뜨고, 나중에 "에디터 홈"에서 다시 열 수 있음).
    // 두 동작 모두 결국 같은 beat_songs/beat_charts 행에 is_public만 다르게 써서 처리한다.
    //
    // 신규 노래(song.cloudSongId 없음)면 CloudCharts.uploadSong으로 노래+오디오를 먼저 만들고,
    // 기존 노래면 오디오는 건드리지 않는다. 그 다음 세 종류의 난이도를 처리한다:
    //   - 아직 안 올라간(cloudChartId 없는) 난이도 → addBeatmapToSong으로 신규 추가
    //   - 이미 올라갔지만 이름변경/편집 후 손대지 않은(cloudChartId 있고 _cloudDirty === true) 난이도
    //     → updateBeatmap으로 메타(+ 편집 화면을 열었다면 notes/triggers까지) 갱신
    //   - 편집은 안 했지만 지금 공개 여부(publish)만 이전과 달라진 난이도 → updateBeatmap으로
    //     메타(is_public)만 갱신 (예: 비공개로 저장해둔 걸 나중에 그대로 "라이브러리에 공개"할 때)
    // ── 낙관적 잠금(A안) 충돌 처리 ──────────────────────────────────────
    // updateSongMeta/updateBeatmap이 { error: { conflict: true } }를 반환하면 호출된다.
    // "다른 곳"이라고만 쓴 건 지금 단계(2단계)엔 아직 협업 멤버 기능이 없어서 — 본인이 다른
    // 탭/기기에서 먼저 저장한 경우도 똑같이 여기로 들어온다. 나중에 협업 기능이 붙어도
    // 문구는 그대로 써도 무방하다.
    _handleSaveConflict() {
        const reload = confirm(
            '다른 곳에서 이 사이 먼저 저장했습니다.\n' +
            '지금 저장하면 그 변경사항을 덮어쓰게 됩니다.\n\n' +
            '확인: 최신 내용을 새로 불러옵니다 (지금 화면의 변경사항은 사라집니다)\n' +
            '취소: 아무것도 하지 않습니다 (필요하면 직접 백업 후 다시 시도해주세요)'
        );
        if (reload) {
            Editor.reloadFromCloud();
        } else {
            UI.showMessage('editorSong', '저장하지 않았습니다. 최신 내용을 불러오려면 다시 시도해주세요.');
        }
    },

    async uploadToCloud(publish = true) {
        if (this._isReadOnly()) return; // 뷰어 방어(버튼은 이미 disabled)
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
            const isNewSong = !Editor.state.song.cloudSongId;
            const pendingBeatmaps = Editor.state.beatmaps.filter(bm => !bm.cloudChartId);
            const dirtyBeatmaps = Editor.state.beatmaps.filter(bm => bm.cloudChartId && bm._cloudDirty);
            // 공개 여부가 지금 이 클릭으로 바뀌는 경우(비공개↔공개 전환)에는, 편집 안 해서
            // _cloudDirty가 아닌 난이도들도 메타(is_public)만 다시 보내 노래와 상태를 맞춰준다.
            const publicStateChanged = !isNewSong && Editor.state.song.isPublic !== publish;
            const publicSyncBeatmaps = publicStateChanged
                ? Editor.state.beatmaps.filter(bm => bm.cloudChartId && !bm._cloudDirty)
                : [];
            const srcType = Editor.state.song.sourceType || 'hosted';
            if (isNewSong && srcType === 'youtube' && !Editor.state.song.youtubeId) {
                UI.showMessage('editorSong', '먼저 YouTube 링크를 입력해주세요.');
                return;
            }
            // 저장된 곡의 영상 링크/오프셋 변경 감지 (난이도 변경이 없어도 노래 메타로 저장해야 한다)
            const ytLinkChanged = !isNewSong && srcType === 'youtube' && Editor.state.song.youtubeId !== Editor.state.song.savedYoutubeId;
            const ytDirty = ytLinkChanged || (!isNewSong && srcType === 'youtube' && (Editor.state.song.ytOffsetMs || 0) !== (Editor.state.song.savedYtOffsetMs || 0));
            if (ytLinkChanged && !Editor.state.song.youtubeId) {
                UI.showMessage('editorSong', 'YouTube 링크를 입력해주세요.');
                return;
            }
            if (ytLinkChanged && this._ytVerifiedId !== Editor.state.song.youtubeId) {
                UI.showMessage('editorSong', '바뀐 YouTube 링크를 "확인"해서 영상이 사용 가능한지 검증해주세요.');
                return;
            }
            if (isNewSong && srcType === 'youtube' && this._ytVerifiedId !== Editor.state.song.youtubeId) {
                UI.showMessage('editorSong', 'YouTube 링크를 "확인"해서 영상이 사용 가능한지 검증해주세요.');
                return;
            }
            if (isNewSong && srcType !== 'youtube' && !Editor.state.song.audioFileObject) {
                // hosted/local — 편집·해시 계산에 오디오 파일이 필요 (local은 서버에 올리지 않음)
                UI.showMessage('editorSong', '먼저 오디오 파일을 선택해주세요.');
                return;
            }
            if (isNewSong && srcType === 'hosted' && !(Editor.state.song.originalDeclared && Editor.state.song.termsVersion)) {
                UI.showMessage('editorSong', '서버 업로드는 창작곡 선언과 약관 동의가 필요합니다. 상용곡은 YouTube 링크를 사용해주세요.');
                return;
            }
            // 난이도 변경사항이 없어도, 이미 클라우드에 있는 노래라면 제목/가수/미리듣기 시작 시각이
            // 바뀌었을 수 있으니 아래로 계속 진행해서 노래 메타는 항상 갱신한다.
            const noBeatmapChanges = pendingBeatmaps.length === 0 && dirtyBeatmaps.length === 0 && publicSyncBeatmaps.length === 0;
            if (noBeatmapChanges && !isNewSong && !publicStateChanged && !ytDirty) {
                UI.showMessage('editorSong', '이미 모든 난이도가 클라우드와 동기화되어 있습니다.');
                return;
            }

            const busyBtns = [DOM.editorSong.uploadCloudBtn, DOM.editorSong.saveDraftBtn].filter(Boolean);
            const activeBtn = publish ? DOM.editorSong.uploadCloudBtn : DOM.editorSong.saveDraftBtn;
            busyBtns.forEach(btn => { btn.disabled = true; });
            if (activeBtn) activeBtn.innerHTML = UI.loadingInlineHtml(publish ? '공개 업로드 중…' : '저장 중…');

            // 1) 노래 자체가 아직 클라우드에 없으면 먼저 생성
            const previewStartMs = Math.round((Editor.state.song.previewStartSec || 0) * 1000);
            const startOffsetMs = Math.round((Editor.state.song.startOffsetSec || 0) * 1000);
            const timingStartMs = Math.round((Editor.state.song.timingStartSec || 0) * 1000);
            if (srcType === 'local' && Editor.state.song.audioFileObject) {
                Editor.state.song.audioHash = await this._hashFile(Editor.state.song.audioFileObject);
            }
            if (isNewSong) {
                const { data, error } = await CloudCharts.uploadSong(
                    {
                        title: Editor.state.song.title, artist: Editor.state.song.artist, preview_start_ms: previewStartMs, start_offset_ms: startOffsetMs, timing_start_ms: timingStartMs, is_public: publish,
                        source_type: srcType,
                        youtube_id: Editor.state.song.youtubeId,
                        yt_offset_ms: Editor.state.song.ytOffsetMs || 0,
                        yt_duration_ms: Editor.state.song.ytDurationMs,
                        audio_hash: Editor.state.song.audioHash,
                        original_declared: Editor.state.song.originalDeclared === true,
                        terms_version: Editor.state.song.termsVersion,
                    },
                    Editor.state.song.audioFileObject,
                    Editor.state.song.coverFileObject
                );
                if (error) {
                    UI.showMessage('editorSong', `노래 업로드 실패: ${error.message}`);
                    return;
                }
                Editor.state.song.cloudSongId = data.id;
                Editor.state.song.updatedAt = data.updated_at || null;
            } else {
                // 이미 클라우드에 있는 노래면 제목/가수/미리듣기 시작 시각/시작(초)/타이밍 시작(초)/커버 이미지(고른 경우)/공개 여부를 갱신해준다.
                const { data: metaData, error: metaErr } = await CloudCharts.updateSongMeta(Editor.state.song.cloudSongId, {
                    title: Editor.state.song.title,
                    artist: Editor.state.song.artist,
                    preview_start_ms: previewStartMs,
                    start_offset_ms: startOffsetMs,
                    timing_start_ms: timingStartMs,
                    is_public: publish,
                    ...(srcType === 'youtube' ? {
                        yt_offset_ms: Editor.state.song.ytOffsetMs || 0,
                        yt_duration_ms: Editor.state.song.ytDurationMs,
                        // 링크가 바뀐 경우에만 영상 ID를 보내고, 광고 관찰 기록(has_ads)은 새 영상 기준으로 초기화한다
                        ...(ytLinkChanged ? { youtube_id: Editor.state.song.youtubeId, has_ads: null } : {}),
                    } : {}),
                    ...(srcType === 'local' && Editor.state.song.audioHash ? { audio_hash: Editor.state.song.audioHash } : {}),
                }, Editor.state.song.coverFileObject, Editor.state.song.updatedAt);
                if (metaErr?.conflict) {
                    this._handleSaveConflict();
                    return;
                }
                if (metaErr) {
                    UI.showMessage('editorSong', `노래 정보 갱신 실패: ${metaErr.message}`);
                    return;
                }
                // 성공 시 스냅샷 갱신 — 이어서 아래 난이도들을 저장할 때, 그리고 같은 세션에서
                // 다음에 또 저장 버튼을 누를 때도 이번에 막 바뀐 updated_at 기준으로 비교해야
                // 방금 한 내 저장을 "충돌"로 오판하지 않는다.
                Editor.state.song.updatedAt = metaData?.updated_at || Editor.state.song.updatedAt;
                if (srcType === 'youtube') {
                    Editor.state.song.savedYoutubeId = Editor.state.song.youtubeId;
                    Editor.state.song.savedYtOffsetMs = Editor.state.song.ytOffsetMs || 0;
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
                    useCustomFallSpeed: bm.useCustomFallSpeed === true,
                    laneCount: bm.laneCount,
                    notes: bm.notes || [],
                    noteSpeed: bm.fallSpeed,
                    triggers: bm.triggers || [],
                };
                const meta = {
                    difficulty_label: bm.difficultyLabel,
                    lane_count: bm.laneCount,
                    bpm: bm.bpm,
                    use_custom_fall_speed: bm.useCustomFallSpeed === true,
                    sort_order: Editor.state.beatmaps.indexOf(bm),
                    is_public: publish,
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
            //    (2)에서 실패했다면 굳이 더 진행하지 않고 여기서 멈춘다.
            let updatedCount = 0;
            if (!failure) {
                for (const bm of dirtyBeatmaps) {
                    const meta = {
                        difficulty_label: bm.difficultyLabel,
                        lane_count: bm.laneCount,
                        bpm: bm.bpm,
                        use_custom_fall_speed: bm.useCustomFallSpeed === true,
                        sort_order: Editor.state.beatmaps.indexOf(bm),
                        is_public: publish,
                    };
                    // 편집 화면을 열어 notes/triggers를 갖고 있는 상태(_loaded !== false)일 때만
                    // 차트 데이터도 같이 보낸다. 이름변경만 했다면 메타만 보내 기존 노트를 보존한다.
                    const chartData = bm._loaded === false ? null : {
                        bpm: bm.bpm,
                        startTimeOffset: bm.startTimeOffset,
                        fallSpeed: bm.fallSpeed,
                        useCustomFallSpeed: bm.useCustomFallSpeed === true,
                        laneCount: bm.laneCount,
                        notes: bm.notes || [],
                        triggers: bm.triggers || [],
                    };
                    const { data, error } = await CloudCharts.updateBeatmap(bm.cloudChartId, meta, chartData, bm.updatedAt);
                    if (error?.conflict) {
                        this._handleSaveConflict();
                        return;
                    }
                    if (error) {
                        failure = { label: bm.difficultyLabel, message: error.message };
                        break;
                    }
                    bm._cloudDirty = false;
                    bm.updatedAt = data?.updated_at || new Date().toISOString();
                    updatedCount++;
                }
            }

            // 4) 편집은 안 됐지만 공개 여부만 이번에 바뀐 난이도들 — 메타(is_public)만 갱신, 노트는 안 건드림
            let publicSyncedCount = 0;
            if (!failure) {
                for (const bm of publicSyncBeatmaps) {
                    const { data, error } = await CloudCharts.updateBeatmap(bm.cloudChartId, {
                        difficulty_label: bm.difficultyLabel,
                        lane_count: bm.laneCount,
                        bpm: bm.bpm,
                        use_custom_fall_speed: bm.useCustomFallSpeed === true,
                        sort_order: Editor.state.beatmaps.indexOf(bm),
                        is_public: publish,
                    }, null, bm.updatedAt);
                    if (error?.conflict) {
                        this._handleSaveConflict();
                        return;
                    }
                    if (error) {
                        failure = { label: bm.difficultyLabel, message: error.message };
                        break;
                    }
                    bm.updatedAt = data?.updated_at || new Date().toISOString();
                    publicSyncedCount++;
                }
            }

            if (!failure) Editor.state.song.isPublic = publish;
            this.render();
            if (failure) {
                // 실패 전에 일부는 성공했을 수 있으니 진행 상황도 같이 알려준다.
                const progressParts = [];
                if (addedCount > 0) progressParts.push(`신규 ${addedCount}개`);
                if (updatedCount > 0) progressParts.push(`수정 ${updatedCount}개`);
                if (publicSyncedCount > 0) progressParts.push(`공개상태 갱신 ${publicSyncedCount}개`);
                const progressNote = progressParts.length > 0 ? ` (이전에 ${progressParts.join(', ')} 성공)` : '';
                UI.showMessage('editorSong', `"${failure.label}" 저장 실패: ${failure.message}${progressNote}`);
            } else if (publish) {
                const parts = [];
                if (addedCount > 0) parts.push(`신규 ${addedCount}개`);
                if (updatedCount > 0) parts.push(`수정 ${updatedCount}개`);
                UI.showMessage('editorSong', parts.length > 0
                    ? `라이브러리에 공개했습니다. (${parts.join(', ')})`
                    : '라이브러리에 공개했습니다.');
            } else {
                UI.showMessage('editorSong', '서버에 비공개로 저장했습니다. 라이브러리에는 노출되지 않으며, "에디터 홈"에서 다시 열어 이어서 작업하거나 나중에 공개할 수 있습니다.');
            }
        } catch (err) {
            Debugger.logError(err, 'EditorSong.uploadToCloud');
            UI.showMessage('editorSong', `저장 중 오류: ${err.message}`);
        } finally {
            if (DOM.editorSong.uploadCloudBtn) {
                DOM.editorSong.uploadCloudBtn.disabled = false;
                DOM.editorSong.uploadCloudBtn.replaceChildren(Icon.el('globe'), ' 라이브러리에 공개');
            }
            if (DOM.editorSong.saveDraftBtn) {
                DOM.editorSong.saveDraftBtn.disabled = false;
                DOM.editorSong.saveDraftBtn.replaceChildren(Icon.el('lock'), ' 서버에 저장 (비공개)');
            }
        }
    },
};