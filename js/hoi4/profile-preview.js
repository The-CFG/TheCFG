// ════════════════════════════════════════════════════════
//  profile-preview.js — 닉네임 클릭 시 뜨는 간단 프로필 오버레이
//  CloudAuth.linkedName()이 만든 <a class="profile-link" data-uid="..."> 클릭을
//  전역에서 위임 처리해서 오버레이를 띄운다. "자세히 보기"는 /profiles?u=핸들로 이동.
//  js/beat/profile-preview.js 포팅본 (독립 사본).
// ════════════════════════════════════════════════════════

const ProfilePreview = {
    _modal: null,
    _seq: 0,

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str ?? '';
        return d.innerHTML;
    },

    _ensureModal() {
        if (this._modal) return this._modal;
        const modal = document.createElement('div');
        modal.id = 'profile-preview-overlay';
        modal.className = 'profile-preview-overlay hidden';
        modal.innerHTML = `
            <div class="profile-preview-dialog">
                <button type="button" class="profile-preview-close" title="닫기" aria-label="닫기">✕</button>
                <div class="profile-preview-body"></div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.profile-preview-close').addEventListener('click', () => this.close());
        modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });
        this._modal = modal;
        return modal;
    },

    close() {
        this._modal?.classList.add('hidden');
    },

    async open(userId) {
        if (!userId) return;
        const seq = ++this._seq;
        const modal = this._ensureModal();
        const body = modal.querySelector('.profile-preview-body');
        body.innerHTML = '<div class="profile-preview-loading">불러오는 중...</div>';
        modal.classList.remove('hidden');

        const header = await CloudAuth.getProfileHeader(userId);
        if (seq !== this._seq || modal.classList.contains('hidden')) return; // 그 사이 닫혔거나 새 요청이 왔으면 무시

        if (!header) {
            body.innerHTML = '<p class="profile-preview-error">프로필을 불러올 수 없습니다.</p>';
            return;
        }

        const initial = (header.nickname || header.handle || '?').trim().charAt(0).toUpperCase();
        const joined = header.created_at ? new Date(header.created_at) : null;
        const joinedStr = joined ? `${joined.getFullYear()}년 ${joined.getMonth() + 1}월 가입` : '';

        body.innerHTML = `
            <div class="profile-preview-avatar">${this._esc(initial)}</div>
            <div class="profile-preview-nickname">${this._esc(header.nickname || '(닉네임 없음)')}</div>
            ${header.handle ? `<div class="profile-preview-handle">@${this._esc(header.handle)}</div>` : ''}
            ${joinedStr ? `<div class="profile-preview-joined">${this._esc(joinedStr)}</div>` : ''}
            ${header.handle
                ? `<a class="profile-preview-detail-btn" href="/profiles?u=${encodeURIComponent(header.handle)}">자세히 보기</a>`
                : '<p class="profile-preview-nohandle">아직 아이디가 설정되지 않았습니다.</p>'}
        `;
    },
};

// 닉네임 클릭 위임 처리 — CloudAuth.linkedName()이 만든 링크는 전부 여기로 모인다.
// 캡처 단계(capture: true)에서 가로채야, 링크를 감싸고 있는 카드/행에 걸려 있는
// 자체 클릭 핸들러(예: 프로젝트 열기)보다 먼저 처리되어 그쪽으로 새어나가지 않는다.
// ctrl/cmd/shift/alt+클릭이나 좌클릭이 아닌 경우엔 브라우저 기본 동작(새 탭 열기 등)을 그대로 둔다.
document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('.profile-link[data-uid]');
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    ProfilePreview.open(link.dataset.uid);
}, true);