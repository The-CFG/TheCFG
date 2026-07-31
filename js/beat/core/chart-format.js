/**
 * ChartFormat
 * -----------
 * 로컬 파일로 저장/불러오는 차트의 포맷을 다룬다.
 *
 * v2 포맷 (신규): 노래 하나에 여러 난이도(비트맵)를 한 파일에 담을 수 있음
 *   { formatVersion: 2, songName, artist, beatmaps: [{ difficultyLabel, laneCount, bpm, startTimeOffset, notes, triggers }, ...] }
 *
 * 구버전 포맷 (기존): 노래 하나 = 비트맵 하나, 최상위에 필드가 바로 있음
 *   { songName, bpm, startTimeOffset, laneCount, notes, triggers }
 *
 * 지금 에디터/게임은 아직 "한 번에 비트맵 하나만" 다루므로(다중 난이도 관리 UI는 Phase 3),
 * normalize()는 항상 beatmaps[0](또는 구버전 파일 자체)만 꺼내서 돌려준다.
 * 여러 난이도가 든 파일을 불러오면 beatmapCount로 알려주기만 하고, 실제 선택 UI는 Phase 3에서 추가한다.
 */
const ChartFormat = {
    CURRENT_VERSION: 2,

    // 신/구버전 아무 차트 파일이나 받아서 { songName, artist, beatmapCount, beatmap } 형태로 통일해 돌려준다.
    normalize(raw) {
        if (!raw || typeof raw !== 'object') {
            throw new Error('빈 차트 데이터입니다.');
        }

        if (raw.formatVersion === 2 && Array.isArray(raw.beatmaps)) {
            if (raw.beatmaps.length === 0) {
                throw new Error('차트에 난이도(비트맵)가 없습니다.');
            }
            const bm = raw.beatmaps[0];
            return {
                songName: raw.songName || '',
                artist: raw.artist || null,
                beatmapCount: raw.beatmaps.length,
                beatmap: {
                    difficultyLabel: bm.difficultyLabel || '기본',
                    laneCount: bm.laneCount || 4,
                    bpm: bm.bpm || 120,
                    startTimeOffset: bm.startTimeOffset || 0,
                    notes: bm.notes || [],
                    triggers: bm.triggers || [],
                },
            };
        }

        // 구버전: 단일 비트맵이 최상위 필드로 바로 있음
        return {
            songName: raw.songName || '',
            artist: null,
            beatmapCount: 1,
            beatmap: {
                difficultyLabel: raw.difficultyLabel || '기본',
                laneCount: raw.laneCount || 4,
                bpm: raw.bpm || 120,
                startTimeOffset: raw.startTimeOffset || 0,
                notes: raw.notes || [],
                triggers: raw.triggers || [],
            },
        };
    },

    // 에디터에서 지금 편집 중인 비트맵 하나를 v2 포맷으로 감싸서 저장용 객체를 만든다.
    // (여러 난이도를 한 파일에 같이 담아 저장하는 UI는 Phase 3에서 추가 예정 — 지금은 beatmaps 길이 항상 1)
    wrap({ songName, artist, difficultyLabel, laneCount, bpm, startTimeOffset, notes, triggers }) {
        return {
            formatVersion: this.CURRENT_VERSION,
            songName: songName || '',
            artist: artist || null,
            beatmaps: [
                {
                    difficultyLabel: difficultyLabel || '기본',
                    laneCount: laneCount || 4,
                    bpm,
                    startTimeOffset,
                    notes,
                    triggers,
                },
            ],
        };
    },
};