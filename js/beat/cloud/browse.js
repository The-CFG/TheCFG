// ── CloudBrowse: 공개 "노래" 목록 / 상세 / 난이도(beatmap) 상세 조회 ────────
// 비로그인 상태에서도 조회 가능하도록 RLS 정책이 설계되어 있다.
//
// Phase 4: song/beatmap 분리 이후의 흐름
//   홈(노래 목록) → 노래 상세(난이도 리스트) → 난이도 선택(=플레이 전 화면) → 플레이
// beat_songs ↔ beat_charts는 JOIN하지 않고 두 번의 쿼리로 조합한다
// (listMySongs()와 동일한 이유 — cross-table RLS 재귀를 피하기 위함).

const CloudBrowse = {

    // ── 공개 "노래" 목록 (난이도 개수 / 레인 수 범위 / 총 플레이 수 요약 포함) ──
    // options: { sort: 'newest'|'popular'|'likes'|'difficulty', search: string, page: number, pageSize: number }
    async listPublicSongs(options = {}) {
        const { sort = 'newest', search = '', page = 0, pageSize = 20 } = options;
        const keyword = search.trim();

        if (sort === 'popular')    return await this._listPublicSongsByPopularity({ keyword, page, pageSize });
        if (sort === 'likes')      return await this._listPublicSongsByLikes({ keyword, page, pageSize });
        if (sort === 'difficulty') return await this._listPublicSongsByDifficulty({ keyword, page, pageSize });
        return await this._listPublicSongsByNewest({ keyword, page, pageSize });
    },

    // 최신순: beat_songs 자체를 created_at으로 페이지네이션 → 해당 페이지 노래들의
    // 난이도 요약만 beat_charts에서 한 번 더 조회해서 붙인다.
    async _listPublicSongsByNewest({ keyword, page, pageSize }) {
        let query = _supabase
            .from('beat_songs')
            .select('id, title, artist, created_at, updated_at, cover_storage_path', { count: 'exact' })
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
            .select('id, title, artist, created_at, updated_at, cover_storage_path')
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
            .select('id, song_id, lane_count, play_count, difficulty_score')
            .eq('is_public', true)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return { data: null, error: chartsErr };

        const likeCountByChartId = await this._fetchLikeCounts((charts || []).map(c => c.id));
        const summaryBySongId = this._buildSummary(charts || [], likeCountByChartId);

        const ranked = songs
            .map(s => ({ song: s, totalPlayCount: summaryBySongId[s.id]?.totalPlayCount || 0 }))
            .sort((a, b) => b.totalPlayCount - a.totalPlayCount)
            .map(x => x.song);

        const count = ranked.length;
        const pageSongs = ranked.slice(page * pageSize, (page + 1) * pageSize);
        const data = pageSongs.map(s => ({
            ...s,
            ...(summaryBySongId[s.id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0, totalLikeCount: 0, minDifficultyScore: null, maxDifficultyScore: null, beatmaps: [] }),
        }));

        return { data, error: null, count };
    },

    // 좋아요순: 인기순과 동일한 방식이되, beat_chart_likes 개수를 노래별로 합산해 정렬한다.
    async _listPublicSongsByLikes({ keyword, page, pageSize }) {
        const CANDIDATE_CAP = 500;

        let songQuery = _supabase
            .from('beat_songs')
            .select('id, title, artist, created_at, updated_at, cover_storage_path')
            .eq('is_public', true)
            .limit(CANDIDATE_CAP);
        if (keyword) songQuery = songQuery.or(`title.ilike.%${keyword}%,artist.ilike.%${keyword}%`);

        const { data: songs, error: songsErr } = await songQuery;
        if (songsErr) return { data: null, error: songsErr };
        if (!songs || songs.length === 0) return { data: [], error: null, count: 0 };

        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('id, song_id, lane_count, play_count, difficulty_score')
            .eq('is_public', true)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return { data: null, error: chartsErr };

        const likeCountByChartId = await this._fetchLikeCounts((charts || []).map(c => c.id));
        const summaryBySongId = this._buildSummary(charts || [], likeCountByChartId);

        const ranked = songs
            .map(s => ({ song: s, totalLikeCount: summaryBySongId[s.id]?.totalLikeCount || 0 }))
            .sort((a, b) => b.totalLikeCount - a.totalLikeCount)
            .map(x => x.song);

        const count = ranked.length;
        const pageSongs = ranked.slice(page * pageSize, (page + 1) * pageSize);
        const data = pageSongs.map(s => ({
            ...s,
            ...(summaryBySongId[s.id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0, totalLikeCount: 0, minDifficultyScore: null, maxDifficultyScore: null, beatmaps: [] }),
        }));

        return { data, error: null, count };
    },

    // 난이도순: 인기순/좋아요순과 동일한 후보 집합 방식이되, 노래가 가진 공개 난이도들
    // 중 "가장 높은 별점(difficulty_score)"을 기준으로 내림차순 정렬한다.
    // (노래 하나에 난이도가 여러 개 달릴 수 있어서 song 레벨 값이 아니라 max로 뽑아야 함)
    async _listPublicSongsByDifficulty({ keyword, page, pageSize }) {
        const CANDIDATE_CAP = 500;

        let songQuery = _supabase
            .from('beat_songs')
            .select('id, title, artist, created_at, updated_at, cover_storage_path')
            .eq('is_public', true)
            .limit(CANDIDATE_CAP);
        if (keyword) songQuery = songQuery.or(`title.ilike.%${keyword}%,artist.ilike.%${keyword}%`);

        const { data: songs, error: songsErr } = await songQuery;
        if (songsErr) return { data: null, error: songsErr };
        if (!songs || songs.length === 0) return { data: [], error: null, count: 0 };

        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('id, song_id, lane_count, play_count, difficulty_score')
            .eq('is_public', true)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return { data: null, error: chartsErr };

        const likeCountByChartId = await this._fetchLikeCounts((charts || []).map(c => c.id));
        const summaryBySongId = this._buildSummary(charts || [], likeCountByChartId);

        const ranked = songs
            .map(s => ({ song: s, maxDifficultyScore: summaryBySongId[s.id]?.maxDifficultyScore ?? -1 }))
            .sort((a, b) => b.maxDifficultyScore - a.maxDifficultyScore)
            .map(x => x.song);

        const count = ranked.length;
        const pageSongs = ranked.slice(page * pageSize, (page + 1) * pageSize);
        const data = pageSongs.map(s => ({
            ...s,
            ...(summaryBySongId[s.id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0, totalLikeCount: 0, minDifficultyScore: null, maxDifficultyScore: null, beatmaps: [] }),
        }));

        return { data, error: null, count };
    },

    // songs 목록에 대해 beat_charts를 한 번 더 조회해 난이도 요약(+좋아요 합계)을 붙인다.
    async _attachBeatmapSummary(songs) {
        const { data: charts, error: chartsErr } = await _supabase
            .from('beat_charts')
            .select('id, song_id, lane_count, play_count, difficulty_score')
            .eq('is_public', true)
            .in('song_id', songs.map(s => s.id));
        if (chartsErr) return songs.map(s => ({ ...s, beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0, totalLikeCount: 0, maxDifficultyScore: null, beatmaps: [] }));

        const likeCountByChartId = await this._fetchLikeCounts((charts || []).map(c => c.id));
        const summaryBySongId = this._buildSummary(charts || [], likeCountByChartId);
        return songs.map(s => ({
            ...s,
            ...(summaryBySongId[s.id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0, totalLikeCount: 0, minDifficultyScore: null, maxDifficultyScore: null, beatmaps: [] }),
        }));
    },

    // 차트 id 배열 → chart_id별 좋아요 개수 { [chartId]: count }
    async _fetchLikeCounts(chartIds) {
        const ids = (chartIds || []).filter(Boolean);
        if (ids.length === 0) return {};

        const { data, error } = await _supabase
            .from('beat_chart_likes')
            .select('chart_id')
            .in('chart_id', ids);
        if (error || !data) return {};

        const counts = {};
        data.forEach(r => { counts[r.chart_id] = (counts[r.chart_id] || 0) + 1; });
        return counts;
    },

    // beat_charts 행 배열(+좋아요 개수 맵) → song_id별 { beatmapCount, laneCountMin, laneCountMax, totalPlayCount, totalLikeCount, beatmaps }
    _buildSummary(charts, likeCountByChartId = {}) {
        const bySongId = {};
        charts.forEach(c => {
            const cur = bySongId[c.song_id] || { beatmapCount: 0, laneCountMin: null, laneCountMax: null, totalPlayCount: 0, totalLikeCount: 0, minDifficultyScore: null, maxDifficultyScore: null, beatmaps: [] };
            cur.beatmapCount += 1;
            cur.totalPlayCount += c.play_count || 0;
            cur.totalLikeCount += likeCountByChartId[c.id] || 0;
            if (typeof c.difficulty_score === 'number') {
                cur.minDifficultyScore = cur.minDifficultyScore === null
                    ? c.difficulty_score
                    : Math.min(cur.minDifficultyScore, c.difficulty_score);
                cur.maxDifficultyScore = cur.maxDifficultyScore === null
                    ? c.difficulty_score
                    : Math.max(cur.maxDifficultyScore, c.difficulty_score);
            }
            if (typeof c.lane_count === 'number') {
                cur.laneCountMin = cur.laneCountMin === null ? c.lane_count : Math.min(cur.laneCountMin, c.lane_count);
                cur.laneCountMax = cur.laneCountMax === null ? c.lane_count : Math.max(cur.laneCountMax, c.lane_count);
            }
            // 라이브러리 카드에 "[X키] [난이도들] [Y키] [난이도들]" 식으로 그룹지어 그리기 위해
            // 레인 수 + 별점을 쌍으로 보관해둔다 (한 노래 안에 서로 다른 키 난이도가 섞여있을 수 있음).
            if (typeof c.lane_count === 'number' && typeof c.difficulty_score === 'number') {
                cur.beatmaps.push({ laneCount: c.lane_count, score: c.difficulty_score });
            }
            bySongId[c.song_id] = cur;
        });
        // 레인 수 오름차순 → 그 안에서 별점 오름차순. 정렬만 해두면 화면 쪽에서
        // 레인 수가 바뀌는 지점마다 새 그룹(키 라벨 큐브)을 시작하면 된다.
        Object.values(bySongId).forEach(s => s.beatmaps.sort((a, b) => a.laneCount - b.laneCount || a.score - b.score));
        return bySongId;
    },

    // ── 노래 상세 (메타 + 그 노래의 공개 난이도 목록) ─────────────────────────
    // "난이도 선택" 화면에 필요한 정보만 담는다. 실제 notes/triggers는 여기서
    // 받아오지 않고, 플레이 시점에 getBeatmapDetail()의 chart_storage_path로 받는다.
    //
    // is_public=true 외에 owner_id=나 도 함께 허용한다 — beat_songs/beat_charts의
    // SELECT RLS(beat_songs_select_own / charts_select)가 원래 "공개 OR 내 소유"를
    // 허용하는데, 여기서 쿼리에 .eq('is_public', true)만 걸어놓으면 RLS보다 더 빡빡하게
    // 걸려서 내가 만든 비공개 노래/차트인데도 0 rows(PGRST116)로 막혀버린다.
    async getSongDetail(songId) {
        const user = await CloudAuth.getUser();
        const ownFilter = user ? `is_public.eq.true,owner_id.eq.${user.id}` : 'is_public.eq.true';

        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('*')
            .eq('id', songId)
            .or(ownFilter)
            .single();
        if (songErr) return { data: null, error: songErr };

        const { data: beatmaps, error: bmErr } = await _supabase
            .from('beat_charts')
            .select('id, difficulty_label, lane_count, bpm, duration_seconds, note_count, difficulty_score, play_count, sort_order, created_at, updated_at, owner_id')
            .eq('song_id', songId)
            .or(ownFilter)
            .order('lane_count', { ascending: true })
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
        if (bmErr) return { data: null, error: bmErr };

        return { data: { song, beatmaps: beatmaps || [] }, error: null };
    },

    // ── 난이도(beatmap) 상세 = "플레이 전 화면"에 필요한 전부 ────────────────
    // 리더보드/플레이 버튼에 필요한 beatmap 메타 + 오디오를 갖고 있는 song 메타를
    // 합쳐서 기존 getChartDetail()과 같은 모양(title/artist/audio_storage_path 포함)으로 반환한다.
    //
    // getSongDetail과 같은 이유로 is_public=true 뿐 아니라 owner_id=나 도 허용한다.
    // 특히 "내 업로드 차트" 목록의 "랭킹" 버튼(.my-lb-btn)은 비공개 차트에도 붙어있어서,
    // 이 필터가 없으면 자기 비공개 차트의 랭킹/상세를 열 때마다 PGRST116으로 막혔다.
    async getBeatmapDetail(chartId) {
        const user = await CloudAuth.getUser();
        const ownFilter = user ? `is_public.eq.true,owner_id.eq.${user.id}` : 'is_public.eq.true';

        const { data: chart, error: chartErr } = await _supabase
            .from('beat_charts')
            .select('*')
            .eq('id', chartId)
            .or(ownFilter)
            .single();
        if (chartErr) return { data: null, error: chartErr };

        const { data: song, error: songErr } = await _supabase
            .from('beat_songs')
            .select('id, title, artist, audio_storage_path, audio_mime, preview_start_ms, start_offset_ms, cover_storage_path')
            .eq('id', chart.song_id)
            .or(ownFilter)
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
                cover_storage_path: song.cover_storage_path || null,
                song_id: song.id,
            },
            error: null,
        };
    },

    // 난이도 id 목록 → 표시용 요약 정보(제목/아티스트/라벨/키수/산정 난이도). 멀티플레이 방의
    // "다음에 플레이할 채보" 목록(chart_queue)을 그릴 때처럼 id만 갖고 있을 때 쓴다.
    // beat_charts에는 제목/아티스트가 없어(beat_songs 소속) song_id로 한 번 더 조회해 합쳐준다.
    async getChartsByIds(chartIds) {
        if (!chartIds || chartIds.length === 0) return { data: [], error: null };
        const { data: charts, error: chartErr } = await _supabase
            .from('beat_charts')
            .select('id, song_id, difficulty_label, lane_count, difficulty_score')
            .in('id', chartIds);
        if (chartErr) return { data: null, error: chartErr };

        const songIds = [...new Set((charts || []).map(c => c.song_id))];
        if (songIds.length === 0) return { data: [], error: null };

        const { data: songs, error: songErr } = await _supabase
            .from('beat_songs')
            .select('id, title, artist')
            .in('id', songIds);
        if (songErr) return { data: null, error: songErr };

        const songById = {};
        (songs || []).forEach(s => { songById[s.id] = s; });

        const merged = (charts || []).map(c => ({
            ...c,
            title: songById[c.song_id]?.title || null,
            artist: songById[c.song_id]?.artist || null,
        }));
        return { data: merged, error: null };
    },

    // ── 메인 메뉴 "추천 비트맵" 카드용 ────────────────────────────────────
    // 공개 채보 중 하나를 무작위로 골라 카드에 필요한 전부(커버/오디오/메타/채보자 닉네임)를
    // 합쳐서 반환한다. RLS가 is_public=true는 비로그인도 조회 가능하게 되어 있어 로그인 여부와
    // 무관하게 동작한다.
    //
    // 1) id만 가벼운 쿼리로 모아서 클라이언트에서 랜덤 pick (Supabase에서 진짜 random() 정렬은
    //    풀 스캔이라 비쌈 — 대신 count만 알아내서 랜덤 offset 하나만 찍어 가져온다)
    // 2) 그 채보 1건만 상세 조회 + song 메타 조합 (getBeatmapDetail과 동일한 모양)
    // 3) 채보자(chart.owner_id) 닉네임 별도 조회
    //
    // 반환: { id, difficulty_label, lane_count, difficulty_score, owner_id, owner_nickname,
    //         song_id, title, artist, audio_storage_path, audio_mime, cover_storage_path,
    //         preview_start_ms } | null (공개 채보가 하나도 없으면 null)
    async getFeaturedBeatmap() {
        const { count, error: countErr } = await _supabase
            .from('beat_charts')
            .select('id', { count: 'exact', head: true })
            .eq('is_public', true);
        if (countErr || !count) return { data: null, error: countErr || null };

        const randomOffset = Math.floor(Math.random() * count);
        const { data: picked, error: pickErr } = await _supabase
            .from('beat_charts')
            .select('id')
            .eq('is_public', true)
            .range(randomOffset, randomOffset);
        if (pickErr || !picked || !picked.length) return { data: null, error: pickErr || null };

        // 상세 조합은 기존 getBeatmapDetail과 동일 로직 재사용
        const { data: detail, error: detailErr } = await this.getBeatmapDetail(picked[0].id);
        if (detailErr || !detail) return { data: null, error: detailErr || null };

        const nickMap = await CloudAuth._fetchNicknameMap([detail.owner_id]);
        return {
            data: { ...detail, owner_nickname: nickMap[detail.owner_id] || null },
            error: null,
        };
    },
};