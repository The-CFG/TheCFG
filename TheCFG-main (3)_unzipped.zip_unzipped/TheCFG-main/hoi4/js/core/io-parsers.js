// ════════════════════════════════════════════════════════
//  io-parsers.js — 텍스트 파서 / 빌더 / 공용 유틸
//  의존: 없음 (순수 함수)
// ════════════════════════════════════════════════════════

// ── 공용 유틸 ───────────────────────────────────────────
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function downloadBlob(content, filename, type = 'text/plain;charset=utf-8') {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── 파일 유형 감지 ──────────────────────────────────────
function detectFileType(filename, content = '', path = '') {
    const name  = filename.toLowerCase();
    const lpath = path.toLowerCase();
    if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'localisation';
    if (name.endsWith('.gfx')) return 'gfx_define';
    if (name.endsWith('.gui')) return 'gui';
    if (name.endsWith('.txt')) {
        if (content.includes('focus_tree'))       return 'national_focus';
        if (lpath.includes('common/ideas'))       return 'ideas';
        if (lpath.includes('common/decisions/categories')) return 'decisions_category';
        if (lpath.includes('common/decisions'))   return 'decisions';
        if (lpath.includes('common/characters'))  return 'characters';
        if (lpath.includes('common/'))            return 'common_raw';
    }
    return null;
}

// ── 경로 헬퍼 ───────────────────────────────────────────
function suggestPath(type, filename) {
    if (type === 'national_focus') return `common/national_focus/${filename}`;
    if (type === 'ideas')          return `common/ideas/${filename}`;
    if (type === 'decisions_category') return `common/decisions/categories/${filename}`;
    if (type === 'decisions')      return `common/decisions/${filename}`;
    if (type === 'characters')     return `common/characters/${filename}`;
    if (type === 'common_raw')     return `common/${filename}`;
    if (type === 'localisation') {
        const m = filename.match(/l_(\w+)/i);
        const lang = m ? m[1].toLowerCase() : 'english';
        return `localisation/${lang}/${filename}`;
    }
    return filename;
}

// ════════════════════════════════════════════════════════
//  공용 HOI4 텍스트 파서 헬퍼 (모듈 레벨)
// ════════════════════════════════════════════════════════
function _extractBlock(text, startIdx) {
    let depth = 0, i = startIdx;
    while (i < text.length) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { if (--depth === 0) return text.slice(startIdx + 1, i); }
        i++;
    }
    return '';
}
function _getVal(key, text) {
    return (text.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(\\S+)`)) || [])[1];
}
function _getBool(key, text) { return /yes/i.test(_getVal(key, text)); }
function _getBlock(key, text) {
    const rx = new RegExp(`(?:^|\\s)${key}\\s*=\\s*\\{`);
    const m  = rx.exec(text);
    if (!m) return null;
    return _extractBlock(text, m.index + m[0].length - 1);
}

// ════════════════════════════════════════════════════════
//  국가중점 파서 / 빌더
// ════════════════════════════════════════════════════════
function parseFocusFile(fileContent) {
    const focuses  = {};
    const settings = {
        treeId: 'my_focus_tree', countryTag: 'GEN', defaultTree: false,
        sharedFocuses: [], continuousFocusPosition: false,
        continuousX: 50, continuousY: 2740, resetOnCivilwar: true,
        initialShowX: 0, initialShowY: 0
    };
    const getVal      = _getVal;
    const getBool     = _getBool;
    const extractBlock = _extractBlock;
    const getBlock    = _getBlock;

    const treeStart = fileContent.search(/focus_tree\s*=\s*\{/);
    if (treeStart < 0) return null;
    const treeContent = extractBlock(fileContent, fileContent.indexOf('{', treeStart));

    settings.treeId      = getVal('id',  treeContent) || settings.treeId;
    settings.countryTag  = getVal('tag', treeContent) || settings.countryTag;
    settings.defaultTree = getBool('default', treeContent);
    settings.resetOnCivilwar = !(/reset_on_civilwar\s*=\s*no/i.test(treeContent));

    const cfPos = getBlock('continuous_focus_position', treeContent);
    if (cfPos) {
        settings.continuousFocusPosition = true;
        settings.continuousX = parseInt(getVal('x', cfPos)) || 50;
        settings.continuousY = parseInt(getVal('y', cfPos)) || 2740;
    }
    const initPos = getBlock('initial_show_position', treeContent);
    if (initPos) {
        settings.initialShowX = parseInt(getVal('x', initPos)) || 0;
        settings.initialShowY = parseInt(getVal('y', initPos)) || 0;
    }
    settings.sharedFocuses =
        [...treeContent.matchAll(/shared_focus\s*=\s*(\S+)/g)].map(m => m[1]);

    const focusRx = /\bfocus\s*=\s*\{/g;
    let fm;
    while ((fm = focusRx.exec(treeContent)) !== null) {
        const block = extractBlock(treeContent, treeContent.indexOf('{', fm.index));
        const f = {};
        // focus = { 바로 다음 줄의 # 주석만 파싱 (다른 위치 주석은 무시)
        const firstLineMatch = block.match(/^[ \t]*\r?\n([ \t]*#[ \t]?(.*?))\r?\n/);
        f._comment = firstLineMatch ? firstLineMatch[2].trim() : '';
        f.id      = getVal('id',   block);
        f.icon    = getVal('icon', block) || 'GFX_goal_unknown';
        f.dynamic = getBool('dynamic', block);
        f.cost    = parseFloat(getVal('cost', block)) || 10;
        f.x       = parseInt(getVal('x', block))  || 0;
        f.y       = parseInt(getVal('y', block))  || 0;
        f.relative_position_id = getVal('relative_position_id', block) || null;

        const ob = getBlock('offset', block);
        f.offset = ob
            ? {
                x: parseInt(getVal('x', ob)) || 0,
                y: parseInt(getVal('y', ob)) || 0,
                trigger: getBlock('trigger', ob) || ''
              }
            : { x: 0, y: 0, trigger: '' };

        f.prerequisite = [];
        const preRx = /prerequisite\s*=\s*\{/g;
        let pm;
        while ((pm = preRx.exec(block)) !== null) {
            const pb  = extractBlock(block, block.indexOf('{', pm.index));
            const ids = [...pb.matchAll(/focus\s*=\s*(\S+)/g)].map(m => m[1]);
            if (ids.length === 1) f.prerequisite.push(ids[0]);
            else if (ids.length > 1) f.prerequisite.push(ids);
        }
        const mb = getBlock('mutually_exclusive', block);
        f.mutually_exclusive = mb
            ? [...mb.matchAll(/focus\s*=\s*(\S+)/g)].map(m => m[1]) : [];

        f.available                = getBlock('available',           block) || '';
        f.bypass                   = getBlock('bypass',              block) || '';
        f.bypass_if_unavailable    = getBool('bypass_if_unavailable', block);
        f.cancel                   = getBlock('cancel',              block) || '';
        f.allow_branch             = getBlock('allow_branch',        block) || '';
        f.cancelable               = getBool('cancelable',           block);
        f.continue_if_invalid      = getBool('continue_if_invalid',  block);
        f.cancel_if_invalid        = getBool('cancel_if_invalid',    block);
        f.available_if_capitulated = getBool('available_if_capitulated', block);
        f.complete_effect          = getBlock('completion_reward',   block) || '';
        f.select_effect            = getBlock('select_effect',       block) || '';
        f.ai_will_do               = getBlock('ai_will_do',          block) || '';
        f.historical_ai            = getBlock('historical_ai',       block) || '';
        f.text_icon                = getVal('text_icon', block) || '';

        const sfb = getBlock('search_filters',        block);
        const wwb = getBlock('will_lead_to_war_with', block);
        f.search_filters        = sfb ? sfb.match(/\S+/g) || [] : [];
        f.will_lead_to_war_with = wwb ? wwb.match(/\S+/g) || [] : [];

        f.name = f.id;
        if (f.id) focuses[f.id] = f;
    }
    return { focuses, settings };
}

function buildFocusTxt(fileData) {
    const { settings: s, focuses } = fileData;
    const fb = (key, content, indent = 2) => {
        if (!content?.trim()) return '';
        const t = '\t'.repeat(indent), ti = '\t'.repeat(indent + 1);
        // 최소 들여쓰기를 기준으로 상대적 dedent (계층 구조 보존)
        const lines = content.split('\n').filter(l => l.trim());
        const minIndent = Math.min(...lines.map(l => (l.match(/^[\t]*/)?.[0]?.length ?? 0)));
        const dedented = content.split('\n')
            .map(l => l.slice(minIndent))
            .join('\n')
            .trim();
        return `${t}${key} = {\n${ti}${dedented.replace(/\n/g, '\n' + ti)}\n${t}}\n`;
    };
    const fBool = (key, val, indent = 2) => val ? '\t'.repeat(indent) + `${key} = yes\n` : '';

    let out = `focus_tree = {\n\tid = ${s.treeId}\n`;
    if (s.defaultTree) out += `\tdefault = yes\n`;
    out += `\tcountry = {\n\t\tfactor = 0\n\t\tmodifier = {\n\t\t\tadd = 10\n\t\t\ttag = ${s.countryTag}\n\t\t}\n\t}\n`;
    if (s.continuousFocusPosition)
        out += `\tcontinuous_focus_position = { x = ${s.continuousX} y = ${s.continuousY} }\n`;
    if (!s.resetOnCivilwar) out += `\treset_on_civilwar = no\n`;
    if (s.initialShowX || s.initialShowY)
        out += `\tinitial_show_position = {\n\t\tx = ${s.initialShowX}\n\t\ty = ${s.initialShowY}\n\t}\n`;
    s.sharedFocuses.forEach(sf => { out += `\tshared_focus = ${sf}\n`; });
    out += '\n';

    Object.values(focuses).forEach(f => {
        out += `\tfocus = {\n`;
        if (f._comment?.trim()) out += `\t\t# ${f._comment.trim()}\n`;
        out += `\t\tid = ${f.id}\n\t\ticon = ${f.icon}\n`;
        if (f.dynamic) out += `\t\tdynamic = yes\n`;
        out += `\t\tcost = ${f.cost}\n`;
        (f.prerequisite || []).forEach(item => {
            out += Array.isArray(item)
                ? `\t\tprerequisite = { ${item.map(p => `focus = ${p}`).join(' ')} }\n`
                : `\t\tprerequisite = { focus = ${item} }\n`;
        });
        if (f.mutually_exclusive?.length)
            out += `\t\tmutually_exclusive = { ${f.mutually_exclusive.map(p => `focus = ${p}`).join(' ')} }\n`;
        if (f.relative_position_id) out += `\t\trelative_position_id = ${f.relative_position_id}\n`;
        out += `\t\tx = ${f.x}\n\t\ty = ${f.y}\n`;
        if (f.offset?.x || f.offset?.y || f.offset?.trigger?.trim()) {
            out += `\t\toffset = {\n`;
            out += `\t\t\tx = ${f.offset?.x || 0}\n`;
            out += `\t\t\ty = ${f.offset?.y || 0}\n`;
            if (f.offset?.trigger?.trim()) {
                const trigLines = f.offset.trigger.split('\n').filter(l => l.trim());
                const trigMin = Math.min(...trigLines.map(l => l.match(/^\t*/)?.[0]?.length ?? 0));
                const trigDedented = f.offset.trigger.split('\n').map(l => l.slice(trigMin)).join('\n').trim();
                out += `\t\t\ttrigger = {\n\t\t\t\t${trigDedented.replace(/\n/g, '\n\t\t\t\t')}\n\t\t\t}\n`;
            }
            out += `\t\t}\n`;
        }
        out += fb('available',         f.available);
        out += fb('bypass',            f.bypass);
        out += fBool('bypass_if_unavailable', f.bypass_if_unavailable);
        out += fb('cancel',            f.cancel);
        out += fb('allow_branch',      f.allow_branch);
        out += fBool('cancelable',           f.cancelable);
        out += fBool('continue_if_invalid',  f.continue_if_invalid);
        out += fBool('cancel_if_invalid',    f.cancel_if_invalid);
        out += fBool('available_if_capitulated', f.available_if_capitulated);
        if (f.search_filters?.length)
            out += `\t\tsearch_filters = { ${f.search_filters.join(' ')} }\n`;
        if (f.text_icon) out += `\t\ttext_icon = ${f.text_icon}\n`;
        out += fb('ai_will_do',        f.ai_will_do);
        out += fb('historical_ai',     f.historical_ai);
        if (f.will_lead_to_war_with?.length)
            out += `\t\twill_lead_to_war_with = { ${f.will_lead_to_war_with.join(' ')} }\n`;
        out += fb('select_effect',     f.select_effect);
        out += fb('completion_reward', f.complete_effect);
        out += `\t}\n\n`;
    });
    out += '}';
    return out;
}

// ════════════════════════════════════════════════════════
//  로컬라이제이션 파서 / 빌더
// ════════════════════════════════════════════════════════
function parseLocalisationFile(rawContent, filename = '') {
    const fc = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let lang = '';
    const nm = filename.match(/l_(\w+)/i);
    if (nm) lang = nm[1].toLowerCase();
    else {
        const hm = fc.match(/^l_(\w+)\s*:/m);
        if (hm) lang = hm[1].toLowerCase();
    }
    if (!lang) return null;
    const data = {};
    const rx = /^[ \t]+(\S+?):(\d+)[ \t]+"([^"]*)"/gm;
    let m;
    while ((m = rx.exec(fc)) !== null) {
        const key = m[1], val = m[3];
        if (key.endsWith('_desc')) {
            const base = key.slice(0, -5);
            if (!data[base]) data[base] = { name: '', desc: '' };
            data[base].desc = val;
        } else {
            if (!data[key]) data[key] = { name: '', desc: '' };
            data[key].name = val;
        }
    }
    return { lang, data };
}

function buildLocYml(fileData) {
    const { lang, data } = fileData;
    let out = `l_${lang}:\n`;
    Object.entries(data).forEach(([id, entry]) => {
        const name = typeof entry === 'object' ? entry.name || '' : entry || '';
        const desc = typeof entry === 'object' ? entry.desc || '' : '';
        out += ` ${id}:0 "${name}"\n`;
        out += ` ${id}_desc:0 "${desc}"\n`;
    });
    return out;
}

// ════════════════════════════════════════════════════════
//  아이디어 파서 / 빌더
// ════════════════════════════════════════════════════════

// 완전 파싱 대상 카테고리
const IDEAS_FULL_PARSE_CATS = new Set(['country', 'hidden_ideas']);

function _parseIdeaBlock(block) {
    // # _comment: 블록 첫 줄에서만 파싱
    const firstLineMatch = block.match(/^[ \t]*\r?\n([ \t]*#[ \t]?(.*?))\r?\n/);
    const idea = {
        _comment:          firstLineMatch ? firstLineMatch[2].trim() : '',
        picture:           _getVal('picture',      block) || '',
        name:              _getVal('name',         block) || '',
        cost:              _getVal('cost',         block) != null ? parseFloat(_getVal('cost', block)) : null,
        removal_cost:      _getVal('removal_cost', block) != null ? parseFloat(_getVal('removal_cost', block)) : null,
        level:             _getVal('level',        block) != null ? parseInt(_getVal('level',  block)) : null,
        ledger:            _getVal('ledger',       block) || '',
        traits:            (() => {
            const tb = _getBlock('traits', block);
            return tb ? tb.trim().split(/\s+/).filter(Boolean) : [];
        })(),
        // trigger blocks
        allowed:           _getBlock('allowed',            block) ?? '',
        allowed_civil_war: _getBlock('allowed_civil_war',  block) ?? '',
        allowed_to_remove: _getBlock('allowed_to_remove',  block) ?? '',
        visible:           _getBlock('visible',            block) ?? '',
        available:         _getBlock('available',          block) ?? '',
        cancel:            _getBlock('cancel',             block) ?? '',
        do_effect:         _getBlock('do_effect',          block) ?? '',
        // modifier blocks (raw textarea)
        modifier:          _getBlock('modifier',           block) ?? '',
        targeted_modifier: _getBlock('targeted_modifier',  block) ?? '',
        research_bonus:    _getBlock('research_bonus',     block) ?? '',
        equipment_bonus:   _getBlock('equipment_bonus',    block) ?? '',
        rule:              _getBlock('rule',               block) ?? '',
        // effect blocks
        on_add:            _getBlock('on_add',             block) ?? '',
        on_remove:         _getBlock('on_remove',          block) ?? '',
        ai_will_do:        _getBlock('ai_will_do',         block) ?? '',
    };
    // null 안전 처리: cost/removal_cost가 NaN이면 null로
    if (Number.isNaN(idea.cost))         idea.cost = null;
    if (Number.isNaN(idea.removal_cost)) idea.removal_cost = null;
    if (Number.isNaN(idea.level))        idea.level = null;
    return idea;
}

function parseIdeasFile(content) {
    // ideas = { ... } 최상위 블록 추출
    const ideasStart = content.search(/\bideas\s*=\s*\{/);
    if (ideasStart < 0) return { categories: {} };
    const ideasBlock = _extractBlock(content, content.indexOf('{', ideasStart));

    const categories = {};

    // 카테고리를 1depth로 파싱: key = { ... }
    // ideas 블록 안에서 { } depth 1짜리 블록들을 순서대로 추출
    let i = 0;
    while (i < ideasBlock.length) {
        // 공백/줄바꿈 스킵
        if (/\s/.test(ideasBlock[i])) { i++; continue; }
        // # 줄 주석 스킵
        if (ideasBlock[i] === '#') {
            while (i < ideasBlock.length && ideasBlock[i] !== '\n') i++;
            continue;
        }
        // 카테고리명 파싱
        const nameMatch = ideasBlock.slice(i).match(/^(\w+)\s*=\s*\{/);
        if (!nameMatch) { i++; continue; }
        const catName = nameMatch[1];
        const braceIdx = ideasBlock.indexOf('{', i);
        if (braceIdx < 0) break;
        const catBlock = _extractBlock(ideasBlock, braceIdx);

        if (IDEAS_FULL_PARSE_CATS.has(catName)) {
            // 완전 파싱 카테고리
            const _attrs = {
                law:           _getBool('law',           catBlock),
                designer:      _getBool('designer',      catBlock),
                use_list_view: _getBool('use_list_view', catBlock),
            };
            const ideas = {};

            // idea 블록들 파싱: catBlock 내 depth-1 블록
            let j = 0;
            while (j < catBlock.length) {
                if (/\s/.test(catBlock[j])) { j++; continue; }
                if (catBlock[j] === '#') {
                    while (j < catBlock.length && catBlock[j] !== '\n') j++;
                    continue;
                }
                // 속성 키워드(law/designer/use_list_view)는 idea가 아니므로 skip
                const ideaNameMatch = catBlock.slice(j).match(/^(\w+)\s*=\s*(?:\{|yes|no)/);
                if (!ideaNameMatch) { j++; continue; }
                const ideaName = ideaNameMatch[1];
                if (['law', 'designer', 'use_list_view'].includes(ideaName)) {
                    // 속성 줄 건너뜀
                    while (j < catBlock.length && catBlock[j] !== '\n') j++;
                    continue;
                }
                const ideaBrace = catBlock.indexOf('{', j);
                if (ideaBrace < 0) break;
                const ideaBlock = _extractBlock(catBlock, ideaBrace);
                ideas[ideaName] = _parseIdeaBlock(ideaBlock);
                j = ideaBrace + ideaBlock.length + 2; // { ... } 전체 건너뜀
            }

            categories[catName] = { _attrs, ideas };
        } else {
            // 나머지 카테고리: raw 보존
            categories[catName] = { _raw: catBlock };
        }

        i = braceIdx + catBlock.length + 2;
    }

    return { categories };
}

function buildIdeasTxt(fileData) {
    const { categories } = fileData;
    const fb = (key, raw, indent = 3) => {
        if (!raw?.trim()) return '';
        const t = '\t'.repeat(indent), ti = '\t'.repeat(indent + 1);
        const lines = raw.split('\n').filter(l => l.trim());
        const minInd = Math.min(...lines.map(l => (l.match(/^\t*/)?.[0]?.length ?? 0)));
        const dedented = raw.split('\n').map(l => l.slice(minInd)).join('\n').trim();
        return `${t}${key} = {\n${ti}${dedented.replace(/\n/g, '\n' + ti)}\n${t}}\n`;
    };

    let out = 'ideas = {\n';

    Object.entries(categories).forEach(([catName, cat]) => {
        if (cat._raw != null) {
            // raw 카테고리: 원본 그대로
            out += `\t${catName} = {\n`;
            out += cat._raw.split('\n').map(l => '\t\t' + l).join('\n') + '\n';
            out += `\t}\n\n`;
            return;
        }
        // 완전 파싱 카테고리
        out += `\t${catName} = {\n`;
        if (cat._attrs?.law)           out += `\t\tlaw = yes\n`;
        if (cat._attrs?.designer)      out += `\t\tdesigner = yes\n`;
        if (cat._attrs?.use_list_view) out += `\t\tuse_list_view = yes\n`;
        if (cat._attrs && (cat._attrs.law || cat._attrs.designer || cat._attrs.use_list_view))
            out += '\n';

        Object.entries(cat.ideas || {}).forEach(([ideaId, idea]) => {
            out += `\t\t${ideaId} = {\n`;
            if (idea._comment?.trim()) out += `\t\t\t# ${idea._comment.trim()}\n`;
            if (idea.picture)      out += `\t\t\tpicture = ${idea.picture}\n`;
            if (idea.name)         out += `\t\t\tname = ${idea.name}\n`;
            if (idea.cost != null)         out += `\t\t\tcost = ${idea.cost}\n`;
            if (idea.removal_cost != null) out += `\t\t\tremoval_cost = ${idea.removal_cost}\n`;
            if (idea.level != null)        out += `\t\t\tlevel = ${idea.level}\n`;
            if (idea.ledger)       out += `\t\t\tledger = ${idea.ledger}\n`;
            if (idea.traits?.length) out += `\t\t\ttraits = { ${idea.traits.join(' ')} }\n`;
            out += fb('allowed',            idea.allowed);
            out += fb('allowed_civil_war',  idea.allowed_civil_war);
            out += fb('allowed_to_remove',  idea.allowed_to_remove);
            out += fb('visible',            idea.visible);
            out += fb('available',          idea.available);
            out += fb('cancel',             idea.cancel);
            out += fb('do_effect',          idea.do_effect);
            out += fb('modifier',           idea.modifier);
            out += fb('targeted_modifier',  idea.targeted_modifier);
            out += fb('research_bonus',     idea.research_bonus);
            out += fb('equipment_bonus',    idea.equipment_bonus);
            out += fb('rule',               idea.rule);
            out += fb('on_add',             idea.on_add);
            out += fb('on_remove',          idea.on_remove);
            out += fb('ai_will_do',         idea.ai_will_do);
            out += `\t\t}\n\n`;
        });
        out += `\t}\n\n`;
    });

    out += '}';
    return out;
}

// ════════════════════════════════════════════════════════
//  GFX 파서 / 빌더
// ════════════════════════════════════════════════════════
function parseGfxFile(content) {
    const sprites = [];
    const blockRx = /\b(\w*[Ss]priteType)\s*=\s*\{/g;
    let m;
    while ((m = blockRx.exec(content)) !== null) {
        const block   = _extractBlock(content, content.indexOf('{', m.index));
        const nameM   = block.match(/\bname\s*=\s*"([^"]+)"/);
        const texM    = block.match(/\btexturefile\s*=\s*"([^"]+)"/);
        if (!nameM || !texM) continue;
        const framesM = block.match(/\bnoOfFrames\s*=\s*(\d+)/);
        sprites.push({
            name:        nameM[1],
            texturefile: texM[1],
            noOfFrames:  framesM ? parseInt(framesM[1]) : 1,
        });
    }
    return sprites;
}

function buildGfxFile(fileData) {
    const sprites = fileData.sprites || [];
    let out = 'spriteTypes = {\n';
    sprites.forEach(s => {
        out += `\tspriteType = {\n`;
        out += `\t\tname = "${s.name}"\n`;
        out += `\t\ttexturefile = "${s.texturefile}"\n`;
        if (s.noOfFrames && s.noOfFrames > 1)
            out += `\t\tnoOfFrames = ${s.noOfFrames}\n`;
        out += `\t}\n`;
    });
    out += '}\n';
    return out;
}

// ── 단일 파일 파싱 공용 함수 ─────────────────────────────

// ════════════════════════════════════════════════════════
//  디시전 카테고리 파서 / 빌더
//  파일: common/decisions/categories/*.txt
// ════════════════════════════════════════════════════════

function _getPriorityRaw(block) {
    const m = block.match(/(?:^|\s)priority\s*=\s*(\{[\s\S]*?\}|\S+)/);
    if (!m) return '';
    return m[1].startsWith('{') ? m[1] : m[1].trim();
}

function parseDecisionCategoriesFile(content) {
    const categories = {};
    let i = 0;
    while (i < content.length) {
        if (/\s/.test(content[i])) { i++; continue; }
        if (content[i] === '#') {
            while (i < content.length && content[i] !== '\n') i++;
            continue;
        }
        const nameMatch = content.slice(i).match(/^(\w+)\s*=\s*\{/);
        if (!nameMatch) { i++; continue; }
        const catName  = nameMatch[1];
        const braceIdx = content.indexOf('{', i);
        if (braceIdx < 0) break;
        const block = _extractBlock(content, braceIdx);

        const _raw = (key) => {
            const m2 = block.match(new RegExp('\\b' + key + '\\s*=\\s*\\{'));
            if (!m2) return '';
            const inner = _extractBlock(block, block.indexOf('{', m2.index));
            return key + ' = {\n' + inner + '\n}';
        };

        categories[catName] = {
            icon:               _getVal('icon', block)               || '',
            picture:            _getVal('picture', block)            || '',
            visible_when_empty: _getBool('visible_when_empty', block),
            scripted_gui:       _getVal('scripted_gui', block)       || '',
            priority:           _getPriorityRaw(block),
            allowed:            _getBlock('allowed',   block)        ?? '',
            visible:            _getBlock('visible',   block)        ?? '',
            available:          _getBlock('available', block)        ?? '',
            highlight_states:   _raw('highlight_states'),
            on_map_area:        _raw('on_map_area'),
        };
        i = braceIdx + block.length + 2;
    }
    return { categories };
}

function buildDecisionCategoriesTxt(fileData) {
    const { categories } = fileData;
    const lines = [];
    for (const [catName, cat] of Object.entries(categories)) {
        lines.push(`${catName} = {`);
        if (cat.icon)               lines.push(`\ticon = ${cat.icon}`);
        if (cat.picture)            lines.push(`\tpicture = ${cat.picture}`);
        if (cat.visible_when_empty) lines.push(`\tvisible_when_empty = yes`);
        if (cat.scripted_gui)       lines.push(`\tscripted_gui = ${cat.scripted_gui}`);
        if (cat.priority)           lines.push(`\tpriority = ${cat.priority}`);
        const _sb = (key) => {
            const raw = cat[key];
            if (!raw?.trim()) return;
            const indented = raw.split('\n').map(l => '\t\t' + l).join('\n');
            lines.push(`\t${key} = {\n${indented}\n\t}`);
        };
        _sb('allowed');
        _sb('visible');
        _sb('available');
        if (cat.highlight_states?.trim())
            lines.push(cat.highlight_states.split('\n').map(l => '\t' + l).join('\n'));
        if (cat.on_map_area?.trim())
            lines.push(cat.on_map_area.split('\n').map(l => '\t' + l).join('\n'));
        lines.push(`}\n`);
    }
    return lines.join('\n');
}

// ════════════════════════════════════════════════════════
//  디시전 파서 / 빌더
//  파일: common/decisions/*.txt
// ════════════════════════════════════════════════════════

const _DEC_BOOL = new Set([
    'fire_only_once','selectable_mission','fixed_random_seed',
    'cancel_if_not_visible','targets_dynamic','target_non_existing','is_good',
]);
const _DEC_STR = new Set([
    'icon','cost','days_remove','days_re_enable','days_mission_timeout',
    'war_with_on_complete','war_with_on_remove','war_with_on_timeout',
    'ai_hint_pp_cost','custom_cost_text','target_array','scripted_gui',
]);
const _DEC_SB = new Set([
    'allowed','visible','available','cancel_trigger','remove_trigger',
    'activation','target_trigger','target_root_trigger',
    'complete_effect','remove_effect','cancel_effect','timeout_effect',
    'modifier','targeted_modifier','ai_will_do','custom_cost_trigger',
]);

function _parseDecisionBlock(block) {
    const d = {};
    for (const key of _DEC_BOOL) {
        const v = _getVal(key, block);
        d[key] = v ? /yes/i.test(v) : false;
    }
    for (const key of _DEC_STR) {
        d[key] = _getVal(key, block) || '';
    }
    d.priority = _getPriorityRaw(block);
    // targets = { TAG TAG ... }
    const tgtsM = block.match(/\btargets\s*=\s*\{([^}]*)\}/);
    d.targets = tgtsM ? tgtsM[1].trim() : '';
    for (const key of _DEC_SB) {
        d[key] = _getBlock(key, block) ?? '';
    }
    const hsm = block.match(/\bhighlight_states\s*=\s*\{/);
    if (hsm) {
        const inner = _extractBlock(block, block.indexOf('{', hsm.index));
        d.highlight_states = 'highlight_states = {\n' + inner + '\n}';
    } else {
        d.highlight_states = '';
    }
    return d;
}

function parseDecisionsFile(content) {
    const categories = {};
    let i = 0;
    while (i < content.length) {
        if (/\s/.test(content[i])) { i++; continue; }
        if (content[i] === '#') {
            while (i < content.length && content[i] !== '\n') i++;
            continue;
        }
        const nameMatch = content.slice(i).match(/^(\w+)\s*=\s*\{/);
        if (!nameMatch) { i++; continue; }
        const catKey   = nameMatch[1];
        const braceIdx = content.indexOf('{', i);
        if (braceIdx < 0) break;
        const catBlock = _extractBlock(content, braceIdx);

        const decisions = {};
        let j = 0;
        while (j < catBlock.length) {
            if (/\s/.test(catBlock[j])) { j++; continue; }
            if (catBlock[j] === '#') {
                while (j < catBlock.length && catBlock[j] !== '\n') j++;
                continue;
            }
            const dMatch = catBlock.slice(j).match(/^(\w+)\s*=\s*\{/);
            if (!dMatch) { j++; continue; }
            const dName  = dMatch[1];
            const dBrace = catBlock.indexOf('{', j);
            if (dBrace < 0) break;
            const dBlock = _extractBlock(catBlock, dBrace);
            decisions[dName] = _parseDecisionBlock(dBlock);
            j = dBrace + dBlock.length + 2;
        }

        if (!categories[catKey]) categories[catKey] = { decisions: {} };
        Object.assign(categories[catKey].decisions, decisions);
        i = braceIdx + catBlock.length + 2;
    }
    return { categories };
}

function buildDecisionsTxt(fileData) {
    const { categories } = fileData;
    const lines = [];
    for (const [catKey, catData] of Object.entries(categories)) {
        lines.push(`${catKey} = {`);
        for (const [dName, d] of Object.entries(catData.decisions)) {
            lines.push(`\t${dName} = {`);
            const _s  = (key) => { if (d[key] !== '' && d[key] != null) lines.push(`\t\t${key} = ${d[key]}`); };
            const _b  = (key) => { if (d[key]) lines.push(`\t\t${key} = yes`); };
            const _sb = (key) => {
                const raw = d[key];
                if (!raw?.trim()) return;
                const ind = raw.split('\n').map(l => '\t\t\t' + l).join('\n');
                lines.push(`\t\t${key} = {\n${ind}\n\t\t}`);
            };
            if (d.icon)      lines.push(`\t\ticon = ${d.icon}`);
            _s('cost');
            _s('priority');
            _b('fire_only_once');
            _b('fixed_random_seed');
            _s('days_remove');
            _s('days_re_enable');
            _s('days_mission_timeout');
            _b('selectable_mission');
            _b('is_good');
            _s('war_with_on_complete');
            _s('war_with_on_remove');
            _s('war_with_on_timeout');
            _s('ai_hint_pp_cost');
            _s('custom_cost_text');
            _b('cancel_if_not_visible');
            if (d.targets) lines.push(`\t\ttargets = { ${d.targets} }`);
            _b('targets_dynamic');
            _b('target_non_existing');
            _s('target_array');
            _sb('allowed');
            _sb('activation');
            _sb('target_root_trigger');
            _sb('target_trigger');
            _sb('visible');
            _sb('available');
            _sb('cancel_trigger');
            _sb('remove_trigger');
            _sb('custom_cost_trigger');
            _sb('complete_effect');
            _sb('remove_effect');
            _sb('cancel_effect');
            _sb('timeout_effect');
            _sb('modifier');
            _sb('targeted_modifier');
            _sb('ai_will_do');
            if (d.highlight_states?.trim()) {
                lines.push(d.highlight_states.split('\n').map(l => '\t\t' + l).join('\n'));
            }
            lines.push(`\t}`);
        }
        lines.push(`}\n`);
    }
    return lines.join('\n');
}

function parseSingleFile(content, filename, path = '') {
    const type = detectFileType(filename, content, path || filename);
    if (!type) return null;
    if (type === 'national_focus') {
        const parsed = parseFocusFile(content);
        if (!parsed) return null;
        return { type, ...parsed };
    }
    if (type === 'localisation') {
        const parsed = parseLocalisationFile(content, filename);
        if (!parsed) return null;
        return { type, lang: parsed.lang, data: parsed.data };
    }
    if (type === 'gfx_define') {
        return { type, sprites: parseGfxFile(content) };
    }
    if (type === 'gui') {
        return { type, raw: content };
    }
    if (type === 'ideas') {
        const parsed = parseIdeasFile(content);
        if (!parsed) return null;
        return { type, ...parsed };
    }
    if (type === 'decisions_category') {
        const parsed = parseDecisionCategoriesFile(content);
        return { type, ...parsed };
    }
    if (type === 'decisions') {
        const parsed = parseDecisionsFile(content);
        return { type, ...parsed };
    }
    if (type === 'characters' || type === 'common_raw') {
        return { type, raw: content };
    }
    return null;
}

// ── v1 → v2 마이그레이션 ────────────────────────────────
function migrateV1Project(v1) {
    const tag  = v1.settings?.countryTag || 'GEN';
    const name = v1.settings?.countryTag || 'MyMod';
    const files = {};
    if (v1.focuses && Object.keys(v1.focuses).length) {
        files[`common/national_focus/${tag}_focus.txt`] = {
            type: 'national_focus', settings: v1.settings || {}, focuses: v1.focuses
        };
    }
    if (v1.localisation) {
        Object.entries(v1.localisation).forEach(([lang, data]) => {
            if (!Object.keys(data).length) return;
            files[`localisation/${lang}/${tag}_l_${lang}.yml`] = { type: 'localisation', lang, data };
        });
    }
    return { name, files };
}
