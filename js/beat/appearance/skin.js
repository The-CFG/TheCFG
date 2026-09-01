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
        this.state.skins[id] = { name: trimmed, settings: { ...Appearance.settings } };
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
                });
            }

            this._refreshSelect();
        } catch (err) {
            this._logError(err, 'BeatSkin.initUI');
        }
    },
};