// ── 전체 유저 채보 별점 일괄 재계산 (관리자용, Node.js 스크립트) ─────────────
//
// 브라우저 콘솔 스크립트(backfill-difficulty.js)는 owner 체크 때문에
// 본인 채보만 고칠 수 있음. 이 스크립트는 service_role 키로 RLS를 우회해서
// 전체 유저의 beat_charts를 대상으로 함.
//
// ⚠ service_role 키는 DB 전체 권한을 가진 비밀키입니다.
//    - 절대 git에 커밋하거나 클라이언트/브라우저 코드에 넣지 마세요.
//    - Supabase 대시보드 > Project Settings > API > service_role secret 에서 확인.
//    - 이 스크립트는 로컬/서버에서만, 실행 후 키는 폐기(또는 필요시 재발급)하는 걸 권장.
//
// 준비:
//   1) 아무 폴더에 이 파일 + difficulty.js(수정본)를 같은 위치에 둔다.
//   2) npm init -y && npm install @supabase/supabase-js
//   3) 터미널에서: SUPABASE_SERVICE_ROLE_KEY=여기에_키_붙여넣기 node backfill-all-users.js
//      (Windows PowerShell이면: $env:SUPABASE_SERVICE_ROLE_KEY="키"; node backfill-all-users.js)
//
// 안전장치:
//   - 기본값은 DRY_RUN=true → 실제 DB 업데이트 없이 "무엇이 바뀔지"만 로그로 보여줌.
//   - 결과 확인 후 DRY_RUN=false로 바꿔서 실제 반영.
//   - ONLY_UNRATED=true → difficulty_score가 null인 것만 (기본, 안전).
//     예전 알고리즘으로 계산된 것까지 전부 다시 하려면 false로.

const { createClient } = require('@supabase/supabase-js');
const Difficulty = require('./difficulty.js');

const SUPABASE_URL = 'https://uzokrwwzksgunrcdjlug.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'beat-files';
const DRY_RUN = false;
const ONLY_UNRATED = false;
const DELAY_MS = 150;

if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 없습니다. 실행 방법 주석을 참고하세요.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    let query = supabase
        .from('beat_charts')
        .select('id, owner_id, title, difficulty_label, difficulty_score, chart_storage_path');
    if (ONLY_UNRATED) query = query.is('difficulty_score', null);

    const { data: charts, error } = await query;
    if (error) { console.error('목록 조회 실패:', error); process.exit(1); }
    if (!charts || charts.length === 0) {
        console.log(ONLY_UNRATED ? '레이팅이 안 된 채보가 없습니다.' : '채보가 없습니다.');
        return;
    }

    console.log(`대상 채보 ${charts.length}개 (DRY_RUN=${DRY_RUN}, ONLY_UNRATED=${ONLY_UNRATED})`);
    let ok = 0, fail = 0, skip = 0;

    for (const c of charts) {
        const label = `${c.title || c.difficulty_label || c.id} [owner:${c.owner_id}]`;
        if (!c.chart_storage_path) {
            console.warn(`⚠ ${label}: chart_storage_path 없음 — 스킵`);
            skip++;
            continue;
        }
        try {
            const { data: fileData, error: dlErr } = await supabase.storage
                .from(BUCKET)
                .download(c.chart_storage_path);
            if (dlErr || !fileData) {
                console.warn(`✗ ${label}: 다운로드 실패`, dlErr);
                fail++;
                continue;
            }
            const text = await fileData.text();
            const chartData = JSON.parse(text);
            const noteCount = Array.isArray(chartData.notes)
                ? chartData.notes.filter((n) => n.type !== 'long_tail').length
                : 0;
            const newScore = Difficulty.calculate(chartData);

            if (DRY_RUN) {
                console.log(`(dry-run) ${label}: 기존=${c.difficulty_score} → 신규=${newScore} (note_count=${noteCount})`);
            } else {
                const { error: upErr } = await supabase
                    .from('beat_charts')
                    .update({ difficulty_score: newScore, note_count: noteCount })
                    .eq('id', c.id);
                if (upErr) {
                    console.warn(`✗ ${label}: 업데이트 실패`, upErr);
                    fail++;
                    continue;
                }
                console.log(`✓ ${label}: score=${newScore}`);
            }
            ok++;
        } catch (e) {
            console.error(`✗ ${label}: 예외 발생`, e);
            fail++;
        }
        await sleep(DELAY_MS);
    }

    console.log(`완료: 성공 ${ok} / 실패 ${fail} / 스킵 ${skip} / 총 ${charts.length}`);
    if (DRY_RUN) console.log('→ DRY_RUN 모드였습니다. 결과가 맞으면 DRY_RUN=false로 바꿔서 다시 실행하세요.');
})();
