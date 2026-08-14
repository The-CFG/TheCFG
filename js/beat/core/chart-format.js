/**
 * ChartFormat
 * -----------
 * 로컬 파일로 저장/불러오는 차트의 포맷을 다룬다.
 *
 * v2 포맷 (신규): 노래 하나에 여러 난이도(비트맵)를 한 파일에 담을 수 있음
 *   { formatVersion: 2, songName, artist, previewStartMs, startOffsetMs, timingStartMs,
 *     beatmaps: [{ difficultyLabel, laneCount, bpm, startTimeOffset, timingStartSec, notes, triggers }, ...] }
 *
 * 구버전 포맷 (기존): 노래 하나 = 비트맵 하나, 최상위에 필드가 바로 있음
 *   { songName, bpm, startTimeOffset, laneCount, notes, triggers }
 *
 * 비트맵 창(단일 난이도 편집)에서는 여전히 normalize()/wrap()으로 beatmaps[0]만 다룬다.
 * 종합 창(Phase 3, 여러 난이도를 한 번에 관리)에서는 normalizeAll()/wrapAll()로 beatmaps 배열 전체를 다룬다.
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
                    // 저장된 값이 없는(구 차트) 경우 null → game.js/editor.js에서 BPM 기반 계산값으로 대체.
                    fallSpeed: typeof bm.fallSpeed === 'number' ? bm.fallSpeed : null,
                    // 이 비트맵이 "전용 하강 속도"를 쓰도록 저장되었는지 여부. true면 플레이어의
                    // "플레이어 기본 하강 속도" 설정과 무관하게 항상 위 fallSpeed를 그대로 쓴다.
                    useCustomFallSpeed: bm.useCustomFallSpeed === true,
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
                fallSpeed: typeof raw.fallSpeed === 'number' ? raw.fallSpeed : null,
                useCustomFallSpeed: raw.useCustomFallSpeed === true,
                notes: raw.notes || [],
                triggers: raw.triggers || [],
            },
        };
    },

    // 에디터에서 지금 편집 중인 비트맵 하나를 v2 포맷으로 감싸서 저장용 객체를 만든다.
    // (여러 난이도를 한 파일에 같이 담아 저장하는 UI는 Phase 3에서 추가 예정 — 지금은 beatmaps 길이 항상 1)
    wrap({ songName, artist, difficultyLabel, laneCount, bpm, startTimeOffset, fallSpeed, useCustomFallSpeed, notes, triggers }) {
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
                    fallSpeed,
                    useCustomFallSpeed: useCustomFallSpeed === true,
                    notes,
                    triggers,
                },
            ],
        };
    },

    // ── Phase 3: 종합 창 / 비트맵 창 다중 난이도 지원 ──────────────────────
    // 신/구버전 아무 차트 파일이나 받아서 beatmaps 전체를
    // { songName, artist, beatmaps: [{ difficultyLabel, laneCount, bpm, startTimeOffset, notes, triggers }, ...] }
    // 형태로 통일해 돌려준다. normalize()와 달리 beatmaps[0]만 꺼내지 않고 배열 전체를 유지한다.
    normalizeAll(raw) {
        if (!raw || typeof raw !== 'object') {
            throw new Error('빈 차트 데이터입니다.');
        }

        if (raw.formatVersion === 2 && Array.isArray(raw.beatmaps)) {
            if (raw.beatmaps.length === 0) {
                throw new Error('차트에 난이도(비트맵)가 없습니다.');
            }
            return {
                songName: raw.songName || '',
                artist: raw.artist || null,
                previewStartMs: raw.previewStartMs || 0,
                startOffsetMs: raw.startOffsetMs || 0,
                timingStartMs: raw.timingStartMs || 0,
                beatmaps: raw.beatmaps.map(bm => ({
                    difficultyLabel: bm.difficultyLabel || '기본',
                    laneCount: bm.laneCount || 4,
                    bpm: bm.bpm || 120,
                    startTimeOffset: bm.startTimeOffset || 0,
                    fallSpeed: typeof bm.fallSpeed === 'number' ? bm.fallSpeed : null,
                    useCustomFallSpeed: bm.useCustomFallSpeed === true,
                    timingStartSec: bm.timingStartSec || 0,
                    notes: bm.notes || [],
                    triggers: bm.triggers || [],
                })),
            };
        }

        // 구버전: 단일 비트맵이 최상위 필드로 바로 있음 → beatmaps 배열 1개짜리로 변환해 하위호환 유지
        return {
            songName: raw.songName || '',
            artist: null,
            previewStartMs: 0,
            startOffsetMs: 0,
            timingStartMs: 0,
            beatmaps: [
                {
                    difficultyLabel: raw.difficultyLabel || '기본',
                    laneCount: raw.laneCount || 4,
                    bpm: raw.bpm || 120,
                    startTimeOffset: raw.startTimeOffset || 0,
                    fallSpeed: typeof raw.fallSpeed === 'number' ? raw.fallSpeed : null,
                    useCustomFallSpeed: raw.useCustomFallSpeed === true,
                    timingStartSec: 0,
                    notes: raw.notes || [],
                    triggers: raw.triggers || [],
                },
            ],
        };
    },

    // 종합 창에서 노래 메타(song) + 난이도 목록(beatmaps) 전체를 v2 포맷으로 감싸서 저장용 객체를 만든다.
    // song은 Editor.state.song(title/artist 필드) 또는 { songName, artist } 형태를 모두 받는다.
    wrapAll(song, beatmaps) {
        if (!Array.isArray(beatmaps) || beatmaps.length === 0) {
            throw new Error('저장할 난이도(비트맵)가 없습니다.');
        }
        return {
            formatVersion: this.CURRENT_VERSION,
            songName: (song && (song.title || song.songName)) || '',
            artist: (song && song.artist) || null,
            previewStartMs: Math.round(((song && song.previewStartSec) || 0) * 1000),
            startOffsetMs: Math.round(((song && song.startOffsetSec) || 0) * 1000),
            timingStartMs: Math.round(((song && song.timingStartSec) || 0) * 1000),
            beatmaps: beatmaps.map(bm => ({
                difficultyLabel: bm.difficultyLabel || '기본',
                laneCount: bm.laneCount || 4,
                bpm: bm.bpm,
                startTimeOffset: bm.startTimeOffset,
                fallSpeed: typeof bm.fallSpeed === 'number' ? bm.fallSpeed : null,
                useCustomFallSpeed: bm.useCustomFallSpeed === true,
                timingStartSec: bm.timingStartSec || 0,
                notes: bm.notes || [],
                triggers: bm.triggers || [],
            })),
        };
    },
};