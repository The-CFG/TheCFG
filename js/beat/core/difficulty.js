// ── Difficulty: 채보 지표만으로 별점을 계산한다 ─────────────────────────────
// 플레이 데이터(정확도/클리어율/miss율 등)는 절대 관여하지 않는다.
// 업로드/수정 시점(addBeatmapToSong / updateBeatmap)에 한 번 계산해서
// beat_charts.difficulty_score(0~100, real)로 고정 저장한다.
// → 이후 플레이 기록이 아무리 쌓여도 별점은 바뀌지 않는다 (재현 가능, 조작 불가능).
//
// 가중치: NPS 35% · 노트속도(fallSpeed) 25% · 동시타 비율 20% · 롱노트 비율 10% · BPM 10%
//        + 레인 수(4키 기준) 곱연산 보정 (다른 지표와 성격이 달라 가중합에서 분리).
//
// 단위 주의: chartData.notes[].time / triggers[].time은 모두 "밀리초" 값이며,
// 오프셋(startTimeOffset) 기준 상대시간으로 이미 저장돼 있다
// (editor-core.js의 _yToSnappedRelativeTimeMs 참고). 여기서 다시 오프셋을
// 빼거나 초 단위로 착각하면 NPS가 완전히 틀어지므로 주의.
const Difficulty = {
    WEIGHTS: { nps: 0.35, speed: 0.25, chord: 0.20, long: 0.10, bpm: 0.10 },
    NPS_CAP: 12,           // 이 이상 초당 노트수는 만점 처리
    SPEED_MIN: 1, SPEED_MAX: 20,  // note-fall-speed-slider의 min/max와 동일
    BPM_MIN: 60, BPM_MAX: 240,
    LANE_BASE: 4, LANE_STEP: 0.08, // 4키 기준, 1키 늘 때마다 +8%

    _clamp01(v) {
        return Math.min(1, Math.max(0, v));
    },

    // 트리거로 중간에 bpm/fallSpeed가 바뀌는 채보를 위한 시간가중 평균.
    // baseValue가 t=0부터 첫 트리거 전까지 적용되고, 이후 각 트리거 값이
    // 다음 트리거(또는 채보 끝)까지 적용된다고 보고 구간 길이로 가중 평균한다.
    // (트리거의 transitionMs 보간 구간은 무시하고 계단식으로 근사 — 난이도 산정에는 충분)
    // triggers: [{ time(ms), bpm, fallSpeed }, ...], totalDurationMs: 채보 전체 길이(ms)
    _timeWeightedAverage(baseValue, triggers, field, totalDurationMs) {
        if (!Array.isArray(triggers) || triggers.length === 0 || totalDurationMs <= 0) {
            return baseValue;
        }
        const sorted = triggers.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
        let weightedSum = 0;
        let cursor = 0;
        let currentValue = baseValue;
        for (const trig of sorted) {
            const segEnd = Math.min(Math.max(trig.time || 0, 0), totalDurationMs);
            if (segEnd > cursor) {
                weightedSum += currentValue * (segEnd - cursor);
                cursor = segEnd;
            }
            if (typeof trig[field] === 'number') currentValue = trig[field];
        }
        if (cursor < totalDurationMs) {
            weightedSum += currentValue * (totalDurationMs - cursor);
        }
        return weightedSum / totalDurationMs;
    },

    // chartData: { bpm, laneCount, notes, triggers, fallSpeed(또는 noteSpeed) }
    // 반환값: 0.00 ~ 100.00 (difficulty_score로 그대로 저장)
    calculate(chartData) {
        const notes = Array.isArray(chartData?.notes) ? chartData.notes : [];
        const triggers = Array.isArray(chartData?.triggers) ? chartData.triggers : [];
        const validNotes = notes.filter(n => n.type !== 'long_tail'); // tap/long_head/false만
        const totalNotes = validNotes.length;
        if (totalNotes === 0) return 0;

        const baseBpm = chartData.bpm || 120;
        const baseFallSpeed = typeof chartData.fallSpeed === 'number' ? chartData.fallSpeed
            : (typeof chartData.noteSpeed === 'number' ? chartData.noteSpeed : 7);
        const laneCount = chartData.laneCount || 4;

        // 1) NPS (초당 노트 수) — note.time은 ms, 이미 오프셋 기준 상대시간이므로 그대로 씀
        const lastTimeMs = notes.reduce((max, n) => Math.max(max, n.time || 0), 0);
        const durationSec = Math.max(lastTimeMs / 1000, 1);
        const nps = totalNotes / durationSec;

        // 2) 동시타 비율 — 같은 timestamp(ms)에 2개 이상 노트가 겹치는 비중
        const timeGroups = {};
        validNotes.forEach(n => {
            const key = Math.round(n.time || 0); // ms 정수라 그대로 키로 써도 안전
            (timeGroups[key] = timeGroups[key] || []).push(n);
        });
        const chordNoteCount = Object.values(timeGroups)
            .filter(g => g.length >= 2)
            .reduce((sum, g) => sum + g.length, 0);
        const chordRatio = chordNoteCount / totalNotes;

        // 3) 롱노트 비율
        const longCount = validNotes.filter(n => n.type === 'long_head').length;
        const longRatio = longCount / totalNotes;

        // 4) 트리거 반영 시간가중 평균 BPM/속도 (트리거 없으면 baseBpm/baseFallSpeed 그대로)
        const effectiveBpm = this._timeWeightedAverage(baseBpm, triggers, 'bpm', lastTimeMs);
        const effectiveFallSpeed = this._timeWeightedAverage(baseFallSpeed, triggers, 'fallSpeed', lastTimeMs);

        // 5) 정규화
        const normNps = this._clamp01(nps / this.NPS_CAP);
        const normSpeed = this._clamp01((effectiveFallSpeed - this.SPEED_MIN) / (this.SPEED_MAX - this.SPEED_MIN));
        const normBpm = this._clamp01((effectiveBpm - this.BPM_MIN) / (this.BPM_MAX - this.BPM_MIN));

        // 6) 가중합
        let raw = normNps * this.WEIGHTS.nps
            + normSpeed * this.WEIGHTS.speed
            + chordRatio * this.WEIGHTS.chord
            + longRatio * this.WEIGHTS.long
            + normBpm * this.WEIGHTS.bpm;

        // 7) 레인 수 보정 (4키 기준 곱연산 — 가중합과 성격이 다른 구조적 요소라 분리)
        raw *= (1 + (laneCount - this.LANE_BASE) * this.LANE_STEP);

        return Math.round(this._clamp01(raw) * 10000) / 100; // 0.00~100.00
    },

    // difficulty_score(0~100) → 난이도 수치(0.00~10.00), 소수점 2자리
    toRating(difficultyScore) {
        const score = typeof difficultyScore === 'number' ? difficultyScore : 0;
        return Math.round((score / 10) * 100) / 100;
    },
};