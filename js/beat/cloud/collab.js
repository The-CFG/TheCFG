// ════════════════════════════════════════════════════════
//  collab.js — TheBeat 노래(song) 공동 작업 모달 (멤버 관리 + 초대)
//  js/hoi4/cloud/collab.js 포팅본. 차이점:
//   - hoi4는 (ownerUserId, projectName) 복합키였지만 beat는 song_id 하나가 곧 PK
//   - CloudCharts.listSongMembers()가 닉네임까지 이미 붙여서 반환하므로
//     멤버 쪽은 별도 닉네임 조회가 필요 없음 (소유자만 별도 조회)
//  의존: cloud/auth.js, cloud/charts.js, _esc() (online.js)
// ════════════════════════════════════════════════════════

/**
 * openSongCollabModal(songId, songTitle, ownerId, myRole)
 *  - songId    : beat_songs.id
 *  - songTitle : 모달 헤더에 표시할 노래 제목
 *  - ownerId   : 노래 소유자 user_id
 *  - myRole    : 'owner' | 'editor' | 'viewer'
 */
async function openSongCollabModal(songId, songTitle, ownerId, myRole) {
    document.getElementById('collab-modal')?.remove();

    const isOwnerUser = myRole === 'owner';
    const currentUser = await CloudAuth.getUser();

    const modal = document.createElement('div');
    modal.id = 'collab-modal';
    modal.className = 'collab-modal-overlay';
    modal.innerHTML = `
        <div class="collab-dialog">
            <div class="collab-header">
                <span class="collab-title">👥 공동 작업 — ${_esc(songTitle)}</span>
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
    await _renderSongMemberList(modal, songId, ownerId, myRole, currentUser);

    // 초대 섹션 (소유자만)
    if (isOwnerUser) {
        await _renderSongSentInvites(modal, songId);
        _setupSongInviteForm(modal, songId);
    }
}

// ── 멤버 목록 렌더링 ─────────────────────────────────────
async function _renderSongMemberList(modal, songId, ownerId, myRole, currentUser) {
    const listEl = modal.querySelector('#collab-member-list');
    if (!listEl) return;

    let members = [];
    try {
        members = await CloudCharts.listSongMembers(songId);
    } catch (e) {
        listEl.innerHTML = '<p class="collab-empty">멤버 목록을 불러올 수 없습니다.</p>';
        return;
    }

    const isOwnerUser = myRole === 'owner';
    listEl.innerHTML = '';

    // 소유자 행 (beat_song_members엔 소유자 본인 행이 없으므로 따로 만들어 붙인다)
    // _fetchNicknameMap을 항상 호출해 핸들 캐시(CloudAuth.getProfileUrl용)도 함께 채운다.
    const ownerNickMap = await CloudAuth._fetchNicknameMap([ownerId]);
    const ownerNickname = isOwnerUser
        ? (currentUser?.user_metadata?.display_name || ownerNickMap[ownerId] || null)
        : (ownerNickMap[ownerId] || null);

    const ownerCard = _makeSongMemberCard({
        member_id: ownerId,
        role: 'owner',
        nickname: ownerNickname,
        isSelf: isOwnerUser,
        isOwner: true,
        canManage: false,
        songId,
        onUpdate: () => _renderSongMemberList(modal, songId, ownerId, myRole, currentUser),
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
        const card = _makeSongMemberCard({
            member_id: m.member_id,
            role:      m.role,
            nickname:  m.nickname,
            isSelf,
            isOwner:   false,
            canManage,
            songId,
            onUpdate: () => _renderSongMemberList(modal, songId, ownerId, myRole, currentUser),
        });
        listEl.appendChild(card);
    }
}

function _makeSongMemberCard({ member_id, role, nickname, isSelf, isOwner, canManage, songId, onUpdate }) {
    const card = document.createElement('div');
    card.className = 'collab-member-card';

    const displayName = nickname || member_id.slice(0, 8) + '…';
    const nameHtml    = CloudAuth.linkedName(member_id, displayName, _esc);
    const selfLabel   = isSelf ? ' <span class="collab-self-badge">(나)</span>' : '';

    const roleBadge = isOwner
        ? '<span class="collab-role-badge role-owner">👑 소유자</span>'
        : role === 'editor'
            ? '<span class="collab-role-badge role-editor">✏️ 편집자</span>'
            : '<span class="collab-role-badge role-viewer">👁 뷰어</span>';

    card.innerHTML = `
        <div class="collab-member-info">
            <span class="collab-member-name">${nameHtml}${selfLabel}</span>
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
                await CloudCharts.updateMemberRole(songId, member_id, roleSelect.value);
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
                await CloudCharts.removeMember(songId, member_id);
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
            if (!confirm('이 노래의 공동 작업에서 나가시겠습니까?')) return;
            try {
                await CloudCharts.removeMember(songId, member_id);
                document.getElementById('collab-modal')?.remove();
                // 에디터 홈 목록에서 이 노래가 "공유받은 노래" 섹션에 있었다면 새로고침해서 빼준다.
                if (typeof EditorHome !== 'undefined' && typeof EditorHome.renderHome === 'function') {
                    EditorHome.renderHome();
                }
            } catch (e) {
                alert('나가기 실패: ' + e.message);
            }
        });
        actionsEl.appendChild(leaveBtn);
    }

    return card;
}

// ── 보낸 초대 목록 ───────────────────────────────────────
async function _renderSongSentInvites(modal, songId) {
    const el = modal.querySelector('#collab-sent-invites');
    if (!el) return;
    el.innerHTML = '';

    let invites = [];
    try {
        invites = await CloudCharts.listSentInvites(songId);
    } catch { return; }

    const pending = invites.filter(i => i.status === 'pending');
    if (!pending.length) return;

    const title = document.createElement('p');
    title.style.cssText = 'font-size:12px;font-weight:600;color:var(--tb-gray-400);margin-bottom:6px;';
    title.textContent = '대기 중인 초대';
    el.appendChild(title);

    for (const inv of pending) {
        const row = document.createElement('div');
        row.className = 'collab-invite-row';
        const roleLabel = inv.role === 'editor' ? '✏️ 편집자' : '👁 뷰어';
        row.innerHTML = `
            <span class="collab-invite-email">${_esc(inv.invited_email)}</span>
            <span class="collab-role-badge ${inv.role === 'editor' ? 'role-editor' : 'role-viewer'}" style="font-size:11px;">${roleLabel}</span>
            <button class="collab-btn-danger collab-btn-sm inv-cancel" data-id="${inv.id}">취소</button>
        `;
        row.querySelector('.inv-cancel').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                await CloudCharts.cancelInvite(inv.id);
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
function _setupSongInviteForm(modal, songId) {
    const emailInput  = modal.querySelector('#collab-invite-email');
    const roleSelect  = modal.querySelector('#collab-invite-role');
    const inviteBtn   = modal.querySelector('#collab-invite-btn');
    const resultEl    = modal.querySelector('#collab-invite-result');

    if (!inviteBtn) return;

    inviteBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const role  = roleSelect.value;
        if (!email) { _setSongInviteResult(resultEl, '이메일을 입력해주세요.', 'error'); return; }

        inviteBtn.disabled    = true;
        inviteBtn.textContent = '초대 중...';
        _setSongInviteResult(resultEl, '', '');

        try {
            const result = await CloudCharts.inviteToSong(songId, email, role);
            if (result.ok) {
                _setSongInviteResult(resultEl, `✅ ${email}에 초대를 보냈습니다.`, 'success');
                emailInput.value = '';
                await _renderSongSentInvites(modal, songId);
            } else {
                _setSongInviteResult(resultEl, '⚠ ' + result.error, 'error');
            }
        } catch (e) {
            _setSongInviteResult(resultEl, '⚠ ' + e.message, 'error');
        } finally {
            inviteBtn.disabled    = false;
            inviteBtn.textContent = '초대';
        }
    });

    emailInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') inviteBtn.click();
    });
}

function _setSongInviteResult(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'error' ? '#f87171' : type === 'success' ? '#4ade80' : 'var(--tb-gray-400)';
}