// ── CloudBrowse: 공개 "노래" 목록 / 상세 / 난이도(beatmap) 상세 조회 ────────
// 비로그인 상태에서도 조회 가능하도록 RLS 정책이 설계되어 있다.
//
// Phase 4: song/beatmap 분리 이후의 흐름
//   홈(노래 목록) → 노래 상세(난이도 리스트) → 난이도 선택(=플레이 전 화면) → 플레이
// beat_songs ↔ beat_charts는 JOIN하지 않고 두 번의 쿼리로 조합한다
// (listMySongs()와 동일한 이유 — cross-table RLS 재귀를 피하기 위함).

const CloudBrowse = {

    // ── 공개 "노래" 목록 (난이도 개수 / 레인 수 범위 / 총 플레이 수 요약 포함) ──
    // options: { sort: 'newest'|'popular', search: string, page: number, pageSize: number }
    async listPublicSongs(options = {}) {
        const { sort = 'newest', search = '', page = 0, pageSize = 20 } = options;
        const keyword = search.trim();

        if (sort === 'popular') {
            return await this._listPublicSongsByPopularity({ keyword, page, pageSize });
        }
        return await this._listPublicSongsByNewest({ keyword, page, pageSize });
    },

    // 최신순: beat_songs 자체를 created_at으로 페이지네이션 → 해당 페이지 노래들의
    // 난이도 요약만 beat_charts에서 한 번 더 조회해서 붙인다.
    async _listPublicSongsByNewest({ keyword, page, pageSize }) {
        let query = _supabase
            .from('beat_songs')
            .select('id, title, artist, created_at', { count: 'exact' })
            .eq('is_public', true)
            .order('created_at', { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (keyword) query = query.or(`title.ilike.%${keyword}%,artist.ilike.%${keyword}%`);

        const { data: songs, error, count } = await query;
        if (error) return { data: null, error };
        if (!songs || songs.length === 0) return { data: [], error: null, count: count || 0 };

        const data = await this._attachBeatmapSummary(songs);
        return { data, error: null, count: count || 0 };
    },

    // 인기순: 정렬 기준(총 플레이 수)이 beat_charts 쪽 집계값이라 beat_songs만으로는
    // order/range를 걸 수 없다. 검색 조건에 맞는 공개 노래 id를 먼저 뽑고,
    // 그 노래들의 공개 난이도 play_count를 모아 노래별 합계로 정렬한 뒤 페이지를 잘라낸다.
    // (본격적인 대규모 서비스라면 DB 뷰/RPC로 옮길 부분이지만, 현재 규모에서는
    //  후보 집합에 상한을 두는 것으로 충분하다.)
    async _listPublicSongsByPopularity({ keyword, page, pageSize }) {
        const CANDIDATE_CAP = 500;

        let songQuery = _supabase
            .from('beat_songs')
            .select('id, title, artist, created_at')
            .eq('is_public', true)
            .limit(CANDIDATE_CAP);
        if (keyword) songQuery = songQuery.or(`title.ilike.%${keyword}%,artist.ilike.%${keyword}%`);

        const { data: songs, error: songsErr } = await songQuery;
        if (songsErr) return { data: null, error: songsErr };
        if (!songs || songs.length === 0) return { data: [], error: null, count: 0 };

        const songById = {};
        songs.forEach(s => { songById[s.id] = s; });

        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('song_id, lane_count, play_count')
            .eq('is_public', true)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return { data: null, error: chartsErr };

        const summaryBySongId = this._buildSummary(charts || []);

        const ranked = songs
            .map(s => ({ song: s, totalPlayCount: summaryBySongId[s.id]?.totalPlayCount || 0 }))
            .sort((a, b) => b.totalPlayCount - a.totalPlayCount)
            .map(x => x.song);

        const count = ranked.length;
        const pageSongs = ranked.slice(page * pageSize, (page + 1) * pageSize);
        const data = pageSongs.map(s => ({
            ...s,
            ...(summaryBySongId[s.id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0 }),
        }));

        return { data, error: null, count };
    },

    // songs 목록에 대해 beat_charts를 한 번 더 조회해 난이도 요약을 붙인다.
    async _attachBeatmapSummary(songs) {
        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('song_id, lane_count, play_count')
            .eq('is_public', true)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return songs.map(s => ({ ...s, beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0 }));

        const summaryBySongId = this._buildSummary(charts || []);
        return songs.map(s => ({
            ...s,
            ...(summaryBySongId[s.id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0 }),
        }));
    },

    // beat_charts 행 배열 → song_id별 { beatmapCount, laneCountMin, laneCountMax, totalPlayCount }
    _buildSummary(charts) {
        const bySongId = {};
        charts.forEach(c => {
            const cur = bySongId[c.song_id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0 };
            cur.beatmapCount += 1;
            cur.totalPlayCount += c.play_count || 0;
            if (typeof c.lane_count === 'number') {
                cur.laneCountMin = cur.laneCountMin === null ? c.lane_count : Math.min(cur.laneCountMin, c.lane_count);
                cur.laneCountMax = cur.laneCountMax === null ? c.lane_count : Math.max(cur.laneCountMax, c.lane_count);
            }
            bySongId[c.song_id] = cur;
        });
        return bySongId;
    },

    // ── 노래 상세 (메타 + 그 노래의 공개 난이도 목록) ─────────────────────────
    // "난이도 선택" 화면에 필요한 정보만 담는다. 실제 notes/triggers는 여기서
    // 받아오지 않고, 플레이 시점에 getBeatmapDetail()의 chart_storage_path로 받는다.
    async getSongDetail(songId) {
        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('*')
            .eq('id', songId)
            .eq('is_public', true)
            .single();
        if (songErr) return { data: null, error: songErr };

        const { data: beatmaps, error: bmErr } = await _supabase
            .from('beat_charts')
            .select('id, difficulty_label, lane_count, bpm, note_count, play_count, created_at')
            .eq('song_id', songId)
            .eq('is_public', true)
            .order('lane_count', { ascending: true })
            .order('created_at', { ascending: true });
        if (bmErr) return { data: null, error: bmErr };

        return { data: { song, beatmaps: beatmaps || [] }, error: null };
    },

    // ── 난이도(beatmap) 상세 = "플레이 전 화면"에 필요한 전부 ────────────────
    // 리더보드/플레이 버튼에 필요한 beatmap 메타 + 오디오를 갖고 있는 song 메타를
    // 합쳐서 기존 getChartDetail()과 같은 모양(title/artist/audio_storage_path 포함)으로 반환한다.
    async getBeatmapDetail(chartId) {
        const { data: chart, error: chartErr } = await _supabase
            .from('beat_charts')
            .select('*')
            .eq('id', chartId)
            .eq('is_public', true)
            .single();
        if (chartErr) return { data: null, error: chartErr };

        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('id, title, artist, audio_storage_path, audio_mime, preview_start_ms, start_offset_ms')
            .eq('id', chart.song_id)
            .eq('is_public', true)
            .single();
        if (songErr) return { data: null, error: songErr };

        return {
            data: {
                ...chart,
                title: song.title,
                artist: song.artist,
                audio_storage_path: song.audio_storage_path,
                audio_mime: song.audio_mime,
                preview_start_ms: song.preview_start_ms || 0,
                start_offset_ms: song.start_offset_ms || 0,
                song_id: song.id,
            },
            error: null,
        };
    },
};