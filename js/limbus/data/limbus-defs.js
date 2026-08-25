// ════════════════════════════════════════════════════════
//  limbus-defs.js — 인격 편찬기 트리거 / 효과 함수 정의 라이브러리
//  구조는 HOI4Editor의 hoi4-defs.js(HOI4_EFFECTS / HOI4_TRIGGERS)를 참고했다.
//  단, 림버스컴퍼니 인격 스크립트는 Clausewitz식 key=value 문법이 아니라
//  자유 서술형 한국어 문장이므로, "함수"는 실행되는 코드가 아니라
//  문장을 조립해주는 템플릿(template)이다.
//
//  params 타입:
//    number   — 수치 (프롬프트에서 숫자로 입력)
//    keyword  — 키워드/자원명 (예: 침잠, 출혈, 카르마 — 용어사전과 연동)
//    string   — 일반 문자열
//
//  기존 46개 인격 데이터의 동기화/스킬/코인효과/패시브 문구를 분석해
//  가장 빈번한 패턴(부여/증가/감소/소모/획득/회복/해제)을 초안으로 만들었다.
//  필요에 따라 자유롭게 추가·수정해서 쓰면 된다.
// ════════════════════════════════════════════════════════

const LIMBUS_EFFECTS = [
    {
        key: "apply_status",
        category: "상태이상/자원 부여",
        label: "대상에게 지정한 만큼 상태이상이나 자원을 부여합니다. (예: 출혈 1 부여, 진동 2 부여)",
        template: "{keyword} {amount} 부여",
        params: [
            { name: "keyword", type: "keyword", default: "출혈" },
            { name: "amount", type: "number", default: 1 },
        ],
    },
    {
        key: "apply_status_to",
        category: "상태이상/자원 부여",
        label: "대상을 지정해 상태이상이나 자원을 부여합니다. (예: 적에게 화상 2 부여)",
        template: "{target}에게 {keyword} {amount} 부여",
        params: [
            { name: "target", type: "string", default: "대상" },
            { name: "keyword", type: "keyword", default: "화상" },
            { name: "amount", type: "number", default: 1 },
        ],
    },
    {
        key: "stat_increase",
        category: "수치 증가",
        label: "능력치나 수치를 증가시킵니다. (예: 공격 레벨 증가 1 부여)",
        template: "{keyword} 증가 {amount} 부여",
        params: [
            { name: "keyword", type: "keyword", default: "공격 레벨" },
            { name: "amount", type: "number", default: 1 },
        ],
    },
    {
        key: "stat_decrease",
        category: "수치 감소",
        label: "능력치나 수치를 감소시킵니다. (예: 방어 레벨 감소 2 부여)",
        template: "{keyword} 감소 {amount} 부여",
        params: [
            { name: "keyword", type: "keyword", default: "방어 레벨" },
            { name: "amount", type: "number", default: 1 },
        ],
    },
    {
        key: "resource_consume",
        category: "자원 소모",
        label: "자원이나 코인 위력 등을 소모합니다. (예: 카르마 1 소모)",
        template: "{keyword} {amount} 소모",
        params: [
            { name: "keyword", type: "keyword", default: "카르마" },
            { name: "amount", type: "number", default: 1 },
        ],
    },
    {
        key: "resource_gain",
        category: "자원 획득",
        label: "자원이나 호흡 등을 획득합니다. (예: 호흡 1 획득)",
        template: "{keyword} {amount} 획득",
        params: [
            { name: "keyword", type: "keyword", default: "호흡" },
            { name: "amount", type: "number", default: 1 },
        ],
    },
    {
        key: "resource_recover",
        category: "회복",
        label: "체력이나 정신력 등을 회복합니다. (예: 정신력 5 회복)",
        template: "{keyword} {amount} 회복",
        params: [
            { name: "keyword", type: "keyword", default: "정신력" },
            { name: "amount", type: "number", default: 5 },
        ],
    },
    {
        key: "remove_status",
        category: "해제/제거",
        label: "상태이상이나 부여된 효과를 해제합니다. (예: 출혈 해제)",
        template: "{keyword} 해제",
        params: [
            { name: "keyword", type: "keyword", default: "출혈" },
        ],
    },
    {
        key: "power_bonus",
        category: "위력 보정",
        label: "코인 위력이나 합 위력을 증감시킵니다. (예: 코인 위력 +2)",
        template: "{keyword} {sign}{amount}",
        params: [
            { name: "keyword", type: "keyword", default: "코인 위력" },
            { name: "sign", type: "string", default: "+" },
            { name: "amount", type: "number", default: 2 },
        ],
    },
    {
        key: "custom_condition_amount",
        category: "기타 (자유 조합)",
        label: "위 틀에 맞지 않는 경우, 키워드/수치/서술어를 자유롭게 조합합니다.",
        template: "{keyword} {amount} {verb}",
        params: [
            { name: "keyword", type: "keyword", default: "" },
            { name: "amount", type: "number", default: 1 },
            { name: "verb", type: "string", default: "부여" },
        ],
    },
];

const LIMBUS_TRIGGERS = [
    { key: "사용시", label: "이 스킬(또는 패시브)을 사용했을 때 발동" },
    { key: "사용 시작 전", label: "스킬 사용이 확정되기 전, 시작 단계에서 발동" },
    { key: "공격 시작 전", label: "공격 판정이 시작되기 전에 발동" },
    { key: "공격 종료시", label: "공격(합) 판정이 모두 끝난 뒤 발동" },
    { key: "전투 시작시", label: "전투가 시작될 때 1회 발동" },
    { key: "턴 시작시", label: "매 턴이 시작될 때 발동" },
    { key: "턴 종료시", label: "매 턴이 끝날 때 발동" },
    { key: "적중시", label: "자신의 공격이 적을 맞췄을 때 발동" },
    { key: "크리티컬 적중시", label: "크리티컬로 적중했을 때 발동" },
    { key: "앞면 적중시", label: "코인 앞면으로 적중했을 때 발동" },
    { key: "뒷면 적중시", label: "코인 뒷면으로 적중했을 때 발동" },
    { key: "파괴되지 않고 적중시", label: "코인이 파괴되지 않은 상태로 적중했을 때 발동" },
    { key: "합 승리시", label: "합(클래시)에서 승리했을 때 발동" },
    { key: "합 패배시", label: "합(클래시)에서 패배했을 때 발동" },
    { key: "합 무승부시", label: "합(클래시)이 무승부일 때 발동" },
    { key: "회피 성공시", label: "회피 판정에 성공했을 때 발동" },
    { key: "회피 실패시", label: "회피 판정에 실패했을 때 발동" },
    { key: "적 처치시", label: "이 스킬로 적을 처치했을 때 발동" },
    { key: "크리티컬 적 처치시", label: "크리티컬로 적을 처치했을 때 발동" },
    { key: "사망시", label: "자신이 사망했을 때 발동" },
    { key: "퇴장시", label: "전투에서 퇴각/퇴장할 때 발동" },
    { key: "등장시", label: "전투에 등장(투입)했을 때 발동" },
    { key: "대기 해제시", label: "대기 상태가 해제되고 편성될 때 발동" },
];

// ── 룩업 헬퍼 (hoi4-defs.js의 hoi4GetDef / hoi4SearchDefs와 동일한 패턴) ──
const LIMBUS_DEF_MAP = (() => {
    const m = {};
    for (const e of LIMBUS_EFFECTS) m["fx:" + e.key] = e;
    for (const t of LIMBUS_TRIGGERS) m["tg:" + t.key] = t;
    return m;
})();

function limbusGetDef(key, kind) {
    // kind: 'effect' | 'trigger' | null(전체 검색)
    if (kind === "effect" || !kind) { const d = LIMBUS_DEF_MAP["fx:" + key]; if (d) return d; }
    if (kind === "trigger" || !kind) { const d = LIMBUS_DEF_MAP["tg:" + key]; if (d) return d; }
    return null;
}

// 검색어로 목록 필터링 (최대 n개). 결과 항목에 _kind('effect'|'trigger')를 붙여 반환한다.
function limbusSearchDefs(query, kinds = ["effect", "trigger"], max = 30) {
    const q = (query || "").toLowerCase();
    const results = [];
    const lists = { effect: LIMBUS_EFFECTS, trigger: LIMBUS_TRIGGERS };
    for (const kind of kinds) {
        for (const item of lists[kind] || []) {
            if (results.length >= max) break;
            const hay = (item.key + " " + (item.label || "") + " " + (item.category || "")).toLowerCase();
            if (hay.includes(q)) results.push({ ...item, _kind: kind });
        }
        if (results.length >= max) break;
    }
    return results;
}

// 효과 함수 템플릿에 값을 채워 최종 문장을 만든다.
// getParamValue(param) 콜백이 각 파라미터의 값을 반환해야 하며,
// null/undefined를 반환하면 삽입을 취소한 것으로 간주한다.
function limbusApplyTemplate(def, getParamValue) {
    let text = def.template;
    for (const p of def.params || []) {
        const val = getParamValue(p);
        if (val === null || val === undefined) return null; // 취소
        text = text.split(`{${p.name}}`).join(String(val));
    }
    return text;
}