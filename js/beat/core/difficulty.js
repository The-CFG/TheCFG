// ── Difficulty: 채보 지표만으로 별점을 계산한다 ─────────────────────────────
// 플레이 데이터(정확도/클리어율/miss율 등)는 절대 관여하지 않는다.
// 업로드/수정 시점(addBeatmapToSong / updateBeatmap)에 한 번 계산해서
// beat_charts.difficulty_score(0~100, real)로 고정 저장한다.
// → 이후 플레이 기록이 아무리 쌓여도 별점은 바뀌지 않는다 (재현 가능, 조작 불가능).
//
// 가중치: NPS 35% · 노트속도(fallSpeed) 25% · 동시타 비율 20% · 롱노트 비율 10% · BPM 10%
//        + 레인 수(4키 기준) 곱연산 보정 (다른 지표와 성격이 달라 가중합에서 분리).
const Difficulty = {
    WEIGHTS: { nps: 0.35, speed: 0.25, chord: 0.20, long: 0.10, bpm: 0.10 },
    NPS_CAP: 12,           // 이 이상 초당 노트수는 만점 처리
    SPEED_MIN: 1, SPEED_MAX: 20,  // note-fall-speed-slider의 min/max와 동일
    BPM_MIN: 60, BPM_MAX: 240,
    LANE_BASE: 4, LANE_STEP: 0.08, // 4키 기준, 1키 늘 때마다 +8%

    _clamp01(v) {
        return Math.min(1, Math.max(0, v));
    },

    // chartData: { bpm, startTimeOffset, laneCount, notes, fallSpeed(또는 noteSpeed) }
    // 반환값: 0.00 ~ 100.00 (difficulty_score로 그대로 저장)
    calculate(chartData) {
        const notes = Array.isArray(chartData?.notes) ? chartData.notes : [];
        const validNotes = notes.filter(n => n.type !== 'long_tail'); // tap/long_head/false만
        const totalNotes = validNotes.length;
        if (totalNotes === 0) return 0;

        const bpm = chartData.bpm || 120;
        const fallSpeed = typeof chartData.fallSpeed === 'number' ? chartData.fallSpeed
            : (typeof chartData.noteSpeed === 'number' ? chartData.noteSpeed : 7);
        const laneCount = chartData.laneCount || 4;
        const startOffset = chartData.startTimeOffset || 0;

        // 1) NPS (초당 노트 수)
        const lastTime = notes.reduce((max, n) => Math.max(max, n.time || 0), 0);
        const durationSec = Math.max(lastTime - startOffset, 1);
        const nps = totalNotes / durationSec;

        // 2) 동시타 비율 — 같은 timestamp에 2개 이상 노트가 겹치는 비중
        const timeGroups = {};
        validNotes.forEach(n => {
            const key = (n.time || 0).toFixed(3); // 부동소수 오차 방지
            (timeGroups[key] = timeGroups[key] || []).push(n);
        });
        const chordNoteCount = Object.values(timeGroups)
            .filter(g => g.length >= 2)
            .reduce((sum, g) => sum + g.length, 0);
        const chordRatio = chordNoteCount / totalNotes;

        // 3) 롱노트 비율
        const longCount = validNotes.filter(n => n.type === 'long_head').length;
        const longRatio = longCount / totalNotes;

        // 4) 정규화
        const normNps = this._clamp01(nps / this.NPS_CAP);
        const normSpeed = this._clamp01((fallSpeed - this.SPEED_MIN) / (this.SPEED_MAX - this.SPEED_MIN));
        const normBpm = this._clamp01((bpm - this.BPM_MIN) / (this.BPM_MAX - this.BPM_MIN));

        // 5) 가중합
        let raw = normNps * this.WEIGHTS.nps
            + normSpeed * this.WEIGHTS.speed
            + chordRatio * this.WEIGHTS.chord
            + longRatio * this.WEIGHTS.long
            + normBpm * this.WEIGHTS.bpm;

        // 6) 레인 수 보정 (4키 기준 곱연산 — 가중합과 성격이 다른 구조적 요소라 분리)
        raw *= (1 + (laneCount - this.LANE_BASE) * this.LANE_STEP);

        return Math.round(this._clamp01(raw) * 10000) / 100; // 0.00~100.00
    },

    // difficulty_score(0~100) → 별점(0.00~5.00), 소수점 2자리
    toStars(difficultyScore) {
        const score = typeof difficultyScore === 'number' ? difficultyScore : 0;
        return Math.round((score / 20) * 100) / 100;
    },
};