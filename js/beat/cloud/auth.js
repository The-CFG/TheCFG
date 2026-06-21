// ── Supabase 클라이언트 (auth.js 로드 시점에 초기화) ───────
// TheCFG 계정 시스템을 공유하기 위해 HOI4Editor와 동일한 프로젝트(URL/KEY)를 사용한다.
// 추후 TheBeat 전용 테이블(차트 저장 등)이 필요해지면 이 클라이언트를 그대로 재사용하면 된다.
const SUPABASE_URL = 'https://uzokrwwzksgunrcdjlug.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6b2tyd3d6a3NndW5yY2RqbHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ3OTMsImV4cCI6MjA5NDA4MDc5M30.WZcxh7bhpILqed15vnBof-E1LXkAEXLdxO2UY43iYJU';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isSignUpMode = false;

const CloudAuth = {
    // ── 기본 인증 ──────────────────────────────────────────
    async getUser() {
        const { data: { user } } = await _supabase.auth.getUser();
        return user;
    },

    async signUp(email, password) {
        return await _supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: undefined }
        });
    },

    async login(email, password) {
        return await _supabase.auth.signInWithPassword({ email, password });
    },

    async logout() {
        await _supabase.auth.signOut();
        _updateAuthStatus(null);
    },

    // ── 닉네임 조회 (리더보드 표시용) ──────────────────────────
    // 여러 userId → nickname 맵 일괄 조회
    // HOI4Editor와 동일한 user_profiles 테이블 / get_nicknames_by_ids RPC(SECURITY DEFINER)를
    // 그대로 사용한다 (RLS 우회, 같은 Supabase 프로젝트를 공유하므로 별도 백엔드 작업 불필요).
    // 반환: { [userId]: nickname | null }
    async _fetchNicknameMap(userIds) {
        const uniqueIds = [...new Set(userIds)];
        if (!uniqueIds.length) return {};
        const { data, error } = await _supabase
            .rpc('get_nicknames_by_ids', { user_ids: uniqueIds });
        if (error) {
            console.warn('_fetchNicknameMap RPC 오류:', error.message);
            return {};
        }
        const map = {};
        for (const row of (data || [])) map[row.user_id] = row.nickname || null;
        return map;
    },
};

// ── 계정 아이콘 표시 갱신 ────────────────────────────────────
function _updateAuthStatus(user) {
    const icons = document.querySelectorAll('.account-icon-btn');
    icons.forEach(btn => {
        const svg = btn.querySelector('svg');
        if (user) {
            btn.title = `${user.email} (클릭하여 로그아웃)`;
            btn.setAttribute('aria-label', `${user.email} - 로그아웃`);
            if (svg) svg.classList.add('text-teal-400');
            if (svg) svg.classList.remove('text-gray-300');
        } else {
            btn.title = '로그인';
            btn.setAttribute('aria-label', '로그인');
            if (svg) svg.classList.remove('text-teal-400');
            if (svg) svg.classList.add('text-gray-300');
        }
    });
}

// ── 모달 열기 / 닫기 헬퍼 ──────────────────────────────────
function _openAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
}
function _closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
}

// ── UI 이벤트 연결 ──────────────────────────────────────────
function setupAuthUI() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    const title      = document.getElementById('auth-title');
    const executeBtn = document.getElementById('btn-auth-execute');
    const switchBtn  = document.getElementById('auth-switch');
    const closeBtn   = document.getElementById('btn-auth-close');
    const accountBtns = document.querySelectorAll('.account-icon-btn');

    // 계정 아이콘 클릭 — 로그인 상태면 로그아웃 확인, 아니면 로그인 모달 열기
    accountBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const user = await CloudAuth.getUser();
            if (user) {
                if (confirm(`${user.email} 에서 로그아웃하시겠습니까?`)) {
                    await CloudAuth.logout();
                }
            } else {
                isSignUpMode = false;
                if (title)      title.textContent     = '서버 로그인';
                if (executeBtn) executeBtn.textContent = '로그인';
                if (switchBtn)  switchBtn.textContent  = '계정이 없으신가요? 회원가입';
                _openAuthModal();
            }
        });
    });

    closeBtn?.addEventListener('click', _closeAuthModal);
    modal.addEventListener('click', e => { if (e.target === modal) _closeAuthModal(); });

    // 로그인 ↔ 회원가입 전환
    switchBtn?.addEventListener('click', () => {
        isSignUpMode = !isSignUpMode;
        if (title)      title.textContent     = isSignUpMode ? '서버 계정 생성' : '서버 로그인';
        if (executeBtn) executeBtn.textContent = isSignUpMode ? '가입하기'       : '로그인';
        if (switchBtn)  switchBtn.textContent  = isSignUpMode
            ? '이미 계정이 있나요? 로그인'
            : '계정이 없으신가요? 회원가입';
    });

    // 실행 (로그인 / 회원가입)
    executeBtn?.addEventListener('click', async () => {
        const email = document.getElementById('auth-email')?.value?.trim();
        const pw    = document.getElementById('auth-password')?.value;
        if (!email || !pw) { alert('이메일과 비밀번호를 입력해주세요.'); return; }

        executeBtn.disabled    = true;
        executeBtn.textContent = '처리 중...';

        try {
            const { data, error } = isSignUpMode
                ? await CloudAuth.signUp(email, pw)
                : await CloudAuth.login(email, pw);

            if (error) throw error;

            if (isSignUpMode) {
                if (data?.session) {
                    _updateAuthStatus(data.session.user);
                    alert('회원가입 및 로그인 완료!');
                    _closeAuthModal();
                } else {
                    alert('가입 신청 완료!\n이메일 인증이 활성화되어 있다면 메일함을 확인해주세요.');
                }
            } else {
                _updateAuthStatus(data.user);
                alert('로그인 완료!');
                _closeAuthModal();
            }
        } catch (err) {
            if (err.message?.includes('Email not confirmed')) {
                alert('이메일 인증이 필요합니다. 인증 메일의 링크를 클릭한 뒤 다시 로그인해주세요.');
            } else {
                alert('인증 오류: ' + err.message);
            }
        } finally {
            executeBtn.disabled    = false;
            executeBtn.textContent = isSignUpMode ? '가입하기' : '로그인';
        }
    });

    // 페이지 로드 시 현재 로그인 상태 반영
    CloudAuth.getUser().then(user => _updateAuthStatus(user));

    // 다른 탭/창에서 로그인 상태가 바뀌어도 아이콘이 따라가도록 처리
    _supabase.auth.onAuthStateChange((_event, session) => {
        _updateAuthStatus(session?.user || null);
    });
}