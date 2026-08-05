// ── CloudCharts: 내 차트 업로드 / 수정 / 목록 / 삭제 ──────────────────────
// beat.html 에서 auth.js 다음에 로드된다. _supabase 는 auth.js에서 선언된 전역 변수.

const CloudCharts = {

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
    // meta: { title, artist, preview_start_ms, start_offset_ms, timing_start_ms }, audioFile: File 객체 (필수),
    // coverFile: File 객체 (선택 — 노래 선택~결과 화면 배경으로 쓰임)
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
                is_public: true,
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
    // meta: { title, artist, preview_start_ms, start_offset_ms, timing_start_ms } — 오디오/난이도는 건드리지 않는다.
    // coverFile: File 객체 (선택 — 넘기면 새 커버로 교체, 안 넘기면 기존 커버 유지)
    async updateSongMeta(songId, meta, coverFile) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const updatePayload = {
            title: meta.title,
            artist: meta.artist || null,
            preview_start_ms: meta.preview_start_ms || 0,
            start_offset_ms: meta.start_offset_ms || 0,
            timing_start_ms: meta.timing_start_ms || 0,
        };

        if (coverFile) {
            const coverExt = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
            const coverPath = `${user.id}/songs/${songId}/cover.${coverExt}`;
            const { error: coverErr } = await _supabase.storage
                .from('beat-files')
                .upload(coverPath, coverFile, { contentType: coverFile.type || 'image/jpeg', upsert: true });
            if (coverErr) return { error: coverErr };
            updatePayload.cover_storage_path = coverPath;
        }

        const { data, error } = await _supabase
            .from('beat_songs')
            .update(updatePayload)
            .eq('id', songId)
            .eq('owner_id', user.id)
            .select()
            .single();

        return { data, error };
    },

    // ── 기존 노래에 난이도(beatmap) 하나 추가 ───────────────────────────────
    // 오디오는 song이 이미 갖고 있으므로 다시 올리지 않고 song_id로만 연결한다.
    // meta: { difficulty_label, lane_count, bpm }
    // chartData: { bpm, startTimeOffset, laneCount, notes, triggers } (Editor의 flat 상태에서 뽑아낸 것)
    async addBeatmapToSong(songId, meta, chartData) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        // 소유권 확인 (RLS로도 막히겠지만 명확한 에러 메시지를 위해 먼저 확인)
        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('id, owner_id')
            .eq('id', songId)
            .single();
        if (songErr) return { error: songErr };
        if (song.owner_id !== user.id) return { error: new Error('권한이 없습니다.') };

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
                chart_storage_path: chartPath,
                is_public: true,
            })
            .select()
            .single();

        if (dbErr) {
            await _supabase.storage.from('beat-files').remove([chartPath]);
            return { error: dbErr };
        }

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

        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('*')
            .eq('id', songId)
            .eq('owner_id', user.id)
            .single();
        if (songErr) return { data: null, error: songErr };

        const { data: beatmaps, error: bmErr } = await _supabase
            .from('beat_charts')
            .select('id, difficulty_label, lane_count, bpm, note_count, difficulty_score, chart_storage_path, created_at, updated_at')
            .eq('song_id', songId)
            .eq('owner_id', user.id)
            .order('created_at', { ascending: true });
        if (bmErr) return { data: null, error: bmErr };

        return { data: { song, beatmaps: beatmaps || [] }, error: null };
    },

    // ── 이미 클라우드에 올라간 난이도(beatmap) 메타/데이터 수정 ─────────────
    // meta: { difficulty_label, lane_count, bpm } 중 바뀐 필드만 넘기면 됨.
    // chartData: null이면 노트/트리거는 그대로 두고 메타만 갱신한다 (이름변경만 했을 때 등,
    // 편집 화면을 열지 않아 최신 notes/triggers를 갖고 있지 않은 경우 이 경로를 탄다).
    async updateBeatmap(chartId, meta, chartData = null) {
        const user = await CloudAuth.getUser();
        if (!user) return { error: new Error('로그인이 필요합니다.') };

        const { data: existing, error: fetchErr } = await _supabase
            .from('beat_charts')
            .select('chart_storage_path, owner_id')
            .eq('id', chartId)
            .single();
        if (fetchErr) return { error: fetchErr };
        if (existing.owner_id !== user.id) return { error: new Error('권한이 없습니다.') };

        const updates = { ...meta };

        if (chartData) {
            const chartBlob = new Blob([JSON.stringify(chartData)], { type: 'application/json' });
            const { error: chartErr } = await _supabase.storage
                .from('beat-files')
                .update(existing.chart_storage_path, chartBlob, { contentType: 'application/json', upsert: true });
            if (chartErr) return { error: chartErr };
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

        const { data, error: dbErr } = await _supabase
            .from('beat_charts')
            .update(updates)
            .eq('id', chartId)
            .select()
            .single();

        return { data, error: dbErr };
    },
};