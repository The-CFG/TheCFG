// ════════════════════════════════════════════════════════
//  limbus-converter-core.js
//  identities.json(자유 텍스트) → Block 스키마 변환 "순수 로직"만 모은 파일.
//  파일 입출력(fs)은 전혀 하지 않는다 — 그래서 Node.js 컨버터 스크립트
//  (convert-to-structured.js)와 브라우저 페이지(limbus/convert.html) 양쪽에서
//  같은 코드를 그대로 재사용할 수 있다. (로직 두 벌 유지하다 어긋나는 것을 방지)
//
//  md 20.2절 5단계 파이프라인 중 Stage 0~4 구현.
//  UMD 패턴: Node(require/module.exports)와 브라우저(<script> 전역) 둘 다 지원.
//  브라우저에서는 반드시 이 스크립트보다 먼저 limbus-defs.js를 로드해
//  전역 LIMBUS_TRIGGERS가 존재해야 한다.
// ════════════════════════════════════════════════════════

(function (root, factory) {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory(require("../data/limbus-defs.js").LIMBUS_TRIGGERS);
    } else {
        // 주의: limbus-defs.js는 top-level `const LIMBUS_TRIGGERS`로 선언되어 있어
        // (classic <script>) window.LIMBUS_TRIGGERS로는 접근 안 됨 — 같은 전역
        // 렉시컬 스코프를 공유하는 bare identifier로 참조해야 함.
        root.LimbusConverterCore = factory(typeof LIMBUS_TRIGGERS !== "undefined" ? LIMBUS_TRIGGERS : []);
    }
})(typeof self !== "undefined" ? self : this, function (LIMBUS_TRIGGERS) {

    const TRIGGER_KEYS = new Set(LIMBUS_TRIGGERS.map((t) => t.key));

    // ── Stage 1 — [트리거] 대괄호 기준 Head 분리 ──

    function normalizeTrigger(raw) {
        const trimmed = raw.trim();
        if (TRIGGER_KEYS.has(trimmed)) return { trigger: trimmed, confidence: "high" };
        const collapsed = trimmed.replace(/\s+/g, "");
        for (const key of TRIGGER_KEYS) {
            if (key.replace(/\s+/g, "") === collapsed) return { trigger: key, confidence: "high" };
        }
        return { trigger: trimmed, confidence: "low", note: "LIMBUS_TRIGGERS 목록 밖 — 신규 트리거 후보 (또는 인라인 스킬명 참조 오분류 가능성)" };
    }

    function splitByHead(text) {
        if (!text) return [];
        const heads = [];
        const firstBracket = text.search(/\[/);
        if (firstBracket === -1) {
            const t = text.trim();
            if (t) heads.push({ head: null, body: t });
            return heads;
        }
        if (firstBracket > 0) {
            const lead = text.slice(0, firstBracket).trim();
            if (lead) heads.push({ head: null, body: lead });
        }
        const matches = [...text.matchAll(/\[([^\]]+)\]/g)];
        for (let i = 0; i < matches.length; i++) {
            const norm = normalizeTrigger(matches[i][1]);
            const start = matches[i].index + matches[i][0].length;
            const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
            const body = text.slice(start, end).trim();
            heads.push({
                head: { trigger: norm.trigger, _confidence: norm.confidence, ...(norm.note ? { _note: norm.note } : {}) },
                body,
            });
        }
        return heads;
    }

    // ── Stage 2 — 절 경계 복원 (구두점 없이 붙은 문장 분리) ──

    const CLAUSE_END = "(증가|감소|부여|소모|획득|회복|해제)";
    const NEW_SUBJECT = "(자신의|자신이|대상의|대상이|이 코인의|이 코인이|보유한|해당|만약)";
    const BOUNDARY_RE = new RegExp(CLAUSE_END + "(?=" + NEW_SUBJECT + ")", "g");
    const MARK = "\u0001";

    function splitClauses(bodyText) {
        if (!bodyText) return [];
        const roughLines = bodyText
            .split(/\r?\n/)
            .flatMap((l) => l.split(/(?<=[.。])\s*/))
            .flatMap((l) => l.split(/(?:^|\s)-\s+/))
            .map((s) => s.trim())
            .filter(Boolean);

        const clauses = [];
        for (const line of roughLines) {
            const marked = line.replace(BOUNDARY_RE, (verb) => verb + MARK);
            const pieces = marked.split(MARK).map((s) => s.trim()).filter(Boolean);
            for (const p of pieces) {
                clauses.push({ text: p, confidence: pieces.length > 1 ? "low" : "high" });
            }
        }
        return clauses;
    }

    // ── Stage 3 — cost / body 분리 ──

    const COST_ONLY_RE = /^(.+?)\s*(\d+)?\s*소모(함)?$/;

    function extractCost(clauses) {
        const cost = [];
        const remaining = [];
        for (const c of clauses) {
            const m = c.text.match(COST_ONLY_RE);
            if (m && !/(부여|증가|감소|획득|회복|해제)/.test(m[1])) {
                cost.push({
                    resource: { type: "keyword", owner: "self", name: m[1].trim(), scope: "global" },
                    amount: m[2] ? Number(m[2]) : { type: "ref", note: "수치 미표기 — 전량 소모 추정" },
                    _confidence: "low",
                    _raw: c.text,
                });
            } else {
                remaining.push(c);
            }
        }
        return { cost, remaining };
    }

    // ── Stage 4 — 어휘 매칭 (절 → Node) ──

    const OP_PATTERNS = [
        { op: "부여", re: /^(.+?)\s*(\d+)\s*부여$/ },
        { op: "증가", re: /^(.+?)\s*(\d+)\s*증가$/ },
        { op: "감소", re: /^(.+?)\s*(\d+)\s*감소$/ },
        { op: "획득", re: /^(.+?)\s*(\d+)\s*획득$/ },
        { op: "회복", re: /^(.+?)\s*(\d+)\s*회복$/ },
        { op: "소모", re: /^(.+?)\s*(\d+)\s*소모(함)?$/ },
    ];
    const REMOVE_RE = /^(.+?)\s*해제$/;
    const IF_RE = /^(.+?)(?:이|가)?\s*(이상이면|이하이면|초과이면|미만이면|이면),?\s*(.+)$/;
    const CHANCE_RE = /^\(?(\d+)\s*%\)?\s*확률로\s*(.+)$/;

    function matchClauseToNode(text) {
        const ifm = text.match(IF_RE);
        if (ifm) {
            const [, condSubject, condTail, effectText] = ifm;
            const inner = matchClauseToNode(effectText.trim());
            return {
                kind: "if",
                limit: { type: "raw", text: `${condSubject}${condTail}`.trim() },
                body: [inner],
                _confidence: "low",
                _note: "Condition 구조화(compare/tag/has) 미적용 — raw 텍스트로만 보존, 13.2절 재작업 대상",
            };
        }

        const chm = text.match(CHANCE_RE);
        if (chm) {
            const [, pct, effectText] = chm;
            const inner = matchClauseToNode(effectText.trim());
            return {
                kind: "chance",
                base: Number(pct),
                body: [inner],
                _confidence: "low",
                _note: "base가 game_state 참조(19.1절)인지 상수인지 미판별 — 검수 필요",
            };
        }

        const rm = text.match(REMOVE_RE);
        if (rm && !OP_PATTERNS.some((p) => p.re.test(text))) {
            return { kind: "entry", target: "keyword", params: { keyword: rm[1].trim(), op: "해제" }, _confidence: "high" };
        }

        for (const { op, re } of OP_PATTERNS) {
            const m = text.match(re);
            if (m) {
                return {
                    kind: "entry",
                    target: "keyword",
                    params: { keyword: m[1].trim(), amount: Number(m[2]), op },
                    _confidence: "high",
                };
            }
        }

        return { kind: "raw", raw: text, _confidence: "none" };
    }

    // ── 스크립트 텍스트 하나 → Block[] ──

    function scriptToBlocks(text, coin) {
        const blocks = [];
        for (const { head, body } of splitByHead(text)) {
            const clauses = splitClauses(body);
            const { cost, remaining } = extractCost(clauses);
            const bodyNodes = remaining.map((c) => {
                const node = matchClauseToNode(c.text);
                if (c.confidence === "low" && node._confidence === "high") node._confidence = "low";
                return node;
            });
            const block = { head, body: bodyNodes };
            if (coin !== undefined) block.coin = coin;
            if (cost.length) block.cost = cost;
            blocks.push(block);
        }
        return blocks;
    }

    // ── 인격 하나 전체 변환 ──

    function isSkillLike(v) {
        return v && typeof v === "object" && typeof v.script === "string";
    }
    function isPassiveGroup(v) {
        return v && typeof v === "object" && Object.values(v).some((p) => p && typeof p === "object" && typeof p.content === "string");
    }

    function convertIdentity(id) {
        const out = { name: id.name, skills: {}, passives: {} };
        for (const [key, val] of Object.entries(id)) {
            if (isSkillLike(val)) {
                const blocks = [...scriptToBlocks(val.script, undefined)];
                for (const [coinKey, coinText] of Object.entries(val.coineffects || {})) {
                    const coinMatch = coinKey.match(/(\d+)/);
                    const coinNum = coinMatch ? Number(coinMatch[1]) : undefined;
                    blocks.push(...scriptToBlocks(coinText, coinNum));
                }
                out.skills[key] = { name: val.name, blocks };
            } else if (isPassiveGroup(val)) {
                const group = {};
                for (const [pKey, pVal] of Object.entries(val)) {
                    if (pVal && typeof pVal.content === "string") {
                        group[pKey] = { name: pVal.name, blocks: scriptToBlocks(pVal.content, undefined) };
                    }
                }
                out.passives[key] = group;
            }
        }
        return out;
    }

    // ── 커버리지 통계 ──

    function collectStats(structured) {
        let totalNodes = 0;
        let rawNodes = 0;
        let lowConfidenceNodes = 0;
        const unknownTriggers = new Set();

        function walkNode(n) {
            totalNodes++;
            if (n.kind === "raw") rawNodes++;
            if (n._confidence === "low" || n._confidence === "none") lowConfidenceNodes++;
            if (Array.isArray(n.body)) n.body.forEach(walkNode);
        }
        function walkBlock(b) {
            if (b.head && b.head._confidence === "low") unknownTriggers.add(b.head.trigger);
            b.body.forEach(walkNode);
        }

        for (const identity of Object.values(structured)) {
            for (const skill of Object.values(identity.skills)) skill.blocks.forEach(walkBlock);
            for (const group of Object.values(identity.passives)) {
                for (const p of Object.values(group)) p.blocks.forEach(walkBlock);
            }
        }

        return {
            totalNodes,
            rawNodes,
            rawRatio: totalNodes ? +(rawNodes / totalNodes).toFixed(3) : 0,
            lowConfidenceNodes,
            lowConfidenceRatio: totalNodes ? +(lowConfidenceNodes / totalNodes).toFixed(3) : 0,
            unknownTriggers: [...unknownTriggers],
        };
    }

    function convertAll(identitiesData) {
        const structured = {};
        for (const [name, id] of Object.entries(identitiesData)) {
            structured[name] = convertIdentity(id);
        }
        return { structured, report: collectStats(structured) };
    }

    return {
        splitByHead,
        splitClauses,
        extractCost,
        matchClauseToNode,
        scriptToBlocks,
        convertIdentity,
        collectStats,
        convertAll,
    };
});