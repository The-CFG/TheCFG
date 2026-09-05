// ════════════════════════════════════════════════
//  js/beat/appearance/fonts.js — BeatFonts (커스터마이징 계획 1-B단계)
//  TTF/OTF/WOFF/WOFF2 폰트를 업로드해 브라우저 FontFace로 등록하고, 판정 텍스트/콤보/
//  카운트다운/전역 UI 폰트(모두 Appearance.settings에서 참조하는 스킨 소유 값)에 쓸 수
//  있게 해주는 모듈.
//
//  저장 범위: 이번 단계는 "로컬 저장(비로그인/오프라인)"까지만 구현한다. 계획 문서의
//  클라우드 저장(beat-files 버킷 업로드, beat_settings.customFonts)은 권장 착수 순서
//  8번(4단계 클라우드 동기화)에서 계정 동기화 작업과 함께 처리한다 — 로컬 저장만으로도
//  이번 단계 기능은 독립적으로 동작한다.
//
//  저장 구조: BeatLocalStore의 'fonts' 스토어에 폰트 id를 키로
//  { name, format, blob } 형태 저장(메타데이터+바이너리를 한 레코드에 함께 — 목록 UI를
//  채울 때 별도 조회 없이 getAllKeys()만으로 순회 가능하도록).
//
//  버그 수정: 판정/콤보/카운트다운 폰트(judgementFontId/comboFontId/countdownFontId)는
//  스킨의 일부(Appearance.settings)라 스킨을 바꾸면 함께 바뀌는데, "전체 UI 폰트"만은
//  예전에 이 모듈이 BeatLocalStore의 'misc' 스토어에 activeUiFontId라는 별도 전역 키로
//  독립 저장하고 있었다 — 그래서 스킨을 바꿔도 전체 UI 폰트만 그대로 남는 버그가 있었다.
//  이제 uiFontId도 Appearance.settings의 일부(다른 폰트 3종과 동일한 취급)로 옮겨서
//  BeatSkin.captureFromAppearance()/applyActive()가 함께 저장·전환하게 한다. 이 모듈은
//  이제 순수 "폰트 등록소"(업로드/삭제/FontFace 등록, id → font-family 조회)와 설정 화면
//  select 4개(전체 UI/판정/콤보/카운트다운) 배선만 담당하고, 선택값 자체를 어디에
//  저장할지는 관여하지 않는다 — 판정/콤보/카운트다운과 완전히 동일한 패턴.
//
//  기존 사용자의 activeUiFontId(misc 스토어)는 BeatSkin._readLegacyUiFontKey()가 1회
//  흡수해 활성 스킨의 uiFontId로 옮기고 misc 키는 지운다(skin.js 참고).
//
//  의존: local-store.js(BeatLocalStore) — 이 파일보다 먼저 로드되어야 한다.
// ════════════════════════════════════════════════

const BeatFonts = {
    STORE_NAME: 'fonts',
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

    // 앱 시작 시 1회 호출: IndexedDB에 저장된 모든 폰트를 다시 FontFace로 등록한다.
    // 실제 적용(전역 UI/판정/콤보/카운트다운 각각 어떤 폰트를 쓸지)은 Appearance.settings를
    // 통해 BeatSkin.applyActive()가 담당하므로 여기서는 등록만 한다. main.js
    // initialize()에서 Appearance.init()/BeatSkin.init() 이전에 호출해야 그쪽에서 폰트를
    // 참조할 때 이미 FontFace가 등록돼 있다.
    async init() {
        try {
            const ids = await BeatLocalStore.getAllKeys(this.STORE_NAME);
            for (const id of ids) {
                const entry = await BeatLocalStore.get(this.STORE_NAME, id);
                if (!entry || !entry.blob) continue;
                this.fonts[id] = { name: entry.name, format: entry.format };
                await this._registerFace(id, entry.blob);
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

        // 삭제되는 폰트를 참조하던 곳(전역 UI / 판정·콤보·카운트다운, 전부 스킨 소유
        // Appearance.settings 값)은 기본값으로 되돌린다.
        if (typeof Appearance !== 'undefined' && Appearance.settings) {
            let touched = false;
            ['uiFontId', 'judgementFontId', 'comboFontId', 'countdownFontId'].forEach(key => {
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

    // 클라우드에서 받아온 폰트를 로컬에 등록한다(업로드 검증·새 id 발급 없이 원래 id를
    // 그대로 사용 — 기기 간에 Appearance.settings.judgementFontId 등이 같은 id를 참조하므로
    // 이 id를 유지해야 한다). BeatCustomizationSync.pullAll()에서만 호출.
    async registerDownloaded(id, name, format, blob) {
        if (this.fonts[id]) {
            return { ok: true, id, name: this.fonts[id].name, familyName: this.FONT_FAMILY_PREFIX + id };
        }
        const familyName = await this._registerFace(id, blob);
        if (!familyName) return { ok: false, error: '폰트를 등록하지 못했습니다.' };

        const saved = await BeatLocalStore.set(this.STORE_NAME, id, { name, format, blob });
        if (!saved) {
            document.fonts.delete(this._faces[id]);
            delete this._faces[id];
            return { ok: false, error: '폰트를 저장하지 못했습니다.' };
        }
        this.fonts[id] = { name, format };
        return { ok: true, id, name, familyName };
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

    // ── 설정 화면 UI 배선 ──────────────────────────
    // main.js initialize()에서 Appearance.init() 이후(전체 UI/판정/콤보/카운트다운
    // select가 Appearance.settings의 현재 값을 반영해야 하므로) 호출한다.
    async initUI() {
        try {
            const fileInput = document.getElementById('font-upload-input');
            const nameInput = document.getElementById('font-upload-name');
            const uploadBtn = document.getElementById('font-upload-btn');
            const statusEl = document.getElementById('font-upload-status');

            const selects = {
                uiFontId: document.getElementById('font-select-ui'),
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
                const list = this.listFonts();

                Object.entries(selects).forEach(([key, select]) => {
                    if (!select) return;
                    const current = Appearance.settings[key] || '';
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
                                if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                            });
                            row.appendChild(label);
                            row.appendChild(delBtn);
                            listEl.appendChild(row);
                        });
                    }
                }
            };
            // BeatSkin.switchTo() 등 외부에서 스킨 전환 후 select들을 다시 그릴 수 있도록
            // 참조를 보관(refreshUI() 참고).
            this._refreshSelects = refreshSelects;

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
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                });
            }

            // 전체 UI/판정/콤보/카운트다운 폰트 전부 스킨의 일부(Appearance.settings)이므로
            // 여기서는 값만 바꾸고, 실제 저장·클라우드 반영은 "적용" 버튼(saveSettings ->
            // BeatSkin.captureFromAppearance -> schedulePush)에서 이뤄진다.
            ['uiFontId', 'judgementFontId', 'comboFontId', 'countdownFontId'].forEach(key => {
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

    // 설정 화면이 이미 배선된 뒤(initUI() 실행 후) 스킨 전환 등으로 Appearance.settings의
    // uiFontId/judgementFontId/comboFontId/countdownFontId가 통째로 바뀌었을 때 select
    // 값들을 다시 그린다(BeatSkin.switchTo()에서 호출). initUI()가 아직 호출되지 않은
    // 페이지에서는 조용히 무시한다.
    async refreshUI() {
        if (this._refreshSelects) await this._refreshSelects();
    },
};