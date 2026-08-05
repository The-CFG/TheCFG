// ── Difficulty v2: 레인별/전체 "스트레인(strain)" 모델 기반 별점 계산기 ──────────
// osu!mania의 별점 산정 방식(레인 분리 + 지수 감쇠 누적 + 구간 피크 가중합)을
// TheBeat 채보 포맷에 맞춰 재구현한 버전. 기존 difficulty.js와 인터페이스 동일
// (calculate(chartData) → 0.00~100.00, toRating(score) → 0.00~10.00) 이라
// 드롭인 교체 가능하다. 플레이 데이터는 여전히 절대 관여하지 않으며, 업로드/수정
// 시점에 한 번 계산해서 beat_charts.difficulty_score로 고정 저장하는 전제도 동일.
//
// 기존 difficulty.js 대비 바뀐 점과 이유:
//
// 1) 레인(컬럼) 구분을 도입했다.
//    기존 버전은 전체 노트 집합의 통계(NPS, 동시타 비율 등)만 봐서
//    "8000개가 4레인에 고르게 분산"과 "8000개가 1레인에 몰림"을 구분하지 못했다.
//    이건 실제 체감 난이도 차이가 가장 큰 축인데 완전히 비어있었다.
//    → 레인별 스트레인(individualStrain, 손가락 하나의 부담)과
//      전체 스트레인(overallStrain, 손 전체의 부담)을 분리해서 누적한다.
//
// 2) "평균/피크 NPS 혼합" 대신 구간별 스트레인 피크를 정렬 후 가중합한다.
//    기존 방식은 폭타 구간이 한 번 있든 여러 번 반복되든 비슷한 점수가 나왔다.
//    → 400ms 구간마다 피크 스트레인을 뽑고, 내림차순 정렬 후 0.9ⁿ 가중치로 합산.
//      어려운 구간이 많을수록 계속 쌓이게 만든다 (osu!mania와 동일한 원리).
//
// 3) BPM과 롱노트 비율을 별도 가중치로 두지 않는다.
//    - BPM 효과는 스트레인이 ms 단위 실제 노트 간격으로 계산되는 순간 자동으로 반영된다.
//      (동일한 패턴이면 BPM이 높을수록 노트 간격이 좁아지고, 그만큼 스트레인이 커짐)
//      별도 가중치를 또 두면 같은 정보를 중복 반영하게 된다.
//    - 롱노트 난이도는 "비율"이 아니라 "다른 패턴과 겹치는 방식"에서 나온다.
//      → 홀드 도중 다른 노트를 처리해야 하면 25% 가산(holdFactor),
//        홀드를 애매한 타이밍에 따로 떼야 하면 로지스틱 곡선으로 추가 가산.
//
// 4) 동시타(chord) 비율도 별도 가중치가 필요 없어졌다.
//    동시에 눌리는 노트들은 감쇠가 진행될 시간이 없는 채로 overallStrain에
//    누적되므로, 동시타가 많을수록 자연히 점수가 올라간다.
//
// 5) fallSpeed(스크롤 속도)는 유지했다.
//    이건 타이밍이 아니라 "시각적으로 노트를 읽을 여유 공간"에 관한 값이라
//    ms 기반 스트레인 모델로는 원천적으로 잡히지 않는 축이다. 다만 이 값이
//    실제로 체감 난이도에 어떻게 작용하는지(빠를수록 어려운 게 맞는지,
//    플레이 중 유저가 조절 가능한 옵션인지) 불확실하므로 영향력을 작게 두고
//    FALLSPEED_INFLUENCE 상수 하나로 조절할 수 있게 분리해뒀다.
//    체감과 안 맞으면 이 상수만 조정하거나 0으로 꺼도 된다.
//
// 단위 주의: chartData.notes[].time / triggers[].time은 기존과 동일하게 전부
// "밀리초" 값이며, 오프셋(startTimeOffset) 기준 상대시간으로 이미 저장돼 있다
// (editor-core.js의 _yToSnappedRelativeTimeMs 참고). 여기서 다시 오프셋을
// 빼거나 초 단위로 착각하면 안 된다.
const Difficulty = {
    // osu!mania Strain 스킬과 동일한 값에서 출발한다. 둘 다 "ms 단위 실제 타이밍"
    // 기반 모델이라 초기값으로 그대로 써도 스케일이 크게 어긋나지 않는다.
    // 다만 TheBeat 채보 분포(노트 밀도, BPM 범위 등)가 osu!mania와 다를 수 있으니
    // 실제 채보로 결과를 뽑아본 뒤 STRAIN_MULTIPLIER 위주로 재조정 권장.
    SECTION_LENGTH_MS: 400,      // 구간 피크를 뽑는 단위 길이
    SECTION_DECAY_WEIGHT: 0.9,   // 정렬된 구간 피크에 곱해지는 가중치 감소율
    INDIVIDUAL_DECAY_BASE: 0.125, // 레인별 스트레인 감쇠 (손가락 피로는 빨리 풀림)
    OVERALL_DECAY_BASE: 0.30,     // 전체 스트레인 감쇠 (손 전체 부담은 더 오래 남음)
    RELEASE_THRESHOLD_MS: 30,     // 롱노트 릴리즈 로지스틱 곡선의 중간점
    HOLD_FACTOR: 1.25,            // 다른 홀드가 눌린 채로 처리해야 할 때의 가산 배율
    STRAIN_MULTIPLIER: 0.018,     // 최종 스트레인 합 → 별점(0~10ish) 스케일 변환
    DEFAULT_LANE_COUNT: 4,

    SPEED_MIN: 1, SPEED_MAX: 20,       // note-fall-speed-slider의 min/max와 동일
    FALLSPEED_INFLUENCE: 0.16,         // fallSpeed가 최종 점수에 주는 최대 보정폭(±8%)
                                        // 0으로 두면 fallSpeed 영향 완전히 끔

    _clamp01(v) {
        return Math.min(1, Math.max(0, v));
    },

    _clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    },

    // value를 deltaMs 만큼 시간이 지난 것으로 보고 지수 감쇠시킨다.
    _decay(value, deltaMs, decayBase) {
        return value * Math.pow(decayBase, deltaMs / 1000);
    },

    // osu!mania DiffUtils.Logistic과 동일한 형태의 시그모이드.
    // x가 midpointOffset일 때 0.5, 그보다 작으면 0에 가깝게, 크면 1에 가깝게.
    _logistic(x, multiplier, midpointOffset) {
        return 1 / (1 + Math.exp(-multiplier * (x - midpointOffset)));
    },

    // 트리거로 중간에 bpm/fallSpeed가 바뀌는 채보를 위한 시간가중 평균.
    // (계단식 근사 — 트리거의 transitionMs 보간 구간은 무시. 난이도 산정에는 충분)
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

    // notes 배열을 "레인별 히트오브젝트" 목록으로 변환한다.
    // long_head/long_tail 쌍을 하나의 홀드 오브젝트(startTime~endTime)로 묶고,
    // tap(및 그 외 단발성 타입)은 startTime === endTime인 점 오브젝트로 취급한다.
    // (osu!mania가 Note와 HoldNote를 별개 히트오브젝트로 다루는 것과 동일한 발상)
    _buildHitObjects(notes, laneCount) {
        const sorted = notes.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
        const openHeadPerLane = new Array(laneCount).fill(null);
        const hitObjects = [];

        for (const n of sorted) {
            const lane = typeof n.lane === 'number' ? n.lane : 0;
            if (lane < 0 || lane >= laneCount) continue; // 범위 밖 레인은 방어적으로 무시

            if (n.type === 'long_tail') {
                const head = openHeadPerLane[lane];
                if (head) {
                    head.endTime = typeof n.time === 'number' ? n.time : head.startTime;
                    openHeadPerLane[lane] = null;
                }
                continue; // tail 자체는 별도 오브젝트로 만들지 않고 head에 흡수
            }

            const t = n.time || 0;
            const obj = { lane, startTime: t, endTime: t, isHold: n.type === 'long_head' };
            hitObjects.push(obj);
            if (n.type === 'long_head') openHeadPerLane[lane] = obj;
        }

        hitObjects.sort((a, b) => a.startTime - b.startTime);
        return hitObjects;
    },

    // 히트오브젝트 목록을 순서대로 훑으며 각 시점의 스트레인 값을 계산한다.
    // (레인별 individualStrain + 전체 overallStrain, osu!mania Strain.cs와 동일 구조)
    _computeStrainTrace(hitObjects, laneCount) {
        const individualStrains = new Array(laneCount).fill(0);
        const lastInLane = new Array(laneCount).fill(null); // 각 레인의 "직전" 오브젝트
        let highestIndividualStrain = 0;
        let overallStrain = 1;

        const trace = []; // [{ time, strain }]

        hitObjects.forEach((obj, idx) => {
            const deltaTime = idx === 0 ? 0 : obj.startTime - hitObjects[idx - 1].startTime;
            const prevInLane = lastInLane[obj.lane];
            const columnStrainTime = prevInLane ? obj.startTime - prevInLane.startTime : obj.startTime;

            // 이 오브젝트 시점 기준, 각 레인의 "직전" 오브젝트와 비교해서
            // 홀드 겹침/릴리즈 상황을 판단한다.
            let holdFactor = 1.0;
            let isOverlapping = false;
            let closestEndTime = Math.abs(obj.endTime - obj.startTime);

            for (let l = 0; l < laneCount; l++) {
                const prev = lastInLane[l];
                if (!prev) continue;

                // 다른 홀드가 눌린 채로 이 오브젝트를 시작~종료해야 하는 경우 가산
                if (prev.endTime > obj.endTime + 1 && obj.startTime > prev.startTime + 1) {
                    holdFactor = this.HOLD_FACTOR;
                }

                // 이 오브젝트가 다른 홀드의 몸통과 겹치며 끝나는 경우
                const overlapping =
                    prev.endTime > obj.startTime + 1 &&
                    obj.endTime > prev.endTime + 1 &&
                    obj.startTime > prev.startTime + 1;
                isOverlapping = isOverlapping || overlapping;

                closestEndTime = Math.min(closestEndTime, Math.abs(obj.endTime - prev.endTime));
            }

            const individualValue = 2.0 * holdFactor;
            const holdAddition = isOverlapping
                ? this._logistic(closestEndTime, 0.27, this.RELEASE_THRESHOLD_MS)
                : 0;
            const overallValue = (1 + holdAddition) * holdFactor;

            individualStrains[obj.lane] =
                this._decay(individualStrains[obj.lane], columnStrainTime, this.INDIVIDUAL_DECAY_BASE) +
                individualValue;

            // 동시타(같은 시각/거의 같은 시각에 여러 레인)는 그중 가장 어려운
            // 레인 스트레인만 취해서, 처리 순서에 따라 결과가 달라지지 않게 한다.
            highestIndividualStrain =
                deltaTime <= 1
                    ? Math.max(highestIndividualStrain, individualStrains[obj.lane])
                    : individualStrains[obj.lane];

            overallStrain = this._decay(overallStrain, deltaTime, this.OVERALL_DECAY_BASE) + overallValue;

            trace.push({ time: obj.startTime, strain: highestIndividualStrain + overallStrain });
            lastInLane[obj.lane] = obj;
        });

        return trace;
    },

    // 스트레인 궤적을 SECTION_LENGTH_MS 단위 구간으로 나누고, 구간별 최댓값(피크)만 남긴다.
    // (엄밀한 osu!mania 구현은 구간 경계 시점의 감쇠값까지 보간해서 평가하지만,
    //  히트오브젝트가 없는 구간에선 어차피 스트레인이 감쇠만 하므로, 오브젝트 발생
    //  시점의 스트레인 최댓값을 그 구간의 피크로 근사해도 실질적 차이는 크지 않다.
    //  다만 "노트가 아예 없는 긴 공백"의 잔여 스트레인을 반영하지 못하는 점은
    //  근사의 한계로 남겨둔다.)
    _sectionPeaks(trace) {
        if (trace.length === 0) return [];
        const peaks = new Map();
        for (const { time, strain } of trace) {
            const bucket = Math.floor(time / this.SECTION_LENGTH_MS);
            const cur = peaks.get(bucket);
            if (cur === undefined || strain > cur) peaks.set(bucket, strain);
        }
        return Array.from(peaks.values());
    },

    // chartData: { bpm, laneCount, notes, triggers, fallSpeed(또는 noteSpeed) }
    // 반환값: 0.00 ~ 100.00 (difficulty_score로 그대로 저장)
    calculate(chartData) {
        const notes = Array.isArray(chartData?.notes) ? chartData.notes : [];
        const triggers = Array.isArray(chartData?.triggers) ? chartData.triggers : [];
        const validNotes = notes.filter(n => n.type !== 'long_tail');
        if (validNotes.length === 0) return 0;

        const laneCount =
            typeof chartData.laneCount === 'number' && chartData.laneCount > 0
                ? chartData.laneCount
                : Math.max(this.DEFAULT_LANE_COUNT, ...validNotes.map(n => (typeof n.lane === 'number' ? n.lane + 1 : 0)));

        // 1) 레인별/전체 스트레인 궤적 계산
        const hitObjects = this._buildHitObjects(notes, laneCount);
        const trace = this._computeStrainTrace(hitObjects, laneCount);

        // 2) 구간 피크 추출 → 내림차순 정렬 → 가중합
        const peaks = this._sectionPeaks(trace).sort((a, b) => b - a);
        let strainSum = 0;
        let weight = 1;
        for (const peak of peaks) {
            strainSum += peak * weight;
            weight *= this.SECTION_DECAY_WEIGHT;
        }

        // 3) 별점 스케일로 변환 (osu!mania와 동일하게 대략 0~10+ 범위로 나옴)
        const starRating = strainSum * this.STRAIN_MULTIPLIER;
        let score = this._clamp(starRating * 10, 0, 100); // toRating()과 대칭되도록 *10

        // 4) fallSpeed 보정 (타이밍 기반 스트레인이 못 잡는 "시각적 여유" 축)
        const lastTimeMs = Math.max(...notes.map(n => n.time || 0), 0);
        const baseFallSpeed =
            typeof chartData.fallSpeed === 'number'
                ? chartData.fallSpeed
                : (typeof chartData.noteSpeed === 'number' ? chartData.noteSpeed : 7);
        const effectiveFallSpeed = this._timeWeightedAverage(baseFallSpeed, triggers, 'fallSpeed', lastTimeMs);
        const normSpeed = this._clamp01((effectiveFallSpeed - this.SPEED_MIN) / (this.SPEED_MAX - this.SPEED_MIN));
        const fallSpeedModifier = 1 + (normSpeed - 0.5) * this.FALLSPEED_INFLUENCE;
        score = this._clamp(score * fallSpeedModifier, 0, 100);

        return Math.round(score * 100) / 100; // 0.00~100.00
    },

    // difficulty_score(0~100) → 난이도 수치(0.00~10.00), 소수점 2자리
    toRating(difficultyScore) {
        const score = typeof difficultyScore === 'number' ? difficultyScore : 0;
        return Math.round((score / 10) * 100) / 100;
    },
};