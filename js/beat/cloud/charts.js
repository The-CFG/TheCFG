// ── CloudCharts: 내 차트 업로드 / 수정 / 목록 / 삭제 ──────────────────────
// beat.html 에서 auth.js 다음에 로드된다. _supabase 는 auth.js에서 선언된 전역 변수.

const CloudCharts = {

    // ── 내 차트 목록 ─────────────────────────────────────────────────────────
    async listMyCharts() {
        const user = await CloudAuth.getUser();
        if (!user) return { data: null, error: new Error('로그인이 필요합니다.') };

        return await _supabase
            .from('beat_charts')
            .select('id, title, artist, bpm, lane_count, difficulty_label, note_count, is_public, play_count, created_at, updated_at')
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
        const { data, error } = await _supabase.storage
            .from('beat-files')
            .download(chartStoragePath);
        if (error) return { error };
        const text = await data.text();
        return { data: JSON.parse(text) };
    },

    // ── Storage에서 오디오 공개 URL 가져오기 ──────────────────────────────────
    getAudioUrl(audioStoragePath) {
        const { data } = _supabase.storage
            .from('beat-files')
            .getPublicUrl(audioStoragePath);
        return data.publicUrl;
    },
};