const CONFIG = {
    DIFFICULTY_SPEED: { easy: 4, normal: 7, hard: 10 },
    NOTE_SPAWN_SPEED: { easy: 1.0, normal: 1.5, hard: 2.0 }, // 노트 생성 속도 배율
    JUDGEMENT_WINDOWS_MS: { perfect: 50, good: 100, bad: 150, miss: 200 },
    VALID_LANES: [4, 5, 6, 7, 8],
    SIMULTANEOUS_NOTE_PROBABILITY: {
        easy: 0.1,
        normal: 0.25,
        hard: 0.4,
    },
    // 최대 동시타 개수 설정
    MAX_SIMULTANEOUS_NOTES: {
        easy: 2,
        normal: 3,
        hard: 4,
    },
    // 동시타 내 노트 타입별 확률
    SIMULTANEOUS_NOTE_TYPE_PROBABILITY: {
        easy: { tap: 0.9, long: 0.05, false: 0.05 },
        normal: { tap: 0.7, long: 0.2, false: 0.1 },
        hard: { tap: 0.6, long: 0.25, false: 0.15 },
    },
    LONG_NOTE_PROBABILITY: {
        easy: 0.1,
        normal: 0.15,
        hard: 0.2,
    },
    FALSE_NOTE_PROBABILITY: {
        easy: 0,
        normal: 0,
        hard: 0.03, // 3%
    },
    EDITOR_LANE_IDS: ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'],
    KEY_BINDING_IDS: ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'],
    
    DEFAULT_KEYS: {
        L4: 'A', L3: 'S', L2: 'D', L1: 'F',
        C1: 'Space',
        R1: 'J', R2: 'K', R3: 'L', R4: 'Semicolon'
    },

    // 레인 수별 독립 키 설정의 기본값. 인덱스는 왼쪽부터 순서(=LANE_KEY_MAPPING_ORDER와 동일 순서).
    // 기존 DEFAULT_KEYS(레인 id 기준)와 값은 동일하게 유지해 기본 조작감이 바뀌지 않도록 함.
    DEFAULT_KEYS_BY_LANES: {
        4: ['D', 'F', 'J', 'K'],
        5: ['D', 'F', 'Space', 'J', 'K'],
        6: ['S', 'D', 'F', 'J', 'K', 'L'],
        7: ['S', 'D', 'F', 'Space', 'J', 'K', 'L'],
        8: ['A', 'S', 'D', 'F', 'J', 'K', 'L', 'Semicolon'],
    },

    LANE_KEY_MAPPING_ORDER: {
        4: ['L2', 'L1', 'R1', 'R2'],
        5: ['L2', 'L1', 'C1', 'R1', 'R2'],
        6: ['L3', 'L2', 'L1', 'R1', 'R2', 'R3'],
        7: ['L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3'],
        8: ['L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4'],
    },

    // 레인 수(laneCount)에 대한 기본 키 매핑(레인 id -> 키)을 생성해서 반환.
    // LANE_KEY_MAPPING_ORDER와 DEFAULT_KEYS_BY_LANES를 순서대로 짝지어 만든다.
    getDefaultKeyMap(laneCount) {
        const order = this.LANE_KEY_MAPPING_ORDER[laneCount];
        const keys = this.DEFAULT_KEYS_BY_LANES[laneCount];
        if (!order || !keys) return { ...this.DEFAULT_KEYS };
        const map = {};
        order.forEach((id, i) => { map[id] = keys[i]; });
        return map;
    },

    KEY_CODES: {
        A: 65, S: 83, D: 68, F: 70, J: 74, K: 75, L: 76, Space: 32, Semicolon: 186
    },
    POINTS: { perfect: 10, good: 5, bad: 2, miss: 0 },
    NOTE_COUNT_MIN: 10,
    NOTE_COUNT_MAX: 500,
    DEFAULT_NOTE_COUNT: 100,
    NOTE_SPACING_FACTOR: 20,
    FEEDBACK_DURATION_MS: 50,
    MESSAGE_DURATION_MS: 3000,
    JUDGEMENT_ANIMATION_MS: 300,
    EDITOR_BEAT_HEIGHT: 20,
    EDITOR_ZOOM_DIVISION: 32, // 에디터 타임라인 줌을 이 분할값(1/32)에 고정
    EDITOR_KEY_LANE_MAP: {
        'KeyQ': 'L4', 'KeyW': 'L3', 'KeyE': 'L2', 'KeyR': 'L1',
        'KeyT': 'C1',
        'KeyY': 'R1', 'KeyU': 'R2', 'KeyI': 'R3', 'KeyO': 'R4'
    },
    EDITOR_UNDO_HISTORY_LIMIT: 50,
    NOTE_SPAWN_TIME_MS: 2000, // 노트가 화면에 나타나는 시간
    GAME_AREA_HEIGHT: 600, // 게임 영역 높이 (픽셀)
    NOTE_FALL_SPEED_FACTOR: 35, // 노트 낙하 속도 배수
};