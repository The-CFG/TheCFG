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
            options: { emailRedirectTo: `${location.origin}/confirmed` }
        });
    },

    async login(email, password) {
        return await _supabase.auth.signInWithPassword({ email, password });
    },

    // 디스코드 OAuth 로그인 — 리다이렉트 방식이라 이 호출 자체는 곧바로 페이지를 벗어난다.
    // 인증 완료 후 redirectTo로 돌아오면 onAuthStateChange가 세션을 감지해 UI를 갱신한다.
    //
    // Supabase 대시보드의 Redirect URLs 허용 목록에 현재 주소가 등록되어 있지 않으면
    // Supabase가 redirectTo를 무시하고 대시보드에 등록된 Site URL(홈페이지)로 보내버릴 수 있다.
    // 이 경우를 대비해 돌아갈 경로를 localStorage에 남겨두면, 홈페이지의 안전장치 스크립트가
    // 이 값을 읽어 다시 이 페이지로 돌려보내준다.
    async loginWithDiscord() {
        localStorage.setItem('thecfg_oauth_return', location.pathname);
        return await _supabase.auth.signInWithOAuth({
            provider: 'discord',
            options: { redirectTo: location.href }
        });
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

    // ── 볼륨 설정 (계정별 저장) ──────────────────────────────
    // user_profiles.beat_music_volume / beat_sfx_volume 컬럼 사용.
    // HOI4Editor가 쓰는 settings jsonb 컬럼과는 별개 (같은 프로젝트 공유이므로 충돌 방지).
    async getVolumeSettings() {
        const user = await this.getUser();
        if (!user) return null;
        // 계정별 볼륨 저장도 마찬가지 — 한 번도 저장한 적 없는 계정(0 rows)이 정상 케이스라
        // .maybeSingle()로 조용히 null 처리한다.
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('beat_music_volume, beat_sfx_volume')
            .eq('user_id', user.id)
            .maybeSingle();
        if (error) {
            console.warn('getVolumeSettings 오류:', error.message);
            return null;
        }
        if (!data) return null;
        return { musicVolume: data.beat_music_volume, sfxVolume: data.beat_sfx_volume };
    },

    async saveVolumeSettings(musicVolume, sfxVolume) {
        const user = await this.getUser();
        if (!user) return;
        const { error } = await _supabase
            .from('user_profiles')
            .upsert({
                user_id: user.id,
                beat_music_volume: musicVolume,
                beat_sfx_volume: sfxVolume,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
        if (error) console.warn('saveVolumeSettings 오류:', error.message);
    },

    // ── 플레이 탭 설정 + 커스터마이징(스킨/UI테마/폰트) 계정 동기화 (계획 4단계) ──
    // user_profiles.beat_settings(jsonb) 컬럼 하나에 { play, skins, uiTheme, customFonts }
    // 중첩 구조로 묶어서 저장한다. 기존 계정은 이 재구성 이전에 flat 구조(현재
    // PLAY_SETTINGS_KEYS 8개가 최상위 키)로 저장돼 있으므로, 읽을 때 하위 호환 처리한다
    // (_isLegacyFlatPlaySettings). HOI4Editor가 쓰는 settings jsonb 컬럼과는 별개
    // (같은 프로젝트 공유이므로 충돌 방지).
    async _getFullBeatSettings() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('beat_settings')
            .eq('user_id', user.id)
            .maybeSingle();
        if (error) {
            console.warn('_getFullBeatSettings 오류:', error.message);
            return null;
        }
        return data?.beat_settings || null;
    },

    // 신규 구조는 항상 play/skins/uiTheme/customFonts 중 하나 이상을 최상위 키로 가진다.
    // 이 중 아무것도 없으면(=예전 방식으로 저장된 계정) flat play 설정으로 취급한다.
    _isLegacyFlatPlaySettings(raw) {
        if (!raw || typeof raw !== 'object') return false;
        return !('play' in raw) && !('skins' in raw) && !('uiTheme' in raw) && !('customFonts' in raw);
    },

    // beat_settings의 특정 최상위 키(play/skins/uiTheme/customFonts)만 갱신하고 나머지는
    // 그대로 둔다. jsonb 컬럼 전체를 덮어써야 하는 upsert 특성상 read-modify-write로 처리.
    async _patchBeatSettings(key, value) {
        const user = await this.getUser();
        if (!user) return;
        const current = await this._getFullBeatSettings() || {};
        const base = this._isLegacyFlatPlaySettings(current) ? { play: current } : current;
        const next = { ...base, [key]: value };
        const { error } = await _supabase
            .from('user_profiles')
            .upsert({
                user_id: user.id,
                beat_settings: next,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
        if (error) console.warn(`_patchBeatSettings(${key}) 오류:`, error.message);
    },

    async getPlaySettings() {
        const raw = await this._getFullBeatSettings();
        if (!raw) return null;
        return this._isLegacyFlatPlaySettings(raw) ? raw : (raw.play || null);
    },

    async savePlaySettings(settings) {
        await this._patchBeatSettings('play', settings);
    },

    // BeatSkin.state({ activeId, skins: { [id]: { name, settings, images } } }) 전체를 저장.
    async getSkinsSettings() {
        const raw = await this._getFullBeatSettings();
        return (raw && !this._isLegacyFlatPlaySettings(raw)) ? (raw.skins || null) : null;
    },
    async saveSkinsSettings(skinsState) {
        await this._patchBeatSettings('skins', skinsState);
    },

    // BeatTheme 활성 프리셋({ activeId }) — 1-A단계(커스텀 색상 프리셋)는 아직 미구현이라
    // 지금은 activeId(dark/blue/light)만 동기화한다.
    async getUiThemeSettings() {
        const raw = await this._getFullBeatSettings();
        return (raw && !this._isLegacyFlatPlaySettings(raw)) ? (raw.uiTheme || null) : null;
    },
    async saveUiThemeSettings(themeState) {
        await this._patchBeatSettings('uiTheme', themeState);
    },

    // BeatFonts 업로드 폰트 메타데이터 목록([{ id, name, format, storagePath }]).
    async getCustomFonts() {
        const raw = await this._getFullBeatSettings();
        return (raw && !this._isLegacyFlatPlaySettings(raw)) ? (raw.customFonts || null) : null;
    },
    async saveCustomFonts(fontsList) {
        await this._patchBeatSettings('customFonts', fontsList);
    },

    // ── 커스터마이징 파일 스토리지 (beat-files 버킷 재사용) ──────────────────
    // 경로는 항상 `${user.id}/...`로 시작해야 beat_files_owner_* RLS 정책(폴더명 1단계
    // = auth.uid())을 통과한다. 호출부는 user.id를 뺀 상대 경로만 넘긴다.
    // 예: uploadCustomizationFile('skins/s_abc/note-tap.png', file)
    //     -> 실제 경로 `${user.id}/skins/s_abc/note-tap.png`
    async uploadCustomizationFile(relativePath, fileOrBlob) {
        const user = await this.getUser();
        if (!user) return { ok: false, error: '로그인이 필요합니다.' };
        const path = `${user.id}/${relativePath}`;
        const { error } = await _supabase.storage.from('beat-files')
            .upload(path, fileOrBlob, { upsert: true });
        if (error) return { ok: false, error: error.message };
        return { ok: true, path };
    },

    async removeCustomizationFiles(paths) {
        if (!paths || !paths.length) return;
        const { error } = await _supabase.storage.from('beat-files').remove(paths);
        if (error) console.warn('removeCustomizationFiles 오류:', error.message);
    },

    // 다운로드는 저장 시 반환받은 전체 경로(이미 user.id 포함)를 그대로 사용한다.
    async downloadCustomizationFile(fullPath) {
        if (!fullPath) return null;
        const { data, error } = await _supabase.storage.from('beat-files').download(fullPath);
        if (error) {
            console.warn('downloadCustomizationFile 오류:', error.message);
            return null;
        }
        return data; // Blob
    },
};

// ── 계정 아이콘 표시 갱신 ────────────────────────────────────
function _updateAuthStatus(user) {
    if (!user) _closeAccountPopover();
    const icons = document.querySelectorAll('.account-icon-btn');
    icons.forEach(btn => {
        const svg = btn.querySelector('svg');
        if (user) {
            btn.title = `${user.email} (클릭하여 계정 메뉴 열기)`;
            btn.setAttribute('aria-label', '계정 메뉴');
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

// ── 계정 팝오버 ──────────────────────────────────────────
function _closeAccountPopover() {
    document.getElementById('account-popover')?.remove();
    document.removeEventListener('click', _onAccountPopoverOutsideClick, true);
}

function _onAccountPopoverOutsideClick(e) {
    const pop = document.getElementById('account-popover');
    const btn = document.getElementById('account-icon-menu');
    if (!pop) return;
    if (pop.contains(e.target) || btn?.contains(e.target)) return;
    _closeAccountPopover();
}

function _openAccountPopover(user) {
    _closeAccountPopover();

    const wrap = document.getElementById('account-icon-wrap');
    if (!wrap) return;

    const nickname = user.user_metadata?.display_name || '(닉네임 미설정)';

    const pop = document.createElement('div');
    pop.id = 'account-popover';
    pop.className = 'absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 z-50';

    const nickEl = document.createElement('p');
    nickEl.className = 'text-sm font-bold text-white';
    nickEl.textContent = `현재 계정: ${nickname}`;

    const emailEl = document.createElement('p');
    emailEl.className = 'text-xs text-gray-400 mt-0.5';
    emailEl.textContent = user.email || '';

    const hr = document.createElement('hr');
    hr.className = 'border-gray-600 my-2';

    const settingsLink = document.createElement('a');
    settingsLink.href = '/accounts';
    settingsLink.className = 'block px-2 py-1.5 rounded text-sm text-gray-200 hover:bg-gray-700 transition';
    settingsLink.textContent = '계정 설정';

    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.title = 'TheCFG 홈으로';
    homeLink.className = 'block px-2 py-1.5 rounded text-sm text-gray-200 hover:bg-gray-700 transition';
    homeLink.textContent = '홈페이지';

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'block w-full text-left px-2 py-1.5 rounded text-sm text-gray-200 hover:bg-gray-700 transition';
    logoutBtn.textContent = '로그아웃';
    logoutBtn.addEventListener('click', async () => {
        await CloudAuth.logout();
        _closeAccountPopover();
    });

    // 순서: 계정 설정 → 홈페이지 → 로그아웃
    pop.append(nickEl, emailEl, hr, settingsLink, homeLink, logoutBtn);
    wrap.appendChild(pop);

    // 다음 이벤트 루프부터 바깥 클릭 감지 (버튼 클릭 자체와 겹치지 않도록)
    setTimeout(() => document.addEventListener('click', _onAccountPopoverOutsideClick, true), 0);
}

// ── 로그아웃 상태 계정 팝오버 (로그인 / 홈페이지) ──────────────────────
// 원래 헤더에 별도로 있던 "TheCFG 홈으로" 아이콘 버튼을 없애고 계정 아이콘 쪽으로
// 통합한 자리 — 로그인 전에는 팝오버에 로그인 / 홈페이지 순서로 노출한다.
function _openLoggedOutPopover() {
    _closeAccountPopover();

    const wrap = document.getElementById('account-icon-wrap');
    if (!wrap) return;

    const pop = document.createElement('div');
    pop.id = 'account-popover';
    pop.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 z-50';

    const loginBtn = document.createElement('button');
    loginBtn.type = 'button';
    loginBtn.className = 'block w-full text-left px-2 py-1.5 rounded text-sm text-gray-200 hover:bg-gray-700 transition';
    loginBtn.textContent = '로그인';
    loginBtn.addEventListener('click', () => {
        _closeAccountPopover();
        _openLoginModal();
    });

    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.title = 'TheCFG 홈으로';
    homeLink.className = 'block px-2 py-1.5 rounded text-sm text-gray-200 hover:bg-gray-700 transition';
    homeLink.textContent = '홈페이지';

    // 순서: 로그인 → 홈페이지
    pop.append(loginBtn, homeLink);
    wrap.appendChild(pop);

    setTimeout(() => document.addEventListener('click', _onAccountPopoverOutsideClick, true), 0);
}

// 로그인 모달을 "로그인" 모드로 초기화해서 연다 (계정 팝오버의 로그인 항목 /
// 다른 화면에서 로그인을 유도하는 버튼들이 공용으로 사용).
function _openLoginModal() {
    isSignUpMode = false;
    const title      = document.getElementById('auth-title');
    const executeBtn = document.getElementById('btn-auth-execute');
    const switchBtn  = document.getElementById('auth-switch');
    if (title)      title.textContent     = '서버 로그인';
    if (executeBtn) executeBtn.textContent = '로그인';
    if (switchBtn)  switchBtn.textContent  = '계정이 없으신가요? 회원가입';
    _openAuthModal();
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
    const discordBtn = document.getElementById('btn-auth-discord');

    discordBtn?.addEventListener('click', async () => {
        discordBtn.disabled = true;
        try {
            const { error } = await CloudAuth.loginWithDiscord();
            if (error) throw error;
            // 성공 시 Discord로 리다이렉트되므로 이후 로직은 실행되지 않는다.
        } catch (err) {
            console.error('디스코드 로그인 오류:', err);
            alert('디스코드 로그인 오류: ' + (err?.message || '알 수 없는 오류'));
            discordBtn.disabled = false;
        }
    });

    // 계정 아이콘 클릭 — 팝오버 토글. 로그인 상태면 계정 설정/홈페이지/로그아웃,
    // 로그아웃 상태면 로그인/홈페이지 순서로 노출한다.
    accountBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (document.getElementById('account-popover')) {
                _closeAccountPopover();
                return;
            }
            const user = await CloudAuth.getUser();
            if (user) _openAccountPopover(user);
            else _openLoggedOutPopover();
        });
    });

    closeBtn?.addEventListener('click', _closeAuthModal);
    document.getElementById('btn-auth-close-x')?.addEventListener('click', _closeAuthModal);
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

    // 실행 (로그인 / 회원가입) — <form id="auth-form"> submit으로 받는다.
    // 버튼 type="submit"이라 클릭은 물론, 비밀번호 필드에서 엔터 입력해도 여기로 들어온다.
    document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email')?.value?.trim();
        const pw    = document.getElementById('auth-password')?.value;
        if (!email || !pw) { alert('이메일과 비밀번호를 입력해주세요.'); return; }

        executeBtn.disabled    = true;
        executeBtn.innerHTML   = UI.loadingInlineHtml('처리 중...');

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