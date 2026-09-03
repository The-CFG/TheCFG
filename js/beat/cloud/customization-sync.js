// ════════════════════════════════════════════════
//  js/beat/cloud/customization-sync.js — BeatCustomizationSync
//  커스터마이징(스킨/폰트) 계정 동기화 오케스트레이터(커스터마이징 계획 4단계,
//  "권장 착수 순서" 8번). 각 모듈(BeatSkin/BeatFonts/BeatSkinImages)은 이
//  파일이 있는지 모른 채로 동작하고, 이 모듈이 그것들의 공개 API(state/BeatLocalStore
//  키 구조)를 조합해 CloudAuth의 beat_settings.{skins,customFonts} patch API로
//  올리고 내린다. 각 모듈의 UI 이벤트 핸들러(스킨 전환/새로 저장, 폰트 업로드/삭제,
//  이미지 업로드/삭제, "적용" 버튼)가 자기 작업이 끝난 뒤 schedulePush()만 호출해
//  주면 된다. UI 테마(BeatTheme)는 이제 별도 모듈이 아니라 스킨 설정의 일부
//  (Appearance.settings.themeId/themeCustomColors)라 여기서 따로 다루지 않는다 —
//  BeatSkin 블록에 얹혀 함께 push/pull된다(테마 카드 클릭도 saveSettings()로 활성
//  스킨에 캡처된 뒤 schedulePush()를 호출한다).
//
//  스토리지 경로는 항상 `${user.id}/skins/${skinId}/${slotId}.${ext}` /
//  `${user.id}/fonts/${fontId}.${format}`로 결정적(deterministic)이라, 업로드가 없어도
//  매번 다시 올리는 것이 안전하다(upsert:true라 같은 경로에 그대로 덮어씀) — 그래서
//  "이미 올린 것" 여부를 따로 추적하지 않고, 매 push마다 활성 스킨 이미지 전체 + 로컬에
//  있는 폰트 전체를 다시 업로드한다. 스킨/폰트를 자주 바꾸는 조작이 아니라 저장(디바운스)
//  빈도 자체가 낮으므로 트래픽 낭비가 크지 않다는 판단.
//
//  로그인 상태에서는 클라우드가 최종 소스다(계획 문서 "로컬 저장소 정책" 참고) — pullAll()은
//  클라우드에 스킨 데이터가 있으면 로컬 BeatSkin.state를 그것으로 통째로 교체한다.
//
//  의존: local-store.js(BeatLocalStore), auth.js(CloudAuth). BeatSkin/BeatFonts/
//  BeatSkinImages는 optional(타입 체크 후 사용) — 이 파일보다 먼저 로드되어
//  있어야 하지만, 없는 페이지(다른 게임 화면 등)에서도 에러 없이 조용히 넘어간다.
// ════════════════════════════════════════════════

const BeatCustomizationSync = {
    _pushTimer: null,

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.warn(`[${context}]`, err);
        }
    },

    // UI 이벤트 핸들러에서 호출 — 슬라이더 연타 등으로 몰릴 수 있어 짧게 디바운스한다
    // (main.js의 savePlaySettingsToCloud와 동일한 패턴).
    schedulePush() {
        clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => this.pushAll(), 800);
    },

    // 현재 활성 스킨의 로컬 이미지(BeatLocalStore 'images' 스토어)를 beat-files 버킷에
    // 업로드하고, 업로드된 storagePath 맵을 BeatSkin.state.skins[activeId].images에
    // 반영한다(호출부가 이어서 saveSkinsSettings로 push).
    async _uploadActiveSkinImages() {
        if (typeof BeatSkinImages === 'undefined' || typeof BeatSkin === 'undefined' || !BeatSkin.state) return;
        const skinId = BeatSkin.state.activeId;
        const skin = BeatSkin.state.skins[skinId];
        if (!skin) return;

        const prefix = `${skinId}:`;
        const allKeys = await BeatLocalStore.getAllKeys(BeatSkinImages.STORE_NAME);
        const images = {};
        for (const key of allKeys) {
            if (!key.startsWith(prefix)) continue;
            const slotId = key.slice(prefix.length);
            if (!BeatSkinImages.isValidSlot(slotId)) continue;
            const entry = await BeatLocalStore.get(BeatSkinImages.STORE_NAME, key);
            if (!entry || !entry.blob) continue;
            const ext = (entry.name.split('.').pop() || 'png').toLowerCase();
            const up = await CloudAuth.uploadCustomizationFile(`skins/${skinId}/${slotId}.${ext}`, entry.blob);
            if (up.ok) images[slotId] = up.path;
        }
        skin.images = images;
    },

    // 로컬(BeatLocalStore 'fonts' 스토어)에 있는 폰트 전부를 업로드하고 메타데이터
    // 목록([{ id, name, format, storagePath }])을 반환한다.
    async _uploadFonts() {
        if (typeof BeatFonts === 'undefined') return [];
        const ids = await BeatLocalStore.getAllKeys(BeatFonts.STORE_NAME);
        const list = [];
        for (const id of ids) {
            const entry = await BeatLocalStore.get(BeatFonts.STORE_NAME, id);
            if (!entry || !entry.blob) continue;
            const up = await CloudAuth.uploadCustomizationFile(`fonts/${id}.${entry.format}`, entry.blob);
            if (!up.ok) continue;
            list.push({ id, name: entry.name, format: entry.format, storagePath: up.path });
        }
        return list;
    },

    async pushAll() {
        try {
            const user = await CloudAuth.getUser();
            if (!user) return;

            if (typeof BeatSkin !== 'undefined' && BeatSkin.state) {
                await this._uploadActiveSkinImages();
                await CloudAuth.saveSkinsSettings(BeatSkin.state);
                // 이미지 storagePath가 방금 채워졌으므로 로컬 저장에도 반영해 새로고침
                // 후(오프라인 포함) 다시 스킨을 켜도 유지되게 한다.
                await BeatLocalStore.set(BeatSkin.STORE_NAME, BeatSkin.STATE_KEY, BeatSkin.state);
            }

            if (typeof BeatFonts !== 'undefined') {
                const list = await this._uploadFonts();
                await CloudAuth.saveCustomFonts(list);
            }

            // UI 테마는 이제 스킨 소유(Appearance.settings.themeId/themeCustomColors)라
            // 위 BeatSkin 블록에서 saveSkinsSettings()로 이미 함께 올라간다 — 예전처럼
            // beat_settings.uiTheme에 따로 올리면 오히려 두 값이 어긋날 수 있어(다른
            // 기기에서 pull할 때 어느 쪽을 믿어야 할지 애매해짐) 별도 push를 없앴다.
        } catch (err) {
            this._logError(err, 'BeatCustomizationSync.pushAll');
        }
    },

    // 로그인 시(main.js의 onAuthStateChange) 1회 호출 — 계정에 저장된 스킨/폰트/테마를
    // 이 기기로 내려받아 적용한다. 계정에 아무것도 저장된 적 없으면(신규 이용자거나
    // 아직 한 번도 push한 적 없는 계정) 조용히 넘어가고 로컬 기본값을 유지한다.
    async pullAll(user) {
        if (!user) return;
        try {
            if (typeof BeatSkin !== 'undefined') {
                const cloud = await CloudAuth.getSkinsSettings();
                if (cloud && cloud.skins && cloud.activeId && cloud.skins[cloud.activeId]) {
                    BeatSkin.state = cloud;
                    await BeatLocalStore.set(BeatSkin.STORE_NAME, BeatSkin.STATE_KEY, BeatSkin.state);

                    // 이미지 다운로드는 BeatSkin.switchTo()가 BeatSkinImages.switchTo()로
                    // 로컬을 다시 읽어들이기 전에 끝나 있어야 한다.
                    if (typeof BeatSkinImages !== 'undefined' && BeatSkinImages.downloadSkinImages) {
                        const skin = BeatSkin.state.skins[BeatSkin.state.activeId];
                        await BeatSkinImages.downloadSkinImages(BeatSkin.state.activeId, skin && skin.images);
                    }
                    // switchTo()가 applyActive() + BeatSkinImages.switchTo() + BeatFonts.refreshUI()를
                    // 전부 처리해 준다(activeId는 이미 cloud 값과 같아 상태 변경은 없고 새로고침만 됨).
                    await BeatSkin.switchTo(BeatSkin.state.activeId);
                    if (BeatSkin._refreshSelect) BeatSkin._refreshSelect();
                }
            }

            if (typeof BeatFonts !== 'undefined') {
                const list = await CloudAuth.getCustomFonts();
                if (Array.isArray(list) && list.length) {
                    for (const meta of list) {
                        if (BeatFonts.fonts[meta.id]) continue; // 이미 이 기기에 있음
                        const blob = await CloudAuth.downloadCustomizationFile(meta.storagePath);
                        if (!blob) continue;
                        await BeatFonts.registerDownloaded(meta.id, meta.name, meta.format, blob);
                    }
                    if (BeatFonts.refreshUI) await BeatFonts.refreshUI();
                    if (typeof Appearance !== 'undefined' && Appearance.updateJudgementCssVariables) {
                        Appearance.updateJudgementCssVariables();
                    }
                }
            }

            // UI 테마는 스킨 데이터 안(Appearance.settings.themeId/themeCustomColors)에 이미
            // 들어 있어, 위 BeatSkin 블록의 switchTo()가 applyActive() → ... →
            // BeatTheme.applyFromSettings()까지 처리한다 — 예전처럼 beat_settings.uiTheme를
            // 따로 받아 BeatTheme.apply()로 덮어쓰면 방금 반영한 스킨 테마를 다시 지워버리게
            // 되므로(두 값이 다를 경우 나중에 실행되는 쪽이 이긴다) 이 블록은 제거했다.
        } catch (err) {
            this._logError(err, 'BeatCustomizationSync.pullAll');
        }
    },
};