// ════════════════════════════════════════════════════════
//  settings.js — 앱 환경설정 (테마, 자동 저장 등)
//  의존: 없음 (최초 로드 가능)
// ════════════════════════════════════════════════════════

const APP_SETTINGS_KEY = 'hoi4editor_app_settings';

function _isMobileDevice() {
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

const _defaultAppSettings = {
    theme:            'dark',  // 'dark' | 'light'
    autoSaveInterval: 30,      // 초 단위. 0 = 비활성화
    movepadEnabled:   null,    // null = 기기 자동 감지
};

// ── 로드 / 저장 ─────────────────────────────────────────
function _loadAppSettings() {
    try {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        return raw ? { ..._defaultAppSettings, ...JSON.parse(raw) } : { ..._defaultAppSettings };
    } catch {
        return { ..._defaultAppSettings };
    }
}

function _saveAppSettings(s) {
    try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
}

let _appSettings = _loadAppSettings();

// ── 서버 설정 저장 (디바운스 1초) ───────────────────────
let _saveSettingsTimer = null;
function _debounceSaveSettings() {
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
        if (typeof CloudAuth !== 'undefined') {
            CloudAuth.saveSettings(_appSettings).catch(() => { /* 무시 */ });
        }
    }, 1000);
}

// ── 테마 ────────────────────────────────────────────────
function applyTheme(theme) {
    _appSettings.theme = theme;
    _saveAppSettings(_appSettings);
    _debounceSaveSettings?.();
    document.documentElement.setAttribute('data-theme', theme);
}

// FOUC 방지: DOM 준비 전에 즉시 적용
(function _initTheme() {
    document.documentElement.setAttribute('data-theme', _loadAppSettings().theme);
})();

// ── 자동 저장 관리 ───────────────────────────────────────
let _autoSaveTimer = null;

function startAutoSave() {
    stopAutoSave();
    const sec = _appSettings.autoSaveInterval;
    if (!sec || sec <= 0) return;   // 0이면 비활성화
    _autoSaveTimer = setInterval(() => {
        if (typeof appState !== 'undefined' && appState.project.name) {
            autoSaveToLocal();
        }
    }, sec * 1000);
}

function stopAutoSave() {
    if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
}

function setAutoSaveInterval(sec) {
    _appSettings.autoSaveInterval = sec;
    _saveAppSettings(_appSettings);
    _debounceSaveSettings?.();
    startAutoSave();   // 즉시 새 인터벌로 재시작
    _updateAutoSaveStatus();
}

// 헤더 상태 표시 갱신
function _updateAutoSaveStatus() {
    const el = document.getElementById('autosave-status');
    if (!el) return;
    const sec = _appSettings.autoSaveInterval;
    el.textContent = sec > 0 ? `자동 저장: ${sec}초` : '자동 저장: 꺼짐';
}

// ── 환경설정 모달 ────────────────────────────────────────
const AUTOSAVE_OPTIONS = [
    { label: '꺼짐',   value: 0   },
    { label: '10초',   value: 10  },
    { label: '30초',   value: 30  },
    { label: '1분',    value: 60  },
    { label: '3분',    value: 180 },
    { label: '5분',    value: 300 },
];

function openPreferencesModal() {
    document.getElementById('preferences-modal')?.remove();

    const s = _appSettings;
    const modal = document.createElement('div');
    modal.id = 'preferences-modal';
    modal.innerHTML = `
        <div class="pref-backdrop"></div>
        <div class="pref-dialog" role="dialog" aria-modal="true" aria-label="환경설정">
            <div class="pref-header">
                <span class="pref-title">⚙ 환경설정</span>
                <button class="pref-close" title="닫기" aria-label="닫기">✕</button>
            </div>

            <div class="pref-tabs" role="tablist">
                <button class="pref-tab active" data-tab="general" role="tab">🛠 기타</button>
                <button class="pref-tab" data-tab="account" role="tab">👤 계정</button>
            </div>

            <div class="pref-body">

                <!-- ══ 기타 탭 ══ -->
                <div class="pref-tab-content" data-tab-content="general">

                <!-- 테마 -->
                <section class="pref-section">
                    <h3 class="pref-section-title">🎨 테마</h3>
                    <div class="pref-theme-cards">
                        <label class="pref-theme-card ${s.theme === 'dark' ? 'active' : ''}">
                            <input type="radio" name="pref-theme" value="dark" ${s.theme === 'dark' ? 'checked' : ''} hidden>
                            <div class="pref-theme-preview pref-theme-dark">
                                <div class="ptk-bar"></div>
                                <div class="ptk-content">
                                    <div class="ptk-panel"></div>
                                    <div class="ptk-main"></div>
                                </div>
                            </div>
                            <span class="pref-theme-label">🌙 다크 (기본)</span>
                        </label>
                        <label class="pref-theme-card ${s.theme === 'light' ? 'active' : ''}">
                            <input type="radio" name="pref-theme" value="light" ${s.theme === 'light' ? 'checked' : ''} hidden>
                            <div class="pref-theme-preview pref-theme-light">
                                <div class="ptk-bar"></div>
                                <div class="ptk-content">
                                    <div class="ptk-panel"></div>
                                    <div class="ptk-main"></div>
                                </div>
                            </div>
                            <span class="pref-theme-label">☀️ 라이트</span>
                        </label>
                    </div>
                </section>

                <!-- 자동 저장 -->
                <section class="pref-section">
                    <h3 class="pref-section-title">💾 자동 저장</h3>
                    <p class="pref-desc">편집 중 변경사항을 주기적으로 서버에 저장합니다.</p>
                    <div class="pref-autosave-grid">
                        ${AUTOSAVE_OPTIONS.map(o => `
                            <label class="pref-autosave-btn ${s.autoSaveInterval === o.value ? 'active' : ''}">
                                <input type="radio" name="pref-autosave" value="${o.value}"
                                    ${s.autoSaveInterval === o.value ? 'checked' : ''} hidden>
                                ${o.label}
                            </label>
                        `).join('')}
                    </div>
                    <p class="pref-autosave-note" id="pref-autosave-note">
                        ${s.autoSaveInterval > 0
                            ? `현재: <b>${s.autoSaveInterval}초</b>마다 자동 저장`
                            : '현재: 자동 저장 <b>꺼짐</b>'}
                    </p>
                </section>

                <!-- 무브패드 -->
                <section class="pref-section">
                    <h3 class="pref-section-title">🕹 무브패드</h3>
                    <p class="pref-desc">방향키 패드로 중점을 이동합니다. 모바일에서는 기본 켜짐, PC에서는 기본 꺼짐.</p>
                    <div class="pref-autosave-grid">
                        <label class="pref-autosave-btn ${getMovepadEnabled() ? 'active' : ''}" id="pref-movepad-on">
                            <input type="radio" name="pref-movepad" value="true"  ${getMovepadEnabled()  ? 'checked' : ''} hidden> 켜기
                        </label>
                        <label class="pref-autosave-btn ${!getMovepadEnabled() ? 'active' : ''}" id="pref-movepad-off">
                            <input type="radio" name="pref-movepad" value="false" ${!getMovepadEnabled() ? 'checked' : ''} hidden> 끄기
                        </label>
                    </div>
                </section>

                </div>

                <!-- ══ 계정 탭 ══ -->
                <div class="pref-tab-content" data-tab-content="account" hidden>

                <!-- 계정 정보 -->
                <section class="pref-section">
                    <h3 class="pref-section-title">👤 계정 정보</h3>
                    <p class="pref-account-info" id="pref-account-email">불러오는 중...</p>
                </section>

                <!-- 닉네임 변경 -->
                <section class="pref-section">
                    <h3 class="pref-section-title">✏️ 닉네임 변경</h3>
                    <div class="pref-row">
                        <input type="text" id="pref-nickname-input" class="pref-input" placeholder="닉네임">
                        <button id="pref-btn-nickname-save" class="primary">닉네임 저장</button>
                    </div>
                </section>

                <!-- 비밀번호 변경 -->
                <section class="pref-section">
                    <h3 class="pref-section-title">🔒 비밀번호 변경</h3>
                    <div class="pref-row">
                        <input type="password" id="pref-password-new"     class="pref-input" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password">
                        <input type="password" id="pref-password-confirm" class="pref-input" placeholder="새 비밀번호 확인" autocomplete="new-password">
                        <button id="pref-btn-password-save" class="primary">비밀번호 변경</button>
                    </div>
                </section>

                <!-- 회원 탈퇴 -->
                <section class="pref-section pref-danger-zone">
                    <h3 class="pref-section-title">⚠️ 회원 탈퇴</h3>
                    <p class="pref-desc">탈퇴 시 클라우드에 저장된 프로젝트와 계정 정보가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
                    <button id="pref-btn-delete-account" class="danger">계정 탈퇴</button>
                </section>

                </div>

            </div>
            <div class="pref-footer">
                <button class="pref-btn-close secondary">닫기</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 탭 전환
    modal.querySelectorAll('.pref-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.pref-tab').forEach(t => t.classList.toggle('active', t === tab));
            modal.querySelectorAll('.pref-tab-content').forEach(c =>
                c.hidden = c.dataset.tabContent !== tab.dataset.tab
            );
        });
    });

    // 테마
    modal.querySelectorAll('input[name="pref-theme"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            applyTheme(radio.value);
            modal.querySelectorAll('.pref-theme-card').forEach(c =>
                c.classList.toggle('active', c.querySelector('input').value === radio.value)
            );
        });
    });

    // 자동 저장 간격
    modal.querySelectorAll('input[name="pref-autosave"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            const sec = Number(radio.value);
            setAutoSaveInterval(sec);
            modal.querySelectorAll('.pref-autosave-btn').forEach(b =>
                b.classList.toggle('active', Number(b.querySelector('input').value) === sec)
            );
            const note = modal.querySelector('#pref-autosave-note');
            if (note) note.innerHTML = sec > 0
                ? `현재: <b>${sec}초</b>마다 자동 저장`
                : '현재: 자동 저장 <b>꺼짐</b>';
        });
    });

    // 무브패드
    modal.querySelectorAll('input[name="pref-movepad"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            const enabled = radio.value === 'true';
            setMovepadEnabled(enabled);
            modal.querySelectorAll('.pref-autosave-btn').forEach(b => {
                const inp = b.querySelector('input[name="pref-movepad"]');
                if (inp) b.classList.toggle('active', inp.value === radio.value);
            });
        });
    });

    // 계정 탭 초기화
    _setupAccountTab(modal);

    // 닫기
    const closeModal = () => modal.remove();
    modal.querySelector('.pref-close').addEventListener('click', closeModal);
    modal.querySelector('.pref-btn-close').addEventListener('click', closeModal);
    modal.querySelector('.pref-backdrop').addEventListener('click', closeModal);
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── 계정 탭 ─────────────────────────────────────────────
async function _setupAccountTab(modal) {
    const emailEl    = modal.querySelector('#pref-account-email');
    const nickInput  = modal.querySelector('#pref-nickname-input');
    const nickBtn    = modal.querySelector('#pref-btn-nickname-save');
    const pwNew      = modal.querySelector('#pref-password-new');
    const pwConfirm  = modal.querySelector('#pref-password-confirm');
    const pwBtn      = modal.querySelector('#pref-btn-password-save');
    const delBtn     = modal.querySelector('#pref-btn-delete-account');

    // 로그인 상태 확인 + 정보 표시
    let user = null;
    try {
        user = (typeof CloudAuth !== 'undefined') ? await CloudAuth.getUser() : null;
    } catch { /* 무시 */ }

    if (!user) {
        if (emailEl) emailEl.innerHTML = '서버에 로그인되어 있지 않습니다.<br>우측 상단 동기화 버튼으로 먼저 로그인해주세요.';
        [nickInput, nickBtn, pwNew, pwConfirm, pwBtn, delBtn].forEach(el => { if (el) el.disabled = true; });
        return;
    }

    if (emailEl) emailEl.innerHTML = `이메일: <b>${escapeHtml(user.email || '')}</b>`;

    // 닉네임 user_profiles에서 로드
    try {
        const profile = await CloudAuth.getProfile();
        if (nickInput) nickInput.value = profile?.nickname || '';
    } catch { /* 무시 */ }

    // 닉네임 저장
    nickBtn?.addEventListener('click', async () => {
        const nickname = nickInput.value.trim();
        if (!nickname) { alert('닉네임을 입력해주세요.'); return; }
        nickBtn.disabled = true;
        nickBtn.textContent = '저장 중...';
        try {
            await CloudAuth.updateNickname(nickname);
            alert('닉네임이 변경되었습니다.');
        } catch (err) {
            alert('닉네임 변경 오류: ' + err.message);
        } finally {
            nickBtn.disabled = false;
            nickBtn.textContent = '닉네임 저장';
        }
    });

    // 비밀번호 변경
    pwBtn?.addEventListener('click', async () => {
        const pw1 = pwNew.value;
        const pw2 = pwConfirm.value;
        if (!pw1 || pw1.length < 6) { alert('비밀번호는 6자 이상이어야 합니다.'); return; }
        if (pw1 !== pw2) { alert('비밀번호가 일치하지 않습니다.'); return; }

        pwBtn.disabled = true;
        pwBtn.textContent = '변경 중...';
        try {
            const { error } = await CloudAuth.updatePassword(pw1);
            if (error) throw error;
            alert('비밀번호가 변경되었습니다.');
            pwNew.value = '';
            pwConfirm.value = '';
        } catch (err) {
            alert('비밀번호 변경 오류: ' + err.message);
        } finally {
            pwBtn.disabled = false;
            pwBtn.textContent = '비밀번호 변경';
        }
    });

    // 계정 탈퇴
    delBtn?.addEventListener('click', async () => {
        if (!confirm('정말로 탈퇴하시겠습니까?\n클라우드에 저장된 모든 프로젝트가 삭제되며 되돌릴 수 없습니다.')) return;
        if (!confirm('마지막 확인입니다.\n계속하면 계정이 즉시 삭제 및 로그아웃됩니다.')) return;

        delBtn.disabled = true;
        delBtn.textContent = '처리 중...';
        try {
            const { authDeleted } = await CloudAuth.deleteAccount();
            if (authDeleted) {
                alert('계정이 탈퇴되었습니다.');
            } else {
                alert('클라우드 데이터는 삭제되었고 로그아웃되었습니다.\n(계정 자체 삭제는 서버 설정이 필요하여 관리자에게 문의해주세요.)');
            }
            document.getElementById('preferences-modal')?.remove();
            if (typeof renderRecentList === 'function') renderRecentList();
        } catch (err) {
            alert('탈퇴 처리 오류: ' + err.message);
            delBtn.disabled = false;
            delBtn.textContent = '계정 탈퇴';
        }
    });
}

// ── 무브패드 ON/OFF ─────────────────────────────────────
function getMovepadEnabled() {
    const val = _appSettings.movepadEnabled;
    if (val === null || val === undefined) return _isMobileDevice();
    return val;
}

function setMovepadEnabled(enabled) {
    _appSettings.movepadEnabled = enabled;
    _saveAppSettings(_appSettings);
    _debounceSaveSettings?.();
    if (typeof _applyMovepadVisibility === 'function') _applyMovepadVisibility(enabled);
}

// ── 초기화 ──────────────────────────────────────────────
function setupPreferencesListeners() {
    applyTheme(_appSettings.theme);
    startAutoSave();
    _updateAutoSaveStatus();

    // 로그인 상태이면 서버 설정 불러와 병합
    if (typeof CloudAuth !== 'undefined') {
        CloudAuth.loadSettings().then(serverSettings => {
            if (!serverSettings) return;
            _appSettings = { ..._appSettings, ...serverSettings };
            _saveAppSettings(_appSettings);
            applyTheme(_appSettings.theme);
            startAutoSave();
            _updateAutoSaveStatus();
        }).catch(() => { /* 무시 */ });
    }

    document.addEventListener('click', e => {
        if (e.target.closest('#btn-preferences')) openPreferencesModal();
    });
}