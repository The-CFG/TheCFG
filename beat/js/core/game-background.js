// ── GameBackground: 노래 커버 이미지를 게임 화면에 반투명 배경으로 표시 ──
// 노래 선택 화면 ~ 결과 화면 동안 #game-area-bg 에 커버 이미지를 깔고,
// #game-area-bg-dim(불투명도 0.55의 검정 오버레이)으로 덮어 노트/UI 가독성을 확보한다.
// online.js의 흐름(노래 선택 → 난이도 선택 → 플레이 → 결과)에서
// GameBackground.set(url) / GameBackground.clear() 로 제어한다.

const GameBackground = {
    // 곡 커버가 없을 때(메인 메뉴 등) 검은 화면 대신 보여줄 기본 배경.
    DEFAULT_URL: '/assets/TheBeat.png',
    FADE_MS: 700,            // 배경 전환(크로스페이드) 시간
    _defaultActive: false,   // 현재 기본 배경이 표시 중인지
    _defaultFailed: false,   // 기본 배경 파일 로드에 실패했는지(없으면 예전처럼 검은 화면)
    _currentUrl: null,
    // 마지막으로 요청된 url. 불투명도가 0이어도 기억해뒀다가, 슬라이더를 다시 올렸을 때
    // 화면 전환 없이 곧바로 복원할 수 있도록 한다.
    _lastRequestedUrl: null,

    // 배경 레이어 2장(A=#game-area-bg, B=동적 생성)을 번갈아 쓰는 크로스페이드 구조.
    // 새 이미지를 "뒤쪽 레이어"에 깔고 불투명도를 올리는 동시에 앞쪽 레이어를 내려서
    // 검은 화면을 거치지 않고 부드럽게 겹쳐 바뀌게 한다.
    _front: null,

    _layers() {
        const a = document.getElementById('game-area-bg');
        if (!a) return null;
        let b = document.getElementById('game-area-bg-b');
        if (!b) {
            b = document.createElement('div');
            b.id = 'game-area-bg-b';
            b.className = a.className;
            b.style.cssText = a.style.cssText;
            b.style.opacity = '0';
            b.style.clipPath = 'inset(0)'; // #game-area-bg와 동일(블러 번짐 방지)
            a.insertAdjacentElement('afterend', b);
        }
        if (!this._front) this._front = a;
        return [a, b];
    },

    _targetOpacity() {
        // 커스터마이징 계획 1/4단계 완료로 Appearance.settings(BeatSkin 소유)로 이관됨.
        // 스크립트 로드 순서상 Appearance보다 먼저 호출될 수 있어(초기 기본 배경 표시) 존재를 확인한다.
        const value = (typeof Appearance !== 'undefined' && Appearance.settings) ? Appearance.settings.gameplayImageOpacity : undefined;
        const pct = (value === undefined || value === null) ? 100 : value;
        return Math.max(0, Math.min(100, pct)) / 100;
    },

    // url(없으면 빈 배경)로 크로스페이드. 앞쪽 레이어는 서서히 사라지고 뒤쪽 레이어가 서서히 나타난다.
    _crossfadeTo(url) {
        const layers = this._layers();
        if (!layers) return;
        const front = this._front;
        const back = layers[0] === front ? layers[1] : layers[0];
        const t = `filter 0.35s ease, opacity ${this.FADE_MS}ms ease`; // setBlurred()의 블러 전환도 유지
        back.style.transition = 'none';
        back.style.opacity = '0';
        back.style.backgroundImage = url ? `url("${url}")` : '';
        void back.offsetWidth; // 위 초기 상태를 확정한 뒤 전환을 시작(reflow 강제)
        back.style.transition = t;
        front.style.transition = t;
        back.style.opacity = url ? String(this._targetOpacity()) : '0';
        front.style.opacity = '0';
        this._front = back;
    },

    // url이 없으면 clear()와 동일하게 동작.
    // 같은 url을 다시 set()하면 재적용하지 않는다 (화면 전환마다 깜빡이는 것 방지).
    set(url) {
        if (!document.getElementById('game-area-bg')) return;
        this._lastRequestedUrl = url || null;
        if (!url) {
            this.clear();
            return;
        }
        if (url === this._currentUrl) return;
        this._currentUrl = url;

        // 이미지를 미리 로드한 뒤 교체 → 깨진 이미지가 잠깐 노출되는 것 방지.
        // 로딩 중임을 좌측 game-area에 표시(사진 불러오는 중…) — 다른 곡으로
        // 다시 바뀌기 전까지(또는 로드 완료/실패 시) 유지된다.
        // 로딩 동안에는 현재 배경(기본 배경 또는 이전 커버)을 그대로 유지한다.
        UI.showAreaLoading('cover', '사진 불러오는 중…');
        const img = new Image();
        img.onload = () => {
            if (this._currentUrl !== url) return; // 로딩 도중 다른 곡으로 바뀌었으면 무시
            UI.hideAreaLoading('cover');
            this._defaultActive = false;
            this._crossfadeTo(url);
        };
        img.onerror = () => {
            if (this._currentUrl === url) {
                UI.hideAreaLoading('cover');
                this.clear();
            }
        };
        img.src = url;
    },

    // 커버 이미지를 내리고 기본 배경(TheBeat.png)으로 되돌린다.
    clear() {
        if (!document.getElementById('game-area-bg')) return;
        UI.hideAreaLoading('cover'); // 로딩 도중 취소된 경우에도 표시가 남지 않도록
        this._currentUrl = null;
        this._showDefault();
    },

    // 기본 배경 표시. 이미 기본 배경이 떠 있으면 다시 그리지 않고 불투명도만 맞춘다.
    _showDefault() {
        const layers = this._layers();
        if (!layers) return;
        if (this._defaultFailed) { // 기본 배경 파일이 없으면 예전처럼 비움(검은 화면)
            this._defaultActive = false;
            this._crossfadeTo(null);
            return;
        }
        if (this._defaultActive) {
            this._front.style.opacity = String(this._targetOpacity());
            return;
        }
        // 파일이 실제로 로드되는지 확인한 뒤 적용(깨진 이미지/빈 화면 방지)
        const img = new Image();
        img.onload = () => {
            if (this._currentUrl !== null) return; // 그 사이 다른 커버가 요청됨(그쪽이 전환을 맡는다)
            this._defaultActive = true;
            this._crossfadeTo(this.DEFAULT_URL);
        };
        img.onerror = () => {
            this._defaultFailed = true;
            if (this._currentUrl === null) this._showDefault();
        };
        img.src = this.DEFAULT_URL;
    },

    // 설정 화면에서 "게임플레이 시 이미지 표시" 슬라이더를 조작할 때 호출 — 화면 전환 없이
    // 현재 표시 중인 배경 이미지의 불투명도만 즉시 갱신한다.
    applyOpacity() {
        this._layers();
        if (this._front && (this._currentUrl || this._defaultActive)) {
            this._front.style.transition = 'filter 0.35s ease, opacity 0.15s ease'; // 슬라이더 조작은 즉각 반응
            this._front.style.opacity = String(this._targetOpacity());
        }
    },

    // 마지막으로 요청됐던 이미지를 곧바로 복원한다 (예: 화면을 벗어났다가 돌아왔을 때).
    reapply() {
        if (this._lastRequestedUrl) this.set(this._lastRequestedUrl);
    },

    // 배경/오디오를 끄지 않은 채로 블러 처리만 켜고 끈다 (예: 메인 메뉴 → 환경설정처럼
    // 잠깐 다른 화면을 보는 동안 재생 중인 곡을 배경으로 계속 들려주고 싶을 때).
    // 오디오 쪽 뭉갬 효과는 AudioEngine.setMuffled()가 짝을 이룬다.
    // #game-canvas도 함께 블러 처리한다 — SongPreview.start()(라이브러리/곡 상세 화면의
    // 채보 미리보기)가 여기에 노트를 그리는데, 이걸 빼두면 배경 커버 이미지만 블러되고
    // 그 위에 겹쳐진 채보 미리보기(낙하 노트)는 선명하게 그대로 보이는 문제가 있었다.
    // 캔버스는 매 프레임 다시 그려지지만 CSS filter는 렌더링 결과에만 적용되는
    // 후처리라 애니메이션이 계속돼도 블러가 끊기거나 깜빡이지 않는다.
    setBlurred(active) {
        const layers = this._layers(); // 크로스페이드용 레이어 2장 모두에 적용
        const dim = document.getElementById('game-area-bg-dim');
        const canvas = document.getElementById('game-canvas');
        if (!layers) return;
        layers.forEach(bg => {
            // 불투명도 전환 시간은 크로스페이드와 같게 유지(0.3s로 덮어쓰면 전환이 갑작스러워진다)
            bg.style.transition = `filter 0.35s ease, opacity ${this.FADE_MS}ms ease`;
            bg.style.filter = active ? 'blur(16px) brightness(0.85) saturate(0.95)' : '';
        });
        if (dim) {
            dim.style.transition = 'opacity 0.35s ease';
            dim.style.opacity = active ? '0.6' : '0.55';
        }
        if (canvas) {
            canvas.style.transition = 'filter 0.35s ease';
            canvas.style.filter = active ? 'blur(16px) brightness(0.85) saturate(0.95)' : '';
        }
    },
};

// 초기 상태: 기본 배경(TheBeat.png)을 표시. 파일 로드 전에는 opacity 0에서 시작한다.
(function initGameBackground() {
    const bg = document.getElementById('game-area-bg');
    if (!bg) return;
    bg.style.opacity = '0';
    GameBackground._layers();
    GameBackground._showDefault();
})();