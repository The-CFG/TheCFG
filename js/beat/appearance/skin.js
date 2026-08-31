// ════════════════════════════════════════════════
//  js/beat/appearance/skin.js — BeatSkin (커스터마이징 계획 1단계)
//  Appearance.settings(색상/노트 모양 등)를 "스킨" 단위로 저장/전환할 수 있게 감싸는
//  얇은 레이어. 기존 소비 코드(game.js의 캔버스 드로잉, editor-notes.js 등)는 여전히
//  Appearance.settings.*를 그대로 읽으므로, BeatSkin은 저장소만 바꾸고 렌더링 경로에는
//  손대지 않는다.
//
//  ⚠️ 범위 메모: 계획 문서의 1단계에는 Game.state.settings의 시각 항목
//  (gameplayImageOpacity/laneBackgroundOpacity/laneHighlightOnInput)도 스킨에 포함하는
//  것으로 돼 있으나, 이 셋은 main.js의 PLAY_SETTINGS_KEYS/CloudAuth 클라우드 동기화와
//  얽혀 있어 지금 옮기면 그 동기화 로직까지 같이 손대야 한다. 이번 뼈대 구현에서는
//  Appearance.settings(색상/모양 계열)만 스킨화하고, 저 3개 키의 이관은 4단계에서
//  main.js 작업과 함께 처리한다.
//
//  의존: local-store.js(BeatLocalStore), appearance.js(Appearance) — 둘 다 이 파일보다
//  먼저 로드되어야 한다(index.html 스크립트 순서 참고).
// ════════════════════════════════════════════════

const BeatSkin = {
    STORE_NAME: 'skins',
    STATE_KEY: 'state',
    DEFAULT_ID: 'default',
    DEFAULT_NAME: '기본',

    // { activeId, skins: { [id]: { name, settings } } }
    state: null,

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.error(`[${context}]`, err);
        }
    },

    async init() {
        try {
            let state = await BeatLocalStore.get(this.STORE_NAME, this.STATE_KEY);
            if (!state || !state.skins || !state.skins[state.activeId]) {
                state = await this._migrateLegacy();
            }
            this.state = state;
            this.applyActive();
        } catch (err) {
            this._logError(err, 'BeatSkin.init');
        }
    },

    // 레거시 localStorage(theBeat_appearance)를 1회 읽어 "기본" 스킨 하나로 변환한다.
    // Appearance.init()이 이 함수보다 먼저 실행되어 이미 legacy 값을 Appearance.settings에
    // 로드해 둔 상태이므로(appearance.js loadSettings()), 저장된 적 없는 완전 신규
    // 사용자라도 Appearance.settings의 코드 기본값을 그대로 스킨화하면 된다.
    async _migrateLegacy() {
        let legacySettings = null;
        try {
            const raw = localStorage.getItem('theBeat_appearance');
            if (raw) legacySettings = JSON.parse(raw);
        } catch (err) {
            this._logError(err, 'BeatSkin._migrateLegacy(parse)');
        }

        const settings = legacySettings
            ? { ...Appearance.settings, ...legacySettings }
            : { ...Appearance.settings };

        const state = {
            activeId: this.DEFAULT_ID,
            skins: {
                [this.DEFAULT_ID]: { name: this.DEFAULT_NAME, settings },
            },
        };

        await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, state);
        return state;
    },

    _activeSkin() {
        if (!this.state) return null;
        return this.state.skins[this.state.activeId] || null;
    },

    // 활성 스킨 값을 Appearance.settings에 복사하고 기존 렌더링 파이프라인을 그대로 재사용.
    applyActive() {
        const skin = this._activeSkin();
        if (!skin) return;
        Object.assign(Appearance.settings, skin.settings);
        if (typeof Appearance.applySettings === 'function') {
            Appearance.applySettings();
        }
    },

    // 지금의 Appearance.settings를 활성 스킨에 캡처해서 저장한다.
    // appearance.js의 "적용" 버튼(saveSettings())에서 호출된다.
    async captureFromAppearance() {
        const skin = this._activeSkin();
        if (!skin) return;
        skin.settings = { ...Appearance.settings };
        await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, this.state);
    },

    // ── 3단계(프리셋 UI)에서 쓸 최소 API. 지금은 골격만 두고 UI는 연결하지 않는다. ──
    listSkins() {
        if (!this.state) return [];
        return Object.entries(this.state.skins).map(([id, s]) => ({ id, name: s.name }));
    },

    async switchTo(id) {
        if (!this.state || !this.state.skins[id]) return false;
        this.state.activeId = id;
        await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, this.state);
        this.applyActive();
        return true;
    },
};