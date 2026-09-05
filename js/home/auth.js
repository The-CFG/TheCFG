// ════════════════════════════════════════════════
// TheCFG 계정 설정 (/accounts 전용)
// hoi4/beat와 같은 Supabase 프로젝트(URL/KEY)를 사용해 계정을 공유하지만,
// 이 파일은 홈페이지 전용 독립 사본입니다 (다른 페이지의 auth.js와 공유하지 않음).
// ════════════════════════════════════════════════
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
            options: { emailRedirectTo: `${location.origin}/confirmed` }
        });
    },

    async login(email, password) {
        return await _supabase.auth.signInWithPassword({ email, password });
    },

    async logout() {
        await _supabase.auth.signOut();
    },

    // ── 비밀번호 변경 ──────────────────────────────────────
    async updatePassword(newPassword) {
        return await _supabase.auth.updateUser({ password: newPassword });
    },

    // ── 유저 프로필 (닉네임 / 설정) ──────────────────────────
    async getProfile() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('settings, updated_at')
            .eq('user_id', user.id)
            .single();
        if (error) { console.warn('getProfile 오류:', error.message); return null; }
        return data;
    },

    // 본인 닉네임 조회 — auth.users.user_metadata.display_name
    // (Supabase 대시보드 Authentication 탭의 "Display Name" 컬럼과 동일한 값)
    async getNickname() {
        const user = await this.getUser();
        return user?.user_metadata?.display_name || null;
    },

    // 닉네임 저장 — auth.users.user_metadata.display_name에 저장 (merge 방식, 다른 메타데이터는 보존)
    async updateNickname(nickname) {
        const { error } = await _supabase.auth.updateUser({ data: { display_name: nickname } });
        if (error) throw error;
    },

    // ── 아이디 (handle) ────────────────────────────────────
    // 본인 아이디 조회 — user_profiles.handle
    async getHandle() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('handle')
            .eq('user_id', user.id)
            .single();
        if (error) { console.warn('getHandle 오류:', error.message); return null; }
        return data?.handle || null;
    },

    // 아이디 사용 가능 여부 확인 (본인이 이미 쓰는 아이디도 true로 처리)
    async isHandleAvailable(handle) {
        const [{ data, error }, current] = await Promise.all([
            _supabase.rpc('is_handle_available', { p_handle: handle }),
            this.getHandle(),
        ]);
        if (error) throw error;
        if (current && current.toLowerCase() === handle.toLowerCase()) return true;
        return !!data;
    },

    // 본인 아이디 설정/변경 — 최근 변경 후 14일 이내면 서버(set_own_handle RPC)가
    // 'handle_cooldown:N'(N=남은 일수) 형태 에러를 던진다. 호출부(initSettingsUI)가
    // 이 접두사를 파싱해 안내 문구로 바꾼다.
    async setHandle(handle) {
        const { error } = await _supabase.rpc('set_own_handle', { p_handle: handle });
        if (error) throw error;
    },

    // 마지막으로 아이디를 바꾼 시각 — 쿨다운 안내 UI(다음 변경 가능일)에 사용.
    async getHandleChangedAt() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('handle_changed_at')
            .eq('user_id', user.id)
            .single();
        if (error) { console.warn('getHandleChangedAt 오류:', error.message); return null; }
        return data?.handle_changed_at || null;
    },

    // ── 소개(bio) ──────────────────────────────────────────
    // user_profiles.bio — RLS(own_profile 정책)로 본인 행만 직접 update 가능하므로 RPC 불필요.
    async getBio() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('bio')
            .eq('user_id', user.id)
            .single();
        if (error) { console.warn('getBio 오류:', error.message); return null; }
        return data?.bio || null;
    },

    async updateBio(bio) {
        const user = await this.getUser();
        if (!user) throw new Error('로그인 상태가 아닙니다.');
        const { error } = await _supabase
            .from('user_profiles')
            .update({ bio })
            .eq('user_id', user.id);
        if (error) throw error;
    },

    // ── 계정 탈퇴 ──────────────────────────────────────────
    // 주의: Supabase JS 클라이언트는 자기 계정 삭제 API를 제공하지 않으므로,
    // DB에 SECURITY DEFINER로 정의된 RPC 함수 'delete_user'가 있어야 인증 계정까지 완전히 삭제됩니다.
    // (RPC가 없어도 hoi4/beat에 걸쳐 있는 사용자 데이터는 정리하고 로그아웃까지는 진행합니다.)
    async deleteAccount() {
        const user = await this.getUser();
        if (!user) throw new Error('로그인 상태가 아닙니다.');

        // 1) 사용자 데이터 정리 — hoi4(projects/project_files), beat(beat_charts/beat_scores), 프로필
        const cleanupTasks = [
            _supabase.from('project_files').delete().eq('user_id', user.id),
            _supabase.from('projects').delete().eq('user_id', user.id),
            _supabase.from('beat_scores').delete().eq('user_id', user.id),
            _supabase.from('beat_charts').delete().eq('owner_id', user.id),
            _supabase.from('user_profiles').delete().eq('user_id', user.id),
        ];
        for (const task of cleanupTasks) {
            try { await task; } catch (e) { console.warn('계정 데이터 삭제 중 오류:', e.message); }
        }

        // 2) 인증 계정 삭제 (RPC 필요)
        let authDeleted = false;
        try {
            const { error } = await _supabase.rpc('delete_user');
            if (!error) authDeleted = true;
            else console.warn('delete_user RPC 오류:', error.message);
        } catch (e) {
            console.warn('delete_user RPC 호출 실패:', e.message);
        }

        // 3) 로그아웃
        await _supabase.auth.signOut();

        return { authDeleted };
    },
};

// ════════════════════════════════════════════════
// UI 바인딩
// ════════════════════════════════════════════════

function _show(el) { if (el) el.style.display = ''; }
function _hide(el) { if (el) el.style.display = 'none'; }

function _setStatus(el, message, isError = false) {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.classList.toggle('is-ok', !isError);
}

function _updateBioCount() {
    const bioInput = document.getElementById('bio-input');
    const bioCount = document.getElementById('bio-count');
    if (!bioInput || !bioCount) return;
    bioCount.textContent = `${bioInput.value.length}/200`;
}

// set_own_handle RPC와 동일한 쿨다운 기간(스키마 마이그레이션 참고). 안내 문구에만 쓰이고
// 실제 검증은 서버가 하므로, 여기 숫자를 바꿔도 서버 쪽 RPC를 함께 바꾸지 않으면 의미 없다.
const HANDLE_COOLDOWN_DAYS = 14;

// 아이디 패널에 "다음 변경 가능일" 안내를 채운다. 쿨다운 중이 아니면 입력/버튼을
// 그대로 두고 문구만 비운다 — 폼 제출 자체는 항상 열어 두고 실제 판정은 서버(RPC)에
// 맡긴다(여기서 계산한 남은 기간은 사용자 시간대/시계 오차로 서버와 몇 초 어긋날 수 있음).
async function _refreshHandleCooldownNotice() {
    const noticeEl = document.getElementById('handle-cooldown-notice');
    if (!noticeEl) return;
    try {
        const changedAt = await CloudAuth.getHandleChangedAt();
        if (!changedAt) { noticeEl.textContent = ''; return; }
        const nextAllowed = new Date(changedAt);
        nextAllowed.setDate(nextAllowed.getDate() + HANDLE_COOLDOWN_DAYS);
        if (nextAllowed.getTime() <= Date.now()) { noticeEl.textContent = ''; return; }
        const dateStr = `${nextAllowed.getFullYear()}년 ${nextAllowed.getMonth() + 1}월 ${nextAllowed.getDate()}일`;
        noticeEl.textContent = `다음 변경 가능일: ${dateStr}부터`;
    } catch (err) {
        noticeEl.textContent = '';
    }
}

async function _refreshView() {
    const user = await CloudAuth.getUser();

    const authSection    = document.getElementById('auth-section');
    const profileSection = document.getElementById('profile-section');

    if (user) {
        _hide(authSection);
        _show(profileSection);

        const emailEl = document.getElementById('profile-email');
        if (emailEl) emailEl.textContent = user.email;

        const nicknameInput = document.getElementById('nickname-input');
        if (nicknameInput) nicknameInput.value = user.user_metadata?.display_name || '';

        const handleInput = document.getElementById('handle-input');
        if (handleInput) handleInput.value = await CloudAuth.getHandle() || '';
        await _refreshHandleCooldownNotice();

        const bioInput = document.getElementById('bio-input');
        if (bioInput) bioInput.value = await CloudAuth.getBio() || '';
        _updateBioCount();
    } else {
        _show(authSection);
        _hide(profileSection);
    }
}

function _setupAuthForm() {
    const title      = document.getElementById('auth-title');
    const executeBtn = document.getElementById('btn-auth-execute');
    const switchBtn  = document.getElementById('auth-switch');
    const statusEl   = document.getElementById('auth-status');

    switchBtn?.addEventListener('click', () => {
        isSignUpMode = !isSignUpMode;
        if (title)      title.textContent     = isSignUpMode ? '계정 생성' : '로그인';
        if (executeBtn) executeBtn.textContent = isSignUpMode ? '가입하기'  : '로그인';
        if (switchBtn)  switchBtn.textContent  = isSignUpMode
            ? '이미 계정이 있나요? 로그인'
            : '계정이 없으신가요? 회원가입';
        _setStatus(statusEl, '');
    });

    executeBtn?.addEventListener('click', async () => {
        const email = document.getElementById('auth-email')?.value?.trim();
        const pw    = document.getElementById('auth-password')?.value;
        if (!email || !pw) { _setStatus(statusEl, '이메일과 비밀번호를 입력해주세요.', true); return; }

        executeBtn.disabled    = true;
        executeBtn.textContent = '처리 중...';

        try {
            const { data, error } = isSignUpMode
                ? await CloudAuth.signUp(email, pw)
                : await CloudAuth.login(email, pw);

            if (error) throw error;

            if (isSignUpMode && !data?.session) {
                _setStatus(statusEl, '가입 신청 완료! 이메일 인증이 활성화되어 있다면 메일함을 확인해주세요.');
            } else {
                _setStatus(statusEl, '');
                await _refreshView();
            }
        } catch (err) {
            const msg = err?.message || '알 수 없는 오류가 발생했습니다.';
            _setStatus(statusEl, msg.includes('Email not confirmed')
                ? '이메일 인증이 필요합니다. 인증 메일의 링크를 클릭한 뒤 다시 로그인해주세요.'
                : `오류: ${msg}`, true);
        } finally {
            executeBtn.disabled    = false;
            executeBtn.textContent = isSignUpMode ? '가입하기' : '로그인';
        }
    });
}

function _setupProfileSection() {
    const logoutBtn      = document.getElementById('btn-logout');
    const nicknameForm    = document.getElementById('nickname-form');
    const nicknameStatus  = document.getElementById('nickname-status');
    const handleForm      = document.getElementById('handle-form');
    const handleInput     = document.getElementById('handle-input');
    const handleStatus    = document.getElementById('handle-status');
    const bioForm         = document.getElementById('bio-form');
    const bioInput        = document.getElementById('bio-input');
    const bioStatus       = document.getElementById('bio-status');
    const pwForm          = document.getElementById('password-form');
    const pwStatus        = document.getElementById('password-status');
    const deleteBtn       = document.getElementById('btn-delete-account');
    const deleteStatus    = document.getElementById('delete-status');

    logoutBtn?.addEventListener('click', async () => {
        await CloudAuth.logout();
        await _refreshView();
    });

    nicknameForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nickname = document.getElementById('nickname-input')?.value?.trim();
        if (!nickname) { _setStatus(nicknameStatus, '닉네임을 입력해주세요.', true); return; }
        try {
            await CloudAuth.updateNickname(nickname);
            _setStatus(nicknameStatus, '닉네임이 저장되었습니다.');
        } catch (err) {
            _setStatus(nicknameStatus, `오류: ${err.message}`, true);
        }
    });

    const HANDLE_PATTERN = /^[A-Za-z0-9._]{4,10}$/;
    let handleCheckTimer = null;

    handleInput?.addEventListener('input', () => {
        clearTimeout(handleCheckTimer);
        const value = handleInput.value.trim();

        if (!value) { _setStatus(handleStatus, ''); return; }
        if (!HANDLE_PATTERN.test(value)) {
            _setStatus(handleStatus, '4~10자, 영문/숫자/./_ 만 사용할 수 있습니다.', true);
            return;
        }

        _setStatus(handleStatus, '확인 중...');
        handleCheckTimer = setTimeout(async () => {
            try {
                const available = await CloudAuth.isHandleAvailable(value);
                _setStatus(handleStatus, available ? '사용 가능한 아이디입니다.' : '이미 사용 중인 아이디입니다.', !available);
            } catch (err) {
                _setStatus(handleStatus, `오류: ${err.message}`, true);
            }
        }, 400);
    });

    handleForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const value = handleInput?.value?.trim();
        if (!value || !HANDLE_PATTERN.test(value)) {
            _setStatus(handleStatus, '4~10자, 영문/숫자/./_ 만 사용할 수 있습니다.', true);
            return;
        }
        try {
            await CloudAuth.setHandle(value);
            _setStatus(handleStatus, '아이디가 저장되었습니다.');
            await _refreshHandleCooldownNotice();
        } catch (err) {
            if (err.message && err.message.startsWith('handle_cooldown:')) {
                const days = err.message.split(':')[1];
                _setStatus(handleStatus, `아이디는 마지막 변경 후 ${HANDLE_COOLDOWN_DAYS}일이 지나야 다시 바꿀 수 있습니다. (${days}일 남음)`, true);
                return;
            }
            const map = {
                invalid_handle_format: '4~10자, 영문/숫자/./_ 만 사용할 수 있습니다.',
                handle_taken: '이미 사용 중인 아이디입니다.',
                profile_not_found: '프로필 정보를 찾을 수 없습니다.',
            };
            _setStatus(handleStatus, map[err.message] || `오류: ${err.message}`, true);
        }
    });

    bioInput?.addEventListener('input', _updateBioCount);

    bioForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bio = bioInput?.value?.trim() || '';
        if (bio.length > 200) { _setStatus(bioStatus, '소개는 200자 이내로 작성해주세요.', true); return; }
        try {
            await CloudAuth.updateBio(bio);
            _setStatus(bioStatus, '소개가 저장되었습니다.');
        } catch (err) {
            _setStatus(bioStatus, `오류: ${err.message}`, true);
        }
    });

    pwForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw1 = document.getElementById('new-password')?.value;
        const pw2 = document.getElementById('new-password-confirm')?.value;
        if (!pw1 || pw1.length < 6) { _setStatus(pwStatus, '비밀번호는 6자 이상이어야 합니다.', true); return; }
        if (pw1 !== pw2) { _setStatus(pwStatus, '비밀번호가 일치하지 않습니다.', true); return; }
        try {
            const { error } = await CloudAuth.updatePassword(pw1);
            if (error) throw error;
            _setStatus(pwStatus, '비밀번호가 변경되었습니다.');
            pwForm.reset();
        } catch (err) {
            _setStatus(pwStatus, `오류: ${err.message}`, true);
        }
    });

    deleteBtn?.addEventListener('click', async () => {
        if (!confirm('정말로 계정을 삭제하시겠습니까?\nhoi4/beat에 저장된 모든 데이터가 함께 삭제되며 되돌릴 수 없습니다.')) return;
        if (!confirm('마지막 확인입니다. 계정을 영구히 삭제할까요?')) return;

        deleteBtn.disabled = true;
        deleteBtn.textContent = '삭제 중...';
        try {
            const { authDeleted } = await CloudAuth.deleteAccount();
            _setStatus(deleteStatus, authDeleted
                ? '계정이 삭제되었습니다.'
                : '데이터는 삭제되었지만 인증 계정 삭제에는 실패했습니다. 관리자에게 문의해주세요.', !authDeleted);
            await _refreshView();
        } catch (err) {
            _setStatus(deleteStatus, `오류: ${err.message}`, true);
        } finally {
            deleteBtn.disabled = false;
            deleteBtn.textContent = '계정 삭제';
        }
    });
}

_setupAuthForm();
_setupProfileSection();
_refreshView();

// 다른 탭/창에서 로그인 상태가 바뀌어도 화면이 따라가도록 처리
_supabase.auth.onAuthStateChange(() => { _refreshView(); });