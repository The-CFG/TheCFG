// ── GameBackground: 노래 커버 이미지를 게임 화면에 반투명 배경으로 표시 ──
// 노래 선택 화면 ~ 결과 화면 동안 #game-area-bg 에 커버 이미지를 깔고,
// #game-area-bg-dim(불투명도 0.55의 검정 오버레이)으로 덮어 노트/UI 가독성을 확보한다.
// online.js의 흐름(노래 선택 → 난이도 선택 → 플레이 → 결과)에서
// GameBackground.set(url) / GameBackground.clear() 로 제어한다.

const GameBackground = {
    _currentUrl: null,
    // 마지막으로 요청된 url. 불투명도가 0이어도 기억해뒀다가, 슬라이더를 다시 올렸을 때
    // 화면 전환 없이 곧바로 복원할 수 있도록 한다.
    _lastRequestedUrl: null,

    _targetOpacity() {
        const value = Game.state.settings.gameplayImageOpacity;
        const pct = (value === undefined || value === null) ? 100 : value;
        return Math.max(0, Math.min(100, pct)) / 100;
    },

    // url이 없으면 clear()와 동일하게 동작.
    // 같은 url을 다시 set()하면 재적용하지 않는다 (화면 전환마다 깜빡이는 것 방지).
    set(url) {
        const bg = document.getElementById('game-area-bg');
        if (!bg) return;
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
        UI.showAreaLoading('cover', '사진 불러오는 중…');
        const img = new Image();
        img.onload = () => {
            if (this._currentUrl !== url) return; // 로딩 도중 다른 곡으로 바뀌었으면 무시
            UI.hideAreaLoading('cover');
            bg.style.transition = 'opacity 0.3s ease';
            bg.style.opacity = '0';
            requestAnimationFrame(() => {
                bg.style.backgroundImage = `url("${url}")`;
                requestAnimationFrame(() => { bg.style.opacity = String(this._targetOpacity()); });
            });
        };
        img.onerror = () => {
            if (this._currentUrl === url) {
                UI.hideAreaLoading('cover');
                this.clear();
            }
        };
        img.src = url;
    },

    clear() {
        const bg = document.getElementById('game-area-bg');
        if (!bg) return;
        UI.hideAreaLoading('cover'); // 로딩 도중 취소된 경우에도 표시가 남지 않도록
        this._currentUrl = null;
        bg.style.transition = 'opacity 0.3s ease';
        bg.style.opacity = '0';
        setTimeout(() => {
            if (this._currentUrl === null) bg.style.backgroundImage = '';
        }, 300);
    },

    // 설정 화면에서 "게임플레이 시 이미지 표시" 슬라이더를 조작할 때 호출 — 화면 전환 없이
    // 현재 표시 중인 배경 이미지의 불투명도만 즉시 갱신한다.
    applyOpacity() {
        const bg = document.getElementById('game-area-bg');
        if (bg && this._currentUrl) {
            bg.style.opacity = String(this._targetOpacity());
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
        const bg = document.getElementById('game-area-bg');
        const dim = document.getElementById('game-area-bg-dim');
        const canvas = document.getElementById('game-canvas');
        if (!bg) return;
        bg.style.transition = 'filter 0.35s ease, opacity 0.3s ease';
        bg.style.filter = active ? 'blur(16px) brightness(0.65) saturate(0.9)' : '';
        if (dim) {
            dim.style.transition = 'opacity 0.35s ease';
            dim.style.opacity = active ? '0.7' : '0.55';
        }
        if (canvas) {
            canvas.style.transition = 'filter 0.35s ease';
            canvas.style.filter = active ? 'blur(16px) brightness(0.65) saturate(0.9)' : '';
        }
    },
};

// 초기 상태: 배경 없음 (opacity 0에서 시작)
(function initGameBackground() {
    const bg = document.getElementById('game-area-bg');
    if (bg) bg.style.opacity = '0';
})();