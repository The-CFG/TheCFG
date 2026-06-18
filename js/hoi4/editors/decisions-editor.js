// ════════════════════════════════════════════════════════
//  decisions-editor.js — 디시전 / 디시전 카테고리 편집기
//  의존: state.js, io-parsers.js, decisions-form.js, cloud-ui.js
// ════════════════════════════════════════════════════════

let _decSelectedCat  = null;
let _decSelectedId   = null;
let _decFormDirty    = false;

function openDecisionsEditor(filePath) {
    appState.currentFile = filePath;
    const fd = currentFileData();
    if (!fd || (fd.type !== 'decisions' && fd.type !== 'decisions_category')) return;

    switchView('decisions-editor-view');

    const titleEl = document.getElementById('decisions-editor-title');
    if (titleEl) titleEl.textContent = filePath.split('/').pop();

    if (!fd.categories || !Object.keys(fd.categories).length) {
        fd.categories = {};
        if (fd.type === 'decisions') {
            fd.categories['new_category'] = { decisions: {} };
        } else {
            fd.categories['new_category'] = _emptyCategoryDef();
        }
    }

    const cats = Object.keys(fd.categories);
    _decSelectedCat = cats[0] || null;
    _decSelectedId  = null;
    _decFormDirty   = false;

    resetHistory();
    renderDecisionsEditor();
}

function renderDecisionsEditor() {
    const fd = currentFileData();
    if (!fd) return;

    if (_decSelectedCat && !fd.categories[_decSelectedCat]) {
        _decSelectedCat = Object.keys(fd.categories)[0] || null;
        _decSelectedId  = null;
        _decFormDirty   = false;
    }

    _renderDecCategoryTabs(fd);

    // 디시전 목록 영역: decisions 파일만 표시
    const isCatFile = fd.type === 'decisions_category';
    ['decisions-list-title', 'decisions-list', 'btn-new-decision'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isCatFile ? 'none' : '';
    });
    const statsEl = document.querySelector('.stats-info');
    if (statsEl) statsEl.style.display = isCatFile ? 'none' : '';
    const colAddBtn = document.querySelector('.collapsed-icons .col-icon-btn[title="새 디시전"]');
    if (colAddBtn) colAddBtn.style.display = isCatFile ? 'none' : '';

    if (fd.type === 'decisions') {
        _renderDecisionList(fd);
        _updateDecCount(fd);

        if (_decSelectedId) {
            const dec = fd.categories[_decSelectedCat]?.decisions?.[_decSelectedId];
            if (dec) {
                _showDecisionForm(fd);
            } else {
                _decSelectedId = null;
                _decFormDirty  = false;
                _hideDecForm();
            }
        } else {
            _hideDecForm();
        }
    } else {
        if (_decSelectedCat) {
            _showCategoryForm(fd);
        } else {
            _hideDecForm();
        }
    }
}

function _renderDecCategoryTabs(fd) {
    const container = document.getElementById('decisions-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(fd.categories || {}).forEach(catName => {
        const btn = document.createElement('button');
        btn.className = 'dec-cat-tab' + (_decSelectedCat === catName ? ' active' : '');
        btn.textContent = catName;
        btn.title = catName;
        btn.addEventListener('click', () => {
            _applyFormIfDirty();
            _decSelectedCat = catName;
            _decSelectedId  = null;
            _decFormDirty   = false;
            renderDecisionsEditor();
        });
        container.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'dec-cat-tab dec-cat-add';
    addBtn.textContent = '＋';
    addBtn.title = '카테고리 추가';
    addBtn.addEventListener('click', () => _addDecCategory(fd));
    container.appendChild(addBtn);
}

function _renderDecisionList(fd) {
    const container = document.getElementById('decisions-list');
    if (!container) return;
    container.innerHTML = '';

    const cat = fd.categories[_decSelectedCat];
    if (!cat) return;

    const decisions = cat.decisions || {};
    const ids = Object.keys(decisions);

    if (!ids.length) {
        const empty = document.createElement('div');
        empty.className = 'dec-list-empty';
        empty.textContent = '디시전 없음';
        container.appendChild(empty);
        return;
    }

    ids.forEach(id => {
        const dec  = decisions[id];
        const card = document.createElement('div');
        card.className = 'dec-card' + (_decSelectedId === id ? ' selected' : '');
        card.dataset.id = id;

        const isMission  = !!dec.days_mission_timeout;
        const isTargeted = !!(dec.targets || dec.target_array || dec.target_trigger || dec.target_root_trigger);
        const badges = [
            isMission  ? '<span class="dec-badge dec-badge-mission">미션</span>'   : '',
            isTargeted ? '<span class="dec-badge dec-badge-targeted">타게팅</span>' : '',
        ].join('');

        const decLocName = getLocalisedName(id);
        card.innerHTML = `
            <div class="dec-card-icon">⚖️</div>
            <div class="dec-card-info">
                <div class="dec-card-id">${escapeHtml(id)}</div>
                ${decLocName ? `<div class="dec-card-locname">${escapeHtml(decLocName)}</div>` : ''}
                ${badges ? `<div class="dec-card-badges">${badges}</div>` : ''}
            </div>`;
        card.addEventListener('click', () => _selectDecision(id));
        container.appendChild(card);

        // 아이콘 미리보기 — icon(GFX sprite name) → texturefile 찾아 비동기 렌더
        if (dec.icon) {
            const iconEl = card.querySelector('.dec-card-icon');
            const texturefile = getTexturefileBySpriteName(dec.icon);
            if (iconEl && texturefile) _renderSpritePreview(iconEl, texturefile, null);
        }
    });
}

function _updateDecCount(fd) {
    const el  = document.getElementById('decisions-count');
    if (!el) return;
    const cat = fd.categories[_decSelectedCat];
    el.textContent = Object.keys(cat?.decisions || {}).length;
}

function _selectDecision(id) {
    _applyFormIfDirty();
    _decSelectedId = id;
    document.querySelectorAll('.dec-card').forEach(c =>
        c.classList.toggle('selected', c.dataset.id === id));
    _showDecisionForm(currentFileData());
}

function _showDecisionForm(fd) {
    const ph    = document.getElementById('decisions-placeholder');
    const panel = document.getElementById('decisions-form-panel');
    if (!panel) return;
    if (ph) ph.classList.add('hidden');
    panel.classList.remove('hidden');
    const dec = fd.categories[_decSelectedCat]?.decisions?.[_decSelectedId];
    if (!dec) return;
    renderDecisionForm(panel, _decSelectedId, dec, _decSelectedCat);
    _decFormDirty = true;
}

function _showCategoryForm(fd) {
    const ph    = document.getElementById('decisions-placeholder');
    const panel = document.getElementById('decisions-form-panel');
    if (!panel) return;
    if (ph) ph.classList.add('hidden');
    panel.classList.remove('hidden');
    const cat = fd.categories[_decSelectedCat];
    if (!cat) return;
    renderDecisionCategoryForm(panel, _decSelectedCat, cat);
    _decFormDirty = true;
}

function _hideDecForm() {
    const ph    = document.getElementById('decisions-placeholder');
    const panel = document.getElementById('decisions-form-panel');
    if (ph)    ph.classList.remove('hidden');
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
    _decFormDirty = false;
}

function _applyFormIfDirty() {
    if (!_decFormDirty) return;
    const fd = currentFileData();
    if (!fd) return;
    if (fd.type === 'decisions' && _decSelectedId) {
        if (document.getElementById('dec-id')) _saveCurrentDecision(true);
    } else if (fd.type === 'decisions_category' && _decSelectedCat) {
        if (document.getElementById('dec-cat-id')) _saveCurrentCategory(true);
    }
}
window._formFlushHooks = window._formFlushHooks || [];
window._formFlushHooks.push(_applyFormIfDirty);

function _saveCurrentDecision(silent = false) {
    if (!_decSelectedId) return;
    const fd = currentFileData();
    if (!fd) return;
    const cat = fd.categories[_decSelectedCat];
    if (!cat?.decisions) return;
    if (!document.getElementById('dec-id')) return;

    const formData = extractDecisionFormData();
    if (!formData) return;

    const oldId = _decSelectedId;
    const newId = formData._id?.trim();
    delete formData._id;

    saveSnapshot(`"${oldId}" 디시전 수정`);

    if (newId && newId !== oldId) {
        const reordered = {};
        Object.entries(cat.decisions).forEach(([k, v]) => {
            reordered[k === oldId ? newId : k] = k === oldId ? { ...v, ...formData } : v;
        });
        cat.decisions  = reordered;
        _decSelectedId = newId;
    } else {
        cat.decisions[oldId] = { ...cat.decisions[oldId], ...formData };
    }

    appState.isDirty = true;
    if (!silent) { renderDecisionsEditor(); } else { _renderDecisionList(fd); _updateDecCount(fd); }
}

function _saveCurrentCategory(silent = false) {
    if (!_decSelectedCat) return;
    const fd = currentFileData();
    if (!fd) return;
    if (!document.getElementById('dec-cat-id')) return;

    const formData = extractDecisionCategoryFormData();
    if (!formData) return;

    const oldId = _decSelectedCat;
    const newId = formData._id?.trim();
    delete formData._id;

    saveSnapshot(`"${oldId}" 카테고리 수정`);

    if (newId && newId !== oldId) {
        const reordered = {};
        Object.entries(fd.categories).forEach(([k, v]) => {
            reordered[k === oldId ? newId : k] = k === oldId ? { ...v, ...formData } : v;
        });
        fd.categories   = reordered;
        _decSelectedCat = newId;
    } else {
        fd.categories[oldId] = { ...fd.categories[oldId], ...formData };
    }

    appState.isDirty = true;
    if (!silent) { renderDecisionsEditor(); } else { _renderDecCategoryTabs(fd); }
}

function _addNewDecision() {
    const fd = currentFileData();
    if (!fd || fd.type !== 'decisions') return;
    if (!_decSelectedCat) { alert('먼저 카테고리를 선택하세요.'); return; }
    _applyFormIfDirty();

    const cat = fd.categories[_decSelectedCat];
    if (!cat) return;

    let newId = 'new_decision';
    let n = 2;
    while (cat.decisions[newId]) newId = `new_decision_${n++}`;

    saveSnapshot('새 디시전 추가');
    cat.decisions[newId] = _emptyDecision();
    appState.isDirty = true;
    _decSelectedId   = newId;
    _decFormDirty    = false;
    renderDecisionsEditor();
}

function _addDecCategory(fd) {
    const name = prompt('새 카테고리 키 (예: my_category):');
    if (!name?.trim()) return;
    const catKey = name.trim();
    if (fd.categories[catKey]) { alert('이미 존재하는 카테고리입니다.'); return; }

    _applyFormIfDirty();
    saveSnapshot('카테고리 추가');

    fd.categories[catKey] = fd.type === 'decisions'
        ? { decisions: {} }
        : _emptyCategoryDef();

    appState.isDirty = true;
    _decSelectedCat  = catKey;
    _decSelectedId   = null;
    _decFormDirty    = false;
    renderDecisionsEditor();
}

function _deleteDecision(id) {
    if (!confirm(`"${id}" 디시전을 삭제하시겠습니까?`)) return;
    const fd  = currentFileData();
    const cat = fd?.categories[_decSelectedCat];
    if (!cat?.decisions?.[id]) return;

    saveSnapshot(`"${id}" 디시전 삭제`);
    delete cat.decisions[id];
    appState.isDirty = true;
    if (_decSelectedId === id) { _decSelectedId = null; _decFormDirty = false; }
    renderDecisionsEditor();
}

function _deleteDecCategory(catKey) {
    if (!confirm(`"${catKey}" 카테고리를 삭제하시겠습니까?`)) return;
    const fd = currentFileData();
    if (!fd?.categories[catKey]) return;

    saveSnapshot(`"${catKey}" 카테고리 삭제`);
    delete fd.categories[catKey];
    appState.isDirty = true;

    const remaining = Object.keys(fd.categories);
    _decSelectedCat = remaining[0] || null;
    _decSelectedId  = null;
    _decFormDirty   = false;
    renderDecisionsEditor();
}

function _emptyDecision() {
    return {
        icon: '', cost: '', priority: '',
        fire_only_once: false, fixed_random_seed: false,
        days_remove: '', days_re_enable: '',
        days_mission_timeout: '', selectable_mission: false,
        is_good: false,
        war_with_on_complete: '', war_with_on_remove: '', war_with_on_timeout: '',
        ai_hint_pp_cost: '', custom_cost_text: '',
        cancel_if_not_visible: false,
        targets: '', targets_dynamic: false,
        target_non_existing: false, target_array: '',
        allowed: '', activation: '',
        target_root_trigger: '', target_trigger: '',
        visible: '', available: '',
        cancel_trigger: '', remove_trigger: '',
        custom_cost_trigger: '',
        complete_effect: '', remove_effect: '',
        cancel_effect: '', timeout_effect: '',
        modifier: '', targeted_modifier: '',
        ai_will_do: '', highlight_states: '',
    };
}

function _emptyCategoryDef() {
    return {
        icon: '', picture: '', visible_when_empty: false,
        scripted_gui: '', priority: '',
        allowed: '', visible: '', available: '',
        highlight_states: '', on_map_area: '',
    };
}

function _decImportFile() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.txt';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const fd = currentFileData();
        if (!fd) return;
        const text   = await file.text();
        const parsed = fd.type === 'decisions_category'
            ? parseDecisionCategoriesFile(text)
            : parseDecisionsFile(text);
        if (!parsed) { alert('파싱 실패: 파일 형식을 확인하세요.'); return; }
        saveSnapshot('파일 불러오기');
        fd.categories    = parsed.categories;
        appState.isDirty = true;
        _decSelectedCat  = Object.keys(fd.categories)[0] || null;
        _decSelectedId   = null;
        _decFormDirty    = false;
        renderDecisionsEditor();
    };
    input.click();
}

function _decExportFile() {
    _applyFormIfDirty();
    const fd = currentFileData();
    if (!fd) return;
    const txt = fd.type === 'decisions_category'
        ? buildDecisionCategoriesTxt(fd)
        : buildDecisionsTxt(fd);
    downloadBlob(txt, (appState.currentFile || 'decisions.txt').split('/').pop());
}

async function _decSaveServer() {
    _applyFormIfDirty();
    const filePath = appState.currentFile;
    const fd       = currentFileData();
    if (!filePath || !fd) return;
    await _saveCurrentFileToServer(filePath, fd);
}

function _decRawEdit() {
    _applyFormIfDirty();
    const fd = currentFileData();
    if (!fd) return;

    const raw = fd.type === 'decisions_category'
        ? buildDecisionCategoriesTxt(fd)
        : buildDecisionsTxt(fd);

    const ph    = document.getElementById('decisions-placeholder');
    const panel = document.getElementById('decisions-form-panel');
    if (!panel) return;
    if (ph) ph.classList.add('hidden');
    panel.classList.remove('hidden');
    _decFormDirty = false;

    panel.innerHTML = `
        <div class="dec-raw-wrap">
            <div class="dec-raw-toolbar">
                <strong class="dec-raw-title">📄 파일 전체 RAW 편집</strong>
                <div class="dec-raw-actions">
                    <button id="btn-dec-raw-apply">✅ 적용</button>
                    <button id="btn-dec-raw-close" class="secondary">✕ 닫기</button>
                </div>
            </div>
            <textarea id="dec-raw-textarea" class="raw-editor dec-raw-fullarea">${escapeHtml(raw)}</textarea>
        </div>`;

    document.getElementById('btn-dec-raw-apply')?.addEventListener('click', () => {
        const newRaw   = document.getElementById('dec-raw-textarea')?.value || '';
        const reparsed = fd.type === 'decisions_category'
            ? parseDecisionCategoriesFile(newRaw)
            : parseDecisionsFile(newRaw);
        if (!reparsed) { alert('파싱 오류: 형식을 확인하세요.'); return; }
        saveSnapshot('RAW 편집 적용');
        fd.categories    = reparsed.categories;
        appState.isDirty = true;
        _decSelectedId   = null;
        _decFormDirty    = false;
        renderDecisionsEditor();
    });

    document.getElementById('btn-dec-raw-close')?.addEventListener('click', () => {
        _decSelectedId = null;
        _decFormDirty  = false;
        renderDecisionsEditor();
    });
}

function _initDecSidebarToggle() {
    const panel = document.getElementById('decisions-left-panel');
    document.getElementById('btn-dec-sidebar-toggle')?.addEventListener('click',
        () => panel?.classList.add('collapsed'));
    document.getElementById('btn-dec-sidebar-expand')?.addEventListener('click',
        () => panel?.classList.remove('collapsed'));
}

function setupDecisionsEditorListeners() {
    document.getElementById('btn-dec-back')?.addEventListener('click', () => {
        _applyFormIfDirty();
        switchView('explorer-view');
    });
    document.getElementById('btn-dec-save-server')?.addEventListener('click', _decSaveServer);
    document.getElementById('btn-dec-export')?.addEventListener('click', _decExportFile);
    document.getElementById('btn-dec-import')?.addEventListener('click', _decImportFile);
    document.getElementById('btn-dec-raw')?.addEventListener('click', _decRawEdit);
    document.getElementById('btn-new-decision')?.addEventListener('click', _addNewDecision);
    _initDecSidebarToggle();
}