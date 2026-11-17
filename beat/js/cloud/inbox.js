// ════════════════════════════════════════════════════════════════════════
//  inbox.js — 개인 알림함 (Inbox)
//  헤더에서 없어진 "홈페이지" 아이콘 자리에 신설된 알림함. 현재는 공동 작업
//  초대(beat_song_invites, CloudCharts.listMyInvites 등)만 다루지만, 이후
//  다른 개인 알림 종류가 늘어나도 이 팝오버에 섹션을 추가하는 식으로 확장할 수 있게
//  구조를 분리해 두었다.
//  의존: cloud/auth.js(CloudAuth, _supabase), cloud/charts.js(CloudCharts)
// ════════════════════════════════════════════════════════════════════════

const Inbox = {
    // 내가 받은 pending 공동 작업 초대 목록. 로그인하지 않았거나 오류가 나면
    // 조용히 빈 배열을 반환한다(배지/팝오버 쪽에서 그대로 "알림 없음"으로 처리됨).
    async _fetchInvites() {
        if (typeof CloudCharts === 'undefined' || !CloudCharts.listMyInvites) return [];
        try {
            return await CloudCharts.listMyInvites();
        } catch (err) {
            console.warn('Inbox 초대 목록 조회 오류:', err?.message || err);
            return [];
        }
    },

    // 헤더 아이콘의 빨간 배지를 현재 알림 개수로 갱신
    async refreshBadge() {
        const badge = document.getElementById('inbox-badge');
        if (!badge) return;

        const user = await CloudAuth.getUser();
        if (!user) { badge.classList.add('hidden'); return; }

        const invites = await this._fetchInvites();
        if (invites.length > 0) {
            badge.textContent = invites.length > 9 ? '9+' : String(invites.length);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    },
};

// ── 팝오버 열기/닫기 ─────────────────────────────────────────────────────
function _closeInboxPopover() {
    document.getElementById('inbox-popover')?.remove();
    document.removeEventListener('click', _onInboxPopoverOutsideClick, true);
}

function _onInboxPopoverOutsideClick(e) {
    const pop = document.getElementById('inbox-popover');
    const btn = document.getElementById('inbox-icon-btn');
    if (!pop) return;
    if (pop.contains(e.target) || btn?.contains(e.target)) return;
    _closeInboxPopover();
}

function _inboxEsc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function _inboxEmptyHtml(text) {
    return `<p class="text-xs text-gray-400 text-center py-4">${_inboxEsc(text)}</p>`;
}

// 카드 하나(초대 1건) 렌더링
function _inboxInviteCardHtml(inv) {
    const roleLabel = inv.role === 'editor' ? I18n.t("j_editor_2", {a: Icon.html('pencil')}) : I18n.t("j_viewer_2", {a: Icon.html('eye')});
    const songLabel = inv.song_title ? _inboxEsc(inv.song_title) : I18n.t("j_untitled");
    const artistLabel = inv.song_artist ? `<span class="text-gray-400 font-normal"> — ${_inboxEsc(inv.song_artist)}</span>` : '';
    const ownerLabel = inv.owner_id
        ? CloudAuth.linkedName(inv.owner_id, inv.owner_nickname || `${inv.owner_id.slice(0, 8)}…`, _inboxEsc)
        : I18n.t("j_unknown_2");
    return `
        <div class="bg-gray-700/60 rounded-lg p-3" data-invite-id="${_inboxEsc(inv.id)}">
            <p class="text-sm text-white font-semibold truncate">${Icon.html('handshake')} ${songLabel}${artistLabel}</p>
            <p class="text-xs text-gray-400 mt-0.5">${I18n.t("j_owner_invited_as", {a: ownerLabel, b: roleLabel})}</p>
            <div class="flex gap-2 mt-2">
                <button type="button" class="inbox-accept-btn flex-1 py-1.5 bg-teal-600 hover:bg-teal-500 rounded text-xs font-semibold text-white transition">${I18n.t("j_accept")}</button>
                <button type="button" class="inbox-decline-btn flex-1 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-semibold text-white transition">${I18n.t("j_decline")}</button>
            </div>
        </div>`;
}

// 초대 수락/거절 버튼 공용 처리
async function _handleInviteAction(btn, action) {
    const card = btn.closest('[data-invite-id]');
    const inviteId = card?.dataset.inviteId;
    if (!inviteId) return;

    const body = card.parentElement;
    const isAccept = action === 'accept';
    btn.disabled = true;
    btn.textContent = I18n.t("j_processing");

    try {
        if (isAccept) await CloudCharts.acceptInvite(inviteId);
        else await CloudCharts.declineInvite(inviteId);

        card.remove();
        await Inbox.refreshBadge();
        if (body && !body.querySelector('[data-invite-id]')) {
            body.innerHTML = _inboxEmptyHtml(I18n.t("j_no_new_notifications"));
        }
    } catch (err) {
        alert((isAccept ? I18n.t("j_error_accepting_invite") : I18n.t("j_error_declining_invite")) + (err?.message || I18n.t("j_unknown_error")));
        btn.disabled = false;
        btn.textContent = isAccept ? I18n.t("j_accept") : I18n.t("j_decline");
    }
}

async function _openInboxPopover() {
    _closeInboxPopover();

    const wrap = document.getElementById('inbox-icon-wrap');
    if (!wrap) return;

    const pop = document.createElement('div');
    pop.id = 'inbox-popover';
    pop.className = 'absolute right-0 mt-2 w-80 max-w-[90vw] bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50';
    pop.innerHTML = `
        <div class="px-3 py-2.5 border-b border-gray-700">
            <span class="text-sm font-bold text-white">${I18n.t("j_inbox", {a: Icon.html('inbox')})}</span>
        </div>
        <div id="inbox-list-body" class="max-h-80 overflow-y-auto p-2 space-y-2">
            ${_inboxEmptyHtml(I18n.t("j_loading"))}
        </div>`;
    wrap.appendChild(pop);

    // 다음 이벤트 루프부터 바깥 클릭 감지 (버튼 클릭 자체와 겹치지 않도록)
    setTimeout(() => document.addEventListener('click', _onInboxPopoverOutsideClick, true), 0);

    const body = pop.querySelector('#inbox-list-body');
    if (!body) return;

    const user = await CloudAuth.getUser();
    if (!user) { body.innerHTML = _inboxEmptyHtml(I18n.t("j_log_in_to_see_your")); return; }

    const invites = await Inbox._fetchInvites();
    if (invites.length === 0) { body.innerHTML = _inboxEmptyHtml(I18n.t("j_no_new_notifications")); return; }

    body.innerHTML = invites.map(_inboxInviteCardHtml).join('');
    body.querySelectorAll('.inbox-accept-btn').forEach(btn =>
        btn.addEventListener('click', () => _handleInviteAction(btn, 'accept')));
    body.querySelectorAll('.inbox-decline-btn').forEach(btn =>
        btn.addEventListener('click', () => _handleInviteAction(btn, 'decline')));
}

// ── 초기화 ───────────────────────────────────────────────────────────────
function setupInboxUI() {
    const btn = document.getElementById('inbox-icon-btn');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('inbox-popover') ? _closeInboxPopover() : _openInboxPopover();
    });

    Inbox.refreshBadge();

    // 로그인/로그아웃 시 팝오버는 닫고 배지는 새로 계산
    _supabase.auth.onAuthStateChange(() => {
        _closeInboxPopover();
        Inbox.refreshBadge();
    });
}