// ── GameBackground: 노래 커버 이미지를 게임 화면에 반투명 배경으로 표시 ──
// 노래 선택 화면 ~ 결과 화면 동안 #game-area-bg 에 커버 이미지를 깔고,
// #game-area-bg-dim(불투명도 0.55의 검정 오버레이)으로 덮어 노트/UI 가독성을 확보한다.
// online.js의 흐름(노래 선택 → 난이도 선택 → 플레이 → 결과)에서
// GameBackground.set(url) / GameBackground.clear() 로 제어한다.

const GameBackground = {
    _currentUrl: null,

    // url이 없으면 clear()와 동일하게 동작.
    // 같은 url을 다시 set()하면 재적용하지 않는다 (화면 전환마다 깜빡이는 것 방지).
    set(url) {
        const bg = document.getElementById('game-area-bg');
        if (!bg) return;
        if (!url) {
            this.clear();
            return;
        }
        if (url === this._currentUrl) return;
        this._currentUrl = url;

        // 이미지를 미리 로드한 뒤 교체 → 깨진 이미지가 잠깐 노출되는 것 방지.
        const img = new Image();
        img.onload = () => {
            if (this._currentUrl !== url) return; // 로딩 도중 다른 곡으로 바뀌었으면 무시
            bg.style.transition = 'opacity 0.3s ease';
            bg.style.opacity = '0';
            requestAnimationFrame(() => {
                bg.style.backgroundImage = `url("${url}")`;
                requestAnimationFrame(() => { bg.style.opacity = '1'; });
            });
        };
        img.onerror = () => {
            if (this._currentUrl === url) this.clear();
        };
        img.src = url;
    },

    clear() {
        const bg = document.getElementById('game-area-bg');
        if (!bg) return;
        this._currentUrl = null;
        bg.style.transition = 'opacity 0.3s ease';
        bg.style.opacity = '0';
        setTimeout(() => {
            if (this._currentUrl === null) bg.style.backgroundImage = '';
        }, 300);
    },
};

// 초기 상태: 배경 없음 (opacity 0에서 시작)
(function initGameBackground() {
    const bg = document.getElementById('game-area-bg');
    if (bg) bg.style.opacity = '0';
})();
