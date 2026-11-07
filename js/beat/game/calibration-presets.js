/**
 * CalibrationPresets — 캘리브레이션 프리셋 (설정 > 캘리브레이션 탭)
 *
 * 입력/소리 지연은 기기·출력 장치(스피커, 블루투스 이어폰 등)마다 다르다. 그래서
 *  - 프리셋(이름 + 보정값 3종)은 계정에 저장해서 어느 기기에서든 불러올 수 있고(beat_settings.calibrationPresets),
 *  - "이 기기가 지금 어떤 프리셋을 쓰는지"(활성 프리셋)는 기기마다 따로 기억한다(localStorage).
 *  - 보정값 자체(inputOffsetMs / touchInputOffsetMs / ytInputOffsetMs)는 예전처럼 Game.state.settings + localStorage가
 *    실제 값이고(판정 코드는 그대로), 프리셋은 그 값을 한 번에 바꿔 끼우는 저장 슬롯이다.
 *  - 로그인했을 때 계정의 플레이 설정이 이 기기의 보정값을 덮어쓰지 않는다(main.js PLAY_SETTINGS_KEYS에서 제외).
 * 로그아웃 상태에서는 이 기기에만 저장된다. 로그인하면 계정의 프리셋 목록을 불러온다(계정에 없으면 이 기기 것을 올린다).
 */
const CalibrationPresets = {
    KEYS: ['inputOffsetMs', 'touchInputOffsetMs', 'ytInputOffsetMs'],
    LS_LIST: 'theBeat_calPresets',
    LS_ACTIVE: 'theBeat_calActivePreset',
    MAX_PRESETS: 20,

    presets: [],
    activeId: null,
    _userId: null,
    _notice: '',
    _inited: false,
    _cloudQueue: Promise.resolve(),

    // 값 ↔ 화면 요소 매핑
    _ui(key) {
        const s = DOM.settings;
        return {
            inputOffsetMs: [s.inputOffsetSlider, s.inputOffsetValue],
            touchInputOffsetMs: [s.touchInputOffsetSlider, s.touchInputOffsetValue],
            ytInputOffsetMs: [s.ytInputOffsetSlider, s.ytInputOffsetValue],
        }[key];
    },

    init() {
        if (this._inited) return;
        this._inited = true;
        try {
            const raw = JSON.parse(localStorage.getItem(this.LS_LIST) || '[]');
            if (Array.isArray(raw)) this.presets = raw.filter(p => this._valid(p));
        } catch (e) { /* 무시 */ }
        try { this.activeId = localStorage.getItem(this.LS_ACTIVE) || null; } catch (e) { /* 무시 */ }
        if (!this.presets.some(p => p.id === this.activeId)) this.activeId = null;

        // 첫 실행(또는 이 기능 도입 직후): 지금 이 기기의 값으로 "기본" 프리셋을 만들어 기존 보정값을 그대로 이어간다.
        if (this.presets.length === 0) {
            const p = this._make('기본');
            this.presets.push(p);
            this.activeId = p.id;
            this._saveLocal();
        }

        const $ = (id) => document.getElementById(id);
        const sel = $('cal-preset-select');
        if (sel) sel.addEventListener('change', () => { if (sel.value) this.apply(sel.value); });
        const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
        on('cal-save-btn', () => this.saveToActive());
        on('cal-new-btn', () => this.createFromLive());
        on('cal-rename-btn', () => this.renameActive());
        on('cal-delete-btn', () => this.removeActive());

        // 출력 장치가 바뀌면(블루투스 연결 등) 환경에 맞는 프리셋을 고르라고 알려준다
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
                navigator.mediaDevices.addEventListener('devicechange', () => {
                    this._notice = '오디오 출력 장치가 바뀐 것 같습니다. 지금 환경에 맞는 프리셋을 골라 보세요.';
                    this.render();
                });
            }
        } catch (e) { /* 무시 */ }

        this.render();
    },

    // ── 값 ────────────────────────────────────────────────────────────────
    _valid(p) {
        return p && typeof p.id === 'string' && typeof p.name === 'string';
    },
    live() {
        const v = {};
        for (const k of this.KEYS) v[k] = Number(Game.state.settings[k]) || 0;
        return v;
    },
    _make(name) {
        return { id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ...this.live(), updatedAt: new Date().toISOString() };
    },
    active() { return this.presets.find(p => p.id === this.activeId) || null; },
    isDirty() {
        const p = this.active();
        if (!p) return false;
        const v = this.live();
        return this.KEYS.some(k => (Number(p[k]) || 0) !== v[k]);
    },
    _suggestName() {
        const ua = navigator.userAgent || '';
        const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux|X11/i.test(ua) ? 'Linux' : '기기';
        const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
        return `${os} ${br}`.trim();
    },

    // ── 저장 ──────────────────────────────────────────────────────────────
    _saveLocal() {
        try {
            localStorage.setItem(this.LS_LIST, JSON.stringify(this.presets));
            if (this.activeId) localStorage.setItem(this.LS_ACTIVE, this.activeId);
            else localStorage.removeItem(this.LS_ACTIVE);
        } catch (e) { /* 무시 */ }
    },
    // 계정 목록을 읽어 → 변경 → 저장 (여러 기기가 동시에 다른 프리셋을 바꿔도 서로 덮어쓰지 않도록 항목 단위로 병합)
    _mutateCloud(fn) {
        if (!this._userId || typeof CloudAuth === 'undefined' || !CloudAuth.saveCalibrationPresets) return;
        this._cloudQueue = this._cloudQueue.then(async () => {
            try {
                const list = (await CloudAuth.getCalibrationPresets()) || [];
                const next = fn(list.filter(p => this._valid(p))).slice(0, this.MAX_PRESETS);
                await CloudAuth.saveCalibrationPresets(next);
            } catch (e) { console.warn('캘리브레이션 프리셋 동기화 오류:', e); }
        });
    },
    _upsertCloud(preset) {
        this._mutateCloud(list => {
            const i = list.findIndex(p => p.id === preset.id);
            if (i >= 0) list[i] = preset; else list.push(preset);
            return list;
        });
    },
    _removeCloud(id) { this._mutateCloud(list => list.filter(p => p.id !== id)); },

    async onLogin(user) {
        if (!user) { this._userId = null; return; }
        if (this._userId === user.id) return;
        this._userId = user.id;
        let cloud = null;
        try { cloud = await CloudAuth.getCalibrationPresets(); } catch (e) { /* 무시 */ }
        if (Array.isArray(cloud) && cloud.length) {
            // 계정에 프리셋이 있으면 계정 목록을 기준으로 한다. 이 기기의 활성 프리셋이 계정에 없으면 다시 고르게 한다.
            this.presets = cloud.filter(p => this._valid(p)).slice(0, this.MAX_PRESETS);
            if (!this.presets.some(p => p.id === this.activeId)) {
                this.activeId = null;
                this._notice = '이 기기에 적용된 프리셋이 없습니다. 아래에서 고르거나, 이 기기의 현재 값을 새 프리셋으로 저장하세요.';
            }
            this._saveLocal();
        } else {
            // 계정에 아직 프리셋이 없음 → 이 기기의 프리셋을 계정에 올린다
            this.presets.forEach(p => this._upsertCloud(p));
        }
        this.render();
    },

    // ── 동작 ──────────────────────────────────────────────────────────────
    apply(id) {
        const p = this.presets.find(x => x.id === id);
        if (!p) return;
        for (const k of this.KEYS) {
            const v = Number(p[k]) || 0;
            Game.state.settings[k] = v;
            try { localStorage.setItem(`theBeat_${k}`, v); } catch (e) { /* 무시 */ }
            const [slider, label] = this._ui(k);
            if (slider) slider.value = v;
            if (label) label.textContent = `${v}ms`;
        }
        this.activeId = id;
        this._notice = '';
        this._saveLocal();
        this.render();
    },
    // 슬라이더/자동 보정으로 값이 바뀌었을 때 (main.js 슬라이더 change 핸들러에서 호출)
    onLiveChange() { this.render(); },

    saveToActive() {
        const p = this.active();
        if (!p) return;
        if (!confirm(`"${p.name}" 프리셋을 현재 값으로 덮어쓸까요?`)) return;
        Object.assign(p, this.live(), { updatedAt: new Date().toISOString() });
        this._saveLocal();
        this._upsertCloud(p);
        this.render();
    },
    createFromLive() {
        if (this.presets.length >= this.MAX_PRESETS) { alert(`프리셋은 최대 ${this.MAX_PRESETS}개까지 만들 수 있습니다.`); return; }
        const name = (prompt('새 프리셋 이름 (예: 태블릿 + 블루투스)', this._suggestName()) || '').trim().slice(0, 30);
        if (!name) return;
        const p = this._make(name);
        this.presets.push(p);
        this.activeId = p.id;
        this._notice = '';
        this._saveLocal();
        this._upsertCloud(p);
        this.render();
    },
    renameActive() {
        const p = this.active();
        if (!p) return;
        const name = (prompt('프리셋 이름', p.name) || '').trim().slice(0, 30);
        if (!name || name === p.name) return;
        p.name = name;
        p.updatedAt = new Date().toISOString();
        this._saveLocal();
        this._upsertCloud(p);
        this.render();
    },
    removeActive() {
        const p = this.active();
        if (!p) return;
        if (this.presets.length <= 1) { alert('마지막 프리셋은 삭제할 수 없습니다.'); return; }
        if (!confirm(`"${p.name}" 프리셋을 삭제할까요? (이 계정의 모든 기기에서 사라집니다)`)) return;
        this.presets = this.presets.filter(x => x.id !== p.id);
        this.activeId = null; // 값은 그대로 유지, 활성 프리셋만 해제
        this._notice = '프리셋이 삭제되었습니다. 현재 값은 그대로이며, 다른 프리셋을 고를 수 있습니다.';
        this._saveLocal();
        this._removeCloud(p.id);
        this.render();
    },

    // ── 화면 ──────────────────────────────────────────────────────────────
    render() {
        const $ = (id) => document.getElementById(id);
        const sel = $('cal-preset-select');
        if (!sel) return;
        const dirty = this.isDirty();
        const esc = (typeof _esc === 'function') ? _esc : (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        sel.innerHTML = (this.activeId ? '' : '<option value="">(선택 안 함 — 이 기기의 현재 값 사용 중)</option>')
            + this.presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === this.activeId && dirty ? ' (수정됨)' : ''}</option>`).join('');
        sel.value = this.activeId || '';
        const has = !!this.active();
        const set = (id, disabled) => { const el = $(id); if (el) { el.disabled = disabled; el.classList.toggle('opacity-40', disabled); } };
        set('cal-save-btn', !has || !dirty);
        set('cal-rename-btn', !has);
        set('cal-delete-btn', !has);
        set('cal-new-btn', false);
        const badge = $('cal-dirty-badge');
        if (badge) badge.classList.toggle('hidden', !dirty);
        const notice = $('cal-notice');
        if (notice) { notice.textContent = this._notice; notice.classList.toggle('hidden', !this._notice); }
        const sync = $('cal-sync-note');
        if (sync) sync.textContent = this._userId
            ? '프리셋은 계정에 저장되어 모든 기기에서 불러올 수 있습니다. 어떤 프리셋을 쓰는지는 기기마다 따로 기억합니다.'
            : '로그아웃 상태라 프리셋이 이 기기에만 저장됩니다. 로그인하면 계정에 저장됩니다.';
    },
};

document.addEventListener('DOMContentLoaded', () => CalibrationPresets.init());