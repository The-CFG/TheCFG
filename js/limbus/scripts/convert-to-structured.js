#!/usr/bin/env node
// ════════════════════════════════════════════════════════
//  convert-to-structured.js
//  identities.json(자유 텍스트) → Block 스키마(limbus-structured-schema.md) 구조화 컨버터
//  (Node.js CLI용 — 파일 입출력만 담당. 실제 변환 로직은 limbus-converter-core.js에서
//   가져와 브라우저용 convert.html과 100% 동일한 코드를 공유한다.)
//
//  실행:
//    node js/limbus/scripts/convert-to-structured.js
//
//  출력 (원본 identities.json은 건드리지 않음 — md 20.3절 "읽기 전용" 원칙):
//    js/limbus/data/identities.structured.json        — 변환 결과
//    js/limbus/data/identities.structured.report.json — 커버리지 통계
// ════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const LimbusConverterCore = require("./limbus-converter-core.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const IN_PATH = path.join(DATA_DIR, "identities.json");
const OUT_PATH = path.join(DATA_DIR, "identities.structured.json");
const REPORT_PATH = path.join(DATA_DIR, "identities.structured.report.json");

function main() {
    const raw = fs.readFileSync(IN_PATH, "utf-8");
    const data = JSON.parse(raw);

    const { structured, report } = LimbusConverterCore.convertAll(data);

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