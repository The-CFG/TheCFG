// ════════════════════════════════════════════════
//  js/beat/appearance/skin-images.js — BeatSkinImages (커스터마이징 계획 2단계)
//  노트(tap/long/false) · 판정 텍스트(perfect/good/bad/miss) · 카운트다운(3/2/1/start) ·
//  결과 등급(S/A/B/C) 자리에 사용자가 업로드한 이미지를 쓸 수 있게 해주는 모듈.
//
//  저장 범위: BeatFonts(1-B단계)와 동일하게 이번 단계는 로컬 저장(IndexedDB)까지만
//  구현한다. 클라우드 업로드(beat-files 버킷, beat_settings.customSkinImages)는 권장
//  착수 순서 8번(4단계 클라우드 동기화)에서 계정 동기화 작업과 함께 처리한다.
//
//  저장 구조: BeatLocalStore의 'images' 스토어에 슬롯 id(SLOT_IDS 참고)를 키로
//  { name, blob } 저장. 슬롯은 최대 15개로 개수가 고정돼 있어(스킨처럼 사용자가
//  개수를 늘리는 구조가 아님) 폰트처럼 별도 id 발급 없이 슬롯 id 자체를 키로 쓴다.
//
//  "이미지가 설정되지 않은 키는 기존처럼 기본 텍스트/도형 렌더링을 그대로 유지"
//  (계획 문서 2단계) — 이 모듈은 슬롯별로 있으면 URL/Image를, 없으면 null을 돌려주는
//  방식으로 그 요구사항을 보장한다. 소비 코드(game.js/ui.js)는 null이면 반드시 기존
//  렌더링 경로로 폴백해야 한다.
//
//  의존: local-store.js(BeatLocalStore) — 이 파일보다 먼저 로드되어야 한다.
// ════════════════════════════════════════════════

const BeatSkinImages = {
    STORE_NAME: 'images',
    ALLOWED_EXTENSIONS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
    MAX_SIZE_BYTES: 1.5 * 1024 * 1024, // 1.5MB — 폰트보다 개수가 많아(최대 15개) 더 낮게 제한

    // 슬롯 id 목록. group은 UI에서 섹션을 나눌 때, label은 목록/버튼 표시용.
    SLOTS: [
        { id: 'note-tap',   group: 'note',      label: '탭 노트' },
        { id: 'note-long',  group: 'note',      label: '롱 노트' },
        { id: 'note-false', group: 'note',      label: '가짜 노트' },
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
    ],

    // slotId -> { name, url, img } — url은 URL.createObjectURL() 결과(<img> src용),
    // img는 캔버스 drawImage용으로 미리 로드해 둔 HTMLImageElement.
    _entries: {},

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

    // 앱 시작 시 1회 호출: 저장된 모든 슬롯 이미지를 불러와 object URL + Image를 준비한다.
    // main.js initialize()에서 Appearance.init() 이전에 호출한다(노트 캔버스 드로잉이
    // 첫 프레임부터 이미지를 참조할 수 있도록).
    async init() {
        try {
            const ids = await BeatLocalStore.getAllKeys(this.STORE_NAME);
            for (const slotId of ids) {
                const entry = await BeatLocalStore.get(this.STORE_NAME, slotId);
                if (!entry || !entry.blob) continue;
                await this._register(slotId, entry.name, entry.blob);
            }
        } catch (err) {
            this._logError(err, 'BeatSkinImages.init');
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
        const saved = await BeatLocalStore.set(this.STORE_NAME, slotId, { name, blob: file });
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

    async deleteImage(slotId) {
        this._revoke(slotId);
        return await BeatLocalStore.delete(this.STORE_NAME, slotId);
    },

    // <img> src나 CSS에 쓸 object URL. 없으면 null — 호출부가 기존 렌더링으로 폴백해야 한다.
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
    // slotId별 <input type=file>(id: img-upload-<slotId>)과 삭제 버튼(id: img-delete-<slotId>),
    // 상태 뱃지(id: img-status-<slotId>)가 이미 마크업에 있다고 가정하고 이벤트만 건다.
    initUI() {
        try {
            this.SLOTS.forEach(slot => {
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
                    });
                }

                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async () => {
                        await this.deleteImage(slot.id);
                        refreshStatus();
                    });
                }

                refreshStatus();
            });
        } catch (err) {
            this._logError(err, 'BeatSkinImages.initUI');
        }
    },
};