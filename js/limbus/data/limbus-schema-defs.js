// ════════════════════════════════════════════════════════
//  limbus-schema-defs.js — 구조화 데미지 계산기 스키마 어휘 레지스트리
//
//  limbus-defs.js가 "자유 텍스트 편찬기"용 템플릿(문장 조립)이라면,
//  이 파일은 limbus-structured-schema.md 1~19절에서 확정한
//  Block / Node / Ref / Condition 구조 자체의 어휘를 코드로 옮긴 것이다.
//
//  브라우저(<script> 전역)와 Node.js(require) 양쪽에서 쓸 수 있도록
//  마지막에 module.exports를 조건부로 붙인다.
//
//  각 목록은 md의 "열린 목록" 원칙을 그대로 따른다 — 여기 없는 값이
//  나오면 raw로 폴백하고, 실사용례가 쌓이면 이 목록에 추가한다.
//  (md 절 번호는 근거 위치를 그대로 남겨, md와 코드가 어긋나면 바로
//  대조할 수 있게 한다.)
// ════════════════════════════════════════════════════════

// ── BODY 노드 종류 (md 3절) ──
const LIMBUS_NODE_KINDS = [
    { key: "entry", label: "단순 효과 (키워드+수치 등 파라미터형 실행문)", md: "3절" },
    { key: "if", label: "참/거짓 조건부 분기 (limit=Condition, body, else_if[], else)", md: "3절, 13.2절" },
    { key: "chance", label: "확률형 특수조건 (base + ref×coef, else 포함)", md: "3절, 3.1절, 19.1절" },
    { key: "scale", label: "비례/누적형 특수조건 (A per N, mode: modifier|repeat, cap)", md: "3절, 3.1절" },
    { key: "limit", label: "제한형 특수조건 (scope, capType: count|amount, cap)", md: "3절, 3.1절" },
    { key: "sequence", label: "특정 effect 직후에만 열리는 종속 서브 BODY", md: "3절" },
    { key: "raw", label: "알 수 없는/미구조화 원문 보존", md: "3절" },
];

// ── entry(EntryNode)의 target 종류 — 열린 목록 (md 4절, 10.1/10.2절) ──
const LIMBUS_ENTRY_TARGETS = [
    { key: "keyword", label: "수치/상태이상 자원에 대한 증감·부여·해제", md: "4절" },
    { key: "skill_cast", label: "인격 전용 서브 스킬을 즉시 발동", md: "4절, 4.2절" },
    { key: "skill_slot", label: "자신의 스킬 슬롯 배치 자체를 변경", md: "4절, 4.2절" },
    { key: "keyword_def", label: "대상 키워드의 정의(상한/하한 등)를 수정", md: "4절, 4.1절" },
    { key: "keyword_trigger", label: "이미 걸려 있는 상태이상을 즉시 1회 강제 발동", md: "10.1절" },
    { key: "fixed_damage", label: "방어 공식을 우회하는 고정 피해", md: "10.2절" },
];

// ── Ref (수식/참조) 타입 — 닫힌 목록, 실사용례 확인 후에만 추가 (md 3.1절, 13.1절, 19.1절) ──
const LIMBUS_REF_TYPES = [
    { key: "keyword", shape: "{ type, owner: 'self'|'target', name, scope?: 'global'|'group'|'local' }", md: "3.1절" },
    { key: "combine", shape: "{ type, op: 'sum', refs: Ref[] }", md: "3.1절" },
    { key: "count", shape: "{ type, pool: 'ally'|'enemy'|'self'|string, conditions: string[] }", md: "3.1절" },
    { key: "const", shape: "{ type, value: number }", md: "3.1절" },
    { key: "consumed", shape: "{ type, source: Ref, cap?, scope?: 'skill'|'coin' }", md: "13.1절, 19.2절" },
    { key: "game_state", shape: "{ type, name: string }  // 예: 'coin_front_chance', '정신력'", md: "19.1절" },
    { key: "resonance", shape: "{ type, sin?: string, kind: 'normal'|'perfect' }", md: "19.1절" },
];

// ── Condition (if.limit / chance 조건) 타입 (md 13.2절) ──
const LIMBUS_CONDITIONS = [
    { key: "compare", shape: "{ type, left: Ref, op: 'gte'|'lte'|'gt'|'lt'|'eq'|'neq', right: Ref }", template: "{left}이(가) {right} {op}이면" },
    { key: "has", shape: "{ type, ref: Ref, negate? }", template: "{ref}을(를) 보유하고 있으면" },
    { key: "tag", shape: "{ type, owner: 'self'|'target', tag: string, negate? }", template: "{owner}이(가) {tag} 소속이면" },
    { key: "and", shape: "{ type, conditions: Condition[] }", template: "({conditions} 모두 참이면)" },
    { key: "or", shape: "{ type, conditions: Condition[] }", template: "({conditions} 중 하나라도 참이면)" },
    { key: "raw", shape: "{ type, text: string }", template: "{text}" },
];

// ── Block 최상위 필드 (md 2절, 19.2절 — coin/cost 확장) ──
// type Block = { coin?: number, cost?: { resource: Ref, amount: number|Ref }[], head: Head|null, body: Node[] }

// ── 룩업 헬퍼 (limbus-defs.js의 limbusGetDef 패턴과 동일) ──
const LIMBUS_SCHEMA_MAP = (() => {
    const m = {};
    for (const n of LIMBUS_NODE_KINDS) m["nk:" + n.key] = n;
    for (const t of LIMBUS_ENTRY_TARGETS) m["et:" + t.key] = t;
    for (const r of LIMBUS_REF_TYPES) m["rf:" + r.key] = r;
    for (const c of LIMBUS_CONDITIONS) m["cd:" + c.key] = c;
    return m;
})();

function limbusSchemaGetDef(key, kind) {
    // kind: 'node' | 'target' | 'ref' | 'condition' | null(전체 검색)
    const prefixes = { node: "nk:", target: "et:", ref: "rf:", condition: "cd:" };
    if (kind) return LIMBUS_SCHEMA_MAP[prefixes[kind] + key] || null;
    for (const p of Object.values(prefixes)) {
        if (LIMBUS_SCHEMA_MAP[p + key]) return LIMBUS_SCHEMA_MAP[p + key];
    }
    return null;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        LIMBUS_NODE_KINDS,
        LIMBUS_ENTRY_TARGETS,
        LIMBUS_REF_TYPES,
        LIMBUS_CONDITIONS,
        LIMBUS_SCHEMA_MAP,
        limbusSchemaGetDef,
    };
}