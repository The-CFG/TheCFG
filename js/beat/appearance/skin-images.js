// ════════════════════════════════════════════════
//  js/beat/appearance/skin-images.js — BeatSkinImages (커스터마이징 계획 2단계)
//  노트(tap/long/false, 종류별 기본값 + 레인별 오버라이드) · 판정 텍스트(perfect/good/bad/miss) ·
//  카운트다운(3/2/1/start) · 결과 등급(S/A/B/C) 자리에 사용자가 업로드한 이미지를 쓸 수
//  있게 해주는 모듈.
//
//  노트 이미지는 두 층으로 구성된다: ①종류별 기본값(note-tap/long/false, 레인 상관없이
//  적용) ②레인별 오버라이드(note-tap@L2 형식, 9개 레인 x 3종류 = 27개, laneSlotId() 참고).
//  렌더링(game.js의 _noteImage)은 레인별 오버라이드가 있으면 그걸, 없으면 종류별 기본값을,
//  그것도 없으면 null(기존 도형/색상 렌더링으로 폴백)을 쓴다. 27개를 전부 개별 <input>으로
//  두면 화면이 너무 길어져서, 설정 화면에서는 "종류 선택 + 레인 선택 + 업로드 1개" 조합으로
//  고르게 하고(_initLaneUI), 이미 설정된 조합은 목록에서 바로 삭제할 수 있게 한다.
//
//  저장 범위: BeatFonts(1-B단계)와 동일하게 로컬 저장(IndexedDB) + 클라우드 동기화(4단계,
//  BeatCustomizationSync — 스킨(BeatSkin.state)에 얹혀서 함께 push/pull된다)까지 구현.
//
//  저장 구조: BeatLocalStore의 'images' 스토어에 `${skinId}:${slotId}`(SLOTS 참고)를
//  키로 { name, blob } 저장. 스킨(BeatSkin)마다 독립적인 이미지 세트를 가지며, 현재
//  로드/편집 대상은 _activeSkinId(기본값은 BeatSkin.DEFAULT_ID)로 추적한다. 슬롯은
//  최대 42개로 개수가 고정돼 있어(스킨처럼 사용자가 개수를 늘리는 구조가 아님) 폰트처럼
//  별도 id 발급 없이 슬롯 id를 키의 일부로 그대로 쓴다.
//
//  마이그레이션: 스킨별 구조 도입 이전에는 키가 슬롯 id 하나(콜론 없음)였다. init()이
//  처음 실행될 때 이런 레거시 키를 1회 발견해 "기본" 스킨(`${BeatSkin.DEFAULT_ID}:슬롯id`)
//  것으로 옮기고 원래 키는 지운다(_migrateLegacyGlobalImages). 이후로는 항상 스킨별
//  키만 존재하므로 이 마이그레이션은 자연히 1회만 동작한다.
//
//  "이미지가 설정되지 않은 키는 기존처럼 기본 텍스트/도형 렌더링을 그대로 유지"
//  (계획 문서 2단계) — 이 모듈은 슬롯별로 있으면 URL/Image를, 없으면 null을 돌려주는
//  방식으로 그 요구사항을 보장한다. 소비 코드(game.js/ui.js)는 null이면 반드시 기존
//  렌더링 경로로 폴백해야 한다. 이 소비 코드는 여전히 slotId만으로 getURL/getImage를
//  호출하며(스킨 구분 없이), 이 모듈이 내부적으로 "현재 활성 스킨의" 항목만 캐시에
//  들고 있는 방식으로 스킨 전환을 투명하게 처리한다.
//
//  의존: local-store.js(BeatLocalStore) — 이 파일보다 먼저 로드되어야 한다.
//  BeatSkin(skin.js)이 있으면 활성 스킨 id를 참조하지만, 없어도(다른 페이지 등)
//  BeatSkin.DEFAULT_ID와 동일한 'default'로 동작하도록 폴백한다.
// ════════════════════════════════════════════════

const BeatSkinImages = {
    STORE_NAME: 'images',
    ALLOWED_EXTENSIONS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
    MAX_SIZE_BYTES: 1.5 * 1024 * 1024, // 1.5MB — 폰트보다 개수가 많아(최대 15개) 더 낮게 제한

    // 레인별 노트 이미지 오버라이드(사용자 요청) — 좌우 대칭 9칸(L4~R4)은 4/5/6/7/8키 전부를
    // 포괄하는 CONFIG.LANE_KEY_MAPPING_ORDER의 합집합과 동일하다(appearance.js의 레인별
    // 색상 미리보기가 쓰는 라벨 집합과도 동일하게 맞춤).
    LANE_IDS: ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'],
    LANE_LABELS: {
        L4: '왼쪽 4', L3: '왼쪽 3', L2: '왼쪽 2', L1: '왼쪽 1',
        C1: '가운데',
        R1: '오른쪽 1', R2: '오른쪽 2', R3: '오른쪽 3', R4: '오른쪽 4',
    },
    NOTE_TYPE_BASES: [
        { id: 'note-tap',   label: '탭 노트' },
        { id: 'note-long',  label: '롱 노트' },
        { id: 'note-false', label: '가짜 노트' },
    ],

    // 레인별 오버라이드 슬롯 id를 만든다("note-tap@L2" 형식). 렌더링(game.js)이 노트를
    // 그릴 때 이 id로 먼저 찾아보고, 없으면 종류별 기본 슬롯(note-tap 등)으로 폴백한다.
    laneSlotId(base, laneId) {
        return `${base}@${laneId}`;
    },

    // slotId -> { id, group, label } 목록. group은 UI에서 섹션을 나눌 때, label은 목록/버튼
    // 표시용. note-tap/long/false(종류별 기본값, 레인 상관없이 적용) + 레인별 오버라이드
    // 27개(3종류 × 9레인) + 판정 텍스트 4 + 카운트다운 4 + 결과 등급 4 = 총 42개.
    SLOTS: (function() {
        const noteBases = [
            { id: 'note-tap',   group: 'note', label: '탭 노트' },
            { id: 'note-long',  group: 'note', label: '롱 노트' },
            { id: 'note-false', group: 'note', label: '가짜 노트' },
        ];
        const laneIds = ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'];
        const laneLabels = {
            L4: '왼쪽 4', L3: '왼쪽 3', L2: '왼쪽 2', L1: '왼쪽 1',
            C1: '가운데',
            R1: '오른쪽 1', R2: '오른쪽 2', R3: '오른쪽 3', R4: '오른쪽 4',
        };
        const laneSlots = [];
        noteBases.forEach(base => {
            laneIds.forEach(laneId => {
                laneSlots.push({
                    id: `${base.id}@${laneId}`,
                    group: 'note-lane',
                    label: `${base.label} · ${laneLabels[laneId]}`,
                    base: base.id,
                    laneId,
                });
            });
        });
        return [
            ...noteBases,
            ...laneSlots,
            { id: 'judgement-perfect', group: 'judgement', label: 'PERFECT' },
            { id: 'judgement-good',    group: 'judgement', label: 'GOOD' },
            { id: 'judgement-bad',     group: 'judgement', label: 'BAD' },
            { id: 'judgement-miss',    group: 'judgement', label: 'MISS' },
            { id: 'countdown-3',     group: 'countdown', label: '3' },
            { id: 'countdown-2',     group: 'countdown', label: '2' },
            { id: 'countdown-1',     group: 'countdown', label: '1' },
            { id: 'countdown-start', group: 'countdown', label: 'START' },
            { id: 'rank-S', group: 'rank', label: 'S' },
            { id: 'rank-A', group: 'rank', label: 'A' },
            { id: 'rank-B', group: 'rank', label: 'B' },
            { id: 'rank-C', group: 'rank', label: 'C' },
        ];
    })(),

    // slotId -> { name, url, img } — url은 URL.createObjectURL() 결과(<img> src용),
    // img는 캔버스 drawImage용으로 미리 로드해 둔 HTMLImageElement.
    // 항상 "현재 활성 스킨"의 항목만 들어 있다 — 스킨 전환 시 switchTo()가 전부 비우고 다시 채운다.
    _entries: {},

    // 지금 로드/업로드/삭제 대상이 되는 스킨 id. BeatSkin이 없는 페이지에서도 동작하도록
    // 'default'를 코드 기본값으로 둔다(BeatSkin.DEFAULT_ID와 반드시 같은 값이어야 함).
    _activeSkinId: 'default',

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.error(`[${context}]`, err);
        }
    },

    isValidSlot(slotId) {
        return this.SLOTS.some(s => s.id === slotId);
    },

    // 스킨 id + 슬롯 id로 실제 IndexedDB 키를 만든다.
    _key(skinId, slotId) {
        return `${skinId}:${slotId}`;
    },

    // BeatSkin이 로드돼 있으면 그 activeId를, 없으면 'default'(BeatSkin.DEFAULT_ID와 동일)를 쓴다.
    _resolveActiveSkinId() {
        if (typeof BeatSkin !== 'undefined' && BeatSkin.state && BeatSkin.state.activeId) {
            return BeatSkin.state.activeId;
        }
        return (typeof BeatSkin !== 'undefined' && BeatSkin.DEFAULT_ID) || 'default';
    },

    // 스킨별 구조 도입 이전(콜론 없는 슬롯 id 하나가 키였던 시절)에 저장된 이미지를
    // "기본" 스킨(BeatSkin.DEFAULT_ID) 소유로 1회 옮긴다. 옮긴 뒤 원래 키는 지우므로
    // 다음 실행부터는 레거시 키가 남아 있지 않아 자연히 다시 실행되지 않는다.
    async _migrateLegacyGlobalImages() {
        try {
            const allKeys = await BeatLocalStore.getAllKeys(this.STORE_NAME);
            const legacyKeys = allKeys.filter(k => this.isValidSlot(k));
            if (legacyKeys.length === 0) return;

            const defaultId = (typeof BeatSkin !== 'undefined' && BeatSkin.DEFAULT_ID) || 'default';
            for (const slotId of legacyKeys) {
                const entry = await BeatLocalStore.get(this.STORE_NAME, slotId);
                if (entry) {
                    await BeatLocalStore.set(this.STORE_NAME, this._key(defaultId, slotId), entry);
                }
                await BeatLocalStore.delete(this.STORE_NAME, slotId);
            }
        } catch (err) {
            this._logError(err, 'BeatSkinImages._migrateLegacyGlobalImages');
        }
    },

    // 지정한 스킨 소유의 이미지들만 불러와 object URL + Image를 준비한다.
    // 호출 전 _entries가 비어 있다고 가정한다(스킨 전환 시 switchTo()가 먼저 비운다).
    async _loadForSkin(skinId) {
        const prefix = `${skinId}:`;
        const allKeys = await BeatLocalStore.getAllKeys(this.STORE_NAME);
        for (const key of allKeys) {
            if (!key.startsWith(prefix)) continue;
            const slotId = key.slice(prefix.length);
            if (!this.isValidSlot(slotId)) continue;
            const entry = await BeatLocalStore.get(this.STORE_NAME, key);
            if (!entry || !entry.blob) continue;
            await this._register(slotId, entry.name, entry.blob);
        }
    },

    // 앱 시작 시 1회 호출: 활성 스킨 소유의 슬롯 이미지를 불러와 object URL + Image를
    // 준비한다. main.js initialize()에서 BeatSkin.init()이 activeId를 확정한 뒤에
    // 호출한다(노트 캔버스 드로잉이 첫 프레임부터 올바른 스킨의 이미지를 참조할 수 있도록).
    async init() {
        try {
            await this._migrateLegacyGlobalImages();
            this._activeSkinId = this._resolveActiveSkinId();
            await this._loadForSkin(this._activeSkinId);
        } catch (err) {
            this._logError(err, 'BeatSkinImages.init');
        }
    },

    // BeatSkin.switchTo(id)에서 호출: 지금 캐시된(이전 활성 스킨의) 이미지를 모두
    // 해제하고, 새로 활성화된 스킨의 이미지 세트로 다시 로드한 뒤 설정 화면 UI를
    // 갱신한다(이미 initUI()가 실행돼 있다면).
    async switchTo(skinId) {
        try {
            this._revokeAll();
            this._activeSkinId = skinId;
            await this._loadForSkin(skinId);
            this.refreshUI();
        } catch (err) {
            this._logError(err, 'BeatSkinImages.switchTo');
        }
    },

    async _register(slotId, name, blob) {
        try {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            await new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve; // 로드 실패해도 앱 흐름은 막지 않음(getImage가 null 취급하도록 아래서 체크)
                img.src = url;
            });
            this._entries[slotId] = { name, url, img: img.complete && img.naturalWidth > 0 ? img : null };
        } catch (err) {
            this._logError(err, 'BeatSkinImages._register');
        }
    },

    _validate(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
            return { ok: false, error: `지원하지 않는 이미지 형식입니다 (.${this.ALLOWED_EXTENSIONS.join(', .')}만 가능)` };
        }
        if (file.size > this.MAX_SIZE_BYTES) {
            return { ok: false, error: `이미지 파일은 ${(this.MAX_SIZE_BYTES / (1024 * 1024)).toFixed(1)}MB 이하만 업로드할 수 있습니다.` };
        }
        return { ok: true };
    },

    async uploadImage(slotId, file) {
        if (!this.isValidSlot(slotId)) return { ok: false, error: '알 수 없는 이미지 슬롯입니다.' };
        const check = this._validate(file);
        if (!check.ok) return { ok: false, error: check.error };

        // 이전에 이 슬롯에 등록돼 있던 object URL은 교체 전에 해제(메모리 누수 방지).
        this._revoke(slotId);

        const name = file.name;
        await this._register(slotId, name, file);
        const saved = await BeatLocalStore.set(this.STORE_NAME, this._key(this._activeSkinId, slotId), { name, blob: file });
        if (!saved) {
            this._revoke(slotId);
            return { ok: false, error: '이미지를 저장하지 못했습니다.' };
        }
        return { ok: true, slotId, name };
    },

    _revoke(slotId) {
        const entry = this._entries[slotId];
        if (entry && entry.url) {
            try { URL.revokeObjectURL(entry.url); } catch { /* 무시 */ }
        }
        delete this._entries[slotId];
    },

    // 캐시된 모든 항목의 object URL을 해제하고 비운다(스킨 전환 시 사용).
    _revokeAll() {
        Object.keys(this._entries).forEach(slotId => this._revoke(slotId));
    },

    async deleteImage(slotId) {
        this._revoke(slotId);
        return await BeatLocalStore.delete(this.STORE_NAME, this._key(this._activeSkinId, slotId));
    },

    // <img> src나 CSS에 쓸 object URL. 없으면 null — 호출부가 기존 렌더링으로 폴백해야 한다.
    // 클라우드에서 받아온 스킨 이미지 맵({ slotId: storagePath })을 로컬(IndexedDB)에
    // 내려받는다. 이미 로컬에 있는 슬롯(이 기기에서 업로드했거나 이전에 받은 경우)은
    // 건드리지 않는다. BeatCustomizationSync.pullAll()에서만 호출.
    async downloadSkinImages(skinId, imagesMap) {
        if (!imagesMap) return;
        for (const [slotId, path] of Object.entries(imagesMap)) {
            if (!this.isValidSlot(slotId)) continue;
            const localKey = this._key(skinId, slotId);
            const existing = await BeatLocalStore.get(this.STORE_NAME, localKey);
            if (existing) continue;
            const blob = await CloudAuth.downloadCustomizationFile(path);
            if (!blob) continue;
            const name = path.split('/').pop();
            await BeatLocalStore.set(this.STORE_NAME, localKey, { name, blob });
        }
    },

    getURL(slotId) {
        const entry = this._entries[slotId];
        return entry ? entry.url : null;
    },

    // Canvas drawImage용 미리 로드된 이미지. 없거나 로드 실패했으면 null.
    getImage(slotId) {
        const entry = this._entries[slotId];
        return entry ? entry.img : null;
    },

    listBySlot() {
        return this.SLOTS.map(s => ({
            ...s,
            uploaded: !!this._entries[s.id],
            name: this._entries[s.id] ? this._entries[s.id].name : null,
        }));
    },

    // ── 설정 화면 UI 배선 ──────────────────────────
    // 종류별 고정 15슬롯: slotId별 <input type=file>(id: img-upload-<slotId>)과 삭제
    // 버튼(id: img-delete-<slotId>), 상태 뱃지(id: img-status-<slotId>)가 이미 마크업에
    // 있다고 가정하고 이벤트만 건다. 레인별 27슬롯은 개별 DOM이 없고 _initLaneUI()가
    // 별도로 처리한다.
    initUI() {
        try {
            // 스킨 전환 후에도 상태 뱃지를 다시 갱신할 수 있도록 슬롯별 refreshStatus를
            // 보관해 둔다(refreshUI() 참고). initUI()가 여러 번 불려도 매번 최신 DOM
            // 참조로 덮어써지므로 안전하다.
            this._refreshFns = {};

            this.SLOTS.filter(slot => slot.group !== 'note-lane').forEach(slot => {
                const fileInput = document.getElementById(`img-upload-${slot.id}`);
                const deleteBtn = document.getElementById(`img-delete-${slot.id}`);
                const statusEl  = document.getElementById(`img-status-${slot.id}`);

                const refreshStatus = () => {
                    if (!statusEl) return;
                    const entry = this._entries[slot.id];
                    statusEl.textContent = entry ? entry.name : '기본';
                    statusEl.classList.toggle('text-blue-400', !!entry);
                    statusEl.classList.toggle('text-gray-500', !entry);
                    if (deleteBtn) deleteBtn.classList.toggle('hidden', !entry);
                };
                this._refreshFns[slot.id] = refreshStatus;

                if (fileInput) {
                    fileInput.addEventListener('change', async (e) => {
                        const file = e.target.files && e.target.files[0];
                        if (!file) return;
                        const result = await this.uploadImage(slot.id, file);
                        fileInput.value = '';
                        if (!result.ok) {
                            if (typeof UI !== 'undefined' && UI.showMessage) UI.showMessage('settings', result.error);
                            return;
                        }
                        refreshStatus();
                        if (typeof UI !== 'undefined' && UI.showMessage) {
                            UI.showMessage('settings', `${slot.label} 이미지를 적용했습니다.`);
                        }
                        if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                    });
                }

                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async () => {
                        await this.deleteImage(slot.id);
                        refreshStatus();
                        if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                    });
                }

                refreshStatus();
            });

            this._initLaneUI();
        } catch (err) {
            this._logError(err, 'BeatSkinImages.initUI');
        }
    },

    // 레인별 노트 이미지 오버라이드 UI. "종류(탭/롱/가짜) 선택 + 레인(9개) 선택 + 업로드
    // 1개" 조합으로 원하는 슬롯(note-tap@L2 등)을 고르게 하고, 이미 설정된 조합은
    // 목록(#img-lane-list)에서 바로 확인·삭제할 수 있게 한다. 마크업이 없는 페이지에서는
    // (typeSelector/laneSelector 부재) 조용히 무시한다.
    _initLaneUI() {
        const typeSelector = document.getElementById('img-lane-type-selector');
        const laneSelector = document.getElementById('img-lane-selector');
        const fileInput    = document.getElementById('img-lane-upload-input');
        const deleteBtn    = document.getElementById('img-lane-delete-btn');
        const statusEl     = document.getElementById('img-lane-status');
        const listEl       = document.getElementById('img-lane-list');
        if (!typeSelector || !laneSelector) return;

        let selectedBase = this.NOTE_TYPE_BASES[0].id;
        let selectedLane = this.LANE_IDS[0];
        const currentSlotId = () => this.laneSlotId(selectedBase, selectedLane);

        const refreshStatus = () => {
            const entry = this._entries[currentSlotId()];
            if (statusEl) {
                statusEl.textContent = entry ? entry.name : '기본(종류별 이미지 또는 색상 사용)';
                statusEl.classList.toggle('text-blue-400', !!entry);
                statusEl.classList.toggle('text-gray-500', !entry);
            }
            if (deleteBtn) deleteBtn.classList.toggle('hidden', !entry);
        };

        const refreshList = () => {
            if (!listEl) return;
            const overrides = this.SLOTS.filter(s => s.group === 'note-lane' && this._entries[s.id]);
            listEl.innerHTML = '';
            if (overrides.length === 0) {
                listEl.innerHTML = '<p class="text-xs text-gray-500">설정된 레인별 이미지가 없습니다.</p>';
                return;
            }
            overrides.forEach(s => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between text-xs text-gray-300 py-1';
                const label = document.createElement('span');
                label.className = 'truncate';
                label.textContent = `${s.label}: ${this._entries[s.id].name}`;
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'text-red-400 hover:text-red-300 ml-2 flex-shrink-0';
                del.textContent = '삭제';
                del.addEventListener('click', async () => {
                    await this.deleteImage(s.id);
                    refreshStatus();
                    refreshList();
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
                });
                row.appendChild(label);
                row.appendChild(del);
                listEl.appendChild(row);
            });
        };

        // 스킨 전환 시(refreshUI()) 상태 뱃지 + 목록도 함께 다시 그릴 수 있도록 보관.
        this._refreshLaneStatus = refreshStatus;
        this._refreshLaneList = refreshList;

        typeSelector.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-type]');
            if (!btn) return;
            selectedBase = btn.dataset.type;
            typeSelector.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
            refreshStatus();
        });

        laneSelector.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-lane]');
            if (!btn) return;
            selectedLane = btn.dataset.lane;
            laneSelector.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
            refreshStatus();
        });

        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const result = await this.uploadImage(currentSlotId(), file);
                fileInput.value = '';
                if (!result.ok) {
                    if (typeof UI !== 'undefined' && UI.showMessage) UI.showMessage('settings', result.error);
                    return;
                }
                refreshStatus();
                refreshList();
                if (typeof UI !== 'undefined' && UI.showMessage) {
                    UI.showMessage('settings', '레인별 이미지를 적용했습니다.');
                }
                if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                await this.deleteImage(currentSlotId());
                refreshStatus();
                refreshList();
                if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
            });
        }

        refreshStatus();
        refreshList();
    },

    // 설정 화면이 이미 배선된 뒤(initUI() 실행 후) 스킨 전환 등으로 _entries가
    // 통째로 바뀌었을 때 상태 뱃지 15개 + 레인별 오버라이드 UI를 한 번에 다시 그린다.
    // initUI()가 아직 호출되지 않은 페이지에서는 조용히 무시한다.
    refreshUI() {
        if (!this._refreshFns) return;
        Object.values(this._refreshFns).forEach(fn => fn());
        if (this._refreshLaneStatus) this._refreshLaneStatus();
        if (this._refreshLaneList) this._refreshLaneList();
    },
};