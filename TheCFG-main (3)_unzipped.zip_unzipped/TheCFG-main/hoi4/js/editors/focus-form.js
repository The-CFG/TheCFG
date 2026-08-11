// ════════════════════════════════════════════════════════
//  focus-form.js — 공용 상수, 폼 생성/추출, 자동완성,
//                  툴바, 패널 리스너, 임포트
//  의존: state.js, io-parsers.js, cloud-ui.js
//  focus-editor.js보다 먼저 로드됨
// ════════════════════════════════════════════════════════
//  editor.js — 국가중점 파일 편집기
//  의존: state.js, io.js, explorer.js
// ════════════════════════════════════════════════════════

const GRID_SCALE_X = 80;
const GRID_SCALE_Y = 100;

// ── Search Filter 목록 ───────────────────────────────────
const SEARCH_FILTERS = [
    'FOCUS_FILTER_POLITICAL',
    'FOCUS_FILTER_RESEARCH',
    'FOCUS_FILTER_INDUSTRY',
    'FOCUS_FILTER_STABILITY',
    'FOCUS_FILTER_WAR_SUPPORT',
    'FOCUS_FILTER_MANPOWER',
    'FOCUS_FILTER_ANNEXATION',
    'FOCUS_FILTER_HISTORICAL',
    'FOCUS_FILTER_INTERNATIONAL_TRADE',
    'FOCUS_FILTER_ARMY_XP',
    'FOCUS_FILTER_NAVY_XP',
    'FOCUS_FILTER_AIR_XP',
    'FOCUS_FILTER_TFV_AUTONOMY',
    'FOCUS_FILTER_POLITICAL_CHARACTER',
    'FOCUS_FILTER_MILITARY_CHARACTER',
    'FOCUS_FILTER_INTERNAL_AFFAIRS',
    'FOCUS_FILTER_FRA_POLITICAL_VIOLENCE',
    'FOCUS_FILTER_PROPAGANDA',
    'FOCUS_FILTER_FRA_OCCUPATION_COST',
    'FOCUS_FILTER_CHI_INFLATION',
    'FOCUS_FILTER_BALANCE_OF_POWER',
    'FOCUS_FILTER_SWI_MILITARY_READINESS',
    'FOCUS_FILTER_USA_CONGRESS',
    'FOCUS_FILTER_MEX_CHURCH_AUTHORITY',
    'FOCUS_FILTER_MEX_CAUDILLO_REBELLION',
    'FOCUS_FILTER_SPA_CIVIL_WAR',
    'FOCUS_FILTER_SPA_CARLIST_UPRISING',
    'FOCUS_FILTER_TUR_KURDISTAN',
    'FOCUS_FILTER_TUR_KEMALISM',
    'FOCUS_FILTER_TUR_TRADITIONALISM',
    'FOCUS_FILTER_GRE_DEBT_TO_IFC',
    'FOCUS_FILTER_SOV_POLITICAL_PARANOIA',
    'FOCUS_FILTER_ITA_MISSIOLINI',
    'FOCUS_FILTER_FOLKHEMMET',
];

// escapeHtml 은 core/io-parsers.js 에 정의됩니다.

// ── ai_will_do 헬퍼 ──────────────────────────────────────
// 기존 rawText에서 factor 값만 추출 (없으면 0)
function _parseAiWillDoFactor(rawText) {
    if (!rawText) return 0;
    const m = rawText.match(/factor\s*=\s*([\d.]+)/);
    return m ? Math.min(100, Math.max(0, Math.round(parseFloat(m[1])))) : 0;
}
// factor 값 → ai_will_do rawText 빌드
function _buildAiWillDo(factor) {
    return `factor = ${factor}`;
}


// ── 중점 노드 표시 모드 ('id' | 'localisation') ─────────
let _focusNodeDisplayMode = 'id';

function getFocusNodeLabel(focus) {
    if (_focusNodeDisplayMode === 'localisation') {
        // 프로젝트 내 모든 loc 파일에서 이름 탐색
        for (const fd of Object.values(appState.project.files)) {
            if (fd.type !== 'localisation' || fd._stub || !fd.data) continue;
            const entry = fd.data[focus.id];
            const name  = typeof entry === 'object' ? entry?.name : entry;
            if (name?.trim()) return name;
        }
        // 없으면 focus.name, 그것도 없으면 id
        return focus.name || focus.id;
    }
    return focus.id;
}
// 프로젝트 내 모든 로컬라이제이션 파일에서 focusId에 해당하는 name을 찾아 반영
function applyLocToFocus(focusId, fd) {
    const focus = fd?.focuses[focusId];
    if (!focus) return;
    for (const filePath of Object.keys(appState.project.files)) {
        const locFile = appState.project.files[filePath];
        if (locFile.type !== 'localisation' || locFile._stub || !locFile.data) continue;
        const entry = locFile.data[focusId];
        const name  = typeof entry === 'object' ? entry?.name : entry;
        if (name?.trim()) { focus.name = name; return; }
    }
}

function applyLocToAllFocuses(fd) {
    if (!fd) return;
    Object.keys(fd.focuses).forEach(id => applyLocToFocus(id, fd));
}

// ── 편집기 툴바 설정 ─────────────────────────────────────
function setupFocusEditorToolbar() {
    const fd       = currentFileData();
    const filename = appState.currentFile?.split('/').pop() || '';
    const titleEl  = document.getElementById('focus-editor-title');
    if (titleEl) titleEl.textContent = filename;

    // 누적 리스너 방지: 각 버튼을 클론으로 교체
    const _rebind = id => {
        const el = document.getElementById(id);
        if (!el) return null;
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        return clone;
    };

    _rebind('btn-focus-back')
        ?.addEventListener('click', async () => {
            closeEditorPanel();
            // 변경사항이 있고 로그인된 경우 자동 서버 저장
            if (appState.isDirty && appState.currentFile && appState.project.name) {
                const user = await CloudAuth.getUser().catch(() => null);
                if (user) {
                    try {
                        await CloudAuth.saveOneFile(appState.project.name, appState.currentFile, fd);
                        appState.isDirty = false;
                        _showSaveToast(`저장됨: ${appState.currentFile.split('/').pop()}`);
                    } catch (e) {
                        console.warn('자동 저장 실패:', e.message);
                    }
                }
            }
            switchView('explorer-view');
            renderExplorer();
        });
    _rebind('btn-focus-save-server')
        ?.addEventListener('click', () => {
            if (!fd || !appState.currentFile) return;
            _saveCurrentFileToServer(appState.currentFile, fd);
        });
    _rebind('btn-focus-save-file')
        ?.addEventListener('click', () => {
            if (!fd) return;
            downloadBlob(buildFocusTxt(fd), filename);
        });
    _rebind('btn-focus-import-file')
        ?.addEventListener('click', () => _focusImportFile());
    _rebind('btn-focus-raw-edit')
        ?.addEventListener('click', () => {
            if (!appState.currentFile) return;
            const fd = currentFileData();
            if (!fd) return;

            // main-content 기준 absolute — center-panel 스크롤 위치와 무관하게
            // 항상 편집 영역 전체를 덮음
            const mountEl = document.querySelector('.main-content');
            if (!mountEl) return;
            let overlay = document.getElementById('focus-raw-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'focus-raw-overlay';
                overlay.style.cssText = [
                    'position:absolute;inset:0;z-index:50;',
                    'background:var(--bg-editor,#161a1d);',
                    'display:flex;flex-direction:column;padding:16px;box-sizing:border-box;',
                    'overflow:auto;',
                ].join('');
                mountEl.appendChild(overlay);
            }
            overlay.style.display = 'flex';

            _renderRawWithReturn(
                overlay,
                appState.currentFile,
                fd,
                buildFocusTxt(fd),
                (newRaw) => {
                    let parsed;
                    try { parsed = parseFocusFile(newRaw); }
                    catch (e) { return { ok: false, msg: e.message }; }
                    if (!parsed) return { ok: false, msg: 'focus_tree 블록을 찾을 수 없습니다.' };
                    // appState에 직접 반영 (fd 참조 의존 없이)
                    appState.project.files[appState.currentFile] = {
                        ...appState.project.files[appState.currentFile],
                        focuses:  parsed.focuses,
                        settings: parsed.settings,
                    };
                    appState.isDirty = true;
                    return { ok: true };
                },
                () => {
                    overlay.style.display = 'none';
                    renderFocusTree();
                },
                // 실시간 미리보기 콜백
                (newRaw) => {
                    try {
                        const parsed = parseFocusFile(newRaw);
                        if (!parsed) return;
                        appState.project.files[appState.currentFile] = {
                            ...appState.project.files[appState.currentFile],
                            focuses:  parsed.focuses,
                            settings: parsed.settings,
                        };
                        appState.isDirty = true;
                        renderFocusTree();
                    } catch(e) { /* 파싱 중 오류는 무시 — 타이핑 중 발생 가능 */ }
                }
            );
        });
    _rebind('btn-new-focus')
        ?.addEventListener('click', () => openEditorPanel('new'));
    _rebind('btn-tree-settings')
        ?.addEventListener('click', () => openEditorPanel('settings'));
    _rebind('btn-undo')
        ?.addEventListener('click', undo);
    _rebind('btn-redo')
        ?.addEventListener('click', redo);

    // 노드 표시 모드 라디오 — 클론으로 기존 리스너 제거 후 재등록
    document.querySelectorAll('input[name="node-display"]').forEach(radio => {
        const clone = radio.cloneNode(true);
        radio.parentNode.replaceChild(clone, radio);
        clone.checked = (clone.value === _focusNodeDisplayMode);
        clone.addEventListener('change', () => {
            _focusNodeDisplayMode = clone.value;
            renderFocusTree();
        });
    });
}

// ── 파일 내 불러오기 (덮어쓰기 / 병합) ──────────────────
function _focusImportFile() {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.txt';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const content = await file.text();
        const parsed  = parseFocusFile(content);
        if (!parsed) { alert('유효한 국가중점 파일이 아닙니다.'); return; }

        const fd = currentFileData();
        if (!fd) return;

        const hasExisting = Object.keys(fd.focuses).length > 0;
        const merge = hasExisting && confirm(
            '기존 중점이 있습니다.\n[확인] 병합 (중복 ID는 새 것으로)\n[취소] 덮어쓰기'
        );
        saveSnapshot('파일 불러오기');
        if (merge) {
            Object.assign(fd.focuses, parsed.focuses);
        } else {
            fd.focuses  = parsed.focuses;
            fd.settings = parsed.settings;
        }
        appState.isDirty = true;
        renderFocusTree();
        CloudAuth.saveProject(appState.project.name).catch(console.error);
        alert(`불러오기 완료 (중점 ${Object.keys(parsed.focuses).length}개)`);
    };
    input.click();
}

// ── 드로어 패널 ─────────────────────────────────────────
// 현재 패널 모드 ('new' | 'edit' | 'settings' | null)
let _panelMode = null;

function openEditorPanel(mode, focusId = null) {
    const panel   = document.getElementById('editor-drawer-panel');
    const titleEl = document.getElementById('panel-title');
    const content = document.getElementById('panel-content');
    if (!panel) return;

    _panelMode = mode;
    const fd    = currentFileData();
    appState.selectedFocusId = focusId;

    // 헤더 삭제 버튼: edit 모드에서만 표시
    const delBtn = document.getElementById('btn-panel-delete');
    if (delBtn) delBtn.style.display = (mode === 'edit') ? '' : 'none';

    // 목차: new/edit 모드에서만 표시
    const tocEl = document.getElementById('panel-toc');
    if (tocEl) tocEl.style.display = (mode === 'new' || mode === 'edit') ? '' : 'none';

    switch (mode) {
        case 'new':
            titleEl.textContent = '새 중점 만들기';
            content.innerHTML   = generateFocusForm({});
            setupAutocomplete();
            _initChipUIs({});
            break;
        case 'edit': {
            const focus = fd?.focuses[focusId];
            titleEl.textContent = `${focusId}`;
            content.innerHTML   = generateFocusForm(focus || {});
            setupAutocomplete();
            _initChipUIs(focus || {});
            break;
        }
        case 'settings':
            titleEl.textContent = '계통도 설정';
            content.innerHTML   = generateSettingsForm(fd?.settings || {});
            setupSettingsListeners();
            break;
    }
    panel.classList.add('open');
}

function closeEditorPanel() {
    _panelMode = null;
    document.getElementById('editor-drawer-panel')?.classList.remove('open');
    if (appState.selectedFocusId) {
        document.querySelector(`[data-id="${appState.selectedFocusId}"]`)
            ?.classList.remove('selected');
    }
    appState.selectedFocusId = null;
}

// ── 설정 폼 ──────────────────────────────────────────────
function generateSettingsForm(s = {}) {
    return `
        <h4>기본 설정</h4>
        <div class="form-group">
            <label for="cfg-tree-id">Focus Tree ID</label>
            <input type="text" id="cfg-tree-id" value="${escapeHtml(s.treeId || '')}" placeholder="my_focus_tree">
        </div>
        <div class="form-group">
            <label for="cfg-country-tag">국가 태그</label>
            <input type="text" id="cfg-country-tag" value="${escapeHtml(s.countryTag || '')}" maxlength="3" placeholder="GEN">
        </div>
        <div class="form-group-checkbox">
            <label><input type="checkbox" id="cfg-default-tree" ${s.defaultTree ? 'checked' : ''}> 기본 중점 트리 (Default)</label>
            <small>전체에서 단 하나의 트리만 기본으로 설정</small>
        </div>
        <div class="form-group">
            <label for="cfg-shared-focuses">공유 중점</label>
            <input type="text" id="cfg-shared-focuses" value="${escapeHtml((s.sharedFocuses || []).join(', '))}">
        </div>
        <hr>
        <h4>연속 중점</h4>
        <div class="form-group-checkbox">
            <label><input type="checkbox" id="cfg-continuous-focus" ${s.continuousFocusPosition ? 'checked' : ''}> 연속 중점 표시</label>
        </div>
        <div class="form-group">
            <label>X</label><input type="number" id="cfg-continuous-x" value="${s.continuousX ?? 50}">
        </div>
        <div class="form-group">
            <label>Y</label><input type="number" id="cfg-continuous-y" value="${s.continuousY ?? 2740}">
        </div>
        <hr>
        <h4>기타</h4>
        <div class="form-group-checkbox">
            <label><input type="checkbox" id="cfg-reset-civilwar" ${s.resetOnCivilwar !== false ? 'checked' : ''}> 내전 시 초기화</label>
        </div>
        <div class="form-group">
            <label>초기 표시 X</label><input type="number" id="cfg-initial-x" value="${s.initialShowX ?? 0}">
        </div>
        <div class="form-group">
            <label>초기 표시 Y</label><input type="number" id="cfg-initial-y" value="${s.initialShowY ?? 0}">
        </div>
        <div class="form-actions">
            <button id="btn-settings-close" class="secondary">닫기</button>
        </div>
    `;
}

function setupSettingsListeners() {
    const fd = currentFileData();
    if (!fd) return;
    const s  = fd.settings;
    const bind = (id, prop, transform) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', e => {
            s[prop] = transform(e.target);
            appState.isDirty = true;
        });
    };
    bind('cfg-tree-id',          'treeId',                  e => e.value);
    bind('cfg-country-tag',      'countryTag',              e => e.value.toUpperCase());
    bind('cfg-default-tree',     'defaultTree',             e => e.checked);
    bind('cfg-shared-focuses',   'sharedFocuses',           e => e.value.split(',').map(v => v.trim()).filter(Boolean));
    bind('cfg-continuous-focus', 'continuousFocusPosition', e => e.checked);
    bind('cfg-continuous-x',     'continuousX',             e => parseInt(e.value) || 50);
    bind('cfg-continuous-y',     'continuousY',             e => parseInt(e.value) || 2740);
    bind('cfg-reset-civilwar',   'resetOnCivilwar',         e => e.checked);
    bind('cfg-initial-x',        'initialShowX',            e => { const v = parseInt(e.value); return isNaN(v) ? 0 : v; });
    bind('cfg-initial-y',        'initialShowY',            e => { const v = parseInt(e.value); return isNaN(v) ? 0 : v; });

    {
        const el = document.getElementById('btn-settings-close');
        if (el) {
            const c = el.cloneNode(true);
            el.parentNode.replaceChild(c, el);
            c.addEventListener('click', closeEditorPanel);
        }
    }
}

// ── 자동완성 ─────────────────────────────────────────────
// 자동완성 정리용 AbortController — setupAutocomplete 재호출 시 이전 리스너 제거
let _autocompleteAbort = null;

function setupAutocomplete() {
    // 이전 자동완성 document 리스너 전부 제거
    if (_autocompleteAbort) _autocompleteAbort.abort();
    _autocompleteAbort = new AbortController();
    const _sig = _autocompleteAbort.signal;

    const fd = currentFileData();
    const setup = (inputId, dropdownId) => {
        const input    = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        if (!input || !dropdown) return;
        let selIdx = -1;

        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            selIdx  = -1;
            if (!q) { dropdown.classList.remove('active'); return; }
            const matches = Object.values(fd?.focuses || {})
                .filter(f => f.id !== appState.selectedFocusId &&
                    (f.id.toLowerCase().includes(q) || (f.name || '').toLowerCase().includes(q)))
                .slice(0, 10);
            if (!matches.length) { dropdown.classList.remove('active'); return; }
            dropdown.innerHTML = matches.map((f, i) =>
                `<div class="autocomplete-item" data-index="${i}" data-id="${escapeHtml(f.id)}">
                    <span class="autocomplete-item-id">${escapeHtml(f.id)}</span>
                    ${f.name !== f.id ? `<span class="autocomplete-item-name">${escapeHtml(f.name || '')}</span>` : ''}
                </div>`
            ).join('');
            dropdown.classList.add('active');
            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', () => {
                    input.value = item.dataset.id;
                    dropdown.classList.remove('active');
                });
            });
        });
        input.addEventListener('keydown', e => {
            const items = [...dropdown.querySelectorAll('.autocomplete-item')];
            if (!items.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); }
            if (e.key === 'Enter' && selIdx >= 0) { input.value = items[selIdx].dataset.id; dropdown.classList.remove('active'); }
            if (e.key === 'Escape') dropdown.classList.remove('active');
            items.forEach((it, i) => it.classList.toggle('selected', i === selIdx));
        });
        document.addEventListener('click', e => {
            if (!input.contains(e.target) && !dropdown.contains(e.target))
                dropdown.classList.remove('active');
        }, { capture: true, signal: _sig });
    };
    setup('focus-relative-position-id', 'relative-dropdown');
    // prerequisite, ME는 칩 UI가 직접 autocomplete 처리 — 별도 setup 불필요

    // Search Filters 자동완성은 focus-chips.js의 renderSearchFilterChips()로 처리

    // ── 로컬라이징 확인 버튼 (토글) ──────────────────────
    const _locPreviewState = { open: false };

    document.getElementById('btn-check-localisation')?.addEventListener('click', () => {
        const focusId  = document.getElementById('focus-id')?.value.trim();
        const wrapper  = document.getElementById('localisation-preview-wrapper');
        const preview  = document.getElementById('localisation-preview');
        const arrow    = document.getElementById('loc-preview-arrow');
        if (!wrapper || !preview) return;

        // 이미 열려있고 같은 ID면 토글로 닫기
        if (_locPreviewState.open && _locPreviewState.lastId === focusId) {
            _locPreviewState.open = false;
            const hdrClose = document.getElementById('loc-preview-header');
            if (hdrClose) hdrClose.style.display = 'none';
            wrapper.style.display = 'none';
            if (arrow) arrow.textContent = '▸';
            return;
        }

        if (!focusId) {
            _locPreviewState.open = true;
            _locPreviewState.lastId = focusId;
            const hdr = document.getElementById('loc-preview-header');
            if (hdr) hdr.style.display = 'block';
            wrapper.style.display = 'block';
            if (arrow) arrow.textContent = '▾';
            preview.innerHTML = '<div style="padding:10px 12px;color:var(--text-muted);font-size:13px;">ID를 먼저 입력해주세요.</div>';
            return;
        }

        // 모든 로컬라이제이션 파일에서 해당 ID 검색
        const results = [];
        Object.values(appState.project.files).forEach(locFile => {
            if (locFile.type !== 'localisation' || locFile._stub || !locFile.data) return;
            const entry = locFile.data[focusId];
            if (!entry) return;
            const name = typeof entry === 'object' ? entry.name || '' : entry || '';
            const desc = typeof entry === 'object' ? entry.desc || '' : '';
            if (name || desc) results.push({ lang: locFile.lang, name, desc });
        });

        _locPreviewState.open   = true;
        _locPreviewState.lastId = focusId;
        const hdr2 = document.getElementById('loc-preview-header');
        if (hdr2) hdr2.style.display = 'block';
        wrapper.style.display   = 'block';
        if (arrow) arrow.textContent = '▾';

        if (!results.length) {
            preview.innerHTML = `
                <div style="padding:10px 12px;color:var(--text-muted);font-size:13px;font-style:italic;">
                    일치하는 내용 없음
                </div>`;
            return;
        }

        const langLabel = lang => ({
            english:'영어', korean:'한국어', japanese:'일본어', german:'독일어',
            french:'프랑스어', spanish:'스페인어', russian:'러시아어', polish:'폴란드어',
            braz_por:'포르투갈어', simp_chinese:'중국어 간체'
        }[lang] || lang);

        preview.innerHTML = results.map((r, i) => `
            <div style="padding:8px 12px;${i > 0 ? 'border-top:1px solid var(--border);' : ''}">
                <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px;">
                    ${escapeHtml(langLabel(r.lang))}
                </div>
                <div style="font-size:13px;color:var(--text-primary);margin-bottom:${r.desc ? '3px' : '0'};">
                    ${r.name ? escapeHtml(r.name) : '<span style="color:var(--text-muted);font-style:italic;">이름 없음</span>'}
                </div>
                ${r.desc ? `<div style="font-size:12px;color:var(--text-muted);">${escapeHtml(r.desc)}</div>` : ''}
            </div>
        `).join('');
    });

    // 접기 헤더 클릭 이벤트
    document.getElementById('loc-preview-header')?.addEventListener('click', () => {
        const wrapper = document.getElementById('localisation-preview-wrapper');
        const arrow   = document.getElementById('loc-preview-arrow');
        if (!wrapper) return;
        _locPreviewState.open = !_locPreviewState.open;
        wrapper.style.display = _locPreviewState.open ? 'block' : 'none';
        if (arrow) arrow.textContent = _locPreviewState.open ? '▾' : '▸';
    });

    // 목차 클릭 → 해당 섹션으로 스크롤
    document.querySelectorAll('.toc-item').forEach(item => {
        item.addEventListener('click', () => {
            const target = document.getElementById(item.dataset.target);
            const panel  = document.getElementById('panel-content');
            if (target && panel) {
                panel.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
            }
        });
    });
}

// ── 칩 UI 초기화 ─────────────────────────────────────────
function _initChipUIs(focusData) {
    const preContainer = document.getElementById('prerequisite-chips-container');
    const meContainer  = document.getElementById('me-chips-container');
    const sfContainer  = document.getElementById('focus-search-filters-chips');
    if (preContainer) renderPrerequisiteChips(preContainer, focusData.prerequisite || []);
    if (meContainer)  renderMEChips(meContainer, focusData.mutually_exclusive || []);
    if (sfContainer)  renderSearchFilterChips(sfContainer, focusData.search_filters || []);

    // ScriptBlock 에디터 초기화
    const sbFields = [
        { containerId: 'focus-available-block',           fieldId: 'focus-available',       raw: focusData.available,              type: 'trigger' },
        { containerId: 'focus-bypass-block',              fieldId: 'focus-bypass',           raw: focusData.bypass,                 type: 'trigger' },
        { containerId: 'focus-cancel-block',              fieldId: 'focus-cancel',           raw: focusData.cancel,                 type: 'trigger' },
        { containerId: 'focus-allow-branch-block',        fieldId: 'focus-allow-branch',     raw: focusData.allow_branch,           type: 'trigger' },
        { containerId: 'focus-offset-trigger-block',      fieldId: 'focus-offset-trigger',   raw: focusData.offset?.trigger || '', type: 'trigger' },
        { containerId: 'focus-complete-effect-block',     fieldId: 'focus-complete-effect',  raw: focusData.complete_effect,        type: 'effect'  },
        { containerId: 'focus-select-effect-block',       fieldId: 'focus-select-effect',    raw: focusData.select_effect,          type: 'effect'  },
        { containerId: 'focus-historical-ai-block',       fieldId: 'focus-historical-ai',    raw: focusData.historical_ai,          type: 'mixed'   },
    ];
    sbFields.forEach(({ containerId, fieldId, raw, type }) => {
        const container = document.getElementById(containerId);
        if (container) renderScriptBlock(container, fieldId, raw || '', type);
    });

    // ai_will_do 슬라이더 연동
    const rangeEl = document.getElementById('focus-ai-factor-range');
    const numEl   = document.getElementById('focus-ai-factor-num');
    if (rangeEl && numEl) {
        rangeEl.addEventListener('input', () => { numEl.value = rangeEl.value; });
        numEl.addEventListener('input', () => {
            let v = Math.max(0, Math.min(100, parseInt(numEl.value) || 0));
            numEl.value = v; rangeEl.value = v;
        });
    }
}

// ── 중점 폼 생성 ─────────────────────────────────────────
function generateFocusForm(focusData) {
    const v   = val => escapeHtml(val ?? '');
    const chk = val => val ? 'checked' : '';
    const cb  = (id, label, val) =>
        `<div class="form-group-checkbox"><label><input type="checkbox" id="${id}" ${chk(val)}> ${label}</label></div>`;
    const fmtPre = (pre = []) => pre.map(p => Array.isArray(p) ? `[${p.join(', ')}]` : p).join(', ');

    const btns = focusData.id
        ? `<button id="btn-apply-changes">적용</button>
           <button id="btn-confirm-changes" class="btn-export">적용하고 닫기</button>
           <button id="btn-cancel-changes" class="secondary">취소</button>`
        : `<button id="btn-apply-changes">생성</button>
           <button id="btn-cancel-changes" class="secondary">취소</button>`;

    return `
        <!-- 기본 정보 -->
        <section id="fsec-basic" class="focus-form-section">
        <h4>기본 정보</h4>
        <div class="form-group">
            <label>ID (필수)</label>
            <input type="text" id="focus-id" value="${v(focusData.id)}" placeholder="my_focus_id">
            ${focusData.id ? '<small class="form-hint">⚠ ID 변경 시 참조가 자동 업데이트됩니다.</small>' : ''}
        </div>
        <div class="form-group">
            <label>아이콘 (GFX Key)</label>
            <input type="text" id="focus-icon" value="${v(focusData.icon) || 'GFX_goal_unknown'}" placeholder="GFX_goal_generic_...">
        </div>
        ${cb('focus-dynamic-icon', '동적 아이콘 (Dynamic)', focusData.dynamic)}
        <div class="form-group">
            <label>주석 (# 메모)</label>
            <input type="text" id="focus-comment" value="${v(focusData._comment)}" placeholder="파일에 # 주석으로 저장됩니다">
        </div>
        <div class="form-group">
            <button type="button" id="btn-check-localisation" class="btn-loc-check" style="width:100%;margin-top:4px;">🌐 로컬라이징 확인</button>
            <div id="loc-preview-header" style="display:none;cursor:pointer;padding:5px 10px;background:var(--bg-secondary);border:1px solid var(--border);border-bottom:none;border-radius:6px 6px 0 0;font-size:12px;color:var(--text-muted);user-select:none;">
                <span id="loc-preview-arrow">▾</span> 언어별 로컬라이징
            </div>
            <div id="localisation-preview-wrapper" style="display:none;border:1px solid var(--border);border-radius:0 0 6px 6px;overflow:hidden;">
                <div id="localisation-preview"></div>
            </div>
        </div>
        </section>
        <hr>

        <!-- 좌표 및 시간 -->
        <section id="fsec-coord" class="focus-form-section">
        <h4>좌표 및 시간</h4>
        <div class="form-group">
            <label>완료 시간 (Cost, 주)</label>
            <div class="num-input-row">
                <button type="button" class="num-step" data-target="focus-cost" data-delta="-1">−</button>
                <input type="number" id="focus-cost" value="${focusData.cost ?? 10}" min="1">
                <button type="button" class="num-step" data-target="focus-cost" data-delta="1">+</button>
            </div>
            <small class="form-hint">1주 = 7일, 기본 10주</small>
        </div>
        <div class="form-group"><label>X 좌표</label>
            <div class="num-input-row">
                <button type="button" class="num-step" data-target="focus-x" data-delta="-1">−</button>
                <input type="number" id="focus-x" value="${focusData.x ?? 0}">
                <button type="button" class="num-step" data-target="focus-x" data-delta="1">+</button>
            </div>
        </div>
        <div class="form-group"><label>Y 좌표</label>
            <div class="num-input-row">
                <button type="button" class="num-step" data-target="focus-y" data-delta="-1">−</button>
                <input type="number" id="focus-y" value="${focusData.y ?? 0}">
                <button type="button" class="num-step" data-target="focus-y" data-delta="1">+</button>
            </div>
        </div>
        <div class="form-group">
            <label>상대 위치 기준 ID</label>
            <div class="autocomplete-container">
                <input type="text" id="focus-relative-position-id" value="${v(focusData.relative_position_id)}" placeholder="다른 중점 ID" autocomplete="off">
                <div id="relative-dropdown" class="autocomplete-dropdown"></div>
            </div>
        </div>
        <div class="form-group"><label>오프셋 X</label>
            <div class="num-input-row">
                <button type="button" class="num-step" data-target="focus-offset-x" data-delta="-1">−</button>
                <input type="number" id="focus-offset-x" value="${focusData.offset?.x ?? 0}">
                <button type="button" class="num-step" data-target="focus-offset-x" data-delta="1">+</button>
            </div>
        </div>
        <div class="form-group"><label>오프셋 Y</label>
            <div class="num-input-row">
                <button type="button" class="num-step" data-target="focus-offset-y" data-delta="-1">−</button>
                <input type="number" id="focus-offset-y" value="${focusData.offset?.y ?? 0}">
                <button type="button" class="num-step" data-target="focus-offset-y" data-delta="1">+</button>
            </div>
        </div>
        <div class="form-group">
            <label>오프셋 조건 (offset trigger)</label>
            <div id="focus-offset-trigger-block" class="sb-container"></div>
            <small class="form-hint">이 조건이 참일 때만 오프셋이 적용됩니다. 비워두면 offset 블록에서 trigger가 생략됩니다.</small>
        </div>
        </section>
        <hr>

        <!-- 연결 관계 -->
        <section id="fsec-links" class="focus-form-section">
        <h4>연결 관계</h4>
        <div class="form-group">
            <label>선행 조건 (Prerequisite)</label>
            <div id="prerequisite-chips-container" class="chips-field"></div>
        </div>
        <div class="form-group">
            <label>상호 배타 (Mutually Exclusive)</label>
            <div id="me-chips-container" class="chips-field"></div>
        </div>
        </section>
        <hr>

        <!-- 조건 -->
        <section id="fsec-cond" class="focus-form-section">
        <h4>조건</h4>
        <div class="form-group"><label>available</label><div id="focus-available-block" class="sb-container"></div></div>
        <div class="form-group"><label>bypass</label><div id="focus-bypass-block" class="sb-container"></div></div>
        ${cb('focus-bypass-if-unavailable', 'bypass_if_unavailable', focusData.bypass_if_unavailable)}
        <div class="form-group"><label>cancel</label><div id="focus-cancel-block" class="sb-container"></div></div>
        <div class="form-group"><label>allow_branch</label><div id="focus-allow-branch-block" class="sb-container"></div></div>
        ${cb('focus-cancelable',              'cancelable',               focusData.cancelable)}
        ${cb('focus-continue-if-invalid',     'continue_if_invalid',      focusData.continue_if_invalid)}
        ${cb('focus-cancel-if-invalid',       'cancel_if_invalid',        focusData.cancel_if_invalid)}
        ${cb('focus-available-if-capitulated','available_if_capitulated',  focusData.available_if_capitulated)}
        </section>
        <hr>

        <!-- 완료 효과 -->
        <section id="fsec-effect" class="focus-form-section">
        <h4>완료 효과</h4>
        <div class="form-group"><label>completion_reward</label><div id="focus-complete-effect-block" class="sb-container"></div></div>
        <div class="form-group"><label>select_effect</label><div id="focus-select-effect-block" class="sb-container"></div></div>
        </section>
        <hr>

        <!-- AI 및 기타 -->
        <section id="fsec-ai" class="focus-form-section">
        <h4>AI 및 기타</h4>
        <div class="form-group">
            <label>ai_will_do — factor</label>
            <div class="ai-factor-row">
                <input type="range" id="focus-ai-factor-range" min="0" max="100" step="1" value="${focusData._aiWillDoFactor ?? _parseAiWillDoFactor(focusData.ai_will_do)}">
                <input type="number" id="focus-ai-factor-num" min="0" max="100" step="1" value="${focusData._aiWillDoFactor ?? _parseAiWillDoFactor(focusData.ai_will_do)}" class="ai-factor-num">
            </div>
        </div>
        <div class="form-group"><label>historical_ai</label><div id="focus-historical-ai-block" class="sb-container"></div></div>
        <div class="form-group"><label>will_lead_to_war_with</label><input type="text" id="focus-will-lead-to-war" value="${v((focusData.will_lead_to_war_with || []).join(', '))}"></div>
        <div class="form-group">
            <label>search_filters</label>
            <div id="focus-search-filters-chips"></div>
        </div>
        <div class="form-group"><label>text_icon</label><input type="text" id="focus-text-icon" value="${v(focusData.text_icon)}"></div>
        </section>

        <div class="form-actions">${btns}</div>
    `;
}

// ── 폼 데이터 추출 ───────────────────────────────────────
function extractFormData() {
    const gv  = id => document.getElementById(id)?.value?.trim() || '';
    const gc  = id => document.getElementById(id)?.checked || false;
    // NaN → 0, 그 외는 그대로 (|| 0은 0을 0으로 처리하지만 음수도 살림)
    const gn  = (id, def = 0) => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? def : v; };
    const gnf = (id, def = 0) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? def : v; };
    const lst = str => str ? str.split(',').map(s => s.trim()).filter(Boolean) : [];
    const parsePre = str => {
        if (!str) return [];
        const result = [], rx = /\[([^\]]+)\]|([^,\[\]]+)/g;
        let m;
        while ((m = rx.exec(str)) !== null) {
            if (m[1]) result.push(m[1].split(',').map(s => s.trim()).filter(Boolean));
            else if (m[2]?.trim()) result.push(m[2].trim());
        }
        return result;
    };
    return {
        _comment: gv('focus-comment'),
        id: gv('focus-id'), name: gv('focus-id'),
        icon: gv('focus-icon') || 'GFX_goal_unknown',
        dynamic: gc('focus-dynamic-icon'), cost: gnf('focus-cost') || 10,
        x: gn('focus-x'), y: gn('focus-y'),
        relative_position_id: gv('focus-relative-position-id') || null,
        offset: { x: gn('focus-offset-x'), y: gn('focus-offset-y'), trigger: gv('focus-offset-trigger') },
        prerequisite: parsePre(gv('focus-prerequisite')),
        mutually_exclusive: lst(gv('focus-mutually-exclusive')),
        available:    gv('focus-available'),    bypass: gv('focus-bypass'),
        bypass_if_unavailable: gc('focus-bypass-if-unavailable'),
        cancel: gv('focus-cancel'), allow_branch: gv('focus-allow-branch'),
        cancelable: gc('focus-cancelable'),
        continue_if_invalid: gc('focus-continue-if-invalid'),
        cancel_if_invalid: gc('focus-cancel-if-invalid'),
        available_if_capitulated: gc('focus-available-if-capitulated'),
        complete_effect: gv('focus-complete-effect'),
        select_effect: gv('focus-select-effect'),
        text_icon: gv('focus-text-icon'),
        ai_will_do: _buildAiWillDo(parseInt(document.getElementById('focus-ai-factor-range')?.value) || 0),
        historical_ai: gv('focus-historical-ai'),
        will_lead_to_war_with: lst(gv('focus-will-lead-to-war')),
        search_filters: lst(gv('focus-search-filters'))
    };
}

// ── 픽셀 위치 계산 ───────────────────────────────────────
function setupPanelFormListeners() {
    document.getElementById('panel-content')?.addEventListener('click', e => {
        // [+][-] 숫자 스텝 버튼
        const stepBtn = e.target.closest('.num-step');
        if (stepBtn) {
            const targetEl = document.getElementById(stepBtn.dataset.target);
            if (targetEl) {
                const delta = parseInt(stepBtn.dataset.delta) || 0;
                const cur   = parseFloat(targetEl.value) || 0;
                const min   = targetEl.min !== '' ? parseFloat(targetEl.min) : -Infinity;
                targetEl.value = Math.max(min, cur + delta);
                targetEl.dispatchEvent(new Event('input'));
            }
        }

        // closest로 버튼 내부 클릭도 처리
        const applyBtn   = e.target.closest('#btn-apply-changes');
        const confirmBtn = e.target.closest('#btn-confirm-changes');
        const cancelBtn  = e.target.closest('#btn-cancel-changes');

        // 공통 저장 로직
        const _doApply = () => {
            const fd  = currentFileData();
            if (!fd)  return false;
            const formData = extractFormData();
            if (!formData.id) { alert('ID를 입력해주세요.'); return false; }
            const oldId = (_panelMode === 'new') ? null : appState.selectedFocusId;
            const newId = formData.id;
            if (!oldId && fd.focuses[newId]) { alert('이미 존재하는 ID입니다.'); return false; }
            if (oldId && newId !== oldId) {
                if (fd.focuses[newId]) { alert('이미 존재하는 ID입니다.'); return false; }
                Object.values(fd.focuses).forEach(f => {
                    if (f.prerequisite)
                        f.prerequisite = f.prerequisite.map(item =>
                            Array.isArray(item) ? item.map(p => p === oldId ? newId : p)
                                                : (item === oldId ? newId : item));
                    if (f.mutually_exclusive)
                        f.mutually_exclusive = f.mutually_exclusive.map(m => m === oldId ? newId : m);
                    if (f.relative_position_id === oldId) f.relative_position_id = newId;
                });
                delete fd.focuses[oldId];
            }
            saveSnapshot(oldId ? `"${oldId}" 편집` : `"${newId}" 생성`);
            fd.focuses[newId] = formData;
            applyLocToFocus(newId, fd);

            // ── mutually_exclusive 양방향 동기화 ──────────────
            // 현재 중점이 지목하는 상대에게도 이 중점을 추가,
            // 더 이상 지목하지 않는 상대에서는 이 중점을 제거
            const myME = formData.mutually_exclusive || [];
            Object.entries(fd.focuses).forEach(([fid, f]) => {
                if (fid === newId) return;
                const hasMe = (f.mutually_exclusive || []).includes(newId);
                const iTargeted = myME.includes(fid);
                if (iTargeted && !hasMe) {
                    // 상대가 나를 아직 지목하지 않음 → 추가
                    f.mutually_exclusive = [...(f.mutually_exclusive || []), newId];
                } else if (!iTargeted && hasMe) {
                    // 내가 더 이상 상대를 지목 안 함 → 상대에서 나를 제거
                    f.mutually_exclusive = f.mutually_exclusive.filter(m => m !== newId);
                }
            });

            appState.isDirty = true;
            try { renderFocusTree(); } catch(err) { console.error('renderFocusTree 오류:', err); }
            return { oldId, newId };
        };

        if (applyBtn) {
            e.preventDefault();
            const res = _doApply();
            if (!res) return;
            const { oldId, newId } = res;
            _showSaveToast(oldId ? `✅ "${newId}" 수정 완료` : `✅ "${newId}" 생성 완료`);
            openEditorPanel('edit', newId);
        }

        if (confirmBtn) {
            e.preventDefault();
            const res = _doApply();
            if (!res) return;
            const { newId } = res;
            _showSaveToast(`✅ "${newId}" 저장 완료`);
            closeEditorPanel();
        }


        if (cancelBtn) {
            e.preventDefault();
            closeEditorPanel();
        }
    });

    // 헤더 삭제 버튼 — panel-content 외부이므로 별도 등록
    const _rebindPanelDelete = () => {
        const el = document.getElementById('btn-panel-delete');
        if (!el) return;
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('click', () => {
            const fd = currentFileData();
            if (!fd || !appState.selectedFocusId) return;
            if (confirm(`"${appState.selectedFocusId}" 중점을 삭제하시겠습니까?`)) {
                const deletedId = appState.selectedFocusId;
                saveSnapshot(`"${deletedId}" 삭제`);
                delete fd.focuses[deletedId];
                Object.values(fd.focuses).forEach(f => {
                    if (f.mutually_exclusive?.includes(deletedId))
                        f.mutually_exclusive = f.mutually_exclusive.filter(m => m !== deletedId);
                });
                appState.isDirty = true;
                try { renderFocusTree(); } catch(err) { console.error('renderFocusTree 오류:', err); }
                finally {
                    closeEditorPanel();
                    _showSaveToast(`🗑 "${deletedId}" 삭제 완료`);
                }
            }
        });
    };
    _rebindPanelDelete();
}
