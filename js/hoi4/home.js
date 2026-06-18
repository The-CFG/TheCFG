// ════════════════════════════════════════════════════════
//  home.js — 홈 화면
//  의존: state.js, io-parsers.js, io-zip.js, io-image.js, cloud/auth.js, core/cloud-ui.js
//  _progressShow·_saveCurrentFileToServer·autoSaveToLocal → cloud-ui.js 참조
// ════════════════════════════════════════════════════════

// ── 파일 선택 모달 ───────────────────────────────────────
// filePaths: string[]  — 선택 가능한 전체 파일 경로 목록
// mode: 'download' | 'upload'
// returns: Promise<Set<string> | null>  — null이면 취소
function _showFileSelectModal(filePaths, mode) {
    return new Promise(resolve => {
        const modal   = document.getElementById('file-select-modal');
        const tree    = document.getElementById('fsel-tree');
        const title   = document.getElementById('fsel-title');
        const countEl = document.getElementById('fsel-count');
        const search  = document.getElementById('fsel-search');
        if (!modal || !tree) { resolve(null); return; }

        title.textContent = mode === 'download'
            ? '📦 다운로드할 파일 선택'
            : '📤 업로드할 파일 선택';

        // 체크 상태 관리
        const checked = new Set(filePaths);

        const updateCount = () => {
            countEl.textContent = `${checked.size} / ${filePaths.length}개 선택`;
        };

        // 폴더 트리 렌더링
        const renderTree = (filter = '') => {
            tree.innerHTML = '';
            const lf = filter.toLowerCase();

            // 폴더 → 파일 그룹핑
            const folderMap = {};  // folderPath → [filePath]
            filePaths.forEach(fp => {
                if (lf && !fp.toLowerCase().includes(lf)) return;
                const slash = fp.lastIndexOf('/');
                const folder = slash === -1 ? '' : fp.substring(0, slash);
                if (!folderMap[folder]) folderMap[folder] = [];
                folderMap[folder].push(fp);
            });

            // 폴더 계층 정렬 (루트 → 깊은 순)
            const folders = Object.keys(folderMap).sort((a, b) => {
                if (a === '') return -1;
                if (b === '') return 1;
                return a.localeCompare(b);
            });

            folders.forEach(folder => {
                const files = folderMap[folder].sort();

                // 폴더 헤더 (루트 파일은 헤더 없이 바로)
                if (folder !== '') {
                    // 이 폴더 경로로 시작하는 모든 파일 (직속 + 하위 폴더 재귀 포함)
                    const folderFiles   = filePaths.filter(fp => fp.startsWith(folder + '/'));
                    const folderChecked = folderFiles.length > 0 && folderFiles.every(f => checked.has(f));
                    const folderPartial = !folderChecked && folderFiles.some(f => checked.has(f));
                    const folderRow = document.createElement('div');
                    folderRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 4px 3px;margin-top:6px;border-bottom:1px solid var(--border,#b2bec3);';
                    folderRow.innerHTML = `
                        <input type="checkbox" class="fsel-folder-cb" data-folder="${escapeHtml(folder)}"
                            style="width:14px;height:14px;accent-color:#4a9eff;flex-shrink:0;cursor:pointer;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(folder)}">
                            📁 ${escapeHtml(folder)}
                        </span>
                        <span style="font-size:11px;color:var(--text-muted);">${folderFiles.filter(f => checked.has(f)).length}/${folderFiles.length}</span>
                    `;
                    const cb = folderRow.querySelector('.fsel-folder-cb');
                    cb.checked       = folderChecked;
                    cb.indeterminate = folderPartial;
                    cb.addEventListener('change', () => {
                        // 하위 전체 파일 재귀 토글
                        const allFiles = filePaths.filter(fp => fp.startsWith(folder + '/'));
                        if (cb.checked) allFiles.forEach(f => checked.add(f));
                        else            allFiles.forEach(f => checked.delete(f));
                        renderTree(search.value);
                        updateCount();
                    });
                    tree.appendChild(folderRow);
                }

                // 파일 목록
                files.forEach(fp => {
                    const filename = fp.split('/').pop();
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 4px 3px ' + (folder ? '20px' : '4px') + ';';
                    row.innerHTML = `
                        <input type="checkbox" class="fsel-file-cb" data-path="${escapeHtml(fp)}"
                            style="width:13px;height:13px;accent-color:#4a9eff;flex-shrink:0;cursor:pointer;">
                        <span style="font-size:12px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(fp)}">
                            ${escapeHtml(filename)}
                        </span>
                        <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${_fselFileType(fp)}</span>
                    `;
                    const fileCb = row.querySelector('.fsel-file-cb');
                    fileCb.checked = checked.has(fp);
                    fileCb.addEventListener('change', e => {
                        if (e.target.checked) checked.add(fp);
                        else                  checked.delete(fp);
                        renderTree(search.value);
                        updateCount();
                    });
                    tree.appendChild(row);
                });
            });

            if (tree.innerHTML === '') {
                tree.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px 4px;">검색 결과 없음</p>';
            }
            updateCount();
        };

        search.value = '';
        search.oninput = () => renderTree(search.value);
        renderTree();

        // 전체 선택 / 해제
        document.getElementById('fsel-all').onclick  = () => { filePaths.forEach(f => checked.add(f));    renderTree(search.value); };
        document.getElementById('fsel-none').onclick = () => { checked.clear(); renderTree(search.value); };

        // 확인 / 취소 / 닫기
        const cleanup = (result) => {
            modal.style.display = 'none';
            search.oninput = null;
            resolve(result);
        };
        document.getElementById('fsel-confirm').onclick = () => cleanup(new Set(checked));
        document.getElementById('fsel-cancel').onclick  = () => cleanup(null);

        modal.style.display = 'flex';
    });
}

// 파일 타입 레이블
function _fselFileType(path) {
    if (path.includes('national_focus')) return '🎯 중점';
    if (path.includes('localisation'))   return '🌐 로컬';
    if (path.includes('ideas'))          return '💡 아이디어';
    if (path.includes('decisions'))      return '⚖️ 디시전';
    if (path.includes('characters'))     return '👤 인물';
    if (path.endsWith('.dds') || path.endsWith('.png') ||
        path.endsWith('.tga') || path.endsWith('.bmp')) return '🖼 이미지';
    if (path.endsWith('.gfx'))  return '🎨 GFX';
    if (path.endsWith('.gui'))  return '🖥 GUI';
    return '📄 파일';
}


// ── 홈 화면 진입 ─────────────────────────────────────────
function showHomeView() {
    appState.project      = { name: '', files: {} };
    appState.currentFile  = null;
    appState.sharedProject = null;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    switchView('home-view');
    renderRecentList();
}

// ── 최근 목록 렌더링 (클라우드 전용) ────────────────────
async function renderRecentList() {
    const el = document.getElementById('recent-list');
    if (!el) return;

    const user = await CloudAuth.getUser();

    if (!user) {
        el.innerHTML = '<p class="home-empty">🔒 로그인하면 프로젝트 목록이 표시됩니다.</p>';
        document.getElementById('btn-all-projects').style.display = 'none';
        _renderInviteBanner(null);
        _renderSharedProjectsList(null);
        return;
    }

    el.innerHTML = '<p class="home-empty" style="color:var(--text-muted)">☁️ 불러오는 중...</p>';

    let projects = [];
    try {
        projects = await CloudAuth.listProjects();
    } catch (e) {
        el.innerHTML = '<p class="home-empty" style="color:#e07070;">⚠ 서버 연결 실패. 잠시 후 다시 시도해주세요.</p>';
        console.error('프로젝트 목록 조회 실패:', e);
        return;
    }

    if (!projects.length) {
        el.innerHTML = '<p class="home-empty">저장된 프로젝트가 없습니다. 새 프로젝트를 만들어보세요.</p>';
        document.getElementById('btn-all-projects').style.display = 'none';
    } else {
        // 최근 4개만 표시
        const recent = projects.slice(0, 4);
        el.innerHTML = '';
        for (const p of recent) {
            el.appendChild(_makeProjectItem(p, () => renderRecentList()));
        }

        // 5개 이상이면 '모든 프로젝트' 버튼 표시
        const allBtn = document.getElementById('btn-all-projects');
        if (projects.length > 4) {
            allBtn.style.display = '';
            allBtn.textContent = `모든 프로젝트 (${projects.length}개) →`;
        } else {
            allBtn.style.display = 'none';
        }
    }

    // 초대 배너 + 공유 프로젝트 병렬 로드
    _renderInviteBanner('loading');
    _renderSharedProjectsList('loading');

    const [invites, shared] = await Promise.allSettled([
        CloudAuth.listReceivedInvites(),
        CloudAuth.listSharedProjects(),
    ]);

    _renderInviteBanner(invites.status === 'fulfilled' ? invites.value : []);
    _renderSharedProjectsList(shared.status === 'fulfilled' ? shared.value : []);
}

// ── 초대 알림 배너 렌더링 ────────────────────────────────
function _renderInviteBanner(invites) {
    let banner = document.getElementById('invite-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'invite-banner';
        // home-view 맨 위에 삽입
        const homeView = document.getElementById('home-view');
        if (homeView) homeView.prepend(banner);
    }

    if (!invites || invites === 'loading') {
        banner.style.display = 'none';
        return;
    }
    if (!invites.length) {
        banner.style.display = 'none';
        return;
    }

    banner.style.cssText = `
        display:flex;align-items:center;gap:10px;
        background:var(--accent,#4a9eff22);
        border:1px solid var(--accent,#4a9eff);
        border-radius:8px;padding:10px 14px;margin-bottom:16px;
        font-size:13px;color:var(--text);
    `;
    banner.innerHTML = `
        <span style="flex:1">📬 <b>${invites.length}개</b>의 프로젝트 초대가 있습니다</span>
        <button id="btn-invite-check" style="
            background:var(--accent,#4a9eff);color:#fff;border:none;
            border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px;
        ">확인</button>
    `;
    banner.querySelector('#btn-invite-check').addEventListener('click', () => {
        openInvitesModal(invites);
    });
}

// ── 공유받은 프로젝트 목록 렌더링 ───────────────────────
function _renderSharedProjectsList(shared) {
    let section = document.getElementById('shared-projects-section');

    if (!shared || shared === 'loading' || (Array.isArray(shared) && !shared.length)) {
        if (section) section.style.display = 'none';
        return;
    }

    if (!section) {
        section = document.createElement('div');
        section.id = 'shared-projects-section';
        // home-auth-row 바로 앞에 삽입 (카드 내부)
        const authRow = document.getElementById('home-auth-row');
        if (authRow?.parentNode) {
            authRow.parentNode.insertBefore(section, authRow);
        } else {
            document.querySelector('.home-card')?.appendChild(section);
        }
    }

    section.style.display = '';
    section.innerHTML = '<hr class="home-divider"><div class="home-section-label">공유받은 프로젝트</div><div id="shared-list"></div>';
    const listEl = section.querySelector('#shared-list');

    for (const p of shared) {
        listEl.appendChild(_makeSharedProjectItem(p));
    }
}

// ── 공유 프로젝트 아이템 생성 ────────────────────────────
function _makeSharedProjectItem(p) {
    const item = document.createElement('div');
    item.className = 'recent-item clickable';

    const roleLabel = p.role === 'editor' ? '✏️ 편집자' : '👁 뷰어';
    const roleColor = p.role === 'editor' ? '#4a9eff' : '#888';
    const ownerName = p.owner_nickname || p.owner_id.slice(0, 8);
    const dateStr   = p.updated_at ? new Date(p.updated_at).toLocaleDateString('ko-KR') : '';

    item.title = `"${p.project_name}" 열기`;
    item.innerHTML = `
        <div class="recent-item-icon">📁</div>
        <div class="recent-item-body">
            <div class="recent-name">${escapeHtml(p.project_name)}</div>
            <div class="recent-meta" style="color:${roleColor};">${roleLabel} · <span style="color:var(--text-muted);">by ${escapeHtml(ownerName)}</span></div>
        </div>
    `;
    item.addEventListener('click', () => {
        _closeAllProjectsDrawer();
        _openSharedProject(p);
    });
    return item;
}

// ── 공유 프로젝트 열기 ───────────────────────────────────
async function _openSharedProject(p) {
    _progressShow(`"${p.project_name}" 불러오는 중...`, '☁️');
    _progressUpdate(10, '파일 목록 조회 중...');

    try {
        const rows = await CloudAuth.loadSharedProject(p.owner_id, p.project_name);
        if (!rows || !rows.length) {
            _progressHide();
            alert('공유 프로젝트 데이터를 불러올 수 없습니다.');
            return;
        }

        // stub 파일 목록으로 변환 (storage_path 보존)
        const files = {};
        for (const row of rows) {
            files[row.file_path] = {
                type: row.file_type,
                _stub: true,
                ...(row.storage_path ? { storage_path: row.storage_path } : {})
            };
        }

        _progressUpdate(100, '완료!');
        _progressHide();

        appState.project      = { name: p.project_name, files };
        appState.currentFile  = null;
        appState.isDirty      = false;
        appState.sharedProject = { ownerUserId: p.owner_id, myRole: p.role };
        invalidateLocCache();
        invalidateGfxSpriteCache();
        resetHistory();
        switchView('explorer-view');
        renderExplorer();
    } catch (e) {
        _progressHide();
        alert('공유 프로젝트 열기 실패: ' + e.message);
    }
}

// ── 초대 목록 모달 ───────────────────────────────────────
function openInvitesModal(invites) {
    document.getElementById('invites-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'invites-modal';
    modal.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.7);
        z-index:9000;display:flex;align-items:center;justify-content:center;
    `;

    const renderItems = (list) => list.map(inv => {
        const ownerName = inv.owner_nickname || inv.owner_id.slice(0, 8);
        const roleLabel = inv.role === 'editor' ? '✏️ 편집자' : '👁 뷰어';
        const roleColor = inv.role === 'editor' ? '#4a9eff' : '#888';
        const dateStr   = new Date(inv.created_at).toLocaleDateString('ko-KR');
        return `
            <div class="invite-item" data-id="${inv.id}" style="
                display:flex;align-items:center;gap:10px;
                padding:10px;border-radius:8px;
                background:var(--bg-input,#2c3235);margin-bottom:8px;
            ">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:var(--text);">
                        📁 ${escapeHtml(inv.project_name)}
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                        ${escapeHtml(ownerName)} · <span style="color:${roleColor}">${roleLabel}</span> · ${dateStr}
                    </div>
                </div>
                <button class="inv-accept" data-id="${inv.id}" style="
                    background:#2ecc71;color:#fff;border:none;border-radius:6px;
                    padding:5px 10px;cursor:pointer;font-size:12px;white-space:nowrap;
                ">✅ 수락</button>
                <button class="inv-decline" data-id="${inv.id}" style="
                    background:var(--bg-panel);color:var(--text-muted);border:1px solid var(--border);
                    border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;white-space:nowrap;
                ">❌ 거절</button>
            </div>
        `;
    }).join('');

    modal.innerHTML = `
        <div style="
            background:var(--bg-panel,#3d4548);border-radius:12px;
            width:min(460px,92vw);max-height:80vh;display:flex;flex-direction:column;
            border:1px solid var(--border);overflow:hidden;
        ">
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:16px 18px;border-bottom:1px solid var(--border);">
                <span style="font-weight:700;font-size:15px;">📬 프로젝트 초대</span>
                <button id="invites-modal-close" style="
                    background:none;border:none;color:var(--text-muted);
                    font-size:18px;cursor:pointer;
                ">✕</button>
            </div>
            <div id="invites-modal-list" style="padding:14px 16px;overflow-y:auto;flex:1;">
                ${invites.length ? renderItems(invites) : '<p style="color:var(--text-muted);text-align:center;padding:20px;">초대가 없습니다.</p>'}
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#invites-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // 수락 / 거절 버튼
    modal.querySelectorAll('.inv-accept').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            btn.disabled = true; btn.textContent = '처리 중...';
            try {
                await CloudAuth.acceptInvite(id);
                btn.closest('.invite-item').remove();
                await renderRecentList();
                if (!modal.querySelector('.invite-item')) closeModal();
            } catch (e) {
                alert('수락 실패: ' + e.message);
                btn.disabled = false; btn.textContent = '✅ 수락';
            }
        });
    });
    modal.querySelectorAll('.inv-decline').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            btn.disabled = true; btn.textContent = '처리 중...';
            try {
                await CloudAuth.declineInvite(id);
                btn.closest('.invite-item').remove();
                if (!modal.querySelector('.invite-item')) closeModal();
            } catch (e) {
                alert('거절 실패: ' + e.message);
                btn.disabled = false; btn.textContent = '❌ 거절';
            }
        });
    });
}

// ── 프로젝트 아이템 엘리먼트 생성 (공통) ────────────────
function _makeProjectItem(p, onDelete) {
    const item = document.createElement('div');
    item.className = 'recent-item clickable';
    item.title = `"${p.name}" 불러오기`;
    const dateStr = new Date(p.updated_at).toLocaleDateString('ko-KR');
    item.innerHTML = `
        <div class="recent-item-icon">📁</div>
        <div class="recent-item-body">
            <div class="recent-name">${escapeHtml(p.name)}</div>
            <div class="recent-meta">${dateStr} · ☁️</div>
        </div>
        <button class="recent-delete-btn" title="프로젝트 삭제">🗑</button>
    `;
    item.addEventListener('click', e => {
        if (e.target.classList.contains('recent-delete-btn')) return;
        _closeAllProjectsDrawer();
        _openCloudProject(p.name);
    });
    item.querySelector('.recent-delete-btn').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`"${p.name}" 프로젝트를 서버에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        item.style.opacity = '0.4';
        try {
            await CloudAuth.deleteProject(p.name);
            if (onDelete) onDelete();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
            item.style.opacity = '1';
        }
    });
    return item;
}

// ── 모든 프로젝트 드로어 열기/닫기 ─────────────────────
async function _openAllProjectsDrawer() {
    const drawer   = document.getElementById('all-projects-drawer');
    const backdrop = document.getElementById('all-projects-backdrop');
    const listEl   = document.getElementById('all-projects-list');
    if (!drawer) return;

    listEl.innerHTML = '<p class="home-empty" style="color:var(--text-muted);padding:12px 8px;">☁️ 불러오는 중...</p>';
    backdrop.style.display = 'block';
    requestAnimationFrame(() => {
        drawer.classList.add('open');
        backdrop.classList.add('open');
    });

    let projects = [];
    try {
        projects = await CloudAuth.listProjects();
    } catch (e) {
        listEl.innerHTML = '<p class="home-empty" style="color:#e07070;padding:8px;">⚠ 불러오기 실패</p>';
        return;
    }

    listEl.innerHTML = '';
    if (!projects.length) {
        listEl.innerHTML = '<p class="home-empty" style="padding:8px;">저장된 프로젝트가 없습니다.</p>';
        return;
    }
    for (const p of projects) {
        listEl.appendChild(_makeProjectItem(p, () => {
            _openAllProjectsDrawer();
            renderRecentList();
        }));
    }
}

function _closeAllProjectsDrawer() {
    const drawer   = document.getElementById('all-projects-drawer');
    const backdrop = document.getElementById('all-projects-backdrop');
    if (!drawer) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => { backdrop.style.display = 'none'; }, 280);
}

// ── 클라우드에서 프로젝트 열기 (목록만 로드 → 지연 로딩) ─
async function _openCloudProject(name) {
    _progressShow(`"${name}" 목록 불러오는 중...`, '☁️');
    _progressUpdate(10, '파일 목록 조회 중...');

    let proj;
    try {
        proj = await CloudAuth.loadProjectMeta(name);
    } catch (e) {
        _progressHide();
        alert(`불러오기 실패: ${e.message}`);
        renderRecentList();
        return;
    }

    _progressUpdate(100, '완료!');
    _progressHide();

    if (!proj) {
        alert(`"${name}" 데이터를 불러올 수 없습니다.`);
        renderRecentList();
        return;
    }

    appState.project     = proj;
    appState.currentFile = null;
    appState.isDirty     = false;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    resetHistory();
    switchView('explorer-view');
    renderExplorer();
}

// ── 새 프로젝트 ──────────────────────────────────────────
async function createNewProject() {
    const nameEl = document.getElementById('new-project-name');
    const name   = nameEl?.value.trim();
    if (!name) { alert('프로젝트(모드) 이름을 입력해주세요.'); return; }

    const user = await CloudAuth.getUser();
    if (!user) { alert('프로젝트를 만들려면 먼저 로그인해주세요.'); return; }

    // descriptor.mod 템플릿 자동 생성
    const descriptorContent =
`version="1.0.*"
tags={
\t"Alternative History"
}
name="${name}"
supported_version="1.16.*"
`;

    const proj = {
        name,
        files: {
            'descriptor.mod': { type: 'raw_text', raw: descriptorContent }
        }
    };
    appState.project     = proj;
    appState.currentFile = null;
    appState.isDirty     = false;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    resetHistory();

    // 서버에 메타 + descriptor.mod 즉시 생성
    try {
        await CloudAuth._saveProjectMeta(user.id, name);
        await CloudAuth.saveOneFile(name, 'descriptor.mod', proj.files['descriptor.mod']);
    } catch (e) {
        console.warn('서버 초기 저장 실패:', e);
    }

    if (nameEl) nameEl.value = '';
    switchView('explorer-view');
    renderExplorer();
}

// ── 프로젝트 불러오기 (ZIP) ──────────────────────────────
async function loadProjectFile(file) {
    const user = await CloudAuth.getUser();
    if (!user) { alert('ZIP을 불러오려면 먼저 로그인해주세요.'); return; }

    if (!file.name.endsWith('.zip')) {
        alert('ZIP 파일만 불러올 수 있습니다.');
        return;
    }

    try {
        _progressShow('ZIP 파일 불러오는 중...', '📦');
        _progressUpdate(2, 'ZIP 압축 해제 준비 중...');
        const proj = await unpackProjectZip(await file.arrayBuffer(), (pct, detail) => {
            _progressUpdate(pct, detail);
        });
        _progressHide();
        if (!proj) { alert('프로젝트를 파싱할 수 없습니다.'); return; }
        await _finalizeProjectLoad(proj);
    } catch (err) {
        _progressHide();
        alert('프로젝트 불러오기 오류:\n' + err.message);
    }
}

// ── 프로젝트 불러오기 (폴더) ─────────────────────────────
async function loadProjectFromFolder(fileList) {
    const user = await CloudAuth.getUser();
    if (!user) { alert('폴더를 불러오려면 먼저 로그인해주세요.'); return; }

    const files = Array.from(fileList);
    if (!files.length) return;

    // 루트 폴더명: 첫 번째 파일의 webkitRelativePath 최상위 디렉터리
    const rootFolder = files[0].webkitRelativePath.split('/')[0];

    try {
        _progressShow('폴더 불러오는 중...', '📂');
        const project = { name: rootFolder, files: {} };
        const total   = files.length;

        for (let idx = 0; idx < total; idx++) {
            const file    = files[idx];
            const relPath = file.webkitRelativePath.replace(rootFolder + '/', '');
            const filename = relPath.split('/').pop().toLowerCase();

            const pct   = 5 + Math.round((idx / total) * 90);
            const short = relPath.length > 45 ? '...' + relPath.slice(-42) : relPath;
            _progressUpdate(pct, short);

            if (idx % 50 === 0) await new Promise(r => setTimeout(r, 0));

            if (filename.endsWith('.dds')) {
                const buf    = await file.arrayBuffer();
                const base64 = _arrayBufferToBase64Io(buf);
                project.files[relPath] = { type: 'dds', base64, filename };
                continue;
            }
            const imgExts = ['.png', '.jpg', '.jpeg', '.bmp', '.tga'];
            if (imgExts.some(e => filename.endsWith(e))) {
                const buf    = await file.arrayBuffer();
                const base64 = _arrayBufferToBase64Io(buf);
                project.files[relPath] = { type: 'image', base64, filename };
                continue;
            }
            if (filename.endsWith('.gfx')) {
                const content = await file.text();
                project.files[relPath] = { type: 'gfx_define', sprites: parseGfxFile(content) };
                continue;
            }
            if (filename.endsWith('.gui')) {
                const content = await file.text();
                project.files[relPath] = { type: 'gui', raw: content };
                continue;
            }

            const content = await file.text();
            const type    = detectFileType(filename, content, relPath);
            if (!type) continue;

            if (type === 'national_focus') {
                const parsed = parseFocusFile(content);
                if (parsed) project.files[relPath] = { type, ...parsed };
            } else if (type === 'localisation') {
                const parsed = parseLocalisationFile(content, filename);
                if (parsed) project.files[relPath] = { type, lang: parsed.lang, data: parsed.data };
            } else {
                project.files[relPath] = { type, raw: content };
            }
        }

        _progressUpdate(97, `${Object.keys(project.files).length}개 파일 파싱 완료`);
        _progressHide();
        await _finalizeProjectLoad(project);
    } catch (err) {
        _progressHide();
        alert('폴더 불러오기 오류:\n' + err.message);
    }
}

// ── 공통 후처리 (파일 선택 모달 → 서버 저장) ────────────
async function _finalizeProjectLoad(proj) {
    const allPaths = Object.keys(proj.files).sort();
    const selected = await _showFileSelectModal(allPaths, 'upload');
    if (!selected) return;
    if (selected.size === 0) { alert('선택된 파일이 없습니다.'); return; }

    const filteredFiles = {};
    selected.forEach(p => { if (proj.files[p]) filteredFiles[p] = proj.files[p]; });
    proj = { ...proj, files: filteredFiles };

    appState.project     = proj;
    appState.currentFile = null;
    appState.isDirty     = true;
    resetHistory();

    try {
        _progressShow(`"${proj.name}" 서버에 업로드 중...`, '📤');
        await CloudAuth.saveProject(proj.name, (pct, detail) => {
            _progressUpdate(pct, detail);
        });
        _progressHide();
        appState.isDirty = false;
    } catch (e) {
        _progressHide();
        console.warn('서버 저장 실패:', e);
    }

    switchView('explorer-view');
    renderExplorer();
    alert(`"${proj.name}" 불러오기 완료 (${selected.size}개 파일)`);
}
// ── 프로젝트 ZIP 내보내기 + 서버 동기화 ─────────────────
async function saveProjectZip() {
    if (!appState.project.name) { alert('먼저 프로젝트를 만들거나 불러와주세요.'); return; }

    try {
        // ── 1. stub 파일 서버에서 로드 ───────────────────
        const stubPaths = Object.entries(appState.project.files)
            .filter(([, fd]) => fd?._stub === true)
            .map(([p]) => p);

        if (stubPaths.length > 0) {
            const user = await CloudAuth.getUser().catch(() => null);
            if (!user) {
                alert('서버에 저장된 파일이 있지만 로그인 상태가 아닙니다.\n로그인 후 다시 시도해주세요.');
                return;
            }
            _progressShow(`파일 불러오는 중... (0 / ${stubPaths.length})`, '☁️');
            for (let i = 0; i < stubPaths.length; i++) {
                const fp = stubPaths[i];
                _progressUpdate(
                    Math.round((i / stubPaths.length) * 80),
                    `${fp.split('/').pop()} (${i + 1} / ${stubPaths.length})`
                );
                try {
                    const sp = appState.sharedProject;
                    const fd = sp
                        ? await CloudAuth.fetchSharedFile(sp.ownerUserId, appState.project.name, fp, appState.project.files[fp].type)
                        : await CloudAuth.fetchFile(appState.project.name, fp, appState.project.files[fp].type);
                    if (fd) appState.project.files[fp] = fd;
                } catch (e) {
                    console.warn(`stub 로드 실패 (${fp}):`, e);
                }
            }
            _progressHide();
        }

        // ── 2. 파일 선택 모달 ────────────────────────────
        const allPaths = Object.keys(appState.project.files).sort();
        const selected = await _showFileSelectModal(allPaths, 'download');
        if (!selected) return; // 취소
        if (selected.size === 0) { alert('선택된 파일이 없습니다.'); return; }

        // ── 3. ZIP 패킹 ───────────────────────────────────
        _progressShow('ZIP 생성 중...', '📦');
        _progressUpdate(10, `${selected.size}개 파일 압축 중...`);
        const blob = await packProjectZip(selected);
        _progressHide();

        if (!blob) { alert('JSZip 라이브러리를 불러오지 못했습니다.'); return; }

        // 전체 선택이면 원본 이름, 부분 선택이면 _partial 접미사
        const isPartial = selected.size < allPaths.length;
        const zipName   = isPartial
            ? `${appState.project.name}_partial.zip`
            : `${appState.project.name}.zip`;
        downloadBlob(blob, zipName, 'application/zip');

        // ── 4. 서버 동기화 (로그인 상태, 전체 선택 시만) ─
        if (!isPartial) {
            try {
                const user = await CloudAuth.getUser().catch(() => null);
                if (user) {
                    _progressShow(`"${appState.project.name}" 서버에 저장 중...`, '💾');
                    await CloudAuth.saveProject(appState.project.name, (pct, detail) => {
                        _progressUpdate(pct, detail);
                    });
                    _progressHide();
                    appState.isDirty = false;
                }
            } catch (e) {
                _progressHide();
                console.warn('서버 동기화 실패:', e);
            }
        }

    } catch (err) {
        _progressHide();
        alert('저장 중 오류가 발생했습니다:\n' + err.message);
    }
}

// ── 단일 파일 서버 저장 (Ctrl+S / 편집기 버튼 공용) ─────
function setupHomeListeners() {
    document.getElementById('btn-create-project')
        ?.addEventListener('click', createNewProject);
    document.getElementById('new-project-name')
        ?.addEventListener('keydown', e => { if (e.key === 'Enter') createNewProject(); });

    const zipLoader = document.getElementById('file-loader-project-zip');
    document.getElementById('btn-open-project-zip')
        ?.addEventListener('click', () => zipLoader?.click());
    zipLoader?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) await loadProjectFile(file);
        e.target.value = '';
    });

    const dirLoader = document.getElementById('file-loader-project-dir');
    document.getElementById('btn-open-project-dir')
        ?.addEventListener('click', () => dirLoader?.click());
    dirLoader?.addEventListener('change', async e => {
        if (e.target.files.length) await loadProjectFromFolder(e.target.files);
        e.target.value = '';
    });

    document.getElementById('btn-all-projects')
        ?.addEventListener('click', _openAllProjectsDrawer);
    document.getElementById('btn-close-all-projects')
        ?.addEventListener('click', _closeAllProjectsDrawer);
    document.getElementById('all-projects-backdrop')
        ?.addEventListener('click', _closeAllProjectsDrawer);
}