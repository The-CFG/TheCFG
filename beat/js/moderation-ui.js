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
            <h3 class="text-lg font-bold mb-1">${I18n.t("j_report", {a: Icon.html('flag')})}</h3>
            <p class="text-xs text-gray-400 mb-3 truncate">${_esc(title)}</p>
            <label class="block text-sm text-gray-300 mb-1">${I18n.t("j_reason")}</label>
            <select id="rep-reason" class="w-full mb-3 p-2 rounded bg-gray-700 border border-gray-600 text-sm">${reasonOpts}</select>
            <label class="block text-sm text-gray-300 mb-1">${I18n.t("j_details_optional_up_to_1000")}</label>
            <textarea id="rep-detail" rows="4" maxlength="1000" class="w-full mb-2 p-2 rounded bg-gray-700 border border-gray-600 text-sm" placeholder="${I18n.t("j_tell_us_what_the_problem")}"></textarea>
            <p class="text-xs text-gray-500 mb-3">${I18n.t("j_reports_are_only_submitted_here")}</p>
            <p id="rep-msg" class="text-sm text-red-400 mb-2 hidden"></p>
            <div class="flex justify-end gap-2">
                <button id="rep-cancel" class="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm">${I18n.t("b_cancel")}</button>
                <button id="rep-submit" class="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-sm font-semibold">${I18n.t("j_submit_report")}</button>
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
            box.innerHTML = `<p class="text-center py-6">${I18n.t("j_your_report_has_been_submitted")}</p>
                <div class="flex justify-center"><button id="rep-done" class="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm">${I18n.t("b_close")}</button></div>`;
            box.querySelector('#rep-done').addEventListener('click', () => this._close());
        });
    },

    // ── 모더레이터 패널 ────────────────────────────────────────────────────
    async openPanel(status = 'open') {
        if (!(await CloudModeration.isModerator())) return;
        const box = this._open(`<p class="text-center text-gray-400 py-6">${I18n.t("j_loading_2")}</p>`);
        const { data, error } = await CloudModeration.listReports(status, 100);
        const tabs = [['open', I18n.t("j_pending")], ['actioned', I18n.t("j_taken_down")], ['dismissed', I18n.t("j_dismissed")]]
            .map(([k, v]) => `<button data-st="${k}" class="mod-tab flex-1 py-1.5 rounded text-sm ${k === status ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}">${v}</button>`).join('');
        const rows = error
            ? `<p class="text-red-400 text-sm">${_esc(error)}</p>`
            : (data.length === 0 ? `<p class="text-center text-gray-500 py-6 text-sm">${I18n.t("j_no_items")}</p>` : data.map(r => this._rowHtml(r)).join(''));
        box.innerHTML = `
            <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-bold">${I18n.t("j_report_management", {a: Icon.html('shield')})}</h3>
                <div class="flex gap-2"><button id="mod-legacy" class="px-3 py-1 rounded bg-teal-700 hover:bg-teal-600 text-sm">${I18n.t("j_bulk_attach_links", {a: Icon.html('link')})}</button>
                <button id="mod-close" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm">${I18n.t("b_close")}</button></div></div>
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
            btns = `<button data-act="takedown" data-song="${r.song_id}" data-report="${r.report_id}" class="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-xs font-semibold">${I18n.t("j_take_down")}</button>
                    <button data-act="dismiss" data-report="${r.report_id}" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-xs">${I18n.t("j_dismissed")}</button>`;
        } else if (r.status === 'actioned' && removed) {
            btns = `<button data-act="restore" data-song="${r.song_id}" class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">${I18n.t("j_unlock_restore")}</button>`;
        }
        return `<div class="p-3 bg-gray-900 rounded-lg text-sm">
            <div class="font-semibold truncate">${_esc(r.song_title || I18n.t("j_deleted_song"))} <span class="text-gray-400 font-normal">— ${_esc(r.song_artist || '—')}</span></div>
            <div class="text-xs text-gray-400 mt-1">${I18n.t("j_owner_reports_on_this_song", {a: src, b: _esc(r.owner_handle || '—'), c: r.reports_on_song, d: r.is_public ? I18n.t("j_public_3") : I18n.t("j_private_2"), e: removed ? I18n.t("j_taken_down_2") : ''})}</div>
            <div class="mt-2"><span class="px-2 py-0.5 rounded bg-red-900 text-red-200 text-xs">${_esc(reason)}</span>
                <span class="text-xs text-gray-500 ml-2">${_esc(new Date(r.created_at).toLocaleString())}</span></div>
            ${r.detail ? `<p class="mt-2 text-gray-300 whitespace-pre-wrap break-words">${_esc(r.detail)}</p>` : ''}
            <div class="text-xs text-gray-500 mt-1">${I18n.t("j_reporter_dismissals", {a: _esc(r.reporter_handle || '—'), b: r.reporter_dismissed_count, c: r.mod_note ? I18n.t("j_note", {a: _esc(r.mod_note)}) : ''})}</div>
            ${btns ? `<div class="flex gap-2 mt-2">${btns}</div>` : ''}
        </div>`;
    },

    async _onAction(btn, status) {
        const act = btn.dataset.act;
        let res;
        if (act === 'takedown') {
            const reason = prompt(I18n.t("j_takedown_reason_note_shown_to"), '');
            if (reason === null) return;
            if (!confirm(I18n.t("j_this_will_take_down_this"))) return;
            res = await CloudModeration.takedownSong(btn.dataset.song, reason);
        } else if (act === 'dismiss') {
            const note = prompt(I18n.t("j_dismissal_note_optional"), '');
            if (note === null) return;
            res = await CloudModeration.dismissReport(btn.dataset.report, note);
        } else if (act === 'restore') {
            const note = prompt(I18n.t("j_restore_note_optional"), '');
            if (note === null) return;
            res = await CloudModeration.restoreSong(btn.dataset.song, note);
        } else return;
        if (!res.ok) { alert(I18n.t("j_action_failed", {a: res.error})); return; }
        this.openPanel(status);
    },

    // 곡 상세 화면에서 모더레이터가 바로 삭제 처리
    async takedownFromDetail(songId, title) {
        const reason = prompt(I18n.t("j_takedown_reason_for", {a: title}), '');
        if (reason === null) return false;
        if (!confirm(I18n.t("j_this_will_take_down_this_2"))) return false;
        const res = await CloudModeration.takedownSong(songId, reason);
        if (!res.ok) { alert(I18n.t("j_action_failed", {a: res.error})); return false; }
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
        const box = this._open(`<p class="text-center text-gray-400 py-6">${I18n.t("j_loading_2")}</p>`);
        const lg = this._lg;
        const [{ data, total, error }, pending] = await Promise.all([
            CloudModeration.listLegacySongs(lg.q, 20, lg.offset), CloudModeration.purgeCount(),
        ]);
        const rows = error ? `<p class="text-red-400 text-sm">${_esc(error)}</p>`
            : (data.length === 0 ? `<p class="text-center text-gray-500 py-6 text-sm">${I18n.t("j_no_legacy_songs_to_attach", {a: Icon.html('party-popper')})}</p>`
                : data.map(r => `<button data-song="${r.song_id}" class="lg-row w-full text-left p-3 bg-gray-900 hover:bg-gray-700 rounded-lg text-sm">
                    <div class="font-semibold truncate">${_esc(r.title)} <span class="text-gray-400 font-normal">— ${_esc(r.artist || '—')}</span></div>
                    <div class="text-xs text-gray-500">${I18n.t("j_owner_charts", {a: _esc(r.owner_handle || '—'), b: r.chart_count, c: r.is_public ? I18n.t("j_public_4") : I18n.t("j_private_2")})}</div></button>`).join(''));
        box.innerHTML = `
            <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-bold">${I18n.t("j_bulk_attach_links", {a: Icon.html('link')})} <span class="text-sm text-gray-400">${I18n.t("j_songs_left", {a: total})}</span></h3>
                <button id="lg-back" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm">${I18n.t("j_report_management_2")}</button></div>
            <div class="flex gap-2 mb-3"><input id="lg-q" value="${_esc(lg.q)}" placeholder="${I18n.t("j_search_title_artist")}" class="flex-1 p-2 rounded bg-gray-700 border border-gray-600 text-sm">
                <button id="lg-search" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-sm">${I18n.t("j_search")}</button></div>
            <div class="space-y-2 mb-3">${rows}</div>
            <div class="flex items-center justify-between mb-3 text-sm">
                <button id="lg-prev" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 ${lg.offset === 0 ? 'opacity-40' : ''}" ${lg.offset === 0 ? 'disabled' : ''}>${I18n.t("j_previous")}</button>
                <span class="text-gray-400">${total ? `${lg.offset + 1}–${Math.min(lg.offset + 20, total)} / ${total}` : ''}</span>
                <button id="lg-next" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 ${lg.offset + 20 >= total ? 'opacity-40' : ''}" ${lg.offset + 20 >= total ? 'disabled' : ''}>${I18n.t("j_next")}</button></div>
            <div class="p-3 bg-gray-900 rounded-lg text-sm flex items-center justify-between">
                <span>${I18n.t("j_old_audio_files_awaiting_cleanup")} <b>${pending}</b>${I18n.t("j_files")}</span>
                <button id="lg-purge" class="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-xs ${pending ? '' : 'opacity-40'}" ${pending ? '' : 'disabled'}>${I18n.t("j_run_file_deletion")}</button></div>
            <p id="lg-msg" class="text-xs text-gray-400 mt-2"></p>`;
        box.querySelector('#lg-back').addEventListener('click', () => this.openPanel());
        const search = () => { lg.q = box.querySelector('#lg-q').value; lg.offset = 0; this.openLegacyTool(); };
        box.querySelector('#lg-search').addEventListener('click', search);
        box.querySelector('#lg-q').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
        box.querySelector('#lg-prev').addEventListener('click', () => { lg.offset = Math.max(0, lg.offset - 20); this.openLegacyTool(); });
        box.querySelector('#lg-next').addEventListener('click', () => { lg.offset += 20; this.openLegacyTool(); });
        box.querySelectorAll('.lg-row').forEach(b => b.addEventListener('click', () => this._openAttachEditor(data.find(r => r.song_id === b.dataset.song))));
        box.querySelector('#lg-purge').addEventListener('click', async () => {
            if (!confirm(I18n.t("j_this_will_permanently_delete_old", {a: pending}))) return;
            const msg = box.querySelector('#lg-msg');
            const res = await CloudModeration.purgeFiles((ok, fail) => { msg.textContent = I18n.t("j_deleting_done_failed", {a: ok, b: fail}); });
            if (res.error) { msg.textContent = I18n.t("j_failed_2", {a: res.error}); return; }
            alert(I18n.t("j_done_deleted", {a: res.removed, b: res.failed ? I18n.t("j_failed_run_again_to_retry", {a: res.failed}) : ''}));
            this.openLegacyTool();
        });
    },

    // 곡 소유자 본인이 자기 곡을 YouTube 링크 기반으로 전환 (내 곡 목록의 "🔗 YouTube 전환")
    openOwnAttach(mySong, onDone) {
        try { SongPreview.stop(); } catch (e) { /* 무시 */ }
        this._openAttachEditor({
            song_id: mySong.id, title: mySong.title || I18n.t("j_untitled"), artist: mySong.artist,
            owner_handle: I18n.t("j_you_3"), chart_count: mySong.beatmapCount || 0, audio_storage_path: mySong.audio_storage_path || null,
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
                <button id="ae-back" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm flex-shrink-0">${own ? I18n.t("b_close") : I18n.t("j_list")}</button></div>
            <p class="text-xs text-gray-400 mb-3">${I18n.t("j_owner_charts_2", {a: _esc(song.artist || '—'), b: _esc(song.owner_handle || '—'), c: song.chart_count})}</p>
            <div class="flex gap-2 mb-2"><input id="ae-url" placeholder="${I18n.t("b_youtube_link_or_video_id")}" class="flex-1 p-2 rounded bg-gray-700 border border-gray-600 text-sm">
                <button id="ae-check" class="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-sm">${I18n.t("b_verify")}</button></div>
            <p id="ae-status" class="text-xs text-gray-400 mb-2 min-h-[1rem]"></p>
            <div id="ae-player-wrap" class="mb-2" style="width:480px;max-width:100%;aspect-ratio:16/9;background:#000"><div id="ae-player"></div></div>
            <div class="flex items-center gap-2 mb-2 text-sm">
                <label class="text-gray-300">${I18n.t("j_offset_sec")}</label>
                <button data-d="-0.1" class="ae-nudge px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">-0.1</button>
                <input id="ae-off" type="number" step="0.01" min="0" value="0" class="w-24 p-1 rounded bg-gray-700 border border-gray-600 text-center">
                <button data-d="0.1" class="ae-nudge px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">+0.1</button>
                <span class="text-xs text-gray-500">${I18n.t("j_the_point_in_the_video")}</span></div>
            ${own && !hasOrig ? `<p class="text-xs text-gray-400 mb-2">${I18n.t("j_your_own_audio_file_for")} <input id="ae-file" type="file" accept="audio/*" class="text-xs"></p>` : ''}
            <div class="flex flex-wrap gap-2 mb-3 text-sm">
                <button id="ae-play-video" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500">${I18n.t("j_video_from_offset")}</button>
                ${canCompare ? `<button id="ae-play-orig" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500">${I18n.t("j_original_audio")}</button>
                <button id="ae-play-both" class="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500">${I18n.t("j_play_both_sync_check")}</button>` : ''}
                <button id="ae-stop" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600">${I18n.t("j_stop")}</button></div>
            ${own ? `<p class="text-xs text-yellow-300 mb-2">${I18n.t("j_switching_deletes_the_audio_file")}</p>` : ''}
            <p class="text-xs text-gray-500 mb-3">${I18n.t("j_play_both_plays_the_original")} <b>${I18n.t("j_if_the_video_audio_is")}</b> ${I18n.t("j_from_coarse_0_1_s")}</p>
            <p id="ae-msg" class="text-sm text-red-400 mb-2 hidden"></p>
            <div class="flex justify-end"><button id="ae-save" disabled class="px-4 py-2 rounded bg-green-700 hover:bg-green-600 text-sm font-semibold opacity-40">${I18n.t("j_attach_switch")}</button></div>`);
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
            if (!this._lg.audioEl && !hasOrig && !picked) throw new Error(I18n.t("j_select_an_audio_file_to"));
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
            if (songT >= 0) { a.currentTime = songT; a.play().catch(e => setStatus(I18n.t("j_original_audio_playback_failed", {a: e.message}), true)); }
            else { a.currentTime = 0; setTimeout(() => a.play().catch(() => {}), -songT * 1000); } // 영상이 곡 시작 전 지점이면 그만큼 기다렸다가
        };
        const playVideo = () => { const p = this._lg.ytPlayer; if (!p || !state.id) return; p.seekTo(offSec(), true); p.playVideo(); };
        const playOrig = async () => {
            try { const a = await ensureAudio(); a.currentTime = 0; await a.play(); }
            catch (e) { setStatus(I18n.t("j_original_audio_playback_failed", {a: e.message}), true); }
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
            try { await ensureAudio(); } catch (e) { setStatus(I18n.t("j_original_audio_playback_failed", {a: e.message}), true); return; }
            pending.audio = true;
            clearTimeout(pending.timer);
            pending.timer = setTimeout(() => { pending.audio = false; }, 8000); // 영상이 시작 못 하면 대기 해제
            playVideo();
        });

        $('#ae-check').addEventListener('click', async () => {
            const id = this._parseYtId($('#ae-url').value);
            if (!id) { setStatus(I18n.t("j_not_a_valid_youtube_link"), true); return; }
            state.verified = false; state.id = null;
            $('#ae-save').disabled = true; $('#ae-save').classList.add('opacity-40');
            setStatus(I18n.t("j_checking_video"));
            try {
                // ① oEmbed — 404: 없음/비공개, 401/403: 임베드 불가
                let info = null;
                try {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`);
                    if (res.status === 404) throw new Error(I18n.t("j_couldn_t_find_the_video"));
                    if (res.status === 401 || res.status === 403) throw new Error(I18n.t("j_this_video_can_t_be"));
                    if (res.ok) info = await res.json();
                } catch (err) { if (/영상/.test(err.message)) throw err; }
                // ② 모달 안의 (보이는) 플레이어로 길이 취득
                await YouTubeSource._loadApi();
                this._lgCleanup();
                const wrap = $('#ae-player-wrap');
                wrap.innerHTML = '<div id="ae-player"></div>';
                const durationMs = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error(I18n.t("j_couldn_t_load_video_info_2"))), 15000);
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
                            onError: (e) => { clearTimeout(timer); reject(new Error([100, 101, 150].includes(e.data) ? I18n.t("j_video_unavailable_deleted_private_embe") : I18n.t("j_youtube_error", {a: e.data}))); },
                        },
                    });
                });
                state.id = id; state.durationMs = durationMs; state.verified = true;
                const m = Math.floor(durationMs / 60000), s = Math.floor(durationMs / 1000) % 60;
                setStatus(I18n.t("j_length_2", {a: info && info.title ? info.title + ' · ' : '', b: m, c: String(s).padStart(2, '0')}));
                $('#ae-save').disabled = false; $('#ae-save').classList.remove('opacity-40');
            } catch (err) { setStatus(err.message || I18n.t("j_couldn_t_verify_the_video"), true); }
        });

        $('#ae-save').addEventListener('click', async () => {
            if (!state.verified) return;
            if (!confirm(I18n.t("j_switch_to_youtube_with_an", {a: song.title, b: state.id, c: offSec()}))) return;
            const msg = $('#ae-msg'); msg.classList.add('hidden');
            if (own) {
                const r = await CloudCharts.attachYoutubeToMySong(song.song_id, state.id, Math.round(offSec() * 1000), state.durationMs);
                if (r.error) { msg.textContent = I18n.t("j_failed_2", {a: CloudModeration._errMsg(r.error)}); msg.classList.remove('hidden'); return; }
                if (r.purgeFailed) alert(I18n.t("j_the_switch_is_complete_but"));
                this._close();
                if (typeof opts.onDone === 'function') opts.onDone();
                return;
            }
            const res = await CloudModeration.attachYoutube(song.song_id, state.id, Math.round(offSec() * 1000), state.durationMs);
            if (!res.ok) { msg.textContent = I18n.t("j_failed_2", {a: res.error}); msg.classList.remove('hidden'); return; }
            this._lgCleanup();
            this.openLegacyTool(); // 처리된 곡은 목록에서 빠진다 → 다음 곡으로
        });
    },
};