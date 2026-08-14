/**
 * EditorHome
 * ----------
 * 에디터 홈 화면(editor-home-screen)의 "내 노래" 목록을 다룬다.
 *
 * - refresh(): CloudCharts.listMySongs()로 로그인한 사용자의 beat_songs 목록을 받아와 그린다.
 * - open(songId): CloudCharts.getSongWithBeatmaps()로 노래+난이도 "메타"를 받아 종합 창으로 진입시킨다.
 *   난이도의 notes/triggers는 여기서 받아오지 않는다(getSongWithBeatmaps 자체가 메타만 줌) —
 *   각 난이도는 _loaded: false로 표시해두고, 실제 편집/복제/전체저장 시점에
 *   Editor.ensureBeatmapLoaded()가 그때그때 CloudCharts.downloadChartData()로 받아온다.
 *   오디오도 마찬가지로 이 화면에서는 안 받아온다 — 기존 CloudLoadModal(단일 차트 불러오기)과
 *   동일하게 "오디오 파일을 다시 선택해주세요" 안내만 하고, 재생/편집 시 로컬 파일로 다시 골라야 한다.
 */
const EditorHome = {
    async refresh() {
        this._renderMessage('불러오는 중…', true);

        const user = await CloudAuth.getUser();
        if (!user) {
            this._renderMessage('로그인 후 클라우드에 저장된 노래가 여기 표시됩니다.');
            return;
        }

        const { data, error } = await CloudCharts.listMySongs();
        if (error) {
            this._renderMessage(`불러오기 실패: ${error.message}`);
            return;
        }
        if (!data || data.length === 0) {
            this._renderMessage('아직 업로드한 노래가 없습니다. "+ 새 노래 만들기"로 시작해보세요.');
            return;
        }

        this._renderList(data);
    },

    // spinner: true면 문구 위에 로딩 서클을 같이 보여준다 ("불러오는 중" 류 상태 전용,
    // 로그인 안내/빈 목록/에러 메시지처럼 로딩이 아닌 문구는 스피너 없이 그대로 텍스트로 표시).
    _renderMessage(text, spinner = false) {
        const container = DOM.editorHome.songList;
        if (!container) return;
        container.innerHTML = '';
        if (spinner) {
            container.innerHTML = UI.loadingBlockHtml(text);
            return;
        }
        const p = document.createElement('p');
        p.className = 'text-gray-400 text-sm text-center mt-8';
        p.textContent = text;
        container.appendChild(p);
    },

    _renderList(songs) {
        const container = DOM.editorHome.songList;
        if (!container) return;
        container.innerHTML = '';

        songs.forEach(song => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'w-full text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg';

            const title = document.createElement('p');
            title.className = 'font-semibold truncate';
            title.textContent = song.title || '(제목 없음)';

            const meta = document.createElement('p');
            meta.className = 'text-xs text-gray-400';
            meta.textContent = `${song.artist || '—'} · 난이도 ${song.beatmapCount}개`;

            card.append(title, meta);
            card.addEventListener('click', () => this.open(song.id));
            container.appendChild(card);
        });
    },

    async open(songId) {
        if (Editor.state.beatmaps.length > 0 &&
            !confirm('현재 작업 중인 노래가 있습니다. 클라우드 노래를 열면 저장하지 않은 내용은 사라집니다. 계속할까요?')) {
            return;
        }

        this._renderMessage('노래 정보를 불러오는 중…', true);

        const { data, error } = await CloudCharts.getSongWithBeatmaps(songId);
        if (error) {
            this._renderMessage(`불러오기 실패: ${error.message}`);
            return;
        }

        Editor.resetSongState();
        Editor.state.song.title = data.song.title || '';
        Editor.state.song.artist = data.song.artist || '';
        Editor.state.song.cloudSongId = data.song.id;
        Editor.state.song.previewStartSec = (data.song.preview_start_ms || 0) / 1000;
        Editor.state.song.startOffsetSec = (data.song.start_offset_ms || 0) / 1000;
        Editor.state.song.timingStartSec = (data.song.timing_start_ms || 0) / 1000;
        // 오디오/커버는 서버에 이미 올라가 있으므로 다시 고를 필요 없이 URL로 자동 로드한다.
        // (실제 디코딩은 비트맵 창 진입 시 Editor.loadAudioFromUrl에서 이뤄진다 — 게임 플레이 화면과 동일한 방식)
        Editor.state.song.audioFileObject = null;
        Editor.state.song.audioFileName = (data.song.audio_storage_path || '').split('/').pop() || '';
        Editor.state.song.audioUrl = data.song.audio_storage_path
            ? CloudCharts.getAudioUrl(data.song.audio_storage_path)
            : null;
        Editor.state.song.coverFileObject = null;
        Editor.state.song.coverFileName = (data.song.cover_storage_path || '').split('/').pop() || '';
        Editor.state.song.coverUrl = data.song.cover_storage_path
            ? CloudCharts.getCoverUrl(data.song.cover_storage_path)
            : null;

        Editor.state.beatmaps = data.beatmaps.map(bm => ({
            difficultyLabel: bm.difficulty_label || '기본',
            laneCount: bm.lane_count || 4,
            bpm: bm.bpm || 120,
            startTimeOffset: 0,
            notes: [],
            triggers: [],
            cloudChartId: bm.id,
            chartStoragePath: bm.chart_storage_path,
            updatedAt: bm.updated_at || null,
            _loaded: false, // 편집/복제/전체저장 시점에 Editor.ensureBeatmapLoaded()가 채운다
        }));
        Editor.state.activeBeatmapIndex = 0;

        UI.showScreen('editorSong');
        EditorSong.render();

        UI.showMessage('editorSong', '노래를 불러왔습니다.');
    },
};