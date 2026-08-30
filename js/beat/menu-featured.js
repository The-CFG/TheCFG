// ── MenuFeatured: 메인 메뉴 "추천 비트맵" 카드 ──────────────────────────────
// 공개 채보 중 하나를 무작위로 뽑아 커버/미리듣기 오디오/메타(곡-가수-채보자-난이도)를
// 카드로 보여주고, "이 맵 플레이하러 가기" 버튼으로 바로 플레이 전 화면(Online 'detail')
// 으로 이동시킨다.
//
// 생명주기: js/beat/game/ui.js의 UI.showScreen()이 화면이 'menu'가 될 때 onEnter(),
// 그 외 화면으로 나갈 때 onLeave()를 호출해준다 (여기서 직접 훅을 걸지 않아도 됨).
//
// 추천은 세션당 1번만 뽑는다 — 메뉴를 들락날락할 때마다 다른 곡으로 바뀌면 오히려
// 산만하다. 다른 곡을 보고 싶으면 카드의 "🔀 다른 곡" 버튼으로 수동 재추첨.
const MenuFeatured = {
    _current: null,      // CloudBrowse.getFeaturedBeatmap()의 data
    _loaded: false,       // 세션 중 한 번이라도 성공적으로 뽑았는지
    _loading: false,
    _loadSeq: 0,          // 재추첨/화면 재진입이 겹칠 때 오래된 응답 무시용

    async onEnter() {
        const el = document.getElementById('menu-featured-beatmap');
        if (!el) return;

        if (this._loading) return; // 이미 로딩 중이면 중복 요청 안 함
        if (this._loaded && this._current) {
            // 이미 뽑아둔 곡이 있으면 재조회 없이 카드만 다시 그리고 미리듣기 재생만 재시작
            this._renderCard();
            this._playPreview();
            return;
        }
        await this._load();
    },

    onLeave() {
        SongPreview.stop();
        GameBackground.clear();
    },

    async reroll() {
        await this._load();
    },

    async _load() {
        const seq = ++this._loadSeq;
        this._loading = true;
        this._renderSkeleton();

        const { data, error } = await CloudBrowse.getFeaturedBeatmap();

        if (seq !== this._loadSeq) return; // 그 사이 다른 요청이 들어옴 — 이 응답은 폐기
        this._loading = false;

        if (error || !data) {
            this._current = null;
            this._renderEmpty();
            return;
        }

        this._current = data;
        this._loaded = true;
        this._renderCard();
        this._playPreview();
    },

    _playPreview() {
        const chart = this._current;
        if (!chart || !chart.audio_storage_path) return;
        SongPreview.playAudio(CloudCharts.getAudioUrl(chart.audio_storage_path), chart.preview_start_ms || 0)
            .then(() => this._hideTapOverlay())
            .catch(() => {
                // 제스처 없이 자동재생이 막힌 경우 — 카드를 탭하면 재생되도록 오버레이 표시
                Debugger?.logError?.(new Error('featured preview autoplay blocked'), 'MenuFeatured._playPreview');
                this._showTapOverlay();
            });
    },

    _showTapOverlay() {
        const overlay = document.getElementById('menu-featured-tap-overlay');
        if (overlay) overlay.classList.remove('hidden');
        const dot = document.getElementById('menu-featured-playing-dot');
        if (dot) dot.classList.add('hidden');
    },

    _hideTapOverlay() {
        const overlay = document.getElementById('menu-featured-tap-overlay');
        if (overlay) overlay.classList.add('hidden');
        const dot = document.getElementById('menu-featured-playing-dot');
        if (dot) dot.classList.remove('hidden');
    },

    _renderSkeleton() {
        const el = document.getElementById('menu-featured-beatmap');
        if (!el) return;
        el.classList.remove('hidden');
        el.innerHTML = `
        <div class="menu-featured-card relative rounded-xl bg-gray-800 p-3 flex gap-3 items-center mb-4">
            <div class="menu-featured-skeleton flex-shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-lg"></div>
            <div class="flex-1 min-w-0 space-y-2">
                <div class="menu-featured-skeleton h-2 w-16 rounded"></div>
                <div class="menu-featured-skeleton h-2 w-32 rounded"></div>
                <div class="menu-featured-skeleton h-2 w-24 rounded"></div>
            </div>
        </div>`;
    },

    _renderEmpty() {
        // 공개 채보가 아직 없거나 조회 실패 — 카드 자체를 감춰서 빈 메뉴처럼 보이지 않게 함
        const el = document.getElementById('menu-featured-beatmap');
        if (!el) return;
        el.classList.add('hidden');
        el.innerHTML = '';
        GameBackground.clear();
    },

    _renderCard() {
        const el = document.getElementById('menu-featured-beatmap');
        const chart = this._current;
        if (!el || !chart) return;

        const coverUrl = CloudCharts.getCoverUrl(chart.cover_storage_path);
        const coverStyle = coverUrl ? `background-image:url('${coverUrl}');` : '';
        GameBackground.set(coverUrl); // 좌측 게임 화면(game-area)에도 같은 커버를 반투명 배경으로
        const creatorName = chart.owner_nickname
            ? _esc(chart.owner_nickname)
            : (chart.owner_id ? `${_esc(chart.owner_id.slice(0, 8))}…` : '알 수 없음');
        const difficultyLabel = chart.difficulty_label ? _esc(chart.difficulty_label) : '기본';

        el.classList.remove('hidden');
        el.innerHTML = `
        <div class="menu-featured-card relative rounded-xl bg-gray-800 p-3 mb-4">
            <button id="menu-featured-reroll-btn" type="button"
                class="menu-featured-reroll-btn absolute top-2 right-2 z-10 p-1.5 rounded-full transition"
                title="다른 곡 추천" aria-label="다른 곡 추천">
                <span class="text-sm">🔀</span>
            </button>
            <div class="flex gap-3 items-center">
                <div class="menu-featured-cover relative flex-shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-cover bg-center" style="${coverStyle}">
                    <span id="menu-featured-playing-dot" class="menu-featured-playing-dot absolute -bottom-1 -right-1"></span>
                    <div id="menu-featured-tap-overlay" class="menu-featured-tap-overlay hidden rounded-lg">🔇 탭해서<br>미리듣기</div>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-xs text-teal-400 font-semibold mb-0.5">🎧 추천 비트맵</p>
                    <p class="font-bold text-white truncate">${_esc(chart.title || '제목 없음')}</p>
                    <p class="text-sm text-gray-400 truncate">${_esc(chart.artist || '아티스트 미상')}</p>
                    <div class="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                        <span class="truncate">채보: ${creatorName}</span>
                        <span class="flex-shrink-0">${difficultyLabel}</span>
                        ${Difficulty.starRatingHtml(chart.difficulty_score)}
                    </div>
                </div>
            </div>
            <button id="menu-featured-play-btn" type="button"
                class="menu-featured-play-btn w-full mt-3 py-2.5 rounded-lg font-semibold text-white transition">
                ▶ 이 맵 플레이하러 가기
            </button>
        </div>`;

        document.getElementById('menu-featured-play-btn').addEventListener('click', () => {
            Game.state.gameState = 'online';
            Online.show('detail', chart.id, { pickMode: false });
        });
        document.getElementById('menu-featured-reroll-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.reroll();
        });
        document.getElementById('menu-featured-tap-overlay').addEventListener('click', () => {
            this._playPreview();
        });
    },
};