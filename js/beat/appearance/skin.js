// ════════════════════════════════════════════════
//  js/beat/appearance/skin.js — BeatSkin (커스터마이징 계획 1단계)
//  Appearance.settings(색상/노트 모양 등)를 "스킨" 단위로 저장/전환할 수 있게 감싸는
//  얇은 레이어. 기존 소비 코드(game.js의 캔버스 드로잉, editor-notes.js 등)는 여전히
//  Appearance.settings.*를 그대로 읽으므로, BeatSkin은 저장소만 바꾸고 렌더링 경로에는
//  손대지 않는다.
//
//  gameplayImageOpacity/laneBackgroundOpacity/laneHighlightOnInput(원래 main.js의
//  PLAY_SETTINGS_KEYS/Game.state.settings에 있던 시각 항목 3개)도 이제 Appearance.settings의
//  일부로 스킨에 포함된다(1/4단계 완료). _migrateLegacy()/_absorbLegacyPlayVisualKeys()가
//  기존 개별 localStorage 키(theBeat_gameplayImageOpacity 등, 더 예전 체크박스 시절의
//  theBeat_showGameplayImage 포함)를 1회성으로 흡수해 스킨 설정으로 옮긴다.
//
//  3단계(프리셋 관리 UI): createSkin/renameSkin/deleteSkin + initUI()로 연습모드의
//  "내 프리셋" UI 패턴(select + 저장/불러오기/이름변경/삭제)을 재사용해 스킨 탭에도
//  적용한다. 저장은 동일하게 BeatLocalStore(IndexedDB)를 거친다.
//
//  의존: local-store.js(BeatLocalStore), appearance.js(Appearance) — 둘 다 이 파일보다
//  먼저 로드되어야 한다(index.html 스크립트 순서 참고).
// ════════════════════════════════════════════════

const BeatSkin = {
    STORE_NAME: 'skins',
    STATE_KEY: 'state',
    DEFAULT_ID: 'default',
    DEFAULT_NAME: '기본',

    // { activeId, skins: { [id]: { name, settings } }, builtinsSeeded }
    state: null,

    // ── 커스터마이징 계획 3단계: 기본 제공 스킨 2종 ──
    // 신규 유저가 "기본" 스킨 하나만 보는 문제를 없애기 위해 큐레이션된 프리셋을 미리
    // 목록에 넣어둔다("적용"까지 하지는 않음 — activeId는 그대로 두고 선택지로만 추가).
    // Object.assign(applyActive 참고)이 지정한 키만 덮어쓰므로, 여기 없는 키(폰트 선택,
    // 판정선 위치 등)는 전환 시점의 값을 그대로 물려받는다 — 사용자가 만드는 스킨(항상
    // Appearance.settings 전체를 캡처)과 달리 built-in은 "색/모양/텍스트/노트" 계열만
    // 큐레이션한 부분 프리셋이다.
    BUILTIN_SKINS: [
        {
            id: 'builtin_minimal',
            name: '미니멀',
            settings: {
                noteShape: 'circle',
                colorMode: 'note-type',
                colors: { tap: '#e2e8f0', long: '#94a3b8', false: '#64748b' },
                laneColors: {
                    L4: '#94a3b8', L3: '#a1a9b8', L2: '#adb5c4', L1: '#b9c1cf',
                    C1: '#e2e8f0',
                    R1: '#b9c1cf', R2: '#adb5c4', R3: '#a1a9b8', R4: '#94a3b8',
                },
                judgementLineColor: '#e2e8f0',
                judgementTextColor: '#e2e8f0',
                judgementTextSize: 3,
                comboTextColor: '#cbd5e1',
                comboTextSize: 2,
                countdownTextColor: '#e2e8f0',
                countdownTextSize: 6,
                noteSize: 0.85,
                noteAnimation: 'fade',
            },
        },
        {
            id: 'builtin_neon',
            name: '네온',
            settings: {
                noteShape: 'bar',
                colorMode: 'note-type',
                colors: { tap: '#22d3ee', long: '#f472b6', false: '#f87171' },
                laneColors: {
                    L4: '#f87171', L3: '#fb923c', L2: '#facc15', L1: '#a3e635',
                    C1: '#22d3ee',
                    R1: '#38bdf8', R2: '#818cf8', R3: '#c084fc', R4: '#f472b6',
                },
                judgementLineColor: '#22d3ee',
                judgementTextColor: '#f472b6',
                judgementTextSize: 5,
                comboTextColor: '#facc15',
                comboTextSize: 3,
                countdownTextColor: '#22d3ee',
                countdownTextSize: 9,
                noteSize: 1.15,
                noteAnimation: 'scale',
            },
        },
    ],

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.error(`[${context}]`, err);
        }
    },

    // ── 버그 수정: 스킨 간 색상(등 중첩 객체) 값 누수 ──
    // settings 안의 colors/laneColors/backgroundGradient/themeCustomColors는 객체라서,
    // 예전엔 이 파일 곳곳에서 { ...Appearance.settings } / Object.assign(...) 같은 얕은
    // 복사만 했다. 얕은 복사는 최상위 키(예: colors)를 "복사"해도 그 값 자체(중첩 객체)는
    // 원본과 같은 참조를 그대로 공유한다 — 그 결과 스킨 A를 스킨 B로부터 만들거나(createSkin),
    // A → B로 전환했다가 다시 A로 돌아오면 두 스킨의 colors가 실제로는 같은 객체였던 경우가
    // 생겼다. 이 상태에서 색상 피커로 B의 노트 색을 바꾸면(적용을 누르기도 전에, input
    // 이벤트마다 Appearance.settings.colors[type]을 직접 mutate하므로) A의 저장된 색까지
    // 같이 바뀌어 버린다 — "스킨을 바꿔도 노트 색이 안 바뀐다/다른 스킨 색까지 같이
    // 바뀐다"는 버그로 보이는 원인. IndexedDB를 한 번 왕복하면(구조적 클론이라 항상 깊은
    // 복사) 저절로 참조가 갈라지지만, 그 전까지(같은 세션 내 스킨 생성 직후 등)는 공유된
    // 채로 남아있어 재현이 들쭉날쭉했다.
    // 해결: settings가 스킨 경계를 넘나드는 지점(applyActive/captureFromAppearance/
    // createSkin/_migrateLegacy/_seedBuiltinSkins) 전부에서 이 clone을 거치게 해서 항상
    // 독립된 객체가 되도록 한다.
    _cloneSettings(settings) {
        if (!settings) return settings;
        try {
            if (typeof structuredClone === 'function') return structuredClone(settings);
        } catch (err) {
            // structuredClone이 없거나(구형 브라우저) 실패하면 JSON 왕복으로 폴백.
            // settings는 문자열/숫자/불리언/plain object/null만 담으므로 안전하다.
        }
        return JSON.parse(JSON.stringify(settings));
    },

    async init() {
        try {
            let state = await BeatLocalStore.get(this.STORE_NAME, this.STATE_KEY);
            if (!state || !state.skins || !state.skins[state.activeId]) {
                state = await this._migrateLegacy();
            } else {
                // 이미 (예전 버전에서) 마이그레이션이 끝난 상태라도, 그 예전 버전은 3개
                // 시각 항목을 함께 옮기지 않았을 수 있다 — 흡수를 시도한다.
                await this._absorbLegacyPlayVisualKeys(state);
            }
            // 기본 제공 스킨(BUILTIN_SKINS)을 목록에 추가한다 — 신규/기존 유저 모두
            // 대상이며, 1회만 추가되도록 가드한다(_seedBuiltinSkins 참고).
            await this._seedBuiltinSkins(state);
            // "로컬 저장소 정책" 정리: 위 두 경로 중 어느 쪽이든 필요한 값은 이미
            // IndexedDB로 옮겨졌으므로, 남아있는 레거시 localStorage 키를 지운다.
            // 매번 호출해도 안전(idempotent) — 이미 지워졌으면 그냥 아무 일도 안 함.
            this._cleanupLegacyLocalStorage();
            this.state = state;
            this.applyActive();
        } catch (err) {
            this._logError(err, 'BeatSkin.init');
        }
    },

    // BUILTIN_SKINS를 state.skins에 채워 넣는다. activeId/현재 적용된 값은 건드리지
    // 않는다(전환은 사용자가 스킨 선택 화면에서 직접 골라야 함). state.builtinsSeeded
    // 플래그로 1회만 실행되게 한다 — 사용자가 마음에 안 들어 삭제한 built-in 스킨이
    // 다음 접속 때 다시 살아나는 것을 방지하기 위함(deleteSkin()은 일반 스킨과 동일하게
    // built-in도 지울 수 있게 둔다).
    async _seedBuiltinSkins(state) {
        try {
            if (state.builtinsSeeded) return;
            for (const builtin of this.BUILTIN_SKINS) {
                if (!state.skins[builtin.id]) {
                    state.skins[builtin.id] = { name: builtin.name, settings: this._cloneSettings(builtin.settings) };
                }
            }
            state.builtinsSeeded = true;
            await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, state);
        } catch (err) {
            this._logError(err, 'BeatSkin._seedBuiltinSkins');
        }
    },

    // gameplayImageOpacity/laneBackgroundOpacity/laneHighlightOnInput은 theBeat_appearance
    // JSON에 들어있지 않고 개별 localStorage 키로 저장돼 있었다(game.js 옛 기본값 참고).
    // gameplayImageOpacity는 더 예전 체크박스 버전의 theBeat_showGameplayImage로도
    // 저장돼 있을 수 있어 그것도 폴백으로 흡수한다.
    _readLegacyPlayVisualKeys() {
        const out = {};
        try {
            const opacity = localStorage.getItem('theBeat_gameplayImageOpacity');
            if (opacity !== null) {
                const parsed = parseInt(opacity, 10);
                out.gameplayImageOpacity = Number.isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
            } else {
                const legacyCheckbox = localStorage.getItem('theBeat_showGameplayImage');
                if (legacyCheckbox !== null) out.gameplayImageOpacity = legacyCheckbox === 'false' ? 0 : 100;
            }

            const laneBg = localStorage.getItem('theBeat_laneBackgroundOpacity');
            if (laneBg !== null) {
                const parsed = parseInt(laneBg, 10);
                out.laneBackgroundOpacity = Number.isNaN(parsed) ? 30 : Math.max(0, Math.min(100, parsed));
            }

            const highlight = localStorage.getItem('theBeat_laneHighlightOnInput');
            if (highlight !== null) out.laneHighlightOnInput = highlight !== 'false';
        } catch (err) {
            this._logError(err, 'BeatSkin._readLegacyPlayVisualKeys');
        }
        return out;
    },

    // 테마도 스킨 소유로 이관 — localStorage(theBeat_theme/theBeat_customTheme, BeatTheme가
    // 관리)에 있던 값을 스킨 설정(themeId/themeCustomColors)으로 흡수한다. BeatTheme가 아직
    // 로드되지 않았을 수 있는 페이지(이론상 없지만 방어적으로)를 위해 존재 체크한다.
    _readLegacyThemeKeys() {
        const out = {};
        try {
            if (typeof BeatTheme === 'undefined') return out;
            out.themeId = BeatTheme.load();
            if (out.themeId === 'custom') {
                out.themeCustomColors = BeatTheme.loadCustomColors();
            }
        } catch (err) {
            this._logError(err, 'BeatSkin._readLegacyThemeKeys');
        }
        return out;
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

        const settings = this._cloneSettings({
            ...Appearance.settings,
            ...(legacySettings || {}),
            ...this._readLegacyPlayVisualKeys(),
            ...this._readLegacyThemeKeys(),
        });

        const state = {
            activeId: this.DEFAULT_ID,
            skins: {
                [this.DEFAULT_ID]: { name: this.DEFAULT_NAME, settings },
            },
        };

        await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, state);
        return state;
    },

    // state가 이미 있던(이전 버전에서 마이그레이션이 끝난) 경우를 위한 보조 흡수 경로.
    // 활성 스킨에 아직 이 값들이 없을 때만 채운다 — 사용자가 이미 새 UI로 값을 바꿔둔
    // 경우(설정이 있음 = undefined가 아님) 덮어쓰지 않기 위한 가드.
    async _absorbLegacyPlayVisualKeys(state) {
        try {
            const skin = state.skins[state.activeId];
            if (!skin || !skin.settings) return;

            const legacy = { ...this._readLegacyPlayVisualKeys(), ...this._readLegacyThemeKeys() };
            let changed = false;
            for (const key of ['gameplayImageOpacity', 'laneBackgroundOpacity', 'laneHighlightOnInput', 'themeId', 'themeCustomColors']) {
                if (legacy[key] !== undefined && skin.settings[key] === undefined) {
                    skin.settings[key] = legacy[key];
                    changed = true;
                }
            }
            if (changed) {
                await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, state);
            }
        } catch (err) {
            this._logError(err, 'BeatSkin._absorbLegacyPlayVisualKeys');
        }
    },

    // "로컬 저장소 정책" 문서가 원래 약속했던 정리 단계: IndexedDB로 옮긴 레거시
    // localStorage 키들을 지운다. theBeat_colorPresets(폐기된 5슬롯 색상 프리셋,
    // 2단계 정리)도 이제 아무 코드도 참조하지 않는 고아 키라 여기서 함께 정리한다.
    _cleanupLegacyLocalStorage() {
        const keys = [
            'theBeat_appearance',
            'theBeat_colorPresets',
            'theBeat_gameplayImageOpacity',
            'theBeat_showGameplayImage',
            'theBeat_laneBackgroundOpacity',
            'theBeat_laneHighlightOnInput',
        ];
        for (const key of keys) {
            try {
                localStorage.removeItem(key);
            } catch (err) {
                this._logError(err, `BeatSkin._cleanupLegacyLocalStorage(${key})`);
            }
        }
    },

    _activeSkin() {
        if (!this.state) return null;
        return this.state.skins[this.state.activeId] || null;
    },

    // 활성 스킨 값을 Appearance.settings에 복사하고 기존 렌더링 파이프라인을 그대로 재사용.
    applyActive() {
        const skin = this._activeSkin();
        if (!skin) return;
        Object.assign(Appearance.settings, this._cloneSettings(skin.settings));
        if (typeof Appearance.applySettings === 'function') {
            Appearance.applySettings();
        }
    },

    // 지금의 Appearance.settings를 활성 스킨에 캡처해서 저장한다.
    // appearance.js의 "적용" 버튼(saveSettings())에서 호출된다.
    async captureFromAppearance() {
        const skin = this._activeSkin();
        if (!skin) return;
        skin.settings = this._cloneSettings(Appearance.settings);
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
        // BeatSkinImages(2단계, 스킨별 이미지)도 활성 스킨의 이미지 세트로 다시 로드한다.
        // BeatSkinImages가 아직 로드되지 않은 페이지(로드 순서 문제)나 이미지 기능이
        // 없는 페이지일 수 있어 존재 체크.
        if (typeof BeatSkinImages !== 'undefined' && BeatSkinImages.switchTo) {
            await BeatSkinImages.switchTo(id);
        }
        // 판정/콤보/카운트다운 폰트 선택(judgementFontId 등)도 Appearance.settings의
        // 일부로 스킨에 포함돼 있으므로, 설정 화면의 폰트 select들도 다시 그려야
        // 방금 전환된 스킨의 값을 보여준다.
        if (typeof BeatFonts !== 'undefined' && BeatFonts.refreshUI) {
            await BeatFonts.refreshUI();
        }
        return true;
    },

    // 스킨 id 생성 규칙 — BeatFonts.uploadFont()와 동일한 패턴(타임스탬프+랜덤 suffix).
    _genId() {
        return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    },

    // 지금 편집 중인 Appearance.settings 값을 캡처해서 새 이름의 스킨으로 만들고 그
    // 스킨으로 바로 전환한다("다른 이름으로 저장"). 이미지는 상속하지 않고 빈 세트로
    // 시작한다(switchTo()가 호출하는 BeatSkinImages.switchTo()가 새 id 소유 이미지가
    // 없으므로 자연히 빈 상태로 로드됨).
    async createSkin(name) {
        if (!this.state) return { ok: false, error: '스킨 시스템이 아직 준비되지 않았습니다.' };
        const trimmed = (name || '').trim();
        if (!trimmed) return { ok: false, error: '스킨 이름을 입력해 주세요.' };

        const id = this._genId();
        this.state.skins[id] = { name: trimmed, settings: this._cloneSettings(Appearance.settings) };
        await this.switchTo(id);
        return { ok: true, id, name: trimmed };
    },

    async renameSkin(id, name) {
        if (!this.state || !this.state.skins[id]) return { ok: false, error: '존재하지 않는 스킨입니다.' };
        const trimmed = (name || '').trim();
        if (!trimmed) return { ok: false, error: '스킨 이름을 입력해 주세요.' };
        this.state.skins[id].name = trimmed;
        await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, this.state);
        return { ok: true };
    },

    // 마지막 남은 스킨은 삭제할 수 없다(항상 최소 1개는 활성 상태여야 하므로).
    // 삭제된 스킨이 활성 스킨이었다면 "기본" 스킨(있으면) 또는 남은 스킨 중 하나로 전환.
    async deleteSkin(id) {
        if (!this.state || !this.state.skins[id]) return { ok: false, error: '존재하지 않는 스킨입니다.' };
        if (Object.keys(this.state.skins).length <= 1) {
            return { ok: false, error: '마지막 남은 스킨은 삭제할 수 없습니다.' };
        }

        const wasActive = this.state.activeId === id;
        delete this.state.skins[id];
        if (wasActive) {
            const fallbackId = this.state.skins[this.DEFAULT_ID] ? this.DEFAULT_ID : Object.keys(this.state.skins)[0];
            // switchTo()가 activeId 갱신 + 저장 + BeatSkinImages/BeatFonts 갱신까지 처리.
            await this.switchTo(fallbackId);
        } else {
            await BeatLocalStore.set(this.STORE_NAME, this.STATE_KEY, this.state);
        }
        return { ok: true };
    },

    // ── 설정 화면 UI 배선(3단계) ──────────────────────
    // select(#skin-select) + 전환/새 이름으로 저장/이름 변경/삭제 버튼(#skin-load-btn 등)이
    // 이미 마크업에 있다고 가정하고 이벤트만 건다. 연습모드 "내 프리셋" UI와 동일한 패턴
    // (prompt()로 이름 입력, confirm()으로 삭제 확인, select는 이름순 정렬).
    initUI() {
        try {
            const select = document.getElementById('skin-select');
            const loadBtn = document.getElementById('skin-load-btn');
            const newBtn = document.getElementById('skin-new-btn');
            const renameBtn = document.getElementById('skin-rename-btn');
            const deleteBtn = document.getElementById('skin-delete-btn');
            const statusEl = document.getElementById('skin-status');

            const setStatus = (msg, isError) => {
                if (!statusEl) return;
                statusEl.textContent = msg || '';
                statusEl.classList.toggle('text-red-400', !!isError);
                statusEl.classList.toggle('text-gray-400', !isError);
            };

            // 스킨 전환(switchTo/createSkin/deleteSkin) 이후에도 다시 불러 최신 목록/선택
            // 상태를 반영할 수 있도록 참조를 보관해 둔다.
            this._refreshSelect = () => {
                if (!select || !this.state) return;
                const list = this.listSkins().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
                const currentValue = select.value;
                select.innerHTML = '';
                list.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.name;
                    select.appendChild(opt);
                });
                const target = list.some(s => s.id === this.state.activeId) ? this.state.activeId : currentValue;
                if (list.some(s => s.id === target)) select.value = target;
            };

            if (loadBtn && select) {
                loadBtn.addEventListener('click', async () => {
                    if (!select.value || !this.state || select.value === this.state.activeId) return;
                    const name = this.state.skins[select.value] ? this.state.skins[select.value].name : select.value;
                    await this.switchTo(select.value);
                    setStatus(`"${name}" 스킨으로 전환했습니다.`, false);
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                });
            }

            if (newBtn) {
                newBtn.addEventListener('click', async () => {
                    const name = (prompt('새 스킨 이름을 입력하세요') || '').trim();
                    if (!name) return;
                    const result = await this.createSkin(name);
                    if (!result.ok) { setStatus(result.error, true); return; }
                    this._refreshSelect();
                    setStatus(`"${name}" 스킨을 만들고 전환했습니다.`, false);
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                });
            }

            if (renameBtn && select) {
                renameBtn.addEventListener('click', async () => {
                    if (!select.value || !this.state) return;
                    const current = this.state.skins[select.value];
                    const name = (prompt('새 이름을 입력하세요', current ? current.name : '') || '').trim();
                    if (!name) return;
                    const result = await this.renameSkin(select.value, name);
                    if (!result.ok) { setStatus(result.error, true); return; }
                    this._refreshSelect();
                    setStatus('스킨 이름을 변경했습니다.', false);
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                });
            }

            if (deleteBtn && select) {
                deleteBtn.addEventListener('click', async () => {
                    if (!select.value || !this.state) return;
                    const current = this.state.skins[select.value];
                    if (!confirm(`"${current ? current.name : ''}" 스킨을 삭제할까요?`)) return;
                    const result = await this.deleteSkin(select.value);
                    if (!result.ok) { setStatus(result.error, true); return; }
                    this._refreshSelect();
                    setStatus('스킨을 삭제했습니다.', false);
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                });
            }

            this._refreshSelect();
        } catch (err) {
            this._logError(err, 'BeatSkin.initUI');
        }
    },
};