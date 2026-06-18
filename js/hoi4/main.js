// ════════════════════════════════════════════════════════
//  main.js — 화면 전환 라우터 + 전역 이벤트
//  의존: state.js → io.js → home.js → explorer.js
//        → editor.js → localisation.js → auth.js → main.js
// ════════════════════════════════════════════════════════

// _supabase, SUPABASE_URL, SUPABASE_KEY 는 cloud/auth.js 상단에 선언됩니다.

document.addEventListener('DOMContentLoaded', () => {

    // ── 화면 전환 ──────────────────────────────────────
    const ALL_VIEWS = [
        'home-view',
        'explorer-view',
        'focus-editor-view',
        'localisation-editor-view',
        'gfx-editor-view',
        'ideas-editor-view',
        'decisions-editor-view',
    ];

    window.switchView = function(viewId) {
        ALL_VIEWS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', id !== viewId);
        });
        if (viewId !== 'focus-editor-view') closeEditorPanel?.();
    };

    // ── 인증 상태 변경 감지 ────────────────────────────
    _supabase.auth.onAuthStateChange((event, session) => {
        const user = session?.user;
        if (user) {
            console.log('연결된 계정:', user.email);
            // 로그인 시 홈 화면 클라우드 목록 갱신
            renderRecentList();
        } else {
            console.log('로그아웃 상태');
            renderRecentList();
        }
    });

    // ── 초기화 ─────────────────────────────────────────
    setupHomeListeners();
    setupExplorerListeners();
    setupPanelFormListeners();
    setupLocalisationEditorListeners();
    setupGfxEditorListeners();
    setupIdeasEditorListeners();
    setupDecisionsEditorListeners();
    setupAuthUI();
    setupPreferencesListeners();
    initSidebarToggle();
    initZoomControls();
    initFocusSearch();
    initFocusFilter();
    initMovepad();
    document.getElementById('btn-close-panel')
        ?.addEventListener('click', closeEditorPanel);

    // ── 전역 키보드 단축키 ─────────────────────────────
    document.addEventListener('keydown', e => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
        if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
        if (ctrl && e.key === 's') {
            e.preventDefault();
            const filePath = appState.currentFile;
            const fd       = currentFileData();
            if (!filePath || !fd || !appState.project.name) {
                // 열린 파일 없으면 전체 프로젝트 저장
                autoSaveToLocal();
                return;
            }
            _saveCurrentFileToServer(filePath, fd);
        }
    });

    // ── 미저장 경고 ────────────────────────────────────
    window.addEventListener('beforeunload', e => {
        if (appState.isDirty) {
            autoSaveToLocal();  // 닫기 전 마지막 자동 저장
            e.preventDefault(); e.returnValue = '';
        }
    });

    // ── 시작 화면 ──────────────────────────────────────
    switchView('home-view');
});
