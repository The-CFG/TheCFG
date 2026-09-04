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
//
// 환경설정 "플레이" 탭의 "홈 화면 추천 비트맵" 토글로 껐다 켤 수 있다(_isEnabled()/
// onSettingChanged() 참고) — 꺼두면 onEnter()가 로드/재생 없이 카드를 감춘 채로 끝난다.
const MenuFeatured = {
    _current: null,      // CloudBrowse.getFeaturedBeatmap()의 data
    _loaded: false,       // 세션 중 한 번이라도 성공적으로 뽑았는지
    _loading: false,
    _loadSeq: 0,          // 재추첨/화면 재진입이 겹칠 때 오래된 응답 무시용
    _muffled: false,      // 환경설정 화면 등에서 "끄지 않고 뭉개기"만 한 상태인지

    // 환경설정 "플레이" 탭의 토글(#show-home-recommendations-toggle)로 켜고 끌 수 있다.
    // Game.state.settings.showHomeRecommendations를 읽는다(localStorage는 부팅 시
    // 초기값만 채우고, 이후로는 계정 동기화 값까지 반영된 이 쪽이 최신 값이다).
    _isEnabled() {
        try {
            return typeof Game !== 'undefined' && Game.state.settings.showHomeRecommendations !== false;
        } catch {
            return true;
        }
    },

    // 설정에서 꺼져 있을 때(onEnter 진입 시) 또는 방금 껐을 때(onSettingChanged) 카드/배경/
    // 미리듣기를 전부 정리하고 감춘다. 뽑아둔 곡(_current/_loaded)은 지우지 않는다 — 다시
    // 켜면 새로 뽑지 않고 그 곡을 그대로 이어서 보여준다("세션당 1번만 뽑는다" 원칙 유지).
    _hideDisabled() {
        const el = document.getElementById('menu-featured-beatmap');
        if (this._muffled || this._loaded) {
            SongPreview.stop();
            AudioEngine.setMuffled(false);
            GameBackground.clear();
        }
        this._muffled = false;
        UI.hideAreaLoading('preview');
        if (el) {
            el.classList.add('hidden');
            el.innerHTML = '';
        }
    },

    // 환경설정 "플레이" 탭의 토글이 바뀔 때 main.js가 호출한다. 설정 화면은 메뉴를 완전히
    // 떠나지 않고 "뭉개기"만 하는 화면이라(onLeave 참고), 여기서 끄면 설정 화면 뒤에서
    // 계속 재생 중이던 카드를 곧바로 정리해야 설정을 닫고 메뉴로 돌아왔을 때 잠깐이라도
    // 다시 보이는 일이 없다. 켤 때는 별도 처리 없이 다음 onEnter()(설정을 닫고 메뉴로
    // 돌아올 때)가 알아서 로드/재생한다.
    onSettingChanged(enabled) {
        if (!enabled) this._hideDisabled();
    },

    async onEnter() {
        const el = document.getElementById('menu-featured-beatmap');
        if (!el) return;

        if (!this._isEnabled()) {
            this._hideDisabled();
            return;
        }

        if (this._muffled) {
            // 설정 화면 등에서 뭉개기만 해뒀던 경우 — 재생은 계속되고 있었으므로
            // 다시 로드/재생하지 않고 블러/필터만 원상복구한다 (끊김 없이 이어짐).
            this._muffled = false;
            GameBackground.setBlurred(false);
            AudioEngine.setMuffled(false);
            return;
        }

        if (this._loading) return; // 이미 로딩 중이면 중복 요청 안 함
        if (this._loaded && this._current) {
            // 이미 뽑아둔 곡이 있으면 재조회 없이 카드만 다시 그리고 미리듣기 재생만 재시작
            this._renderCard();
            this._playPreview();
            return;
        }
        await this._load();
    },

    // screenName: 어떤 화면으로 나가는지. 'settings'는 끄지 않고 블러+뭉갬만 적용,
    // 그 외에는 기존처럼 완전히 정지/정리한다.
    onLeave(screenName) {
        if (screenName === 'settings' && this._loaded && this._current) {
            this._muffled = true;
            GameBackground.setBlurred(true);
            AudioEngine.setMuffled(true);
            return;
        }
        this._muffled = false;
        SongPreview.stop();
        AudioEngine.setMuffled(false);
        GameBackground.clear();
        UI.hideAreaLoading('preview');
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
        const seq = this._loadSeq;
        // online.js의 미리듣기 로딩과 동일하게 'preview' 키를 재사용해 좌측 game-area에
        // "노래 불러오는 중…" 오버레이 + 실제 다운로드 진행률 바를 띄운다(진행률을 알 수
        // 없으면 불확정 바로 자동 대체됨). 재생 가능해지거나 자동재생이 막혀 실패해도
        // 항상 정리한다.
        UI.showAreaLoading('preview', '노래 불러오는 중…');
        const stopTracking = UI.trackAudioDownloadProgress('preview');
        SongPreview.playAudio(CloudCharts.getAudioUrl(chart.audio_storage_path), chart.preview_start_ms || 0)
            .then(() => this._hideTapOverlay())
            .catch(() => {
                // 제스처 없이 자동재생이 막힌 경우 — 페이지 첫 진입마다 항상 있을 수 있는
                // 정상적인 상황이라 에러로 찍지 않는다(preview.js에서 진짜 예외는 이미
                // 로그로 남김). 카드를 탭하면 재생되도록 오버레이만 표시한다.
                this._showTapOverlay();
            })
            .finally(() => {
                stopTracking();
                if (seq === this._loadSeq) UI.hideAreaLoading('preview'); // 그 사이 재추첨/재진입이 겹쳤으면 최신 쪽이 이미 정리함
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
        const creatorName = chart.owner_id
            ? CloudAuth.linkedName(chart.owner_id, chart.owner_nickname || `${chart.owner_id.slice(0, 8)}…`, _esc)
            : '알 수 없음';
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