// 사이트 공지 배너 — 관리자가 Supabase의 site_announcements에 올린 공지를 모든 페이지 상단에 보여준다.
// 게시/내리기 방법과 옵션은 supabase/migrations/20261111000000_site_announcements.sql 상단 주석 참고.
//
// - 모든 페이지(beat/hoi4/limbus/홈/계정/프로필/확인)에서 <script defer src="/assets/announcement.js">로 불러온다.
// - supabase-js 없이 REST(fetch)만 쓰는 독립 스크립트라 페이지별 로드 순서/의존성이 없다.
// - 읽기 전용 anon 키만 사용(RLS가 "활성 + 기간 내" 행만 돌려준다). 실패해도 조용히 무시한다.
// - 메시지는 textContent로만 넣는다(HTML 주입 불가), 링크는 http(s)만 허용한다.
(function () {
    'use strict';

    var SUPABASE_URL = 'https://uzokrwwzksgunrcdjlug.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6b2tyd3d6a3NndW5yY2RqbHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ3OTMsImV4cCI6MjA5NDA4MDc5M30.WZcxh7bhpILqed15vnBof-E1LXkAEXLdxO2UY43iYJU';
    var POLL_MS = 5 * 60 * 1000;      // 주기적 재확인(새 공지가 떠도 새로고침 없이 반영)
    var MIN_REFETCH_MS = 60 * 1000;   // 탭 복귀 시 재확인 최소 간격
    var DISMISS_KEY = 'thecfg_announce_dismissed';

    // 현재 사이트 식별 — targets에 'all' 또는 이 값이 있어야 보인다
    function siteId() {
        var seg = location.pathname.split('/')[1] || '';
        return ['beat', 'hoi4', 'limbus'].indexOf(seg) >= 0 ? seg : 'home';
    }

    function lang() {
        // beat는 I18n이 <html lang>을 갱신한다. 그 외 페이지는 브라우저 언어를 따른다.
        var l = (document.documentElement.lang || navigator.language || 'ko').toLowerCase();
        return l.indexOf('en') === 0 ? 'en' : 'ko';
    }

    function readDismissed() {
        try { return JSON.parse(localStorage.getItem(DISMISS_KEY)) || []; } catch (e) { return []; }
    }
    function addDismissed(id) {
        try {
            var list = readDismissed().filter(function (x) { return x !== id; });
            list.push(id);
            localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-50)));
        } catch (e) { /* 저장 불가(시크릿 모드 등)면 이번 방문에서만 닫힌다 */ }
    }

    var COLORS = { info: '#1d4ed8', warning: '#b45309', critical: '#b91c1c' };
    var el = null, shownId = null, lastFetch = 0, watchTimer = null;

    function injectStyle() {
        if (document.getElementById('announce-style')) return;
        var st = document.createElement('style');
        st.id = 'announce-style';
        st.textContent =
            '.site-announce{position:fixed;top:0;left:0;right:0;z-index:9500;display:flex;align-items:center;justify-content:center;gap:12px;' +
            'padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;color:#fff;font:600 0.875rem/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;' +
            'box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
            '.site-announce[hidden]{display:none}' +
            '.site-announce__text{min-width:0;text-align:center;overflow-wrap:anywhere}' +
            '.site-announce a{color:#fff;text-decoration:underline;white-space:nowrap}' +
            '.site-announce__close{flex:0 0 auto;border:0;background:transparent;color:#fff;font-size:1.1rem;line-height:1;cursor:pointer;padding:4px 8px;border-radius:6px}' +
            '.site-announce__close:hover{background:rgba(255,255,255,.2)}' +
            '.site-announce__close:focus-visible,.site-announce a:focus-visible{outline:2px solid #fff;outline-offset:2px}';
        document.head.appendChild(st);
    }

    function setHeight() {
        // 다른 고정 요소(오프라인 배너 등)가 공지 밑으로 비켜 갈 수 있게 높이를 CSS 변수로 알린다
        var h = (el && !el.hidden) ? el.offsetHeight : 0;
        document.documentElement.style.setProperty('--announce-h', h + 'px');
    }

    function hide() {
        if (el) el.hidden = true;
        shownId = null;
        clearInterval(watchTimer);
        setHeight();
    }

    function render(a) {
        injectStyle();
        if (!el) {
            el = document.createElement('div');
            el.className = 'site-announce';
            document.body.appendChild(el);
        }
        var msg = (lang() === 'en' && a.message_en) ? a.message_en : a.message_ko;
        el.textContent = '';
        el.style.background = COLORS[a.level] || COLORS.info;
        el.setAttribute('role', a.level === 'critical' ? 'alert' : 'status');
        el.setAttribute('aria-live', a.level === 'critical' ? 'assertive' : 'polite');

        var text = document.createElement('span');
        text.className = 'site-announce__text';
        text.textContent = msg;
        el.appendChild(text);

        if (a.link_url && /^https?:\/\//i.test(a.link_url)) {
            var link = document.createElement('a');
            link.href = a.link_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = lang() === 'en' ? 'Details' : '자세히 보기';
            el.appendChild(link);
        }
        if (a.dismissible !== false) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'site-announce__close';
            btn.textContent = '\u2715';
            btn.setAttribute('aria-label', lang() === 'en' ? 'Close' : '닫기');
            btn.addEventListener('click', function () { addDismissed(a.id); hide(); });
            el.appendChild(btn);
        }
        el.hidden = false;
        shownId = a.id;
        setHeight();

        // 플레이 중에는 게임을 가리지 않도록 숨긴다(beat 전용: UI.currentScreen). 다른 페이지엔 UI가 없어 영향 없다.
        clearInterval(watchTimer);
        if (typeof UI !== 'undefined') {
            var sync = function () {
                var playing = UI.currentScreen === 'playing';
                if (el.hidden !== playing) { el.hidden = playing; setHeight(); }
            };
            sync();
            watchTimer = setInterval(sync, 1000);
        }
    }

    function pick(rows) {
        var site = siteId(), dismissed = readDismissed();
        for (var i = 0; i < rows.length; i++) {          // 최신순. 가장 최근의 보여줄 공지 1개만 표시
            var r = rows[i], t = r.targets || ['all'];
            if (t.indexOf('all') < 0 && t.indexOf(site) < 0) continue;
            if (r.dismissible !== false && dismissed.indexOf(r.id) >= 0) continue;
            return r;
        }
        return null;
    }

    function refresh() {
        if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return;
        lastFetch = Date.now();
        var url = SUPABASE_URL + '/rest/v1/site_announcements' +
            '?select=id,message_ko,message_en,level,link_url,targets,dismissible' +
            '&order=created_at.desc&limit=10';
        fetch(url, {
            headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
            cache: 'no-store'
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(function (rows) {
            var a = Array.isArray(rows) ? pick(rows) : null;
            if (!a) { if (el && !el.hidden || shownId) hide(); return; }
            if (a.id !== shownId || el.hidden) render(a);
        }).catch(function () { /* 공지 실패는 서비스에 영향 없게 조용히 무시 */ });
    }

    function start() {
        refresh();
        setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && Date.now() - lastFetch > MIN_REFETCH_MS) refresh();
        });
        window.addEventListener('online', refresh);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
