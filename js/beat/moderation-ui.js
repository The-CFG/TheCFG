/**
 * ModerationUI — 신고 모달 + 모더레이터 패널
 * 신고는 접수만 되고, 곡은 모더레이터가 직접 "삭제 처리"하기 전까지 그대로 공개 상태다.
 */
const ModerationUI = {
    _overlay: null,

    _close() { if (this._overlay) { this._overlay.remove(); this._overlay = null; } },

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
                <button id="mod-close" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm">닫기</button></div>
            <div class="flex gap-2 mb-3">${tabs}</div>
            <div class="space-y-3">${rows}</div>`;
        box.querySelector('#mod-close').addEventListener('click', () => this._close());
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
};
