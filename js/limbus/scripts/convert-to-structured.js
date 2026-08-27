#!/usr/bin/env node
// ════════════════════════════════════════════════════════
//  convert-to-structured.js
//  identities.json(자유 텍스트) → Block 스키마(limbus-structured-schema.md) 구조화 컨버터
//
//  md 20절 5단계 파이프라인의 1차 구현.
//    Stage 0 — 코인 매핑            (기계적, 신뢰도 high)
//    Stage 1 — Head(트리거) 분리    (기계적, 신뢰도 high/low)
//    Stage 2 — 절 경계 복원         (휴리스틱, 신뢰도 low)
//    Stage 3 — cost/body 분리       (구조적 패턴, 신뢰도 low)
//    Stage 4 — 어휘 매칭            (패턴 매칭, 신뢰도 high/low, 실패시 raw)
//  Stage 5(정답셋 회귀 검증)는 이 스크립트 범위 밖 — 별도 diff 스크립트로 후속 작업.
//
//  실행:
//    node js/limbus/scripts/convert-to-structured.js
//
//  출력 (원본 identities.json은 건드리지 않음 — 20.3절 "읽기 전용" 원칙):
//    js/limbus/data/identities.structured.json   — 변환 결과
//    js/limbus/data/identities.structured.report.json — 커버리지 통계
// ════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const { LIMBUS_TRIGGERS } = require("../data/limbus-defs.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const IN_PATH = path.join(DATA_DIR, "identities.json");
const OUT_PATH = path.join(DATA_DIR, "identities.structured.json");
const REPORT_PATH = path.join(DATA_DIR, "identities.structured.report.json");

const TRIGGER_KEYS = new Set(LIMBUS_TRIGGERS.map((t) => t.key));

// ────────────────────────────────────────────────────────
// Stage 1 — [트리거] 대괄호 기준 Head 분리
// ────────────────────────────────────────────────────────

function normalizeTrigger(raw) {
    const trimmed = raw.trim();
    if (TRIGGER_KEYS.has(trimmed)) return { trigger: trimmed, confidence: "high" };
    const collapsed = trimmed.replace(/\s+/g, "");
    for (const key of TRIGGER_KEYS) {
        if (key.replace(/\s+/g, "") === collapsed) return { trigger: key, confidence: "high" };
    }
    // LIMBUS_TRIGGERS(22종) 목록에 없는 신규 트리거 후보 — 20.4절 1번 항목(트리거 커버리지 통계)의 원재료
    return { trigger: trimmed, confidence: "low", note: "LIMBUS_TRIGGERS 목록 밖 — 신규 트리거 후보" };
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
        heads.push({ head: { trigger: norm.trigger, _confidence: norm.confidence, ...(norm.note ? { _note: norm.note } : {}) }, body });
    }
    return heads;
}

// ────────────────────────────────────────────────────────
// Stage 2 — 절 경계 복원 (구두점 없이 붙은 문장 분리)
// ────────────────────────────────────────────────────────
// "진동 횟수 2 증가자신의 진동 횟수가..."처럼 종결형(증가/감소/부여 등) 뒤에
// 곧바로 새 주어(자신의/대상의/이 코인의 등)가 붙으면 절 경계로 간주한다.
// 오분리 가능성이 있으므로 이 경계로 나뉜 절은 전부 confidence: "low"로 표시한다.

const CLAUSE_END = "(증가|감소|부여|소모|획득|회복|해제)";
const NEW_SUBJECT = "(자신의|자신이|대상의|대상이|이 코인의|이 코인이|보유한|해당|만약)";
const BOUNDARY_RE = new RegExp(CLAUSE_END + "(?=" + NEW_SUBJECT + ")", "g");
const MARK = "\u0001";

function splitClauses(bodyText) {
    if (!bodyText) return [];
    // 1) 줄바꿈/마침표 — 신뢰도 높은 1차 분리
    // 2) 대시(-) 불릿 — 패시브 content에서 실사용 확인된 고신뢰 구분자
    // 3) 위 둘로 안 나뉜 안쪽에서만 Stage2 휴리스틱 적용
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

// ────────────────────────────────────────────────────────
// Stage 3 — cost / body 분리
// ────────────────────────────────────────────────────────
// 절 전체가 "OO N 소모"만으로 끝나는 경우(뒤에 다른 결과 효과가 안 붙는 경우) → Block.cost로 분리.
// md 19.2절 Block.cost 필드에 대응.

const COST_ONLY_RE = /^(.+?)\s*(\d+)?\s*소모(함)?$/;

function extractCost(clauses) {
    const cost = [];
    const remaining = [];
    for (const c of clauses) {
        const m = c.text.match(COST_ONLY_RE);
        // "소모"로 끝나되, 그 앞에 다른 결과 서술어(부여/증가 등)가 섞여 있지 않은 "순수 소모" 절만 cost로 분리
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

// ────────────────────────────────────────────────────────
// Stage 4 — 어휘 매칭 (절 → Node)
// ────────────────────────────────────────────────────────

const OP_PATTERNS = [
    { op: "부여", re: /^(.+?)\s*(\d+)\s*부여$/ },
    { op: "증가", re: /^(.+?)\s*(\d+)\s*증가$/ },
    { op: "감소", re: /^(.+?)\s*(\d+)\s*감소$/ },
    { op: "획득", re: /^(.+?)\s*(\d+)\s*획득$/ },
    { op: "회복", re: /^(.+?)\s*(\d+)\s*회복$/ },
    { op: "소모", re: /^(.+?)\s*(\d+)\s*소모(함)?$/ }, // Stage3에서 못 걸러진 body 내 소모(예: consumed 참조용)
];
const REMOVE_RE = /^(.+?)\s*해제$/;
const IF_RE = /^(.+?)(?:이|가)?\s*(이상이면|이하이면|초과이면|미만이면|이면),?\s*(.+)$/;
const CHANCE_RE = /^\(?(\d+)\s*%\)?\s*확률로\s*(.+)$/;

function matchClauseToNode(text) {
    // if 우선순위: "~이면," 패턴이 있으면 조건부로 감싸고 나머지를 재귀 매칭
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
        return {
            kind: "entry",
            target: "keyword",
            params: { keyword: rm[1].trim(), op: "해제" },
            _confidence: "high",
        };
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

    // 전부 실패 → raw 폴백 (md 13절/20.2절 Stage4 원칙)
    return { kind: "raw", raw: text, _confidence: "none" };
}

// ────────────────────────────────────────────────────────
// 스크립트 텍스트 하나(공통 script 또는 코인 script)를 Block 배열로 변환
// ────────────────────────────────────────────────────────

function scriptToBlocks(text, coin) {
    const blocks = [];
    for (const { head, body } of splitByHead(text)) {
        const clauses = splitClauses(body);
        const { cost, remaining } = extractCost(clauses);
        const bodyNodes = remaining.map((c) => {
            const node = matchClauseToNode(c.text);
            // Stage2에서 low confidence로 분리된 절은 그 결과 노드도 low로 낮춘다
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

// ────────────────────────────────────────────────────────
// 인격 하나의 스킬/패시브를 전부 순회하며 변환
// ────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────
// 커버리지 통계 (raw 비율, 신규 트리거 후보) — 20.4절 3번 항목
// ────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────
// 메인
// ────────────────────────────────────────────────────────

function main() {
    const raw = fs.readFileSync(IN_PATH, "utf-8");
    const data = JSON.parse(raw);

    const structured = {};
    for (const [name, id] of Object.entries(data)) {
        structured[name] = convertIdentity(id);
    }

    const report = collectStats(structured);

    fs.writeFileSync(OUT_PATH, JSON.stringify(structured, null, 2), "utf-8");
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

    console.log(`인격 ${Object.keys(structured).length}종 변환 완료 → ${path.relative(process.cwd(), OUT_PATH)}`);
    console.log(`총 노드 ${report.totalNodes}개 중 raw 폴백 ${report.rawNodes}개 (${(report.rawRatio * 100).toFixed(1)}%)`);
    console.log(`저신뢰(low/none) 노드 ${report.lowConfidenceNodes}개 (${(report.lowConfidenceRatio * 100).toFixed(1)}%) — 검수 우선순위`);
    if (report.unknownTriggers.length) {
        console.log(`LIMBUS_TRIGGERS 목록 밖 트리거 후보 ${report.unknownTriggers.length}개:`, report.unknownTriggers);
    }
}

if (require.main === module) {
    main();
}

module.exports = { convertIdentity, scriptToBlocks, splitByHead, splitClauses, matchClauseToNode, collectStats };