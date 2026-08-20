// ── Online: 온라인 차트 목록 / 상세 / 내 차트 관리 화면 ───────────────────

const Online = {
    _subView: 'browse',
    _currentChartId: null,
    _currentSongId: null,
    _browseState: { sort: 'newest', search: '', page: 0, pageSize: 20, totalCount: 0 },
    _browseCache: [], // 현재 페이지에 보여줄 아이템만 담는다 (예전처럼 누적하지 않음)
    // 비동기 로딩 중단(취소) 토큰 — _loadBrowse/_showSongDetail/_showDetail/_loadMyCharts는
    // 전부 "화면 갱신 전 네트워크 왕복"을 거치는데, 빠르게 연속 탭하면(모바일에서 흔함)
    // 먼저 시작된 요청이 나중 요청보다 늦게 끝날 수 있다. 그 경우 화면에 반영하면 안 되므로
    // 함수 진입 시 토큰을 발급해 두고, await 이후 토큰이 여전히 최신인지 확인한 뒤에만
    // _setContent/상태 반영을 한다 (AudioEngine._loadToken과 동일한 패턴).
    _loadSeq: 0,
    // 멀티플레이 방 생성용 채보 선택 모드 — pickMode가 true면 상세 화면의 "플레이" 버튼이
    // "이 채보로 방 만들기"로 바뀌고, 뒤로가기가 메뉴 대신 멀티플레이 화면으로 간다.
    // pickMode가 'queue'면 이미 있는 방의 대기열에 채보를 추가하는 모드로 동작하고,
    // 뒤로가기는 대기실로 돌아간다(방을 나가지 않음).
    _pickMode: false,

    // ── 진입점 ────────────────────────────────────────────────────────────────
    // Phase 4: 홈(browse, 노래 목록) → song(노래 상세=난이도 리스트) → detail(난이도 상세=플레이 전 화면) → 플레이
    async show(subView = 'browse', id = null, opts = {}) {
        SongPreview.stop(); // 화면 전환 시 이전 미리듣기(오디오/노트 미리보기)는 항상 정리
        if (opts.pickMode !== undefined) this._pickMode = opts.pickMode;
        this._subView = subView;
        UI.showScreen('online');
        this._renderShell();
        if (subView === 'browse')                    await this._loadBrowse(true);
        else if (subView === 'my')                   await this._loadMyCharts();
        else if (subView === 'song' && id)           await this._showSongDetail(id);
        else if (subView === 'detail' && id)         await this._showDetail(id);
    },

    // ── 공통 레이아웃 쉘 ─────────────────────────────────────────────────────
    _renderShell() {
        const el = document.getElementById('online-screen');
        // 방 생성용 채보 선택 모드에서는 비공개일 수 있는 "내 차트" 탭은 숨긴다
        // (같이 플레이하는 상대도 같은 채보를 받아야 하므로 공개 라이브러리만 허용).
        const myTabHtml = this._pickMode ? '' : `
                <button id="online-tab-my" class="flex-1 py-2 rounded-lg text-sm font-semibold transition
                    ${this._subView === 'my' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">
                    📁 내 차트
                </button>`;
        el.innerHTML = `
        <div class="flex flex-col h-full text-white">
            ${this._pickMode ? `<p class="mb-3 text-xs text-teal-400 flex-shrink-0">🎮 ${this._pickMode === 'queue' ? '대기열에 추가할 채보를 골라주세요.' : '멀티플레이 방을 만들 채보를 골라주세요.'}</p>` : ''}
            <div class="flex items-center space-x-2 mb-4 flex-shrink-0">
                <button id="online-tab-browse" class="flex-1 py-2 rounded-lg text-sm font-semibold transition
                    ${this._subView !== 'my' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">
                    🌐 공개 라이브러리
                </button>
                ${myTabHtml}
                <button id="online-back-btn" class="py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex-shrink-0">
                    ${this._pickMode === 'queue' ? '← 대기실' : (this._pickMode ? '← 멀티플레이' : '← 메뉴')}
                </button>
            </div>
            <div id="online-content" class="flex-1 min-h-0 overflow-y-auto"></div>
        </div>`;

        document.getElementById('online-tab-browse').addEventListener('click', () => this.show('browse'));
        document.getElementById('online-tab-my')?.addEventListener('click', () => this.show('my'));
        document.getElementById('online-back-btn').addEventListener('click', () => {
            this._loadSeq++; // 이 시점에 아직 안 끝난 로딩(오디오 미리듣기 포함)은 전부 무효화
            SongPreview.stop();
            GameBackground.clear();
            if (this._pickMode === 'queue') {
                this._pickMode = false;
                MultiplayerLobby.cancelQueuePick();
            } else if (this._pickMode) {
                this._pickMode = false;
                MultiplayerLobby.show();
            } else {
                Game.state.gameState = 'menu';
                UI.showScreen('menu');
            }
        });
    },

    _setContent(html) { document.getElementById('online-content').innerHTML = html; },

    // 별점(difficulty_score) → 10점 만점 난이도 수치 배지.
    // 산정 난이도(채보 지표 기반)이며 플레이 통계와 무관함을 시각적으로도 분리해서 보여준다.
    _starRatingHtml(difficultyScore, sizeCls = 'text-xs') {
        const rating = Difficulty.toRating(difficultyScore);
        const color = this._ratingColorRgb(rating);
        return `
        <span class="inline-flex items-center gap-1 ${sizeCls} flex-shrink-0" title="산정 난이도 (채보 지표 기반, 플레이 기록과 무관)">
            <span class="font-mono font-bold px-1.5 py-0.5 rounded" style="background:${this._rgba(color, 0.13)};color:${this._rgba(color, 1)};border:1px solid ${this._rgba(color, 0.4)};">★ ${rating.toFixed(2)}</span>
        </span>`;
    },

    // 노래 카드용: 그 노래가 가진 공개 난이도들의 [최저-최고] 별점 범위 배지.
    // 왼쪽(최저)은 최저 별점 색, 오른쪽(최고)은 최고 별점 색이 되도록 텍스트/배경에
    // 좌→우 그라디언트를 적용해 난이도 스펙트럼을 한눈에 보여준다.
    _starRatingRangeHtml(minDifficultyScore, maxDifficultyScore, sizeCls = 'text-xs') {
        // 난이도가 하나뿐이면(최저==최고) 범위 표기 대신 단일 값으로 표시.
        if (minDifficultyScore === maxDifficultyScore) {
            return this._starRatingHtml(maxDifficultyScore, sizeCls);
        }

        const minRating = Difficulty.toRating(minDifficultyScore);
        const maxRating = Difficulty.toRating(maxDifficultyScore);
        const colorMin = this._ratingColorRgb(minRating);
        const colorMax = this._ratingColorRgb(maxRating);
        const gradSolid = `linear-gradient(90deg, ${this._rgba(colorMin, 1)}, ${this._rgba(colorMax, 1)})`;
        const gradFaint = `linear-gradient(90deg, ${this._rgba(colorMin, 0.13)}, ${this._rgba(colorMax, 0.13)})`;

        return `
        <span class="inline-flex items-center gap-1 ${sizeCls} flex-shrink-0" title="공개 난이도 별점 범위 (최저~최고, 채보 지표 기반)">
            <span class="font-mono font-bold px-1.5 py-0.5 rounded" style="background:${gradFaint}; border:1px solid ${this._rgba(colorMax, 0.4)};">
                <span style="background:${gradSolid}; -webkit-background-clip:text; background-clip:text; color:transparent;">[ ★ ${minRating.toFixed(2)}-${maxRating.toFixed(2)} ]</span>
            </span>
        </span>`;
    },

    // 색상 [r,g,b] 배열 → rgba(...) 문자열.
    _rgba(rgb, alpha) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; },

    // 난이도 수치(0~10)에 따른 색상 — 초록(쉬움) → 노랑 → 주황 → 빨강(어려움) 순으로
    // 연속적으로 보간되는 스펙트럼. 구간 사이는 RGB 선형 보간으로 부드럽게 이어진다.
    _ratingColorRgb(rating) {
        const stops = [
            { at: 0, color: [99, 179, 237] },   // 매우 쉬움 (파랑) #63b3ed
            { at: 2, color: [104, 211, 145] },  // 쉬움 (초록) #68d391
            { at: 4, color: [255, 215, 0] },    // 보통 (금색/노랑) #ffd700
            { at: 6, color: [246, 173, 85] },   // 어려움 (주황) #f6ad55
            { at: 8, color: [252, 129, 129] },  // 매우 어려움 (빨강) #fc8181
        ];
        const r = Math.max(0, Math.min(10, rating));
        let lo = stops[0], hi = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
            if (r >= stops[i].at && r <= stops[i + 1].at) { lo = stops[i]; hi = stops[i + 1]; break; }
        }
        const span = hi.at - lo.at || 1;
        const t = Math.max(0, Math.min(1, (r - lo.at) / span));
        const mix = (a, b) => Math.round(a + (b - a) * t);
        return [mix(lo.color[0], hi.color[0]), mix(lo.color[1], hi.color[1]), mix(lo.color[2], hi.color[2])];
    },

    // (구) hex 기반 색상 API 호환용 — 다른 곳에서 단일 hex 값이 필요하면 사용.
    _ratingColor(rating) {
        const [r, g, b] = this._ratingColorRgb(rating);
        return `rgb(${r}, ${g}, ${b})`;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 공개 라이브러리 탭 — 노래 목록 (Phase 4)
    // ════════════════════════════════════════════════════════════════════════
    async _loadBrowse(reset = false) {
        GameBackground.clear();
        const s = this._browseState;
        if (reset) s.page = 0;
        this._setContent(UI.listSkeletonHtml());
        UI.showAreaLoading('online', '라이브러리 불러오는 중…');
        const seq = ++this._loadSeq;

        const { data, error, count } = await CloudBrowse.listPublicSongs({
            sort: s.sort, search: s.search, page: s.page, pageSize: s.pageSize,
        });
        UI.hideAreaLoading('online');
        if (seq !== this._loadSeq) return; // 그 사이 다른 로딩이 시작됨 — 이 결과는 폐기

        if (error) { this._setContent(`<p class="text-red-400 text-sm mt-4">${error.message}</p>`); return; }
        this._browseCache = data || [];
        s.totalCount = count || 0;
        this._renderBrowse();
    },

    _renderBrowse() {
        const s = this._browseState;
        const items = this._browseCache;
        const cards = items.length === 0
            ? '<p class="text-gray-400 text-sm mt-8 text-center">차트가 없습니다.</p>'
            : items.map(c => this._chartCard(c)).join('');

        this._setContent(`
        <div class="flex space-x-2 mb-4">
            <input id="online-search" type="text" placeholder="제목 / 아티스트 검색…" value="${_esc(s.search)}"
                class="flex-1 p-2 bg-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
            <select id="online-sort" class="px-2 py-2 bg-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="newest" ${s.sort === 'newest' ? 'selected' : ''}>최신순</option>
                <option value="popular" ${s.sort === 'popular' ? 'selected' : ''}>인기순</option>
                <option value="likes" ${s.sort === 'likes' ? 'selected' : ''}>좋아요순</option>
                <option value="difficulty" ${s.sort === 'difficulty' ? 'selected' : ''}>난이도순</option>
            </select>
            <button id="online-search-btn" class="px-3 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm">검색</button>
        </div>
        <div id="browse-list" class="space-y-2">${cards}</div>
        ${this._paginationHtml()}
        `);

        document.getElementById('online-content').scrollTop = 0;

        document.getElementById('online-search-btn').addEventListener('click', () => {
            s.search = document.getElementById('online-search').value;
            this._loadBrowse(true);
        });
        document.getElementById('online-search').addEventListener('keydown', e => {
            if (e.key === 'Enter') { s.search = e.target.value; this._loadBrowse(true); }
        });
        document.getElementById('online-sort').addEventListener('change', e => {
            s.sort = e.target.value;
            this._loadBrowse(true);
        });
        document.getElementById('page-prev-btn')?.addEventListener('click', () => {
            if (s.page > 0) { s.page--; this._loadBrowse(false); }
        });
        document.getElementById('page-next-btn')?.addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(s.totalCount / s.pageSize));
            if (s.page < totalPages - 1) { s.page++; this._loadBrowse(false); }
        });
        document.querySelectorAll('.page-btn').forEach(btn =>
            btn.addEventListener('click', () => {
                const p = parseInt(btn.dataset.page, 10) - 1;
                if (p !== s.page) { s.page = p; this._loadBrowse(false); }
            }));
        document.querySelectorAll('.browse-card-btn').forEach(btn =>
            btn.addEventListener('click', () => this.show('song', btn.dataset.id)));
    },

    // "< [1] 2 3 4 5 ... >" 형태의 페이지네이션 바. 전체 1페이지 이하면 아예 숨긴다.
    _paginationHtml() {
        const s = this._browseState;
        const totalPages = Math.max(1, Math.ceil(s.totalCount / s.pageSize));
        if (totalPages <= 1) return '';
        const current = s.page + 1; // 표시는 1부터

        const pageBtns = this._pageNumbers(current, totalPages).map(p => (
            p === '...'
                ? `<span class="px-1 text-gray-500">…</span>`
                : `<button class="page-btn px-3 py-1.5 rounded-lg text-sm ${p === current ? 'bg-teal-600 font-semibold' : 'bg-gray-700 hover:bg-gray-600'}" data-page="${p}">${p}</button>`
        )).join('');

        return `
        <div class="flex items-center justify-center flex-wrap gap-1 mt-4" style="margin-bottom: var(--safe-bottom, 80px);">
            <button id="page-prev-btn" class="px-2 py-1.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-40" ${current === 1 ? 'disabled' : ''}>&lt;</button>
            ${pageBtns}
            <button id="page-next-btn" class="px-2 py-1.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-40" ${current === totalPages ? 'disabled' : ''}>&gt;</button>
        </div>`;
    },

    // 현재 페이지 기준 양 끝(1, 마지막) + 현재 주변 2개만 숫자로 보여주고 나머지는 '...'로 생략.
    _pageNumbers(current, total) {
        const delta = 2;
        const keep = [];
        for (let i = 1; i <= total; i++) {
            if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) keep.push(i);
        }
        const result = [];
        let prev = 0;
        for (const i of keep) {
            if (prev && i - prev > 1) result.push('...');
            result.push(i);
            prev = i;
        }
        return result;
    },

    // 노래 카드: 난이도 개수 / 레인 수 범위 / 총 플레이 수 요약만 보여준다.
    // 실제 난이도 선택은 song 상세 화면(_showSongDetail)에서 한다.
    _chartCard(s) {
        const laneRange = s.laneCountMin == null
            ? '—'
            : (s.laneCountMin === s.laneCountMax ? `${s.laneCountMin}키` : `${s.laneCountMin}~${s.laneCountMax}키`);
        const dateLine = _formatDateLine(s.created_at, s.updated_at);

        // 커버 사진이 있으면 카드 오른쪽에 은은하게 걸리도록 배경으로 깐다.
        // 왼쪽(제목/아티스트 텍스트 자리)은 카드 배경색(bg-gray-800 = #1f2937)으로
        // 완전히 덮어 가독성을 지키고, 오른쪽으로 갈수록 사진이 자연스럽게 드러나게 함.
        // (utilities.css에 그라데이션 유틸이 없어서 인라인 style로 처리)
        const coverUrl = CloudCharts.getCoverUrl(s.cover_storage_path);
        const bgStyle = coverUrl
            ? ` style="background-image: linear-gradient(to right, #1f2937 0%, #1f2937 35%, transparent 100%), url('${coverUrl}'); background-size: cover; background-position: center;"`
            : '';

        return `
        <button class="browse-card-btn w-full text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition overflow-hidden" data-id="${s.id}"${bgStyle}>
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white truncate">${_esc(s.title)}</p>
                    <p class="text-sm text-gray-400 truncate">${_esc(s.artist || '—')}</p>
                    ${dateLine ? `<p class="text-xs text-gray-500 mt-1">${dateLine}</p>` : ''}
                </div>
                <div class="flex flex-col items-end space-y-1 ml-2 flex-shrink-0">
                    ${s.maxDifficultyScore != null ? this._starRatingRangeHtml(s.minDifficultyScore, s.maxDifficultyScore) : ''}
                    <span class="text-xs px-1.5 py-0.5 bg-gray-600 rounded">난이도 ${s.beatmapCount}개</span>
                    <span class="text-xs text-gray-400">${laneRange}</span>
                    <span class="text-xs text-gray-500">▶ ${s.totalPlayCount} · ♥ ${s.totalLikeCount || 0}</span>
                </div>
            </div>
        </button>`;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 노래 상세 — 난이도(beatmap) 선택 화면
    // ════════════════════════════════════════════════════════════════════════
    async _showSongDetail(songId) {
        this._currentSongId = songId;
        this._setContent(UI.staticSkeletonHtml());
        UI.showAreaLoading('online', '노래 정보 불러오는 중…');
        const seq = ++this._loadSeq;

        const { data, error } = await CloudBrowse.getSongDetail(songId);
        UI.hideAreaLoading('online');
        if (seq !== this._loadSeq) return; // 그 사이 다른 곳으로 이동함
        if (error) {
            this._setContent(`<p class="text-red-400 text-sm">${error.message}</p>`);
            return;
        }

        const { song, beatmaps } = data;
        GameBackground.set(CloudCharts.getCoverUrl(song.cover_storage_path));
        const nickMap = await CloudAuth._fetchNicknameMap(beatmaps.map(bm => bm.owner_id).filter(Boolean));
        if (seq !== this._loadSeq) return;
        const { data: likeInfo } = await CloudLikes.getLikeInfo(beatmaps.map(bm => bm.id));
        if (seq !== this._loadSeq) return;
        const cards = beatmaps.length === 0
            ? '<p class="text-gray-400 text-sm text-center mt-8">등록된 난이도가 없습니다.</p>'
            : beatmaps.map(bm => this._beatmapCard(bm, nickMap, likeInfo || {})).join('');

        this._setContent(`
        <button id="song-back-btn" class="mb-3 text-sm text-gray-400 hover:text-white transition">← 목록으로</button>
        <div class="p-4 bg-gray-800 rounded-lg mb-4">
            <h2 class="text-xl font-bold text-white truncate">${_esc(song.title)}</h2>
            <p class="text-gray-400 truncate">${_esc(song.artist || '—')}</p>
            ${_formatDateLine(song.created_at, song.updated_at) ? `<p class="text-xs text-gray-500 mt-1">${_formatDateLine(song.created_at, song.updated_at)}</p>` : ''}
        </div>
        <h3 class="text-sm font-semibold text-gray-300 mb-2">난이도 선택</h3>
        <div class="space-y-2">${cards}</div>
        `);

        document.getElementById('song-back-btn').addEventListener('click', () => {
            this._loadSeq++; // 진행 중이던 상세 로딩/미리듣기 요청 무효화
            SongPreview.stop();
            GameBackground.clear();
            this._subView = 'browse';
            this._renderShell();
            this._renderBrowse();
        });
        document.querySelectorAll('.beatmap-card-btn').forEach(btn =>
            btn.addEventListener('click', () => this.show('detail', btn.dataset.id)));

        // 노래 미리듣기 — 화면 진입 시 자동 재생, 오디오가 없으면 조용히 무시
        if (song.audio_storage_path) {
            SongPreview.playAudio(CloudCharts.getAudioUrl(song.audio_storage_path), song.preview_start_ms || 0);
        }
    },

    _beatmapCard(bm, nickMap = {}, likeInfo = {}) {
        const laneBadge = `<span class="text-xs px-1.5 py-0.5 bg-gray-600 rounded flex-shrink-0">${bm.lane_count}키</span>`;
        const label = bm.difficulty_label ? _esc(bm.difficulty_label) : '기본';
        const creatorName = bm.owner_id
            ? (nickMap[bm.owner_id] ? _esc(nickMap[bm.owner_id]) : `${_esc(bm.owner_id.slice(0, 8))}…`)
            : '';
        const dateLine = _formatDateLine(bm.created_at, bm.updated_at);
        const likeCount = likeInfo[bm.id]?.count || 0;
        return `
        <button class="beatmap-card-btn w-full text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition" data-id="${bm.id}">
            <div class="flex justify-between items-center">
                <div class="flex items-center space-x-2 min-w-0">
                    ${laneBadge}
                    <span class="text-sm text-gray-300 truncate">${label}</span>
                    ${bm.bpm ? `<span class="text-xs text-gray-500 flex-shrink-0">BPM ${bm.bpm}</span>` : ''}
                    ${this._starRatingHtml(bm.difficulty_score)}
                </div>
                <div class="flex items-center space-x-2 flex-shrink-0 text-xs text-gray-400">
                    <span>${bm.note_count}노트</span>
                    <span>▶ ${bm.play_count}</span>
                    <span>♥ ${likeCount}</span>
                </div>
            </div>
            ${creatorName ? `<div class="mt-1 text-xs text-gray-500 truncate">제작자: ${creatorName}</div>` : ''}
            ${dateLine ? `<div class="mt-0.5 text-xs text-gray-500 truncate">${dateLine}</div>` : ''}
        </button>`;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 난이도(beatmap) 상세 = 플레이 전 화면 + 리더보드
    // ════════════════════════════════════════════════════════════════════════
    async _showDetail(chartId) {
        this._currentChartId = chartId;
        this._setContent(UI.staticSkeletonHtml());
        UI.showAreaLoading('online', '채보 정보 불러오는 중…');
        const seq = ++this._loadSeq;

        const [detailRes, lbRes, myRes, currentUser, likeRes] = await Promise.all([
            CloudBrowse.getBeatmapDetail(chartId),
            CloudScores.getLeaderboard(chartId, 10),
            CloudScores.getMyScore(chartId),
            CloudAuth.getUser(),
            CloudLikes.getLikeInfo([chartId]),
        ]);
        UI.hideAreaLoading('online');
        if (seq !== this._loadSeq) return; // 그 사이 다른 곳으로 이동함

        if (detailRes.error) {
            this._setContent(`<p class="text-red-400 text-sm">${detailRes.error.message}</p>`);
            return;
        }

        const c = detailRes.data;
        const lb = lbRes.data || [];
        const myScore = myRes.data;
        const like = (likeRes.data && likeRes.data[chartId]) || { count: 0, likedByMe: false };
        GameBackground.set(CloudCharts.getCoverUrl(c.cover_storage_path));
        const creatorNickMap = c.owner_id ? await CloudAuth._fetchNicknameMap([c.owner_id]) : {};
        if (seq !== this._loadSeq) return;
        const creatorName = c.owner_id
            ? (creatorNickMap[c.owner_id] ? _esc(creatorNickMap[c.owner_id]) : `${_esc(c.owner_id.slice(0, 8))}…`)
            : '';

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
                const rank = UI.rankFromJudgements(s.judge_perfect, s.judge_good, s.judge_bad, s.judge_miss);
                const rankBadge = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
                const rowCls = isMe
                    ? 'bg-teal-900 border border-teal-600 rounded'
                    : 'border-b border-gray-700';
                return `
                <div class="flex items-center justify-between py-2 px-2 ${rowCls} text-sm ${isMe ? 'text-teal-200' : 'text-gray-300'}">
                    <span class="w-7 text-center font-bold flex-shrink-0">${rankBadge}</span>
                    <span class="flex-1 px-2 truncate font-medium">${displayName}${isMe ? ' <span class="text-xs text-teal-400 ml-1">(나)</span>' : ''}</span>
                    <span class="${_rankGradeClass(rank)} font-bold w-6 text-center flex-shrink-0">${rank}</span>
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
            const myGrade = UI.rankFromJudgements(myScore.judge_perfect, myScore.judge_good, myScore.judge_bad, myScore.judge_miss);
            const p = myScore.judge_perfect || 0;
            const g = myScore.judge_good    || 0;
            const b = myScore.judge_bad     || 0;
            const m = myScore.judge_miss    || 0;
            myPanel = `
            <div class="mt-3 p-3 bg-teal-950 border border-teal-700 rounded-lg">
                <div class="flex justify-between items-center text-sm text-teal-200">
                    <span class="font-semibold">내 최고 기록 <span class="text-xs text-teal-400">(${rankTxt})</span></span>
                    <span class="flex items-center gap-2">
                        <span class="${_rankGradeClass(myGrade)} font-bold text-base">${myGrade}</span>
                        <span class="font-mono font-bold text-base">${myScore.score.toLocaleString()}</span>
                    </span>
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-teal-400">
                    <span>정확도 ${(+(myScore.accuracy) || 0).toFixed(1)}%</span>
                    <span>최대 콤보 ${myScore.max_combo}</span>
                    <span>P ${p} / G ${g} / B ${b} / M ${m}</span>
                </div>
            </div>`;
        } else {
            myPanel = `<p class="mt-3 text-xs text-gray-500 text-center">아직 이 차트를 플레이하지 않았습니다.</p>`;
        }

        this._setContent(`
        <button id="detail-back-btn" class="mb-3 text-sm text-gray-400 hover:text-white transition">← 난이도 선택으로</button>
        <div class="p-4 bg-gray-800 rounded-lg mb-3">
            <h2 class="text-xl font-bold text-white truncate">${_esc(c.title)}</h2>
            <p class="text-gray-400 truncate">${_esc(c.artist || '—')}</p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-400">
                ${this._starRatingHtml(c.difficulty_score, 'text-sm')}
                ${c.bpm             ? `<span>BPM ${c.bpm}</span>` : ''}
                <span>${c.lane_count}키</span>
                ${c.difficulty_label ? `<span>${_esc(c.difficulty_label)}</span>` : ''}
                <span>${c.note_count}노트</span>
                <span>▶ ${c.play_count}회</span>
                ${creatorName ? `<span>제작자: ${creatorName}</span>` : ''}
            </div>
            ${_formatDateLine(c.created_at, c.updated_at) ? `<div class="mt-1 text-xs text-gray-500">${_formatDateLine(c.created_at, c.updated_at)}</div>` : ''}
            ${c.use_custom_fall_speed ? `<div class="mt-2 px-2 py-1 bg-blue-950 border border-blue-700 rounded text-xs text-blue-300 inline-block">⚡ 이 비트맵은 전용 하강 속도를 사용합니다.</div>` : ''}
        </div>
        <button id="detail-like-btn" data-liked="${like.likedByMe ? '1' : '0'}"
            class="w-full py-2 mb-4 rounded-lg font-semibold transition text-sm
            ${like.likedByMe ? 'bg-pink-700 hover:bg-pink-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}">
            <span id="detail-like-icon">${like.likedByMe ? '♥' : '♡'}</span> 좋아요 <span id="detail-like-count">${like.count}</span>
        </button>
        <div id="online-preview-hint" class="mb-4 p-3 bg-gray-800 rounded-lg text-center text-xs text-gray-400">
            ${UI.loadingInlineHtml()}
        </div>
        <button id="detail-play-btn" class="w-full py-3 mb-4 rounded-lg font-bold transition text-lg
            ${this._pickMode === 'queue' ? 'bg-teal-600 hover:bg-teal-500' : (this._pickMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-blue-600 hover:bg-blue-500')}">
            ${this._pickMode === 'queue' ? '➕ 대기열에 추가' : (this._pickMode ? '🎮 이 채보로 방 만들기' : '▶ 플레이')}
        </button>
        <div class="bg-gray-800 rounded-lg p-3">
            <h3 class="text-sm font-semibold text-gray-300 mb-2">🏆 리더보드 TOP 10</h3>
            <div class="space-y-0.5">${lbRows}</div>
            ${myPanel}
        </div>
        `);

        document.getElementById('detail-back-btn').addEventListener('click', () => {
            this._loadSeq++; // 진행 중이던 미리보기(_startDetailPreview) 요청 무효화
            SongPreview.stop();
            if (this._currentSongId) this.show('song', this._currentSongId);
            else { this._subView = 'browse'; this._renderShell(); this._renderBrowse(); }
        });
        document.getElementById('detail-play-btn').addEventListener('click', () => {
            if (this._pickMode === 'queue') this._addToQueueFromDetail(c);
            else if (this._pickMode) this._hostRoomFromDetail(c);
            else this._playOnlineChart(c);
        });
        document.getElementById('detail-like-btn').addEventListener('click', () => this._toggleLike(c.id));

        // 플레이 전 미리보기 — 노래(오디오) + 에디터와 동일한 방식의 노트 낙하 미리보기를
        // 실제 플레이 화면 크기로 크게 보여준다. 차트 데이터 다운로드가 실패해도
        // 오디오만이라도 재생되도록 별도 try/catch로 감싼다.
        this._startDetailPreview(c);
    },

    async _startDetailPreview(c) {
        const hintEl = document.getElementById('online-preview-hint');
        const seq = this._loadSeq; // _showDetail이 이미 발급해 둔 토큰을 그대로 이어받는다
        try {
            const { data: chartData, error } = await CloudCharts.downloadChartData(c.chart_storage_path);
            // 그 사이 다른 난이도/화면으로 이동했으면 무시 (currentChartId + 전역 토큰 이중 확인)
            if (this._currentChartId !== c.id || seq !== this._loadSeq) return;
            if (error) throw error;
            await SongPreview.start({
                chartData,
                audioUrl: CloudCharts.getAudioUrl(c.audio_storage_path),
                // 노트 미리보기는 실제 플레이와 동일하게 항상 처음(0)부터 재생한다.
                // preview_start_ms는 난이도 선택(노래 상세) 화면의 "미리듣기"에만 쓰인다 —
                // 여기서 그 값을 그대로 쓰면 노트 타이밍과 어긋나 노트가 하나도 안 보일 수 있다.
                previewStartMs: 0,
                laneCount: c.lane_count || chartData.laneCount || 4,
            });
            if (this._currentChartId !== c.id || seq !== this._loadSeq) { SongPreview.stop(); return; }
            if (hintEl) hintEl.textContent = '◀ 왼쪽 게임 화면에서 미리보기가 재생됩니다.';
        } catch (err) {
            // 노트 미리보기 실패 시에도 오디오 미리듣기는 시도한다.
            if (this._currentChartId !== c.id || seq !== this._loadSeq) return;
            SongPreview.playAudio(CloudCharts.getAudioUrl(c.audio_storage_path), c.preview_start_ms || 0);
            if (hintEl) hintEl.textContent = '🎵 노래 미리듣기만 재생 중입니다.';
        }
    },

    // ── 멀티플레이 방 생성(채보 선택 모드에서 "이 채보로 방 만들기") ─────────────
    async _hostRoomFromDetail(c) {
        SongPreview.stop();
        const btn = document.getElementById('detail-play-btn');
        btn.disabled = true;
        btn.innerHTML = UI.loadingInlineHtml('방 만드는 중…');
        this._pickMode = false;
        GameBackground.clear();
        await MultiplayerLobby.hostRoom(c);
        // 성공/실패 여부와 관계없이 화면 전환은 MultiplayerLobby가 담당한다
        // (성공 시 대기실로, 실패 시 멀티플레이 메뉴로).
    },

    // ── 대기열에 채보 추가(대기실에서 "+ 채보 추가"로 진입한 pickMode:'queue') ────
    async _addToQueueFromDetail(c) {
        SongPreview.stop();
        const btn = document.getElementById('detail-play-btn');
        btn.disabled = true;
        btn.innerHTML = UI.loadingInlineHtml('추가하는 중…');
        this._pickMode = false;
        GameBackground.clear();
        await MultiplayerLobby.addToQueue(c.id);
        // 화면 전환(대기실로 복귀)은 MultiplayerLobby.addToQueue가 담당한다.
    },

    // ── 온라인 차트 플레이 ────────────────────────────────────────────────────
    async _playOnlineChart(c) {
        SongPreview.stop();
        const btn = document.getElementById('detail-play-btn');
        btn.disabled = true;
        btn.innerHTML = UI.loadingInlineHtml();

        try {
            const { data: chartData, error: cdErr } = await CloudCharts.downloadChartData(c.chart_storage_path);
            if (cdErr) throw cdErr;

            const audioUrl = CloudCharts.getAudioUrl(c.audio_storage_path);

            // 채보 파일에 저장된 startTimeOffset(노트 타이밍 기준점)은 무시하고
            // 노래의 start_offset_ms(종합 창 "시작(초)")로 덮어쓴다.
            // 그래야 오디오 재생 시작 위치(songStartOffset)와 노트 타이밍 기준점이 항상 일치한다
            // (안 그러면 종합 창에서 "시작(초)"를 바꿔도 노트 타이밍에는 반영되지 않는 문제가 생긴다).
            chartData.startTimeOffset = (c.start_offset_ms || 0) / 1000;

            Game.loadChartNotes(chartData);
            Game.state._onlineChartId = c.id;
            Game.state.settings.mode = 'music';
            Game.state.settings.musicSrc = audioUrl;
            Game.state.settings.songStartOffset = (c.start_offset_ms || 0) / 1000;
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
        GameBackground.clear();
        this._setContent(UI.listSkeletonHtml());
        UI.showAreaLoading('online', '내 차트 불러오는 중…');
        const seq = ++this._loadSeq;

        const user = await CloudAuth.getUser();
        if (seq !== this._loadSeq) return; // 그 사이 다른 곳으로 이동함
        if (!user) {
            UI.hideAreaLoading('online');
            this._setContent(`
            <div class="text-center mt-10">
                <p class="text-gray-400 mb-4">내 차트를 보려면 로그인이 필요합니다.</p>
                <button id="my-login-btn" class="py-2 px-6 bg-teal-600 hover:bg-teal-500 rounded-lg">로그인</button>
            </div>`);
            document.getElementById('my-login-btn')?.addEventListener('click', () => {
                if (typeof _openLoginModal === 'function') _openLoginModal();
                else document.querySelector('.account-icon-btn')?.click();
            });
            return;
        }

        const { data, error } = await CloudCharts.listMyCharts();
        if (seq !== this._loadSeq) return;
        if (error) { UI.hideAreaLoading('online'); this._setContent(`<p class="text-red-400 text-sm">${error.message}</p>`); return; }

        const { data: songs, error: songsError } = await CloudCharts.listMySongs();
        UI.hideAreaLoading('online');
        if (seq !== this._loadSeq) return;
        if (songsError) { this._setContent(`<p class="text-red-400 text-sm">${songsError.message}</p>`); return; }

        const songCards = (songs || []).length === 0
            ? '<p class="text-gray-400 text-sm text-center mt-4">업로드한 노래가 없습니다.</p>'
            : (songs || []).map(s => this._mySongCard(s)).join('');

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
        <!-- 내 업로드 노래 목록 (song 단위 — 삭제 시 딸린 난이도/오디오까지 함께 삭제) -->
        <h3 class="text-sm font-semibold text-gray-300 mb-2">🎵 내 업로드 노래</h3>
        <div class="space-y-2 mb-4">${songCards}</div>
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
                    const rawChartData = JSON.parse(ev.target.result);
                    const normalized = ChartFormat.normalize(rawChartData);
                    if (normalized.beatmapCount > 1) {
                        UI.showMessage('online', `이 파일에는 난이도가 ${normalized.beatmapCount}개 있습니다. 첫 번째 난이도로 플레이합니다.`);
                    }
                    const chartData = { songName: normalized.songName, ...normalized.beatmap };
                    Game.loadChartNotes(chartData);
                    Game.state.settings.mode = 'music';
                    Game.state.settings.songStartOffset = 0;
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
        document.querySelectorAll('.my-song-delete-btn').forEach(btn =>
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this._deleteMySong(btn.dataset.id, btn.dataset.title);
            }));
        // 내 차트에서 직접 리더보드 열기
        document.querySelectorAll('.my-lb-btn').forEach(btn =>
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this.show('detail', btn.dataset.id);
            }));
    },

    _mySongCard(s) {
        const pub = s.is_public
            ? '<span class="text-xs text-green-400">공개</span>'
            : '<span class="text-xs text-gray-500">비공개</span>';
        return `
        <div class="p-3 bg-gray-800 rounded-lg">
            <div class="flex items-center space-x-2">
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white truncate">${_esc(s.title || '(제목 없음)')}</p>
                    <p class="text-xs text-gray-400 truncate">${_esc(s.artist || '—')} · 난이도 ${s.beatmapCount}개</p>
                </div>
                <div class="flex items-center space-x-1 flex-shrink-0">
                    ${pub}
                    <button class="my-song-delete-btn py-1 px-2 bg-red-800 hover:bg-red-700 rounded text-xs"
                        data-id="${s.id}" data-title="${_esc(s.title || '(제목 없음)')}">삭제</button>
                </div>
            </div>
        </div>`;
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

    async _deleteMySong(songId, title) {
        if (!confirm(`"${title}" 노래를 삭제하시겠습니까?\n이 노래에 속한 모든 난이도와 음악 파일이 함께 삭제되며, 되돌릴 수 없습니다.`)) return;
        const { error } = await CloudCharts.deleteSong(songId);
        if (error) { alert('삭제 오류: ' + error.message); return; }
        await this._loadMyCharts();
    },

    // ── 난이도(beatmap) 상세 화면의 좋아요 버튼 토글 ─────────────────────────
    async _toggleLike(chartId) {
        const btn = document.getElementById('detail-like-btn');
        if (!btn) return;

        const user = await CloudAuth.getUser();
        if (!user) {
            UI.showMessage('online', '로그인이 필요합니다. 우측 상단 계정 아이콘을 클릭해주세요.');
            return;
        }

        const currentlyLiked = btn.dataset.liked === '1';
        btn.disabled = true;
        const { error } = await CloudLikes.toggle(chartId, currentlyLiked);
        btn.disabled = false;
        if (error) { alert('좋아요 처리 오류: ' + error.message); return; }

        const nowLiked = !currentlyLiked;
        btn.dataset.liked = nowLiked ? '1' : '0';
        btn.className = `w-full py-2 mb-4 rounded-lg font-semibold transition text-sm
            ${nowLiked ? 'bg-pink-700 hover:bg-pink-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`;
        const iconEl = document.getElementById('detail-like-icon');
        const countEl = document.getElementById('detail-like-count');
        if (iconEl) iconEl.textContent = nowLiked ? '♥' : '♡';
        if (countEl) countEl.textContent = String((+countEl.textContent || 0) + (nowLiked ? 1 : -1));
    },
};

// ── HTML 이스케이프 헬퍼 ──────────────────────────────────────────────────────
function _esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 업로드 날짜 / 최근 수정 날짜 표시 헬퍼 ─────────────────────────────────────
// created_at과 updated_at이 같은 날이면 업로드 날짜만, 다르면 둘 다 보여준다.
function _formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
function _formatDateLine(createdAt, updatedAt) {
    const uploaded = _formatShortDate(createdAt);
    if (!uploaded) return '';
    const updated = _formatShortDate(updatedAt);
    return (updated && updated !== uploaded)
        ? `업로드 ${uploaded} · 수정 ${updated}`
        : `업로드 ${uploaded}`;
}

// ── 랭크(S/A/B/C) 등급별 색상 클래스 ──────────────────────────────────────────
function _rankGradeClass(rank) {
    switch (rank) {
        case 'S': return 'text-yellow-400';
        case 'A': return 'text-teal-400';
        case 'B': return 'text-blue-400';
        default:  return 'text-gray-400';
    }
}

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
        judgeBad:     bad,
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

    // "리더보드 보기" 버튼 표시 — 멀티플레이 결과 화면에서는 전용 버튼(재시작/방으로 돌아가기)을
    // 대신 쓰므로 표시하지 않는다.
    const lbBtn = document.getElementById('result-leaderboard-btn');
    if (lbBtn && !Game.state._multiplayerRoomId) {
        lbBtn.classList.remove('hidden');
        // 중복 리스너 방지 — 새 노드로 교체
        const fresh = lbBtn.cloneNode(true);
        lbBtn.replaceWith(fresh);
        fresh.addEventListener('click', () => Online.show('detail', chartId));
    }
}