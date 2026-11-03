// ── YTLayout: YouTube 플레이어 패널 배치 (정책 준수) ────────────────────────
// 확정 배치(S3): 우측 패널(#ui-area) 하단에 임베드를 고정한다.
//  - 플레이어는 항상 최상단 레이어(z-index 9999). 패널 내용은 임베드 "뒤에서" 스크롤된다.
//    다만 맨 아래 내용(포기하기 등)이 영구히 가려지지 않도록, 임베드 높이만큼 #ui-area 하단 패딩을 늘려
//    스크롤 끝까지 내리면 임베드 바로 위에 보이게 한다. (RESERVE_SPACE=false면 패딩을 늘리지 않는다)
//  - 크기: 최대 480×270(16:9), 최소 356×200. iframe/host에 opacity·filter·blur·transform:scale 금지.
//  - 임베드를 보이는 화면: SHOW_SCREENS. 그 외 화면(라이브러리/메뉴 등)에서는 화면 밖으로 치우고, 재생 중이면 일시정지한다.
//  - 우측 패널이 없거나(모바일 플레이 중 숨김 등) 너무 좁으면 폴백:
//      플레이 화면 → 레인 상부 위(lane-top, 356×200, 가려진 높이는 coveredTopPx로 노출)
//      그 외      → 좌측 하단 고정(default)
// 호스트 요소는 YouTubeSource.setHost()로 넘겨, 플레이어 생성 전에 반드시 init()돼야 한다.

const YTLayout = {
    MIN_W: 356,
    MIN_H: 200,
    PREF_W: 480,
    GAP: 8,
    RESERVE_SPACE: true,
    SHOW_SCREENS: ['playing', 'editorSong', 'editor', 'settings'],

    mode: 'hidden',       // 'ui-bottom' | 'lane-top' | 'default' | 'hidden'
    coveredTopPx: 0,      // lane-top 모드에서 game-area 상단부터 가려지는 높이(px). 그 외엔 0
    rect: null,           // 마지막으로 적용한 { x, y, w, h }
    _host: null,

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
        this.update();
    },

    _screen() {
        return (typeof UI !== 'undefined' && UI.currentScreen) || null;
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
        if (ui && usable >= this.MIN_W) {
            const w = Math.min(this.PREF_W, usable);
            const hh = Math.round(w * 9 / 16);
            this.mode = 'ui-bottom'; this.coveredTopPx = 0;
            place(ui.left + (ui.width - w) / 2, ui.bottom - GAP - hh, w, hh);
            this._applyReserve(hh + GAP * 2);
            return;
        }

        this._applyReserve(0);
        const gaEl = document.getElementById('game-area');
        if (screen === 'playing' && gaEl) {
            // 폴백: 레인 상부 위 (레인을 가림). 최소 크기 유지.
            const ga = gaEl.getBoundingClientRect();
            const w = this.MIN_W, hh = this.MIN_H;
            const y = ga.top + GAP;
            this.mode = 'lane-top';
            this.coveredTopPx = Math.max(0, y + hh - ga.top);
            place(ga.left + (ga.width - w) / 2, y, w, hh);
            return;
        }
        this.mode = 'default'; this.coveredTopPx = 0; this.rect = null;
        Object.assign(st, { left: '8px', top: 'auto', right: 'auto', bottom: '8px', width: `${this.MIN_W}px`, height: `${this.MIN_H}px` });
    },
};

document.addEventListener('DOMContentLoaded', () => YTLayout.init());