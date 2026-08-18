// ── 종합 편집 화면 좌측 배치 ────────────────────────────────────────────
// 데스크톱(1024px 이상, css/beat/game.css의 lg 좌우분할 기준과 동일)에서는 채보를 찍는
// #editor-container를 우측 #ui-area(#editor-screen 안, 좁은 2/5 폭) 대신 좌측 #game-area
// (3/5 폭, 실제 미리보기 캔버스가 그려지는 자리) 위에 오버레이로 옮겨서 훨씬 넓은 세로
// 공간에서 편집할 수 있게 한다. "재생"(미리보기)을 누르면 이 오버레이가 페이드아웃되어
// 밑에서 이미 그려지고 있는 실제 노트 미리보기가 드러나고, 정지/일시정지하면 다시
// 페이드인되어 편집 UI로 돌아온다(editor-preview.js의 editor-preview-fading 클래스 토글).
//
// 좁은 화면(모바일/터치, 1024px 미만)에서는 #game-area가 35vh로 좁아 편집 UI를 얹을 공간이
// 없으므로, 오버레이 클래스를 붙이지 않고 원래 자리(editor-screen 안, 상단 컨트롤 아래)로
// 되돌려 놓는다 — 기존 동작 그대로 유지.
//
// dom.js 이후, editor-preview.js 이전 아무 때나 로드돼도 된다(순수 getElementById만 사용).
(function initEditorLayout() {
    const gameArea = document.getElementById('game-area');
    const chartArea = document.getElementById('editor-container');
    if (!gameArea || !chartArea) return;

    // 모바일 레이아웃일 때 chartArea를 되돌려 놓을 원래 위치 표시(주석 노드).
    // chartArea 자신은 나중에 game-area로 옮겨가므로, 이 마커는 원래 부모에 고정해둔다.
    const mobileAnchor = document.createComment('editor-container-anchor');
    chartArea.parentNode.insertBefore(mobileAnchor, chartArea);

    const mq = window.matchMedia('(min-width: 1024px)');

    function applyLayout(isDesktop) {
        if (isDesktop) {
            if (chartArea.parentNode !== gameArea) {
                gameArea.appendChild(chartArea);
            }
            chartArea.classList.add('editor-container-overlay');
        } else {
            chartArea.classList.remove('editor-container-overlay', 'editor-preview-fading');
            const alreadyInPlace = chartArea.previousSibling === mobileAnchor;
            if (!alreadyInPlace) {
                mobileAnchor.parentNode.insertBefore(chartArea, mobileAnchor.nextSibling);
            }
        }
    }

    applyLayout(mq.matches);
    if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', e => applyLayout(e.matches));
    } else if (typeof mq.addListener === 'function') {
        // Safari 구버전 폴백
        mq.addListener(e => applyLayout(e.matches));
    }
})();