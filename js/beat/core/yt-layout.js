// ── YTLayout: YouTube 플레이어 패널 배치 (정책 준수) ────────────────────────
// 확정 배치: 우측 패널(#ui-area) 안에 "존재"하되, 콘텐츠 흐름의 맨 끝(#yt-slot)에 놓여 스크롤해서 접근한다.
//  - 임베드(#yt-host)는 iframe 보존을 위해 body에 fixed로 두고, 현재 화면(DOM.screens[...])의 맨 끝에 있는
//    #yt-slot 위치에 맞춰 따라다닌다(스크롤/리사이즈/콘텐츠 변경 시 재배치). 슬롯이 높이를 차지하므로 다른 내용을 가리지 않는다.
//  - 패널 보이는 영역(현재 화면 요소) 밖으로 나간 부분은 clip-path로 잘라 패널 밖으로 삐져나오지 않게 한다.
//  - 버튼 등과 같은 층(z-index 1) — 다른 UI 위로 올라타지 않는다.
//  - 크기: 최대 480×270(16:9), 패널이 좁으면 폭에 맞춰 줄임(최소 MIN_FIT_W). iframe/host에 opacity·filter·blur·transform:scale 금지.
//  - 임베드를 보이는 화면: SHOW_SCREENS. 그 외 화면(라이브러리/메뉴 등)에서는 화면 밖으로 치우고, 재생 중이면 일시정지한다.
//  - 레인 상부 폴백은 없다. 패널이 접힘/숨김(모바일 플레이 중 등)이면 플레이어도 같이 화면 밖으로 치워진다(일시정지하지 않음).
//  - 다른 스크립트가 잠깐 가리고 싶으면 YTLayout.setCovered(true/false).
// 호스트 요소는 YouTubeSource.setHost()로 넘겨, 플레이어 생성 전에 반드시 init()돼야 한다.

const YTLayout = {
    MIN_W: 356,
    MIN_H: 200,
    MIN_FIT_W: 200,       // 패널이 좁을 때 줄일 수 있는 최소 폭(IFrame 최소 200×200)
    PREF_W: 480,
    GAP: 8,
    RESERVE_SPACE: true,
    // 환경설정('settings')은 현재 제외 — 유튜브 플레이어 관련 설정을 추가하면 여기에 다시 넣는다.
    // (제외된 화면에서는 임베드가 화면 밖으로 치워지고, 재생 중이면 자동 일시정지된다)
    SHOW_SCREENS: ['playing', 'editorSong', 'editor', 'online'], // online: 곡/난이도 상세 YouTube 미리듣기

    mode: 'hidden',       // 'slot' | 'ui-bottom'(화면 요소를 못 찾을 때의 폴백) | 'covered' | 'hidden'
    coveredTopPx: 0,      // lane-top 모드에서 game-area 상단부터 가려지는 높이(px). 그 외엔 0
    rect: null,           // 마지막으로 적용한 { x, y, w, h }
    _host: null,
    _covered: false,

    init() {
        if (this._host || typeof YouTubeSource === 'undefined') return;
        const style = document.createElement('style');
        style.textContent =
            '#yt-host{position:fixed;left:8px;bottom:8px;width:356px;height:200px;z-index:9999;background:#000;display:none;}' +
            '#yt-host.yt-active{display:block;}' +
            '#yt-host iframe{width:100%;height:100%;display:block;border:0;}';
        document.head.appendChild(style);

        const host = document.createElement('div');
        host.id = 'yt-host';
        host.className = 'yt-host';
        host.dataset.ytManaged = '1'; // 표시/숨김은 CSS(.yt-active)가 담당 — YouTubeSource가 display를 건드리지 않게
        document.body.appendChild(host);
        YouTubeSource.setHost(host);
        this._host = host;

        const refresh = () => this.update();
        window.addEventListener('resize', refresh);
        const ga = document.getElementById('game-area');
        if (ga && typeof ResizeObserver !== 'undefined') new ResizeObserver(refresh).observe(ga);
        new MutationObserver(refresh).observe(host, { attributes: true, attributeFilter: ['class'] });
        // 우측 패널 접힘/모바일 숨김·오버레이(#app-shell 클래스), 패널 크기 변화에 따라 재배치
        const shell = document.getElementById('app-shell');
        if (shell) new MutationObserver(refresh).observe(shell, { attributes: true, attributeFilter: ['class'] });
        const uiEl = document.getElementById('ui-area');
        if (uiEl && typeof ResizeObserver !== 'undefined') new ResizeObserver(refresh).observe(uiEl);
        // 보이는 화면들: 콘텐츠가 바뀌면(슬롯이 빠지거나 높이가 변함) 재배치. 게임 중(playing)은 직계 자식 변화만 본다.
        let mraf = 0;
        const schedule = () => { if (mraf) return; mraf = requestAnimationFrame(() => { mraf = 0; this.update(); }); };
        this.SHOW_SCREENS.forEach(name => {
            const el = this._screenEl(name);
            if (!el) return;
            new MutationObserver(() => { if (this._screen() === name && host.classList.contains('yt-active')) schedule(); })
                .observe(el, name === 'playing' ? { childList: true } : { childList: true, subtree: true });
        });

        // 슬롯 모드: 패널/화면 스크롤에 맞춰 임베드 위치 갱신 (scroll은 버블링 안 하므로 capture)
        let raf = 0;
        document.addEventListener('scroll', () => {
            if (this.mode !== 'slot' || raf) return;
            raf = requestAnimationFrame(() => { raf = 0; this.update(); });
        }, true);
        this.update();
    },

    _screen() {
        return (typeof UI !== 'undefined' && UI.currentScreen) || null;
    },

    _screenEl(screen) {
        return (typeof DOM !== 'undefined' && DOM.screens && DOM.screens[screen]) || null;
    },

    // 슬롯은 현재 화면 요소의 맨 끝 자식으로 유지한다 (화면 전환/콘텐츠 재렌더로 빠지면 다시 붙인다)
    _ensureSlot(el) {
        let slot = document.getElementById('yt-slot');
        if (!slot) {
            slot = document.createElement('div');
            slot.id = 'yt-slot';
            slot.style.cssText = 'flex:0 0 auto;height:0;margin:0;';
        }
        if (slot.parentNode !== el || el.lastElementChild !== slot) el.appendChild(slot);
        return slot;
    },

    // #ui-area 하단 패딩 = 원래 패딩 + 예약 높이 (0이면 원복)
    _applyReserve(px) {
        const ui = document.getElementById('ui-area');
        if (!ui) return;
        ui.style.paddingBottom = '';
        if (px > 0 && this.RESERVE_SPACE) {
            const base = parseFloat(getComputedStyle(ui).paddingBottom) || 0;
            ui.style.paddingBottom = `${base + px}px`;
        }
    },

    update() {
        const h = this._host;
        if (!h) return;
        const st = h.style;
        const place = (x, y, w, hh) => {
            const maxX = Math.max(0, window.innerWidth - w);
            const maxY = Math.max(0, window.innerHeight - hh);
            x = Math.min(Math.max(0, Math.round(x)), maxX);
            y = Math.min(Math.max(0, Math.round(y)), maxY);
            Object.assign(st, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto', width: `${w}px`, height: `${hh}px` });
            this.rect = { x, y, w, h: hh };
        };

        const setSlot = (px) => { const sl = document.getElementById('yt-slot'); if (sl) { sl.style.height = `${px}px`; sl.style.margin = px ? '12px 0' : '0'; } };
        st.clipPath = '';
        st.zIndex = '9999';
        setSlot(0);

        const screen = this._screen();
        if (!this.SHOW_SCREENS.includes(screen)) {
            // 보이지 않아도 되는 화면: 숨기고, 아직 재생 중이면 멈춘다 (보이지 않는 재생 금지)
            // display:none이 아니라 화면 밖으로 치운다 — 숨긴 iframe은 로딩/ready가 막히는 브라우저가 있어,
            // 곡 상세 등 보이지 않는 화면에서의 사전 로드(whenReady)가 멈추지 않게 하기 위해서다. (재생은 안 함)
            this.mode = 'hidden'; this.coveredTopPx = 0; this.rect = null;
            Object.assign(st, { left: '-9999px', top: '0px', right: 'auto', bottom: 'auto', width: `${this.MIN_W}px`, height: `${this.MIN_H}px` });
            this._applyReserve(0);
            if (typeof DOM !== 'undefined' && DOM.musicPlayer && DOM.musicPlayer.kind === 'yt' && !DOM.musicPlayer.paused) {
                try { DOM.musicPlayer.pause(); } catch (e) { /* 무시 */ }
            }
            return;
        }
        const GAP = this.GAP;
        const uiEl = document.getElementById('ui-area');
        const ui = uiEl ? uiEl.getBoundingClientRect() : null;
        const usable = ui ? Math.floor(ui.width - GAP * 2) : 0;
        const panelShown = !!ui && ui.height > 0 && usable >= this.MIN_FIT_W;

        if (this._covered || !panelShown) {
            // 패널이 접힘/숨김이거나 다른 스크립트가 가린 상태: 화면 밖으로 치운다. 재생은 건드리지 않는다.
            this.mode = 'covered'; this.coveredTopPx = 0; this.rect = null;
            Object.assign(st, { left: '-9999px', top: '0px', right: 'auto', bottom: 'auto', width: `${this.MIN_W}px`, height: `${this.MIN_H}px` });
            this._applyReserve(0);
            return;
        }

        // 현재 화면의 맨 끝 슬롯(#yt-slot)에 맞춘다 — 우측 패널 안에서 스크롤로 접근
        const screenEl = this._screenEl(screen);
        if (screenEl && h.classList.contains('yt-active')) {
            const slot = this._ensureSlot(screenEl);
            const sw = Math.min(this.PREF_W, Math.floor(slot.getBoundingClientRect().width));
            if (sw >= this.MIN_FIT_W) {
                const sh = Math.round(sw * 9 / 16);
                setSlot(sh);
                const sr = slot.getBoundingClientRect();
                const x = sr.left + (sr.width - sw) / 2, y = sr.top;
                // 패널 보이는 영역(현재 화면 요소)과의 교집합
                const vr = screenEl.getBoundingClientRect();
                const vis = { l: Math.max(x, vr.left), t: Math.max(y, vr.top), r: Math.min(x + sw, vr.right), b: Math.min(y + sh, vr.bottom) };
                this.mode = 'slot'; this.coveredTopPx = 0; this._applyReserve(0);
                st.zIndex = '1';
                if (vis.r <= vis.l || vis.b <= vis.t) {
                    this.rect = null;
                    Object.assign(st, { left: '-9999px', top: '0px', right: 'auto', bottom: 'auto', width: `${sw}px`, height: `${sh}px` });
                    return;
                }
                Object.assign(st, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, right: 'auto', bottom: 'auto', width: `${sw}px`, height: `${sh}px` });
                const ct = Math.max(0, Math.round(vis.t - y)), cb = Math.max(0, Math.round(y + sh - vis.b));
                const cl = Math.max(0, Math.round(vis.l - x)), cr = Math.max(0, Math.round(x + sw - vis.r));
                if (ct || cb || cl || cr) st.clipPath = `inset(${ct}px ${cr}px ${cb}px ${cl}px)`;
                this.rect = { x: Math.round(x), y: Math.round(y), w: sw, h: sh };
                return;
            }
        }

        // 폴백: 화면 요소를 못 찾았을 때만 패널 하단에 고정
        const w = Math.min(this.PREF_W, usable);
        const hh = Math.round(w * 9 / 16);
        this.mode = 'ui-bottom'; this.coveredTopPx = 0;
        place(ui.left + (ui.width - w) / 2, ui.bottom - GAP - hh, w, hh);
        this._applyReserve(hh + GAP * 2);
    },

    // 다른 스크립트에서 플레이어를 잠깐 가릴 때 (재생은 그대로)
    setCovered(on) {
        this._covered = !!on;
        this.update();
    },
};

document.addEventListener('DOMContentLoaded', () => YTLayout.init());