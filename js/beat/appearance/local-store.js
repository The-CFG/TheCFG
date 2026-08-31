// ════════════════════════════════════════════════
//  js/beat/appearance/local-store.js — BeatLocalStore
//  커스터마이징(스킨/UI 테마 프리셋/폰트) 로컬 저장을 위한 IndexedDB 공용 래퍼.
//  localStorage(용량 5~10MB, 동기 API)를 대체하기 위해 신설.
//  의존: 없음. BeatSkin/BeatTheme/BeatFonts가 이 모듈을 통해서만 로컬에 저장한다.
// ════════════════════════════════════════════════

const BeatLocalStore = {
    DB_NAME: 'theBeatCustomization',
    DB_VERSION: 1,
    // 스토어 목록. 새 커스터마이징 항목이 늘어나면 여기 추가하고 DB_VERSION을 올린다.
    STORES: ['skins', 'uiThemePresets', 'fonts', 'misc'],

    _dbPromise: null,

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.warn(`[${context}]`, err);
        }
    },

    _openDB() {
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
                return;
            }
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                this.STORES.forEach(name => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name);
                    }
                });
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });

        // DB 열기 자체가 실패하면(사파시 시크릿 모드 등 극히 일부 환경) 다음 호출에서
        // 다시 시도할 수 있도록 캐시된 실패 Promise를 붙잡고 있지 않는다.
        this._dbPromise.catch(() => { this._dbPromise = null; });

        return this._dbPromise;
    },

    async get(storeName, key) {
        try {
            const db = await this._openDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            this._logError(err, `BeatLocalStore.get(${storeName})`);
            return null;
        }
    },

    async set(storeName, key, value) {
        try {
            const db = await this._openDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            return true;
        } catch (err) {
            this._logError(err, `BeatLocalStore.set(${storeName})`);
            return false;
        }
    },

    async delete(storeName, key) {
        try {
            const db = await this._openDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            return true;
        } catch (err) {
            this._logError(err, `BeatLocalStore.delete(${storeName})`);
            return false;
        }
    },

    // 폰트(1-B단계)처럼 스토어 하나에 여러 키를 담을 때 목록 UI를 채우는 용도.
    async getAllKeys(storeName) {
        try {
            const db = await this._openDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).getAllKeys();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            this._logError(err, `BeatLocalStore.getAllKeys(${storeName})`);
            return [];
        }
    },
};