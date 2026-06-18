// ════════════════════════════════════════════════════════
//  explorer.js — 프로젝트 탐색기
//  의존: state.js, io.js, home.js
// ════════════════════════════════════════════════════════

// HOI4 모드 폴더 구조 정의
// parent: 상위 그룹 경로 (표시용, 실제 파일 경로 아님)
const FOLDER_DEFS = [
    // common 그룹
    { path: 'common/national_focus',        label: '국가중점',          type: 'national_focus', ext: '.txt', parent: 'common' },
    { path: 'common/ideas',                 label: '아이디어',          type: 'ideas',          ext: '.txt', parent: 'common' },
    { path: 'common/decisions',             label: '디시전',            type: 'decisions',      ext: '.txt', parent: 'common' },
    { path: 'common/characters',            label: '인물',              type: 'characters',     ext: '.txt', parent: 'common' },
    { path: 'common/bookmarks',             label: '북마크',            type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/countries',             label: '국가 정의',         type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/country_tags',          label: '국가 태그',         type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/dynamic_modifiers',     label: '동적 수정자',       type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/effects',               label: '이펙트',            type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/modifiers',             label: '수정자',            type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/national_focus/shared', label: '공유중점',          type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/on_actions',            label: 'on_actions',       type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/scripted_effects',      label: '스크립트 이펙트',   type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/scripted_triggers',     label: '스크립트 트리거',   type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/technologies',          label: '기술',              type: 'raw_text',       ext: '.txt', parent: 'common' },
    { path: 'common/units',                 label: '부대',              type: 'raw_text',       ext: '.txt', parent: 'common' },
    // history 그룹
    { path: 'history/countries',            label: '국가 역사',         type: 'raw_text',       ext: '.txt', parent: 'history' },
    { path: 'history/states',               label: '지역 역사',         type: 'raw_text',       ext: '.txt', parent: 'history' },
    { path: 'history/units',                label: '부대 역사',         type: 'raw_text',       ext: '.txt', parent: 'history' },
    // events 그룹
    { path: 'events',                       label: '이벤트 파일',       type: 'raw_text',       ext: '.txt', parent: 'events' },
    // music / sound
    { path: 'music',                        label: '음악',              type: 'raw_text',       ext: '.txt', parent: 'music' },
    { path: 'sound',                        label: '사운드',            type: 'raw_text',       ext: '.txt', parent: 'sound' },
    // map
    { path: 'map',                          label: '맵',                type: 'raw_text',       ext: '.txt', parent: 'map' },
    // localisation 그룹
    { path: 'localisation/english',         label: '영어 (English)',       type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/korean',          label: '한국어 (Korean)',      type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/japanese',        label: '일본어 (Japanese)',    type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/german',          label: '독일어 (German)',      type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/french',          label: '프랑스어 (French)',    type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/spanish',         label: '스페인어 (Spanish)',   type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/russian',         label: '러시아어 (Russian)',   type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/polish',          label: '폴란드어 (Polish)',    type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/braz_por',        label: '포르투갈어 (Braz)',    type: 'localisation', ext: '.yml', parent: 'localisation' },
    { path: 'localisation/simp_chinese',    label: '중국어 간체 (S.Chi)', type: 'localisation', ext: '.yml', parent: 'localisation' },
    // gfx 그룹
    { path: 'gfx/flags',           label: 'flags',     type: 'gfx_folder', ext: '.dds', parent: 'gfx' },
    { path: 'gfx/interface',       label: 'interface', type: 'gfx_folder', ext: '.dds', parent: 'gfx' },
    { path: 'gfx/leaders',         label: 'leaders',   type: 'gfx_folder', ext: '.dds', parent: 'gfx' },
    { path: 'gfx/interface/goals', label: 'goals',     type: 'gfx_folder', ext: '.dds', parent: 'gfx' },
    // interface 그룹
    { path: 'interface', label: 'interface', type: 'gfx_define', ext: '.gfx', parent: 'interface' },
];

// 부모 그룹 정의 (표시 전용 — 실제 파일 경로 없음)
const PARENT_DEFS = [
    { key: 'common',       label: 'common',       icon: '📂' },
    { key: 'history',      label: 'history',      icon: '📂' },
    { key: 'events',       label: 'events',       icon: '📂' },
    { key: 'music',        label: 'music',        icon: '📂' },
    { key: 'sound',        label: 'sound',        icon: '📂' },
    { key: 'map',          label: 'map',           icon: '📂' },
    { key: 'localisation', label: 'localisation', icon: '📂' },
    { key: 'gfx',          label: 'gfx',          icon: '📂' },
    { key: 'interface',    label: 'interface',    icon: '📂' },
];

// 현재 펼쳐진 폴더 / 부모 그룹 추적
const _expandedFolders = new Set();
const _expandedParents = new Set(['common', 'localisation', 'history', 'events']); // 기본 펼침

// 사용자가 직접 생성한 폴더 목록 (파일 없어도 트리에 유지)
const _customFolders = new Set();

// ── 탐색기 렌더링 ───────────────────────────────────────
function renderExplorer() {
    const titleEl = document.getElementById('explorer-project-name');
    if (titleEl) titleEl.textContent = (appState.project.name || '새 프로젝트') + (appState.isDirty ? ' *' : '');

    // 뷰어 모드: 저장 버튼 비활성화, 추가/삭제 버튼 숨김
    const saveBtn = document.getElementById('btn-save-project');
    if (saveBtn) {
        if (isReadOnly()) {
            saveBtn.disabled = true;
            saveBtn.title    = '뷰어 권한으로는 저장할 수 없습니다.';
        } else {
            saveBtn.disabled = false;
            saveBtn.title    = '';
        }
    }

    // viewer-mode 클래스 제어 (에디터 입력 일괄 비활성화용)
    document.getElementById('explorer-view')?.classList.toggle('viewer-mode', isReadOnly());

    // 공동작업 버튼 표시 / 텍스트 설정
    const collabBtn = document.getElementById('btn-collab');
    if (collabBtn) {
        if (appState.project.name) {
            collabBtn.style.display = '';
            const sp = appState.sharedProject;
            if (!sp) {
                collabBtn.textContent = '👥 공동 작업';
            } else if (sp.myRole === 'viewer') {
                collabBtn.textContent = '👥 멤버 보기';
            } else {
                collabBtn.textContent = '👥 공동 작업';
            }
            // 이벤트가 중복 등록되지 않도록 교체
            const newBtn = collabBtn.cloneNode(true);
            collabBtn.replaceWith(newBtn);
            newBtn.addEventListener('click', async () => {
                const user = await CloudAuth.getUser();
                if (!user) { alert('공동 작업 기능은 로그인 후 사용할 수 있습니다.'); return; }
                const sp2 = appState.sharedProject;
                const ownerUserId = sp2 ? sp2.ownerUserId : user.id;
                const myRole      = sp2 ? sp2.myRole      : 'owner';
                openCollabModal(ownerUserId, appState.project.name, myRole);
            });
        } else {
            collabBtn.style.display = 'none';
        }
    }

    const tree = document.getElementById('explorer-tree');
    if (!tree) return;
    tree.innerHTML = '';

    // ── 최상위 생성/업로드 버튼 바 ──────────────────────
    const topBar = document.createElement('div');
    topBar.className = 'explorer-top-actions';
    topBar.innerHTML = `
        <button class="tree-btn explorer-root-btn" data-action="root-new-folder" title="최상위 폴더 만들기">📁＋ 폴더</button>
        <button class="tree-btn explorer-root-btn" data-action="root-new-file"   title="최상위 파일 만들기">📄＋ 파일</button>
        <button class="tree-btn explorer-root-btn" data-action="root-import"     title="파일 업로드">📥 업로드</button>
    `;
    topBar.querySelector('[data-action="root-new-folder"]').addEventListener('click', () => _newRootFolder());
    topBar.querySelector('[data-action="root-new-file"]').addEventListener('click',   () => _newFile(''));
    topBar.querySelector('[data-action="root-import"]').addEventListener('click',     () => _importFile(''));
    tree.appendChild(topBar);

    // 파일 경로 → 폴더별 그룹핑
    const filesByFolder = {};
    const rootFiles = [];
    Object.keys(appState.project.files).forEach(path => {
        const slashIdx = path.lastIndexOf('/');
        if (slashIdx === -1) { rootFiles.push(path); return; }
        const folder = path.substring(0, slashIdx);
        if (!filesByFolder[folder]) filesByFolder[folder] = [];
        filesByFolder[folder].push(path);
    });

    // definedPaths는 allFolderSet에 포함하지 않음 —
    // 정적 FOLDER_DEFS 경로를 넣으면 파일이 없어도 폴더가 항상 존재하는 것처럼
    // 인식되어 삭제 후에도 트리에서 사라지지 않는 버그 발생
    const allFolderSet = new Set([
        ...Object.keys(filesByFolder).filter(k => k !== ''),
        ..._customFolders
    ]);
    const parentKeys = new Set(PARENT_DEFS.map(p => p.key));

    // 부모 아래 실제 파일이 존재하는지 확인 (FOLDER_DEFS 정적 경로 무관)
    function parentHasContent(parentKey) {
        for (const fp of Object.keys(filesByFolder)) {
            if (fp === parentKey || fp.split('/')[0] === parentKey) return true;
        }
        for (const fp of _customFolders) {
            if (fp === parentKey || fp.split('/')[0] === parentKey) return true;
        }
        return false;
    }

    // 최상위에 표시할 항목 수집 — PARENT_DEFS + 미분류 1단계 폴더 + 루트파일 섹션
    // 알파벳 정렬을 위해 통합 목록으로 관리
    const topItems = []; // { kind: 'parent'|'custom'|'rootfiles', key, label, sortKey }

    PARENT_DEFS.forEach(pd => {
        if (parentHasContent(pd.key)) {
            topItems.push({ kind: 'parent', key: pd.key, label: pd.label, sortKey: pd.key.toLowerCase() });
        }
    });

    [...allFolderSet].forEach(fp => {
        const top = fp.split('/')[0];
        if (!parentKeys.has(top) && fp.split('/').length === 1) {
            topItems.push({ kind: 'custom', key: fp, label: fp, sortKey: fp.toLowerCase() });
        }
    });

    if (rootFiles.length) {
        topItems.push({ kind: 'rootfiles', key: '__rootfiles__', label: '루트 파일', sortKey: '~' }); // ~ 로 맨 뒤
    }

    topItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const getFoldersByParent = (parentKey) => {
        const result = new Set();
        // filesByFolder에서 이 parent 하위의 모든 폴더 경로 수집
        // → 직속 파일이 없어도 깊은 하위 경로에서 2단계 폴더를 역으로 추출
        for (const fp of Object.keys(filesByFolder)) {
            const parts = fp.split('/');
            if (parts[0] !== parentKey || parts.length < 2) continue;
            result.add(`${parentKey}/${parts[1]}`); // 항상 2단계만 추출
        }
        for (const fp of _customFolders) {
            if (fp.split('/')[0] === parentKey) result.add(fp);
        }
        return [...result].sort();
    };

    topItems.forEach(item => {

        // ── PARENT 그룹 ────────────────────────────────
        if (item.kind === 'parent') {
            const parentDef       = PARENT_DEFS.find(p => p.key === item.key);
            const isParentExpanded = _expandedParents.has(parentDef.key);

            const parentEl = document.createElement('div');
            parentEl.className = 'tree-parent';

            const parentHeader = document.createElement('div');
            parentHeader.className = 'tree-parent-header';
            parentHeader.innerHTML = `
                <span class="tree-arrow">${isParentExpanded ? '▾' : '▸'}</span>
                <span class="tree-folder-icon">${parentDef.icon}</span>
                <span class="tree-parent-label">${escapeHtml(parentDef.label)}</span>
                <div class="tree-folder-actions">
                    <button class="tree-btn" data-action="new-subfolder" data-folder="${escapeHtml(parentDef.key)}" title="새 하위 폴더">📁+</button>
                    <button class="tree-btn" data-action="new-file"      data-folder="${escapeHtml(parentDef.key)}" title="새 파일">＋</button>
                    <button class="tree-btn" data-action="import-file"   data-folder="${escapeHtml(parentDef.key)}" title="파일 가져오기">📥</button>
                    <button class="tree-btn danger" data-action="delete-parent" data-folder="${escapeHtml(parentDef.key)}" title="폴더 삭제">🗑</button>
                </div>
            `;
            parentHeader.addEventListener('click', e => {
                if (e.target.closest('.tree-folder-actions')) return;
                _expandedParents[isParentExpanded ? 'delete' : 'add'](parentDef.key);
                renderExplorer();
            });
            parentEl.appendChild(parentHeader);

            if (isParentExpanded) {
                const childrenWrap = document.createElement('div');
                childrenWrap.className = 'tree-children';

                // PARENT 직속 파일 표시
                // (FOLDER_DEFS에 parent 자체 경로가 없어도 filesByFolder에 있으면 표시)
                (filesByFolder[parentDef.key] || []).sort().forEach(filePath => {
                    childrenWrap.appendChild(_makeFileEl(filePath));
                });

                getFoldersByParent(parentDef.key)
                    .filter(fp => fp.split('/').length === 2)
                    .forEach(fp => {
                        const def = FOLDER_DEFS.find(d => d.path === fp);
                        childrenWrap.appendChild(_makeFolderEl(fp, def, filesByFolder, allFolderSet));
                    });

                parentEl.appendChild(childrenWrap);
            }
            tree.appendChild(parentEl);
        }

        // ── 미분류 커스텀 최상위 폴더 ─────────────────
        else if (item.kind === 'custom') {
            tree.appendChild(_makeFolderEl(item.key, null, filesByFolder, allFolderSet));
        }

        // ── 루트 파일 섹션 ─────────────────────────────
        else if (item.kind === 'rootfiles') {
            const rootSection = document.createElement('div');
            rootSection.className = 'tree-parent';
            rootSection.innerHTML = `
                <div class="tree-parent-header" style="cursor:default;">
                    <span class="tree-folder-icon">📄</span>
                    <span class="tree-parent-label">루트 파일</span>
                </div>
            `;
            const rootList = document.createElement('div');
            rootList.className = 'tree-children';
            [...rootFiles].sort().forEach(filePath => rootList.appendChild(_makeFileEl(filePath)));
            rootSection.appendChild(rootList);
            tree.appendChild(rootSection);
        }
    });

    // 버튼 이벤트 위임
    tree.querySelectorAll('.tree-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const { action, folder, path } = btn.dataset;
            if (action === 'new-file')       _newFile(folder);
            if (action === 'import-file')    _importFile(folder);
            if (action === 'export-file')    _exportFile(path);
            if (action === 'delete-file')    _deleteFile(path);
            if (action === 'move-file')      _moveFile(path);
            if (action === 'new-subfolder')  _newSubFolder(folder);
            if (action === 'delete-folder')  _deleteFolder(folder);
            if (action === 'delete-parent')  _deleteParentFolder(folder);
        });
    });
}

// ── 파일 엘리먼트 생성 (공통) ────────────────────────────
function _makeFileEl(filePath) {
    const filename  = filePath.split('/').pop();
    const isCurrent = filePath === appState.currentFile;
    const fileEl    = document.createElement('div');
    fileEl.className = 'tree-file' + (isCurrent ? ' active' : '');
    fileEl.title     = filePath;
    fileEl.innerHTML = `
        <span class="tree-file-icon">${_fileIcon(filePath)}</span>
        <span class="tree-file-name">${escapeHtml(filename)}</span>
        <div class="tree-file-actions">
            <button class="tree-btn" data-action="move-file"    data-path="${escapeHtml(filePath)}" title="이동">✂️</button>
            <button class="tree-btn" data-action="export-file"  data-path="${escapeHtml(filePath)}" title="내보내기">💾</button>
            <button class="tree-btn danger" data-action="delete-file" data-path="${escapeHtml(filePath)}" title="삭제">🗑</button>
        </div>
    `;
    fileEl.addEventListener('click', e => {
        if (e.target.closest('.tree-file-actions')) return;
        openFile(filePath);
    });
    return fileEl;
}
// ── 폴더 노드 생성 (재귀) ───────────────────────────────
function _makeFolderEl(folderPath, def, filesByFolder, allFolderSet) {
    const isExpanded = _expandedFolders.has(folderPath);
    const label      = def?.label || folderPath.split('/').pop();
    const isBuiltin  = !!def; // FOLDER_DEFS에 정의된 폴더

    const folderEl = document.createElement('div');
    folderEl.className = 'tree-folder';

    const header = document.createElement('div');
    header.className = 'tree-folder-header' + (isExpanded ? ' expanded' : '');
    header.title     = folderPath;
    header.innerHTML = `
        <span class="tree-arrow">${isExpanded ? '▾' : '▸'}</span>
        <span class="tree-folder-icon">📁</span>
        <span class="tree-folder-label">${escapeHtml(label)}</span>
        <div class="tree-folder-actions">
            <button class="tree-btn" data-action="new-subfolder"  data-folder="${escapeHtml(folderPath)}" title="새 하위 폴더">📁+</button>
            <button class="tree-btn" data-action="new-file"       data-folder="${escapeHtml(folderPath)}" title="새 파일">＋</button>
            <button class="tree-btn" data-action="import-file"    data-folder="${escapeHtml(folderPath)}" title="파일 불러오기">📥</button>
            ${!isBuiltin ? `<button class="tree-btn danger" data-action="delete-folder" data-folder="${escapeHtml(folderPath)}" title="폴더 삭제">🗑</button>` : ''}
        </div>
    `;
    header.addEventListener('click', e => {
        if (e.target.closest('.tree-folder-actions')) return;
        _expandedFolders[isExpanded ? 'delete' : 'add'](folderPath);
        renderExplorer();
    });
    folderEl.appendChild(header);

    if (isExpanded) {
        const contentWrap = document.createElement('div');
        contentWrap.className = 'tree-file-list';

        // 직속 하위 폴더 — filesByFolder에서 depth+1 경로를 역추출
        // (직속 파일 없이 더 깊은 경로에 파일이 있어도 올바르게 표시)
        const depth      = folderPath.split('/').length;
        const subFolders = [...new Set(
            Object.keys(filesByFolder)
                .filter(fp => fp.startsWith(folderPath + '/'))
                .map(fp => fp.split('/').slice(0, depth + 1).join('/'))
        )].sort();

        subFolders.forEach(subPath => {
            const subDef = FOLDER_DEFS.find(d => d.path === subPath);
            const subEl  = _makeFolderEl(subPath, subDef, filesByFolder, allFolderSet);
            subEl.style.marginLeft = '12px';
            contentWrap.appendChild(subEl);
        });

        // 직속 파일
        const files = (filesByFolder && filesByFolder[folderPath]) || [];
        if (!subFolders.length && !files.length) {
            contentWrap.innerHTML += '<div class="tree-empty">비어 있음</div>';
        } else {
            files.sort().forEach(filePath => {
                contentWrap.appendChild(_makeFileEl(filePath));
            });
        }

        folderEl.appendChild(contentWrap);
    }
    return folderEl;
}

function _fileIcon(path) {
    if (path.includes('national_focus')) return '🎯';
    if (path.includes('ideas'))          return '💡';
    if (path.includes('decisions'))      return '⚖️';
    if (path.includes('characters'))     return '👤';
    if (path.includes('history/countries')) return '🏛';
    if (path.includes('history/states'))    return '🗺';
    if (path.includes('history/units'))     return '⚔️';
    if (path.includes('history/'))          return '📜';
    if (path.includes('events/') || path.startsWith('events/')) return '📰';
    if (path.includes('localisation'))   return '🌐';
    if (path.endsWith('.mod') || path.endsWith('.info')) return '🔧';
    if (path.endsWith('.dds'))           return '🖼';
    if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg') ||
        path.endsWith('.bmp') || path.endsWith('.tga')) return '🖼';
    if (path.endsWith('.gfx'))           return '🎨';
    if (path.endsWith('.gui'))           return '🖥';
    if (path.endsWith('.lua'))           return '📜';
    if (path.endsWith('.csv'))           return '📊';
    return '📄';
}

// ── 새 하위 폴더 만들기 ─────────────────────────────────
// ── 최상위 폴더 생성 ────────────────────────────────────
// PARENT_DEFS에 일치하는 이름이면 자동으로 PARENT 그룹으로 승격
function _newRootFolder() {
    const name = prompt('최상위에 생성할 폴더 이름:', '');
    if (!name?.trim()) return;
    const sanitized = name.trim().replace(/[\\/]/g, '');
    if (!sanitized) return;

    // PARENT_DEFS에 정의된 이름이어도 _customFolders에 등록해야 빈 상태에서 트리에 표시됨
    // (parentHasContent가 파일 없으면 false → topItems에 미포함되는 문제 방지)
    const matchedParent = PARENT_DEFS.find(p => p.key === sanitized);
    if (matchedParent) {
        _customFolders.add(sanitized);
        _expandedParents.add(sanitized);
        appState.isDirty = true;
        renderExplorer();
        return;
    }

    // 커스텀 1단계 폴더로 등록
    if (_customFolders.has(sanitized)) {
        _expandedFolders.add(sanitized);
        renderExplorer();
        return;
    }
    _customFolders.add(sanitized);
    _expandedFolders.add(sanitized);
    appState.isDirty = true;
    renderExplorer();
}

// ── 하위 폴더 생성 ───────────────────────────────────────
function _newSubFolder(parentPath) {
    const name = prompt(`"${parentPath}" 아래 생성할 폴더 이름:`, '');
    if (!name?.trim()) return;

    // 슬래시 포함 금지 (단일 이름만)
    const sanitized = name.trim().replace(/[\\/]/g, '');
    if (!sanitized) return;

    const newPath = `${parentPath}/${sanitized}`;

    // 이미 커스텀 폴더로 등록된 경우 → 그냥 펼치기
    if (_customFolders.has(newPath)) {
        _expandedFolders.add(newPath);
        _expandedFolders.add(parentPath);
        _expandedParents.add(parentPath.split('/')[0]);
        renderExplorer();
        return;
    }

    // FOLDER_DEFS에 정의된 표준 폴더인 경우 → 오류 아님, 활성화
    if (FOLDER_DEFS.some(d => d.path === newPath)) {
        _customFolders.add(newPath);
        _expandedFolders.add(newPath);
        _expandedFolders.add(parentPath);
        _expandedParents.add(parentPath.split('/')[0]);
        appState.isDirty = true;
        renderExplorer();
        return;
    }

    _customFolders.add(newPath);
    _expandedFolders.add(newPath);
    // 부모도 펼쳐두기
    _expandedFolders.add(parentPath);
    const topKey = parentPath.split('/')[0];
    _expandedParents.add(topKey);

    appState.isDirty = true;
    renderExplorer();
}

// ── 폴더 삭제 ───────────────────────────────────────────
function _deleteFolder(folderPath) {
    const childFiles = Object.keys(appState.project.files)
        .filter(p => p.startsWith(folderPath + '/'));

    const folderName = folderPath.split('/').pop();
    const msg = childFiles.length
        ? `⚠️ "${folderName}" 폴더를 삭제하시겠습니까?\n\n하위 파일 ${childFiles.length}개가 함께 삭제됩니다:\n${childFiles.slice(0,8).map(p=>'  • '+p.split('/').pop()).join('\n')}${childFiles.length>8?`\n  ... 외 ${childFiles.length-8}개`:''}\n\n이 작업은 되돌릴 수 없습니다.`
        : `"${folderName}" 폴더를 삭제하시겠습니까?`;

    if (!confirm(msg)) return;

    childFiles.forEach(p => {
        if (appState.currentFile === p) { switchView('explorer-view'); appState.currentFile = null; }
        delete appState.project.files[p];
    });
    CloudAuth.getUser().then(user => {
        if (user) childFiles.forEach(p =>
            CloudAuth.deleteFile(appState.project.name, p).catch(console.error)
        );
    });

    [..._customFolders].forEach(fp => {
        if (fp === folderPath || fp.startsWith(folderPath + '/')) _customFolders.delete(fp);
    });
    _expandedFolders.delete(folderPath);
    appState.isDirty = true;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    renderExplorer();
}


function _newFile(folderPath) {
    const def        = FOLDER_DEFS.find(d => d.path === folderPath);
    const defaultExt = def?.ext || '.txt';
    const defaultVal = folderPath ? `${folderPath}/new_file${defaultExt}` : `new_file${defaultExt}`;

    const input = prompt(
        `파일 경로를 입력하세요.\n• 폴더/파일명 형식: events/KOR.txt\n• 파일명만 입력하면 루트 파일로 저장됩니다.`,
        defaultVal
    );
    if (!input?.trim()) return;

    const filePath = input.trim().replace(/^\/+|\/+$/g, ''); // 앞뒤 슬래시 제거
    if (!filePath) return;

    if (appState.project.files[filePath]) {
        alert('같은 경로의 파일이 이미 있습니다.');
        return;
    }

    // 타입 결정: 경로로 detectFileType 활용
    const filename = filePath.split('/').pop();
    const folder   = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    const matchDef = FOLDER_DEFS.find(d => d.path === folder);

    if (matchDef?.type === 'national_focus') {
        appState.project.files[filePath] = makeNationalFocusFile();
    } else if (matchDef?.type === 'localisation') {
        const lang = folder.split('/').pop();
        appState.project.files[filePath] = makeLocalisationFile(lang);
    } else if (matchDef?.type === 'ideas') {
        appState.project.files[filePath] = makeIdeasFile();
    } else if (matchDef?.type === 'decisions') {
        appState.project.files[filePath] = { type: 'decisions', categories: {} };
    } else if (matchDef?.type === 'characters') {
        appState.project.files[filePath] = { type: 'characters', raw: '' };
    } else if (filename.endsWith('.gfx')) {
        appState.project.files[filePath] = { type: 'gfx_define', sprites: [] };
    } else if (filename.endsWith('.gui')) {
        appState.project.files[filePath] = { type: 'gui', raw: '' };
    } else if (filename.endsWith('.yml') || filename.endsWith('.yaml')) {
        const lang = folder.split('/').pop() || 'english';
        appState.project.files[filePath] = makeLocalisationFile(lang);
    } else {
        appState.project.files[filePath] = { type: 'raw_text', raw: '' };
    }

    appState.isDirty = true;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    // 해당 폴더 자동 펼침
    if (folder) {
        _expandedFolders.add(folder);
        const top = folder.split('/')[0];
        if (PARENT_DEFS.find(p => p.key === top)) _expandedParents.add(top);
    }
    renderExplorer();
    openFile(filePath);
}

// ── 외부 파일 가져오기 ───────────────────────────────────
function _importFile(targetFolder) {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.txt,.yml,.yaml,.json,.dds,.gfx,.gui,.png,.jpg,.jpeg,.bmp,.tga,.mod,.cfg,.lua,.csv';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const nameLow = file.name.toLowerCase();

        // DDS 이미지 처리
        if (nameLow.endsWith('.dds')) {
            const arrayBuf = await file.arrayBuffer();
            const base64   = _arrayBufferToBase64Io(arrayBuf);
            const defaultPath = targetFolder ? `${targetFolder}/${file.name}` : `gfx/interface/goals/${file.name}`;
            const dest = prompt(`저장할 전체 경로를 입력하세요:`, defaultPath);
            if (!dest?.trim()) return;
            const destPath = dest.trim().replace(/^\/+|\/+$/g, '');
            if (appState.project.files[destPath]) {
                if (!confirm(`"${destPath}"에 이미 파일이 있습니다. 덮어쓰시겠습니까?`)) return;
            }
            appState.project.files[destPath] = { type: 'dds', base64, filename: file.name };
            appState.isDirty = true;
            const folder = destPath.includes('/') ? destPath.substring(0, destPath.lastIndexOf('/')) : '';
            if (folder) { _expandedFolders.add(folder); const top = folder.split('/')[0]; if (PARENT_DEFS.find(p=>p.key===top)) _expandedParents.add(top); }
            renderExplorer();
            CloudAuth.saveProject(appState.project.name).catch(console.error);
            return;
        }

        // PNG / JPG / BMP / TGA 이미지 처리
        const imgExts = ['.png', '.jpg', '.jpeg', '.bmp', '.tga'];
        if (imgExts.some(e => nameLow.endsWith(e))) {
            const arrayBuf = await file.arrayBuffer();
            const base64   = _arrayBufferToBase64Io(arrayBuf);
            const defaultPath = targetFolder ? `${targetFolder}/${file.name}` : `gfx/interface/goals/${file.name}`;
            const dest = prompt(`저장할 전체 경로를 입력하세요:`, defaultPath);
            if (!dest?.trim()) return;
            const destPath = dest.trim().replace(/^\/+|\/+$/g, '');
            if (appState.project.files[destPath]) {
                if (!confirm(`"${destPath}"에 이미 파일이 있습니다. 덮어쓰시겠습니까?`)) return;
            }
            appState.project.files[destPath] = { type: 'image', base64, filename: file.name };
            appState.isDirty = true;
            const folder = destPath.includes('/') ? destPath.substring(0, destPath.lastIndexOf('/')) : '';
            if (folder) { _expandedFolders.add(folder); const top = folder.split('/')[0]; if (PARENT_DEFS.find(p=>p.key===top)) _expandedParents.add(top); }
            renderExplorer();
            CloudAuth.saveProject(appState.project.name).catch(console.error);
            return;
        }

        // GFX 파일 처리
        if (nameLow.endsWith('.gfx')) {
            const content     = await file.text();
            const defaultPath = targetFolder ? `${targetFolder}/${file.name}` : `interface/${file.name}`;
            const dest        = prompt(`저장할 전체 경로를 입력하세요:`, defaultPath);
            if (!dest?.trim()) return;
            const destPath = dest.trim().replace(/^\/+|\/+$/g, '');
            if (appState.project.files[destPath]) {
                if (!confirm(`"${destPath}"에 이미 파일이 있습니다. 덮어쓰시겠습니까?`)) return;
            }
            appState.project.files[destPath] = { type: 'gfx_define', sprites: parseGfxFile(content) };
            appState.isDirty = true;
            const folder = destPath.includes('/') ? destPath.substring(0, destPath.lastIndexOf('/')) : '';
            if (folder) { _expandedFolders.add(folder); const top = folder.split('/')[0]; if (PARENT_DEFS.find(p=>p.key===top)) _expandedParents.add(top); }
            renderExplorer();
            CloudAuth.saveProject(appState.project.name).catch(console.error);
            return;
        }

        // GUI 파일 처리
        if (nameLow.endsWith('.gui')) {
            const content     = await file.text();
            const defaultPath = targetFolder ? `${targetFolder}/${file.name}` : `interface/${file.name}`;
            const dest        = prompt(`저장할 전체 경로를 입력하세요:`, defaultPath);
            if (!dest?.trim()) return;
            const destPath = dest.trim().replace(/^\/+|\/+$/g, '');
            if (appState.project.files[destPath]) {
                if (!confirm(`"${destPath}"에 이미 파일이 있습니다. 덮어쓰시겠습니까?`)) return;
            }
            appState.project.files[destPath] = { type: 'gui', raw: content };
            appState.isDirty = true;
            const folder = destPath.includes('/') ? destPath.substring(0, destPath.lastIndexOf('/')) : '';
            if (folder) { _expandedFolders.add(folder); const top = folder.split('/')[0]; if (PARENT_DEFS.find(p=>p.key===top)) _expandedParents.add(top); }
            renderExplorer();
            CloudAuth.saveProject(appState.project.name).catch(console.error);
            return;
        }

        // 텍스트 파일 처리 — parseSingleFile로 먼저 시도, 실패 시 raw_text로 폴백
        const content  = await file.text();
        const parsed   = parseSingleFile(content, file.name, targetFolder ? `${targetFolder}/${file.name}` : file.name);
        const fileData = parsed || { type: 'raw_text', raw: content };

        const suggested = parsed ? suggestPath(parsed.type, file.name) : (targetFolder ? `${targetFolder}/${file.name}` : file.name);
        const dest = prompt(
            `저장할 전체 경로를 입력하세요.\n파일명만 입력하면 루트 파일로 저장됩니다.`,
            suggested
        );
        if (!dest?.trim()) return;
        const destPath = dest.trim().replace(/^\/+|\/+$/g, '');
        if (appState.project.files[destPath]) {
            if (!confirm(`"${destPath}"에 이미 파일이 있습니다. 덮어쓰시겠습니까?`)) return;
        }
        appState.project.files[destPath] = fileData;
        appState.isDirty = true;
        invalidateLocCache();
        invalidateGfxSpriteCache();
        const folder = destPath.includes('/') ? destPath.substring(0, destPath.lastIndexOf('/')) : null;
        if (folder) {
            _expandedFolders.add(folder);
            const top = folder.split('/')[0];
            if (PARENT_DEFS.find(p => p.key === top)) _expandedParents.add(top);
        }
        renderExplorer();
        CloudAuth.saveProject(appState.project.name).catch(console.error);
    };
    input.click();
}

// _arrayBufferToBase64 는 core/io-zip.js 의 _arrayBufferToBase64Io 를 사용합니다.

// ── 파일 내보내기 ─────────────────────────────────────────
function _exportFile(filePath) {
    const fd = appState.project.files[filePath];
    if (!fd) return;
    const filename = filePath.split('/').pop();
    try {
        if (fd.type === 'national_focus')
            downloadBlob(buildFocusTxt(fd), filename);
        else if (fd.type === 'localisation')
            downloadBlob(buildLocYml(fd), filename, 'text/yaml;charset=utf-8');
        else if (fd.type === 'dds') {
            const bytes = Uint8Array.from(atob(fd.base64), c => c.charCodeAt(0));
            downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), filename);
        } else if (fd.type === 'image') {
            const ext  = filename.split('.').pop().toLowerCase();
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                       : ext === 'bmp' ? 'image/bmp' : 'image/png';
            const bytes = Uint8Array.from(atob(fd.base64), c => c.charCodeAt(0));
            downloadBlob(new Blob([bytes], { type: mime }), filename);
        } else if (fd.type === 'gfx_define')
            downloadBlob(buildGfxFile(fd), filename, 'text/plain;charset=utf-8');
        else if (fd.type === 'ideas')
            downloadBlob(buildIdeasTxt(fd), filename, 'text/plain;charset=utf-8');
        else if (fd.type === 'decisions')
            downloadBlob(buildDecisionsTxt(fd), filename, 'text/plain;charset=utf-8');
        else if (fd.type === 'decisions_category')
            downloadBlob(buildDecisionCategoriesTxt(fd), filename, 'text/plain;charset=utf-8');
        else if (fd.type === 'gui')
            downloadBlob(fd.raw || '', filename, 'text/plain;charset=utf-8');
        else if (fd.raw != null)
            // ideas / decisions / characters / common_raw
            downloadBlob(fd.raw, filename, 'text/plain;charset=utf-8');
    } catch(e) { alert('내보내기 오류: ' + e.message); }
}

// ── 파일 삭제 ────────────────────────────────────────────
// ── 루트(PARENT) 폴더 삭제 ──────────────────────────────
function _deleteParentFolder(parentKey) {
    // 해당 parent 아래 모든 파일 수집
    const childFiles = Object.keys(appState.project.files)
        .filter(p => p.split('/')[0] === parentKey);

    const msg = childFiles.length
        ? `⚠️ "${parentKey}" 폴더 전체를 삭제하시겠습니까?\n\n하위 파일 ${childFiles.length}개가 함께 삭제됩니다:\n${childFiles.slice(0,8).map(p=>'  • '+p).join('\n')}${childFiles.length>8?`\n  ... 외 ${childFiles.length-8}개`:''}\n\n이 작업은 되돌릴 수 없습니다.`
        : `"${parentKey}" 폴더를 삭제하시겠습니까?\n(폴더가 목록에서 제거됩니다)`;

    if (!confirm(msg)) return;

    // 파일 삭제
    childFiles.forEach(p => {
        if (appState.currentFile === p) { switchView('explorer-view'); appState.currentFile = null; }
        delete appState.project.files[p];
    });
    CloudAuth.getUser().then(user => {
        if (user) childFiles.forEach(p =>
            CloudAuth.deleteFile(appState.project.name, p).catch(console.error)
        );
    });

    // _customFolders에서 해당 루트 제거
    [..._customFolders].forEach(fp => {
        if (fp === parentKey || fp.startsWith(parentKey + '/')) _customFolders.delete(fp);
    });
    _expandedParents.delete(parentKey);
    appState.isDirty = true;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    renderExplorer();
}

// ── 파일 이동 ───────────────────────────────────────────
function _moveFile(filePath) {
    const filename   = filePath.split('/').pop();
    const currentDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';

    const dest = prompt(
        `"${filename}" 파일을 이동할 경로를 입력하세요.\n현재 경로: ${filePath}\n\n• 폴더/파일명 형식: events/KOR_new.txt\n• 파일명만 입력하면 루트로 이동합니다.`,
        filePath
    );
    if (!dest?.trim()) return;
    const newPath = dest.trim().replace(/^\/+|\/+$/g, '');

    if (!newPath) { alert('올바른 경로를 입력하세요.'); return; }
    if (newPath === filePath) { alert('현재 경로와 동일합니다.'); return; }

    // 파일명 유효성 — 빈 파일명 방지
    const newFilename = newPath.split('/').pop();
    if (!newFilename || newFilename.includes('..')) {
        alert('올바르지 않은 파일명입니다.');
        return;
    }

    // 덮어쓰기 확인
    if (appState.project.files[newPath]) {
        if (!confirm(`"${newPath}"에 이미 파일이 있습니다. 덮어쓰시겠습니까?`)) return;
        // 기존 파일 서버에서 삭제
        CloudAuth.deleteFile(appState.project.name, newPath).catch(console.error);
    }

    // 이동: 새 경로에 복사 후 원본 삭제
    appState.project.files[newPath] = appState.project.files[filePath];
    delete appState.project.files[filePath];
    invalidateLocCache();
    invalidateGfxSpriteCache();

    // 서버: 원본 삭제 + 새 경로 저장
    CloudAuth.deleteFile(appState.project.name, filePath).catch(console.error);
    CloudAuth.saveOneFile(appState.project.name, newPath, appState.project.files[newPath]).catch(console.error);

    // 열려있던 파일이면 새 경로로 갱신
    if (appState.currentFile === filePath) appState.currentFile = newPath;

    // 새 폴더 자동 펼침
    const newDir = newPath.includes('/') ? newPath.substring(0, newPath.lastIndexOf('/')) : '';
    if (newDir) {
        _expandedFolders.add(newDir);
        const top = newDir.split('/')[0];
        if (PARENT_DEFS.find(p => p.key === top)) _expandedParents.add(top);
        else _customFolders.add(newDir.split('/')[0]);
    }

    appState.isDirty = true;
    renderExplorer();
}

// ── 파일 삭제 ───────────────────────────────────────────
function _deleteFile(filePath) {
    const filename = filePath.split('/').pop();
    if (!confirm(`"${filename}" 파일을 삭제하시겠습니까?\n경로: ${filePath}\n\n이 작업은 되돌릴 수 없습니다.`)) return;
    if (appState.currentFile === filePath) { switchView('explorer-view'); appState.currentFile = null; }
    delete appState.project.files[filePath];
    appState.isDirty = true;
    invalidateLocCache();
    invalidateGfxSpriteCache();
    CloudAuth.deleteFile(appState.project.name, filePath).catch(console.error);
    renderExplorer();
}

// ── 탐색기 오른쪽 본문에 인라인 렌더링 ─────────────────
// GFX/DDS/GUI 뷰어는 별도 뷰 전환 없이 explorer-main에 직접 렌더링
function _renderInExplorerMain(renderFn) {
    _closeLocInline();
    const placeholder = document.getElementById('explorer-placeholder');
    if (placeholder) placeholder.classList.add('hidden');

    const cont = document.getElementById('inline-editor-content');
    if (!cont) return;
    cont.style.display = 'block';
    cont.innerHTML = '';
    renderFn();
}

// ── 탐색기 오른쪽 본문을 안내 문구로 초기화 ────────────
function _resetExplorerMain() {
    _closeLocInline();
    const placeholder = document.getElementById('explorer-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
    const cont = document.getElementById('inline-editor-content');
    if (cont) { cont.style.display = 'none'; cont.innerHTML = ''; }
}

// ── 파일 열기 (편집기로 진입) ────────────────────────────
// ── stub 파일 일괄 로드 헬퍼 ─────────────────────────────
// types에 해당하는 타입 중 아직 서버에서 내용을 안 가져온(_stub) 파일들을
// 병렬로 로드한다. national_focus/ideas/decisions/gfx_define 진입 시 공용으로 사용.
// onLoaded: 1개 이상 로드 성공 시 호출되는 콜백 (재렌더용)
function _ensureStubFilesLoaded(types, onLoaded) {
    const stubPaths = Object.entries(appState.project.files)
        .filter(([, v]) => types.includes(v.type) && v._stub)
        .map(([k]) => k);

    if (!stubPaths.length || !appState.project.name) return;

    (async () => {
        const sp = appState.sharedProject;
        const results = await Promise.allSettled(
            stubPaths.map(async path => {
                const fileType = appState.project.files[path].type;
                const loaded = sp
                    ? await CloudAuth.fetchSharedFile(sp.ownerUserId, appState.project.name, path, fileType)
                    : await CloudAuth.fetchFile(appState.project.name, path, fileType);
                if (loaded) appState.project.files[path] = loaded;
            })
        );
        const ok  = results.filter(r => r.status === 'fulfilled').length;
        const err = results.filter(r => r.status === 'rejected').length;
        if (ok > 0) onLoaded?.();
        if (err > 0) console.warn(`stub 파일 ${err}개 로드 실패 (types: ${types.join(',')})`);
    })();
}

async function openFile(filePath) {
    // 현재 열린 폼의 미반영 변경사항 먼저 저장
    (window._formFlushHooks || []).forEach(fn => fn());

    // 기존 인라인 패널 전부 정리
    _resetExplorerMain();

    let fd = appState.project.files[filePath];
    if (!fd) return;

    // stub(목록만 로드된 상태)이면 서버에서 실제 내용 가져오기
    if (fd._stub) {
        const fileEl = document.querySelector(`.tree-file[title="${CSS.escape(filePath)}"]`);
        if (fileEl) fileEl.style.opacity = '0.5';
        try {
            const sp = appState.sharedProject;
            const loaded = sp
                ? await CloudAuth.fetchSharedFile(sp.ownerUserId, appState.project.name, filePath, fd.type)
                : await CloudAuth.fetchFile(appState.project.name, filePath, fd.type);
            if (loaded) {
                appState.project.files[filePath] = loaded;
                fd = loaded;
            } else {
                alert(`"${filePath.split('/').pop()}" 파일을 서버에서 불러오지 못했습니다.`);
                if (fileEl) fileEl.style.opacity = '';
                return;
            }
        } catch(e) {
            alert(`파일 로드 실패: ${e.message}`);
            if (fileEl) fileEl.style.opacity = '';
            return;
        }
        if (fileEl) fileEl.style.opacity = '';
    }

    appState.currentFile     = filePath;
    appState.selectedFocusId = null;
    resetHistory();

    if (fd.type === 'national_focus') {
        // ── 로컬라이징 stub 파일 자동 로드 ──────────────────
        _ensureStubFilesLoaded(['localisation'], () => {
            const curFd = currentFileData();
            if (curFd?.type === 'national_focus') {
                invalidateLocCache();
                applyLocToAllFocuses(curFd);
                renderFocusTree();
            }
        });

        switchView('focus-editor-view');
        setupFocusEditorToolbar();
        applyLocToAllFocuses(fd);
        renderFocusTree();
    } else if (fd.type === 'localisation') {
        _openLocInline();
        setupLocEditorToolbar();
        renderLocalisationList();
    } else if (fd.type === 'dds') {
        _renderInExplorerMain(() => renderDdsViewer(filePath, fd));
    } else if (fd.type === 'image') {
        _renderInExplorerMain(() => renderImageViewer(filePath, fd));
    } else if (fd.type === 'gfx_define') {
        _ensureStubFilesLoaded(['localisation'], () => invalidateLocCache());
        _renderInExplorerMain(() => renderGfxEditor(filePath, fd));
    } else if (fd.type === 'gui') {
        _renderInExplorerMain(() => renderGuiViewer(filePath, fd));
    } else if (fd.type === 'ideas') {
        _ensureStubFilesLoaded(['localisation', 'gfx_define'], () => {
            invalidateLocCache();
            invalidateGfxSpriteCache();
            if (currentFileData()?.type === 'ideas') renderIdeasEditor();
        });
        openIdeasEditor(filePath);
    } else if (fd.type === 'decisions' || fd.type === 'decisions_category') {
        _ensureStubFilesLoaded(['localisation', 'gfx_define'], () => {
            invalidateLocCache();
            invalidateGfxSpriteCache();
            const t = currentFileData()?.type;
            if (t === 'decisions' || t === 'decisions_category') renderDecisionsEditor();
        });
        openDecisionsEditor(filePath);
    } else if (fd.type === 'characters' ||
               fd.type === 'raw_text' || fd.type === 'common_raw') {
        // raw_text: history, events, descriptor.mod 등 모든 텍스트 파일
        _renderInExplorerMain(() => renderRawTextEditor(filePath, fd));
    } else {
        alert('아직 지원하지 않는 파일 형식입니다.');
        appState.currentFile = null;
    }
    renderExplorer();
}

// ── 탐색기 툴바 이벤트 ──────────────────────────────────
function setupExplorerListeners() {
    document.getElementById('btn-explorer-back')
        ?.addEventListener('click', showHomeView);
    document.getElementById('btn-save-project')
        ?.addEventListener('click', async () => {
            if (isReadOnly()) {
                alert('뷰어 권한으로는 저장할 수 없습니다.');
                return;
            }
            const sp = appState.sharedProject;
            if (sp) {
                // 공유 프로젝트 편집자: ownerUserId 기준으로 저장
                _progressShow(`"${appState.project.name}" 저장 중...`, '☁️');
                try {
                    await _saveSharedProject(sp.ownerUserId, appState.project.name);
                    _progressHide();
                    appState.isDirty = false;
                } catch (e) {
                    _progressHide();
                    alert('저장 실패: ' + e.message);
                }
            } else {
                await saveProjectZip();                                           // ZIP 다운로드
                CloudAuth.saveProject(appState.project.name).catch(console.error); // 서버 동기화
            }
        });
    document.getElementById('btn-explorer-import')
        ?.addEventListener('click', () => _importFile(''));

    document.getElementById('btn-rename-project')?.addEventListener('click', async () => {
        if (!isOwner()) { alert('프로젝트 이름은 소유자만 변경할 수 있습니다.'); return; }
        const current = appState.project.name || '';
        const newName = prompt('새 프로젝트(모드) 이름을 입력하세요:', current);
        if (!newName?.trim() || newName.trim() === current) return;
        appState.project.name = newName.trim();
        appState.isDirty = true;
        // 서버에 새 이름으로 메타 생성 (비동기)
        CloudAuth.getUser().then(user => {
            if (user) CloudAuth._saveProjectMeta(user.id, newName.trim())
                .catch(e => console.warn('이름 변경 서버 반영 실패:', e));
        });
        renderExplorer();
    });
}

// ── 공유 프로젝트 파일 저장 (ownerUserId 기준 upsert) ──
async function _saveSharedProject(ownerUserId, projectName) {
    const files = appState.project.files;
    if (!files) return;

    // project_files에 owner_id 기준으로 upsert
    // CloudAuth.saveOneFile은 현재 로그인 user.id를 사용하므로
    // 직접 Supabase에 ownerUserId로 접근하는 헬퍼 대신
    // auth.js에 saveSharedFile이 없으므로 saveProject의 ownerUserId 오버라이드가 필요.
    // 현재 구조상 CloudAuth.saveProject는 getUser().id를 사용 —
    // editor는 실제로 소유자의 DB 행에 RLS로 쓸 수 있어야 함 (DB 정책 필요).
    // 여기서는 CloudAuth.saveProject를 호출하되, 실제 RLS 정책이 editor 허용해야 동작.
    // (DB 정책에서 project_members.role='editor'이면 owner의 project_files에 upsert 허용)
    await CloudAuth.saveProject(projectName, (pct, detail) => {
        _progressUpdate(pct, detail);
    });
}
// ── 로컬라이징 인라인 패널 열기/닫기 ────────────────────
function _openLocInline() {
    const placeholder = document.getElementById('explorer-placeholder');
    const panel       = document.getElementById('loc-inline-panel');
    const cont        = document.getElementById('inline-editor-content');
    if (placeholder) placeholder.classList.add('hidden');
    if (cont)        cont.style.display = 'none';
    if (panel)       panel.classList.remove('hidden');
}

function _closeLocInline() {
    const panel = document.getElementById('loc-inline-panel');
    if (panel)  panel.classList.add('hidden');
    // placeholder 복원은 _resetExplorerMain이 담당
}
