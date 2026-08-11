// ════════════════════════════════════════════════════════
//  script-block.js — ScriptBlock 에디터 렌더러
//  의존: hoi4-defs.js (HOI4_EFFECTS, HOI4_TRIGGERS, hoi4GetDef, hoi4SearchDefs)
//        io-parsers.js (escapeHtml, getBlock)
// ════════════════════════════════════════════════════════

let _sbBoolGroupSeq = 0; // bool 타입 yes/no 라디오 그룹명 고유화용

// ── 파서: rawText → 노드 배열 ────────────────────────────
// 노드 종류:
//   { kind:'entry', key, params:{name:value,...}, raw }
//   { kind:'if',    limit:[], body:[], elseIfs:[{limit,body}], else_:[]|null, raw }
//   { kind:'raw',   text }

function sbParse(text) {
    if (!text?.trim()) return [];
    const tokens = _sbTokenize(text.trim());
    return _sbParseBlock(tokens, 0).nodes;
}

// 토크나이저: 문자열 → 토큰 배열
function _sbTokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        // 공백/줄바꿈 스킵
        if (/\s/.test(text[i])) { i++; continue; }
        // 줄 주석
        if (text[i] === '#') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }
        // 중괄호
        if (text[i] === '{') { tokens.push({ type: 'LBRACE', pos: i }); i++; continue; }
        if (text[i] === '}') { tokens.push({ type: 'RBRACE', pos: i }); i++; continue; }
        // = 또는 <>= 연산자
        if (text[i] === '=') { tokens.push({ type: 'EQ', pos: i }); i++; continue; }
        if ('<>!'.includes(text[i])) {
            let op = text[i++];
            if (text[i] === '=') op += text[i++];
            tokens.push({ type: 'OP', value: op, pos: i });
            continue;
        }
        // 따옴표 문자열
        if (text[i] === '"') {
            let s = '';
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') i++;
                s += text[i++];
            }
            i++; // 닫는 "
            tokens.push({ type: 'STRING', value: s, pos: i });
            continue;
        }
        // 숫자 (음수 포함) — 정수만 단독으로 오면 IDENT로도 쓰일 수 있음 (스코프 키: 255 = {...})
        if (/[-\d]/.test(text[i]) && (text[i] !== '-' || /\d/.test(text[i+1] || ''))) {
            let s = '';
            const isNeg = text[i] === '-';
            if (isNeg) s += text[i++];
            let isFloat = false;
            while (i < text.length && /[\d.]/.test(text[i])) {
                if (text[i] === '.') isFloat = true;
                s += text[i++];
            }
            // 정수이고 바로 뒤에 공백 후 = 가 오면 IDENT로 처리 (스코프 키)
            let j = i;
            while (j < text.length && text[j] === ' ') j++;
            if (!isFloat && !isNeg && text[j] === '=') {
                tokens.push({ type: 'IDENT', value: s, pos: i });
            } else {
                tokens.push({ type: 'NUMBER', value: s, pos: i });
            }
            continue;
        }
        // 식별자/키워드
        let id = '';
        while (i < text.length && /[A-Za-z0-9_.:@]/.test(text[i])) id += text[i++];
        if (id) { tokens.push({ type: 'IDENT', value: id, pos: i }); continue; }
        // 나머지는 스킵
        i++;
    }
    return tokens;
}

// 블록 파서: 토큰 배열 → 노드 배열
// stopAt: 'RBRACE'면 } 에서 멈춤 (내부 블록용)
function _sbParseBlock(tokens, start, stopAt = null) {
    const nodes = [];
    let i = start;
    while (i < tokens.length) {
        const t = tokens[i];
        if (stopAt && t.type === stopAt) { return { nodes, end: i }; }

        // key = ... 패턴
        if (t.type === 'IDENT' && tokens[i+1]?.type === 'EQ') {
            const key = t.value;
            i += 2;
            // 다음이 { → 블록
            if (tokens[i]?.type === 'LBRACE') {
                i++; // {
                const inner = _sbParseBlock(tokens, i, 'RBRACE');
                i = inner.end + 1; // }

                if (key === 'if') {
                    nodes.push(_sbParseIf(key, inner.nodes, tokens, i));
                    // if는 이미 파싱 완료
                } else {
                    // 스코프 또는 알 수 없는 블록
                    nodes.push({ kind: 'scope', key, children: inner.nodes, _rawBlock: _sbNodesToRaw(inner.nodes) });
                }
            } else {
                // 값 (단순 or 연산자 포함)
                let valToks = [];
                while (i < tokens.length && !['LBRACE','RBRACE','EQ'].includes(tokens[i].type)) {
                    // 다음이 또 IDENT = 이면 새 항목 시작
                    if (tokens[i].type === 'IDENT' && tokens[i+1]?.type === 'EQ') break;
                    valToks.push(tokens[i++]);
                }
                const rawVal = valToks.map(t => t.type === 'STRING' ? `"${t.value}"` : (t.value ?? t.type)).join(' ');
                nodes.push({ kind: 'entry', key, rawVal });
            }
        } else {
            // 인식 불가 → raw
            // 다음 유효 토큰까지 수집
            let raw = '';
            while (i < tokens.length) {
                const cur = tokens[i];
                if (cur.type === 'RBRACE' && stopAt === 'RBRACE') break;
                if (cur.type === 'IDENT' && tokens[i+1]?.type === 'EQ') break;
                raw += (cur.value ?? (cur.type === 'LBRACE' ? '{' : cur.type === 'RBRACE' ? '}' : cur.type)) + ' ';
                i++;
            }
            if (raw.trim()) nodes.push({ kind: 'raw', text: raw.trim() });
        }
    }
    return { nodes, end: i };
}

// if 블록 전용 파서
// inner.nodes: limit/else_if/else 포함된 if 본문 노드들
function _sbParseIf(_, innerNodes) {
    const node = { kind: 'if', limit: [], body: [], elseIfs: [], else_: null };
    let section = 'body';
    for (const n of innerNodes) {
        if (n.kind === 'scope' && n.key === 'limit') { node.limit = n.children; continue; }
        if (n.kind === 'scope' && n.key === 'else_if') {
            const ei = { limit: [], body: [] };
            for (const en of n.children) {
                if (en.kind === 'scope' && en.key === 'limit') ei.limit = en.children;
                else ei.body.push(en);
            }
            node.elseIfs.push(ei);
            continue;
        }
        if (n.kind === 'scope' && n.key === 'else') { node.else_ = n.children; continue; }
        node.body.push(n);
    }
    return node;
}

// ── 빌더: 노드 배열 → rawText ────────────────────────────
function sbBuild(nodes, indent = 0) {
    const t = '\t'.repeat(indent);
    const ti = '\t'.repeat(indent + 1);
    let out = '';
    for (const node of nodes) {
        if (node.kind === 'entry') {
            out += `${t}${node.key} = ${node.rawVal}\n`;
        } else if (node.kind === 'scope') {
            out += `${t}${node.key} = {\n`;
            out += sbBuild(node.children, indent + 1);
            out += `${t}}\n`;
        } else if (node.kind === 'if') {
            out += `${t}if = {\n`;
            if (node.limit?.length) {
                out += `${ti}limit = {\n`;
                out += sbBuild(node.limit, indent + 2);
                out += `${ti}}\n`;
            }
            out += sbBuild(node.body, indent + 1);
            for (const ei of (node.elseIfs || [])) {
                out += `${ti}else_if = {\n`;
                if (ei.limit?.length) {
                    out += `${ti}\tlimit = {\n`;
                    out += sbBuild(ei.limit, indent + 3);
                    out += `${ti}\t}\n`;
                }
                out += sbBuild(ei.body, indent + 2);
                out += `${ti}}\n`;
            }
            if (node.else_) {
                out += `${ti}else = {\n`;
                out += sbBuild(node.else_, indent + 2);
                out += `${ti}}\n`;
            }
            out += `${t}}\n`;
        } else if (node.kind === 'raw') {
            // raw 노드: 각 줄 앞에 들여쓰기 추가, 빈 줄은 그대로 유지
            const lines = node.text.split('\n');
            out += lines.map(l => l.trim() ? `${t}${l.trim()}` : '').join('\n');
            if (!out.endsWith('\n')) out += '\n';
        }
    }
    return out;
}

function _sbNodesToRaw(nodes) { return sbBuild(nodes, 0); }

// ════════════════════════════════════════════════════════
//  renderScriptBlock — 메인 렌더러
//  container : DOM 요소 (교체됨)
//  fieldId   : hidden textarea의 id
//  initialRaw: 초기 텍스트
//  blockType : 'effect' | 'trigger' | 'mixed'
// ════════════════════════════════════════════════════════
function renderScriptBlock(container, fieldId, initialRaw, blockType) {
    container.innerHTML = '';

    // hidden textarea (extractFormData가 읽음)
    let hidden = document.getElementById(fieldId);
    if (!hidden) {
        hidden = document.createElement('textarea');
        hidden.id = fieldId;
        hidden.style.display = 'none';
        container.appendChild(hidden);
    }

    let nodes = sbParse(initialRaw || '');
    const _sync = () => { hidden.value = sbBuild(nodes); };
    _sync();

    const listEl = document.createElement('div');
    listEl.className = 'sb-list';
    container.appendChild(listEl);

    // 툴바
    const toolbar = document.createElement('div');
    toolbar.className = 'sb-toolbar';
    container.appendChild(toolbar);

    const _render = () => {
        listEl.innerHTML = '';
        nodes.forEach((node, idx) => {
            listEl.appendChild(_renderNode(node, idx, nodes, _render, _sync, blockType));
        });
        _sync();
    };

    // 추가 버튼들
    const kinds = blockType === 'trigger'  ? ['trigger'] :
                  blockType === 'effect'   ? ['effect'] :
                  blockType === 'modifier' ? ['modifier'] :
                  blockType === 'rule'     ? ['rule'] :
                  ['effect', 'trigger'];

    kinds.forEach(kind => {
        const btn = _makeAddBtn(kind, (node) => {
            nodes.push(node);
            _render();
        }, blockType);
        toolbar.appendChild(btn);
    });

    // IF / RAW / 스코프 추가 — 두 번째 행으로 분리
    const toolbar2 = document.createElement('div');
    toolbar2.className = 'sb-toolbar sb-toolbar-aux';
    container.appendChild(toolbar2);

    // IF 추가 버튼
    const ifBtn = document.createElement('button');
    ifBtn.type = 'button';
    ifBtn.className = 'sb-add-btn secondary';
    ifBtn.textContent = '+ IF 블록';
    ifBtn.addEventListener('click', () => {
        nodes.push({ kind: 'if', limit: [], body: [], elseIfs: [], else_: null });
        _render();
    });
    toolbar2.appendChild(ifBtn);

    // RAW 추가 버튼
    const rawBtn = document.createElement('button');
    rawBtn.type = 'button';
    rawBtn.className = 'sb-add-btn secondary';
    rawBtn.textContent = '+ RAW';
    rawBtn.addEventListener('click', () => {
        nodes.push({ kind: 'raw', text: '' });
        _render();
    });
    toolbar2.appendChild(rawBtn);

    // 스코프 추가 (GER = { ... }, 255 = { ... }, ROOT 등)
    const mainScopeWrap = document.createElement('div');
    mainScopeWrap.className = 'sb-add-wrap';

    const MAIN_SPECIAL_SCOPES = [
        'ROOT', 'FROM', 'THIS', 'PREV', 'OVERLORD', 'FACTION_LEADER',
        'every_country', 'any_country', 'random_country',
        'every_owned_state', 'any_owned_state', 'random_owned_state',
        'every_state', 'any_state', 'random_state',
        'every_unit_leader', 'any_unit_leader',
    ];

    const mainScopeInput = document.createElement('input');
    mainScopeInput.type = 'text';
    mainScopeInput.className = 'sb-search';
    mainScopeInput.placeholder = '+ 스코프 (GER, 255, ROOT, every_country...)';

    const mainScopeDrop = document.createElement('div');
    mainScopeDrop.className = 'sb-dropdown autocomplete-dropdown';

    const _refreshMainScope = () => {
        const q = mainScopeInput.value.trim().toLowerCase();
        const matches = MAIN_SPECIAL_SCOPES.filter(s => !q || s.toLowerCase().includes(q));
        if (!matches.length) { mainScopeDrop.classList.remove('active'); return; }
        mainScopeDrop.innerHTML = matches.map(s =>
            `<div class="autocomplete-item" data-key="${escapeHtml(s)}">
                <span class="autocomplete-item-id">${escapeHtml(s)}</span>
             </div>`
        ).join('');
        mainScopeDrop.classList.add('active');
        mainScopeDrop.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                nodes.push({ kind: 'scope', key: item.dataset.key, children: [] });
                mainScopeInput.value = ''; mainScopeDrop.classList.remove('active');
                _render();
            });
        });
    };
    mainScopeInput.addEventListener('input', _refreshMainScope);
    mainScopeInput.addEventListener('focus', _refreshMainScope);
    mainScopeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = mainScopeInput.value.trim();
            if (val) {
                nodes.push({ kind: 'scope', key: val, children: [] });
                mainScopeInput.value = ''; mainScopeDrop.classList.remove('active');
                _render();
            }
        }
        if (e.key === 'Escape') mainScopeDrop.classList.remove('active');
    });
    document.addEventListener('click', e => {
        if (!mainScopeWrap.contains(e.target)) mainScopeDrop.classList.remove('active');
    });
    mainScopeWrap.appendChild(mainScopeInput);
    mainScopeWrap.appendChild(mainScopeDrop);
    toolbar2.appendChild(mainScopeWrap);

    _render();
}

// ── 노드 렌더링 ──────────────────────────────────────────
function _renderNode(node, idx, parentList, onRerender, onSync, blockType) {
    const wrap = document.createElement('div');
    wrap.className = 'sb-node';

    const _removeBtn = (label = '✕') => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sb-remove';
        btn.textContent = label;
        btn.title = '삭제';
        btn.addEventListener('click', () => {
            parentList.splice(idx, 1);
            onRerender();
        });
        return btn;
    };

    if (node.kind === 'entry') {
        wrap.className += ' sb-entry';
        const def = hoi4GetDef(node.key);
        const header = document.createElement('div');
        header.className = 'sb-entry-header';

        const keySpan = document.createElement('span');
        keySpan.className = 'sb-entry-key';
        keySpan.textContent = node.key;
        // label은 tooltip으로만 표시
        if (def?.label) keySpan.title = def.label;
        header.appendChild(keySpan);

        // params가 여러 개인 경우 각 param별 label+input 쌍으로 렌더링
        const multiParams = def?.params?.filter(p => p.type !== 'scope_block');
        if (multiParams?.length > 1) {
            // node.paramVals: { [paramName]: value } 형태로 저장
            if (!node.paramVals) {
                // 기존 rawVal에서 마이그레이션 시도
                node.paramVals = {};
                multiParams.forEach((p, i) => {
                    const parts = (node.rawVal ?? '').split(/\s+/);
                    node.paramVals[p.name] = parts[i] ?? (p.default !== undefined ? String(p.default) : '');
                });
            }
            const paramsWrap = document.createElement('div');
            paramsWrap.className = 'sb-multi-params';
            multiParams.forEach(p => {
                const pair = document.createElement('span');
                pair.className = 'sb-param-pair';
                const lbl = document.createElement('label');
                lbl.className = 'sb-param-label';
                lbl.textContent = p.name;
                const inp = document.createElement('input');
                inp.className = 'sb-param-val';
                inp.value = node.paramVals[p.name] ?? '';
                inp.placeholder = p.type;
                inp.addEventListener('input', () => {
                    node.paramVals[p.name] = inp.value;
                    // rawVal도 동기화 (파서 호환)
                    node.rawVal = multiParams.map(pp => node.paramVals[pp.name] ?? '').join(' ').trim();
                    onSync();
                });
                pair.appendChild(lbl);
                pair.appendChild(inp);
                paramsWrap.appendChild(pair);
            });
            header.appendChild(paramsWrap);
        } else if (multiParams?.length === 1 && multiParams[0].type === 'bool') {
            // bool 타입 단일값 → yes / no 라디오 버튼
            const cur = (node.rawVal ?? 'yes').trim().toLowerCase();
            const radioWrap = document.createElement('div');
            radioWrap.className = 'sb-bool-radio';
            const groupName = `sb-bool-${++_sbBoolGroupSeq}`;
            ['yes', 'no'].forEach(val => {
                const lbl = document.createElement('label');
                lbl.className = 'sb-bool-label';
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = groupName;
                radio.value = val;
                radio.checked = cur === val;
                radio.addEventListener('change', () => {
                    if (radio.checked) {
                        node.rawVal = val;
                        onSync();
                    }
                });
                lbl.appendChild(radio);
                lbl.appendChild(document.createTextNode(val));
                radioWrap.appendChild(lbl);
            });
            header.appendChild(radioWrap);
        } else {
            // 단일값 인풋
            const valInput = document.createElement('input');
            valInput.className = 'sb-entry-val';
            valInput.value = node.rawVal ?? '';
            if (multiParams?.length === 1) valInput.placeholder = multiParams[0].type;
            valInput.addEventListener('input', () => {
                node.rawVal = valInput.value;
                onSync();
            });
            header.appendChild(valInput);
        }
        header.appendChild(_removeBtn());
        wrap.appendChild(header);

    } else if (node.kind === 'raw') {
        wrap.className += ' sb-raw';
        const header = document.createElement('div');
        header.className = 'sb-entry-header';
        const lbl = document.createElement('span');
        lbl.className = 'sb-entry-key';
        lbl.textContent = 'RAW';
        header.appendChild(lbl);
        header.appendChild(_removeBtn());
        wrap.appendChild(header);

        const ta = document.createElement('textarea');
        ta.className = 'sb-raw-ta';
        ta.value = node.text;
        ta.rows = 3;
        ta.addEventListener('input', () => {
            // textarea 값 그대로 보존 (줄바꿈 포함)
            node.text = ta.value;
            onSync();
        });
        wrap.appendChild(ta);

    } else if (node.kind === 'scope') {
        wrap.className += ' sb-scope';

        // 헤더
        const header = document.createElement('div');
        header.className = 'sb-entry-header';
        const lbl = document.createElement('span');
        lbl.className = 'sb-entry-key';
        lbl.textContent = node.key + ' { }';
        header.appendChild(lbl);
        header.appendChild(_removeBtn());
        wrap.appendChild(header);

        // 스코프 내부 (재귀)
        const inner = document.createElement('div');
        inner.className = 'sb-scope-inner';
        renderScriptBlockNodes(inner, node.children, onSync, blockType);
        wrap.appendChild(inner);

        // 스코프 내 추가 버튼 (effect|trigger / IF / 스코프 / RAW)
        const scopeToolbar = document.createElement('div');
        scopeToolbar.className = 'sb-scope-toolbar';

        // effect / trigger / modifier 검색 — blockType 에 맞게
        const scopeChildKind = blockType === 'trigger' ? 'trigger' : blockType === 'modifier' ? 'modifier' : 'effect';
        const addEffBtn = _makeAddBtn(scopeChildKind, (n) => { node.children.push(n); onRerender(); }, blockType);
        addEffBtn.querySelector('.sb-search').placeholder = scopeChildKind === 'trigger' ? '조건 검색...' : scopeChildKind === 'modifier' ? '모디파이어 검색...' : '효과 검색...';
        scopeToolbar.appendChild(addEffBtn);

        // IF 추가
        const addIfBtn2 = document.createElement('button');
        addIfBtn2.type = 'button'; addIfBtn2.className = 'sb-add-btn secondary';
        addIfBtn2.textContent = '+ IF';
        addIfBtn2.addEventListener('click', () => {
            node.children.push({ kind: 'if', limit: [], body: [], elseIfs: [], else_: null });
            onRerender();
        });
        scopeToolbar.appendChild(addIfBtn2);

        // 스코프 추가 — 특수 스코프 드롭다운 + 직접 입력
        const scopeAddWrap = document.createElement('div');
        scopeAddWrap.style.position = 'relative';
        scopeAddWrap.style.flex = '1';
        scopeAddWrap.style.minWidth = '140px';

        const SPECIAL_SCOPES = ['ROOT', 'FROM', 'THIS', 'PREV', 'OVERLORD', 'FACTION_LEADER', 'every_country', 'any_country', 'random_country', 'every_owned_state', 'any_owned_state', 'random_owned_state', 'every_state', 'any_state', 'random_state', 'every_unit_leader', 'any_unit_leader'];

        const scopeInput = document.createElement('input');
        scopeInput.type = 'text';
        scopeInput.className = 'sb-search';
        scopeInput.placeholder = '스코프 (GER, 255, ROOT...)';

        const scopeDrop = document.createElement('div');
        scopeDrop.className = 'sb-dropdown autocomplete-dropdown';

        const _refreshScopeDrop = () => {
            const q = scopeInput.value.trim().toLowerCase();
            const matches = SPECIAL_SCOPES.filter(s => !q || s.toLowerCase().includes(q));
            if (!matches.length) { scopeDrop.classList.remove('active'); return; }
            scopeDrop.innerHTML = matches.map(s =>
                `<div class="autocomplete-item" data-key="${escapeHtml(s)}">
                    <span class="autocomplete-item-id">${escapeHtml(s)}</span>
                 </div>`
            ).join('');
            scopeDrop.classList.add('active');
            scopeDrop.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    node.children.push({ kind: 'scope', key: item.dataset.key, children: [] });
                    scopeInput.value = ''; scopeDrop.classList.remove('active');
                    onRerender();
                });
            });
        };
        scopeInput.addEventListener('input', _refreshScopeDrop);
        scopeInput.addEventListener('focus', _refreshScopeDrop);
        scopeInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = scopeInput.value.trim();
                if (val) {
                    node.children.push({ kind: 'scope', key: val, children: [] });
                    scopeInput.value = ''; scopeDrop.classList.remove('active');
                    onRerender();
                }
            }
            if (e.key === 'Escape') scopeDrop.classList.remove('active');
        });
        document.addEventListener('click', e => {
            if (!scopeAddWrap.contains(e.target)) scopeDrop.classList.remove('active');
        });
        scopeAddWrap.appendChild(scopeInput);
        scopeAddWrap.appendChild(scopeDrop);
        scopeToolbar.appendChild(scopeAddWrap);

        // RAW 추가
        const addRawBtn2 = document.createElement('button');
        addRawBtn2.type = 'button'; addRawBtn2.className = 'sb-add-btn secondary';
        addRawBtn2.textContent = '+ RAW';
        addRawBtn2.addEventListener('click', () => { node.children.push({ kind: 'raw', text: '' }); onRerender(); });
        scopeToolbar.appendChild(addRawBtn2);
        wrap.appendChild(scopeToolbar);

    } else if (node.kind === 'if') {
        wrap.className += ' sb-if-block';
        _renderIfBlock(wrap, node, onRerender, onSync, blockType);
        wrap.appendChild(_removeBtn('× IF 삭제'));    }

    return wrap;
}

// ── IF 블록 렌더링 ────────────────────────────────────────
function _renderIfBlock(wrap, node, onRerender, onSync, blockType) {
    // LIMIT
    const limitSection = _makeSection('LIMIT (조건)', 'sb-section-limit');
    renderScriptBlockNodes(limitSection, node.limit, onSync, 'trigger');
    const addLimitRow = _makeAddBtn('trigger', (n) => { node.limit.push(n); onRerender(); }, 'trigger');
    limitSection.appendChild(addLimitRow);
    wrap.appendChild(limitSection);

    // BODY
    const bodySection = _makeSection('BODY (효과)', 'sb-section-body');
    renderScriptBlockNodes(bodySection, node.body, onSync, blockType);
    const addBodyRow = _makeAddBtn(blockType === 'trigger' ? 'trigger' : 'effect', (n) => { node.body.push(n); onRerender(); }, blockType);
    bodySection.appendChild(addBodyRow);
    wrap.appendChild(bodySection);

    // ELSE_IF들
    node.elseIfs.forEach((ei, eiIdx) => {
        const eiWrap = document.createElement('div');
        eiWrap.className = 'sb-elseif';

        const eiHeader = document.createElement('div');
        eiHeader.className = 'sb-section-header';
        eiHeader.textContent = `ELSE_IF ${eiIdx + 1}`;
        const delEi = document.createElement('button');
        delEi.type = 'button'; delEi.className = 'sb-remove'; delEi.textContent = '✕';
        delEi.addEventListener('click', () => { node.elseIfs.splice(eiIdx, 1); onRerender(); });
        eiHeader.appendChild(delEi);
        eiWrap.appendChild(eiHeader);

        const eiLimit = _makeSection('LIMIT', 'sb-section-limit');
        renderScriptBlockNodes(eiLimit, ei.limit, onSync, 'trigger');
        eiWrap.appendChild(eiLimit);
        const eiBody = _makeSection('BODY', 'sb-section-body');
        renderScriptBlockNodes(eiBody, ei.body, onSync, blockType);
        eiWrap.appendChild(eiBody);
        wrap.appendChild(eiWrap);
    });

    // ELSE
    if (node.else_) {
        const elseWrap = document.createElement('div');
        elseWrap.className = 'sb-else';
        const elseHeader = document.createElement('div');
        elseHeader.className = 'sb-section-header';
        elseHeader.textContent = 'ELSE';
        const delElse = document.createElement('button');
        delElse.type = 'button'; delElse.className = 'sb-remove'; delElse.textContent = '✕';
        delElse.addEventListener('click', () => { node.else_ = null; onRerender(); });
        elseHeader.appendChild(delElse);
        elseWrap.appendChild(elseHeader);
        renderScriptBlockNodes(elseWrap, node.else_, onSync, blockType);
        wrap.appendChild(elseWrap);
    }

    // 하단 액션 버튼들
    const actions = document.createElement('div');
    actions.className = 'sb-if-actions';
    const addEiBtn = document.createElement('button');
    addEiBtn.type = 'button'; addEiBtn.className = 'secondary sb-add-btn';
    addEiBtn.textContent = '+ ELSE_IF';
    addEiBtn.addEventListener('click', () => { node.elseIfs.push({ limit: [], body: [] }); onRerender(); });
    actions.appendChild(addEiBtn);
    if (!node.else_) {
        const addElseBtn = document.createElement('button');
        addElseBtn.type = 'button'; addElseBtn.className = 'secondary sb-add-btn';
        addElseBtn.textContent = '+ ELSE';
        addElseBtn.addEventListener('click', () => { node.else_ = []; onRerender(); });
        actions.appendChild(addElseBtn);
    }
    wrap.appendChild(actions);
}

// ── 중첩 노드 렌더링 (onRerender 없이) ───────────────────
function renderScriptBlockNodes(container, nodeList, onSync, blockType) {
    const listEl = document.createElement('div');
    listEl.className = 'sb-list sb-list-inner';
    container.appendChild(listEl);

    const _render = () => {
        listEl.innerHTML = '';
        nodeList.forEach((node, idx) => {
            listEl.appendChild(_renderNode(node, idx, nodeList, _render, onSync, blockType));
        });
        onSync();
    };
    _render();
}

// ── 섹션 헤더 ────────────────────────────────────────────
function _makeSection(title, cls) {
    const sec = document.createElement('div');
    sec.className = 'sb-section ' + cls;
    const hdr = document.createElement('div');
    hdr.className = 'sb-section-header';
    hdr.textContent = title;
    sec.appendChild(hdr);
    return sec;
}

// ── 추가 버튼 (드롭다운 검색) ────────────────────────────
function _makeAddBtn(kind, onAdd, blockType) {
    const wrap = document.createElement('div');
    wrap.className = 'sb-add-wrap';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'sb-search';
    searchInput.placeholder = kind === 'trigger' ? '조건 검색...' : kind === 'effect' ? '효과 검색...' : kind === 'modifier' ? '모디파이어 검색...' : kind === 'rule' ? '규칙 검색...' : '검색...';

    const dropdown = document.createElement('div');
    dropdown.className = 'sb-dropdown autocomplete-dropdown';

    let selIdx = -1;

    const _refresh = () => {
        const q = searchInput.value.trim();
        selIdx = -1;
        const kinds = kind === 'mixed' ? ['effect','trigger'] : [kind];
        const results = hoi4SearchDefs(q, kinds, 30);
        if (!results.length) { dropdown.classList.remove('active'); return; }
        dropdown.innerHTML = results.map((d, i) =>
            `<div class="autocomplete-item" data-key="${escapeHtml(d.key)}" data-index="${i}">
                <span class="autocomplete-item-id">${escapeHtml(d.key)}</span>
                ${d.label ? `<span class="autocomplete-item-name">${escapeHtml(d.label)}</span>` : ''}
                <span class="sb-kind-badge sb-kind-${d._kind}">${d._kind}</span>
             </div>`
        ).join('');
        dropdown.classList.add('active');
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                _pick(item.dataset.key);
            });
        });
    };

    const _pick = (key) => {
        const def = hoi4GetDef(key);

        // params 중 scope_block 타입이 있거나, params 없이 label/scope만 있는 블록형 → scope 노드로 추가
        const isBlockType = def?.params?.some(p => p.type === 'scope_block')
            || (def && !def.params && (def.label || def.scope));
        if (isBlockType) {
            onAdd({ kind: 'scope', key, children: [] });
            searchInput.value = '';
            dropdown.classList.remove('active');
            return;
        }

        // 기본값으로 rawVal 구성
        let rawVal = '';
        if (def?.params?.length === 1 && def.params[0].default !== undefined) {
            rawVal = String(def.params[0].default);
        } else if (def?.params?.length === 1 && def.params[0].type === 'bool') {
            rawVal = 'yes';
        } else if (def?.params) {
            rawVal = def.params.map(p => p.default !== undefined ? String(p.default) : (p.type === 'bool' ? 'yes' : '')).join(' ').trim();
        }
        onAdd({ kind: 'entry', key, rawVal });
        searchInput.value = '';
        dropdown.classList.remove('active');
    };

    searchInput.addEventListener('input', _refresh);
    searchInput.addEventListener('focus', _refresh);
    searchInput.addEventListener('keydown', e => {
        const items = [...dropdown.querySelectorAll('.autocomplete-item')];
        if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx+1, items.length-1); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = Math.max(selIdx-1, 0); }
        items.forEach((it, i) => it.classList.toggle('selected', i === selIdx));
        if (e.key === 'Enter') {
            e.preventDefault();
            if (selIdx >= 0) {
                _pick(items[selIdx].dataset.key);
            } else {
                // 드롭다운 선택 없이 Enter → hoi4-defs에 없으면 추가 안 함
                // (미정의 키는 RAW 노드나 스코프로 추가해야 함)
                dropdown.classList.remove('active');
            }
            searchInput.value = '';
        }
        if (e.key === 'Escape') dropdown.classList.remove('active');
    });
    document.addEventListener('click', e => {
        if (!wrap.contains(e.target)) dropdown.classList.remove('active');
    });

    wrap.appendChild(searchInput);
    wrap.appendChild(dropdown);
    return wrap;
}