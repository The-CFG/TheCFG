// ════════════════════════════════════════════════════════
//  localisation.js — 로컬라이제이션 파일 편집기
//  의존: state.js, io.js, explorer.js
// ════════════════════════════════════════════════════════

const LANG_NAMES = {
    english:'영어', korean:'한국어', japanese:'일본어', german:'독일어',
    french:'프랑스어', spanish:'스페인어', russian:'러시아어', polish:'폴란드어',
    braz_por:'브라질 포르투갈어', simp_chinese:'중국어 간체'
};

// ── 로컬라이제이션 변경 → 중점 이름 즉시 반영 ───────────
function _syncLocToFocuses(key, nameVal) {
    Object.values(appState.project.files).forEach(fd => {
        if (fd.type !== 'national_focus') return;
        if (fd.focuses[key]) fd.focuses[key].name = nameVal || key;
    });
}

// ── 편집기 툴바 설정 ─────────────────────────────────────
function setupLocEditorToolbar() {
    const fd       = currentFileData();
    const filename = appState.currentFile?.split('/').pop() || '';
    const lang     = fd?.lang || 'english';

    const titleEl = document.getElementById('loc-editor-title');
    if (titleEl) titleEl.textContent = `${filename}  (${LANG_NAMES[lang] || lang})`;

    document.getElementById('btn-loc-back')?.addEventListener('click', () => {
        _closeLocInline();
        _resetExplorerMain();
    });
    document.getElementById('btn-loc-save-server')?.addEventListener('click', () => {
        if (!fd || !appState.currentFile) return;
        _saveCurrentFileToServer(appState.currentFile, fd);
    });
    document.getElementById('btn-loc-save-file')?.addEventListener('click', () => {
        if (!fd) return;
        downloadBlob(_locYmlWithBom(buildLocYml(fd)), filename, 'text/yaml;charset=utf-8');
    });
    document.getElementById('btn-loc-import-file')?.addEventListener('click', _locImportFile);
    document.getElementById('btn-loc-raw-edit')?.addEventListener('click', () => {
        if (!fd || !appState.currentFile) return;
        const container = document.getElementById('localisation-list');
        if (!container) return;
        _renderRawWithReturn(
            container, appState.currentFile, fd,
            buildLocYml(fd),
            (newRaw) => {
                let parsed;
                try { parsed = parseLocalisationFile(newRaw, filename); }
                catch (e) { return { ok: false, msg: e.message }; }
                if (!parsed) return { ok: false, msg: 'l_언어: 헤더를 찾을 수 없습니다.' };
                fd.lang = parsed.lang;
                fd.data = parsed.data;
                appState.project.files[appState.currentFile] = fd;
                appState.isDirty = true;
                invalidateLocCache();
                return { ok: true };
            },
            () => renderLocalisationList()
        );
    });
}

// ── 파일 내 불러오기 (덮어쓰기 / 병합) ──────────────────
function _locImportFile() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.yml,.yaml';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const content = await file.text();
        const parsed  = parseLocalisationFile(content, file.name);
        if (!parsed) { alert('유효한 로컬라이제이션 파일이 아닙니다.'); return; }

        const fd = currentFileData();
        if (!fd) return;

        if (parsed.lang !== fd.lang) {
            if (!confirm(`현재 파일은 "${LANG_NAMES[fd.lang] || fd.lang}"이고,\n` +
                         `불러온 파일은 "${LANG_NAMES[parsed.lang] || parsed.lang}"입니다.\n계속하시겠습니까?`))
                return;
        }
        const hasExisting = Object.keys(fd.data).length > 0;
        const merge = hasExisting && confirm(
            '기존 항목이 있습니다.\n[확인] 병합 (중복 키는 새 값으로)\n[취소] 덮어쓰기'
        );
        if (merge) Object.assign(fd.data, parsed.data);
        else       fd.data = parsed.data;

        appState.isDirty = true;
        invalidateLocCache();
        renderLocalisationList();
        CloudAuth.saveProject(appState.project.name).catch(console.error);
        alert(`불러오기 완료 (${Object.keys(parsed.data).length}개 항목)`);
    };
    input.click();
}

// ── 로컬라이징 서식 미리보기 ─────────────────────────────
// §X ... §!  → 색상 텍스트 (X는 색상 코드 문자)
// [변수명]   → 변수 참조 (강조 표시만, 실제 값은 게임 내에서 치환됨)
// \n         → 줄바꿈
const LOC_COLOR_MAP = {
    R: '#ff5c5c', r: '#ff5c5c',   // 빨강
    G: '#6bd96b', g: '#6bd96b',   // 초록
    Y: '#ffe34d', y: '#ffe34d',   // 노랑
    B: '#5c9eff', b: '#9aa0a6',   // 파랑 / (b는 회색조로 쓰이는 경우가 많음)
    W: '#ffffff',                 // 흰색
    T: '#3cb6e0',                 // 청록
    H: '#ff9b3c',                 // 주황(강조)
    O: '#ff9b3c',                 // 주황
    P: '#c879ff',                 // 보라
};

function locRenderPreview(text) {
    if (!text) return '<span class="loc-preview-empty">(미리보기)</span>';

    let html = '';
    let openSpans = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        // §X ... §!  색상 태그
        if (ch === '§' && i + 1 < text.length) {
            const code = text[i + 1];
            if (code === '!') {
                if (openSpans > 0) { html += '</span>'; openSpans--; }
            } else {
                const color = LOC_COLOR_MAP[code];
                html += `<span class="loc-color-tag"${color ? ` style="color:${color}"` : ''} title="색상 코드: §${escapeHtml(code)}">`;
                openSpans++;
            }
            i += 2;
            continue;
        }

        // \n  줄바꿈 (백슬래시 + n 두 글자)
        if (ch === '\\' && text[i + 1] === 'n') {
            html += '<br>';
            i += 2;
            continue;
        }

        // [변수명] / [Concept.xxx] 등
        if (ch === '[') {
            const end = text.indexOf(']', i + 1);
            if (end !== -1) {
                const expr = text.slice(i, end + 1);
                html += `<span class="loc-var-tag" title="변수/개념 참조 (게임 내 자동 치환)">${escapeHtml(expr)}</span>`;
                i = end + 1;
                continue;
            }
        }

        html += escapeHtml(ch);
        i++;
    }
    while (openSpans > 0) { html += '</span>'; openSpans--; }
    return html;
}

// ── 로컬라이제이션 목록 렌더링 ───────────────────────────
function renderLocalisationList() {
    const list     = document.getElementById('localisation-list');
    const searchEl = document.getElementById('loc-search');
    if (!list) return;

    const fd    = currentFileData();
    const data  = fd?.data || {};
    const lang  = fd?.lang || 'english';
    const query = searchEl?.value.trim().toLowerCase() || '';

    list.innerHTML = '';

    const allKeys  = Object.keys(data).sort();
    const filtered = query
        ? allKeys.filter(k => {
            const e = data[k];
            const n = typeof e === 'object' ? e.name || '' : e || '';
            return k.toLowerCase().includes(query) || n.toLowerCase().includes(query);
          })
        : allKeys;

    if (!filtered.length) {
        list.innerHTML = `<p class="loc-empty">${query ? '검색 결과가 없습니다.' : '항목이 없습니다.'}</p>`;
        return;
    }

    filtered.forEach(id => {
        const entry = data[id];
        const name  = typeof entry === 'object' ? entry.name || '' : entry || '';
        const desc  = typeof entry === 'object' ? entry.desc || '' : '';

        const item = document.createElement('div');
        item.className = 'localisation-item';
        item.innerHTML = `
            <div class="localisation-item-id">${escapeHtml(id)}</div>
            <label class="loc-label">이름</label>
            <input type="text" class="loc-name" value="${escapeHtml(name)}"
                placeholder="${escapeHtml(id)}의 ${LANG_NAMES[lang] || lang} 이름">
            <div class="loc-preview loc-preview-name">${locRenderPreview(name)}</div>
            <label class="loc-label" style="margin-top:4px;">설명 (_desc)</label>
            <textarea class="loc-desc" placeholder="설명">${escapeHtml(desc)}</textarea>
            <div class="loc-preview loc-preview-desc">${locRenderPreview(desc)}</div>
            <button class="loc-delete-btn danger" title="삭제">🗑 삭제</button>
        `;

        const namePreview = item.querySelector('.loc-preview-name');
        const descPreview = item.querySelector('.loc-preview-desc');

        const save = (nameVal, descVal) => {
            data[id] = { name: nameVal, desc: descVal };
            appState.isDirty = true;
            invalidateLocCache();
            // 같은 키를 가진 중점이 있으면 name 즉시 반영
            _syncLocToFocuses(id, nameVal);
        };
        item.querySelector('.loc-name').addEventListener('input', e => {
            save(e.target.value, (typeof data[id] === 'object' ? data[id].desc : '') || '');
            if (namePreview) namePreview.innerHTML = locRenderPreview(e.target.value);
        });
        item.querySelector('.loc-desc').addEventListener('input', e => {
            save((typeof data[id] === 'object' ? data[id].name : data[id]) || '', e.target.value);
            if (descPreview) descPreview.innerHTML = locRenderPreview(e.target.value);
        });
        item.querySelector('.loc-delete-btn').addEventListener('click', () => {
            if (confirm(`"${id}" 항목을 삭제하시겠습니까?`)) {
                delete data[id];
                appState.isDirty = true;
                invalidateLocCache();
                renderLocalisationList();
            }
        });

        list.appendChild(item);
    });
}

// ── UTF-8 BOM + YML 텍스트 → Blob ────────────────────────
// HOI4는 로컬라이제이션 파일에 UTF-8 BOM(EF BB BF)을 요구함
function _locYmlWithBom(ymlText) {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const content = new TextEncoder().encode(ymlText);
    const merged = new Uint8Array(bom.length + content.length);
    merged.set(bom);
    merged.set(content, bom.length);
    return new Blob([merged], { type: 'text/yaml;charset=utf-8' });
}
function setupLocalisationEditorListeners() {
    document.getElementById('loc-search')
        ?.addEventListener('input', renderLocalisationList);

    // 새 항목 ID — 현재 프로젝트 내 모든 국가중점 ID를 드롭다운으로 제공
    _setupLocKeyAutocomplete();

    document.getElementById('btn-loc-add-entry')?.addEventListener('click', () => {
        const keyInput = document.getElementById('loc-new-key');
        const newKey   = keyInput?.value.trim();
        if (!newKey) { alert('추가할 ID를 입력해주세요.'); return; }
        const fd = currentFileData();
        if (!fd) return;
        if (fd.data[newKey]) { alert(`"${newKey}" 항목이 이미 존재합니다.`); return; }
        fd.data[newKey] = { name: '', desc: '' };
        appState.isDirty = true;
        invalidateLocCache();
        if (keyInput) keyInput.value = '';
        _locDropdownHide();
        renderLocalisationList();
    });

    document.getElementById('loc-new-key')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-loc-add-entry')?.click();
    });
}

// ── 중점 ID 자동완성 헬퍼 ────────────────────────────────
function _getAllFocusIds() {
    const ids = [];
    for (const fd of Object.values(appState.project.files || {})) {
        if (fd?.type === 'national_focus' && fd.focuses) {
            for (const f of Object.values(fd.focuses)) {
                if (f.id) ids.push(f.id);
            }
        }
    }
    return [...new Set(ids)].sort();
}

let _locDropdownEl = null;

function _setupLocKeyAutocomplete() {
    const input = document.getElementById('loc-new-key');
    if (!input) return;

    // 드롭다운 컨테이너 생성 (input 부모에 삽입)
    const wrap = input.parentElement;
    if (!wrap.style.position) wrap.style.position = 'relative';

    _locDropdownEl = document.createElement('div');
    _locDropdownEl.className = 'autocomplete-dropdown';
    _locDropdownEl.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:3000;';
    wrap.appendChild(_locDropdownEl);

    const show = () => {
        const q    = input.value.trim().toLowerCase();
        const cur  = currentFileData();
        const used = cur?.data ? new Set(Object.keys(cur.data)) : new Set();
        const ids  = _getAllFocusIds().filter(id =>
            (!q || id.toLowerCase().includes(q)) && !used.has(id)
        );
        if (!ids.length) { _locDropdownHide(); return; }
        _locDropdownEl.innerHTML = ids.slice(0, 50).map(id =>
            `<div class="autocomplete-item" data-id="${escapeHtml(id)}">
                <span class="autocomplete-item-id">${escapeHtml(id)}</span>
             </div>`
        ).join('');
        _locDropdownEl.classList.add('active');
        _locDropdownEl.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                input.value = item.dataset.id;
                _locDropdownHide();
            });
        });
    };

    input.addEventListener('input', show);
    input.addEventListener('focus', show);
    input.addEventListener('blur',  () => setTimeout(_locDropdownHide, 150));

    // 키보드 탐색
    let selIdx = -1;
    input.addEventListener('keydown', e => {
        const items = [...(_locDropdownEl?.querySelectorAll('.autocomplete-item') || [])];
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); }
        items.forEach((it, i) => it.classList.toggle('selected', i === selIdx));
        if (e.key === 'Enter' && selIdx >= 0 && items[selIdx]) {
            input.value = items[selIdx].dataset.id;
            selIdx = -1;
        }
        if (e.key === 'Escape') _locDropdownHide();
    });
}

function _locDropdownHide() {
    _locDropdownEl?.classList.remove('active');
}