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
        this._renderSkeleton();
        UI.showAreaLoading('editorHome', I18n.t("j_loading_my_songs"));

        const user = await CloudAuth.getUser();
        if (!user) {
            UI.hideAreaLoading('editorHome');
            this._renderMessage(I18n.t("j_after_logging_in_songs_saved"));
            return;
        }

        // "내 노래"(owner)와 "공유받은 노래"(editor/viewer 멤버)를 병렬로 받아온다.
        const [{ data, error }, { data: shared, error: sharedError }] = await Promise.all([
            CloudCharts.listMySongs(),
            CloudCharts.listSharedSongs(),
        ]);
        UI.hideAreaLoading('editorHome');
        if (error) {
            this._renderMessage(I18n.t("j_failed_to_load", {a: error.message}));
            return;
        }
        if (sharedError) console.warn('listSharedSongs 오류:', sharedError.message);

        if ((!data || data.length === 0) && (!shared || shared.length === 0)) {
            this._renderMessage(I18n.t("j_you_haven_t_uploaded_any"));
            return;
        }

        this._renderList(data || [], shared || []);
    },

    // 목록 새로고침 (collab.js에서 멤버 나가기 등으로 목록이 바뀌었을 때 호출)
    async renderHome() {
        await this.refresh();
    },

    // 목록을 받아오는 동안 카드 자리를 어렴풋이 보여주는 자리 채움(반짝임).
    // "무엇을 불러오는 중인지"는 좌측 game-area 오버레이(UI.showAreaLoading)가 담당한다.
    _renderSkeleton() {
        const container = DOM.editorHome.songList;
        if (!container) return;
        container.innerHTML = UI.listSkeletonHtml();
    },

    // 로그인 안내/빈 목록/에러처럼 로딩이 아닌 상태 문구.
    _renderMessage(text) {
        const container = DOM.editorHome.songList;
        if (!container) return;
        container.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'text-gray-400 text-sm text-center mt-8';
        p.textContent = text;
        container.appendChild(p);
    },

    _renderList(songs, sharedSongs = []) {
        const container = DOM.editorHome.songList;
        if (!container) return;
        container.innerHTML = '';

        if (songs.length === 0 && sharedSongs.length > 0) {
            const p = document.createElement('p');
            p.className = 'text-gray-400 text-sm text-center mt-2 mb-2';
            p.textContent = I18n.t("j_you_haven_t_uploaded_any_2");
            container.appendChild(p);
        } else {
            songs.forEach(song => {
                // 내가 소유한 노래이므로 myRole은 항상 'owner'.
                container.appendChild(this._makeSongCard(song, 'owner', song.owner_id || null));
            });
        }

        if (sharedSongs.length > 0) {
            const header = document.createElement('h3');
            header.className = 'text-sm font-semibold text-gray-300 mt-4 mb-2';
            header.replaceChildren(Icon.el('handshake'), I18n.t("j_shared_with_me"));
            container.appendChild(header);

            sharedSongs.forEach(song => {
                container.appendChild(this._makeSongCard(song, song.myRole, song.owner_id));
            });
        }
    },

    // songId를 여는 카드 하나 + (owner/editor일 때) 👥 공동 작업 버튼을 만든다.
    _makeSongCard(song, myRole, ownerId) {
        const card = document.createElement('div');
        card.className = 'w-full text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'flex-1 min-w-0 text-left';

        const title = document.createElement('p');
        title.className = 'font-semibold truncate';
        title.textContent = song.title || I18n.t("j_untitled");

        const meta = document.createElement('p');
        meta.className = 'text-xs text-gray-400';
        meta.append(
            I18n.t("j_difficulties", {a: song.artist || '—', b: song.beatmapCount}),
            Icon.el(song.is_public ? 'globe' : 'lock'),
            song.is_public ? I18n.t("j_public") : I18n.t("j_private_saved_on_server")
        );
        if (myRole === 'editor') meta.append(' · ', Icon.el('pencil'), I18n.t("j_editor_3"));
        else if (myRole === 'viewer') meta.append(' · ', Icon.el('eye'), I18n.t("j_viewer_3"));

        openBtn.append(title, meta);
        openBtn.addEventListener('click', () => this.open(song.id));
        card.appendChild(openBtn);

        // 공동 작업 버튼: owner/editor는 모달을 열 수 있고(초대 폼은 owner만 보임),
        // viewer는 배지만 표시(모달을 열어도 멤버 목록만 읽기전용으로 보임 — collab.js가 처리).
        const collabBtn = document.createElement('button');
        collabBtn.type = 'button';
        collabBtn.className = 'flex-shrink-0 py-1.5 px-2 bg-gray-700 hover:bg-gray-600 rounded text-xs';
        collabBtn.replaceChildren(Icon.el('users'), myRole === 'owner' ? I18n.t("j_collaboration_2")
            : myRole === 'editor' ? I18n.t("j_joined_as_editor")
            : I18n.t("j_joined_as_viewer"));
        collabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSongCollabModal(song.id, song.title || I18n.t("j_untitled"), ownerId || song.owner_id, myRole);
        });
        card.appendChild(collabBtn);

        return card;
    },

    async open(songId) {
        if (Editor.state.beatmaps.length > 0 &&
            !confirm(I18n.t("j_you_are_currently_working_on"))) {
            return;
        }

        this._renderMessage(I18n.t("j_loading_song_info"), true);

        const { data, error } = await CloudCharts.getSongWithBeatmaps(songId);
        if (error) {
            this._renderMessage(I18n.t("j_failed_to_load", {a: error.message}));
            return;
        }

        // 공동 작업 도입: 이 노래에서 내 역할을 같이 받아와 편집 화면의 읽기전용 여부를 결정한다.
        const myRole = await CloudCharts.getMyRoleForSong(songId);

        Editor.resetSongState();
        Editor.applySongData(data);
        Editor.state.song.ownerId = data.song.owner_id;
        Editor.state.song.myRole = myRole;
        Editor.state.activeBeatmapIndex = 0;

        UI.showScreen('editorSong');
        EditorSong.render();

        UI.showMessage('editorSong', I18n.t("j_song_loaded"));
    },
};