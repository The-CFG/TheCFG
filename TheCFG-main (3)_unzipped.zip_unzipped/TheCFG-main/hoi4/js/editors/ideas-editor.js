// ════════════════════════════════════════════════════════
//  ideas-editor.js — 아이디어(국민정신) 편집기
//  의존: state.js, io-parsers.js, ideas-form.js, cloud-ui.js
// ════════════════════════════════════════════════════════

let _ideasSelectedCat = 'country';
let _ideasSelectedId  = null;
let _ideasFormDirty   = false;  // 폼이 실제로 렌더된 상태인지

// ── 진입점 ───────────────────────────────────────────────
function openIdeasEditor(filePath) {
    appState.currentFile = filePath;
    const fd = currentFileData();
    if (!fd || fd.type !== 'ideas') return;

    switchView('ideas-editor-view');

    const titleEl = document.getElementById('ideas-editor-title');
    if (titleEl) titleEl.textContent = filePath.split('/').pop();

    // categories가 없거나 비어있으면 기본 country 추가
    if (!fd.categories || !Object.keys(fd.categories).length) {
        fd.categories = makeIdeasFile().categories;
    }
    const cats = Object.keys(fd.categories);
    _ideasSelectedCat = cats.includes('country') ? 'country' : cats[0];
    _ideasSelectedId  = null;
    _ideasFormDirty   = false;

    resetHistory();
    renderIdeasEditor();
}

// ── 전체 재렌더 ─────────────────────────────────────────
function renderIdeasEditor() {
    const fd = currentFileData();
    if (!fd || fd.type !== 'ideas') return;

    // categories가 비어있으면 country 카테고리를 기본 생성
    if (!fd.categories) fd.categories = {};
    if (!Object.keys(fd.categories).length) {
        fd.categories.country = {
            _attrs: { law: false, designer: false, use_list_view: false },
            ideas: {}
        };
    }

    // 선택된 카테고리가 실제로 존재하는지 확인
    if (!fd.categories[_ideasSelectedCat]) {
        _ideasSelectedCat = Object.keys(fd.categories)[0];
        _ideasSelectedId  = null;
        _ideasFormDirty   = false;
    }

    _renderCategoryTabs(fd);
    _renderIdeaList(fd);
    _updateIdeasCount(fd);

    const cat = fd.categories[_ideasSelectedCat];
    if (cat?._raw != null) {
        _showCategoryRawForm(fd, cat);
    } else if (_ideasSelectedId) {
        const idea = cat?.ideas?.[_ideasSelectedId];
        if (idea) {
            _showIdeasForm(fd);
        } else {
            _ideasSelectedId = null;
            _ideasFormDirty  = false;
            _hideIdeasForm();
        }
    } else {
        _hideIdeasForm();
    }
}

// ── RAW 카테고리 메인 화면 편집 ──────────────────────────
function _showCategoryRawForm(fd, cat) {
    const placeholder = document.getElementById('ideas-placeholder');
    const panel       = document.getElementById('ideas-form-panel');
    if (!panel) return;

    if (placeholder) placeholder.classList.add('hidden');
    panel.classList.remove('hidden');
    _ideasFormDirty = false;  // RAW 카테고리 편집 중엔 일반 폼 저장 안 함

    panel.innerHTML = `
        <div class="ideas-raw-edit-wrap">
            <div class="ideas-raw-toolbar">
                <strong class="ideas-raw-title">📄 RAW 카테고리 편집 — ${escapeHtml(_ideasSelectedCat)}</strong>
            </div>
            <textarea id="ideas-cat-raw-textarea" class="raw-editor ideas-raw-fullarea">${escapeHtml(cat._raw || '')}</textarea>
        </div>`;

    document.getElementById('ideas-cat-raw-textarea')?.addEventListener('change', (e) => {
        saveSnapshot('RAW 카테고리 편집');
        cat._raw = e.target.value;
        appState.isDirty = true;
    });
}

// ── 카테고리 탭 ─────────────────────────────────────────
function _renderCategoryTabs(fd) {
    const container = document.getElementById('ideas-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(fd.categories || {}).forEach(catName => {
        const isRaw = fd.categories[catName]._raw != null;
        const btn   = document.createElement('button');
        btn.className = 'ideas-cat-tab' + (_ideasSelectedCat === catName ? ' active' : '');
        btn.textContent = catName + (isRaw ? ' (RAW)' : '');
        btn.addEventListener('click', () => {
            _applyFormIfDirty();
            _ideasSelectedCat = catName;
            _ideasSelectedId  = null;
            _ideasFormDirty   = false;
            renderIdeasEditor();
        });
        container.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'ideas-cat-tab ideas-cat-add';
    addBtn.textContent = '＋ 카테고리';
    addBtn.addEventListener('click', _addCategory);
    container.appendChild(addBtn);
}

// ── 아이디어 목록 ────────────────────────────────────────
function _renderIdeaList(fd) {
    const container = document.getElementById('ideas-list');
    if (!container) return;
    container.innerHTML = '';

    const cat = fd.categories[_ideasSelectedCat];
    if (!cat) return;

    // RAW 카테고리 — 메인 화면에서 편집 (좌측 목록엔 안내만 표시)
    if (cat._raw != null) {
        const info = document.createElement('div');
        info.className = 'ideas-raw-section';
        info.innerHTML = '<small style="color:var(--text-muted);">이 카테고리는 RAW 형식입니다.<br>우측 화면에서 편집하세요.</small>';
        container.appendChild(info);
        return;
    }

    const ideas = cat.ideas || {};
    const ids   = Object.keys(ideas);
    if (!ids.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:var(--text-muted);font-size:12px;padding:8px 4px;';
        empty.textContent   = '아이디어 없음';
        container.appendChild(empty);
        return;
    }

    ids.forEach(id => {
        const idea = ideas[id];
        const card = document.createElement('div');
        card.className = 'idea-card' + (_ideasSelectedId === id ? ' selected' : '');
        card.dataset.id = id;
        const ideaLocName = getLocalisedName(id);
        card.innerHTML  = `
            <div class="idea-card-icon">💡</div>
            <div class="idea-card-info">
                <div class="idea-card-id">${escapeHtml(id)}</div>
                ${ideaLocName ? `<div class="idea-card-locname">${escapeHtml(ideaLocName)}</div>` : ''}
            </div>`;
        card.addEventListener('click', () => _selectIdea(id));
        container.appendChild(card);

        // 아이콘 미리보기 — picture(GFX sprite name) → texturefile 찾아 비동기 렌더
        if (idea.picture) {
            const iconEl = card.querySelector('.idea-card-icon');
            const texturefile = getTexturefileBySpriteName(idea.picture);
            if (iconEl && texturefile) _renderSpritePreview(iconEl, texturefile, null);
        }
    });
}

function _updateIdeasCount(fd) {
    const el  = document.getElementById('ideas-count');
    if (!el) return;
    const cat = fd.categories[_ideasSelectedCat];
    el.textContent = cat?._raw != null ? '—' : Object.keys(cat?.ideas || {}).length;
}

// ── 아이디어 선택 ────────────────────────────────────────
function _selectIdea(id) {
    _applyFormIfDirty();
    _ideasSelectedId = id;

    document.querySelectorAll('.idea-card').forEach(c =>
        c.classList.toggle('selected', c.dataset.id === id));

    _showIdeasForm(currentFileData());
}

function _showIdeasForm(fd) {
    const placeholder = document.getElementById('ideas-placeholder');
    const panel       = document.getElementById('ideas-form-panel');
    if (!panel) return;

    if (placeholder) placeholder.classList.add('hidden');
    panel.classList.remove('hidden');

    const idea = fd.categories[_ideasSelectedCat]?.ideas?.[_ideasSelectedId];
    if (!idea) return;

    renderIdeasForm(panel, _ideasSelectedId, idea, _ideasSelectedCat);
    _ideasFormDirty = true;
}

function _hideIdeasForm() {
    const placeholder = document.getElementById('ideas-placeholder');
    const panel       = document.getElementById('ideas-form-panel');
    if (placeholder) placeholder.classList.remove('hidden');
    if (panel)       { panel.classList.add('hidden'); panel.innerHTML = ''; }
    _ideasFormDirty = false;
}

// ── 폼 적용 (선택 변경/뷰 이탈 전 자동 저장) ────────────
function _applyFormIfDirty() {
    if (!_ideasFormDirty || !_ideasSelectedId) return;
    const idEl = document.getElementById('idea-id');
    if (!idEl) return;  // 폼이 실제로 렌더되지 않은 상태
    _saveCurrentIdea(true);
}
window._formFlushHooks = window._formFlushHooks || [];
window._formFlushHooks.push(_applyFormIfDirty);

// ── 폼 저장 ─────────────────────────────────────────────
function _saveCurrentIdea(silent = false) {
    if (!_ideasSelectedId) return;
    const fd = currentFileData();
    if (!fd) return;
    const cat = fd.categories[_ideasSelectedCat];
    if (!cat?.ideas) return;

    // 폼이 렌더되지 않았으면 스킵
    if (!document.getElementById('idea-id')) return;

    const formData = extractIdeasFormData();
    if (!formData) return;

    const oldId = _ideasSelectedId;
    const newId = formData._id?.trim();
    delete formData._id;

    saveSnapshot(`"${oldId}" 아이디어 수정`);

    if (newId && newId !== oldId) {
        // ID 변경: 순서 유지하며 키 교체
        const reordered = {};
        Object.entries(cat.ideas).forEach(([k, v]) => {
            reordered[k === oldId ? newId : k] = k === oldId ? { ...v, ...formData } : v;
        });
        cat.ideas        = reordered;
        _ideasSelectedId = newId;
    } else {
        cat.ideas[oldId] = { ...cat.ideas[oldId], ...formData };
    }

    appState.isDirty = true;

    if (!silent) {
        renderIdeasEditor();
    } else {
        _renderIdeaList(fd);
        _updateIdeasCount(fd);
    }
}

// ── 새 아이디어 추가 ─────────────────────────────────────
function _addNewIdea() {
    const fd = currentFileData();
    if (!fd) return;
    const cat = fd.categories[_ideasSelectedCat];
    if (!cat || cat._raw != null) {
        alert('RAW 카테고리에는 직접 아이디어를 추가할 수 없습니다.');
        return;
    }

    _applyFormIfDirty();

    let newId = 'new_spirit';
    let n = 2;
    while (cat.ideas[newId]) { newId = `new_spirit_${n++}`; }

    saveSnapshot('새 아이디어 추가');
    cat.ideas[newId] = _emptyIdea();
    appState.isDirty  = true;
    _ideasSelectedId  = newId;
    _ideasFormDirty   = false;
    renderIdeasEditor();
}

function _emptyIdea() {
    return {
        _comment: '', picture: '', name: '',
        cost: null, removal_cost: null, level: null, ledger: '', traits: [],
        allowed: '', allowed_civil_war: '', allowed_to_remove: '',
        visible: '', available: '', cancel: '', do_effect: '',
        modifier: '', targeted_modifier: '', research_bonus: '',
        equipment_bonus: '', rule: '',
        on_add: '', on_remove: '', ai_will_do: '',
    };
}

// ── 아이디어 삭제 ────────────────────────────────────────
function _deleteIdea(id) {
    if (!confirm(`"${id}" 아이디어를 삭제하시겠습니까?`)) return;
    const fd  = currentFileData();
    const cat = fd?.categories[_ideasSelectedCat];
    if (!cat?.ideas?.[id]) return;

    saveSnapshot(`"${id}" 아이디어 삭제`);
    delete cat.ideas[id];
    appState.isDirty = true;

    if (_ideasSelectedId === id) {
        _ideasSelectedId = null;
        _ideasFormDirty  = false;
    }
    renderIdeasEditor();
}

// ── 카테고리 추가 ────────────────────────────────────────
function _addCategory() {
    const name = prompt('새 카테고리 이름 (예: country, hidden_ideas, my_category):');
    if (!name?.trim()) return;
    const catName = name.trim();
    const fd = currentFileData();
    if (!fd) return;
    if (fd.categories[catName]) { alert('이미 존재하는 카테고리입니다.'); return; }

    saveSnapshot('카테고리 추가');
    if (IDEAS_FULL_PARSE_CATS.has(catName)) {
        fd.categories[catName] = {
            _attrs: { law: false, designer: false, use_list_view: false },
            ideas: {}
        };
    } else {
        fd.categories[catName] = { _raw: '' };
    }
    appState.isDirty  = true;
    _ideasSelectedCat = catName;
    _ideasSelectedId  = null;
    _ideasFormDirty   = false;
    renderIdeasEditor();
}

// ── 파일 불러오기 ────────────────────────────────────────
function _ideasImportFile() {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.txt';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const parsed = parseIdeasFile(await file.text());
        if (!parsed) { alert('아이디어 파일 파싱 실패'); return; }
        const fd = currentFileData();
        if (!fd) return;
        saveSnapshot('파일 불러오기');
        fd.categories    = parsed.categories;
        appState.isDirty = true;
        const cats = Object.keys(fd.categories);
        _ideasSelectedCat = cats.includes('country') ? 'country' : (cats[0] || 'country');
        _ideasSelectedId  = null;
        _ideasFormDirty   = false;
        renderIdeasEditor();
    };
    input.click();
}

// ── 파일 내보내기 ────────────────────────────────────────
function _ideasExportFile() {
    _applyFormIfDirty();
    const fd = currentFileData();
    if (!fd) return;
    downloadBlob(buildIdeasTxt(fd), (appState.currentFile || 'ideas.txt').split('/').pop());
}

// ── 서버 저장 ────────────────────────────────────────────
async function _ideasSaveServer() {
    _applyFormIfDirty();
    const filePath = appState.currentFile;
    const fd       = currentFileData();
    if (!filePath || !fd) return;
    await _saveCurrentFileToServer(filePath, fd);
}

// ── RAW 편집 ─────────────────────────────────────────────
function _ideasRawEdit() {
    _applyFormIfDirty();
    const fd = currentFileData();
    if (!fd) return;
    const raw   = buildIdeasTxt(fd);
    const panel = document.getElementById('ideas-form-panel');
    const ph    = document.getElementById('ideas-placeholder');
    if (!panel) return;
    if (ph) ph.classList.add('hidden');
    panel.classList.remove('hidden');
    _ideasFormDirty = false;  // raw 편집 중엔 일반 폼 저장 안 함

    panel.innerHTML = `
        <div class="ideas-raw-edit-wrap">
            <div class="ideas-raw-toolbar">
                <strong class="ideas-raw-title">📄 파일 전체 RAW 편집</strong>
                <div class="ideas-raw-actions">
                    <button id="btn-ideas-raw-apply" class="primary">✅ 적용</button>
                    <button id="btn-ideas-raw-close" class="secondary">✕ 닫기</button>
                </div>
            </div>
            <textarea id="ideas-raw-textarea" class="raw-editor ideas-raw-fullarea">${escapeHtml(raw)}</textarea>
        </div>`;

    document.getElementById('btn-ideas-raw-apply')?.addEventListener('click', () => {
        const newRaw   = document.getElementById('ideas-raw-textarea')?.value || '';
        const reparsed = parseIdeasFile(newRaw);
        if (!reparsed) { alert('파싱 오류: 형식을 확인하세요'); return; }
        saveSnapshot('RAW 편집 적용');
        fd.categories    = reparsed.categories;
        appState.isDirty = true;
        _ideasSelectedId = null;
        _ideasFormDirty  = false;
        renderIdeasEditor();
    });

    document.getElementById('btn-ideas-raw-close')?.addEventListener('click', () => {
        _ideasSelectedId = null;
        _ideasFormDirty  = false;
        renderIdeasEditor();
    });
}

// ── 사이드바 토글 ────────────────────────────────────────
function _initIdeasSidebarToggle() {
    const panel = document.getElementById('ideas-left-panel');
    document.getElementById('btn-ideas-sidebar-toggle')?.addEventListener('click', () => panel?.classList.add('collapsed'));
    document.getElementById('btn-ideas-sidebar-expand')?.addEventListener('click', () => panel?.classList.remove('collapsed'));
}

// ── 이벤트 바인딩 (main.js에서 1회 호출) ────────────────
function setupIdeasEditorListeners() {
    document.getElementById('btn-ideas-back')?.addEventListener('click', () => {
        _applyFormIfDirty();
        switchView('explorer-view');
    });
    document.getElementById('btn-ideas-save-server')?.addEventListener('click', _ideasSaveServer);
    document.getElementById('btn-ideas-export')?.addEventListener('click', _ideasExportFile);
    document.getElementById('btn-ideas-import')?.addEventListener('click', _ideasImportFile);
    document.getElementById('btn-ideas-raw')?.addEventListener('click', _ideasRawEdit);
    document.getElementById('btn-new-idea')?.addEventListener('click', _addNewIdea);
    _initIdeasSidebarToggle();
}