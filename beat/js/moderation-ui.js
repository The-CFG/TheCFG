/**
 * ModerationUI — 신고 모달 + 모더레이터 패널
 * 신고는 접수만 되고, 곡은 모더레이터가 직접 "삭제 처리"하기 전까지 그대로 공개 상태다.
 */
const ModerationUI = {
    _overlay: null,

    _close() {
        if (typeof this._lgCleanup === 'function') this._lgCleanup(); // 첨부 도구의 플레이어/원본 음원 정리
        if (this._overlay) { this._overlay.remove(); this._overlay = null; }
    },

    _open(innerHtml) {
        this._close();
        const o = document.createElement('div');
        o.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4';
        o.innerHTML = `<div class="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gray-800 text-white rounded-xl p-5 shadow-2xl">${innerHtml}</div>`;
        o.addEventListener('mousedown', (e) => { if (e.target === o) this._close(); });
        document.body.appendChild(o);
        this._overlay = o;
        return o.firstElementChild;
    },

    // ── 신고 모달 ──────────────────────────────────────────────────────────
    openReport({ songId, chartId = null, title = '' }) {
        const reasonOpts = Object.entries(CloudModeration.REASONS)
            .map(([k, v]) => `<option value="${k}">${_esc(v)}</option>`).join('');
        const box = this._open(`
            <h3 class="text-lg font-bold mb-1">🚩 신고하기</h3>
            <p class="text-xs text-gray-400 mb-3 truncate">${_esc(title)}</p>
            <label class="block text-sm text-gray-300 mb-1">사유</label>
            <select id="rep-reason" class="w-full mb-3 p-2 rounded bg-gray-700 border border-gray-600 text-sm">${reasonOpts}</select>
            <label class="block text-sm text-gray-300 mb-1">상세 내용 (선택, 최대 1000자)</label>
            <textarea id="rep-detail" rows="4" maxlength="1000" class="w-full mb-2 p-2 rounded bg-gray-700 border border-gray-600 text-sm" placeholder="어떤 점이 문제인지 알려 주세요. (저작권 신고라면 원 저작물 정보)"></textarea>
            <p class="text-xs text-gray-500 mb-3">신고는 접수만 되며, 모더레이터가 검토한 뒤 처리합니다. 허위 신고를 반복하면 제한될 수 있습니다.</p>
            <p id="rep-msg" class="text-sm text-red-400 mb-2 hidden"></p>
            <div class="flex justify-end gap-2">
                <button id="rep-cancel" class="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm">취소</button>
                <button id="rep-submit" class="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-sm font-semibold">신고 접수</button>
            </div>`);
        const msg = box.querySelector('#rep-msg');
        box.querySelector('#rep-cancel').addEventListener('click', () => this._close());
        const submit = box.querySelector('#rep-submit');
        submit.addEventListener('click', async () => {
            submit.disabled = true;
            msg.classList.add('hidden');
            const res = await CloudModeration.reportSong({
                songId, chartId,
                reason: box.querySelector('#rep-reason').value,
                detail: box.querySelector('#rep-detail').value,
            });
            if (!res.ok) {
                msg.textContent = res.error; msg.classList.remove('hidden'); submit.disabled = false;
                return;
            }
            box.innerHTML = `<p class="text-center py-6">신고가 접수되었습니다. 검토 후 처리됩니다.</p>
                <div class="flex justify-center"><button id="rep-done" class="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm">닫기</button></div>`;
            box.querySelector('#rep-done').addEventListener('click', () => this._close());
        });
    },

    // ── 모더레이터 패널 ────────────────────────────────────────────────────
    async openPanel(status = 'open') {
        if (!(await CloudModeration.isModerator())) return;
        const box = this._open(`<p class="text-center text-gray-400 py-6">불러오는 중…</p>`);
        const { data, error } = await CloudModeration.listReports(status, 100);
        const tabs = [['open', '대기'], ['actioned', '삭제 처리됨'], ['dismissed', '기각']]
            .map(([k, v]) => `<button data-st="${k}" class="mod-tab flex-1 py-1.5 rounded text-sm ${k === status ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">${v}</button>`).join('');
        const rows = error
            ? `<p class="text-red-400 text-sm">${_esc(error)}</p>`
            : (data.length === 0 ? `<p class="text-center text-gray-500 py-6 text-sm">항목이 없습니다.</p>` : data.map(r => this._rowHtml(r)).join(''));
        box.innerHTML = `
            <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-bold">🛡 신고 관리</h3>
                <div class="flex gap-2"><button id="mod-legacy" class="px-3 py-1 rounded bg-teal-700 hover:bg-teal-600 text-sm">🔗 링크 일괄 첨부</button>
                <button id="mod-close" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm">닫기</button></div></div>
            <div class="flex gap-2 mb-3">${tabs}</div>
            <div class="space-y-3">${rows}</div>`;
        box.querySelector('#mod-close').addEventListener('click', () => this._close());
        box.querySelector('#mod-legacy').addEventListener('click', () => this.openLegacyTool());
        box.querySelectorAll('.mod-tab').forEach(b => b.addEventListener('click', () => this.openPanel(b.dataset.st)));
        box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this._onAction(b, status)));
    },

    _rowHtml(r) {
        const reason = CloudModeration.REASONS[r.reason] || r.reason;
        const src = r.source_type === 'youtube' && r.youtube_id
            ? `<a class="text-teal-400 underline" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${_esc(r.youtube_id)}">YouTube</a>` : _esc(r.source_type || '');
        const removed = r.moderation_status === 'removed';
        let btns = '';
        if (r.status === 'open') {
            btns = `<button data-act="takedown" data-song="${r.song_id}" data-report="${r.report_id}" class="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-xs font-semibold">삭제 처리</button>
                    <button data-act="dismiss" data-report="${r.report_id}" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-xs">기각</button>`;
        } else if (r.status === 'actioned' && removed) {
            btns = `<button data-act="restore" data-song="${r.song_id}" class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">잠금 해제(복구)</button>`;
        }
        return `<div class="p-3 bg-gray-900 rounded-lg text-sm">
            <div class="font-semibold truncate">${_esc(r.song_title || '(삭제된 곡)')} <span class="text-gray-400 font-normal">— ${_esc(r.song_artist || '—')}</span></div>
            <div class="text-xs text-gray-400 mt-1">${src} · 소유자 ${_esc(r.owner_handle || '—')} · 이 곡 신고 ${r.reports_on_song}건 · ${r.is_public ? '공개 중' : '비공개'}${removed ? ' · <span class="text-red-400">삭제 처리됨</span>' : ''}</div>
            <div class="mt-2"><span class="px-2 py-0.5 rounded bg-red-900 text-red-200 text-xs">${_esc(reason)}</span>
                <span class="text-xs text-gray-500 ml-2">${_esc(new Date(r.created_at).toLocaleString())}</span></div>
            ${r.detail ? `<p class="mt-2 text-gray-300 whitespace-pre-wrap break-words">${_esc(r.detail)}</p>` : ''}
            <div class="text-xs text-gray-500 mt-1">신고자 ${_esc(r.reporter_handle || '—')} (기각 이력 ${r.reporter_dismissed_count}건)${r.mod_note ? ` · 메모: ${_esc(r.mod_note)}` : ''}</div>
            ${btns ? `<div class="flex gap-2 mt-2">${btns}</div>` : ''}
        </div>`;
    },

    async _onAction(btn, status) {
        const act = btn.dataset.act;
        let res;
        if (act === 'takedown') {
            const reason = prompt('삭제 처리 사유 (소유자 확인용 메모):', '');
            if (reason === null) return;
            if (!confirm('이 곡과 모든 차트를 비공개로 삭제 처리합니다. 소유자는 다시 공개할 수 없습니다. 진행할까요?')) return;
            res = await CloudModeration.takedownSong(btn.dataset.song, reason);
        } else if (act === 'dismiss') {
            const note = prompt('기각 메모 (선택):', '');
            if (note === null) return;
            res = await CloudModeration.dismissReport(btn.dataset.report, note);
        } else if (act === 'restore') {
            const note = prompt('복구 메모 (선택):', '');
            if (note === null) return;
            res = await CloudModeration.restoreSong(btn.dataset.song, note);
        } else return;
        if (!res.ok) { alert('처리 실패: ' + res.error); return; }
        this.openPanel(status);
    },

    // 곡 상세 화면에서 모더레이터가 바로 삭제 처리
    async takedownFromDetail(songId, title) {
        const reason = prompt(`"${title}" 삭제 처리 사유:`, '');
        if (reason === null) return false;
        if (!confirm('이 곡과 모든 차트를 비공개로 삭제 처리합니다. 진행할까요?')) return false;
        const res = await CloudModeration.takedownSong(songId, reason);
        if (!res.ok) { alert('처리 실패: ' + res.error); return false; }
        return true;
    },

    // ═══ 기존(legacy) 곡 → YouTube 링크 일괄 첨부 도구 (S6) ═══════════════════════════
    // 운영자가 곡별로: 링크 입력 → 영상 검증(oEmbed+길이) → 원본 음원과 영상을 오프셋 맞춰 비교 재생 → 첨부.
    // 첨부하면 곡은 youtube 소스로 전환되고 옛 오디오는 정리 대기열로 간다(Storage 삭제는 "파일 삭제 실행").
    // 이 도구의 플레이어는 모달 안에 보이게 따로 만든다(숨김/오버레이 없음).
    _lg: { q: '', offset: 0, ytPlayer: null, audioEl: null },

    _parseYtId(v) {
        v = (v || '').trim();
        if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
        try {
            const u = new URL(v);
            if (u.hostname === 'youtu.be') { const id = u.pathname.slice(1, 12); return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null; }
            if (/(^|\.)youtube\.com$/.test(u.hostname)) {
                const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/) || [])[1];
                return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
            }
        } catch (e) { /* URL 아님 */ }
        return null;
    },

    _lgCleanup() {
        try { if (this._lg.ytPlayer) this._lg.ytPlayer.destroy(); } catch (e) { /* 무시 */ }
        this._lg.ytPlayer = null;
        if (this._lg.audioEl) { try { this._lg.audioEl.pause(); } catch (e) { /* 무시 */ } this._lg.audioEl = null; }
    },

    async openLegacyTool() {
        if (!(await CloudModeration.isModerator())) return;
        try { SongPreview.stop(); } catch (e) { /* 무시 */ } // 뒤에서 재생 중인 미리듣기 정리
        this._lgCleanup();
        const box = this._open(`<p class="text-center text-gray-400 py-6">불러오는 중…</p>`);
        const lg = this._lg;
        const [{ data, total, error }, pending] = await Promise.all([
            CloudModeration.listLegacySongs(lg.q, 20, lg.offset), CloudModeration.purgeCount(),
        ]);
        const rows = error ? `<p class="text-red-400 text-sm">${_esc(error)}</p>`
            : (data.length === 0 ? `<p class="text-center text-gray-500 py-6 text-sm">첨부할 legacy 곡이 없습니다. 🎉</p>`
                : data.map(r => `<button data-song="${r.song_id}" class="lg-row w-full text-left p-3 bg-gray-900 hover:bg-gray-700 rounded-lg text-sm">
                    <div class="font-semibold truncate">${_esc(r.title)} <span class="text-gray-400 font-normal">— ${_esc(r.artist || '—')}</span></div>
                    <div class="text-xs text-gray-500">소유자 ${_esc(r.owner_handle || '—')} · 차트 ${r.chart_count}개 · ${r.is_public ? '공개' : '비공개'}</div></button>`).join(''));
        box.innerHTML = `
            <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-bold">🔗 링크 일괄 첨부 <span class="text-sm text-gray-400">(남은 ${total}곡)</span></h3>
                <button id="lg-back" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm">← 신고 관리</button></div>
            <div class="flex gap-2 mb-3"><input id="lg-q" value="${_esc(lg.q)}" placeholder="제목/아티스트 검색" class="flex-1 p-2 rounded bg-gray-700 border border-gray-600 text-sm">
                <button id="lg-search" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-sm">검색</button></div>
            <div class="space-y-2 mb-3">${rows}</div>
            <div class="flex items-center justify-between mb-3 text-sm">
                <button id="lg-prev" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 ${lg.offset === 0 ? 'opacity-40' : ''}" ${lg.offset === 0 ? 'disabled' : ''}>이전</button>
                <span class="text-gray-400">${total ? `${lg.offset + 1}–${Math.min(lg.offset + 20, total)} / ${total}` : ''}</span>
                <button id="lg-next" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 ${lg.offset + 20 >= total ? 'opacity-40' : ''}" ${lg.offset + 20 >= total ? 'disabled' : ''}>다음</button></div>
            <div class="p-3 bg-gray-900 rounded-lg text-sm flex items-center justify-between">
                <span>정리 대기 중인 옛 오디오 파일: <b>${pending}</b>개</span>
                <button id="lg-purge" class="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-xs ${pending ? '' : 'opacity-40'}" ${pending ? '' : 'disabled'}>파일 삭제 실행</button></div>
            <p id="lg-msg" class="text-xs text-gray-400 mt-2"></p>`;
        box.querySelector('#lg-back').addEventListener('click', () => this.openPanel());
        const search = () => { lg.q = box.querySelector('#lg-q').value; lg.offset = 0; this.openLegacyTool(); };
        box.querySelector('#lg-search').addEventListener('click', search);
        box.querySelector('#lg-q').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
        box.querySelector('#lg-prev').addEventListener('click', () => { lg.offset = Math.max(0, lg.offset - 20); this.openLegacyTool(); });
        box.querySelector('#lg-next').addEventListener('click', () => { lg.offset += 20; this.openLegacyTool(); });
        box.querySelectorAll('.lg-row').forEach(b => b.addEventListener('click', () => this._openAttachEditor(data.find(r => r.song_id === b.dataset.song))));
        box.querySelector('#lg-purge').addEventListener('click', async () => {
            if (!confirm(`정리 대기 중인 옛 오디오 ${pending}개를 Storage에서 영구 삭제합니다. 진행할까요?`)) return;
            const msg = box.querySelector('#lg-msg');
            const res = await CloudModeration.purgeFiles((ok, fail) => { msg.textContent = `삭제 중… 완료 ${ok} / 실패 ${fail}`; });
            if (res.error) { msg.textContent = '실패: ' + res.error; return; }
            alert(`완료: ${res.removed}개 삭제${res.failed ? `, ${res.failed}개 실패(다시 실행하면 재시도)` : ''}`);
            this.openLegacyTool();
        });
    },

    // 곡 소유자 본인이 자기 곡을 YouTube 링크 기반으로 전환 (내 곡 목록의 "🔗 YouTube 전환")
    openOwnAttach(mySong, onDone) {
        try { SongPreview.stop(); } catch (e) { /* 무시 */ }
        this._openAttachEditor({
            song_id: mySong.id, title: mySong.title || '(제목 없음)', artist: mySong.artist,
            owner_handle: '나', chart_count: mySong.beatmapCount || 0, audio_storage_path: mySong.audio_storage_path || null,
        }, { own: true, onDone });
    },

    async _openAttachEditor(song, opts = {}) {
        if (!song) return;
        this._lgCleanup();
        const own = !!opts.own;
        const hasOrig = !!song.audio_storage_path;
        const canCompare = hasOrig || own; // 본인 전환: 서버 음원이 없는 곡(local)은 내 파일을 골라 비교
        const box = this._open(`
            <div class="flex items-center justify-between mb-2"><h3 class="text-lg font-bold truncate">${_esc(song.title)}</h3>
                <button id="ae-back" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm flex-shrink-0">${own ? '닫기' : '← 목록'}</button></div>
            <p class="text-xs text-gray-400 mb-3">${_esc(song.artist || '—')} · 소유자 ${_esc(song.owner_handle || '—')} · 차트 ${song.chart_count}개</p>
            <div class="flex gap-2 mb-2"><input id="ae-url" placeholder="YouTube 링크 또는 영상 ID" class="flex-1 p-2 rounded bg-gray-700 border border-gray-600 text-sm">
                <button id="ae-check" class="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-sm">확인</button></div>
            <p id="ae-status" class="text-xs text-gray-400 mb-2 min-h-[1rem]"></p>
            <div id="ae-player-wrap" class="mb-2" style="width:480px;max-width:100%;aspect-ratio:16/9;background:#000"><div id="ae-player"></div></div>
            <div class="flex items-center gap-2 mb-2 text-sm">
                <label class="text-gray-300">오프셋(초)</label>
                <button data-d="-0.1" class="ae-nudge px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">-0.1</button>
                <input id="ae-off" type="number" step="0.01" min="0" value="0" class="w-24 p-1 rounded bg-gray-700 border border-gray-600 text-center">
                <button data-d="0.1" class="ae-nudge px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">+0.1</button>
                <span class="text-xs text-gray-500">= 영상에서 곡이 시작하는 지점</span></div>
            ${own && !hasOrig ? `<p class="text-xs text-gray-400 mb-2">비교용 내 음원 파일(선택): <input id="ae-file" type="file" accept="audio/*" class="text-xs"></p>` : ''}
            <div class="flex flex-wrap gap-2 mb-3 text-sm">
                <button id="ae-play-video" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500">▶ 영상(오프셋부터)</button>
                ${canCompare ? `<button id="ae-play-orig" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500">▶ 원본 음원</button>
                <button id="ae-play-both" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500">▶ 동시 재생(싱크 확인)</button>` : ''}
                <button id="ae-stop" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600">■ 정지</button></div>
            ${own ? `<p class="text-xs text-yellow-300 mb-2">⚠ 전환하면 서버에 올린 음원 파일은 삭제되고 되돌릴 수 없습니다. 오프셋은 이 곡의 노트 타이밍에 맞춰야 합니다.</p>` : ''}
            <p class="text-xs text-gray-500 mb-3">동시 재생: 영상이 실제로 재생되기 시작하는 순간에 맞춰 원본 음원을 같은 곡 지점부터 재생합니다(영상 로딩 지연은 자동 보정). 오프셋이 맞으면 소리가 하나로 들리고, 틀리면 메아리처럼 겹쳐 들립니다. <b>영상 소리가 원본보다 늦게 들리면 오프셋을 늘리고, 빠르면 줄이세요.</b> (큰 단위 → 0.1초 → 0.01초 순으로)</p>
            <p id="ae-msg" class="text-sm text-red-400 mb-2 hidden"></p>
            <div class="flex justify-end"><button id="ae-save" disabled class="px-4 py-2 rounded bg-green-700 hover:bg-green-600 text-sm font-semibold opacity-40">첨부하고 전환</button></div>`);
        const $ = (s) => box.querySelector(s);
        const state = { id: null, durationMs: 0, verified: false };
        const setStatus = (t, err) => { const el = $('#ae-status'); el.textContent = t; el.className = 'text-xs mb-2 min-h-[1rem] ' + (err ? 'text-red-400' : 'text-gray-400'); };
        const offSec = () => Math.max(0, parseFloat($('#ae-off').value) || 0);
        const stopAll = () => {
            try { if (this._lg.ytPlayer && this._lg.ytPlayer.pauseVideo) this._lg.ytPlayer.pauseVideo(); } catch (e) { /* 무시 */ }
            if (this._lg.audioEl) this._lg.audioEl.pause();
        };
        const ensureAudio = async () => {
            const picked = box.querySelector('#ae-file') && box.querySelector('#ae-file').files[0];
            if (!this._lg.audioEl && !hasOrig && !picked) throw new Error('비교할 음원 파일을 먼저 선택하세요.');
            if (!this._lg.audioEl) {
                const a = new Audio();
                a.src = hasOrig ? await CloudModeration.legacyAudioUrl(song.audio_storage_path) : URL.createObjectURL(picked);
                a.preload = 'auto';
                this._lg.audioEl = a;
            }
            return this._lg.audioEl;
        };
        const pending = { audio: false, timer: null };
        // 영상이 실제 PLAYING이 된 시점의 영상 위치(getCurrentTime)에서 오프셋을 빼 곡 위치를 구하고, 원본 음원을 그 지점에 맞춰 시작한다
        const startAudioSynced = () => {
            const a = this._lg.audioEl, p = this._lg.ytPlayer;
            if (!a || !p) return;
            const songT = p.getCurrentTime() - offSec();
            if (songT >= 0) { a.currentTime = songT; a.play().catch(e => setStatus('원본 음원 재생 실패: ' + e.message, true)); }
            else { a.currentTime = 0; setTimeout(() => a.play().catch(() => {}), -songT * 1000); } // 영상이 곡 시작 전 지점이면 그만큼 기다렸다가
        };
        const playVideo = () => { const p = this._lg.ytPlayer; if (!p || !state.id) return; p.seekTo(offSec(), true); p.playVideo(); };
        const playOrig = async () => {
            try { const a = await ensureAudio(); a.currentTime = 0; await a.play(); }
            catch (e) { setStatus('원본 음원 재생 실패: ' + e.message, true); }
        };

        $('#ae-back').addEventListener('click', () => { this._lgCleanup(); if (own) this._close(); else this.openLegacyTool(); });
        if ($('#ae-file')) $('#ae-file').addEventListener('change', () => { if (this._lg.audioEl) { this._lg.audioEl.pause(); this._lg.audioEl = null; } });
        box.querySelectorAll('.ae-nudge').forEach(b => b.addEventListener('click', () => {
            const v = Math.max(0, Math.round((offSec() + parseFloat(b.dataset.d)) * 100) / 100);
            $('#ae-off').value = v; if (state.verified) playVideo();
        }));
        $('#ae-stop').addEventListener('click', stopAll);
        $('#ae-play-video').addEventListener('click', () => { stopAll(); playVideo(); });
        $('#ae-play-orig').addEventListener('click', () => { stopAll(); playOrig(); });
        $('#ae-play-both').addEventListener('click', async () => {
            stopAll();
            try { await ensureAudio(); } catch (e) { setStatus('원본 음원 재생 실패: ' + e.message, true); return; }
            pending.audio = true;
            clearTimeout(pending.timer);
            pending.timer = setTimeout(() => { pending.audio = false; }, 8000); // 영상이 시작 못 하면 대기 해제
            playVideo();
        });

        $('#ae-check').addEventListener('click', async () => {
            const id = this._parseYtId($('#ae-url').value);
            if (!id) { setStatus('올바른 YouTube 링크 또는 영상 ID가 아닙니다.', true); return; }
            state.verified = false; state.id = null;
            $('#ae-save').disabled = true; $('#ae-save').classList.add('opacity-40');
            setStatus('영상 확인 중…');
            try {
                // ① oEmbed — 404: 없음/비공개, 401/403: 임베드 불가
                let info = null;
                try {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`);
                    if (res.status === 404) throw new Error('영상을 찾을 수 없습니다 (삭제됨/비공개).');
                    if (res.status === 401 || res.status === 403) throw new Error('이 영상은 임베드가 허용되지 않아 사용할 수 없습니다.');
                    if (res.ok) info = await res.json();
                } catch (err) { if (/영상/.test(err.message)) throw err; }
                // ② 모달 안의 (보이는) 플레이어로 길이 취득
                await YouTubeSource._loadApi();
                this._lgCleanup();
                const wrap = $('#ae-player-wrap');
                wrap.innerHTML = '<div id="ae-player"></div>';
                const durationMs = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('영상 정보를 불러오지 못했습니다.')), 15000);
                    this._lg.ytPlayer = new YT.Player('ae-player', {
                        width: '100%', height: '100%', videoId: id,
                        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
                        events: {
                            onReady: (e) => {
                                const poll = setInterval(() => {
                                    const d = e.target.getDuration();
                                    if (d > 0) { clearInterval(poll); clearTimeout(timer); resolve(Math.round(d * 1000)); }
                                }, 200);
                                e.target.playVideo(); // 길이가 늦게 잡히는 영상 대비(플레이어는 보이는 상태)
                                setTimeout(() => { try { e.target.pauseVideo(); } catch (x) { /* 무시 */ } }, 1500);
                            },
                            onStateChange: (e) => {
                                if (e.data === 1 && pending.audio) { pending.audio = false; clearTimeout(pending.timer); startAudioSynced(); }
                            },
                            onError: (e) => { clearTimeout(timer); reject(new Error([100, 101, 150].includes(e.data) ? '영상 사용 불가: 삭제/비공개/임베드 금지/지역 차단' : 'YouTube 오류 ' + e.data)); },
                        },
                    });
                });
                state.id = id; state.durationMs = durationMs; state.verified = true;
                const m = Math.floor(durationMs / 60000), s = Math.floor(durationMs / 1000) % 60;
                setStatus(`✔ ${info && info.title ? info.title + ' · ' : ''}길이 ${m}:${String(s).padStart(2, '0')}`);
                $('#ae-save').disabled = false; $('#ae-save').classList.remove('opacity-40');
            } catch (err) { setStatus(err.message || '영상을 확인하지 못했습니다.', true); }
        });

        $('#ae-save').addEventListener('click', async () => {
            if (!state.verified) return;
            if (!confirm(`"${song.title}"을(를) YouTube(${state.id}), 오프셋 ${offSec()}초로 전환합니다.\n서버의 옛 음원 파일은 삭제됩니다. 진행할까요?`)) return;
            const msg = $('#ae-msg'); msg.classList.add('hidden');
            if (own) {
                const r = await CloudCharts.attachYoutubeToMySong(song.song_id, state.id, Math.round(offSec() * 1000), state.durationMs);
                if (r.error) { msg.textContent = '실패: ' + (CloudModeration._errMsg(r.error)); msg.classList.remove('hidden'); return; }
                if (r.purgeFailed) alert('전환은 완료됐지만 옛 음원 파일 삭제는 실패했습니다. 대기열에 남아 나중에 정리됩니다.');
                this._close();
                if (typeof opts.onDone === 'function') opts.onDone();
                return;
            }
            const res = await CloudModeration.attachYoutube(song.song_id, state.id, Math.round(offSec() * 1000), state.durationMs);
            if (!res.ok) { msg.textContent = '실패: ' + res.error; msg.classList.remove('hidden'); return; }
            this._lgCleanup();
            this.openLegacyTool(); // 처리된 곡은 목록에서 빠진다 → 다음 곡으로
        });
    },
};