// ════════════════════════════════════════════════
// TheCFG 프로필 화면 (/profiles 전용)
// hoi4/beat와 같은 Supabase 프로젝트(URL/KEY)를 사용하지만,
// 이 파일은 홈페이지 전용 독립 사본입니다 (다른 페이지의 js와 공유하지 않음).
// ════════════════════════════════════════════════
const SUPABASE_URL = 'https://uzokrwwzksgunrcdjlug.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6b2tyd3d6a3NndW5yY2RqbHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ3OTMsImV4cCI6MjA5NDA4MDc5M30.WZcxh7bhpILqed15vnBof-E1LXkAEXLdxO2UY43iYJU';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ProfileData = {
    // 아이디 → user_id
    async resolveHandle(handle) {
        const { data, error } = await _supabase.rpc('get_user_id_by_handle', { p_handle: handle });
        if (error) { console.warn('resolveHandle 오류:', error.message); return null; }
        return data || null;
    },

    // 헤더 (닉네임/아이디/가입일)
    async getHeader(userId) {
        const { data, error } = await _supabase.rpc('get_profile_header', { p_user_id: userId });
        if (error) { console.warn('getHeader 오류:', error.message); return null; }
        return data?.[0] || null;
    },

    // TheBeat 탭 — RLS가 이미 공개 조회를 허용하므로 직접 쿼리
    // (단, "최고 난이도"는 조인된 컬럼 기준 정렬이 필요해 PostgREST 임베디드 order로
    //  표현이 안 되므로 get_profile_beat_highest RPC를 사용)
    async getBeatSummary(userId) {
        const [recent, highest, created] = await Promise.all([
            _supabase
                .from('beat_scores')
                .select('achieved_at, score, accuracy, beat_charts(title, difficulty_label, difficulty_score)')
                .eq('user_id', userId)
                .order('achieved_at', { ascending: false })
                .limit(1),
            _supabase.rpc('get_profile_beat_highest', { p_user_id: userId }),
            _supabase
                .from('beat_charts')
                .select('id, title, difficulty_label, difficulty_score, play_count')
                .eq('owner_id', userId)
                .order('created_at', { ascending: false })
                .limit(10),
        ]);

        if (recent.error)  console.warn('getBeatSummary(recent) 오류:', recent.error.message);
        if (highest.error) console.warn('getBeatSummary(highest) 오류:', highest.error.message);
        if (created.error) console.warn('getBeatSummary(created) 오류:', created.error.message);

        return {
            recent:  recent.data?.[0]  || null,
            highest: highest.data?.[0] || null,
            created: created.data      || [],
        };
    },

    // HOI4 탭 — RLS가 본인/당사자로 제한되어 있어 definer RPC로 우회 (이름만 반환)
    async getHoi4Summary(userId) {
        const [own, collab] = await Promise.all([
            _supabase.rpc('get_profile_own_projects', { p_user_id: userId }),
            _supabase.rpc('get_profile_collab_projects', { p_user_id: userId }),
        ]);

        if (own.error)    console.warn('getHoi4Summary(own) 오류:', own.error.message);
        if (collab.error) console.warn('getHoi4Summary(collab) 오류:', collab.error.message);

        return {
            own:    own.data    || [],
            collab: collab.data || [],
        };
    },
};

// ════════════════════════════════════════════════
// UI
// ════════════════════════════════════════════════

function _show(el) { if (el) el.style.display = ''; }
function _hide(el) { if (el) el.style.display = 'none'; }

function _esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
}

function _showEmpty(text) {
    _hide(document.getElementById('profile-loading'));
    _hide(document.getElementById('profile-content'));
    document.getElementById('profile-empty-text').textContent = text;
    _show(document.getElementById('profile-empty'));
}

function _renderHeader(header) {
    document.getElementById('profile-nickname').textContent = header.nickname || '(닉네임 없음)';
    document.getElementById('profile-handle').textContent   = header.handle ? `@${header.handle}` : '';
    document.getElementById('profile-avatar-initial').textContent =
        (header.nickname || header.handle || '?').trim().charAt(0).toUpperCase();

    const joined = header.created_at ? new Date(header.created_at) : null;
    document.getElementById('profile-joined').textContent = joined
        ? `${joined.getFullYear()}년 ${joined.getMonth() + 1}월 가입`
        : '';
}

function _chartLine(chart) {
    if (!chart) return null;
    const label = chart.difficulty_label ? ` · ${_esc(chart.difficulty_label)}` : '';
    const score = chart.difficulty_score != null ? ` (${chart.difficulty_score.toFixed(2)})` : '';
    return `${_esc(chart.title)}${label}${score}`;
}

function _renderBeatTab({ recent, highest, created }) {
    const recentEl  = document.getElementById('beat-recent');
    const highestEl = document.getElementById('beat-highest');
    const createdEl = document.getElementById('beat-created');

    if (recent?.beat_charts) {
        recentEl.textContent = _chartLine(recent.beat_charts);
        recentEl.classList.remove('profile-card-empty');
    } else {
        recentEl.textContent = '아직 플레이 기록이 없습니다.';
    }

    if (highest) {
        highestEl.textContent = _chartLine(highest);
        highestEl.classList.remove('profile-card-empty');
    } else {
        highestEl.textContent = '아직 플레이 기록이 없습니다.';
    }

    if (created.length) {
        createdEl.classList.remove('profile-card-empty');
        createdEl.innerHTML = `<ul class="profile-item-list">${created.map(c => `
            <li>${_esc(c.title)}${c.difficulty_label ? ` <span class="profile-item-meta">· ${_esc(c.difficulty_label)}</span>` : ''}</li>
        `).join('')}</ul>`;
    } else {
        createdEl.textContent = '만든 난이도가 없습니다.';
    }
}

function _renderHoi4Tab({ own, collab }) {
    const ownEl    = document.getElementById('hoi4-own');
    const collabEl = document.getElementById('hoi4-collab');

    if (own.length) {
        ownEl.classList.remove('profile-card-empty');
        ownEl.innerHTML = `<ul class="profile-item-list">${own.map(p => `<li>${_esc(p.name)}</li>`).join('')}</ul>`;
    } else {
        ownEl.textContent = '프로젝트가 없습니다.';
    }

    if (collab.length) {
        collabEl.classList.remove('profile-card-empty');
        collabEl.innerHTML = `<ul class="profile-item-list">${collab.map(p => `<li>${_esc(p.project_name)}</li>`).join('')}</ul>`;
    } else {
        collabEl.textContent = '공동 작업 중인 프로젝트가 없습니다.';
    }
}

function _setupTabs(userId) {
    const tabBeat   = document.getElementById('tab-beat');
    const tabHoi4   = document.getElementById('tab-hoi4');
    const panelBeat = document.getElementById('panel-beat');
    const panelHoi4 = document.getElementById('panel-hoi4');

    let hoi4Loaded = false;

    tabBeat.addEventListener('click', () => {
        tabBeat.classList.add('is-active');
        tabHoi4.classList.remove('is-active');
        tabBeat.setAttribute('aria-selected', 'true');
        tabHoi4.setAttribute('aria-selected', 'false');
        _show(panelBeat);
        _hide(panelHoi4);
    });

    tabHoi4.addEventListener('click', async () => {
        tabHoi4.classList.add('is-active');
        tabBeat.classList.remove('is-active');
        tabHoi4.setAttribute('aria-selected', 'true');
        tabBeat.setAttribute('aria-selected', 'false');
        _hide(panelBeat);
        _show(panelHoi4);

        if (!hoi4Loaded) {
            hoi4Loaded = true;
            const summary = await ProfileData.getHoi4Summary(userId);
            _renderHoi4Tab(summary);
        }
    });
}

async function _loadProfile(handle) {
    const userId = await ProfileData.resolveHandle(handle);
    if (!userId) { _showEmpty('존재하지 않는 프로필입니다.'); return; }

    const header = await ProfileData.getHeader(userId);
    if (!header) { _showEmpty('프로필 정보를 불러올 수 없습니다.'); return; }

    _renderHeader(header);
    _setupTabs(userId);

    _hide(document.getElementById('profile-loading'));
    _show(document.getElementById('profile-content'));

    const beatSummary = await ProfileData.getBeatSummary(userId);
    _renderBeatTab(beatSummary);
}

async function _init() {
    const params = new URLSearchParams(location.search);
    const handle = params.get('u');

    if (handle) {
        await _loadProfile(handle);
        return;
    }

    // ?u= 없이 들어온 경우 — 로그인 상태면 본인 프로필로, 아니면 안내만
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) { _showEmpty('프로필을 보려면 주소에 ?u=아이디를 붙여주세요.'); return; }

    const { data: profile } = await _supabase
        .from('user_profiles')
        .select('handle')
        .eq('user_id', user.id)
        .single();

    if (profile?.handle) {
        location.replace(`/profiles?u=${encodeURIComponent(profile.handle)}`);
    } else {
        _showEmpty('아직 아이디가 설정되지 않았습니다. 계정 설정에서 먼저 아이디를 등록해주세요.');
    }
}

_init();