// ════════════════════════════════════════════════════════
//  collab.js — 공동 작업 모달 (멤버 관리 + 초대)
//  의존: cloud/auth.js, core/state.js
// ════════════════════════════════════════════════════════

/**
 * openCollabModal(ownerUserId, projectName, myRole)
 *  - ownerUserId : 프로젝트 소유자 user_id
 *  - projectName : 프로젝트 이름
 *  - myRole      : 'owner' | 'editor' | 'viewer'
 */
async function openCollabModal(ownerUserId, projectName, myRole) {
    document.getElementById('collab-modal')?.remove();

    const isOwnerUser = myRole === 'owner';
    const currentUser = await CloudAuth.getUser();

    const modal = document.createElement('div');
    modal.id = 'collab-modal';
    modal.className = 'collab-modal-overlay';
    modal.innerHTML = `
        <div class="collab-dialog">
            <div class="collab-header">
                <span class="collab-title">👥 공동 작업 — ${escapeHtml(projectName)}</span>
                <button class="collab-close" title="닫기">✕</button>
            </div>

            <div class="collab-body">
                <!-- 멤버 목록 -->
                <section class="collab-section">
                    <h3 class="collab-section-title">멤버</h3>
                    <div id="collab-member-list" class="collab-member-list">
                        <div class="collab-loading">불러오는 중...</div>
                    </div>
                </section>

                ${isOwnerUser ? `
                <!-- 초대 (소유자만) -->
                <section class="collab-section">
                    <h3 class="collab-section-title">멤버 초대</h3>
                    <div class="collab-invite-form">
                        <input type="email" id="collab-invite-email"
                            class="collab-input" placeholder="초대할 이메일">
                        <select id="collab-invite-role" class="collab-select">
                            <option value="editor">✏️ 편집자</option>
                            <option value="viewer">👁 뷰어</option>
                        </select>
                        <button id="collab-invite-btn" class="collab-btn-primary">초대</button>
                    </div>
                    <div id="collab-invite-result" style="font-size:12px;min-height:18px;margin-top:4px;"></div>
                    <div id="collab-sent-invites" class="collab-sent-invites" style="margin-top:12px;"></div>
                </section>
                ` : ''}
            </div>

            <div class="collab-footer"></div>
        </div>
    `;

    document.body.appendChild(modal);

    // 닫기
    const closeModal = () => modal.remove();
    modal.querySelectorAll('.collab-close').forEach(btn =>
        btn.addEventListener('click', closeModal)
    );
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // 멤버 목록 로드
    await _renderMemberList(modal, ownerUserId, projectName, myRole, currentUser);

    // 초대 섹션 (소유자만)
    if (isOwnerUser) {
        await _renderSentInvites(modal, ownerUserId, projectName);
        _setupInviteForm(modal, ownerUserId, projectName);
    }
}

// ── 멤버 목록 렌더링 ─────────────────────────────────────
async function _renderMemberList(modal, ownerUserId, projectName, myRole, currentUser) {
    const listEl = modal.querySelector('#collab-member-list');
    if (!listEl) return;

    let members = [];
    try {
        members = await CloudAuth.listMembers(ownerUserId, projectName);
    } catch (e) {
        listEl.innerHTML = '<p class="collab-empty">멤버 목록을 불러올 수 없습니다.</p>';
        return;
    }

    // 소유자 카드 먼저 표시 (members 테이블에는 소유자 본인은 없음)
    const isOwnerUser = myRole === 'owner';
    listEl.innerHTML = '';

    // 소유자 행
    const ownerCard = _makeMemberCard({
        member_id: ownerUserId,
        role: 'owner',
        nickname: isOwnerUser
            ? (await CloudAuth.getProfile())?.nickname
            : await CloudAuth.getNicknameByUserId(ownerUserId),
        isSelf: isOwnerUser,
        isOwner: true,
        canManage: false,
        ownerUserId, projectName,
        onUpdate: () => _renderMemberList(modal, ownerUserId, projectName, myRole, currentUser),
    });
    listEl.appendChild(ownerCard);

    if (!members.length) {
        const empty = document.createElement('p');
        empty.className = 'collab-empty';
        empty.textContent = '공유된 멤버가 없습니다.';
        listEl.appendChild(empty);
        return;
    }

    for (const m of members) {
        const isSelf    = currentUser?.id === m.member_id;
        const canManage = isOwnerUser;
        const card = _makeMemberCard({
            member_id: m.member_id,
            role:      m.role,
            nickname:  m.nickname,
            isSelf,
            isOwner:   false,
            canManage,
            ownerUserId, projectName,
            onUpdate: () => _renderMemberList(modal, ownerUserId, projectName, myRole, currentUser),
        });
        listEl.appendChild(card);
    }
}

function _makeMemberCard({ member_id, role, nickname, isSelf, isOwner, canManage, ownerUserId, projectName, onUpdate }) {
    const card = document.createElement('div');
    card.className = 'collab-member-card';

    const displayName = nickname || member_id.slice(0, 8) + '…';
    const selfLabel   = isSelf ? ' <span class="collab-self-badge">(나)</span>' : '';

    const roleBadge = isOwner
        ? '<span class="collab-role-badge role-owner">👑 소유자</span>'
        : role === 'editor'
            ? '<span class="collab-role-badge role-editor">✏️ 편집자</span>'
            : '<span class="collab-role-badge role-viewer">👁 뷰어</span>';

    card.innerHTML = `
        <div class="collab-member-info">
            <span class="collab-member-name">${escapeHtml(displayName)}${selfLabel}</span>
            ${roleBadge}
        </div>
        <div class="collab-member-actions"></div>
    `;

    const actionsEl = card.querySelector('.collab-member-actions');

    if (isOwner) {
        // 소유자는 액션 없음
    } else if (canManage) {
        // 소유자가 멤버 관리
        const roleSelect = document.createElement('select');
        roleSelect.className = 'collab-select collab-select-sm';
        roleSelect.innerHTML = `
            <option value="editor" ${role === 'editor' ? 'selected' : ''}>✏️ 편집자</option>
            <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>👁 뷰어</option>
        `;
        roleSelect.addEventListener('change', async () => {
            try {
                await CloudAuth.updateMemberRole(ownerUserId, projectName, member_id, roleSelect.value);
                onUpdate();
            } catch (e) {
                alert('역할 변경 실패: ' + e.message);
                roleSelect.value = role;
            }
        });
        actionsEl.appendChild(roleSelect);

        const kickBtn = document.createElement('button');
        kickBtn.className = 'collab-btn-danger collab-btn-sm';
        kickBtn.textContent = '강퇴';
        kickBtn.addEventListener('click', async () => {
            if (!confirm(`${displayName}을(를) 강퇴하시겠습니까?`)) return;
            try {
                await CloudAuth.removeMember(ownerUserId, projectName, member_id);
                onUpdate();
            } catch (e) {
                alert('강퇴 실패: ' + e.message);
            }
        });
        actionsEl.appendChild(kickBtn);

    } else if (isSelf && !isOwner) {
        // 본인(멤버)은 나가기만
        const leaveBtn = document.createElement('button');
        leaveBtn.className = 'collab-btn-secondary collab-btn-sm';
        leaveBtn.textContent = '나가기';
        leaveBtn.addEventListener('click', async () => {
            if (!confirm(`"${projectName}" 프로젝트에서 나가시겠습니까?`)) return;
            try {
                await CloudAuth.removeMember(ownerUserId, projectName, member_id);
                document.getElementById('collab-modal')?.remove();
                if (typeof showHomeView === 'function') showHomeView();
            } catch (e) {
                alert('나가기 실패: ' + e.message);
            }
        });
        actionsEl.appendChild(leaveBtn);
    }

    return card;
}

// ── 보낸 초대 목록 ───────────────────────────────────────
async function _renderSentInvites(modal, ownerUserId, projectName) {
    const el = modal.querySelector('#collab-sent-invites');
    if (!el) return;
    el.innerHTML = '';

    let invites = [];
    try {
        invites = await CloudAuth.listSentInvites(ownerUserId, projectName);
    } catch { return; }

    const pending = invites.filter(i => i.status === 'pending');
    if (!pending.length) return;

    const title = document.createElement('p');
    title.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;';
    title.textContent = '대기 중인 초대';
    el.appendChild(title);

    for (const inv of pending) {
        const row = document.createElement('div');
        row.className = 'collab-invite-row';
        const roleLabel = inv.role === 'editor' ? '✏️ 편집자' : '👁 뷰어';
        row.innerHTML = `
            <span class="collab-invite-email">${escapeHtml(inv.invited_email)}</span>
            <span class="collab-role-badge ${inv.role === 'editor' ? 'role-editor' : 'role-viewer'}" style="font-size:11px;">${roleLabel}</span>
            <button class="collab-btn-danger collab-btn-sm inv-cancel" data-id="${inv.id}">취소</button>
        `;
        row.querySelector('.inv-cancel').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                await CloudAuth.cancelInvite(inv.id);
                row.remove();
            } catch (err) {
                alert('초대 취소 실패: ' + err.message);
                btn.disabled = false;
            }
        });
        el.appendChild(row);
    }
}

// ── 초대 폼 설정 ─────────────────────────────────────────
function _setupInviteForm(modal, ownerUserId, projectName) {
    const emailInput  = modal.querySelector('#collab-invite-email');
    const roleSelect  = modal.querySelector('#collab-invite-role');
    const inviteBtn   = modal.querySelector('#collab-invite-btn');
    const resultEl    = modal.querySelector('#collab-invite-result');

    if (!inviteBtn) return;

    inviteBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const role  = roleSelect.value;
        if (!email) { _setInviteResult(resultEl, '이메일을 입력해주세요.', 'error'); return; }

        inviteBtn.disabled    = true;
        inviteBtn.textContent = '초대 중...';
        _setInviteResult(resultEl, '', '');

        try {
            const user = await CloudAuth.getUser();
            const result = await CloudAuth.inviteMember(user.id, projectName, email, role);
            if (result.ok) {
                _setInviteResult(resultEl, `✅ ${email}에 초대를 보냈습니다.`, 'success');
                emailInput.value = '';
                await _renderSentInvites(modal, ownerUserId, projectName);
            } else {
                _setInviteResult(resultEl, '⚠ ' + result.error, 'error');
            }
        } catch (e) {
            _setInviteResult(resultEl, '⚠ ' + e.message, 'error');
        } finally {
            inviteBtn.disabled    = false;
            inviteBtn.textContent = '초대';
        }
    });

    emailInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') inviteBtn.click();
    });
}

function _setInviteResult(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'error' ? '#e07070' : type === 'success' ? '#2ecc71' : 'var(--text-muted)';
}