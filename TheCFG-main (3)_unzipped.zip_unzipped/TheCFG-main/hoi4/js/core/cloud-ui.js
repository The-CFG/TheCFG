// ════════════════════════════════════════════════════════
//  cloud-ui.js — 저장/진행 공용 UI 유틸
//  editor·gfx-editor·localisation·explorer·main에서 공용 호출
//  의존: state.js, auth.js
// ════════════════════════════════════════════════════════

// ── 프로그레스 모달 ──────────────────────────────────────
function _progressShow(title, icon = '☁️') {
    const modal = document.getElementById('progress-modal');
    if (!modal) return;
    document.getElementById('progress-title').textContent     = title;
    document.getElementById('progress-icon').textContent      = icon;
    document.getElementById('progress-detail').textContent    = '';
    document.getElementById('progress-bar-fill').style.width  = '0%';
    document.getElementById('progress-pct').textContent       = '0%';
    document.getElementById('progress-step-label').textContent = '';
    modal.style.display = 'flex';
}
function _progressUpdate(pct, detail) {
    const fill = document.getElementById('progress-bar-fill');
    if (fill) fill.style.width = pct + '%';
    const pctEl = document.getElementById('progress-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const detailEl = document.getElementById('progress-detail');
    if (detailEl) detailEl.textContent = detail || '';
}
function _progressHide() {
    const modal = document.getElementById('progress-modal');
    if (modal) modal.style.display = 'none';
}

// ── 단일 파일 서버 저장 (Ctrl+S / 편집기 버튼 공용) ─────
async function _saveCurrentFileToServer(filePath, fd) {
    if (!appState.project.name) { alert('프로젝트가 없습니다.'); return; }
    const user = await CloudAuth.getUser();
    if (!user) { alert('로그인이 필요합니다.'); return; }
    const sp = appState.sharedProject;
    if (sp && sp.myRole !== 'editor') { alert('편집자 권한이 없습니다.'); return; }
    const targetUserId = sp ? sp.ownerUserId : null;
    try {
        await CloudAuth.saveOneFile(appState.project.name, filePath, fd, targetUserId);
        appState.isDirty = false;
        _showSaveToast(`저장됨: ${filePath.split('/').pop()}`);
    } catch (e) {
        alert('저장 실패:\n' + e.message);
    }
}

// ── 저장 완료 토스트 ─────────────────────────────────────
function _showSaveToast(msg) {
    let toast = document.getElementById('save-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'save-toast';
        toast.style.cssText = `
            position:fixed;bottom:24px;right:24px;z-index:9999;
            background:var(--accent,#4caf50);color:#fff;
            padding:8px 18px;border-radius:8px;
            font-size:.9rem;box-shadow:0 2px 12px rgba(0,0,0,.3);
            transition:opacity .3s;pointer-events:none;
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = /^[✅🗑⚠]/.test(msg) ? msg : '☁️ ' + msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// ── 자동 저장 (settings.js의 startAutoSave()가 호출) ─────
function autoSaveToLocal() {
    if (!appState.project.name) return;
    if (!appState.isDirty) return;

    const filePath = appState.currentFile;
    const fd       = filePath ? appState.project.files[filePath] : null;

    const _onSuccess = () => {
        appState.isDirty = false;
        const el = document.getElementById('autosave-status');
        if (!el) return;
        const t  = new Date();
        const hm = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
        el.textContent = `자동 저장됨 ${hm}`;
        clearTimeout(el._t);
        el._t = setTimeout(() => {
            if (typeof _updateAutoSaveStatus === 'function') _updateAutoSaveStatus();
        }, 5000);
    };

    const _onError = e => console.warn('자동 저장 실패:', e);

    CloudAuth.getUser().then(user => {
        if (!user) return;
        const sp           = appState.sharedProject;
        if (sp && sp.myRole !== 'editor') return; // 뷰어는 자동 저장 안 함
        const targetUserId = sp ? sp.ownerUserId : null;
        if (filePath && fd) {
            CloudAuth.saveOneFile(appState.project.name, filePath, fd, targetUserId)
                .then(_onSuccess).catch(_onError);
        } else {
            CloudAuth.saveProject(appState.project.name)
                .then(_onSuccess).catch(_onError);
        }
    }).catch(() => {});
}


// ════════════════════════════════════════════════════════
//  editors 공용 UI 렌더러 (io-parsers.js 에서 이동)
//  의존: escapeHtml (io-parsers.js), _saveCurrentFileToServer (cloud-ui.js),
//        _ddsBase64ToDataUrl (io-image.js), appState (state.js)
// ════════════════════════════════════════════════════════

// ── GFX 아이콘 해석 (state.js의 appState 참조) ──────────
function resolveGfxIcon(gfxId) {
    if (!gfxId || gfxId === 'GFX_goal_unknown') return null;
    for (const fd of Object.values(appState.project.files)) {
        if (fd.type !== 'gfx_define') continue;
        const sprite = (fd.sprites || []).find(s => s.name === gfxId);
        if (!sprite) continue;
        const texPath = sprite.texturefile.replace(/\\/g, '/');
        const ddsFile = appState.project.files[texPath];
        if (ddsFile?.base64) return _ddsBase64ToDataUrl(ddsFile.base64);
    }
    return null;
}

// ── RAW ↔ UI 편집기 전환 공통 렌더러 ────────────────────
function _renderRawWithReturn(container, filePath, fd, rawText, onApply, onReturn, onLiveUpdate = null) {
    container.innerHTML = '';
    const filename = filePath.split('/').pop();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;gap:10px;';
    wrap.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:.9rem;color:var(--text-muted);">📝 RAW 편집 — ${escapeHtml(filename)}</span>
            <div style="display:flex;gap:8px;margin-left:auto;">
                <button class="js-raw-return" title="RAW 내용을 파싱해 UI 편집기로 돌아갑니다">⬅ UI 편집기로 돌아가기</button>
                <button class="js-raw-save secondary">☁️ RAW 그대로 저장</button>
                <button class="js-raw-cancel secondary">✕ 변경 취소 (UI로 복귀)</button>
            </div>
        </div>
        <textarea class="js-raw-editor" spellcheck="false" style="
            flex:1;min-height:400px;width:100%;box-sizing:border-box;
            font-family:monospace;font-size:13px;
            background:var(--bg-editor,#1e1e1e);color:var(--text,#d4d4d4);
            border:1px solid var(--border,#444);border-radius:6px;padding:12px;resize:vertical;
        ">${escapeHtml(rawText)}</textarea>
        <div class="js-raw-error" style="
            display:none;color:#f44;background:rgba(255,60,60,.1);
            border:1px solid #f44;border-radius:6px;padding:8px 14px;
            font-size:.88rem;white-space:pre-wrap;
        "></div>
    `;
    container.appendChild(wrap);
    const ta    = wrap.querySelector('.js-raw-editor');
    const errEl = wrap.querySelector('.js-raw-error');

    // 실시간 미리보기 — 디바운스 800ms (타이핑 중 과도한 파싱 방지)
    if (onLiveUpdate) {
        let _debTimer = null;
        ta.addEventListener('input', () => {
            clearTimeout(_debTimer);
            _debTimer = setTimeout(() => onLiveUpdate(ta.value), 800);
        });
    }

    wrap.querySelector('.js-raw-return').addEventListener('click', () => {
        let result;
        try { result = onApply(ta.value); } catch (e) { result = { ok: false, msg: e.message }; }
        if (result?.ok) { errEl.style.display = 'none'; onReturn(); }
        else {
            errEl.style.display = 'block';
            errEl.textContent = '⚠ 파싱에 에러가 발생하여 UI 편집기로 되돌릴 수 없습니다.' +
                (result?.msg ? '\n상세: ' + result.msg : '');
        }
    });
    wrap.querySelector('.js-raw-save').addEventListener('click', () => {
        appState.project.files[filePath] = { ...appState.project.files[filePath], raw: ta.value };
        appState.isDirty = true;
        _saveCurrentFileToServer(filePath, appState.project.files[filePath]);
    });
    wrap.querySelector('.js-raw-cancel').addEventListener('click', () => onReturn());
}