// ════════════════════════════════════════════════════════
//  convert-ui.js — limbus/convert.html 전용 스크립트
//  브라우저에서 identities.json(들) → Block 스키마 변환을 실행하는 UI 로직.
//  실제 변환 로직은 전혀 없음 — limbus-converter-core.js(Node CLI와 공유)만 호출.
//
//  기능 2가지:
//   1) 여러 JSON 파일을 한꺼번에 선택해 변환 대상으로 삼을 수 있음
//      (편찬기에서 인격별로 낱개 내보내기한 파일들을 그대로 모아서 올리는 용도)
//   2) 변환 결과를 사이트의 기존 identities.structured.json 위에 자동으로 병합해서
//      내려받게 함 — "홈페이지 데이터에 자동으로 추가"를 정적 사이트 구조 안에서
//      구현한 것. 실제 배포 서버 반영은 여전히 수동(다운로드 파일로 교체).
// ════════════════════════════════════════════════════════

(function () {
    const btnRun = document.getElementById("btn-run");
    const btnDlStructured = document.getElementById("btn-dl-structured");
    const btnDlReport = document.getElementById("btn-dl-report");
    const fileInput = document.getElementById("file-input");
    const fileListEl = document.getElementById("file-list");
    const logEl = document.getElementById("log");
    const statsEl = document.getElementById("stats");

    let lastMerged = null;   // 기존 홈페이지 데이터 + 이번 변환분 (다운로드 대상)
    let lastReport = null;   // 이번 변환분에 대한 통계만

    const DEFAULT_LOG = "변환 실행 버튼을 누르면 여기에 진행 상황과 결과 요약이 표시됩니다.";

    function log(msg) {
        logEl.textContent += (logEl.textContent === DEFAULT_LOG || logEl.textContent === "" ? "" : "\n") + msg;
    }
    function resetLog() {
        logEl.textContent = "";
    }
    function download(filename, obj) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 업로드된 JSON 하나가 "단일 인격 export"(편찬기 exportIdentity 결과, {name, skill1, ...})인지
    // "여러 인격 맵"(identities.json 형태, {"[키]이름": {name, ...}, ...})인지 구분.
    function looksLikeSingleIdentity(obj) {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
        if (typeof obj.name !== "string") return false;
        // 값들이 전부 identity-like 객체인 맵이면 단일 인격이 아니라 맵으로 판단
        const values = Object.values(obj);
        const looksLikeMap = values.length > 0 && values.every((v) => v && typeof v === "object" && typeof v.name === "string");
        return !looksLikeMap;
    }

    function mergeIntoIdentities(target, obj, sourceLabel, warnings) {
        if (looksLikeSingleIdentity(obj)) {
            const key = obj.name && obj.name.trim() ? obj.name.trim() : sourceLabel;
            if (target[key]) warnings.push(`"${key}" — 기존 항목을 ${sourceLabel} 내용으로 덮어씀`);
            target[key] = obj;
        } else {
            for (const [k, v] of Object.entries(obj)) {
                if (target[k]) warnings.push(`"${k}" — 기존 항목을 ${sourceLabel} 내용으로 덮어씀`);
                target[k] = v;
            }
        }
    }

    async function loadIdentitiesData() {
        const files = fileInput.files;
        if (files && files.length > 0) {
            log(`선택한 파일 ${files.length}개를 병합해서 읽는 중...`);
            const merged = {};
            const warnings = [];
            for (const f of files) {
                const text = await f.text();
                let obj;
                try {
                    obj = JSON.parse(text);
                } catch (e) {
                    warnings.push(`"${f.name}" — JSON 파싱 실패, 건너뜀 (${e.message})`);
                    continue;
                }
                mergeIntoIdentities(merged, obj, f.name, warnings);
            }
            for (const w of warnings) log(`  ⚠ ${w}`);
            log(`병합 결과: 인격 ${Object.keys(merged).length}종`);
            return merged;
        }
        log("파일을 선택하지 않아 기본 경로 /js/limbus/data/identities.json(전체)을 불러옵니다...");
        const res = await fetch("/js/limbus/data/identities.json");
        if (!res.ok) throw new Error(`identities.json 로드 실패 (HTTP ${res.status})`);
        return res.json();
    }

    async function loadExistingStructured() {
        try {
            const res = await fetch("/js/limbus/data/identities.structured.json");
            if (!res.ok) return {};
            return await res.json();
        } catch (e) {
            return {};
        }
    }

    function renderStats(count, report, mergedTotal) {
        statsEl.style.display = "grid";
        document.getElementById("stat-count").textContent = String(count);
        document.getElementById("stat-total").textContent = report.totalNodes.toLocaleString("ko-KR");
        document.getElementById("stat-raw").textContent = `${(report.rawRatio * 100).toFixed(1)}% (${report.rawNodes})`;
        document.getElementById("stat-low").textContent = `${(report.lowConfidenceRatio * 100).toFixed(1)}% (${report.lowConfidenceNodes})`;
        document.getElementById("stat-triggers").textContent = String(report.unknownTriggers.length);
        document.getElementById("stat-merged").textContent = String(mergedTotal);
    }

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            fileListEl.style.display = "block";
            fileListEl.textContent = `선택됨 (${fileInput.files.length}개): ` + [...fileInput.files].map((f) => f.name).join(", ");
        } else {
            fileListEl.style.display = "none";
        }
    });

    async function runConversion() {
        resetLog();
        btnRun.disabled = true;
        btnDlStructured.disabled = true;
        btnDlReport.disabled = true;
        statsEl.style.display = "none";

        try {
            if (typeof LimbusConverterCore === "undefined") {
                throw new Error("LimbusConverterCore를 찾을 수 없습니다 — limbus-converter-core.js 로딩 순서를 확인하세요.");
            }

            const inputData = await loadIdentitiesData();
            const inputCount = Object.keys(inputData).length;
            log(`변환 시작 (${inputCount}종)...`);

            const { structured: newStructured, report } = LimbusConverterCore.convertAll(inputData);

            log(`변환 완료.`);
            log(`총 노드 ${report.totalNodes}개 중 raw 폴백 ${report.rawNodes}개 (${(report.rawRatio * 100).toFixed(1)}%)`);
            log(`저신뢰(low/none) 노드 ${report.lowConfidenceNodes}개 (${(report.lowConfidenceRatio * 100).toFixed(1)}%)`);
            if (report.unknownTriggers.length) {
                log(`LIMBUS_TRIGGERS 목록 밖 트리거 후보 ${report.unknownTriggers.length}개:`);
                log(report.unknownTriggers.map((t) => `  - ${t}`).join("\n"));
            }

            log(`기존 홈페이지 데이터(identities.structured.json)를 불러와 병합하는 중...`);
            const existing = await loadExistingStructured();
            const existingCount = Object.keys(existing).length;
            const overwritten = Object.keys(newStructured).filter((k) => existing[k]);
            const merged = { ...existing, ...newStructured };
            log(`기존 ${existingCount}종 + 신규 ${Object.keys(newStructured).length}종 → 병합 후 ${Object.keys(merged).length}종`);
            if (overwritten.length) log(`  ⚠ 기존 데이터와 이름이 겹쳐 덮어써진 인격: ${overwritten.join(", ")}`);

            lastMerged = merged;
            lastReport = report;

            renderStats(inputCount, report, Object.keys(merged).length);
            btnDlStructured.disabled = false;
            btnDlReport.disabled = false;
        } catch (err) {
            log(`오류: ${err.message}`);
            console.error(err);
        } finally {
            btnRun.disabled = false;
        }
    }

    btnRun.addEventListener("click", runConversion);
    btnDlStructured.addEventListener("click", () => {
        if (lastMerged) download("identities.structured.json", lastMerged);
    });
    btnDlReport.addEventListener("click", () => {
        if (lastReport) download("identities.structured.report.json", lastReport);
    });
})();