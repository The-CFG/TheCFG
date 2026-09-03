// ════════════════════════════════════════════════
//  js/beat/theme.js — TheBeat 테마 관리
//  의존: 없음 (최초 로드, defer 없이 <head>에서 실행)
//
//  ── "커스텀" 모드(커스터마이징 계획 1-A단계) ──────────────────────────
//  dark/blue/light처럼 css/beat/theme.css에 고정 팔레트를 박아두는 대신, 사용자가
//  고른 5개 핵심 색(강조색/배경/글자/카드 배경/카드 배경-강조)만 색상 피커로 받고
//  나머지 토큰(호버/테두리/보조 텍스트 등)은 _deriveTokens()가 밝기 보정으로 계산해
//  채운다. theme.css 상단 주석이 미리 예고해 둔 대로, documentElement.style에 같은
//  --tb-* 변수를 직접 심는 방식이라 theme.css의 컴포넌트 규칙은 전혀 손대지 않는다.
//
//  ── 테마도 스킨 소유로 이관 ──────────────────────────────────────────
//  원래는 이 파일이 localStorage(theBeat_theme/theBeat_customTheme)에 독립적으로
//  저장/동기화(CloudAuth.saveUiThemeSettings)하는, BeatSkin과 무관한 전역 설정이었다.
//  이제는 gameplayImageOpacity 등과 동일하게 Appearance.settings(themeId/
//  themeCustomColors)의 일부가 되어 BeatSkin이 스킨별로 캡처/전환/클라우드 동기화한다
//  (appearance.js의 applyPlayVisualSettings() → BeatTheme.applyFromSettings() 참고).
//  localStorage 두 키는 없애지 않고 남겨둔다 — IndexedDB(BeatSkin) 로드는 비동기라
//  최초 페인트 전에 읽을 수 없으므로, 이 파일 하단 즉시실행 함수(_initBeatTheme)가
//  깜빡임 방지용으로 동기 read하는 캐시 용도로만 계속 쓰인다("진짜 값"은 이제 활성
//  스킨 쪽이고, applyFromSettings()가 적용할 때마다 이 캐시도 최신값으로 다시 써 둔다).
// ════════════════════════════════════════════════

// 커스텀 테마가 채우는 전체 --tb-* 토큰 목록. dark/blue/light로 돌아갈 때 이 인라인
// 값들을 지워야 theme.css의 [data-theme="..."] 블록 값이 다시 보인다(인라인 스타일이
// 속성 선택자보다 우선순위가 높으므로, 지우지 않으면 예전 커스텀 값이 계속 남아 보인다).
const BEAT_THEME_TOKEN_VARS = [
    '--tb-accent', '--tb-bg-primary', '--tb-text-primary',
    '--tb-bg-surface', '--tb-bg-surface-alt', '--tb-bg-surface-soft', '--tb-bg-surface-softer',
    '--tb-text-secondary', '--tb-text-tertiary',
    '--tb-border', '--tb-border-strong',
    '--tb-hover-surface', '--tb-hover-surface-alt', '--tb-hover-surface-strong',
    '--tb-tab-active-text',
    '--tb-keybind-bg', '--tb-keybind-hover-bg', '--tb-keybind-border', '--tb-keybind-text',
    '--tb-keybind-listening-bg', '--tb-keybind-listening-border',
];

// 사용자가 직접 고르는 5개 기본 토큰. blue 테마 값을 출발점 기본값으로 둔다.
const BEAT_CUSTOM_THEME_TOKENS = [
    { key: 'accent',      cssVar: '--tb-accent',       label: '강조색',            default: '#4299e1' },
    { key: 'bgPrimary',   cssVar: '--tb-bg-primary',   label: '배경(기본)',        default: '#2d3748' },
    { key: 'textPrimary', cssVar: '--tb-text-primary', label: '글자(기본)',        default: '#e2e8f0' },
    { key: 'bgSurface',   cssVar: '--tb-bg-surface',   label: '카드/패널 배경',     default: '#374151' },
    { key: 'bgSurfaceAlt',cssVar: '--tb-bg-surface-alt', label: '카드/패널 배경(강조)', default: '#1f2937' },
];

// HEX 색상 밝기 보정. appearance.js의 Appearance.adjustColor()와 같은 알고리즘이지만,
// theme.js는 "의존 없음"을 유지하려고 여기 로컬로 따로 둔다(로드 순서에 얽매이지 않기 위함).
function _beatThemeShade(hex, amount) {
    const c = (hex || '#000000').replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(c.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(c.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(c.substring(4, 6), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// 0(어둠)~1(밝음) 상대 휘도. 배경이 어두운지 밝은지 판단해 파생 토큰(호버/보조 텍스트
// 등)을 밝게 갈지 어둡게 갈지 방향을 정하는 데만 쓴다(정확한 색채 과학 대신 실용적 근사).
function _beatThemeLuminance(hex) {
    const c = (hex || '#000000').replace('#', '');
    const r = parseInt(c.substring(0, 2), 16) / 255;
    const g = parseInt(c.substring(2, 4), 16) / 255;
    const b = parseInt(c.substring(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 사용자가 고른 5개 기본 색 -> theme.css :root가 정의하는 전체 토큰 세트로 확장한다.
function _beatThemeDeriveTokens(colors) {
    const isDarkBase = _beatThemeLuminance(colors.bgPrimary) < 0.5;
    const dir = isDarkBase ? 1 : -1; // 어두운 배경이면 서피스/보더를 더 밝게, 밝은 배경이면 더 어둡게

    const bgSurfaceSoft   = _beatThemeShade(colors.bgSurface, dir * 24);
    const bgSurfaceSofter = _beatThemeShade(colors.bgSurface, dir * 44);
    const textSecondary   = _beatThemeShade(colors.textPrimary, -dir * 20);
    const textTertiary    = _beatThemeShade(colors.textPrimary, -dir * 46);

    return {
        '--tb-accent': colors.accent,
        '--tb-bg-primary': colors.bgPrimary,
        '--tb-text-primary': colors.textPrimary,
        '--tb-bg-surface': colors.bgSurface,
        '--tb-bg-surface-alt': colors.bgSurfaceAlt,
        '--tb-bg-surface-soft': bgSurfaceSoft,
        '--tb-bg-surface-softer': bgSurfaceSofter,
        '--tb-text-secondary': textSecondary,
        '--tb-text-tertiary': textTertiary,
        '--tb-border': colors.bgSurface,
        '--tb-border-strong': bgSurfaceSoft,
        '--tb-hover-surface': bgSurfaceSoft,
        '--tb-hover-surface-alt': colors.bgSurface,
        '--tb-hover-surface-strong': bgSurfaceSofter,
        '--tb-tab-active-text': isDarkBase ? '#ffffff' : '#111827',
        '--tb-keybind-bg': bgSurfaceSoft,
        '--tb-keybind-hover-bg': bgSurfaceSofter,
        '--tb-keybind-border': isDarkBase ? 'transparent' : colors.bgSurface,
        '--tb-keybind-text': colors.textPrimary,
        '--tb-keybind-listening-bg': colors.bgPrimary,
        '--tb-keybind-listening-border': '#f6e05e',
    };
}

// FOUC 방지: DOM 준비 전에 즉시 적용
(function _initBeatTheme() {
    try {
        const saved = localStorage.getItem('theBeat_theme');
        const valid = ['dark', 'blue', 'light', 'custom'];
        const theme = (saved && valid.includes(saved)) ? saved : 'blue';
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            // 커스텀 값도 페인트 전에 인라인으로 미리 심어야 깜빡임이 없다.
            const rawColors = localStorage.getItem('theBeat_customTheme');
            const colors = rawColors ? JSON.parse(rawColors) : null;
            if (colors) {
                const tokens = _beatThemeDeriveTokens(colors);
                const style = document.documentElement.style;
                Object.entries(tokens).forEach(([k, v]) => style.setProperty(k, v));
            }
        }
    } catch {
        document.documentElement.setAttribute('data-theme', 'blue');
    }
})();

// ── BeatTheme 모듈 ───────────────────────────
const BeatTheme = {
    THEMES:      ['dark', 'blue', 'light', 'custom'],
    STORAGE_KEY: 'theBeat_theme',
    CUSTOM_STORAGE_KEY: 'theBeat_customTheme',
    CUSTOM_TOKENS: BEAT_CUSTOM_THEME_TOKENS,

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

    // 저장된 커스텀 색(5개 기본 토큰)을 불러온다. 없으면 CUSTOM_TOKENS의 기본값(blue 테마
    // 출발점)으로 채워서 돌려준다 — 사용자가 "커스텀" 카드를 처음 눌러도 바로 편집 가능한
    // 값이 있어야 하므로.
    loadCustomColors() {
        try {
            const raw = localStorage.getItem(this.CUSTOM_STORAGE_KEY);
            const saved = raw ? JSON.parse(raw) : {};
            const colors = {};
            this.CUSTOM_TOKENS.forEach(t => { colors[t.key] = saved[t.key] || t.default; });
            return colors;
        } catch {
            const colors = {};
            this.CUSTOM_TOKENS.forEach(t => { colors[t.key] = t.default; });
            return colors;
        }
    },

    saveCustomColors(colors) {
        try { localStorage.setItem(this.CUSTOM_STORAGE_KEY, JSON.stringify(colors)); } catch { /* 무시 */ }
    },

    // 커스텀 색을 파생 토큰까지 확장해 documentElement에 인라인으로 심는다.
    applyCustomColors(colors) {
        const tokens = _beatThemeDeriveTokens(colors);
        const style = document.documentElement.style;
        Object.entries(tokens).forEach(([k, v]) => style.setProperty(k, v));
    },

    // dark/blue/light로 돌아갈 때 커스텀 모드가 심어둔 인라인 값을 지운다(안 지우면
    // theme.css의 [data-theme] 블록 값보다 인라인이 우선해 이전 커스텀 색이 계속 보임).
    _clearInlineTokens() {
        const style = document.documentElement.style;
        BEAT_THEME_TOKEN_VARS.forEach(v => style.removeProperty(v));
    },

    apply(theme) {
        if (!this.THEMES.includes(theme)) theme = 'blue';
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            const colors = this.loadCustomColors();
            this.applyCustomColors(colors);
            this._syncPickerInputs(colors);
            this._refreshCustomPreview(colors);
        } else {
            this._clearInlineTokens();
        }
        this.save(theme);
        // 카드 활성 상태 갱신
        document.querySelectorAll('.beat-theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.themeVal === theme);
        });
        this._toggleCustomPanel(theme === 'custom');
    },

    // ── 테마도 스킨 소유로 이관 ──
    // BeatSkin이 관리하는 Appearance.settings.themeId/themeCustomColors를 실제 문서에
    // 반영한다. apply(theme)와 하는 일은 거의 같지만 두 가지가 다르다: ①색상 출처가
    // localStorage 캐시(loadCustomColors())가 아니라 인자로 받은 값(=활성 스킨의 값)이고,
    // ②반영한 뒤에는 그 값을 localStorage 캐시에도 다시 써서(save/saveCustomColors) 다음
    // 새로고침의 최초 페인트(_initBeatTheme, 이 파일 상단)가 최신 스킨 값을 곧바로 보여줄
    // 수 있게 한다 — IndexedDB(BeatSkin)는 비동기라 페인트 전에 읽을 수 없으므로, 캐시는
    // 여전히 필요하지만 이제는 "진짜 값"이 아니라 "직전에 적용된 스킨 값의 사본"이다.
    // BeatSkin.applyActive() → Appearance.applySettings() → Appearance.applyPlayVisualSettings()
    // 경로로 스킨 전환/최초 로드/계정 값 수신 시점마다 호출된다.
    applyFromSettings(themeId, customColors) {
        const theme = this.THEMES.includes(themeId) ? themeId : 'blue';
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            const colors = customColors || this._defaultCustomColors();
            this.applyCustomColors(colors);
            this._syncPickerInputs(colors);
            this._refreshCustomPreview(colors);
            this.saveCustomColors(colors); // FOUC 캐시 갱신
        } else {
            this._clearInlineTokens();
        }
        this.save(theme); // FOUC 캐시 갱신
        document.querySelectorAll('.beat-theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.themeVal === theme);
        });
        this._toggleCustomPanel(theme === 'custom');
    },

    // CUSTOM_TOKENS의 코드 기본값(blue 테마 출발점)만으로 채운 색상 세트.
    // themeCustomColors가 아직 없는 스킨(한 번도 커스텀 테마를 만져본 적 없는 스킨)에
    // applyFromSettings()가 폴백으로 쓴다.
    _defaultCustomColors() {
        const colors = {};
        this.CUSTOM_TOKENS.forEach(t => { colors[t.key] = t.default; });
        return colors;
    },

    current() {
        return document.documentElement.getAttribute('data-theme') || 'blue';
    },

    // 색상 피커 5개의 표시값을 지금 저장된 커스텀 색으로 맞춘다. _initCustomPanel()이
    // 처음 배선할 때, 그리고 계정에서 커스텀 색을 받아온 직후(BeatCustomizationSync.pullAll)
    // 양쪽에서 호출한다 — 안 그러면 피커가 로그인 전 값을 계속 보여주게 된다.
    _syncPickerInputs(colors) {
        this.CUSTOM_TOKENS.forEach(t => {
            const input = document.getElementById(`custom-theme-${t.key}`);
            if (input) input.value = colors[t.key];
        });
    },

    _toggleCustomPanel(show) {
        const panel = document.getElementById('beat-custom-theme-panel');
        if (panel) panel.classList.toggle('hidden', !show);
    },

    // 커스텀 카드의 미리보기 색상 4칸(bar/body/surface)을 지금 저장된 커스텀 색으로
    // 갱신한다. 다른 카드들처럼 고정 색상이 아니라 사용자가 고른 값을 그대로 보여준다.
    _refreshCustomPreview(colors) {
        const card = document.querySelector('.beat-theme-card[data-theme-val="custom"]');
        if (!card) return;
        const bar = card.querySelector('.btp-bar');
        const body = card.querySelector('.btp-body');
        const surface = card.querySelector('.btp-surface');
        if (bar) bar.style.background = colors.bgSurfaceAlt;
        if (body) body.style.background = colors.bgPrimary;
        if (surface) surface.style.background = colors.bgSurface;
    },

    // 색상 피커 5개 + "적용" 버튼을 배선한다. 다른 모양 설정(색상/노트 등)과 같은
    // "피커로 미리 보고, 적용 눌러야 실제 저장/반영" 패턴을 따른다 — 피커를 만지작거리는
    // 중에는 카드 미리보기만 갱신하고, documentElement에는 적용 버튼을 눌러야 반영된다.
    _initCustomPanel() {
        const applyBtn = document.getElementById('custom-theme-apply-btn');
        let staged = this.loadCustomColors();

        this.CUSTOM_TOKENS.forEach(t => {
            const input = document.getElementById(`custom-theme-${t.key}`);
            if (!input) return;
            input.value = staged[t.key];
            input.addEventListener('input', (e) => {
                staged = { ...staged, [t.key]: e.target.value };
                this._refreshCustomPreview(staged);
                // 지금 커스텀 모드가 활성 상태면 피커를 만지는 즉시 화면에도 반영해
                // 실시간으로 결과를 볼 수 있게 한다(저장은 "적용"을 눌러야 확정).
                if (this.current() === 'custom') this.applyCustomColors(staged);
            });
        });

        this._refreshCustomPreview(staged);

        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.saveCustomColors(staged);
                // 테마도 스킨 소유 — Appearance.settings에 반영하고 saveSettings()로
                // 활성 스킨에 캡처해야 다른 스킨으로 전환했다가 돌아와도 이 색이 남는다.
                if (typeof Appearance !== 'undefined') {
                    Appearance.settings.themeId = 'custom';
                    Appearance.settings.themeCustomColors = staged;
                    Appearance.saveSettings();
                }
                this.applyFromSettings('custom', staged);
                if (typeof UI !== 'undefined' && UI.showMessage) {
                    UI.showMessage('settings', '커스텀 테마를 적용했습니다.');
                }
                if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
            });
        }
    },

    init() {
        const selector = document.getElementById('beat-theme-selector');
        if (!selector) return;

        // 클릭 이벤트 — 테마도 스킨 소유이므로 Appearance.settings에 반영 + saveSettings()로
        // 활성 스킨에 캡처한다(다른 색/모양 설정의 "적용" 버튼과 달리, 카드 클릭은 원래도
        // 즉시 반영+저장되는 단일 클릭 UX였으므로 그 흐름은 그대로 유지).
        selector.addEventListener('click', (e) => {
            const card = e.target.closest('.beat-theme-card');
            if (!card) return;
            const theme = card.dataset.themeVal;
            if (typeof Appearance !== 'undefined') {
                Appearance.settings.themeId = theme;
                // 'custom'으로 처음 전환하는데 이 스킨에 아직 커스텀 색이 없으면(한 번도
                // 커스텀 테마를 만져본 적 없는 스킨) 캐시/기본값으로 채워 넣는다.
                if (theme === 'custom' && !Appearance.settings.themeCustomColors) {
                    Appearance.settings.themeCustomColors = this.loadCustomColors();
                }
                Appearance.saveSettings();
                this.applyFromSettings(Appearance.settings.themeId, Appearance.settings.themeCustomColors);
            } else {
                // Appearance가 없는(있을 수 없지만 방어적으로) 상황을 위한 폴백 — 스킨에는
                // 저장되지 않고 캐시에만 반영된다.
                this.apply(theme);
            }
            // 사용자가 직접 고른 경우에만 클라우드로 올린다 — 계정에서 값을 받아오는 경로
            // (BeatCustomizationSync.pullAll())는 스킨 데이터 안에 테마가 이미 포함돼 있어
            // BeatSkin.switchTo()가 applyFromSettings()까지 함께 처리하므로 따로 push하지 않는다.
            if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
        });

        // 현재 테마 반영
        const cur = this.current();
        selector.querySelectorAll('.beat-theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.themeVal === cur);
        });
        this._toggleCustomPanel(cur === 'custom');

        this._initCustomPanel();
    }
};

// DOMContentLoaded 후 자동 초기화
document.addEventListener('DOMContentLoaded', () => {
    BeatTheme.init();
});