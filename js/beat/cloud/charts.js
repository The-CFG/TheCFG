// ── CloudCharts: 내 차트 업로드 / 수정 / 목록 / 삭제 ──────────────────────
// beat.html 에서 auth.js 다음에 로드된다. _supabase 는 auth.js에서 선언된 전역 변수.

const CloudCharts = {

    // ── 낙관적 잠금(A안) 충돌 판별 ───────────────────────────────────────────
    // update(...).eq('updated_at', expected) 가 0행에 매치되면(=그 사이 다른 사람이 먼저
    // 저장했거나 삭제됨) PostgREST가 .single()에서 "no rows"(PGRST116) 에러를 던진다.
    // 이 경우를 일반 에러와 구분해 { conflict: true }로 정규화한다.
    _isOptimisticLockConflict(error) {
        return !!error && (error.code === 'PGRST116' || /0 rows|no rows|multiple \(or no\) rows/i.test(error.message || ''));
    },

    // ── 공동 작업(A안 다음 단계) — 이 노래에서 내 역할 조회 ───────────────────
    // beat_song_role(_song_id, _user_id) SQL 함수(SECURITY DEFINER)를 그대로 호출.
    // 반환: 'owner' | 'editor' | 'viewer' | null (로그인 안 했거나, 노래가 없거나, 멤버가 아니면 null)
    // addBeatmapToSong/updateBeatmap의 권한 체크와 UI(에디터 홈의 읽기전용 여부 판단)에서 공용으로 쓴다.
    async getMyRoleForSong(songId) {
        const user = await CloudAuth.getUser();
        if (!user) return null;
        const { data, error } = await _supabase.rpc('beat_song_role', { _song_id: songId, _user_id: user.id });
        if (error) { console.warn('getMyRoleForSong 오류:', error.message); return null; }
        return data || null;
    },

    // ── 내 차트 목록 ─────────────────────────────────────────────────────────
    async listMyCharts() {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null, error: new Error('로그인이 필요합니다.') };

        return await _supabase
            .from('beat_charts')
            .select('id, title, artist, bpm, lane_count, difficulty_label, note_count, is_public, play_count, created_at, updated_at, chart_storage_path, audio_storage_path')
            .eq('owner_id', user.id)
            .order('updated_at', { ascending: false });
    },

    // ── 내 차트 단건 상세 (Storage 경로 포함, 공개/비공개 무관) ──────────────
    // "편집" 흐름에서 차트 JSON/오디오를 다시 받아오기 위해 전체 컬럼이 필요하다.
    async getMyChartDetail(chartId) {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null, error: new Error('로그인이 필요합니다.') };

        const { data, error } = await _supabase
            .from('beat_charts')
            .select('*')
            .eq('id', chartId)
            .eq('owner_id', user.id)
            .single();

        return { data, error };
    },

    // ── 차트 업로드 (신규) ────────────────────────────────────────────────────
    // meta: { title, artist, bpm, lane_count, difficulty_label }
    // chartData: Editor에서 넘어오는 JSON 객체
    // audioFile: File 객체
    async uploadChart(meta, chartData, audioFile) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };
        if (!audioFile) return { error: new Error('음악 파일을 선택해주세요.') };

        // 1) 메타 행을 먼저 INSERT해서 chart_id 확보
        const noteCount = Array.isArray(chartData.notes)
            ? chartData.notes.filter(n => n.type !== 'long_tail').length
            : 0;

        const chartId = crypto.randomUUID();
        const basePath = `${user.id}/${chartId}`;
        const audioExt = audioFile.name.split('.').pop().toLowerCase();
        const audioPath = `${basePath}/audio.${audioExt}`;
        const chartPath = `${basePath}/chart.json`;

        // 2) 오디오 업로드
        const { error: audioErr } = await _supabase.storage
            .from('beat-files')
            .upload(audioPath, audioFile, { contentType: audioFile.type || 'audio/mpeg', upsert: false });
        if (audioErr) return { error: audioErr };

        // 3) 차트 JSON 업로드 (Blob)
        const chartBlob = new Blob([JSON.stringify(chartData)], { type: 'application/json' });
        const { error: chartErr } = await _supabase.storage
            .from('beat-files')
            .upload(chartPath, chartBlob, { contentType: 'application/json', upsert: false });
        if (chartErr) {
            // 오디오 롤백
            await _supabase.storage.from('beat-files').remove([audioPath]);
            return { error: chartErr };
        }

        // 4) DB 행 INSERT
        const { data, error: dbErr } = await _supabase
            .from('beat_charts')
            .insert({
                id: chartId,
                owner_id: user.id,
                title: meta.title,
                artist: meta.artist || null,
                bpm: meta.bpm || null,
                lane_count: meta.lane_count || 4,
                difficulty_label: meta.difficulty_label || null,
                note_count: noteCount,
                chart_storage_path: chartPath,
                audio_storage_path: audioPath,
                audio_mime: audioFile.type || 'audio/mpeg',
                is_public: true,
            })
            .select()
            .single();

        if (dbErr) {
            // Storage 롤백
            await _supabase.storage.from('beat-files').remove([audioPath, chartPath]);
            return { error: dbErr };
        }

        return { data };
    },

    // ── 차트 메타 수정 (오디오 / 차트 데이터 교체 포함) ────────────────────
    // audioFile, chartData 는 null 이면 교체 안 함
    async updateChart(chartId, meta, chartData = null, audioFile = null) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        // 기존 행 조회 (경로 확인용)
        const { data: existing, error: fetchErr } = await _supabase
            .from('beat_charts')
            .select('chart_storage_path, audio_storage_path, owner_id')
            .eq('id', chartId)
            .single();
        if (fetchErr) return { error: fetchErr };
        if (existing.owner_id !== user.id) return { error: new Error('권한이 없습니다.') };

        const updates = { ...meta };

        // 차트 JSON 교체
        if (chartData) {
            const chartBlob = new Blob([JSON.stringify(chartData)], { type: 'application/json' });
            const { error: chartErr } = await _supabase.storage
                .from('beat-files')
                .update(existing.chart_storage_path, chartBlob, { contentType: 'application/json', upsert: true });
            if (chartErr) return { error: chartErr };
            updates.note_count = Array.isArray(chartData.notes)
                ? chartData.notes.filter(n => n.type !== 'long_tail').length
                : 0;
        }

        // 오디오 교체
        if (audioFile) {
            const ext = audioFile.name.split('.').pop().toLowerCase();
            const basePath = existing.audio_storage_path.split('/audio.')[0];
            const newAudioPath = `${basePath}/audio.${ext}`;

            // 기존 파일 삭제 후 업로드
            if (existing.audio_storage_path !== newAudioPath) {
                await _supabase.storage.from('beat-files').remove([existing.audio_storage_path]);
            }
            const { error: audioErr } = await _supabase.storage
                .from('beat-files')
                .upload(newAudioPath, audioFile, { contentType: audioFile.type || 'audio/mpeg', upsert: true });
            if (audioErr) return { error: audioErr };
            updates.audio_storage_path = newAudioPath;
            updates.audio_mime = audioFile.type || 'audio/mpeg';
        }

        const { data, error: dbErr } = await _supabase
            .from('beat_charts')
            .update(updates)
            .eq('id', chartId)
            .select()
            .single();

        return { data, error: dbErr };
    },

    // ── 차트 삭제 (Storage + DB) ──────────────────────────────────────────────
    async deleteChart(chartId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { data: existing, error: fetchErr } = await _supabase
            .from('beat_charts')
            .select('chart_storage_path, audio_storage_path, owner_id')
            .eq('id', chartId)
            .single();
        if (fetchErr) return { error: fetchErr };
        if (existing.owner_id !== user.id) return { error: new Error('권한이 없습니다.') };

        // Storage 삭제
        await _supabase.storage.from('beat-files')
            .remove([existing.chart_storage_path, existing.audio_storage_path]);

        // DB 삭제 (cascade로 beat_scores도 삭제됨)
        const { error: dbErr } = await _supabase
            .from('beat_charts')
            .delete()
            .eq('id', chartId);

        return { error: dbErr };
    },

    // ── Storage에서 차트 JSON 다운로드 ────────────────────────────────────────
    async downloadChartData(chartStoragePath) {
        try {
            const { data, error } = await _supabase.storage
                .from('beat-files')
                .download(chartStoragePath);
            if (error) return { error };
            const text = await data.text();
            return { data: JSON.parse(text) };
        } catch (err) {
            return { error: err };
        }
    },

    // ── Storage에서 오디오 공개 URL 가져오기 ──────────────────────────────────
    getAudioUrl(audioStoragePath) {
        const { data } = _supabase.storage
            .from('beat-files')
            .getPublicUrl(audioStoragePath);
        return data.publicUrl;
    },

    // ── Storage에서 커버 이미지 공개 URL 가져오기 ─────────────────────────────
    getCoverUrl(coverStoragePath) {
        if (!coverStoragePath) return null;
        const { data } = _supabase.storage
            .from('beat-files')
            .getPublicUrl(coverStoragePath);
        return data.publicUrl;
    },

    // ════════════════════════════════════════════════════════════════════════
    // Phase 3d: 노래(beat_songs) / 난이도(beat_charts.song_id) 모델
    // 위쪽의 uploadChart/updateChart/listMyCharts/getMyChartDetail은 song_id가 없던
    // 구버전 단일-차트 흐름(CloudLoadModal 등)을 위해 그대로 남겨둔다.
    // ════════════════════════════════════════════════════════════════════════

    // ── 노래 업로드 (신규 beat_songs 행 + 오디오 [+ 커버 이미지]) ────────────
    // meta: { title, artist, preview_start_ms, start_offset_ms, timing_start_ms, is_public }, audioFile: File 객체 (필수),
    // coverFile: File 객체 (선택 — 노래 선택~결과 화면 배경으로 쓰임)
    // is_public: false로 넘기면 공개 라이브러리에는 노출되지 않고 "내 노래" 목록(서버 저장)에만 보인다.
    async uploadSong(meta, audioFile, coverFile) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };
        if (!audioFile) return { error: new Error('음악 파일을 선택해주세요.') };

        const songId = crypto.randomUUID();
        const audioExt = (audioFile.name.split('.').pop() || 'mp3').toLowerCase();
        const audioPath = `${user.id}/songs/${songId}/audio.${audioExt}`;

        const { error: audioErr } = await _supabase.storage
            .from('beat-files')
            .upload(audioPath, audioFile, { contentType: audioFile.type || 'audio/mpeg', upsert: false });
        if (audioErr) return { error: audioErr };

        let coverPath = null;
        if (coverFile) {
            const coverExt = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
            coverPath = `${user.id}/songs/${songId}/cover.${coverExt}`;
            const { error: coverErr } = await _supabase.storage
                .from('beat-files')
                .upload(coverPath, coverFile, { contentType: coverFile.type || 'image/jpeg', upsert: false });
            if (coverErr) {
                await _supabase.storage.from('beat-files').remove([audioPath]);
                return { error: coverErr };
            }
        }

        const { data, error: dbErr } = await _supabase
            .from('beat_songs')
            .insert({
                id: songId,
                owner_id: user.id,
                title: meta.title,
                artist: meta.artist || null,
                preview_start_ms: meta.preview_start_ms || 0,
                start_offset_ms: meta.start_offset_ms || 0,
                timing_start_ms: meta.timing_start_ms || 0,
                audio_storage_path: audioPath,
                audio_mime: audioFile.type || 'audio/mpeg',
                cover_storage_path: coverPath,
                is_public: meta.is_public === true,
            })
            .select()
            .single();

        if (dbErr) {
            const toRemove = coverPath ? [audioPath, coverPath] : [audioPath];
            await _supabase.storage.from('beat-files').remove(toRemove);
            return { error: dbErr };
        }

        return { data };
    },

    // ── 이미 클라우드에 있는 노래의 메타(제목/가수/미리듣기 시각/시작(초)) [+ 커버 이미지] 갱신 ───
    // meta: { title, artist, preview_start_ms, start_offset_ms, timing_start_ms, is_public } — 오디오/난이도는 건드리지 않는다.
    // is_public이 boolean으로 넘어오면 공개 여부도 같이 갱신한다(비공개 저장 ↔ 라이브러리 공개 전환).
    // coverFile: File 객체 (선택 — 넘기면 새 커버로 교체, 안 넘기면 기존 커버 유지)
    // expectedUpdatedAt: 이 노래를 불러온 시점의 updated_at 문자열(낙관적 잠금, A안). 넘기면
    // 그 사이 다른 곳(협업자/다른 탭)에서 먼저 저장된 경우 갱신 없이 { error: { conflict: true } }를 반환한다.
    // 넘기지 않으면(null) 기존과 동일하게 잠금 없이 그냥 덮어쓴다.
    async updateSongMeta(songId, meta, coverFile, expectedUpdatedAt = null) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const updatePayload = {
            title: meta.title,
            artist: meta.artist || null,
            preview_start_ms: meta.preview_start_ms || 0,
            start_offset_ms: meta.start_offset_ms || 0,
            timing_start_ms: meta.timing_start_ms || 0,
        };
        if (typeof meta.is_public === 'boolean') updatePayload.is_public = meta.is_public;

        if (coverFile) {
            const coverExt = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
            const coverPath = `${user.id}/songs/${songId}/cover.${coverExt}`;
            const { error: coverErr } = await _supabase.storage
                .from('beat-files')
                .upload(coverPath, coverFile, { contentType: coverFile.type || 'image/jpeg', upsert: true });
            if (coverErr) return { error: coverErr };
            updatePayload.cover_storage_path = coverPath;
        }

        let query = _supabase
            .from('beat_songs')
            .update(updatePayload)
            .eq('id', songId)
            .eq('owner_id', user.id);
        if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);

        const { data, error } = await query.select().single();

        if (error && expectedUpdatedAt && this._isOptimisticLockConflict(error)) {
            return { error: { conflict: true, message: '다른 곳에서 이 사이 먼저 저장했습니다.' } };
        }
        return { data, error };
    },

    // ── 기존 노래에 난이도(beatmap) 하나 추가 ───────────────────────────────
    // 오디오는 song이 이미 갖고 있으므로 다시 올리지 않고 song_id로만 연결한다.
    // meta: { difficulty_label, lane_count, bpm, sort_order, is_public } — sort_order는 노래 안에서
    // 이 난이도가 표시될 순서(작을수록 앞). 종합 창의 카드 목록 순서(=드래그 결과)를 그대로 씀.
    // is_public은 이 난이도가 속한 노래의 현재 공개 여부를 그대로 따라간다(EditorSong.uploadToCloud 참고).
    // chartData: { bpm, startTimeOffset, laneCount, notes, triggers } (Editor의 flat 상태에서 뽑아낸 것)
    async addBeatmapToSong(songId, meta, chartData) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        // 소유자/editor 둘 다 허용 (RLS로도 막히겠지만 명확한 에러 메시지를 위해 먼저 확인).
        // 예전엔 owner_id 단독 체크였는데, 공동 작업(editor 역할) 도입으로 beat_song_role 기반으로 바뀜.
        const role = await this.getMyRoleForSong(songId);
        if (role !== 'owner' && role !== 'editor') return { error: new Error('권한이 없습니다.') };

        const chartId = crypto.randomUUID();
        const chartPath = `${user.id}/songs/${songId}/beatmaps/${chartId}/chart.json`;
        const noteSpeed = typeof chartData.noteSpeed === 'number' ? chartData.noteSpeed : null;
        const noteCount = Array.isArray(chartData.notes)
            ? chartData.notes.filter(n => n.type !== 'long_tail').length
            : 0;
        // 별점(difficulty_score)은 채보 지표만으로 이 시점에 한 번 계산해서 고정 저장한다.
        // 이후 플레이 기록이 쌓여도 재계산하지 않는다 (Difficulty 모듈 참고).
        const difficultyScore = Difficulty.calculate(chartData);

        const chartBlob = new Blob([JSON.stringify(chartData)], { type: 'application/json' });
        const { error: chartErr } = await _supabase.storage
            .from('beat-files')
            .upload(chartPath, chartBlob, { contentType: 'application/json', upsert: false });
        if (chartErr) return { error: chartErr };

        const { data, error: dbErr } = await _supabase
            .from('beat_charts')
            .insert({
                id: chartId,
                owner_id: user.id,
                song_id: songId,
                // 구버전 title 컬럼이 아직 NOT NULL일 수도 있어 방어적으로 채워둠 (실제로는 song.title을 씀)
                title: meta.difficulty_label || '기본',
                difficulty_label: meta.difficulty_label || null,
                lane_count: meta.lane_count || 4,
                bpm: meta.bpm || null,
                note_count: noteCount,
                note_speed: noteSpeed,
                difficulty_score: difficultyScore,
                use_custom_fall_speed: meta.use_custom_fall_speed === true,
                sort_order: typeof meta.sort_order === 'number' ? meta.sort_order : null,
                chart_storage_path: chartPath,
                is_public: meta.is_public === true,
            })
            .select()
            .single();

        if (dbErr) {
            await _supabase.storage.from('beat-files').remove([chartPath]);
            return { error: dbErr };
        }

        // 채보자(기여자) 기록 — 실제로 노트 데이터를 넣어 신규 생성한 경우이므로 항상 기록한다.
        // 실패해도 난이도 생성 자체는 이미 성공했으니 저장 실패로 취급하지 않고 로그만 남긴다.
        const { error: contribErr } = await _supabase.rpc('record_chart_contribution', { _chart_id: chartId });
        if (contribErr) console.warn('record_chart_contribution 오류:', contribErr.message);

        return { data };
    },

    // ── 내 노래 목록 (난이도 개수 포함) ──────────────────────────────────────
    // beat_charts와 JOIN하지 않고 두 번의 쿼리로 조합한다
    // (예전 project_members 무한 재귀 RLS 교훈 반영).
    async listMySongs() {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null, error: new Error('로그인이 필요합니다.') };

        const { data: songs, error: songsErr } = await _supabase
            .from('beat_songs')
            .select('id, title, artist, is_public, created_at, updated_at')
            .eq('owner_id', user.id)
            .order('updated_at', { ascending: false });
        if (songsErr) return { data: null, error: songsErr };
        if (!songs || songs.length === 0) return { data: [], error: null };

        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('song_id')
            .eq('owner_id', user.id)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return { data: null, error: chartsErr };

        const countBySongId = {};
        (charts || []).forEach(c => {
            countBySongId[c.song_id] = (countBySongId[c.song_id] || 0) + 1;
        });

        const data = songs.map(s => ({ ...s, beatmapCount: countBySongId[s.id] || 0 }));
        return { data, error: null };
    },

    // ── 노래 삭제 (Storage + DB) — 그 노래에 딸린 난이도(beatmap)까지 전부 함께 삭제 ──
    // 오디오 파일은 song 단위로 하나만 존재하므로, 노래를 지우면 거기 딸린 모든
    // 난이도의 차트 JSON과 오디오/커버 이미지가 한꺼번에 삭제된다.
    async deleteSong(songId) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { data: song, error: songFetchErr } = await _supabase
            .from('beat_songs')
            .select('audio_storage_path, cover_storage_path, owner_id')
            .eq('id', songId)
            .single();
        if (songFetchErr) return { error: songFetchErr };
        if (song.owner_id !== user.id) return { error: new Error('권한이 없습니다.') };

        // 이 노래에 속한 모든 난이도의 차트 JSON 경로 수집
        const { data: beatmaps, error: bmFetchErr } = await _supabase
            .from('beat_charts')
            .select('chart_storage_path')
            .eq('song_id', songId);
        if (bmFetchErr) return { error: bmFetchErr };

        // Storage 삭제: 오디오 + 커버 이미지 + 모든 난이도 차트 JSON
        const pathsToRemove = [song.audio_storage_path, song.cover_storage_path,
            ...(beatmaps || []).map(b => b.chart_storage_path)].filter(Boolean);
        if (pathsToRemove.length > 0) {
            await _supabase.storage.from('beat-files').remove(pathsToRemove);
        }

        // DB 삭제: 난이도(beat_charts)를 먼저 지운 뒤 노래(beat_songs)를 지운다
        // (cascade 설정 여부와 무관하게 안전하도록 명시적으로 처리)
        const { error: chartsDelErr } = await _supabase
            .from('beat_charts')
            .delete()
            .eq('song_id', songId);
        if (chartsDelErr) return { error: chartsDelErr };

        const { error: songDelErr } = await _supabase
            .from('beat_songs')
            .delete()
            .eq('id', songId);

        return { error: songDelErr };
    },

    // ── 노래 상세 (song 메타 + 그 노래의 난이도 목록, 각 beatmap은 메타만) ─────
    // 실제 notes/triggers는 여기서 안 받아온다 — 편집 진입 시 downloadChartData()로 필요할 때만 받는다.
    async getSongWithBeatmaps(songId) {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null, error: new Error('로그인이 필요합니다.') };

        // owner_id 단독 필터 제거 — 공동 작업 도입으로 RLS(songs_member_select/charts_member_select)가
        // owner 아닌 editor/viewer 멤버의 조회도 허용하므로, 클라이언트에서 미리 owner로 좁히면
        // 오히려 멤버들이 자기 몫을 못 읽는다. 접근 가능 여부는 이제 RLS가 전담한다.
        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('*')
            .eq('id', songId)
            .single();
        if (songErr) return { data: null, error: songErr };

        const { data: beatmaps, error: bmErr } = await _supabase
            .from('beat_charts')
            .select('id, difficulty_label, lane_count, bpm, note_count, note_speed, difficulty_score, chart_storage_path, sort_order, use_custom_fall_speed, created_at, updated_at')
            .eq('song_id', songId)
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
        if (bmErr) return { data: null, error: bmErr };

        return { data: { song, beatmaps: beatmaps || [] }, error: null };
    },

    // ── 이미 클라우드에 올라간 난이도(beatmap) 메타/데이터 수정 ─────────────
    // meta: { difficulty_label, lane_count, bpm, sort_order } 중 바뀐 필드만 넘기면 됨.
    // chartData: null이면 노트/트리거는 그대로 두고 메타만 갱신한다 (이름변경만 했을 때 등,
    // 편집 화면을 열지 않아 최신 notes/triggers를 갖고 있지 않은 경우 이 경로를 탄다).
    // expectedUpdatedAt: 이 난이도를 불러온/직전에 저장한 시점의 updated_at 문자열(낙관적 잠금, A안).
    // 넘기면 그 사이 다른 곳에서 먼저 저장된 경우 { error: { conflict: true } }를 반환하고 아무것도 바꾸지 않는다.
    async updateBeatmap(chartId, meta, chartData = null, expectedUpdatedAt = null) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { data: existing, error: fetchErr } = await _supabase
            .from('beat_charts')
            .select('chart_storage_path, song_id')
            .eq('id', chartId)
            .single();
        if (fetchErr) return { error: fetchErr };
        // owner_id 단독 체크 → beat_song_role 기반으로 변경 (addBeatmapToSong과 동일한 이유).
        const role = await this.getMyRoleForSong(existing.song_id);
        if (role !== 'owner' && role !== 'editor') return { error: new Error('권한이 없습니다.') };

        const updates = { ...meta };

        if (chartData) {
            updates.note_count = Array.isArray(chartData.notes)
                ? chartData.notes.filter(n => n.type !== 'long_tail').length
                : 0;
            // 노트/트리거가 실제로 갱신된 경우에만 별점도 재계산한다.
            // (이름변경만 한 경우는 chartData가 null로 넘어와 이 블록을 안 타므로 기존 별점 유지)
            updates.difficulty_score = Difficulty.calculate(chartData);
        }

        // 구버전 title 컬럼 방어적 동기화 (addBeatmapToSong과 동일 정책 — 난이도명이 바뀌면 같이 맞춰준다).
        if (updates.difficulty_label !== undefined) {
            updates.title = updates.difficulty_label || '기본';
        }

        // 1) DB 행부터 먼저 (조건부로) 갱신한다. Storage는 조건부 쓰기가 안 되므로, 순서를
        //    바꿔 이걸 먼저 해야 한다 — 그래야 충돌이 났을 때 Storage의 chart.json(다른 곳에서
        //    방금 저장한 실제 내용)이 내 낡은 데이터로 덮어써지는 걸 막을 수 있다.
        let query = _supabase.from('beat_charts').update(updates).eq('id', chartId);
        if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
        const { data, error: dbErr } = await query.select().single();

        if (dbErr) {
            if (expectedUpdatedAt && this._isOptimisticLockConflict(dbErr)) {
                return { error: { conflict: true, message: '다른 곳에서 이 사이 먼저 저장했습니다.' } };
            }
            return { error: dbErr };
        }

        // 2) DB 행(=낙관적 잠금)을 확보했으니 이제 실제 노트 데이터를 Storage에 반영한다.
        if (chartData) {
            // 채보자(기여자) 기록 — 이름변경/공개여부만 바꾼 경우(chartData === null)는 실제로
            // 채보 작업을 한 게 아니므로 기록하지 않는다. 실패해도 저장 자체는 이미 성공했으니
            // 저장 실패로 취급하지 않고 로그만 남긴다.
            const { error: contribErr } = await _supabase.rpc('record_chart_contribution', { _chart_id: chartId });
            if (contribErr) console.warn('record_chart_contribution 오류:', contribErr.message);

            const chartBlob = new Blob([JSON.stringify(chartData)], { type: 'application/json' });
            const { error: chartErr } = await _supabase.storage
                .from('beat-files')
                .update(existing.chart_storage_path, chartBlob, { contentType: 'application/json', upsert: true });
            if (chartErr) {
                // DB의 note_count/difficulty_score는 이미 새 값으로 바뀌었지만 실제 파일은 아직
                // 예전 그대로인 상태 — 흔치 않지만 생기면 재저장을 유도해야 하므로 구분해서 알려준다.
                return {
                    data,
                    error: { storageOnly: true, message: `메타는 저장됐지만 노트 데이터 업로드에 실패했습니다: ${chartErr.message}. 다시 저장해주세요.` },
                };
            }
        }

        return { data, error: null };
    },

    // ══ 공동 작업 — 멤버/초대 관리 ═══════════════════════════════════════════
    // js/hoi4/cloud/collab.js가 기대하는 CloudAuth.listMembers 등과 동일한 반환 모양으로
    // 맞춰서, collab.js를 이쪽으로 포팅할 때 호출부 이름만 CloudCharts.xxxToSong류로
    // 바꾸면 되게 해뒀다. 다만 hoi4 쪽은 (ownerUserId, projectName) 복합키였던 반면
    // 여기는 song_id 하나가 곧 PK라 인자가 한 개 적다.

    // 멤버 목록 조회 (닉네임 포함, 소유자 본인은 이 테이블에 행이 없으므로 안 나옴 — UI에서 별도 표시)
    // 반환: [{ member_id, role, joined_at, nickname }]
    async listSongMembers(songId) {
        const { data, error } = await _supabase
            .from('beat_song_members')
            .select('member_id, role, joined_at')
            .eq('song_id', songId)
            .order('joined_at', { ascending: true });
        if (error) { console.warn('listSongMembers 오류:', error.message); return []; }
        const members = data || [];
        const nickMap = await CloudAuth._fetchNicknameMap(members.map(m => m.member_id));
        return members.map(m => ({
            member_id: m.member_id,
            role: m.role,
            joined_at: m.joined_at,
            nickname: nickMap[m.member_id] || null,
        }));
    },

    // 이메일로 멤버 초대 (소유자만 — RLS의 invites_owner 정책이 최종적으로 막아준다)
    // 반환: { ok: true } | { ok: false, error: string }
    async inviteToSong(songId, email, role = 'editor') {
        const user = await CloudAuth.getUser();
        if (!user) return { ok: false, error: '로그인이 필요합니다.' };
        if (email === user.email) return { ok: false, error: '본인은 초대할 수 없습니다.' };

        // beat_song_invites엔 (song_id, invited_email) 유니크 제약이 없어서(마이그레이션에 없음)
        // upsert 대신 "기존 pending 초대가 있으면 지우고 새로 꽂기"로 흉내낸다 — 역할을 바꿔서
        // 다시 초대하는 경우에도 초대 목록에 중복이 안 쌓이게 하기 위함.
        await _supabase
            .from('beat_song_invites')
            .delete()
            .eq('song_id', songId)
            .eq('invited_email', email)
            .eq('status', 'pending');

        const { error } = await _supabase
            .from('beat_song_invites')
            .insert({
                song_id: songId,
                owner_id: user.id,
                invited_email: email,
                role,
                status: 'pending',
                created_at: new Date().toISOString(),
            });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
    },

    // 멤버 역할 변경 (소유자만 — RLS members_update가 최종 방어)
    async updateMemberRole(songId, memberId, newRole) {
        const { error } = await _supabase
            .from('beat_song_members')
            .update({ role: newRole })
            .eq('song_id', songId)
            .eq('member_id', memberId);
        if (error) throw error;
    },

    // 멤버 제거 (소유자가 강퇴하거나, 본인이 나가기 — RLS members_delete가 둘 다 허용)
    async removeMember(songId, memberId) {
        const { error } = await _supabase
            .from('beat_song_members')
            .delete()
            .eq('song_id', songId)
            .eq('member_id', memberId);
        if (error) throw error;
    },

    // 이 노래에 대해 내가 보낸 초대 목록 (소유자용 — "발송한 초대" 섹션)
    // 반환: [{ id, invited_email, role, status, created_at }]
    async listSentInvites(songId) {
        const { data, error } = await _supabase
            .from('beat_song_invites')
            .select('id, invited_email, role, status, created_at')
            .eq('song_id', songId)
            .order('created_at', { ascending: false });
        if (error) { console.warn('listSentInvites 오류:', error.message); return []; }
        return data || [];
    },

    // 초대 취소 (소유자가 보낸 초대 삭제)
    async cancelInvite(inviteId) {
        const { error } = await _supabase
            .from('beat_song_invites')
            .delete()
            .eq('id', inviteId);
        if (error) throw error;
    },

    // 내가 받은 pending 초대함
    // 반환: [{ id, song_id, role, created_at, song_title, song_artist }]
    // 주의: song_title/song_artist는 beat_songs 임베드 조회인데, 아직 수락 전이라 내가 이 노래의
    // 멤버가 아닌 상태 — 노래가 비공개면 RLS(songs_member_select)에 걸려 null로 온다. 이 경우
    // UI에서 "비공개 노래" 정도로 대체 표시하면 된다(수락하면 그 다음부턴 정상 조회 가능).
    async listMyInvites() {
        const user = await CloudAuth.getUser();
        if (!user) return [];
        const { data, error } = await _supabase
            .from('beat_song_invites')
            .select('id, song_id, role, created_at, beat_songs(title, artist)')
            .eq('invited_email', user.email)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        if (error) { console.warn('listMyInvites 오류:', error.message); return []; }
        return (data || []).map(inv => ({
            id: inv.id,
            song_id: inv.song_id,
            role: inv.role,
            created_at: inv.created_at,
            song_title: inv.beat_songs?.title || null,
            song_artist: inv.beat_songs?.artist || null,
        }));
    },

    // 초대 수락 (RPC — 멤버 등록 + 초대 상태 갱신을 한 트랜잭션으로 처리)
    async acceptInvite(inviteId) {
        const { error } = await _supabase.rpc('accept_song_invite', { _invite_id: inviteId });
        if (error) throw error;
    },

    // 초대 거절
    async declineInvite(inviteId) {
        const { error } = await _supabase
            .from('beat_song_invites')
            .update({ status: 'declined' })
            .eq('id', inviteId);
        if (error) throw error;
    },

    // ══ 공동 작업 — 공유받은 노래 목록 ═══════════════════════════════════════
    // listMySongs()는 그대로 "내가 owner인 노래"만 반환하고, 초대받아 참여 중인 노래는
    // 이 함수로 따로 제공한다 (에디터 홈에 "🤝 공유받은 노래" 섹션으로 별도 렌더링 — 4단계).
    // 반환: [{ id, title, artist, owner_id, is_public, created_at, updated_at, beatmapCount, myRole }]
    async listSharedSongs() {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null, error: new Error('로그인이 필요합니다.') };

        const { data: memberships, error: memErr } = await _supabase
            .from('beat_song_members')
            .select('song_id, role, joined_at')
            .eq('member_id', user.id);
        if (memErr) return { data: null, error: memErr };
        if (!memberships || memberships.length === 0) return { data: [], error: null };

        const songIds = memberships.map(m => m.song_id);
        const { data: songs, error: songsErr } = await _supabase
            .from('beat_songs')
            .select('id, title, artist, owner_id, is_public, created_at, updated_at')
            .in('id', songIds);
        if (songsErr) return { data: null, error: songsErr };

        const roleBySongId = {};
        memberships.forEach(m => { roleBySongId[m.song_id] = m.role; });

        // listMySongs()와 동일하게 난이도 개수도 붙여준다(카드에 표시용). 여기선 내가 owner가
        // 아니므로 owner_id 필터 없이 song_id in만 사용.
        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('song_id')
            .in('song_id', songIds);
        if (chartsErr) return { data: null, error: chartsErr };
        const countBySongId = {};
        (charts || []).forEach(c => { countBySongId[c.song_id] = (countBySongId[c.song_id] || 0) + 1; });

        const data = (songs || [])
            .map(s => ({ ...s, beatmapCount: countBySongId[s.id] || 0, myRole: roleBySongId[s.id] || null }))
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

        return { data, error: null };
    },
};