/**
 * SessionHistory — 연습 세션 기록 저장 + 최근 5회 추이 + 약점 기반 드릴 추천
 * ----------------------------------------------------------------
 * 연습모드-개선계획.md 2번의 마지막 항목("세션 종료 시 저장 → 최근 5회 추이 표시")과
 * 3번의 후속 항목("레인별·상황별 통계가 쌓이면 최근 성적 기준 드릴 추천 자동화")을 함께 다룬다.
 *
 * 저장 대상은 연습 모드(Game.state.settings.mode === 'random')로 끝난 세션만이다 —
 * 실제 채보 플레이(mode 'music', 온라인/로컬 곡)는 난이도가 매번 다른 곡에 좌우되므로
 * "최근 성적 추이"에 섞으면 오히려 비교가 무의미해진다.
 *
 * Supabase 동기화(로그인 시 기기 간 공유)는 계획서에도 "후속 단계"로 명시돼 있어 이번
 * 구현 범위에서는 제외 — localStorage만 사용한다.
 */
const SessionHistory = {
    STORAGE_KEY: 'theBeat_practiceSessionHistory',
    MAX_STORED: 30,      // localStorage에 쌓아두는 최대 개수(오래된 것부터 버림)
    RECENT_DISPLAY: 5,   // 결과 화면에 보여줄 개수
    RECENT_FOR_RECOMMENDATION: 5, // 드릴 추천 계산에 쓸 최근 개수

    _loadAll() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    },

    _saveAll(list) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
        } catch (err) {
            // 저장 실패해도 이번 판 결과 화면 표시에는 지장 없으므로 조용히 무시
        }
    },

    // Game.end()에서 연습 모드 세션이 끝날 때마다 호출된다.
    recordSession() {
        const s = Game.state.settings;
        const j = Game.state.judgements;
        const accuracy = UI.accuracyFromJudgements(j.perfect, j.good, j.bad, j.miss);

        const laneMissRates = {};
        const laneStats = Game.state.laneStats || {};
        for (const lane of Object.keys(laneStats)) {
            const stat = laneStats[lane];
            if (stat.total > 0) laneMissRates[lane] = (stat.miss / stat.total) * 100;
        }

        const entry = {
            date: new Date().toISOString(),
            difficulty: s.difficulty || 'custom',
            lanes: s.lanes,
            score: Game.state.score,
            accuracy,
            maxCombo: Game.state.maxCombo || 0,
            laneMissRates,
        };

        const list = this._loadAll();
        list.push(entry);
        while (list.length > this.MAX_STORED) list.shift();
        this._saveAll(list);
    },

    _difficultyLabel(key) {
        const knownKeys = ['easy', 'normal', 'hard', 'drillSpeed', 'drillComplex'];
        if (knownKeys.includes(key)) {
            const i18nKey = key === 'drillSpeed' ? 'drill_speed' : (key === 'drillComplex' ? 'drill_complex' : key);
            return I18n.t(i18nKey);
        }
        return I18n.t('custom_difficulty_label');
    },

    // 결과 화면 하단에 최근 5회(이번 판 포함) 추이를 간단한 표로 렌더링한다.
    // 연습 모드가 아니면(mode !== 'random') 컨테이너를 숨긴다.
    renderResultTrend() {
        const container = document.getElementById('final-session-history');
        if (!container) return;
        if (Game.state.settings.mode !== 'random') {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const list = this._loadAll();
        const recent = list.slice(-this.RECENT_DISPLAY).reverse(); // 최신이 위로
        if (recent.length === 0) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const rows = recent.map(entry => {
            const d = new Date(entry.date);
            const dateLabel = Number.isNaN(d.getTime())
                ? '-'
                : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `
                <div class="flex items-center justify-between text-xs text-gray-300 py-1 border-b border-gray-700 last:border-b-0">
                    <span class="text-gray-500 w-24 flex-shrink-0">${dateLabel}</span>
                    <span class="flex-1 text-center">${this._difficultyLabel(entry.difficulty)}</span>
                    <span class="w-16 flex-shrink-0 text-right">${entry.score}</span>
                    <span class="w-16 flex-shrink-0 text-right">${entry.accuracy.toFixed(1)}%</span>
                </div>`;
        }).join('');

        container.innerHTML = `
            <p class="text-sm font-semibold text-gray-300 mb-2">${I18n.t('session_history_title')}</p>
            <div>${rows}</div>`;
        container.classList.remove('hidden');
    },

    // 최근 N회(같은 레인 수 설정만) 통계를 바탕으로 순발력/복합 패턴 드릴 중 하나를 추천한다.
    // 데이터가 부족하거나(3회 미만) 이미 성적이 충분히 좋으면(정확도 96% 이상) 배너를 숨긴다.
    // 판단 기준: 레인별 평균 미스율의 편차가 크면(손 꼬임 의심) → 복합 패턴, 그렇지 않고
    // 전반적으로 정확도가 낮으면(속도를 못 따라감) → 순발력. 정교한 판정이 아니라 대략적인
    // 방향 제시임을 배너 문구에서도 "추천"이라는 완곡한 표현으로 남긴다.
    _computeRecommendation() {
        const currentLanes = Game.state.settings.lanes;
        const list = this._loadAll()
            .filter(e => e.lanes === currentLanes)
            .slice(-this.RECENT_FOR_RECOMMENDATION);

        if (list.length < 3) return null;

        const avgAccuracy = list.reduce((sum, e) => sum + e.accuracy, 0) / list.length;
        if (avgAccuracy >= 96) return null; // 이미 잘하고 있으면 굳이 추천하지 않는다

        // 레인별 평균 미스율 집계
        const laneSums = {};
        const laneCounts = {};
        for (const entry of list) {
            for (const lane of Object.keys(entry.laneMissRates || {})) {
                laneSums[lane] = (laneSums[lane] || 0) + entry.laneMissRates[lane];
                laneCounts[lane] = (laneCounts[lane] || 0) + 1;
            }
        }
        const laneAverages = Object.keys(laneSums).map(lane => laneSums[lane] / laneCounts[lane]);

        let stdev = 0;
        if (laneAverages.length >= 2) {
            const mean = laneAverages.reduce((a, b) => a + b, 0) / laneAverages.length;
            const variance = laneAverages.reduce((sum, v) => sum + (v - mean) ** 2, 0) / laneAverages.length;
            stdev = Math.sqrt(variance);
        }

        if (stdev > 12) {
            return { drill: 'drillComplex', count: list.length, stdev: Math.round(stdev) };
        }
        return { drill: 'drillSpeed', count: list.length, accuracy: avgAccuracy };
    },

    // 연습 화면에 들어올 때마다 호출 — 추천이 있으면 배너를 채우고, 없으면 숨긴다.
    renderRecommendation() {
        const banner = document.getElementById('drill-recommendation-banner');
        if (!banner) return;
        const rec = this._computeRecommendation();
        if (!rec) {
            banner.classList.add('hidden');
            banner.innerHTML = '';
            return;
        }

        const drillName = I18n.t(rec.drill === 'drillComplex' ? 'drill_complex' : 'drill_speed');
        const message = rec.drill === 'drillComplex'
            ? I18n.t('drill_recommendation_complex', { count: rec.count, std: rec.stdev })
            : I18n.t('drill_recommendation_speed', { count: rec.count, accuracy: rec.accuracy.toFixed(1) });

        banner.innerHTML = `
            <p>${message}</p>
            <button id="drill-recommendation-cta" class="mt-2 py-1.5 px-3 bg-purple-700 hover:bg-purple-600 rounded text-xs font-semibold">
                ${I18n.t('drill_recommendation_cta', { drill: drillName })}
            </button>`;
        banner.classList.remove('hidden');

        const ctaBtn = document.getElementById('drill-recommendation-cta');
        if (ctaBtn) {
            ctaBtn.addEventListener('click', () => {
                const targetBtn = document.querySelector(`#drill-selector button[data-difficulty="${rec.drill}"]`);
                if (targetBtn) {
                    targetBtn.click();
                    targetBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        }
    },
};