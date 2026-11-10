// YTTools: YouTube 플레이 테스트 + YT 시계 HUD (구 yt-test-temp.js를 정식 디버그 도구로 편입)
//
// - Debugger.registerTool로 붙는다 → 설정의 "디버그 오버레이 활성화"가 켜졌을 때만 보인다.
//   · 설정 > 디버그 카드(#debug-yt-tools)에 "YouTube 플레이 테스트" 폼
//   · 디버그 오버레이에 "YT 시계" 섹션 (YouTube 곡을 플레이하는 동안 — 테스트 플레이든 일반 플레이든)
// - 테스트 플레이: YouTube 링크 + 영상 오프셋으로 메트로놈 채보를 즉시 플레이. 점수는 등록하지 않는다.
//   실제 플레이와 같은 경로를 쓴다: 영상 오프셋은 MusicPlayer.ytOffsetMs가 흡수하고 startTimeOffset/songStartOffset은 0.
// - 부작용: 판정 보정값(YouTube)은 이번 플레이에만 적용(localStorage에 쓰지 않음, "설정에 저장" 버튼을 눌러야 저장).
//   테스트가 끝나 플레이 화면을 벗어나면 Game.state가 건드린 값을 되돌린다.
// - 스타일은 css/debug.css (.debug-yt*, #debug-yt-section).
const YTTools = (() => {
    const HUD_INTERVAL_MS = 100;
    // 테스트가 loadChartNotes/설정으로 바꾸는 settings 키 — 종료 시 이 키들만 되돌린다.
    const SETTING_KEYS = ['requiredSongName', 'startTimeOffset', 'songStartOffset', 'bpm', 'noteSpeed',
        'usingMapCustomFallSpeed', 'lanes', 'mode', 'musicSrc', 'musicFileObject', 'ytInputOffsetMs'];
    const STATE_KEYS = ['chartData', 'triggers', 'baseBpm', 'baseNoteSpeed'];

    let mounted = false;
    let formWrap = null;   // 설정 화면의 폼 컨테이너 (#debug-yt-tools)
    let hudSection = null; // 오버레이의 "YT 시계" 섹션
    let hudPre = null;
    let lastHudAt = 0;
    let session = null;    // 테스트 플레이 진행 중이면 { saved, observer, sawPlaying }

    const $ = (id) => document.getElementById(id);
    const isPlaying = () => {
        const el = $('playing-screen');
        return !!el && !el.classList.contains('hidden');
    };
    const parseId = (v) => {
        if (typeof EditorSong !== 'undefined' && EditorSong.parseYoutubeId) return EditorSong.parseYoutubeId(v);
        const s = (v || '').trim();
        return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
    };

    // ── 마운트 (처음 켜질 때 한 번) ──────────────────────────────
    function mount() {
        if (mounted) return;
        formWrap = $('debug-yt-tools');
        const logSection = DOM.debugLogContainer && DOM.debugLogContainer.closest('.debug-section');
        const area = logSection && logSection.parentNode;
        if (!formWrap || !area) {
            console.error('[YTTools] 마운트 지점(#debug-yt-tools / 디버그 오버레이)을 찾지 못했습니다.');
            return;
        }

        formWrap.innerHTML =
            '<details class="debug-yt">' +
                '<summary>YouTube 플레이 테스트</summary>' +
                '<p class="debug-yt-note">YouTube 링크 + 영상 오프셋으로 메트로놈 채보(박자마다 노트)를 바로 플레이합니다. 점수는 등록되지 않고, 판정 보정값은 이번 플레이에만 적용됩니다.</p>' +
                '<label>YouTube 링크/ID<input id="ytt-url" type="text" placeholder="https://youtu.be/..."></label>' +
                '<label>영상 오프셋(초) — 곡이 시작되는 지점<input id="ytt-offset" type="number" step="0.01" min="0" value="0"></label>' +
                '<label>YouTube 판정 보정(ms)' +
                    '<span class="debug-yt-row"><input id="ytt-yto" type="number" step="5" min="-300" max="300" value="0">' +
                    '<button id="ytt-yto-save" type="button">설정에 저장</button></span></label>' +
                '<label>BPM(박자마다 노트)<input id="ytt-bpm" type="number" min="40" max="300" value="120"></label>' +
                '<label>레인 수<select id="ytt-lanes"><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option></select></label>' +
                '<label class="debug-yt-check"><input id="ytt-onscreen" type="checkbox"><span>플레이어 항상 노출 (진단: 모바일 플레이 중에도 화면 우하단에 표시)</span></label>' +
                '<button id="ytt-start" type="button" class="debug-yt-start">▶ 시작</button>' +
                '<div id="ytt-msg" class="debug-yt-msg"></div>' +
            '</details>';

        hudSection = document.createElement('div');
        hudSection.id = 'debug-yt-section';
        hudSection.className = 'debug-section debug-tool-section';
        hudSection.hidden = true;
        hudSection.innerHTML = '<h4 class="debug-section-title">YT 시계</h4><div class="debug-container"><pre></pre></div>';
        hudPre = hudSection.querySelector('pre');
        area.insertBefore(hudSection, logSection);

        $('ytt-start').addEventListener('click', startTest);
        $('ytt-yto-save').addEventListener('click', saveCalibration);
        const onscreen = $('ytt-onscreen');
        try { onscreen.checked = localStorage.getItem('theBeat_ytDebugOnscreen') === '1'; } catch (e) { /* 무시 */ }
        onscreen.addEventListener('change', () => {
            try { localStorage.setItem('theBeat_ytDebugOnscreen', onscreen.checked ? '1' : '0'); } catch (e) { /* 무시 */ }
            if (typeof YTLayout !== 'undefined') YTLayout.update();
        });
        mounted = true;
    }

    // ── 디버그 모드 켜짐/꺼짐 ─────────────────────────────────────
    function onToggle(enabled) {
        if (enabled) {
            mount();
            if (!mounted) return;
            formWrap.hidden = false;
            if (!session) $('ytt-yto').value = (Game.state.settings.ytInputOffsetMs || 0);
        } else if (mounted) {
            formWrap.hidden = true;
            hudSection.hidden = true;
        }
    }

    // ── YT 시계 HUD (오버레이 섹션) ───────────────────────────────
    function onFrame(timestamp) {
        if (!mounted) return;
        if (timestamp - lastHudAt < HUD_INTERVAL_MS) return;
        lastHudAt = timestamp;
        const mp = DOM.musicPlayer;
        if (mp.kind !== 'yt') { hudSection.hidden = true; return; }
        hudSection.hidden = false;
        const song = mp.currentTime;                 // 곡 시간 (시계 통일: MusicPlayer가 영상 오프셋을 흡수)
        const off = (mp.ytOffsetMs || 0) / 1000;
        const st = Game.state;
        const so = st.settings.startTimeOffset || 0;
        const k = YouTubeSource.clockStats();
        let layout = '-';
        if (typeof YTLayout !== 'undefined') {
            const r = YTLayout.rect;
            layout = `${YTLayout.mode}${r ? ` ${r.w}x${r.h}` : ''}  covered ${YTLayout.coveredTopPx}px`;
        }
        hudPre.textContent =
            `video ${(song + off).toFixed(3)}s  song ${song.toFixed(3)}s  off ${off.toFixed(3)}s${so ? `  start ${so.toFixed(3)}s` : ''}\n` +
            `layout ${layout}\n` +
            `state ${st.gameState}  audioReady ${st.audioReady}\n` +
            `clk ${k.mode}  upd med ${k.medianMs ?? '-'}ms p95 ${k.p95Ms ?? '-'}ms max ${k.maxMs ?? '-'}ms`;
    }

    // ── 판정 보정값 저장 (설정 > 캘리브레이션과 같은 경로) ─────────
    function saveCalibration() {
        const msg = $('ytt-msg');
        const v = Math.max(-300, Math.min(300, parseInt($('ytt-yto').value, 10) || 0));
        const slider = DOM.settings && DOM.settings.ytInputOffsetSlider;
        if (slider) {
            slider.value = v;
            slider.dispatchEvent(new Event('input', { bubbles: true }));   // main.js: settings 반영 + 표시
            slider.dispatchEvent(new Event('change', { bubbles: true }));  // main.js: localStorage + 프리셋 갱신
            $('ytt-yto').value = parseInt(slider.value, 10);
        } else {
            Game.state.settings.ytInputOffsetMs = v;
            try { localStorage.setItem('theBeat_ytInputOffsetMs', v); } catch (e) { /* 무시 */ }
        }
        msg.style.color = '';
        msg.textContent = `YouTube 판정 보정 ${$('ytt-yto').value}ms 저장됨`;
    }

    // ── 테스트 플레이 ────────────────────────────────────────────
    function buildChart(bpm, laneCount) {
        const ids = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        const beatMs = 60000 / bpm;
        const notes = [];
        for (let i = 0; i < 180 / (beatMs / 1000); i++) {
            notes.push({ time: Math.round(i * beatMs), lane: ids[(i * 3) % ids.length], type: 'tap' });
        }
        // 영상 오프셋은 채보가 아니라 MusicPlayer.ytOffsetMs로 처리 → startTimeOffset은 0 (실제 플레이와 동일)
        return { bpm, startTimeOffset: 0, fallSpeed: 7, useCustomFallSpeed: true, laneCount, notes, triggers: [], songName: 'YT TEST' };
    }

    function beginSession() {
        if (session) return;
        const st = Game.state;
        const saved = { settings: {}, state: {} };
        SETTING_KEYS.forEach((k) => { saved.settings[k] = st.settings[k]; });
        STATE_KEYS.forEach((k) => { saved.state[k] = st[k]; });
        session = { saved, observer: null, sawPlaying: false };
        // 플레이 화면을 벗어나면(결과 화면 → 메뉴로) 종료. 종료 경로(포기/완주/메뉴 복귀)가 여러 개라 화면 가시성으로 판단한다.
        const screen = $('playing-screen');
        if (screen && typeof MutationObserver !== 'undefined') {
            const s = session;
            s.observer = new MutationObserver(() => {
                if (session !== s) return;
                if (isPlaying()) { s.sawPlaying = true; return; }
                if (s.sawPlaying) endSession();
            });
            s.observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
        }
    }

    // 테스트가 바꾼 Game.state 값을 되돌린다.
    // DOM.musicPlayer / GameBackground는 건드리지 않는다 — 화면 전환 직후 메뉴 추천 카드 등이 이미 자기 값을 지정했을 수 있다.
    function endSession() {
        if (!session) return;
        const s = session;
        session = null;
        if (s.observer) s.observer.disconnect();
        const st = Game.state;
        Object.assign(st.settings, s.saved.settings);
        Object.assign(st, s.saved.state);
        st._onlineChartId = null;
    }

    async function startTest() {
        const msg = $('ytt-msg');
        msg.style.color = '#fca5a5';
        msg.textContent = '';
        const id = parseId($('ytt-url').value);
        if (!id) { msg.textContent = '올바른 YouTube 링크/ID가 아닙니다.'; return; }
        if (session) { msg.textContent = '이미 테스트 플레이 중입니다.'; return; }
        const offsetSec = Math.max(0, parseFloat($('ytt-offset').value) || 0);
        const bpm = Math.max(40, Math.min(300, parseInt($('ytt-bpm').value, 10) || 120));
        const lanes = parseInt($('ytt-lanes').value, 10) || 4;
        const yto = Math.max(-300, Math.min(300, parseInt($('ytt-yto').value, 10) || 0));
        const startBtn = $('ytt-start');
        startBtn.disabled = true;
        beginSession();
        try {
            const st = Game.state;
            Game.loadChartNotes(buildChart(bpm, lanes));
            st._onlineChartId = null;                 // 점수 등록 방지
            st._onlineSongId = null;
            st.settings.ytInputOffsetMs = yto;        // 이번 플레이 한정 (localStorage에는 쓰지 않음)
            st.settings.mode = 'music';
            st.settings.musicSrc = `yt:${id}`;
            st.settings.songStartOffset = 0;
            st.settings.musicFileObject = null;
            GameBackground.set(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
            DOM.musicPlayer.expectedDurationMs = 0;   // 이전 곡의 길이 기대값이 남아 있지 않게
            DOM.musicPlayer.ytOffsetMs = Math.round(offsetSec * 1000);
            DOM.musicPlayer.src = `yt:${id}`;
            const ready = await DOM.musicPlayer.whenReady();
            if (!ready) throw new Error((DOM.musicPlayer.error && DOM.musicPlayer.error.message) || '영상을 불러오지 못했습니다.');
            await Game.start();
            if (!isPlaying()) endSession();           // 시작 단계에서 막힘(차트/음원 없음 등)
        } catch (err) {
            msg.textContent = err.message || String(err);
            endSession();
        } finally {
            startBtn.disabled = false;
        }
    }

    Debugger.registerTool({ id: 'yt-tools', onToggle, onFrame });

    return { startTest, saveCalibration };
})();