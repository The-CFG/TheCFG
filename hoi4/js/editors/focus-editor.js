// ════════════════════════════════════════════════════════
//  focus-editor.js — 포커스 트리 렌더링 / 드래그앤드롭
//  의존: state.js, io-parsers.js, cloud-ui.js, focus-form.js
// ════════════════════════════════════════════════════════
function getFocusPixelPosition(focusId, visited = new Set()) {
    const fd    = currentFileData();
    const focus = fd?.focuses[focusId];
    if (!focus) return null;
    if (visited.has(focusId))
        return { x: focus.x * GRID_SCALE_X + 100, y: focus.y * GRID_SCALE_Y + 100 };
    visited.add(focusId);

    if (focus.relative_position_id) {
        const base = getFocusPixelPosition(focus.relative_position_id, visited);
        if (base) return {
            x: base.x + focus.x * GRID_SCALE_X,
            y: base.y + focus.y * GRID_SCALE_Y
        };
    }
    return { x: focus.x * GRID_SCALE_X + 100, y: focus.y * GRID_SCALE_Y + 100 };
}

// ── 렌더링 ───────────────────────────────────────────────
function renderFocusTree() {
    const ve  = document.getElementById('visual-editor');
    const cnt = document.getElementById('focus-count');
    if (!ve) return;
    const fd  = currentFileData();
    ve.innerHTML = '';
    if (cnt) cnt.textContent = Object.keys(fd?.focuses || {}).length;

    // 음수 좌표 경계선 (CSS ::before/::after는 100px 위치, 추가 마커)
    const axisX = document.createElement('div');
    axisX.className = 'neg-axis-x';
    ve.appendChild(axisX);
    const axisY = document.createElement('div');
    axisY.className = 'neg-axis-y';
    ve.appendChild(axisY);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg   = document.createElementNS(svgNS, 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    ve.appendChild(svg);

    const focuses   = fd?.focuses || {};
    const positions = {};
    Object.keys(focuses).forEach(id => {
        const p = getFocusPixelPosition(id);
        if (p) positions[id] = p;
    });

    const NW = 120, NH = 80;

    // 그리드 크기 동적 확장 — 중점이 한계 근처까지 배치되면 그리드를 늘림
    const GRID_MIN_SIZE = 4000;
    const GRID_PAD      = 1000; // 가장 먼 중점 기준 여유 공간
    let maxX = 0, maxY = 0;
    Object.values(positions).forEach(p => {
        maxX = Math.max(maxX, p.x + NW);
        maxY = Math.max(maxY, p.y + NH);
    });
    ve.style.width  = Math.max(GRID_MIN_SIZE, maxX + GRID_PAD) + 'px';
    ve.style.height = Math.max(GRID_MIN_SIZE, maxY + GRID_PAD) + 'px';

    // 선행 조건 선 (직각 꺾임)
    Object.values(focuses).forEach(focus => {
        if (!focus.prerequisite?.length) return;
        const toPos = positions[focus.id];
        if (!toPos) return;
        focus.prerequisite.forEach(item => {
            (Array.isArray(item) ? item : [item]).forEach(pid => {
                const fromPos = positions[pid];
                if (!fromPos) return;
                const x1 = fromPos.x + NW / 2, y1 = fromPos.y + NH;
                const x2 = toPos.x   + NW / 2, y2 = toPos.y;
                const my = (y1 + y2) / 2;
                const d  = x1 === x2 ? `M ${x1} ${y1} L ${x2} ${y2}`
                    : `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`;
                const path = document.createElementNS(svgNS, 'path');
                path.setAttribute('d', d);
                path.setAttribute('class', `prereq-line${Array.isArray(item) ? ' or' : ''}`);
                svg.appendChild(path);
            });
        });
    });

    // 상호 배타 선 + ! 아이콘
    const drawn = new Set();
    Object.values(focuses).forEach(focus => {
        if (!focus.mutually_exclusive?.length) return;
        const posA = positions[focus.id];
        if (!posA) return;
        focus.mutually_exclusive.forEach(mid => {
            const key = [focus.id, mid].sort().join('|');
            if (drawn.has(key)) return;
            drawn.add(key);
            const posB = positions[mid];
            if (!posB) return;
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', posA.x + NW / 2); line.setAttribute('y1', posA.y + NH / 2);
            line.setAttribute('x2', posB.x + NW / 2); line.setAttribute('y2', posB.y + NH / 2);
            line.setAttribute('class', 'mutual-exclusive-line');
            svg.appendChild(line);
            const txt = document.createElementNS(svgNS, 'text');
            txt.setAttribute('x', (posA.x + posB.x) / 2 + NW / 2);
            txt.setAttribute('y', (posA.y + posB.y) / 2 + NH / 2);
            txt.setAttribute('class', 'mutual-exclusive-icon');
            txt.textContent = '!';
            svg.appendChild(txt);
        });
    });

    // 중점 노드
    Object.values(focuses).forEach(focus => {
        const pos = positions[focus.id];
        if (!pos) return;
        const node = document.createElement('div');
        node.className = 'focus-node' + (focus.id === appState.selectedFocusId ? ' selected' : '');
        node.dataset.id = focus.id;
        node.style.left = pos.x + 'px';
        node.style.top  = pos.y + 'px';

        // GFX 아이콘 이미지 결정
        const iconDataUrl = (typeof resolveGfxIcon === 'function') ? resolveGfxIcon(focus.icon) : null;
        const iconHtml = iconDataUrl
            ? `<div class="focus-node-icon"><img src="${iconDataUrl}" alt="${escapeHtml(focus.icon)}" draggable="false"></div>`
            : `<div class="focus-node-icon focus-node-icon-placeholder" title="${escapeHtml(focus.icon || 'GFX_goal_unknown')}">🎯</div>`;

        node.innerHTML  = `
            ${iconHtml}
            <div class="focus-node-label">${escapeHtml(getFocusNodeLabel(focus))}</div>
            <div class="drag-handle" title="드래그하여 이동"></div>
        `;
        node.addEventListener('click', e => {
            if (e.target.classList.contains('drag-handle')) return;
            // 무브패드가 열려 있으면 편집창 대신 무브패드에 선택
            if (_movepadOpen) {
                _movepadSelectFocus(focus.id);
            } else {
                openEditorPanel('edit', focus.id);
            }
        });
        ve.appendChild(node);
    });

    setupDragAndDrop();

    // 필터가 활성화된 상태라면 트리 재렌더 후 다시 적용
    if (_activeFocusFilter) {
        requestAnimationFrame(() => applyFocusFilter(_activeFocusFilter));
    }
}

// ── 드래그 앤 드롭 ───────────────────────────────────────
// renderFocusTree 호출 때마다 재등록되므로 AbortController로 이전 리스너 제거
let _dndAbort = null;

function setupDragAndDrop() {
    const ve = document.getElementById('visual-editor');
    if (!ve) return;

    // 이전 document 레벨 리스너 제거
    if (_dndAbort) _dndAbort.abort();
    _dndAbort = new AbortController();
    const _sig = _dndAbort.signal;

    let drag = null, sMouseX = 0, sMouseY = 0, sLeft = 0, sTop = 0;

    ve.querySelectorAll('.drag-handle').forEach(h => {
        h.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            drag   = h.closest('.focus-node');
            sMouseX = e.clientX; sMouseY = e.clientY;
            sLeft   = parseInt(drag.style.left) || 0;
            sTop    = parseInt(drag.style.top)  || 0;
            drag.style.zIndex = 100;
        });
    });
    document.addEventListener('mousemove', e => {
        if (!drag) return;
        const scale = _zoom / 100;
        drag.style.left = (sLeft + (e.clientX - sMouseX) / scale) + 'px';
        drag.style.top  = (sTop  + (e.clientY - sMouseY) / scale) + 'px';
    }, { signal: _sig });
    document.addEventListener('mouseup', () => {
        if (!drag) return;
        const fd    = currentFileData();
        const focus = fd?.focuses[drag.dataset.id];
        if (focus) {
            const nx = parseInt(drag.style.left) || 0;
            const ny = parseInt(drag.style.top)  || 0;
            if (focus.relative_position_id) {
                const base = getFocusPixelPosition(focus.relative_position_id);
                if (base) {
                    focus.x = Math.round((nx - base.x) / GRID_SCALE_X);
                    focus.y = Math.round((ny - base.y) / GRID_SCALE_Y);
                }
            } else {
                focus.x = Math.round((nx - 100) / GRID_SCALE_X);
                focus.y = Math.round((ny - 100) / GRID_SCALE_Y);
            }
            appState.isDirty = true;
            saveSnapshot(`"${drag.dataset.id}" 이동`);
            renderFocusTree();
        }
        drag = null;
    }, { signal: _sig });
}

// ── 패널 폼 이벤트 위임 ──────────────────────────────────
// ── 사이드바 토글 ─────────────────────────────────────────
function initSidebarToggle() {
    const btn    = document.getElementById('btn-sidebar-toggle-menu');
    const expBtn = document.getElementById('btn-sidebar-expand');
    const panel  = document.getElementById('left-panel');
    if (!panel) return;

    const toggle = () => {
        panel.classList.toggle('collapsed');
        const col = panel.classList.contains('collapsed');
        if (btn) btn.title = col ? '사이드바 펼치기' : '사이드바 접기';
    };

    btn?.addEventListener('click', toggle);
    expBtn?.addEventListener('click', () => {
        panel.classList.remove('collapsed');
        if (btn) btn.title = '사이드바 접기';
    });
}

// ── 줌 컨트롤 ─────────────────────────────────────────────
const ZOOM_STEPS  = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
const ZOOM_DEFAULT = 100;
let _zoom = ZOOM_DEFAULT;

function _applyZoom(z) {
    _zoom = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], z));
    const wrap  = document.getElementById('visual-editor-wrap');
    const label = document.getElementById('zoom-label');
    if (wrap)  wrap.style.transform = `scale(${_zoom / 100})`;
    if (label) label.textContent    = `${_zoom}%`;
}

function _zoomStep(dir) {
    const cur = ZOOM_STEPS.indexOf(ZOOM_STEPS.reduce((p, c) => Math.abs(c - _zoom) < Math.abs(p - _zoom) ? c : p));
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
    _applyZoom(next);
}

function initZoomControls() {
    document.getElementById('btn-zoom-in') ?.addEventListener('click', () => _zoomStep(+1));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => _zoomStep(-1));

    // Ctrl + 휠
    const cp = document.getElementById('center-panel');
    if (cp) cp.addEventListener('wheel', e => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        _zoomStep(e.deltaY < 0 ? +1 : -1);
    }, { passive: false });

    _applyZoom(ZOOM_DEFAULT);
}
// ════════════════════════════════════════════════════════
//  중점 검색바
// ════════════════════════════════════════════════════════

// 텍스트 하이라이트 헬퍼
function _fsdHighlight(text, query) {
    if (!query || !text) return escapeHtml(text || '');
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return escapeHtml(text).replace(re, m => `<mark class="fsd-hl">${m}</mark>`);
}

// 드롭다운 렌더링
function _renderFocusSearchDropdown(query) {
    const dd  = document.getElementById('focus-search-dropdown');
    if (!dd) return;

    const fd = currentFileData();
    const focuses = fd?.type === 'national_focus' ? fd.focuses : null;

    if (!focuses || !query.trim()) {
        dd.style.display = 'none';
        dd.innerHTML = '';
        return;
    }

    const q = query.trim().toLowerCase();

    // 매칭: id 또는 loc 이름 포함
    const matches = Object.values(focuses).filter(f => {
        const loc = _getFsdLocName(f.id);
        return f.id.toLowerCase().includes(q) || (loc && loc.toLowerCase().includes(q));
    });

    dd.innerHTML = '';

    if (matches.length === 0) {
        dd.innerHTML = `<div class="fsd-empty">검색 결과 없음</div>`;
        dd.style.display = 'block';
        return;
    }

    matches.forEach(focus => {
        const locName = _getFsdLocName(focus.id);
        const iconDataUrl = (typeof resolveGfxIcon === 'function') ? resolveGfxIcon(focus.icon) : null;

        const iconHtml = iconDataUrl
            ? `<img src="${iconDataUrl}" alt="" draggable="false">`
            : `<span class="fsd-icon-placeholder">🎯</span>`;

        const item = document.createElement('div');
        item.className = 'fsd-item';
        item.innerHTML = `
            <div class="fsd-icon">${iconHtml}</div>
            <div class="fsd-text">
                <span class="fsd-id">${_fsdHighlight(focus.id, query.trim())}</span>
                ${locName ? `<span class="fsd-loc">${_fsdHighlight(locName, query.trim())}</span>` : ''}
            </div>
            <div class="fsd-actions">
                <button class="fsd-btn fsd-btn-goto"  data-id="${escapeHtml(focus.id)}" title="이 중점으로 이동">이동</button>
                <button class="fsd-btn fsd-btn-edit"  data-id="${escapeHtml(focus.id)}" title="편집창 열기">편집</button>
                <button class="fsd-btn fsd-btn-del"   data-id="${escapeHtml(focus.id)}" title="중점 삭제">삭제</button>
            </div>
        `;

        // 이동 버튼
        item.querySelector('.fsd-btn-goto').addEventListener('click', e => {
            e.stopPropagation();
            _fsdGotoFocus(focus.id);
            _closeFocusSearch();
        });

        // 편집 버튼
        item.querySelector('.fsd-btn-edit').addEventListener('click', e => {
            e.stopPropagation();
            openEditorPanel('edit', focus.id);
            _closeFocusSearch();
        });

        // 삭제 버튼
        item.querySelector('.fsd-btn-del').addEventListener('click', e => {
            e.stopPropagation();
            _fsdDeleteFocus(focus.id);
        });

        dd.appendChild(item);
    });

    dd.style.display = 'block';
}

// 로컬라이징 이름 조회
function _getFsdLocName(focusId) {
    for (const fd of Object.values(appState.project.files)) {
        if (fd.type !== 'localisation' || fd._stub || !fd.data) continue;
        const entry = fd.data[focusId];
        const name  = typeof entry === 'object' ? entry?.name : entry;
        if (name?.trim()) return name;
    }
    return null;
}

// 중점으로 스크롤 이동 + 강조
function _fsdGotoFocus(focusId) {
    const pos = getFocusPixelPosition(focusId);
    if (!pos) return;

    const cp   = document.getElementById('center-panel');
    const wrap = document.getElementById('visual-editor-wrap');
    if (!cp || !wrap) return;

    const scale = _zoom / 100;
    const NW = 120, NH = 80;

    // 노드 중심 픽셀 → 스케일 적용
    const cx = (pos.x + NW / 2) * scale;
    const cy = (pos.y + NH / 2) * scale;

    // center-panel 뷰포트 중앙
    cp.scrollLeft = cx - cp.clientWidth  / 2;
    cp.scrollTop  = cy - cp.clientHeight / 2;

    // 노드 깜빡임 강조
    const node = document.querySelector(`.focus-node[data-id="${CSS.escape(focusId)}"]`);
    if (node) {
        node.classList.add('fsd-highlight-pulse');
        setTimeout(() => node.classList.remove('fsd-highlight-pulse'), 1200);
    }
}

// 삭제 (focus-form.js의 패턴과 동일)
function _fsdDeleteFocus(focusId) {
    const fd = currentFileData();
    if (!fd) return;
    if (!confirm(`"${focusId}" 중점을 삭제하시겠습니까?`)) return;

    saveSnapshot(`"${focusId}" 삭제`);
    delete fd.focuses[focusId];

    // 참조 정리
    Object.values(fd.focuses).forEach(f => {
        if (f.mutually_exclusive?.includes(focusId))
            f.mutually_exclusive = f.mutually_exclusive.filter(m => m !== focusId);
        if (f.prerequisite)
            f.prerequisite = f.prerequisite
                .map(item => Array.isArray(item) ? item.filter(p => p !== focusId) : (item === focusId ? null : item))
                .filter(item => item !== null && (!Array.isArray(item) || item.length > 0));
        if (f.relative_position_id === focusId)
            f.relative_position_id = null;
    });

    appState.isDirty = true;
    renderFocusTree();
    closeEditorPanel?.();
    typeof _showSaveToast === 'function' && _showSaveToast(`🗑 "${focusId}" 삭제 완료`);

    // 드롭다운 재렌더
    const inp = document.getElementById('focus-search-input');
    if (inp?.value) _renderFocusSearchDropdown(inp.value);
}

// 검색창 닫기
function _closeFocusSearch() {
    const dd  = document.getElementById('focus-search-dropdown');
    const inp = document.getElementById('focus-search-input');
    if (dd)  { dd.style.display = 'none'; dd.innerHTML = ''; }
    if (inp) inp.value = '';
    const clr = document.getElementById('focus-search-clear');
    if (clr) clr.style.display = 'none';
}

// 이벤트 바인딩 (main.js의 initZoomControls와 같은 타이밍에 호출)
function initFocusSearch() {
    const inp = document.getElementById('focus-search-input');
    const clr = document.getElementById('focus-search-clear');
    const dd  = document.getElementById('focus-search-dropdown');
    if (!inp) return;

    let _debounceTimer = null;

    inp.addEventListener('input', () => {
        const val = inp.value;
        clr.style.display = val ? 'flex' : 'none';

        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            _renderFocusSearchDropdown(val);
        }, 120);
    });

    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') _closeFocusSearch();
    });

    clr.addEventListener('click', () => _closeFocusSearch());

    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('mousedown', e => {
        const bar = document.getElementById('focus-search-bar');
        if (bar && !bar.contains(e.target)) {
            dd.style.display = 'none';
        }
    });
}

// ════════════════════════════════════════════════════════
//  중점 필터 (카테고리 하이라이트)
// ════════════════════════════════════════════════════════

// 중점의 search_filters 배열에 해당 필터가 포함되는지 직접 판별
function _focusMatchesFilter(focus, filterKey) {
    return Array.isArray(focus.search_filters) && focus.search_filters.includes(filterKey);
}

// 현재 활성 필터 상태
let _activeFocusFilter = null;

// 필터 적용: 해당 카테고리 노드만 밝게, 나머지 dim
function applyFocusFilter(filterKey) {
    const fd = currentFileData();
    if (!fd?.focuses) return;

    // 같은 버튼 재클릭이면 해제
    if (_activeFocusFilter === filterKey) {
        _activeFocusFilter = null;
        _clearFocusFilterHighlight();
        document.querySelectorAll('.focus-filter-btn').forEach(b => b.classList.remove('active'));
        return;
    }

    _activeFocusFilter = filterKey;

    // 버튼 active 표시
    document.querySelectorAll('.focus-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filterKey);
    });

    // 매칭 여부 계산
    const matchSet = new Set(
        Object.values(fd.focuses)
            .filter(f => _focusMatchesFilter(f, filterKey))
            .map(f => f.id)
    );

    // 노드에 클래스 적용
    document.querySelectorAll('.focus-node').forEach(node => {
        const id = node.dataset.id;
        if (matchSet.has(id)) {
            node.classList.remove('filter-dim');
            node.classList.add('filter-lit');
        } else {
            node.classList.remove('filter-lit');
            node.classList.add('filter-dim');
        }
    });
}

function _clearFocusFilterHighlight() {
    _activeFocusFilter = null;
    document.querySelectorAll('.focus-node').forEach(node => {
        node.classList.remove('filter-dim', 'filter-lit');
    });
}

// renderFocusTree 후 필터 재적용 (트리가 다시 렌더될 때도 유지)
const _origRenderFocusTree = typeof renderFocusTree !== 'undefined'
    ? renderFocusTree : null;

function _reapplyFilterAfterRender() {
    if (_activeFocusFilter) applyFocusFilter(_activeFocusFilter);
}

function initFocusFilter() {
    document.querySelectorAll('.focus-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            applyFocusFilter(btn.dataset.filter);
        });
    });
}

// ════════════════════════════════════════════════════════
//  무브패드
// ════════════════════════════════════════════════════════

function _applyMovepadVisibility(enabled) {
    const row = document.querySelector('.movepad-toggle-row');
    if (row) row.style.display = enabled ? '' : 'none';
    if (!enabled) {
        // 비활성화 시 패널도 닫기
        const panel = document.getElementById('movepad-panel');
        const toggleBtn = document.getElementById('btn-movepad-toggle');
        if (panel) panel.style.display = 'none';
        if (toggleBtn) {
            toggleBtn.classList.remove('open');
            toggleBtn.textContent = '🕹 무브패드 열기';
        }
        _movepadOpen = false;
    }
}

// relative_position_id 적용
function _applyRelpos(value) {
    const id = _movepadSelectedId;
    if (!id) return;
    const fd = currentFileData();
    const focus = fd?.focuses?.[id];
    if (!focus) return;
    // 존재하지 않는 ID거나 자기 자신이면 무시
    if (value && (value === id || !fd.focuses[value])) return;
    saveSnapshot(`"${id}" 상대위치 변경`);
    focus.relative_position_id = value || null;
    appState.isDirty = true;
    renderFocusTree();
}

let _movepadOpen = false;
let _movepadSelectedId = null;

// 외부에서 호출: 무브패드에 중점 선택
function _movepadSelectFocus(id) {
    _movepadSelectedId = id;
    appState.selectedFocusId = id;
    _movepadUpdateUI();
    renderFocusTree(); // 선택 노드 하이라이트 갱신
}

function _movepadUpdateUI() {
    const nameLabel   = document.getElementById('movepad-focus-name');
    const centerBtn   = document.querySelector('.dpad-center-btn');
    const relposInput = document.getElementById('movepad-relpos-input');
    if (!nameLabel) return;

    const id = _movepadSelectedId;
    nameLabel.textContent = id || '없음';

    const fd    = id ? currentFileData() : null;
    const focus = fd?.focuses?.[id];

    // 중앙 버튼 — 현 위치 표시
    if (centerBtn) {
        if (focus) {
            centerBtn.textContent = `${focus.x},${focus.y}`;
            centerBtn.title = `현재 위치: x=${focus.x}, y=${focus.y}`;
        } else {
            centerBtn.textContent = '—';
            centerBtn.title = '선택된 중점 없음';
        }
    }

    // 상대위치 기준 ID 입력창 — 선택된 중점의 값으로 채우되
    // 사용자가 직접 편집 중일 때는 덮어쓰지 않음
    if (relposInput && !relposInput._userEditing) {
        relposInput.value = focus?.relative_position_id || '';
    }
}

function initMovepad() {
    // 초기 활성화 상태 적용
    _applyMovepadVisibility(getMovepadEnabled());

    const toggleBtn  = document.getElementById('btn-movepad-toggle');
    const panel      = document.getElementById('movepad-panel');
    const nameLabel  = document.getElementById('movepad-focus-name');
    const clearBtn   = document.getElementById('movepad-clear-btn');
    if (!toggleBtn || !panel || !nameLabel) return;

    // 패널 열기/닫기
    toggleBtn.addEventListener('click', () => {
        _movepadOpen = panel.style.display === 'none';
        panel.style.display = _movepadOpen ? 'block' : 'none';
        toggleBtn.classList.toggle('open', _movepadOpen);
        toggleBtn.textContent = _movepadOpen ? '🕹 무브패드 닫기' : '🕹 무브패드 열기';
        if (!_movepadOpen) {
            // 닫을 때 선택 해제
            _movepadSelectedId = null;
            _movepadUpdateUI();
        }
    });

    // 선택 취소 버튼
    clearBtn?.addEventListener('click', () => {
        _movepadSelectedId = null;
        appState.selectedFocusId = null;
        _movepadUpdateUI();
        renderFocusTree();
    });

    // 상대위치 기준 ID 입력
    const relposInput = document.getElementById('movepad-relpos-input');
    const relposClear = document.getElementById('movepad-relpos-clear');

    relposInput?.addEventListener('focus', () => { relposInput._userEditing = true; });
    relposInput?.addEventListener('blur',  () => {
        relposInput._userEditing = false;
        _applyRelpos(relposInput.value.trim());
    });
    relposInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { relposInput.blur(); }
        if (e.key === 'Escape') {
            // 취소: 원래 값으로 복원
            const focus = currentFileData()?.focuses?.[_movepadSelectedId];
            relposInput.value = focus?.relative_position_id || '';
            relposInput._userEditing = false;
            relposInput.blur();
        }
    });
    relposClear?.addEventListener('click', () => {
        if (relposInput) relposInput.value = '';
        _applyRelpos('');
    });

    // 방향 버튼 — 누르고 있으면 반복 이동
    // 스냅샷은 버튼을 처음 누를 때 한 번만 찍고, 연속 반복 이동은 스냅샷 없이 데이터만 수정
    document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
        let _repeatTimer    = null;
        let _repeatInterval = null;
        let _snapshotDone   = false;

        const doMove = (isFirst) => {
            const dir = btn.dataset.dir;
            const id  = _movepadSelectedId;
            if (!id) return;
            const fd = currentFileData();
            const focus = fd?.focuses?.[id];
            if (!focus) return;

            // 첫 이동 시에만 스냅샷 저장
            if (isFirst) saveSnapshot(`"${id}" 무브패드 이동`);

            if      (dir === 'up')    focus.y -= 1;
            else if (dir === 'down')  focus.y += 1;
            else if (dir === 'left')  focus.x -= 1;
            else if (dir === 'right') focus.x += 1;

            appState.isDirty = true;
            renderFocusTree();
            _movepadUpdateUI(); // 중앙 좌표 갱신
        };

        const start = (e) => {
            e.preventDefault();
            doMove(true);
            _repeatTimer = setTimeout(() => {
                _repeatInterval = setInterval(() => doMove(false), 120);
            }, 350);
        };
        const stop = () => {
            clearTimeout(_repeatTimer);
            clearInterval(_repeatInterval);
            _repeatTimer = null;
            _repeatInterval = null;
        };

        btn.addEventListener('mousedown',   start);
        btn.addEventListener('touchstart',  start, { passive: false });
        btn.addEventListener('mouseup',     stop);
        btn.addEventListener('mouseleave',  stop);
        btn.addEventListener('touchend',    stop);
        btn.addEventListener('touchcancel', stop);
    });
}
