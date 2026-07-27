// ════════════════════════════════════════════════
// 이메일 인증 완료 페이지
// Supabase 인증 메일 링크는 서버(Supabase Auth)에서 먼저 토큰을 검증한 뒤
// 이 페이지로 리다이렉트한다. 성공 시 세션 토큰이(또는 code가) URL에 담겨 오고,
// 실패(만료/재사용 등) 시에는 ?error=...&error_description=... 형태로 온다.
// 아래 supabase 클라이언트는 detectSessionInUrl(기본 true)로 URL의 토큰/code를
// 자동으로 처리해 세션을 저장해준다 — 그래야 이후 페이지 이동 시 로그인 상태가 유지된다.
// ════════════════════════════════════════════════
const SUPABASE_URL = 'https://uzokrwwzksgunrcdjlug.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6b2tyd3d6a3NndW5yY2RqbHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ3OTMsImV4cCI6MjA5NDA4MDc5M30.WZcxh7bhpILqed15vnBof-E1LXkAEXLdxO2UY43iYJU';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function _showState(id) {
    ['confirm-loading', 'confirm-ok', 'confirm-fail'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = (s === id) ? '' : 'none';
    });
}

function _readErrorFromUrl() {
    const hash  = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search);
    const error = hash.get('error') || query.get('error');
    const description = hash.get('error_description') || query.get('error_description');
    if (!error) return null;
    return description ? decodeURIComponent(description.replace(/\+/g, ' ')) : '링크가 만료되었거나 이미 사용되었을 수 있어요.';
}

function _init() {
    const errorDetail = _readErrorFromUrl();
    if (errorDetail) {
        const detailEl = document.getElementById('confirm-fail-detail');
        if (detailEl) detailEl.textContent = errorDetail;
        _showState('confirm-fail');
        return;
    }
    // 에러 파라미터가 없으면 Supabase 서버 단계의 검증은 이미 통과한 것 — 성공으로 표시.
    _showState('confirm-ok');
}

_init();