// ══ TEMP — S3 테스트용 임시 도구. 테스트 끝나면 이 파일과 index.html의 script 줄을 지우면 된다. ══
// 우측 하단 "🧪 YT" 버튼 → YouTube 링크 + 오프셋으로 메트로놈 채보(박자마다 노트)를 즉시 플레이.
//  - 점수 등록 안 함(_onlineChartId = null)
//  - 플레이 중 우측 하단에 YT 시간 / 곡 시간 / 레이아웃 모드를 표시
(function () {
    const css = document.createElement('style');
    css.textContent =
        '#yt-test-btn{position:fixed;right:8px;bottom:8px;z-index:10000;padding:6px 10px;background:#7c3aed;color:#fff;border-radius:8px;font-size:12px;opacity:.85;border:0;cursor:pointer}' +
        '#yt-test-panel{position:fixed;right:8px;bottom:44px;z-index:10000;width:280px;padding:10px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:10px;font-size:12px;display:none}' +
        '#yt-test-panel label{display:block;margin-top:6px;color:#9ca3af}' +
        '#yt-test-panel input,#yt-test-panel select{width:100%;padding:5px;background:#374151;color:#fff;border-radius:6px;border:0;margin-top:2px;box-sizing:border-box}' +
        '#yt-test-panel button{width:100%;margin-top:10px;padding:8px;background:#0d9488;color:#fff;border-radius:6px;border:0;cursor:pointer}' +
        '#yt-test-hud{position:fixed;right:8px;bottom:8px;z-index:10000;padding:4px 8px;background:rgba(0,0,0,.6);color:#a7f3d0;font:11px/1.4 monospace;border-radius:6px;display:none;pointer-events:none;white-space:pre}';
    document.head.appendChild(css);

    const btn = document.createElement('button');
    btn.id = 'yt-test-btn'; btn.textContent = '🧪 YT'; btn.type = 'button';
    const panel = document.createElement('div');
    panel.id = 'yt-test-panel';
    panel.innerHTML =
        '<b>YT 플레이 테스트 (임시)</b>' +
        '<label>YouTube 링크/ID<input id="ytt-url" placeholder="https://youtu.be/..."></label>' +
        '<label>영상 오프셋(초) — 곡이 시작되는 지점<input id="ytt-offset" type="number" step="0.01" min="0" value="0"></label>' +
        '<label>YouTube 판정 보정(ms) — 설정의 같은 값<input id="ytt-yto" type="number" step="5" min="-300" max="300" value="0"></label>' +
        '<label>BPM(박자마다 노트)<input id="ytt-bpm" type="number" min="40" max="300" value="120"></label>' +
        '<label>레인 수<select id="ytt-lanes"><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option></select></label>' +
        '<label style="display:flex;gap:6px;align-items:center"><input id="ytt-onscreen" type="checkbox" style="width:auto"> 플레이어 항상 노출(진단: 모바일 플레이 중에도 화면 우하단)</label>' +
        '<button id="ytt-start" type="button">▶ 시작</button>' +
        '<div id="ytt-msg" style="margin-top:6px;color:#fca5a5;min-height:14px"></div>';
    const hud = document.createElement('div');
    hud.id = 'yt-test-hud';

    const $ = (id) => document.getElementById(id);
    const isPlaying = () => { const el = document.getElementById('playing-screen'); return !!el && !el.classList.contains('hidden'); };

    function buildChart(bpm, laneCount, offsetSec) {
        const ids = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        const beatMs = 60000 / bpm;
        const notes = [];
        for (let i = 0; i < 180 / (beatMs / 1000); i++) {
            notes.push({ time: Math.round(i * beatMs), lane: ids[(i * 3) % ids.length], type: 'tap' });
        }
        return { bpm, startTimeOffset: offsetSec, fallSpeed: 7, useCustomFallSpeed: true, laneCount, notes, triggers: [], songName: 'YT TEST' };
    }

    async function start() {
        const msg = $('ytt-msg'); msg.textContent = '';
        const id = EditorSong.parseYoutubeId($('ytt-url').value);
        if (!id) { msg.textContent = '올바른 YouTube 링크/ID가 아닙니다.'; return; }
        const offset = Math.max(0, parseFloat($('ytt-offset').value) || 0);
        const bpm = Math.max(40, Math.min(300, parseInt($('ytt-bpm').value, 10) || 120));
        const lanes = parseInt($('ytt-lanes').value, 10) || 4;
        const yto = Math.max(-300, Math.min(300, parseInt($('ytt-yto').value, 10) || 0));
        Game.state.settings.ytInputOffsetMs = yto;
        try { localStorage.setItem('theBeat_ytInputOffsetMs', yto); } catch (e) { /* 무시 */ }
        $('ytt-start').disabled = true;
        try {
            const chart = buildChart(bpm, lanes, offset);
            Game.loadChartNotes(chart);
            Game.state._onlineChartId = null;      // 점수 등록 방지
            Game.state.settings.mode = 'music';
            Game.state.settings.musicSrc = `yt:${id}`;
            Game.state.settings.songStartOffset = offset;
            Game.state.settings.musicFileObject = null;
            GameBackground.set(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
            DOM.musicPlayer.src = `yt:${id}`;
            const ready = await DOM.musicPlayer.whenReady();
            if (!ready) throw new Error(DOM.musicPlayer.error?.message || '영상을 불러오지 못했습니다.');
            panel.style.display = 'none';
            await Game.start();
        } catch (err) {
            msg.textContent = err.message || String(err);
        } finally {
            $('ytt-start').disabled = false;
        }
    }

    function tick() {
        const playing = isPlaying();
        btn.style.display = playing ? 'none' : 'block';
        if (playing) panel.style.display = 'none';
        hud.style.display = playing && DOM.musicPlayer.kind === 'yt' ? 'block' : 'none';
        if (hud.style.display === 'block') {
            const t = DOM.musicPlayer.currentTime;
            const so = Game.state.settings.startTimeOffset || 0;
            const r = YTLayout.rect;
            hud.textContent =
                `yt ${t.toFixed(3)}s  song ${(t - so).toFixed(3)}s\n` +
                `layout ${YTLayout.mode}${r ? ` ${r.w}x${r.h}` : ''}  covered ${YTLayout.coveredTopPx}px\n` +
                `state ${Game.state.gameState}  audioReady ${Game.state.audioReady}\n` +
                (() => { const k = YouTubeSource.clockStats(); return `clk ${k.mode}  upd med ${k.medianMs ?? '-'}ms p95 ${k.p95Ms ?? '-'}ms max ${k.maxMs ?? '-'}ms`; })();
        }
        requestAnimationFrame(tick);
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.body.append(btn, panel, hud);
        $('ytt-yto').value = Game.state.settings.ytInputOffsetMs || 0;
        btn.addEventListener('click', () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; });
        $('ytt-start').addEventListener('click', start);
        const onscreenEl = $('ytt-onscreen');
        try { onscreenEl.checked = localStorage.getItem('theBeat_ytDebugOnscreen') === '1'; } catch (e) { /* 무시 */ }
        onscreenEl.addEventListener('change', () => {
            try { localStorage.setItem('theBeat_ytDebugOnscreen', onscreenEl.checked ? '1' : '0'); } catch (e) { /* 무시 */ }
            YTLayout.update();
        });
        requestAnimationFrame(tick);
    });
})();