// ── Online: 온라인 차트 목록 / 상세 / 내 차트 관리 화면 ───────────────────

const Online = {
    _subView: 'browse',
    _currentChartId: null,
    _browseState: { sort: 'newest', search: '', page: 0, hasMore: true },
    _browseCache: [],

    // ── 진입점 ────────────────────────────────────────────────────────────────
    async show(subView = 'browse', chartId = null) {
        this._subView = subView;
        UI.showScreen('online');
        this._renderShell();
        if (subView === 'browse')                    await this._loadBrowse(true);
        else if (subView === 'my')                   await this._loadMyCharts();
        else if (subView === 'detail' && chartId)    await this._showDetail(chartId);
    },

    // ── 공통 레이아웃 쉘 ─────────────────────────────────────────────────────
    _renderShell() {
        const el = document.getElementById('online-screen');
        el.innerHTML = `
        <div class="flex flex-col h-full text-white">
            <div class="flex items-center space-x-2 mb-4 flex-shrink-0">
                <button id="online-tab-browse" class="flex-1 py-2 rounded-lg text-sm font-semibold transition
                    ${this._subView !== 'my' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">
                    🌐 공개 라이브러리
                </button>
                <button id="online-tab-my" class="flex-1 py-2 rounded-lg text-sm font-semibold transition
                    ${this._subView === 'my' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">
                    📁 내 차트
                </button>
                <button id="online-back-btn" class="py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex-shrink-0">
                    ← 메뉴
                </button>
            </div>
            <div id="online-content" class="flex-1 min-h-0 overflow-y-auto"></div>
        </div>`;

        document.getElementById('online-tab-browse').addEventListener('click', () => this.show('browse'));
        document.getElementById('online-tab-my').addEventListener('click', () => this.show('my'));
        document.getElementById('online-back-btn').addEventListener('click', () => {
            Game.state.gameState = 'menu';
            UI.showScreen('menu');
        });
    },

    _setContent(html) { document.getElementById('online-content').innerHTML = html; },

    // ════════════════════════════════════════════════════════════════════════
    // 공개 라이브러리 탭
    // ════════════════════════════════════════════════════════════════════════
    async _loadBrowse(reset = false) {
        const s = this._browseState;
        if (reset) {
            s.page = 0; s.hasMore = true; this._browseCache = [];
            this._setContent(this._skeleton());
        }

        const { data, error } = await CloudBrowse.listPublicCharts({
            sort: s.sort, search: s.search, page: s.page, pageSize: 20,
        });

        if (error) { this._setContent(`<p class="text-red-400 text-sm mt-4">${error.message}</p>`); return; }
        if (reset) this._browseCache = data || [];
        else this._browseCache = [...this._browseCache, ...(data || [])];
        s.hasMore = (data?.length === 20);
        this._renderBrowse();
    },

    _skeleton() {
        return `<div class="space-y-2 animate-pulse">
            ${Array(5).fill('<div class="h-16 bg-gray-700 rounded-lg"></div>').join('')}
        </div>`;
    },

    _renderBrowse() {
        const s = this._browseState;
        const items = this._browseCache;
        const cards = items.length === 0
            ? '<p class="text-gray-400 text-sm mt-8 text-center">차트가 없습니다.</p>'
            : items.map(c => this._chartCard(c)).join('');

        this._setContent(`
        <div class="flex space-x-2 mb-3">
            <input id="online-search" type="text" placeholder="제목 / 아티스트 검색…" value="${_esc(s.search)}"
                class="flex-1 p-2 bg-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
            <button id="online-search-btn" class="px-3 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm">검색</button>
        </div>
        <div class="flex space-x-2 mb-4">
            <button id="sort-newest" class="flex-1 py-1.5 rounded text-xs font-semibold transition
                ${s.sort === 'newest' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}">최신순</button>
            <button id="sort-popular" class="flex-1 py-1.5 rounded text-xs font-semibold transition
                ${s.sort === 'popular' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}">인기순</button>
        </div>
        <div id="browse-list" class="space-y-2">${cards}</div>
        ${s.hasMore ? `<button id="browse-more-btn" class="w-full mt-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">더 보기</button>` : ''}
        `);

        document.getElementById('online-search-btn').addEventListener('click', () => {
            s.search = document.getElementById('online-search').value;
            this._loadBrowse(true);
        });
        document.getElementById('online-search').addEventListener('keydown', e => {
            if (e.key === 'Enter') { s.search = e.target.value; this._loadBrowse(true); }
        });
        document.getElementById('sort-newest').addEventListener('click', () => { s.sort = 'newest'; this._loadBrowse(true); });
        document.getElementById('sort-popular').addEventListener('click', () => { s.sort = 'popular'; this._loadBrowse(true); });
        document.getElementById('browse-more-btn')?.addEventListener('click', () => { s.page++; this._loadBrowse(false); });
        document.querySelectorAll('.browse-card-btn').forEach(btn =>
            btn.addEventListener('click', () => this._showDetail(btn.dataset.id)));
    },

    _chartCard(c) {
        const diff = c.difficulty_label
            ? `<span class="text-xs px-1.5 py-0.5 bg-gray-600 rounded">${_esc(c.difficulty_label)}</span>` : '';
        return `
        <button class="browse-card-btn w-full text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition" data-id="${c.id}">
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white truncate">${_esc(c.title)}</p>
                    <p class="text-sm text-gray-400 truncate">${_esc(c.artist || '—')}</p>
                </div>
                <div class="flex flex-col items-end space-y-1 ml-2 flex-shrink-0">
                    ${diff}
                    <span class="text-xs text-gray-400">${c.lane_count}키 · ${c.note_count}노트</span>
                    <span class="text-xs text-gray-500">▶ ${c.play_count}</span>
                </div>
            </div>
        </button>`;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 차트 상세 + 리더보드
    // ════════════════════════════════════════════════════════════════════════
    async _showDetail(chartId) {
        this._currentChartId = chartId;
        this._setContent('<p class="text-gray-400 text-sm mt-8 text-center animate-pulse">불러오는 중…</p>');

        const [detailRes, lbRes, myRes, currentUser] = await Promise.all([
            CloudBrowse.getChartDetail(chartId),
            CloudScores.getLeaderboard(chartId, 10),
            CloudScores.getMyScore(chartId),
            CloudAuth.getUser(),
        ]);

        if (detailRes.error) {
            this._setContent(`<p class="text-red-400 text-sm">${detailRes.error.message}</p>`);
            return;
        }

        const c = detailRes.data;
        const lb = lbRes.data || [];
        const myScore = myRes.data;

        // 내 순위 계산
        let myRank = null;
        if (myScore && currentUser) {
            const idx = lb.findIndex(r => r.user_id === currentUser.id);
            myRank = idx >= 0 ? idx + 1 : null;
        }

        // 리더보드 행 렌더링
        const lbRows = lb.length === 0
            ? '<p class="text-gray-500 text-xs text-center py-4">아직 기록이 없습니다.</p>'
            : lb.map((s, i) => {
                const isMe = !!(currentUser && s.user_id === currentUser.id);
                const displayName = s.nickname ? _esc(s.nickname) : `${_esc(s.user_id.slice(0, 8))}…`;
                const acc = (+(s.accuracy) || 0).toFixed(1);
                const rankBadge = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
                const rowCls = isMe
                    ? 'bg-teal-900 border border-teal-600 rounded'
                    : 'border-b border-gray-700';
                return `
                <div class="flex items-center justify-between py-2 px-2 ${rowCls} text-sm ${isMe ? 'text-teal-200' : 'text-gray-300'}">
                    <span class="w-7 text-center font-bold flex-shrink-0">${rankBadge}</span>
                    <span class="flex-1 px-2 truncate font-medium">${displayName}${isMe ? ' <span class="text-xs text-teal-400 ml-1">(나)</span>' : ''}</span>
                    <span class="font-mono font-bold w-20 text-right flex-shrink-0">${s.score.toLocaleString()}</span>
                    <span class="text-xs text-gray-500 w-12 text-right flex-shrink-0">${acc}%</span>
                    <span class="text-xs text-gray-500 w-14 text-right flex-shrink-0">${s.max_combo}콤보</span>
                </div>`;
            }).join('');

        // 내 기록 패널
        let myPanel = '';
        if (!currentUser) {
            myPanel = `<p class="mt-3 text-xs text-gray-500 text-center">로그인 후 플레이하면 기록이 등록됩니다.</p>`;
        } else if (myScore) {
            const rankTxt = myRank ? `${myRank}위` : `TOP ${lb.length} 밖`;
            const p = myScore.judge_perfect || 0;
            const g = myScore.judge_good    || 0;
            const m = myScore.judge_miss    || 0;
            myPanel = `
            <div class="mt-3 p-3 bg-teal-950 border border-teal-700 rounded-lg">
                <div class="flex justify-between items-center text-sm text-teal-200">
                    <span class="font-semibold">내 최고 기록 <span class="text-xs text-teal-400">(${rankTxt})</span></span>
                    <span class="font-mono font-bold text-base">${myScore.score.toLocaleString()}</span>
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-teal-400">
                    <span>정확도 ${(+(myScore.accuracy) || 0).toFixed(1)}%</span>
                    <span>최대 콤보 ${myScore.max_combo}</span>
                    <span>P ${p} / G ${g} / M ${m}</span>
                </div>
            </div>`;
        } else {
            myPanel = `<p class="mt-3 text-xs text-gray-500 text-center">아직 이 차트를 플레이하지 않았습니다.</p>`;
        }

        this._setContent(`
        <button id="detail-back-btn" class="mb-3 text-sm text-gray-400 hover:text-white transition">← 목록으로</button>
        <div class="p-4 bg-gray-800 rounded-lg mb-3">
            <h2 class="text-xl font-bold text-white truncate">${_esc(c.title)}</h2>
            <p class="text-gray-400 truncate">${_esc(c.artist || '—')}</p>
            <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-400">
                ${c.bpm             ? `<span>BPM ${c.bpm}</span>` : ''}
                <span>${c.lane_count}키</span>
                ${c.difficulty_label ? `<span>${_esc(c.difficulty_label)}</span>` : ''}
                <span>${c.note_count}노트</span>
                <span>▶ ${c.play_count}회</span>
            </div>
        </div>
        <button id="detail-play-btn" class="w-full py-3 mb-4 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition text-lg">
            ▶ 플레이
        </button>
        <div class="bg-gray-800 rounded-lg p-3">
            <h3 class="text-sm font-semibold text-gray-300 mb-2">🏆 리더보드 TOP 10</h3>
            <div class="space-y-0.5">${lbRows}</div>
            ${myPanel}
        </div>
        `);

        document.getElementById('detail-back-btn').addEventListener('click', () => {
            this._subView = 'browse';
            this._renderShell();
            this._renderBrowse();
        });
        document.getElementById('detail-play-btn').addEventListener('click', () => this._playOnlineChart(c));
    },

    // ── 온라인 차트 플레이 ────────────────────────────────────────────────────
    async _playOnlineChart(c) {
        const btn = document.getElementById('detail-play-btn');
        btn.disabled = true;
        btn.textContent = '불러오는 중…';

        try {
            const { data: chartData, error: cdErr } = await CloudCharts.downloadChartData(c.chart_storage_path);
            if (cdErr) throw cdErr;

            const audioUrl = CloudCharts.getAudioUrl(c.audio_storage_path);

            Game.loadChartNotes(chartData);
            Game.state._onlineChartId = c.id;
            Game.state.settings.mode = 'music';
            Game.state.settings.musicSrc = audioUrl;
            DOM.musicPlayer.src = audioUrl;

            UI.showScreen('menu');
            setTimeout(() => {
                Game.start();
                UI.showScreen('playing');
                Game.state.gameState = 'playing';
            }, 100);
        } catch (err) {
            alert('플레이 오류: ' + err.message);
            btn.disabled = false;
            btn.textContent = '▶ 플레이';
        }
    },

    // ════════════════════════════════════════════════════════════════════════
    // 내 차트 탭
    // ════════════════════════════════════════════════════════════════════════
    async _loadMyCharts() {
        this._setContent('<p class="text-gray-400 text-sm mt-8 text-center animate-pulse">불러오는 중…</p>');

        const user = await CloudAuth.getUser();
        if (!user) {
            this._setContent(`
            <div class="text-center mt-10">
                <p class="text-gray-400 mb-4">내 차트를 보려면 로그인이 필요합니다.</p>
                <button id="my-login-btn" class="py-2 px-6 bg-teal-600 hover:bg-teal-500 rounded-lg">로그인</button>
            </div>`);
            document.getElementById('my-login-btn')?.addEventListener('click', () =>
                document.querySelector('.account-icon-btn')?.click());
            return;
        }

        const { data, error } = await CloudCharts.listMyCharts();
        if (error) { this._setContent(`<p class="text-red-400 text-sm">${error.message}</p>`); return; }

        const cards = (data || []).length === 0
            ? '<p class="text-gray-400 text-sm text-center mt-8">업로드한 차트가 없습니다.</p>'
            : (data || []).map(c => this._myChartCard(c)).join('');

        this._setContent(`
        <!-- 로컬 파일로 플레이 -->
        <div class="p-3 bg-gray-800 rounded-lg mb-4 border border-gray-600">
            <h3 class="text-sm font-semibold text-gray-300 mb-2">📂 로컬 파일로 플레이</h3>
            <div class="flex flex-col space-y-2">
                <div class="flex space-x-2">
                    <label for="local-chart-file-input" class="cursor-pointer flex-1 text-center py-2 px-3 bg-blue-700 hover:bg-blue-600 rounded text-sm transition">차트 불러오기</label>
                    <label for="local-music-file-input" class="cursor-pointer flex-1 text-center py-2 px-3 bg-teal-700 hover:bg-teal-600 rounded text-sm transition">음악 불러오기</label>
                </div>
                <p id="local-chart-name" class="text-xs text-gray-400 truncate hidden"></p>
                <p id="local-music-name" class="text-xs text-gray-400 truncate hidden"></p>
                <p id="local-required-name" class="text-xs text-yellow-400 truncate hidden"></p>
                <button id="local-play-btn" class="w-full py-2 bg-green-700 hover:bg-green-600 rounded text-sm font-semibold transition disabled:opacity-40" disabled>▶ 플레이</button>
            </div>
        </div>
        <!-- 내 업로드 차트 목록 -->
        <h3 class="text-sm font-semibold text-gray-300 mb-2">☁ 내 업로드 차트</h3>
        <div class="space-y-2">${cards}</div>`);

        // 로컬 파일 input (hidden, DOM 원본은 practice-screen 안에 있으므로 여기선 별도 생성)
        const chartInput = document.createElement('input');
        chartInput.type = 'file'; chartInput.id = 'local-chart-file-input'; chartInput.accept = '*'; chartInput.className = 'hidden';
        const musicInput = document.createElement('input');
        musicInput.type = 'file'; musicInput.id = 'local-music-file-input'; musicInput.accept = 'audio/*,.mp3,.wav,.ogg'; musicInput.className = 'hidden';
        document.body.appendChild(chartInput);
        document.body.appendChild(musicInput);

        chartInput.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const chartData = JSON.parse(ev.target.result);
                    Game.loadChartNotes(chartData);
                    Game.state.settings.mode = 'music';
                    document.getElementById('local-chart-name').textContent = `차트: ${file.name}`;
                    document.getElementById('local-chart-name').classList.remove('hidden');
                    if (chartData.songName) {
                        document.getElementById('local-required-name').textContent = `필요 음악: ${chartData.songName}`;
                        document.getElementById('local-required-name').classList.remove('hidden');
                        Game.state.settings.requiredSongName = chartData.songName;
                    }
                    this._checkLocalPlayReady();
                } catch { UI.showMessage('online', '차트 파일을 읽을 수 없습니다.'); }
            };
            reader.readAsText(file);
        });

        musicInput.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            Game.state.settings.musicFileObject = file;
            Game.state.settings.musicSrc = URL.createObjectURL(file);
            DOM.musicPlayer.src = Game.state.settings.musicSrc;
            document.getElementById('local-music-name').textContent = `음악: ${file.name}`;
            document.getElementById('local-music-name').classList.remove('hidden');
            this._checkLocalPlayReady();
        });

        document.getElementById('local-play-btn').addEventListener('click', async () => {
            Game.state._onlineChartId = null;
            await Game.start();
            UI.showScreen('playing');
            Game.state.gameState = 'playing';
        });

        // 이전에 동적 생성된 input 정리 후 재생성했으므로 기존 것 제거
        document.querySelectorAll('input#local-chart-file-input, input#local-music-file-input').forEach((el, i, arr) => {
            if (i < arr.length - 2) el.remove(); // 마지막 2개만 유지 (방금 추가한 것)
        });

        document.querySelectorAll('.my-delete-btn').forEach(btn =>
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this._deleteMyChart(btn.dataset.id, btn.dataset.title);
            }));
        // 내 차트에서 직접 리더보드 열기
        document.querySelectorAll('.my-lb-btn').forEach(btn =>
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this.show('detail', btn.dataset.id);
            }));
    },

    _myChartCard(c) {
        const pub = c.is_public
            ? '<span class="text-xs text-green-400">공개</span>'
            : '<span class="text-xs text-gray-500">비공개</span>';
        return `
        <div class="p-3 bg-gray-800 rounded-lg">
            <div class="flex items-center space-x-2">
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white truncate">${_esc(c.title)}</p>
                    <p class="text-xs text-gray-400 truncate">${_esc(c.artist || '—')} · ${c.lane_count}키 · ▶ ${c.play_count}</p>
                </div>
                <div class="flex items-center space-x-1 flex-shrink-0">
                    ${pub}
                    <button class="my-lb-btn py-1 px-2 bg-gray-700 hover:bg-gray-600 rounded text-xs" data-id="${c.id}">랭킹</button>
                    <button class="my-delete-btn py-1 px-2 bg-red-800 hover:bg-red-700 rounded text-xs"
                        data-id="${c.id}" data-title="${_esc(c.title)}">삭제</button>
                </div>
            </div>
        </div>`;
    },

    _checkLocalPlayReady() {
        const btn = document.getElementById('local-play-btn');
        if (!btn) return;
        const hasChart = Game.state.notes?.length > 0;
        const hasMusic = !!Game.state.settings.musicSrc;
        btn.disabled = !(hasChart && hasMusic);
    },

    async _deleteMyChart(chartId, title) {
        if (!confirm(`"${title}" 을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        const { error } = await CloudCharts.deleteChart(chartId);
        if (error) { alert('삭제 오류: ' + error.message); return; }
        await this._loadMyCharts();
    },
};

// ── HTML 이스케이프 헬퍼 ──────────────────────────────────────────────────────
function _esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════════════════════════════
// 에디터 업로드 모달
// ════════════════════════════════════════════════════════════════════════════
const UploadModal = {
    _mode: 'upload',
    _chartId: null,

    async open(mode = 'upload', chartId = null) {
        this._mode = mode;
        this._chartId = chartId;
        const modal = document.getElementById('upload-modal');
        if (!modal) return;

        // 에디터 현재 정보로 기본값 채우기
        const editorChart = Editor.getChartData?.();
        if (editorChart) {
            document.getElementById('upload-title').value =
                (editorChart.songName || '').replace(/\.[^.]+$/, '');
            document.getElementById('upload-bpm').value   = editorChart.bpm || '';
            document.getElementById('upload-lanes').value = editorChart.laneCount || 4;
        }

        document.getElementById('upload-modal-title').textContent =
            mode === 'upload' ? '차트 업로드' : '차트 업데이트';
        document.getElementById('upload-submit-btn').textContent =
            mode === 'upload' ? '업로드' : '업데이트';

        // audio 안내 문구 (두 ID 모두 대응)
        const audioNote = document.getElementById('upload-audio-note')
                       || document.getElementById('upload-audio-required');
        if (audioNote) audioNote.textContent =
            mode === 'upload' ? '(필수)' : '(선택 — 비워두면 기존 파일 유지)';

        // 에디터에 로드된 음악 파일명 힌트 표시
        const audioHint = document.getElementById('upload-audio-hint');
        const editorAudioName = Editor.state?.audioFileName || null;
        if (audioHint) {
            if (editorAudioName) {
                audioHint.textContent = `에디터 음악: ${editorAudioName} — 동일 파일을 다시 선택해주세요.`;
                audioHint.classList.remove('hidden');
            } else {
                audioHint.classList.add('hidden');
            }
        }

        modal.style.display = 'flex';
    },

    close() {
        const modal = document.getElementById('upload-modal');
        if (modal) modal.style.display = 'none';
        document.getElementById('upload-audio-input').value = '';
    },

    async submit() {
        const title     = document.getElementById('upload-title').value.trim();
        const artist    = document.getElementById('upload-artist').value.trim();
        const bpm       = parseFloat(document.getElementById('upload-bpm').value) || null;
        const laneCount = parseInt(document.getElementById('upload-lanes').value) || 4;
        const diff      = document.getElementById('upload-diff').value.trim();
        const audioFile = document.getElementById('upload-audio-input').files[0] || null;

        if (!title) { alert('제목을 입력해주세요.'); return; }
        if (this._mode === 'upload' && !audioFile) {
            alert('음악 파일을 선택해주세요.\n(브라우저 보안상 에디터에 로드된 파일은 자동 첨부가 불가합니다.\n동일한 파일을 다시 선택해주세요.)');
            return;
        }

        const btn = document.getElementById('upload-submit-btn');
        btn.disabled = true;
        btn.textContent = '처리 중…';

        try {
            const chartData = Editor.getChartData?.();
            if (!chartData) throw new Error('에디터 차트 데이터를 가져올 수 없습니다.');

            const meta = { title, artist, bpm, lane_count: laneCount, difficulty_label: diff };
            const result = this._mode === 'upload'
                ? await CloudCharts.uploadChart(meta, chartData, audioFile)
                : await CloudCharts.updateChart(this._chartId, meta, chartData, audioFile);

            if (result.error) throw result.error;
            alert(this._mode === 'upload' ? '업로드 완료!' : '업데이트 완료!');
            this.close();
        } catch (err) {
            alert('오류: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = this._mode === 'upload' ? '업로드' : '업데이트';
        }
    },
};

// ════════════════════════════════════════════════════════════════════════════
// 결과 화면 점수 제출
// ════════════════════════════════════════════════════════════════════════════
async function submitOnlineScore() {
    const chartId = Game.state._onlineChartId;
    if (!chartId) return;

    const { perfect, good, bad, miss } = Game.state.judgements;
    const totalJudged = perfect + good + bad + miss;
    // PERFECT=100%, GOOD=50%, BAD/MISS=0%
    const accuracy = totalJudged > 0
        ? ((perfect * 100 + good * 50) / (totalJudged * 100)) * 100
        : 0;

    const { data, error } = await CloudScores.submitScore({
        chartId,
        score:        Game.state.score,
        accuracy:     parseFloat(accuracy.toFixed(2)),
        maxCombo:     Game.state.maxCombo || 0,
        judgePerfect: perfect,
        judgeGood:    good,
        judgeMiss:    miss,
    });

    const resultEl = document.getElementById('online-score-result');
    if (!resultEl) return;
    resultEl.classList.remove('hidden');

    if (error) {
        resultEl.textContent = '점수 등록 실패: ' + error.message;
        resultEl.className = 'text-sm text-red-400 mt-2';
        return;
    }

    if (data?.is_new_best) {
        resultEl.innerHTML = `🏆 새 최고 기록! <strong>${Game.state.score.toLocaleString()}</strong>`;
        resultEl.className = 'text-sm text-yellow-300 mt-2 font-semibold';
    } else {
        resultEl.textContent = `기존 최고 기록(${(data?.best_score || 0).toLocaleString()})이 더 높습니다.`;
        resultEl.className = 'text-sm text-gray-400 mt-2';
    }

    // "리더보드 보기" 버튼 표시
    const lbBtn = document.getElementById('result-leaderboard-btn');
    if (lbBtn) {
        lbBtn.classList.remove('hidden');
        // 중복 리스너 방지 — 새 노드로 교체
        const fresh = lbBtn.cloneNode(true);
        lbBtn.replaceWith(fresh);
        fresh.addEventListener('click', () => Online.show('detail', chartId));
    }
}

// ════════════════════════════════════════════════════════════════════════════
// 에디터 — 서버에서 불러오기 모달
// ════════════════════════════════════════════════════════════════════════════
const CloudLoadModal = {

    async open() {
        const modal = document.getElementById('cloud-load-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        this._renderList('<p style="color:#718096;font-size:0.85rem;text-align:center;margin-top:16px;">불러오는 중…</p>');

        const user = await CloudAuth.getUser();
        if (!user) {
            this._renderList('<p style="color:#fc8181;font-size:0.85rem;text-align:center;margin-top:16px;">로그인이 필요합니다.</p>');
            return;
        }

        const { data, error } = await CloudCharts.listMyCharts();
        if (error) {
            this._renderList(`<p style="color:#fc8181;font-size:0.85rem;">${error.message}</p>`);
            return;
        }
        if (!data || data.length === 0) {
            this._renderList('<p style="color:#718096;font-size:0.85rem;text-align:center;margin-top:16px;">업로드한 차트가 없습니다.</p>');
            return;
        }

        const listEl = document.getElementById('cloud-load-list');
        listEl.innerHTML = '';
        data.forEach(c => {
            const item = document.createElement('button');
            item.style.cssText = 'width:100%;text-align:left;padding:10px 12px;background:#3c4a5e;border:1px solid #4a5568;border-radius:6px;color:white;cursor:pointer;';
            item.innerHTML = `
                <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(c.title)}</div>
                <div style="font-size:0.75rem;color:#a0aec0;margin-top:2px;">${_esc(c.artist || '—')} · ${c.lane_count}키 · ${c.note_count}노트</div>`;
            item.addEventListener('mouseenter', () => item.style.background = '#4a5f78');
            item.addEventListener('mouseleave', () => item.style.background = '#3c4a5e');
            item.addEventListener('click', () => this._loadChart(c));
            listEl.appendChild(item);
        });
    },

    _renderList(html) {
        const listEl = document.getElementById('cloud-load-list');
        if (listEl) listEl.innerHTML = html;
    },

    async _loadChart(c) {
        if (!Editor._confirmDiscardChanges('저장하지 않은 변경사항이 있습니다. 서버 차트를 불러오시겠습니까?')) return;

        this._renderList('<p style="color:#718096;font-size:0.85rem;text-align:center;margin-top:16px;">차트 데이터 다운로드 중…</p>');

        try {
            const { data: chartData, error } = await CloudCharts.downloadChartData(c.chart_storage_path);
            if (error) {
                this._renderList(`<p style="color:#fc8181;font-size:0.85rem;">다운로드 실패: ${error.message}</p>`);
                return;
            }

            // 에디터에 로드
            Editor.loadChart(chartData, c.title + '.json');

            // 서버 메타 등록 → 이후 "서버에 업로드" 버튼이 update 모드로 동작
            Editor.setCloudChart({ id: c.id, title: c.title });

            this.close();

            // 음악 파일 안내
            const audioName = c.audio_storage_path.split('/').pop();
            UI.showMessage('editor', `차트 로드 완료. 음악 파일(${audioName})을 별도로 다시 로드해주세요.`);
        } catch (err) {
            this._renderList(`<p style="color:#fc8181;font-size:0.85rem;">오류 발생: ${err.message}</p>`);
        }
    },

    close() {
        const modal = document.getElementById('cloud-load-modal');
        if (modal) modal.style.display = 'none';
    },
};