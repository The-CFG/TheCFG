// ════════════════════════════════════════════════════════
//  state.js — 전역 상태 + Undo/Redo
// ════════════════════════════════════════════════════════

// ── 프로젝트 구조 ────────────────────────────────────────
// appState.project.files 키 = 경로 (예: 'common/national_focus/GEN_focus.txt')
// 값 = { type, ...파일별 데이터 }
//   type 'national_focus' : { settings:{}, focuses:{} }
//   type 'localisation'   : { lang:'', data:{} }

const appState = {
    _dirty: false,
    get isDirty() { return this._dirty; },
    set isDirty(val) {
        this._dirty = val;
        const titleEl = document.getElementById('explorer-project-name');
        if (titleEl) titleEl.textContent =
            (this.project.name || '새 프로젝트') + (val ? ' *' : '');
    },

    // ── 현재 프로젝트 ──────────────────────────────────
    project: {
        name: '',       // 모드명 (= ZIP 루트 폴더명)
        files: {}       // { 'path/to/file': fileObject }
    },

    // ── 현재 열린 파일 경로 ────────────────────────────
    currentFile: null,

    // ── 중점 편집기 전용 임시 상태 (파일 열릴 때 세팅) ──
    selectedFocusId: null,

    // ── 공유 프로젝트 상태 ────────────────────────────
    // 내 프로젝트면 null, 공유받은 프로젝트면 { ownerUserId, myRole }
    sharedProject: null,
};

// ── 공유 상태 헬퍼 ──────────────────────────────────────
function isReadOnly() {
    return appState.sharedProject?.myRole === 'viewer';
}
function isOwner() {
    return appState.sharedProject === null;
}

// ── 현재 파일 데이터 헬퍼 ───────────────────────────────
function currentFileData() {
    return appState.currentFile
        ? appState.project.files[appState.currentFile]
        : null;
}

// ── 빈 파일 객체 생성 ───────────────────────────────────
function makeNationalFocusFile(countryTag = 'GEN') {
    return {
        type: 'national_focus',
        settings: {
            treeId: `${countryTag}_focus`,
            countryTag,
            defaultTree: false,
            sharedFocuses: [],
            continuousFocusPosition: false,
            continuousX: 50,
            continuousY: 2740,
            resetOnCivilwar: true,
            initialShowX: 0,
            initialShowY: 0,
        },
        focuses: {}
    };
}

function makeIdeasFile() {
    return {
        type: 'ideas',
        categories: {
            country: {
                _attrs: { law: false, designer: false, use_list_view: false },
                ideas: {}
            }
        }
    };
}

function makeLocalisationFile(lang = 'english') {
    return { type: 'localisation', lang, data: {} };
}

// ── Undo / Redo (파일 단위) ──────────────────────────────
const MAX_HISTORY = 50;
let _history      = [];
let _historyIndex = -1;

function saveSnapshot(label = '') {
    if (!appState.currentFile) return;
    _history.splice(_historyIndex + 1);
    _history.push({
        label,
        path: appState.currentFile,
        fileData: JSON.parse(JSON.stringify(currentFileData()))
    });
    if (_history.length > MAX_HISTORY) _history.shift();
    _historyIndex = _history.length - 1;
    _updateUndoRedoButtons();
}

function undo() {
    if (_historyIndex <= 0) return;
    _historyIndex--;
    _applySnapshot(_history[_historyIndex]);
}

function redo() {
    if (_historyIndex >= _history.length - 1) return;
    _historyIndex++;
    _applySnapshot(_history[_historyIndex]);
}

function _applySnapshot(snap) {
    if (!appState.project.files[snap.path]) return;
    appState.project.files[snap.path] = JSON.parse(JSON.stringify(snap.fileData));
    appState.isDirty = true;
    // 열린 파일과 같은 경우만 화면 갱신
    if (appState.currentFile === snap.path) refreshCurrentEditor();
    _updateUndoRedoButtons();
}

function resetHistory() {
    _history = [];
    _historyIndex = -1;
    _updateUndoRedoButtons();
}

function _updateUndoRedoButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) {
        btnUndo.disabled = _historyIndex <= 0;
        btnUndo.title = _history[_historyIndex - 1]?.label
            ? `실행 취소: ${_history[_historyIndex - 1].label}` : '실행 취소 (Ctrl+Z)';
    }
    if (btnRedo) {
        btnRedo.disabled = _historyIndex >= _history.length - 1;
        btnRedo.title = _history[_historyIndex + 1]?.label
            ? `다시 실행: ${_history[_historyIndex + 1].label}` : '다시 실행 (Ctrl+Y)';
    }
}

// refreshCurrentEditor는 main.js에서 정의 (순환 참조 방지를 위해 지연 호출)
function refreshCurrentEditor() {
    const fd = currentFileData();
    if (!fd) return;
    if (fd.type === 'national_focus') renderFocusTree?.();
    if (fd.type === 'localisation')   renderLocalisationList?.();
    if (fd.type === 'ideas')          renderIdeasEditor?.();
}
// ── 로컬라이징 캐시 ─────────────────────────────────────
// key → name의 단일 Map. localisation 데이터가 바뀔 때마다
// invalidateLocCache()를 호출해 재빌드 예약.
let _locCache = null;

function invalidateLocCache() {
    _locCache = null;
}

function _buildLocCache() {
    const files = appState.project?.files;
    if (!files) return new Map();

    const cache = new Map();
    const PRIORITY = ['localisation/english', 'localisation/korean'];

    // 우선순위 언어 먼저 (낮은 우선순위가 덮어쓰지 않도록 set 전에 체크)
    for (const prefix of PRIORITY) {
        for (const [path, fd] of Object.entries(files)) {
            if (fd?.type !== 'localisation') continue;
            if (!path.startsWith(prefix)) continue;
            for (const [k, entry] of Object.entries(fd.data || {})) {
                if (cache.has(k)) continue;
                const name = typeof entry === 'object' ? entry.name : entry;
                if (name) cache.set(k, name);
            }
        }
    }

    // 나머지 언어
    for (const [, fd] of Object.entries(files)) {
        if (fd?.type !== 'localisation') continue;
        for (const [k, entry] of Object.entries(fd.data || {})) {
            if (cache.has(k)) continue;
            const name = typeof entry === 'object' ? entry.name : entry;
            if (name) cache.set(k, name);
        }
    }

    return cache;
}

// ── 로컬라이징 조회 헬퍼 ────────────────────────────────
function getLocalisedName(key) {
    if (!key) return '';
    if (!_locCache) _locCache = _buildLocCache();
    return _locCache.get(key) || '';
}

// ── GFX 스프라이트 조회 캐시 ─────────────────────────────
// sprite name(예: GFX_idea_xxx) → texturefile 경로의 Map.
// 프로젝트 내 모든 gfx_define 파일을 순회해 구축.
let _gfxSpriteCache = null;

function invalidateGfxSpriteCache() {
    _gfxSpriteCache = null;
}

function _buildGfxSpriteCache() {
    const files = appState.project?.files;
    const cache = new Map();
    if (!files) return cache;

    for (const fd of Object.values(files)) {
        if (fd?.type !== 'gfx_define') continue;
        for (const sprite of fd.sprites || []) {
            if (sprite?.name && !cache.has(sprite.name)) {
                cache.set(sprite.name, sprite.texturefile);
            }
        }
    }
    return cache;
}

// sprite name으로 texturefile 문자열을 찾음 (없으면 null)
function getTexturefileBySpriteName(name) {
    if (!name) return null;
    if (!_gfxSpriteCache) _gfxSpriteCache = _buildGfxSpriteCache();
    return _gfxSpriteCache.get(name) || null;
}