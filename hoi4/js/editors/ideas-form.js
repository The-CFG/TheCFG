// ════════════════════════════════════════════════════════
//  ideas-form.js — 아이디어 폼 렌더러 + 데이터 추출
//  의존: io-parsers.js(escapeHtml), script-block.js,
//        ideas-editor.js(_saveCurrentIdea, _deleteIdea)
// ════════════════════════════════════════════════════════

// ── 접기/펼치기 섹션 헬퍼 ───────────────────────────────
function _makeCollapsibleSection(title, cls = '', startOpen = false) {
    const wrap = document.createElement('div');
    wrap.className = 'focus-form-section ideas-collapsible' + (cls ? ' ' + cls : '');

    const header = document.createElement('div');
    header.className = 'ideas-section-header';
    header.innerHTML = `<span class="ideas-section-arrow">${startOpen ? '▾' : '▸'}</span><h4 style="margin:0;display:inline;">${escapeHtml(title)}</h4>`;
    header.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;';

    const body = document.createElement('div');
    body.className = 'ideas-section-body';
    body.style.display = startOpen ? '' : 'none';

    header.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        header.querySelector('.ideas-section-arrow').textContent = open ? '▸' : '▾';
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    return { wrap, body };
}

// ── raw textarea 블록 헬퍼 ──────────────────────────────
function _makeRawTextarea(fieldId, initialRaw, placeholder = '') {
    const ta = document.createElement('textarea');
    ta.id = fieldId;
    ta.className = 'raw-editor ideas-raw-ta';
    ta.value = initialRaw || '';
    ta.placeholder = placeholder;
    ta.style.cssText = 'width:100%;min-height:80px;font-family:monospace;font-size:11px;box-sizing:border-box;';
    return ta;
}

// ── script-block 섹션 헬퍼 ──────────────────────────────
function _makeScriptBlockSection(body, fieldId, initialRaw, blockType) {
    const container = document.createElement('div');
    container.className = 'sb-container';
    body.appendChild(container);
    // script-block.js의 renderScriptBlock 호출 (비동기 안 해도 됨)
    renderScriptBlock(container, fieldId, initialRaw, blockType);
}

// ── 트레잇 칩 UI ────────────────────────────────────────
let _ideaTraits = [];

function _renderTraitChips(container, traits) {
    _ideaTraits = [...(traits || [])];
    const listEl = document.createElement('div');
    listEl.id = 'idea-traits-list';
    listEl.className = 'chip-list';

    const rerender = () => {
        listEl.innerHTML = '';
        _ideaTraits.forEach((t, i) => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.innerHTML = `${escapeHtml(t)} <button class="chip-remove" data-i="${i}">×</button>`;
            chip.querySelector('.chip-remove').addEventListener('click', () => {
                _ideaTraits.splice(i, 1);
                rerender();
            });
            listEl.appendChild(chip);
        });
    };
    rerender();

    const inputRow = document.createElement('div');
    inputRow.className = 'chip-input-row';
    inputRow.innerHTML = `
        <input type="text" id="idea-trait-input" placeholder="trait_name" style="flex:1;">
        <button type="button" class="chip-add-btn secondary">추가</button>
    `;
    const input  = inputRow.querySelector('#idea-trait-input');
    const addBtn = inputRow.querySelector('.chip-add-btn');
    const doAdd  = () => {
        const v = input.value.trim();
        if (!v) return;
        if (!_ideaTraits.includes(v)) { _ideaTraits.push(v); rerender(); }
        input.value = '';
    };
    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });

    container.appendChild(listEl);
    container.appendChild(inputRow);
}

function _readTraitChips() { return [..._ideaTraits]; }

// ── 폼 전체 렌더 ────────────────────────────────────────
function renderIdeasForm(panel, ideaId, idea, catName) {
    panel.innerHTML = '';
    panel.style.cssText = 'overflow-y:auto;height:100%;';

    const form = document.createElement('div');
    form.className = 'ideas-form-inner';
    panel.appendChild(form);

    // ── 헤더 ──────────────────────────────────────────
    const headerDiv = document.createElement('div');
    headerDiv.className = 'ideas-form-header';
    headerDiv.innerHTML = `
        <h3 style="margin:0;font-size:15px;">💡 ${escapeHtml(ideaId)}</h3>
        <div style="display:flex;gap:6px;">
            <button id="btn-idea-save" class="primary">💾 저장</button>
            <button id="btn-idea-delete" class="danger">🗑 삭제</button>
        </div>
    `;
    form.appendChild(headerDiv);

    // ══ 기본 정보 섹션 ════════════════════════════════
    const { wrap: basicWrap, body: basicBody } = _makeCollapsibleSection('기본 정보', '', true);
    form.appendChild(basicWrap);

    // ID
    _addFormGroup(basicBody, 'ID', `
        <input type="text" id="idea-id" value="${escapeHtml(ideaId)}" placeholder="my_spirit_id">
        <small class="form-hint">⚠ ID 변경 시 저장 버튼을 눌러야 반영됩니다</small>
    `);

    // 주석
    _addFormGroup(basicBody, '주석 (# 메모)', `
        <input type="text" id="idea-comment" value="${escapeHtml(idea._comment || '')}" placeholder="파일에 # 주석으로 저장됩니다">
    `);

    // picture
    _addFormGroup(basicBody, 'Picture GFX Key', `
        <input type="text" id="idea-picture" value="${escapeHtml(idea.picture || '')}" placeholder="my_picture">
        <small class="form-hint">실제 sprite: GFX_idea_{입력값} (게임이 자동으로 prefix 추가)</small>
    `);

    // name (별도 로컬라이징 키)
    _addFormGroup(basicBody, 'Name Key (선택)', `
        <input type="text" id="idea-name" value="${escapeHtml(idea.name || '')}" placeholder="(기본: ID와 동일)">
        <small class="form-hint">다른 로컬라이징 키를 사용할 경우에만 입력</small>
    `);

    // cost / removal_cost / level
    const numRow = document.createElement('div');
    numRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;';
    numRow.innerHTML = `
        <div class="form-group">
            <label>Cost (PP)</label>
            <input type="number" id="idea-cost" value="${idea.cost ?? ''}" placeholder="기본 150">
        </div>
        <div class="form-group">
            <label>Removal Cost</label>
            <input type="number" id="idea-removal-cost" value="${idea.removal_cost ?? ''}" placeholder="기본 0 (-1: 불가)">
        </div>
        <div class="form-group">
            <label>Level</label>
            <input type="number" id="idea-level" value="${idea.level ?? ''}" placeholder="(선택)">
        </div>
    `;
    basicBody.appendChild(numRow);

    // ledger
    _addFormGroup(basicBody, 'Ledger', `
        <select id="idea-ledger">
            <option value="">-- 없음 --</option>
            ${['army','air','navy','military','civilian','all','hidden'].map(v =>
                `<option value="${v}" ${idea.ledger === v ? 'selected' : ''}>${v}</option>`
            ).join('')}
        </select>
    `);

    // traits
    const traitsGroup = document.createElement('div');
    traitsGroup.className = 'form-group';
    traitsGroup.innerHTML = '<label>Traits</label>';
    const traitsContainer = document.createElement('div');
    _renderTraitChips(traitsContainer, idea.traits);
    traitsGroup.appendChild(traitsContainer);
    basicBody.appendChild(traitsGroup);

    // ══ 조건 섹션 ═════════════════════════════════════
    const condFields = [
        { label: 'allowed',            id: 'idea-allowed',     type: 'trigger', desc: '게임 시작 시 1회 체크 (국가/DLC 제한)' },
        { label: 'allowed_civil_war',  id: 'idea-acw',         type: 'trigger', desc: '내전 시 어느 쪽에 유지될지 결정' },
        { label: 'allowed_to_remove',  id: 'idea-atr',         type: 'trigger', desc: '수동 제거 가능 조건 (지속 체크)' },
        { label: 'visible',            id: 'idea-visible',     type: 'trigger', desc: '선택 화면에 표시될 조건 (지속 체크)' },
        { label: 'available',          id: 'idea-available',   type: 'trigger', desc: '선택 가능한 조건 (visible 충족 후)' },
        { label: 'cancel',             id: 'idea-cancel',      type: 'trigger', desc: '자동 취소 조건 (충족 시 on_remove 발동)' },
        { label: 'do_effect',          id: 'idea-do-effect',   type: 'trigger', desc: '모디파이어 적용 조건 (아이디어는 유지)' },
    ];

    const { wrap: condWrap, body: condBody } = _makeCollapsibleSection('조건 블록');
    form.appendChild(condWrap);

    condFields.forEach(({ label, id, type, desc }) => {
        const sec = document.createElement('div');
        sec.style.marginBottom = '12px';
        sec.innerHTML = `<label style="font-size:12px;font-weight:600;display:block;margin-bottom:2px;">${escapeHtml(label)}</label>
            ${desc ? `<small class="form-hint" style="display:block;margin-bottom:4px;">${escapeHtml(desc)}</small>` : ''}`;
        const sbContainer = document.createElement('div');
        sec.appendChild(sbContainer);
        renderScriptBlock(sbContainer, id, idea[label.replace(/-/g, '_')] || '', type);
        condBody.appendChild(sec);
    });

    // ══ Modifier 섹션 ═════════════════════════════════
    const { wrap: modWrap, body: modBody } = _makeCollapsibleSection('Modifier 블록');
    form.appendChild(modWrap);

    // script-block 기반 모디파이어 필드 (modifier / targeted_modifier)
    const modSbFields = [
        { label: 'modifier',          id: 'idea-modifier-sb', desc: '일반 모디파이어 (key = value 형식)' },
        { label: 'targeted_modifier', id: 'idea-tmod-sb',     desc: '대상 국가 모디파이어 (tag = ABC 포함)' },
    ];
    modSbFields.forEach(({ label, id, desc }) => {
        const fieldKey = label.replace(/-/g, '_');
        const sec = document.createElement('div');
        sec.style.marginBottom = '12px';
        sec.innerHTML = `<label style="font-size:12px;font-weight:600;display:block;margin-bottom:2px;">${escapeHtml(label)}</label>
            ${desc ? `<small class="form-hint" style="display:block;margin-bottom:4px;">${escapeHtml(desc)}</small>` : ''}`;
        const sbContainer = document.createElement('div');
        sec.appendChild(sbContainer);
        renderScriptBlock(sbContainer, id, idea[fieldKey] || '', 'modifier');
        modBody.appendChild(sec);
    });

    // raw textarea 유지 필드 (research_bonus / equipment_bonus)
    const modRawFields = [
        { label: 'research_bonus',    id: 'idea-research-raw',  desc: '기술 카테고리 연구 보너스', ph: 'infantry = 0.1\nartillery = -0.2' },
        { label: 'equipment_bonus',   id: 'idea-equip-raw',     desc: '장비 아키타입 보너스', ph: 'infantry_equipment = {\n    instant = yes\n    soft_attack = 0.1\n}' },
    ];

    modRawFields.forEach(({ label, id, desc, ph }) => {
        const fieldKey = label.replace(/-/g, '_'); // targeted_modifier 등
        const sec = document.createElement('div');
        sec.style.marginBottom = '12px';
        sec.innerHTML = `<label style="font-size:12px;font-weight:600;display:block;margin-bottom:2px;">${escapeHtml(label)}</label>
            ${desc ? `<small class="form-hint" style="display:block;margin-bottom:4px;">${escapeHtml(desc)}</small>` : ''}`;
        const ta = _makeRawTextarea(id, idea[fieldKey] || '', ph);
        sec.appendChild(ta);
        modBody.appendChild(sec);
    });

    // ══ Rule 섹션 ══════════════════════════════════════
    const { wrap: ruleWrap, body: ruleBody } = _makeCollapsibleSection('Rule (외교/행동 규칙)');
    form.appendChild(ruleWrap);
    {
        const sec = document.createElement('div');
        sec.style.marginBottom = '12px';
        sec.innerHTML = `<small class="form-hint" style="display:block;margin-bottom:4px;">국가가 할 수 있는 행동을 yes/no로 제한하거나 허용합니다.</small>`;
        const sbContainer = document.createElement('div');
        sec.appendChild(sbContainer);
        renderScriptBlock(sbContainer, 'idea-rule-sb', idea.rule || '', 'rule');
        ruleBody.appendChild(sec);
    }


    // ══ 이벤트 섹션 ═══════════════════════════════════
    const eventFields = [
        { label: 'on_add',     id: 'idea-on-add',    type: 'effect', desc: '아이디어 추가 시 1회 실행 (게임 시작 시 제외)' },
        { label: 'on_remove',  id: 'idea-on-remove', type: 'effect', desc: '아이디어 제거/취소 시 1회 실행' },
        { label: 'ai_will_do', id: 'idea-ai',        type: 'effect', desc: 'AI 행동 가중치' },
    ];

    const { wrap: evtWrap, body: evtBody } = _makeCollapsibleSection('이벤트 / AI');
    form.appendChild(evtWrap);

    eventFields.forEach(({ label, id, type, desc }) => {
        const fieldKey = label.replace(/-/g, '_');
        const sec = document.createElement('div');
        sec.style.marginBottom = '12px';
        sec.innerHTML = `<label style="font-size:12px;font-weight:600;display:block;margin-bottom:2px;">${escapeHtml(label)}</label>
            ${desc ? `<small class="form-hint" style="display:block;margin-bottom:4px;">${escapeHtml(desc)}</small>` : ''}`;
        const sbContainer = document.createElement('div');
        sec.appendChild(sbContainer);
        renderScriptBlock(sbContainer, id, idea[fieldKey] || '', type);
        evtBody.appendChild(sec);
    });

    // ── 저장 / 삭제 버튼 이벤트 바인딩 ─────────────────
    panel.querySelector('#btn-idea-save')?.addEventListener('click', () => _saveCurrentIdea(false));
    panel.querySelector('#btn-idea-delete')?.addEventListener('click', () => _deleteIdea(ideaId));
}

// ── 폼 그룹 헬퍼 ────────────────────────────────────────
function _addFormGroup(parent, label, innerHtml) {
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `<label>${escapeHtml(label)}</label>${innerHtml}`;
    parent.appendChild(div);
}

// ── 폼 데이터 추출 ───────────────────────────────────────
function extractIdeasFormData() {
    const gv  = id => document.getElementById(id)?.value?.trim() ?? '';
    const gnf = id => { const v = parseFloat(gv(id)); return Number.isNaN(v) ? null : v; };

    return {
        _id:           gv('idea-id'),   // ID 변경 감지용 (저장 후 제거)
        _comment:      gv('idea-comment'),
        picture:       gv('idea-picture'),
        name:          gv('idea-name'),
        cost:          gnf('idea-cost'),
        removal_cost:  gnf('idea-removal-cost'),
        level:         gnf('idea-level'),
        ledger:        gv('idea-ledger'),
        traits:        _readTraitChips(),
        // script-block 필드 (hidden textarea에서 읽음)
        allowed:           gv('idea-allowed'),
        allowed_civil_war: gv('idea-acw'),
        allowed_to_remove: gv('idea-atr'),
        visible:           gv('idea-visible'),
        available:         gv('idea-available'),
        cancel:            gv('idea-cancel'),
        do_effect:         gv('idea-do-effect'),
        // modifier 블록 (script-block)
        modifier:          gv('idea-modifier-sb'),
        targeted_modifier: gv('idea-tmod-sb'),
        // raw textarea 필드
        research_bonus:    gv('idea-research-raw'),
        equipment_bonus:   gv('idea-equip-raw'),
        rule:              gv('idea-rule-sb'),
        // 이벤트 script-block
        on_add:    gv('idea-on-add'),
        on_remove: gv('idea-on-remove'),
        ai_will_do:gv('idea-ai'),
    };
}