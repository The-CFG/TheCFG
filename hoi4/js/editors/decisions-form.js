// ════════════════════════════════════════════════════════
//  decisions-form.js — 디시전 / 디시전 카테고리 폼 렌더러
//  의존: io-parsers.js(escapeHtml), script-block.js,
//        decisions-editor.js(_saveCurrentDecision, _saveCurrentCategory, _deleteDecision, _deleteDecCategory)
// ════════════════════════════════════════════════════════

// ── 접기/펼치기 섹션 헬퍼 ───────────────────────────────
function _decMakeSection(title, startOpen = false) {
    const wrap = document.createElement('div');
    wrap.className = 'dec-collapsible';

    const header = document.createElement('div');
    header.className = 'dec-section-header';
    header.innerHTML = `<span class="dec-section-arrow">${startOpen ? '▾' : '▸'}</span><h4 style="margin:0;display:inline;">${escapeHtml(title)}</h4>`;

    const body = document.createElement('div');
    body.className = 'dec-section-body';
    body.style.display = startOpen ? '' : 'none';

    header.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        header.querySelector('.dec-section-arrow').textContent = open ? '▸' : '▾';
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    return { wrap, body };
}

// ── script-block 필드 헬퍼 ──────────────────────────────
function _decAddScriptBlock(body, fieldId, label, initialRaw, blockType, desc = '') {
    const sec = document.createElement('div');
    sec.style.marginBottom = '12px';
    sec.innerHTML = `<label style="font-size:12px;font-weight:600;display:block;margin-bottom:2px;">${escapeHtml(label)}</label>
        ${desc ? `<small class="form-hint" style="display:block;margin-bottom:4px;">${escapeHtml(desc)}</small>` : ''}`;
    const sbWrap = document.createElement('div');
    sec.appendChild(sbWrap);
    renderScriptBlock(sbWrap, fieldId, initialRaw || '', blockType);
    body.appendChild(sec);
}

// ── raw textarea 헬퍼 ────────────────────────────────────
function _decAddRawTextarea(body, fieldId, label, initialRaw, placeholder = '', desc = '') {
    const sec = document.createElement('div');
    sec.style.marginBottom = '12px';
    sec.innerHTML = `<label style="font-size:12px;font-weight:600;display:block;margin-bottom:2px;">${escapeHtml(label)}</label>
        ${desc ? `<small class="form-hint" style="display:block;margin-bottom:4px;">${escapeHtml(desc)}</small>` : ''}`;
    const ta = document.createElement('textarea');
    ta.id          = fieldId;
    ta.className   = 'raw-editor dec-raw-ta';
    ta.value       = initialRaw || '';
    ta.placeholder = placeholder;
    sec.appendChild(ta);
    body.appendChild(sec);
}

// ── form-group 헬퍼 ─────────────────────────────────────
function _decFormGroup(parent, label, innerHtml) {
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `<label>${escapeHtml(label)}</label>${innerHtml}`;
    parent.appendChild(div);
}

// ── 체크박스 행 헬퍼 ────────────────────────────────────
function _decCheckRow(parent, fieldId, label, checked) {
    const div = document.createElement('div');
    div.className = 'form-group';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;';
    div.innerHTML = `
        <input type="checkbox" id="${escapeHtml(fieldId)}" ${checked ? 'checked' : ''} style="width:auto;margin:0;">
        <label for="${escapeHtml(fieldId)}" style="margin:0;cursor:pointer;">${escapeHtml(label)}</label>`;
    parent.appendChild(div);
}

// ════════════════════════════════════════════════════════
//  디시전 폼 렌더
// ════════════════════════════════════════════════════════
function renderDecisionForm(panel, decId, dec, catKey) {
    panel.innerHTML = '';
    panel.style.cssText = 'overflow-y:auto;height:100%;';

    const form = document.createElement('div');
    form.className = 'decisions-form-inner';
    panel.appendChild(form);

    // ── 헤더 ──────────────────────────────────────────
    const isMission  = !!dec.days_mission_timeout;
    const isTargeted = !!(dec.targets || dec.target_array || dec.target_trigger || dec.target_root_trigger);

    const headerDiv = document.createElement('div');
    headerDiv.className = 'decisions-form-header';
    headerDiv.innerHTML = `
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;">
            <h3 style="margin:0;font-size:15px;">⚖️ ${escapeHtml(decId)}</h3>
            ${isMission  ? '<span class="dec-badge-mission">미션</span>'   : ''}
            ${isTargeted ? '<span class="dec-badge-targeted">타게팅</span>' : ''}
            <small style="color:var(--text-muted);font-size:11px;margin-left:4px;">${escapeHtml(catKey)}</small>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
            <button id="btn-dec-save" class="primary">💾 저장</button>
            <button id="btn-dec-delete" class="danger">🗑 삭제</button>
        </div>`;
    form.appendChild(headerDiv);

    // ══ 1. 기본 섹션 ══════════════════════════════════
    const { wrap: basicWrap, body: basicBody } = _decMakeSection('기본', true);
    form.appendChild(basicWrap);

    // ID
    _decFormGroup(basicBody, 'ID', `
        <input type="text" id="dec-id" value="${escapeHtml(decId)}" placeholder="my_decision_id">
        <small class="form-hint">⚠ ID 변경 시 저장 버튼을 눌러야 반영됩니다</small>`);

    // icon / cost / priority 가로 배열
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;';
    row1.innerHTML = `
        <div class="form-group">
            <label>Icon GFX</label>
            <input type="text" id="dec-icon" value="${escapeHtml(dec.icon || '')}" placeholder="GFX_decision_...">
        </div>
        <div class="form-group">
            <label>Cost (PP)</label>
            <input type="text" id="dec-cost" value="${escapeHtml(dec.cost || '')}" placeholder="0">
        </div>
        <div class="form-group">
            <label>Priority</label>
            <input type="text" id="dec-priority" value="${escapeHtml(dec.priority || '')}" placeholder="숫자 또는 블록">
        </div>`;
    basicBody.appendChild(row1);

    // days 가로 배열
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    row2.innerHTML = `
        <div class="form-group">
            <label>days_remove</label>
            <input type="text" id="dec-days-remove" value="${escapeHtml(dec.days_remove || '')}" placeholder="30">
        </div>
        <div class="form-group">
            <label>days_re_enable</label>
            <input type="text" id="dec-days-reenable" value="${escapeHtml(dec.days_re_enable || '')}" placeholder="14">
        </div>`;
    basicBody.appendChild(row2);

    _decCheckRow(basicBody, 'dec-fire-only-once',   'fire_only_once',   dec.fire_only_once);
    _decCheckRow(basicBody, 'dec-fixed-random-seed', 'fixed_random_seed', dec.fixed_random_seed);
    _decCheckRow(basicBody, 'dec-cancel-if-not-visible', 'cancel_if_not_visible', dec.cancel_if_not_visible);

    // ══ 2. 미션 섹션 ══════════════════════════════════
    const { wrap: missWrap, body: missBody } = _decMakeSection(
        isMission ? '⚠ 미션 (days_mission_timeout 있음)' : '미션',
        isMission
    );
    form.appendChild(missWrap);

    const row3 = document.createElement('div');
    row3.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    row3.innerHTML = `
        <div class="form-group">
            <label>days_mission_timeout</label>
            <input type="text" id="dec-days-mission" value="${escapeHtml(dec.days_mission_timeout || '')}" placeholder="(비우면 일반 디시전)">
            <small class="form-hint">값이 있으면 미션으로 동작합니다</small>
        </div>
        <div class="form-group">
            <label>war_with_on_timeout</label>
            <input type="text" id="dec-war-timeout" value="${escapeHtml(dec.war_with_on_timeout || '')}" placeholder="TAG">
        </div>`;
    missBody.appendChild(row3);

    _decCheckRow(missBody, 'dec-selectable-mission', 'selectable_mission', dec.selectable_mission);
    _decCheckRow(missBody, 'dec-is-good',            'is_good',            dec.is_good);

    _decAddScriptBlock(missBody, 'dec-activation',    'activation',    dec.activation,    'trigger', '미션 시작 조건 (fire_only_once와 함께 사용)');
    _decAddScriptBlock(missBody, 'dec-timeout-effect','timeout_effect', dec.timeout_effect,'effect',  '타임아웃 시 실행되는 효과');

    // ══ 3. 조건 섹션 ══════════════════════════════════
    const { wrap: condWrap, body: condBody } = _decMakeSection('조건');
    form.appendChild(condWrap);

    _decAddScriptBlock(condBody, 'dec-allowed',       'allowed',       dec.allowed,       'trigger', '항상 체크 — 국가/DLC 제한');
    _decAddScriptBlock(condBody, 'dec-visible',       'visible',       dec.visible,       'trigger', '표시 조건 (지속 체크)');
    _decAddScriptBlock(condBody, 'dec-available',     'available',     dec.available,     'trigger', '선택 가능 조건');
    _decAddScriptBlock(condBody, 'dec-cancel-trigger','cancel_trigger', dec.cancel_trigger,'trigger', '자동 취소 조건');
    _decAddScriptBlock(condBody, 'dec-remove-trigger','remove_trigger', dec.remove_trigger,'trigger', '자동 제거 조건');
    _decAddScriptBlock(condBody, 'dec-target-root',  'target_root_trigger', dec.target_root_trigger, 'trigger', 'ROOT 기준 타게팅 필터');
    _decAddScriptBlock(condBody, 'dec-target-trigger','target_trigger', dec.target_trigger,'trigger', 'FROM 기준 타게팅 필터');

    // ══ 4. 타게팅 섹션 ════════════════════════════════
    const { wrap: tgtWrap, body: tgtBody } = _decMakeSection('타게팅', isTargeted);
    form.appendChild(tgtWrap);

    _decFormGroup(tgtBody, 'targets (TAG TAG ...)', `
        <input type="text" id="dec-targets" value="${escapeHtml(dec.targets || '')}" placeholder="GER SOV USA">`);
    _decFormGroup(tgtBody, 'target_array', `
        <input type="text" id="dec-target-array" value="${escapeHtml(dec.target_array || '')}" placeholder="global_major_countries">`);
    _decCheckRow(tgtBody, 'dec-targets-dynamic',     'targets_dynamic',     dec.targets_dynamic);
    _decCheckRow(tgtBody, 'dec-target-non-existing', 'target_non_existing', dec.target_non_existing);

    // ══ 5. 효과 섹션 ══════════════════════════════════
    const { wrap: fxWrap, body: fxBody } = _decMakeSection('효과');
    form.appendChild(fxWrap);

    const row4 = document.createElement('div');
    row4.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;';
    row4.innerHTML = `
        <div class="form-group" style="margin:0;">
            <label>war_with_on_complete</label>
            <input type="text" id="dec-war-complete" value="${escapeHtml(dec.war_with_on_complete || '')}" placeholder="TAG">
        </div>
        <div class="form-group" style="margin:0;">
            <label>war_with_on_remove</label>
            <input type="text" id="dec-war-remove" value="${escapeHtml(dec.war_with_on_remove || '')}" placeholder="TAG">
        </div>`;
    fxBody.appendChild(row4);

    _decAddScriptBlock(fxBody, 'dec-complete-effect',  'complete_effect',  dec.complete_effect,  'effect',   '결정 완료 시 효과');
    _decAddScriptBlock(fxBody, 'dec-remove-effect',    'remove_effect',    dec.remove_effect,    'effect',   '제거 시 효과');
    _decAddScriptBlock(fxBody, 'dec-cancel-effect',    'cancel_effect',    dec.cancel_effect,    'effect',   '취소 시 효과');
    _decAddScriptBlock(fxBody, 'dec-modifier',         'modifier',         dec.modifier,         'modifier', '지속 모디파이어');
    _decAddScriptBlock(fxBody, 'dec-targeted-modifier','targeted_modifier', dec.targeted_modifier,'modifier', '대상 국가 모디파이어');
    _decAddRawTextarea(fxBody, 'dec-highlight-states', 'highlight_states', dec.highlight_states,
        'highlight_states = {\n\tstate = 42\n}', '지도에 강조 표시할 스테이트');

    // ══ 6. AI / 커스텀 비용 섹션 ══════════════════════
    const { wrap: aiWrap, body: aiBody } = _decMakeSection('AI / 커스텀 비용');
    form.appendChild(aiWrap);

    _decAddScriptBlock(aiBody, 'dec-ai-will-do', 'ai_will_do', dec.ai_will_do, 'effect', 'AI 가중치');

    _decFormGroup(aiBody, 'ai_hint_pp_cost', `
        <input type="text" id="dec-ai-hint-pp" value="${escapeHtml(dec.ai_hint_pp_cost || '')}" placeholder="0">`);

    _decAddScriptBlock(aiBody, 'dec-custom-cost-trigger', 'custom_cost_trigger', dec.custom_cost_trigger, 'trigger', '커스텀 비용 조건');
    _decFormGroup(aiBody, 'custom_cost_text (로컬라이징 키)', `
        <input type="text" id="dec-custom-cost-text" value="${escapeHtml(dec.custom_cost_text || '')}" placeholder="MY_CUSTOM_COST">`);

    // ── 버튼 이벤트 바인딩 ──────────────────────────────
    panel.querySelector('#btn-dec-save')?.addEventListener('click',   () => _saveCurrentDecision(false));
    panel.querySelector('#btn-dec-delete')?.addEventListener('click', () => _deleteDecision(decId));
}

// ════════════════════════════════════════════════════════
//  디시전 폼 데이터 추출
// ════════════════════════════════════════════════════════
function extractDecisionFormData() {
    const gv  = id => document.getElementById(id)?.value?.trim() ?? '';
    const gch = id => document.getElementById(id)?.checked ?? false;

    return {
        _id:                  gv('dec-id'),
        icon:                 gv('dec-icon'),
        cost:                 gv('dec-cost'),
        priority:             gv('dec-priority'),
        days_remove:          gv('dec-days-remove'),
        days_re_enable:       gv('dec-days-reenable'),
        fire_only_once:       gch('dec-fire-only-once'),
        fixed_random_seed:    gch('dec-fixed-random-seed'),
        cancel_if_not_visible:gch('dec-cancel-if-not-visible'),
        // 미션
        days_mission_timeout: gv('dec-days-mission'),
        war_with_on_timeout:  gv('dec-war-timeout'),
        selectable_mission:   gch('dec-selectable-mission'),
        is_good:              gch('dec-is-good'),
        activation:           gv('dec-activation'),
        timeout_effect:       gv('dec-timeout-effect'),
        // 조건
        allowed:              gv('dec-allowed'),
        visible:              gv('dec-visible'),
        available:            gv('dec-available'),
        cancel_trigger:       gv('dec-cancel-trigger'),
        remove_trigger:       gv('dec-remove-trigger'),
        target_root_trigger:  gv('dec-target-root'),
        target_trigger:       gv('dec-target-trigger'),
        // 타게팅
        targets:              gv('dec-targets'),
        target_array:         gv('dec-target-array'),
        targets_dynamic:      gch('dec-targets-dynamic'),
        target_non_existing:  gch('dec-target-non-existing'),
        // 효과
        war_with_on_complete: gv('dec-war-complete'),
        war_with_on_remove:   gv('dec-war-remove'),
        complete_effect:      gv('dec-complete-effect'),
        remove_effect:        gv('dec-remove-effect'),
        cancel_effect:        gv('dec-cancel-effect'),
        modifier:             gv('dec-modifier'),
        targeted_modifier:    gv('dec-targeted-modifier'),
        highlight_states:     gv('dec-highlight-states'),
        // AI / 커스텀 비용
        ai_will_do:           gv('dec-ai-will-do'),
        ai_hint_pp_cost:      gv('dec-ai-hint-pp'),
        custom_cost_trigger:  gv('dec-custom-cost-trigger'),
        custom_cost_text:     gv('dec-custom-cost-text'),
    };
}

// ════════════════════════════════════════════════════════
//  카테고리 정의 폼 렌더 (decisions_category 파일용)
// ════════════════════════════════════════════════════════
function renderDecisionCategoryForm(panel, catId, cat) {
    panel.innerHTML = '';
    panel.style.cssText = 'overflow-y:auto;height:100%;';

    const form = document.createElement('div');
    form.className = 'decisions-form-inner';
    panel.appendChild(form);

    // ── 헤더 ──────────────────────────────────────────
    const headerDiv = document.createElement('div');
    headerDiv.className = 'decisions-form-header';
    headerDiv.innerHTML = `
        <h3 style="margin:0;font-size:15px;">📂 ${escapeHtml(catId)}</h3>
        <div style="display:flex;gap:6px;">
            <button id="btn-dec-cat-save" class="primary">💾 저장</button>
            <button id="btn-dec-cat-delete" class="danger">🗑 삭제</button>
        </div>`;
    form.appendChild(headerDiv);

    // ══ 기본 섹션 ══════════════════════════════════════
    const { wrap: basicWrap, body: basicBody } = _decMakeSection('기본', true);
    form.appendChild(basicWrap);

    _decFormGroup(basicBody, 'ID (카테고리 키)', `
        <input type="text" id="dec-cat-id" value="${escapeHtml(catId)}" placeholder="my_category">
        <small class="form-hint">⚠ ID 변경 시 저장 버튼을 눌러야 반영됩니다</small>`);

    const row1 = document.createElement('div');
    row1.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    row1.innerHTML = `
        <div class="form-group">
            <label>icon</label>
            <input type="text" id="dec-cat-icon" value="${escapeHtml(cat.icon || '')}" placeholder="GFX_...">
        </div>
        <div class="form-group">
            <label>picture</label>
            <input type="text" id="dec-cat-picture" value="${escapeHtml(cat.picture || '')}" placeholder="GFX_...">
        </div>`;
    basicBody.appendChild(row1);

    _decFormGroup(basicBody, 'scripted_gui', `
        <input type="text" id="dec-cat-scripted-gui" value="${escapeHtml(cat.scripted_gui || '')}" placeholder="my_scripted_gui">`);

    _decFormGroup(basicBody, 'priority', `
        <input type="text" id="dec-cat-priority" value="${escapeHtml(cat.priority || '')}" placeholder="숫자 또는 블록">`);

    _decCheckRow(basicBody, 'dec-cat-visible-when-empty', 'visible_when_empty', cat.visible_when_empty);

    // ══ 트리거 섹션 ════════════════════════════════════
    const { wrap: trigWrap, body: trigBody } = _decMakeSection('조건 / 트리거');
    form.appendChild(trigWrap);

    _decAddScriptBlock(trigBody, 'dec-cat-allowed',    'allowed',    cat.allowed,    'trigger', '항상 체크 — 카테고리 표시 허용 조건');
    _decAddScriptBlock(trigBody, 'dec-cat-visible',    'visible',    cat.visible,    'trigger', '카테고리 탭 표시 조건 (지속 체크)');
    _decAddScriptBlock(trigBody, 'dec-cat-available',  'available',  cat.available,  'trigger', '카테고리 선택 가능 조건');

    // ══ 고급 섹션 ══════════════════════════════════════
    const { wrap: advWrap, body: advBody } = _decMakeSection('고급');
    form.appendChild(advWrap);

    _decAddRawTextarea(advBody, 'dec-cat-highlight-states', 'highlight_states', cat.highlight_states,
        'highlight_states = {\n\tstate = 42\n}', '지도에 강조 표시할 스테이트');
    _decAddRawTextarea(advBody, 'dec-cat-on-map-area', 'on_map_area', cat.on_map_area,
        'on_map_area = {\n\tstate = 42\n}', '지도 영역 표시');

    // ── 버튼 이벤트 바인딩 ──────────────────────────────
    panel.querySelector('#btn-dec-cat-save')?.addEventListener('click',   () => _saveCurrentCategory(false));
    panel.querySelector('#btn-dec-cat-delete')?.addEventListener('click', () => _deleteDecCategory(catId));
}

// ════════════════════════════════════════════════════════
//  카테고리 정의 폼 데이터 추출
// ════════════════════════════════════════════════════════
function extractDecisionCategoryFormData() {
    const gv  = id => document.getElementById(id)?.value?.trim() ?? '';
    const gch = id => document.getElementById(id)?.checked ?? false;

    return {
        _id:               gv('dec-cat-id'),
        icon:              gv('dec-cat-icon'),
        picture:           gv('dec-cat-picture'),
        scripted_gui:      gv('dec-cat-scripted-gui'),
        priority:          gv('dec-cat-priority'),
        visible_when_empty:gch('dec-cat-visible-when-empty'),
        allowed:           gv('dec-cat-allowed'),
        visible:           gv('dec-cat-visible'),
        available:         gv('dec-cat-available'),
        highlight_states:  gv('dec-cat-highlight-states'),
        on_map_area:       gv('dec-cat-on-map-area'),
    };
}