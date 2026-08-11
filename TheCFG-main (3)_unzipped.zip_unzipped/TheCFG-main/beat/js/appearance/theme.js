// ════════════════════════════════════════════════
//  js/beat/theme.js — TheBeat 테마 관리
//  의존: 없음 (최초 로드, defer 없이 <head>에서 실행)
// ════════════════════════════════════════════════

// FOUC 방지: DOM 준비 전에 즉시 적용
(function _initBeatTheme() {
    try {
        const saved = localStorage.getItem('theBeat_theme');
        const valid = ['dark', 'blue', 'light'];
        const theme = (saved && valid.includes(saved)) ? saved : 'blue';
        document.documentElement.setAttribute('data-theme', theme);
    } catch {
        document.documentElement.setAttribute('data-theme', 'blue');
    }
})();

// ── BeatTheme 모듈 ───────────────────────────
const BeatTheme = {
    THEMES:      ['dark', 'blue', 'light'],
    STORAGE_KEY: 'theBeat_theme',

    load() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved && this.THEMES.includes(saved)) return saved;
        } catch { /* 무시 */ }
        return 'blue';
    },

    save(theme) {
        try { localStorage.setItem(this.STORAGE_KEY, theme); } catch { /* 무시 */ }
    },

    apply(theme) {
        if (!this.THEMES.includes(theme)) theme = 'blue';
        document.documentElement.setAttribute('data-theme', theme);
        this.save(theme);
        // 카드 활성 상태 갱신
        document.querySelectorAll('.beat-theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.themeVal === theme);
        });
    },

    current() {
        return document.documentElement.getAttribute('data-theme') || 'blue';
    },

    init() {
        const selector = document.getElementById('beat-theme-selector');
        if (!selector) return;

        // 클릭 이벤트
        selector.addEventListener('click', (e) => {
            const card = e.target.closest('.beat-theme-card');
            if (!card) return;
            this.apply(card.dataset.themeVal);
        });

        // 현재 테마 반영
        const cur = this.current();
        selector.querySelectorAll('.beat-theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.themeVal === cur);
        });
    }
};

// DOMContentLoaded 후 자동 초기화
document.addEventListener('DOMContentLoaded', () => {
    BeatTheme.init();
});