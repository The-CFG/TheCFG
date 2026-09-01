// ════════════════════════════════════════════════
//  js/beat/appearance/fonts.js — BeatFonts (커스터마이징 계획 1-B단계)
//  TTF/OTF/WOFF/WOFF2 폰트를 업로드해 브라우저 FontFace로 등록하고, 판정 텍스트/콤보/
//  카운트다운(컴포넌트별, Appearance.settings에서 참조) 및 전역 UI 폰트(--tb-font-family)에
//  쓸 수 있게 해주는 모듈.
//
//  저장 범위: 이번 단계는 "로컬 저장(비로그인/오프라인)"까지만 구현한다. 계획 문서의
//  클라우드 저장(beat-files 버킷 업로드, beat_settings.customFonts)은 권장 착수 순서
//  8번(4단계 클라우드 동기화)에서 계정 동기화 작업과 함께 처리한다 — 로컬 저장만으로도
//  이번 단계 기능은 독립적으로 동작한다.
//
//  저장 구조: BeatLocalStore의 'fonts' 스토어에 폰트 id를 키로
//  { name, format, blob } 형태 저장(메타데이터+바이너리를 한 레코드에 함께 — 목록 UI를
//  채울 때 별도 조회 없이 getAllKeys()만으로 순회 가능하도록). 'misc' 스토어의
//  'activeUiFontId' 키에 전역 UI 폰트로 선택된 폰트 id(문자열)를 저장한다.
//
//  판정/콤보/카운트다운 폰트는 이 모듈이 아니라 Appearance.settings.judgementFontId /
//  comboFontId / countdownFontId(스킨에 포함되는 값)로 관리한다 — BeatFonts는 "폰트
//  등록소" 역할만 하고, 어떤 화면 요소가 어떤 폰트를 쓸지는 각 소비 모듈(Appearance/
//  BeatSkin은 게임플레이 스킨 범위, 전역 UI 폰트는 크롬 레벨이라 이 모듈이 직접 관리)이
//  결정한다.
//
//  의존: local-store.js(BeatLocalStore) — 이 파일보다 먼저 로드되어야 한다.
// ════════════════════════════════════════════════

const BeatFonts = {
    STORE_NAME: 'fonts',
    MISC_STORE_NAME: 'misc',
    ACTIVE_UI_FONT_KEY: 'activeUiFontId',
    ALLOWED_EXTENSIONS: ['ttf', 'otf', 'woff', 'woff2'],
    MAX_SIZE_BYTES: 2 * 1024 * 1024, // 2MB
    FONT_FAMILY_PREFIX: 'BeatCustomFont-',

    // id -> { name, format } (Blob은 여기 들고 있지 않음 — document.fonts에 이미 등록됐고,
    // 목록 UI에는 메타데이터만 필요하기 때문)
    fonts: {},
    // id -> FontFace 인스턴스. document.fonts에서 제거(delete)할 때 참조가 필요해 보관.
    _faces: {},

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.error(`[${context}]`, err);
        }
    },

    // 앱 시작 시 1회 호출: IndexedDB에 저장된 모든 폰트를 다시 FontFace로 등록하고,
    // 저장된 전역 UI 폰트 선택을 재적용한다. main.js initialize()에서 Appearance.init()
    // 이전에 호출해야 판정/콤보/카운트다운 CSS 변수가 처음부터 올바른 폰트로 채워진다.
    async init() {
        try {
            const ids = await BeatLocalStore.getAllKeys(this.STORE_NAME);
            for (const id of ids) {
                const entry = await BeatLocalStore.get(this.STORE_NAME, id);
                if (!entry || !entry.blob) continue;
                this.fonts[id] = { name: entry.name, format: entry.format };
                await this._registerFace(id, entry.blob);
            }

            const activeUiFontId = await BeatLocalStore.get(this.MISC_STORE_NAME, this.ACTIVE_UI_FONT_KEY);
            if (activeUiFontId && this.fonts[activeUiFontId]) {
                this._applyUiFontVariable(activeUiFontId);
            }
        } catch (err) {
            this._logError(err, 'BeatFonts.init');
        }
    },

    _validate(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
            return { ok: false, error: `지원하지 않는 폰트 형식입니다 (.${this.ALLOWED_EXTENSIONS.join(', .')}만 가능)` };
        }
        if (file.size > this.MAX_SIZE_BYTES) {
            return { ok: false, error: `폰트 파일은 ${Math.round(this.MAX_SIZE_BYTES / (1024 * 1024))}MB 이하만 업로드할 수 있습니다.` };
        }
        return { ok: true, ext };
    },

    async _registerFace(id, blob) {
        try {
            const buffer = await blob.arrayBuffer();
            const familyName = this.FONT_FAMILY_PREFIX + id;
            const face = new FontFace(familyName, buffer);
            await face.load();
            document.fonts.add(face);
            this._faces[id] = face;
            return familyName;
        } catch (err) {
            this._logError(err, 'BeatFonts._registerFace');
            return null;
        }
    },

    // 파일을 검증하고 등록·저장까지 한 번에 처리한다. UI(initUI)와 다른 소비 코드가 함께 쓴다.
    async uploadFont(file, displayName) {
        const check = this._validate(file);
        if (!check.ok) return { ok: false, error: check.error };

        const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const name = (displayName && displayName.trim()) || file.name.replace(/\.[^.]+$/, '');

        const familyName = await this._registerFace(id, file);
        if (!familyName) {
            return { ok: false, error: '폰트를 불러오는 중 오류가 발생했습니다. 파일이 손상되지 않았는지 확인해 주세요.' };
        }

        const saved = await BeatLocalStore.set(this.STORE_NAME, id, { name, format: check.ext, blob: file });
        if (!saved) {
            document.fonts.delete(this._faces[id]);
            delete this._faces[id];
            return { ok: false, error: '폰트를 저장하지 못했습니다.' };
        }

        this.fonts[id] = { name, format: check.ext };
        return { ok: true, id, name, familyName };
    },

    async deleteFont(id) {
        if (this._faces[id]) {
            document.fonts.delete(this._faces[id]);
            delete this._faces[id];
        }
        delete this.fonts[id];

        // 삭제되는 폰트를 참조하던 곳(전역 UI 폰트 / 판정·콤보·카운트다운)은 기본값으로 되돌린다.
        try {
            const activeUiFontId = await BeatLocalStore.get(this.MISC_STORE_NAME, this.ACTIVE_UI_FONT_KEY);
            if (activeUiFontId === id) {
                await this.setUiFont(null);
            }
        } catch (err) {
            this._logError(err, 'BeatFonts.deleteFont(uiFont fallback)');
        }
        if (typeof Appearance !== 'undefined' && Appearance.settings) {
            let touched = false;
            ['judgementFontId', 'comboFontId', 'countdownFontId'].forEach(key => {
                if (Appearance.settings[key] === id) {
                    Appearance.settings[key] = null;
                    touched = true;
                }
            });
            if (touched && Appearance.updateJudgementCssVariables) {
                Appearance.updateJudgementCssVariables();
            }
        }

        return await BeatLocalStore.delete(this.STORE_NAME, id);
    },

    listFonts() {
        return Object.entries(this.fonts).map(([id, f]) => ({ id, name: f.name, format: f.format }));
    },

    // id에 해당하는 CSS font-family 값(따옴표 포함, 콤마 폴백 없이 이름만). 없으면 null —
    // 호출부가 CSS 기본값(inherit 등)으로 폴백해야 한다.
    getFontFamily(id) {
        if (!id || !this.fonts[id]) return null;
        return `${this.FONT_FAMILY_PREFIX}${id}`;
    },

    // CSS var() 안에 바로 넣을 수 있는 형태. 폰트가 없으면 fallback을 그대로 반환.
    getFontFamilyCss(id, fallback = 'inherit') {
        const family = this.getFontFamily(id);
        return family ? `'${family}', ${fallback}` : fallback;
    },

    _applyUiFontVariable(id) {
        const value = this.getFontFamilyCss(id, "'Inter', sans-serif");
        document.documentElement.style.setProperty('--tb-font-family', value);
    },

    // 전역 UI 폰트를 설정하고 저장한다. id가 null/falsy면 기본 폰트로 되돌린다.
    async setUiFont(id) {
        this._applyUiFontVariable(id);
        if (id) {
            await BeatLocalStore.set(this.MISC_STORE_NAME, this.ACTIVE_UI_FONT_KEY, id);
        } else {
            await BeatLocalStore.delete(this.MISC_STORE_NAME, this.ACTIVE_UI_FONT_KEY);
        }
    },

    async getActiveUiFontId() {
        return await BeatLocalStore.get(this.MISC_STORE_NAME, this.ACTIVE_UI_FONT_KEY);
    },

    // ── 설정 화면 UI 배선 ──────────────────────────
    // main.js initialize()에서 Appearance.init() 이후(판정/콤보/카운트다운 select가
    // Appearance.settings의 현재 값을 반영해야 하므로) 호출한다.
    async initUI() {
        try {
            const fileInput = document.getElementById('font-upload-input');
            const nameInput = document.getElementById('font-upload-name');
            const uploadBtn = document.getElementById('font-upload-btn');
            const statusEl = document.getElementById('font-upload-status');

            const selects = {
                ui: document.getElementById('font-select-ui'),
                judgementFontId: document.getElementById('font-select-judgement'),
                comboFontId: document.getElementById('font-select-combo'),
                countdownFontId: document.getElementById('font-select-countdown'),
            };

            const setStatus = (msg, isError) => {
                if (!statusEl) return;
                statusEl.textContent = msg || '';
                statusEl.classList.toggle('text-red-400', !!isError);
                statusEl.classList.toggle('text-gray-400', !isError);
            };

            const refreshSelects = async () => {
                const activeUiFontId = await this.getActiveUiFontId();
                const list = this.listFonts();

                Object.entries(selects).forEach(([key, select]) => {
                    if (!select) return;
                    const current = key === 'ui' ? (activeUiFontId || '') : (Appearance.settings[key] || '');
                    select.innerHTML = '';
                    const defaultOpt = document.createElement('option');
                    defaultOpt.value = '';
                    defaultOpt.textContent = '기본';
                    select.appendChild(defaultOpt);
                    list.forEach(f => {
                        const opt = document.createElement('option');
                        opt.value = f.id;
                        opt.textContent = f.name;
                        select.appendChild(opt);
                    });
                    select.value = list.some(f => f.id === current) ? current : '';
                });

                const listEl = document.getElementById('font-uploaded-list');
                if (listEl) {
                    listEl.innerHTML = '';
                    if (list.length === 0) {
                        const empty = document.createElement('p');
                        empty.className = 'text-xs text-gray-500';
                        empty.textContent = '업로드된 폰트가 없습니다.';
                        listEl.appendChild(empty);
                    } else {
                        list.forEach(f => {
                            const row = document.createElement('div');
                            row.className = 'flex items-center justify-between text-sm bg-gray-800 rounded px-2 py-1';
                            const label = document.createElement('span');
                            label.className = 'text-gray-300 truncate';
                            label.textContent = `${f.name} (.${f.format})`;
                            const delBtn = document.createElement('button');
                            delBtn.type = 'button';
                            delBtn.className = 'text-red-400 hover:text-red-300 text-xs shrink-0 ml-2';
                            delBtn.textContent = '삭제';
                            delBtn.addEventListener('click', async () => {
                                await this.deleteFont(f.id);
                                await refreshSelects();
                                setStatus(`"${f.name}" 폰트를 삭제했습니다.`, false);
                            });
                            row.appendChild(label);
                            row.appendChild(delBtn);
                            listEl.appendChild(row);
                        });
                    }
                }
            };

            if (uploadBtn && fileInput) {
                uploadBtn.addEventListener('click', async () => {
                    const file = fileInput.files && fileInput.files[0];
                    if (!file) {
                        setStatus('업로드할 폰트 파일을 선택해 주세요.', true);
                        return;
                    }
                    uploadBtn.disabled = true;
                    setStatus('폰트를 불러오는 중…', false);
                    const result = await this.uploadFont(file, nameInput ? nameInput.value : '');
                    uploadBtn.disabled = false;
                    if (!result.ok) {
                        setStatus(result.error, true);
                        return;
                    }
                    fileInput.value = '';
                    if (nameInput) nameInput.value = '';
                    setStatus(`"${result.name}" 폰트를 추가했습니다.`, false);
                    await refreshSelects();
                });
            }

            if (selects.ui) {
                selects.ui.addEventListener('change', async (e) => {
                    await this.setUiFont(e.target.value || null);
                });
            }

            ['judgementFontId', 'comboFontId', 'countdownFontId'].forEach(key => {
                const select = selects[key];
                if (!select) return;
                select.addEventListener('change', (e) => {
                    Appearance.settings[key] = e.target.value || null;
                    if (Appearance.updateJudgementCssVariables) {
                        Appearance.updateJudgementCssVariables();
                    }
                });
            });

            await refreshSelects();
        } catch (err) {
            this._logError(err, 'BeatFonts.initUI');
        }
    },
};