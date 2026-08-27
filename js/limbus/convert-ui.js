// ════════════════════════════════════════════════════════
//  convert-ui.js — limbus/convert.html 전용 스크립트
//  브라우저에서 identities.json → Block 스키마 변환을 실행하는 UI 로직.
//  실제 변환 로직은 전혀 없음 — limbus-converter-core.js(Node CLI와 공유)만 호출.
// ════════════════════════════════════════════════════════

(function () {
    const btnRun = document.getElementById("btn-run");
    const btnDlStructured = document.getElementById("btn-dl-structured");
    const btnDlReport = document.getElementById("btn-dl-report");
    const fileInput = document.getElementById("file-input");
    const logEl = document.getElementById("log");
    const statsEl = document.getElementById("stats");

    let lastStructured = null;
    let lastReport = null;

    function log(msg) {
        logEl.textContent += (logEl.textContent.endsWith("여기에 진행 상황과 결과 요약이 표시됩니다.") ? "" : "\n") + msg;
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

    function renderStats(report) {
        statsEl.style.display = "grid";
        document.getElementById("stat-total").textContent = report.totalNodes.toLocaleString("ko-KR");
        document.getElementById("stat-raw").textContent = `${(report.rawRatio * 100).toFixed(1)}% (${report.rawNodes})`;
        document.getElementById("stat-low").textContent = `${(report.lowConfidenceRatio * 100).toFixed(1)}% (${report.lowConfidenceNodes})`;
        document.getElementById("stat-triggers").textContent = String(report.unknownTriggers.length);
    }

    async function loadIdentitiesData() {
        if (fileInput.files && fileInput.files[0]) {
            log(`선택한 파일 "${fileInput.files[0].name}"을(를) 읽는 중...`);
            const text = await fileInput.files[0].text();
            return JSON.parse(text);
        }
        log("기본 경로 /js/limbus/data/identities.json 을(를) fetch로 불러오는 중...");
        const res = await fetch("/js/limbus/data/identities.json");
        if (!res.ok) throw new Error(`identities.json 로드 실패 (HTTP ${res.status})`);
        return res.json();
    }

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
            const data = await loadIdentitiesData();
            const identityCount = Object.keys(data).length;
            log(`인격 ${identityCount}종 로드 완료. 변환 시작...`);

            const { structured, report } = LimbusConverterCore.convertAll(data);
            lastStructured = structured;
            lastReport = report;

            log(`변환 완료.`);
            log(`총 노드 ${report.totalNodes}개 중 raw 폴백 ${report.rawNodes}개 (${(report.rawRatio * 100).toFixed(1)}%)`);
            log(`저신뢰(low/none) 노드 ${report.lowConfidenceNodes}개 (${(report.lowConfidenceRatio * 100).toFixed(1)}%)`);
            if (report.unknownTriggers.length) {
                log(`LIMBUS_TRIGGERS 목록 밖 트리거 후보 ${report.unknownTriggers.length}개:`);
                log(report.unknownTriggers.map((t) => `  - ${t}`).join("\n"));
            }

            renderStats(report);
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
        if (lastStructured) download("identities.structured.json", lastStructured);
    });
    btnDlReport.addEventListener("click", () => {
        if (lastReport) download("identities.structured.report.json", lastReport);
    });
})();