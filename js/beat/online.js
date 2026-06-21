// ── Online: 온라인 차트 목록 / 상세 / 내 차트 관리 화면 ───────────────────

const Online = {
    // 현재 온라인 서브 화면: 'browse' | 'detail' | 'my'
    _subView: 'browse',
    _currentChartId: null,
    _browseState: { sort: 'newest', search: '', page: 0, hasMore: true },
    _browseCache: [],

    // ── 진입점 ────────────────────────────────────────────────────────────────
    async show(subView = 'browse') {
        this._subView = subView;
        UI.showScreen('online');
        this._renderShell();
        if (subView === 'browse') await this._loadBrowse(true);
        else if (subView === 'my') await this._loadMyCharts();
    },

    // ── 공통 레이아웃 쉘 렌더링 ──────────────────────────────────────────────
    _renderShell() {
        const el = document.getElementById('online-screen');
        el.innerHTML = `
        <div class="flex flex-col h-full text-white">
            <!-- 탭 헤더 -->
            <div class="flex items-center space-x-2 mb-4 flex-shrink-0">
                <button id="online-tab-browse" class="flex-1 py-2 rounded-lg text-sm font-semibold transition
                    ${this._subView === 'browse' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">
                    🌐 공개 라이브러리
                </button>
                <button id="online-tab-my" class="flex-1 py-2 rounded-lg text-sm font-semibold transition
                    ${this._subView === 'my' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">
                    📁 내 차트
                </button>
                <button id="online-back-btn" class="py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
                    ← 메뉴
                </button>
            </div>
            <!-- 콘텐츠 영역 -->
            <div id="online-content" class="flex-1 min-h-0 overflow-y-auto"></div>
        </div>`;

        document.getElementById('online-tab-browse').addEventListener('click', () => this.show('browse'));
        document.getElementById('online-tab-my').addEventListener('click', () => this.show('my'));
        document.getElementById('online-back-btn').addEventListener('click', () => {
            Game.state.gameState = 'menu';
            UI.showScreen('menu');
        });
    },

    _content() { return document.getElementById('online-content'); },

    _setContent(html) { this._content().innerHTML = html; },

    // ════════════════════════════════════════════════════════════════════════
    // 공개 라이브러리 탭
    // ════════════════════════════════════════════════════════════════════════
    async _loadBrowse(reset = false) {
        const state = this._browseState;
        if (reset) {
            state.page = 0;
            state.hasMore = true;
            this._browseCache = [];
            this._setContent(this._browseSkeleton());
        }

        const { data, error, count } = await CloudBrowse.listPublicCharts({
            sort: state.sort,
            search: state.search,
            page: state.page,
            pageSize: 20,
        });

        if (error) { this._setContent(`<p class="text-red-400 text-sm mt-4">${error.message}</p>`); return; }

        if (reset) this._browseCache = data || [];
        else this._browseCache = [...this._browseCache, ...(data || [])];

        state.hasMore = (data?.length === 20);

        this._renderBrowse();
    },

    _browseSkeleton() {
        return `<div class="space-y-2 animate-pulse">
            ${Array(5).fill('<div class="h-16 bg-gray-700 rounded-lg"></div>').join('')}
        </div>`;
    },

    _renderBrowse() {
        const state = this._browseState;
        const items = this._browseCache;

        const cards = items.length === 0
            ? '<p class="text-gray-400 text-sm mt-8 text-center">차트가 없습니다.</p>'
            : items.map(c => this._chartCard(c)).join('');

        this._setContent(`
        <!-- 검색 / 정렬 -->
        <div class="flex space-x-2 mb-3 flex-shrink-0">
            <input id="online-search" type="text" placeholder="제목 / 아티스트 검색…"
                value="${state.search}"
                class="flex-1 p-2 bg-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
            <button id="online-search-btn" class="px-3 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm">검색</button>
        </div>
        <div class="flex space-x-2 mb-4 flex-shrink-0">
            <button id="sort-newest" class="flex-1 py-1.5 rounded text-xs font-semibold transition
                ${state.sort === 'newest' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}">최신순</button>
            <button id="sort-popular" class="flex-1 py-1.5 rounded text-xs font-semibold transition
                ${state.sort === 'popular' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}">인기순</button>
        </div>
        <!-- 카드 목록 -->
        <div id="browse-list" class="space-y-2">
            ${cards}
        </div>
        ${state.hasMore ? `<button id="browse-more-btn" class="w-full mt-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">더 보기</button>` : ''}
        `);

        // 이벤트 바인딩
        document.getElementById('online-search-btn').addEventListener('click', () => {
            state.search = document.getElementById('online-search').value;
            this._loadBrowse(true);
        });
        document.getElementById('online-search').addEventListener('keydown', e => {
            if (e.key === 'Enter') { state.search = e.target.value; this._loadBrowse(true); }
        });
        document.getElementById('sort-newest').addEventListener('click', () => {
            state.sort = 'newest'; this._loadBrowse(true);
        });
        document.getElementById('sort-popular').addEventListener('click', () => {
            state.sort = 'popular'; this._loadBrowse(true);
        });
        document.getElementById('browse-more-btn')?.addEventListener('click', () => {
            state.page++;
            this._loadBrowse(false);
        });
        document.querySelectorAll('.browse-card-btn').forEach(btn => {
            btn.addEventListener('click', () => this._showDetail(btn.dataset.id));
        });
    },

    _chartCard(c) {
        const diff = c.difficulty_label ? `<span class="text-xs px-1.5 py-0.5 bg-gray-600 rounded">${c.difficulty_label}</span>` : '';
        const lanes = `<span class="text-xs text-gray-400">${c.lane_count}키</span>`;
        return `
        <button class="browse-card-btn w-full text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition" data-id="${c.id}">
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white truncate">${_esc(c.title)}</p>
                    <p class="text-sm text-gray-400 truncate">${_esc(c.artist || '—')}</p>
                </div>
                <div class="flex flex-col items-end space-y-1 ml-2 flex-shrink-0">
                    ${diff}
                    ${lanes}
                    <span class="text-xs text-gray-500">▶ ${c.play_count}</span>
                </div>
            </div>
        </button>`;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 차트 상세 화면
    // ════════════════════════════════════════════════════════════════════════
    async _showDetail(chartId) {
        this._currentChartId = chartId;
        this._setContent('<p class="text-gray-400 text-sm mt-8 text-center animate-pulse">불러오는 중…</p>');

        const [detailRes, lbRes, myRes] = await Promise.all([
            CloudBrowse.getChartDetail(chartId),
            CloudScores.getLeaderboard(chartId, 10),
            CloudScores.getMyScore(chartId),
        ]);

        if (detailRes.error) {
            this._setContent(`<p class="text-red-400 text-sm">${detailRes.error.message}</p>`);
            return;
        }

        const c = detailRes.data;
        const lb = lbRes.data || [];
        const myScore = myRes.data;

        const lbRows = lb.length === 0
            ? '<p class="text-gray-500 text-xs text-center py-4">기록 없음</p>'
            : lb.map((s, i) => {
                const displayName = s.nickname ? _esc(s.nickname) : `${_esc(s.user_id.slice(0, 8))}…`;
                return `
            <div class="flex items-center justify-between py-1.5 border-b border-gray-700 text-sm ${myScore && s.score === myScore.score ? 'text-teal-300' : 'text-gray-300'}">
                <span class="w-6 text-center font-bold text-gray-400">${i + 1}</span>
                <span class="flex-1 px-2 truncate">${displayName}</span>
                <span class="font-mono font-bold w-16 text-right">${s.score.toLocaleString()}</span>
                <span class="text-xs text-gray-500 w-14 text-right">${(+s.accuracy || 0).toFixed(1)}%</span>
            </div>`;
            }).join('');

        const myScoreHtml = myScore
            ? `<div class="mt-3 p-2 bg-teal-900 rounded text-sm text-teal-200">
                내 최고: <strong>${myScore.score.toLocaleString()}</strong>
                &nbsp;정확도 ${(+myScore.accuracy || 0).toFixed(1)}%
                &nbsp;콤보 ${myScore.max_combo}
               </div>`
            : `<p class="mt-2 text-xs text-gray-500">로그인 후 플레이하면 기록이 등록됩니다.</p>`;

        this._setContent(`
        <button id="detail-back-btn" class="mb-4 text-sm text-gray-400 hover:text-white transition">← 목록으로</button>
        <div class="p-4 bg-gray-800 rounded-lg mb-4">
            <h2 class="text-xl font-bold text-white truncate">${_esc(c.title)}</h2>
            <p class="text-gray-400 truncate">${_esc(c.artist || '—')}</p>
            <div class="flex space-x-3 mt-3 text-xs text-gray-400 flex-wrap gap-y-1">
                ${c.bpm ? `<span>BPM ${c.bpm}</span>` : ''}
                <span>${c.lane_count}키</span>
                ${c.difficulty_label ? `<span>${c.difficulty_label}</span>` : ''}
                <span>노트 ${c.note_count}개</span>
                <span>▶ ${c.play_count}회</span>
            </div>
        </div>
        <!-- 플레이 버튼 -->
        <button id="detail-play-btn" class="w-full py-3 mb-4 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition">
            ▶ 플레이
        </button>
        <!-- 리더보드 -->
        <div class="bg-gray-800 rounded-lg p-3">
            <h3 class="text-sm font-semibold text-gray-300 mb-2">🏆 리더보드 TOP 10</h3>
            ${lbRows}
            ${myScoreHtml}
        </div>
        `);

        document.getElementById('detail-back-btn').addEventListener('click', () => this._loadBrowse(false));
        document.getElementById('detail-play-btn').addEventListener('click', () => this._playOnlineChart(c));
    },

    // ── 온라인 차트 플레이 ────────────────────────────────────────────────────
    async _playOnlineChart(c) {
        const btn = document.getElementById('detail-play-btn');
        btn.disabled = true;
        btn.textContent = '불러오는 중…';

        try {
            // 차트 JSON 다운로드
            const { data: chartData, error: cdErr } = await CloudCharts.downloadChartData(c.chart_storage_path);
            if (cdErr) throw cdErr;

            // 오디오 URL 가져오기
            const audioUrl = CloudCharts.getAudioUrl(c.audio_storage_path);

            // Game 상태에 주입
            Game.loadChartNotes(chartData);
            Game.state._onlineChartId = c.id; // 결과 화면에서 점수 제출에 사용
            Game.state.settings.mode = 'music';
            Game.state.settings.musicFileObject = null; // 이전에 불러온 로컬 파일이 우선되지 않도록 초기화
            Game.state.settings.musicSrc = audioUrl;

            UI.showScreen('menu');
            // 잠깐 후 게임 시작 (DOM 전환 대기)
            setTimeout(() => {
                Game.start();
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
            document.getElementById('my-login-btn')?.addEventListener('click', () => {
                document.querySelector('.account-icon-btn')?.click();
            });
            return;
        }

        const { data, error } = await CloudCharts.listMyCharts();
        if (error) { this._setContent(`<p class="text-red-400 text-sm">${error.message}</p>`); return; }

        const cards = (data || []).length === 0
            ? '<p class="text-gray-400 text-sm text-center mt-8">업로드한 차트가 없습니다.</p>'
            : (data || []).map(c => this._myChartCard(c)).join('');

        this._setContent(`
        <div class="space-y-2">
            ${cards}
        </div>`);

        document.querySelectorAll('.my-delete-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this._deleteMyChart(btn.dataset.id, btn.dataset.title);
            });
        });

        document.querySelectorAll('.my-edit-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this._editMyChart(btn.dataset.id);
            });
        });
    },

    _myChartCard(c) {
        const isPublic = c.is_public
            ? '<span class="text-xs text-green-400">공개</span>'
            : '<span class="text-xs text-gray-500">비공개</span>';
        return `
        <div class="p-3 bg-gray-800 rounded-lg flex items-center space-x-2">
            <div class="flex-1 min-w-0">
                <p class="font-semibold text-white truncate">${_esc(c.title)}</p>
                <p class="text-xs text-gray-400 truncate">${_esc(c.artist || '—')} · ${c.lane_count}키 · ▶ ${c.play_count}</p>
            </div>
            <div class="flex items-center space-x-1 flex-shrink-0">
                ${isPublic}
                <button class="my-edit-btn py-1 px-2 bg-indigo-700 hover:bg-indigo-600 rounded text-xs" data-id="${c.id}">편집</button>
                <button class="my-delete-btn py-1 px-2 bg-red-800 hover:bg-red-700 rounded text-xs ml-1" data-id="${c.id}" data-title="${_esc(c.title)}">삭제</button>
            </div>
        </div>`;
    },

    // 이미 업로드한 차트를 에디터로 불러와 수정할 수 있게 한다.
    // (차트 JSON + 음악 파일을 서버에서 다시 받아와 에디터 상태에 그대로 채워넣는다)
    async _editMyChart(chartId) {
        const btn = document.querySelector(`.my-edit-btn[data-id="${chartId}"]`);
        const originalLabel = btn ? btn.textContent : '편집';
        if (btn) { btn.disabled = true; btn.textContent = '불러오는 중…'; }

        try {
            const { data: c, error: detailErr } = await CloudCharts.getMyChartDetail(chartId);
            if (detailErr) throw detailErr;

            const { data: chartData, error: chartErr } = await CloudCharts.downloadChartData(c.chart_storage_path);
            if (chartErr) throw chartErr;

            const audioUrl = CloudCharts.getAudioUrl(c.audio_storage_path);
            const audioRes = await fetch(audioUrl);
            if (!audioRes.ok) throw new Error('음악 파일을 불러오지 못했습니다.');
            const audioBlob = await audioRes.blob();

            // 에디터 화면으로 전환 후 차트/음악을 채워넣는다.
            Game.state.gameState = 'editor';
            Editor.init();
            Editor.loadChart(chartData, c.title);
            Editor.loadAudioFromBlob(audioBlob, c.title);
            Editor.setCloudChart({
                id: c.id,
                title: c.title,
                artist: c.artist,
                bpm: c.bpm,
                lane_count: c.lane_count,
                difficulty_label: c.difficulty_label,
            });
            Editor.setDirty(false);

            setTimeout(() => {
                Editor.drawTimeline();
                Editor.renderNotes();
            }, 0);
        } catch (err) {
            alert('차트를 불러오지 못했습니다: ' + err.message);
            if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
        }
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
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── 에디터 업로드 모달 ────────────────────────────────────────────────────────
const UploadModal = {
    _mode: 'upload', // 'upload' | 'update'
    _chartId: null,

    open(mode = 'upload', chartId = null) {
        this._mode = mode;
        this._chartId = chartId;
        const modal = document.getElementById('upload-modal');
        if (!modal) return;

        // 에디터 현재 차트 정보로 기본값 채우기
        const editorChart = Editor.getChartData?.();
        const cloudChart = Editor.state?.cloudChart || null;
        document.getElementById('upload-title').value = cloudChart?.title || editorChart?.songName || '';
        document.getElementById('upload-bpm').value = cloudChart?.bpm || editorChart?.bpm || '';
        document.getElementById('upload-lanes').value = cloudChart?.lane_count || editorChart?.laneCount || 4;
        if (cloudChart) {
            // 기존 차트를 편집하는 경우에만 아티스트/난이도까지 원래 값으로 채운다.
            document.getElementById('upload-artist').value = cloudChart.artist || '';
            document.getElementById('upload-diff').value = cloudChart.difficulty_label || '';
        }

        document.getElementById('upload-modal-title').textContent =
            mode === 'upload' ? '차트 업로드' : '차트 업데이트';
        document.getElementById('upload-submit-btn').textContent =
            mode === 'upload' ? '업로드' : '업데이트';
        document.getElementById('upload-audio-required').textContent =
            mode === 'upload' ? '(필수)' : '(선택 — 비워두면 기존 파일 유지)';

        modal.style.display = 'flex';
    },

    close() {
        const modal = document.getElementById('upload-modal');
        if (modal) modal.style.display = 'none';
        document.getElementById('upload-audio-input').value = '';
    },

    async submit() {
        const title = document.getElementById('upload-title').value.trim();
        const artist = document.getElementById('upload-artist').value.trim();
        const bpm = parseFloat(document.getElementById('upload-bpm').value) || null;
        const laneCount = parseInt(document.getElementById('upload-lanes').value) || 4;
        const diff = document.getElementById('upload-diff').value.trim();
        const audioFile = document.getElementById('upload-audio-input').files[0] || null;

        if (!title) { alert('제목을 입력해주세요.'); return; }

        const submitBtn = document.getElementById('upload-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = '처리 중…';

        try {
            const chartData = Editor.getChartData?.();
            if (!chartData) throw new Error('에디터에서 차트 데이터를 가져올 수 없습니다.');

            const meta = { title, artist, bpm, lane_count: laneCount, difficulty_label: diff };

            let result;
            if (this._mode === 'upload') {
                if (!audioFile) { alert('음악 파일을 선택해주세요.'); return; }
                result = await CloudCharts.uploadChart(meta, chartData, audioFile);
            } else {
                result = await CloudCharts.updateChart(this._chartId, meta, chartData, audioFile);
            }

            if (result.error) throw result.error;

            // 업로드/업데이트 성공 시점의 메타로 cloudChart를 갱신해서,
            // 같은 에디터 세션에서 다시 업로드 버튼을 눌러도 "업데이트"로 동작하게 한다.
            if (result.data) {
                Editor.setCloudChart?.({
                    id: result.data.id,
                    title: result.data.title,
                    artist: result.data.artist,
                    bpm: result.data.bpm,
                    lane_count: result.data.lane_count,
                    difficulty_label: result.data.difficulty_label,
                });
            }

            alert(this._mode === 'upload' ? '업로드 완료!' : '업데이트 완료!');
            this.close();
        } catch (err) {
            alert('오류: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = this._mode === 'upload' ? '업로드' : '업데이트';
        }
    },
};

// ── 결과 화면 점수 제출 ────────────────────────────────────────────────────────
async function submitOnlineScore() {
    const chartId = Game.state._onlineChartId;
    if (!chartId) return;

    const { perfect, good, bad, miss } = Game.state.judgements;
    const totalJudged = perfect + good + bad + miss;
    const accuracy = totalJudged > 0
        ? ((perfect * 100 + good * 50) / (totalJudged * 100)) * 100
        : 0;

    const { data, error } = await CloudScores.submitScore({
        chartId,
        score:       Game.state.score,
        accuracy:    parseFloat(accuracy.toFixed(2)),
        maxCombo:    Game.state.maxCombo || 0,
        judgePerfect: perfect,
        judgeGood:    good,
        judgeMiss:    miss,
    });

    const resultMsg = document.getElementById('online-score-result');
    if (!resultMsg) return;

    if (error) {
        resultMsg.textContent = '점수 등록 실패: ' + error.message;
        resultMsg.className = 'text-sm text-red-400 mt-2';
    } else if (data?.is_new_best) {
        resultMsg.textContent = '🏆 새 최고 기록!';
        resultMsg.className = 'text-sm text-yellow-300 mt-2';
    } else {
        resultMsg.textContent = `기존 최고 기록(${(data?.best_score || 0).toLocaleString()})이 더 높습니다.`;
        resultMsg.className = 'text-sm text-gray-400 mt-2';
    }
}