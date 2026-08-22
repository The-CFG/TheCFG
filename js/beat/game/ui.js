const UI = {
    // 현재 표시 중인 화면 키 (DOM.screens의 키와 동일). showScreen() 호출마다 갱신된다.
    // 설정 화면을 닫을 때 "실제로 어느 화면에 있었는지"를 정확히 복원하기 위해 쓴다.
    currentScreen: 'menu',

    showScreen(screenName) {
        Object.values(DOM.screens).forEach(screen => screen.classList.add('hidden'));
        DOM.screens[screenName].classList.remove('hidden');
        this.currentScreen = screenName;

        // 접기 핸들은 게임플레이 화면(#playing-screen)에서만 노출.
        // 플레이 화면을 벗어나면 접힌 패널도 항상 다시 펼쳐 다른 화면이 가려지지 않게 한다.
        const appShell = document.getElementById('app-shell');
        if (appShell) {
            const isPlaying = screenName === 'playing';
            appShell.classList.toggle('in-play', isPlaying);
            // 데스크톱(1024px 이상)에서는 채보 편집 영역(#editor-container)이 editor-layout.js에
            // 의해 좌측 #game-area 위 오버레이로 옮겨진다 — 그 오버레이를 이 화면일 때만 노출한다
            // (css/beat/editor.css의 #app-shell.in-editor 규칙 참고). 좁은 화면에서는 오버레이
            // 클래스 자체가 안 붙으므로(editor-layout.js) 이 토글은 영향이 없다.
            appShell.classList.toggle('in-editor', screenName === 'editor');
            // 플레이 화면에 들어갈 때는 "게임플레이 시 우측 화면 숨기기" 설정값을 그대로 적용.
            // (기존에는 여기서 아무 것도 안 해서 이전 화면의 접힘 상태가 그대로 남아있었음)
            // 단, 일시정지 중(예: 설정 화면 갔다 되돌아온 경우)에는 패널을 계속 펼쳐둔다.
            if (isPlaying) {
                this.setPanelCollapsed(!Game.state.isPaused && Game.state.settings.autoHideUiOnPlay === true);
            } else {
                this.setPanelCollapsed(false);
            }
        }
    },
    showMessage(type, message) {
        const el = DOM.messages[type];
        if (!el) return;
        el.textContent = message;
        el.classList.remove('hidden');
        setTimeout(() => {
            el.classList.add('hidden');
        }, CONFIG.MESSAGE_DURATION_MS);
    },
    // 로딩 서클(spinner) — 버튼/인라인 문구 옆에 붙이는 작은 원형 스피너 마크업.
    // "불러오는 중" 류의 문구가 뜨는 모든 곳에서 이걸로 통일해서 쓴다.
    // sizeCls: 크기(w-4 h-4 등), colorCls: 테두리 색(border-teal-400 등, border-t만 투명 처리됨).
    spinnerHtml(sizeCls = 'w-4 h-4', colorCls = 'border-teal-400') {
        return `<span class="inline-block ${sizeCls} border-2 ${colorCls} border-t-transparent rounded-full animate-spin flex-shrink-0"></span>`;
    },
    // 화면/영역 전체를 "불러오는 중" 상태로 채울 때 쓰는 블록(스피너 + 문구, 세로 중앙 정렬).
    // 목록/상세 화면이 데이터를 받아오는 동안 this._setContent(UI.loadingBlockHtml())처럼 통째로 넣는 용도.
    loadingBlockHtml(text = '불러오는 중…') {
        return `<div class="flex flex-col items-center gap-2 mt-8 text-gray-400 text-sm">
            ${this.spinnerHtml('w-6 h-6')}
            <span>${text}</span>
        </div>`;
    },
    // 버튼/인라인 한 줄 안에 스피너+문구를 나란히 넣을 때 쓰는 조각.
    // 예: btn.innerHTML = UI.loadingInlineHtml('업로드 중…')
    loadingInlineHtml(text = '불러오는 중…') {
        return `<span class="inline-flex items-center justify-center gap-2">${this.spinnerHtml('w-4 h-4', 'border-current')}${text}</span>`;
    },
    // ── 스켈레톤(자리 채움) 마크업 ──────────────────────────────────
    // "무엇을 불러오는 중인지"는 이제 좌측 game-area 오버레이(showAreaLoading)가 말로
    // 알려주므로, 콘텐츠 영역 자체는 문구 없이 카드 모양만 어렴풋이 반짝이며 보여준다
    // (레이아웃이 로딩 전후로 갑자기 들썩이는 것도 방지).
    //
    // listSkeletonHtml: online.js의 목록 카드(_chartCard/_beatmapCard)나
    // editor-home.js의 노래 목록처럼, 같은 모양 카드가 여러 개 쌓이는 화면용.
    listSkeletonHtml(count = 4) {
        const card = `
        <div class="w-full p-3 bg-gray-800 rounded-lg animate-pulse">
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0 space-y-2">
                    <div class="h-4 bg-gray-700 rounded w-2/3"></div>
                    <div class="h-3 bg-gray-700 rounded w-1/3"></div>
                </div>
                <div class="flex flex-col items-end space-y-2 ml-2 flex-shrink-0">
                    <div class="h-3 bg-gray-700 rounded w-16"></div>
                    <div class="h-3 bg-gray-700 rounded w-10"></div>
                </div>
            </div>
        </div>`;
        return `<div class="space-y-2">${card.repeat(count)}</div>`;
    },
    // staticSkeletonHtml: online.js의 노래/난이도 상세, lobby.js의 대기실처럼
    // 카드 목록이 아니라 제목+본문 형태 단일 페이지용. 헤더 블록 하나 + 본문 줄
    // 몇 개로 대충의 레이아웃 형태만 잡아준다(정확한 구조는 화면마다 다르므로
    // 범용적인 뼈대만 제공).
    staticSkeletonHtml() {
        return `
        <div class="animate-pulse">
            <div class="h-4 bg-gray-700 rounded w-24 mb-4"></div>
            <div class="p-4 bg-gray-800 rounded-lg space-y-3">
                <div class="h-5 bg-gray-700 rounded w-1/2"></div>
                <div class="h-3 bg-gray-700 rounded w-1/3"></div>
                <div class="h-3 bg-gray-700 rounded w-full"></div>
                <div class="h-3 bg-gray-700 rounded w-2/3"></div>
            </div>
            <div class="mt-4 space-y-2">
                <div class="h-14 bg-gray-800 rounded-lg"></div>
                <div class="h-14 bg-gray-800 rounded-lg"></div>
            </div>
        </div>`;
    },
    // ── 좌측 game-area 로딩 오버레이 ──────────────────────────────────
    // 예전엔 "불러오는 중" 류 문구를 우측 ui-area의 작은 토스트(showMessage)로만
    // 띄워서 로딩 중인지 알아채기 어려웠다. 훨씬 눈에 잘 띄는 좌측 game-area
    // 전체에 오버레이로 띄우고, 무엇을 불러오는 중인지 구체적으로 밝힌다.
    // key로 여러 로딩을 동시에 추적한다 (예: 사진+음악이 한꺼번에 로딩 중이어도
    // 하나가 먼저 끝났다고 표시가 통째로 사라지지 않도록).
    _areaLoads: {},
    showAreaLoading(key, text = '불러오는 중…') {
        this._areaLoads[key] = text;
        this._renderAreaLoading();
    },
    hideAreaLoading(key) {
        delete this._areaLoads[key];
        this._renderAreaLoading();
    },
    _renderAreaLoading() {
        const el = document.getElementById('game-area-loading');
        const textEl = document.getElementById('game-area-loading-text');
        if (!el || !textEl) return;
        const texts = Object.values(this._areaLoads);
        if (texts.length === 0) {
            el.classList.add('hidden');
            textEl.innerHTML = '';
            return;
        }
        textEl.innerHTML = texts.map(t => `<div>${t}</div>`).join('');
        el.classList.remove('hidden');
    },
    updateScoreboard() {
        DOM.scoreEl.textContent = Game.state.score;
        DOM.comboEl.textContent = Game.state.combo;
        document.getElementById('perfect-count').textContent = Game.state.judgements.perfect;
        document.getElementById('good-count').textContent = Game.state.judgements.good;
        document.getElementById('bad-count').textContent = Game.state.judgements.bad;
        document.getElementById('miss-count').textContent = Game.state.judgements.miss;
    },
    showJudgementFeedback(judgement, currentCombo) {
        DOM.judgementTextEl.textContent = judgement;
        DOM.judgementTextEl.className = 'judgement-text';
        void DOM.judgementTextEl.offsetWidth;
        DOM.judgementTextEl.classList.add('show');
        setTimeout(() => DOM.judgementTextEl.classList.remove('show'), CONFIG.JUDGEMENT_ANIMATION_MS);

        if (currentCombo > 2) {
            DOM.comboTextEl.textContent = `${currentCombo} COMBO`;
            DOM.comboTextEl.className = 'combo-text';
            void DOM.comboTextEl.offsetWidth;
            DOM.comboTextEl.classList.add('show');
            setTimeout(() => DOM.comboTextEl.classList.remove('show'), CONFIG.JUDGEMENT_ANIMATION_MS);
        }
    },
    // 정확도(%) → 랭크(S/A/B/C) 계산. calculateRank와 HUD 예상 등급에서 공용으로 쓴다.
    rankFromPercentage(percentage) {
        if (percentage === 100) return 'S';
        if (percentage >= 90) return 'A';
        if (percentage >= 70) return 'B';
        return 'C';
    },
    // 점수/총 노트 수 → 랭크(S/A/B/C) 계산. ⚠️ 롱노트가 있으면 totalNotes(long_tail 제외 카운트)와
    // 실제 판정 개수(head+tail 각각 판정됨)가 어긋나 100%를 넘어서는 경우가 생겨 등급이 잘못
    // 나올 수 있다 — 더 이상 쓰지 않는다. updateResultScreen()은 rankFromJudgements()를 쓴다.
    calculateRank(score, totalNotes) {
        if (!totalNotes || totalNotes <= 0) return 'C';
        const maxScore = totalNotes * CONFIG.POINTS.perfect;
        const percentage = (score / maxScore) * 100;
        return this.rankFromPercentage(percentage);
    },
    // PERFECT/GOOD/BAD/MISS 개수 → 랭크(S/A/B/C) 계산. 서버에 저장된 판정 개수로부터
    // 직접 계산하므로, 온라인 리더보드처럼 note_count 등 별도 값 없이도 정확한 등급을 매길 수 있다.
    // 결과 화면(로컬 플레이 직후)과 리더보드가 항상 같은 등급을 보여주도록 두 곳 다 이 함수만 쓴다.
    rankFromJudgements(perfect, good, bad, miss) {
        perfect = perfect || 0; good = good || 0; bad = bad || 0; miss = miss || 0;
        const judgedCount = perfect + good + bad + miss;
        if (judgedCount === 0) return 'C';
        const percentage = ((perfect * CONFIG.POINTS.perfect + good * CONFIG.POINTS.good + bad * CONFIG.POINTS.bad)
            / (judgedCount * CONFIG.POINTS.perfect)) * 100;
        return this.rankFromPercentage(percentage);
    },
    // PERFECT/GOOD/BAD/MISS 개수 → 정확도(%). 인게임 HUD와 결과 화면이 같은 공식을 쓰도록 공용화.
    accuracyFromJudgements(perfect, good, bad, miss) {
        perfect = perfect || 0; good = good || 0; bad = bad || 0; miss = miss || 0;
        const judgedCount = perfect + good + bad + miss;
        if (judgedCount === 0) return 100;
        return ((perfect * CONFIG.POINTS.perfect + good * CONFIG.POINTS.good + bad * CONFIG.POINTS.bad)
            / (judgedCount * CONFIG.POINTS.perfect)) * 100;
    },
    updateResultScreen() {
        DOM.finalScoreEl.textContent = Game.state.score;
        const j = Game.state.judgements;
        DOM.rankEl.textContent = this.rankFromJudgements(j.perfect, j.good, j.bad, j.miss);
        DOM.finalPerfectEl.textContent = Game.state.judgements.perfect;
        DOM.finalGoodEl.textContent = Game.state.judgements.good;
        DOM.finalBadEl.textContent = Game.state.judgements.bad;
        DOM.finalMissEl.textContent = Game.state.judgements.miss;

        // 정확도 / 최대 콤보 — 이미 계산·집계되는 값이라 화면에 노출만 하면 됨.
        if (DOM.finalAccuracyEl) {
            const accuracy = this.accuracyFromJudgements(j.perfect, j.good, j.bad, j.miss);
            DOM.finalAccuracyEl.textContent = `${accuracy.toFixed(2)}%`;
        }
        if (DOM.finalMaxComboEl) {
            DOM.finalMaxComboEl.textContent = Game.state.maxCombo || 0;
        }

        // 빠름/느림 판정 타이밍 편향
        if (DOM.finalEarlyLateEl) {
            const el = Game.state.earlyLateStats || { early: 0, late: 0 };
            const total = el.early + el.late;
            if (total === 0) {
                DOM.finalEarlyLateEl.textContent = '-';
            } else {
                DOM.finalEarlyLateEl.textContent = `${I18n.t ? I18n.t('early') : '빠름'} ${el.early} / ${I18n.t ? I18n.t('late') : '느림'} ${el.late}`;
            }
        }

        // 레인별 미스율 미니 바 차트
        this.renderLaneMissStats();
    },
    // Game.state.laneStats({ [lane]: {total, miss} })를 레인 순서대로 미니 바 차트로 그린다.
    // 판정 UI에서만 쓰는 결과 화면 전용 렌더러 — 레인 수는 settings.lanes 기준으로 처음부터 끝까지 채운다
    // (한 번도 판정이 안 난 레인은 0%로 표시해 "이 레인은 아예 안 눌렀다"도 알 수 있게 함).
    renderLaneMissStats() {
        const container = document.getElementById('final-lane-stats');
        if (!container) return;
        const laneCount = (Game.state.settings && Game.state.settings.lanes) || 0;
        const laneStats = Game.state.laneStats || {};
        if (!laneCount) {
            container.innerHTML = '';
            container.classList.add('hidden');
            return;
        }
        const rows = [];
        for (let lane = 0; lane < laneCount; lane++) {
            const s = laneStats[lane] || { total: 0, miss: 0 };
            const missRate = s.total > 0 ? (s.miss / s.total) * 100 : 0;
            rows.push(`
                <div class="flex items-center gap-2 text-sm">
                    <span class="w-14 flex-shrink-0 text-gray-400">${I18n.t ? I18n.t('lane') : '레인'} ${lane + 1}</span>
                    <div class="flex-1 h-3 bg-gray-600 rounded-full overflow-hidden">
                        <div class="h-full bg-red-500" style="width: ${missRate.toFixed(1)}%"></div>
                    </div>
                    <span class="w-16 flex-shrink-0 text-right text-gray-300">${s.total > 0 ? missRate.toFixed(0) + '%' : '-'}</span>
                </div>`);
        }
        container.innerHTML = `
            <p class="text-sm font-semibold text-gray-300 mb-2">${I18n.t ? I18n.t('lane_miss_rate') : '레인별 미스율'}</p>
            <div class="space-y-1.5">${rows.join('')}</div>`;
        container.classList.remove('hidden');
    },
    // 인게임 HUD: 남은 시간(마지막 노트 기준) / 현재 정확도(판정 가중 평균) 갱신.
    // remainingMs: 남은 시간(ms, 음수 가능 → 0으로 클램프). accuracyPercent: 0~100.
    updateHud(remainingMs, accuracyPercent) {
        if (DOM.hudTimeEl) {
            const clampedMs = Math.max(0, remainingMs);
            const totalSec = Math.floor(clampedMs / 1000);
            const min = Math.floor(totalSec / 60);
            const sec = totalSec % 60;
            DOM.hudTimeEl.textContent = `${min}:${String(sec).padStart(2, '0')}`;
            DOM.hudTimeEl.classList.toggle('game-hud-warning', clampedMs <= 5000);
        }
        if (DOM.hudAccuracyEl) {
            DOM.hudAccuracyEl.textContent = `${accuracyPercent.toFixed(2)}%`;
        }
        if (DOM.hudRankEl) {
            // 현재까지의 정확도(판정 가중 평균)를 그대로 유지한다고 가정했을 때의 예상 등급.
            const expectedRank = this.rankFromPercentage(accuracyPercent);
            DOM.hudRankEl.textContent = expectedRank;
            DOM.hudRankEl.classList.remove('rank-S', 'rank-A', 'rank-B', 'rank-C');
            DOM.hudRankEl.classList.add(`rank-${expectedRank}`);
        }
    },
    // ── 멀티플레이 관전 HUD: 상대 닉네임 + 점수/콤보 표시 전용 ──────────────────────
    // opponents: [{ user_id, nickname }] — 자기 자신은 제외된 목록.
    // selfUserId/selfNickname을 넘기면 내 점수도 같은 행 목록에 포함해서 그린다
    // (이후 progress 브로드캐스트 처리부에서 updateSpectateHud로 내 row도 갱신함).
    // 게임 시작 시 한 번 골격(닉네임 행)을 그려두고, 이후 'progress' 브로드캐스트가
    // 올 때마다 updateSpectateHud로 숫자만 갱신한다(매번 다시 그리지 않음).
    showSpectateHud(opponents, selfUserId = null, selfNickname = null) {
        if (!DOM.spectateHudEl) return;
        const rows = [...(opponents || [])];
        if (selfUserId) rows.push({ user_id: selfUserId, nickname: selfNickname, self: true });
        if (rows.length === 0) {
            this.hideSpectateHud();
            return;
        }
        DOM.spectateHudEl.innerHTML = rows.map(o => `
            <div class="mp-spectate-row${o.self ? ' mp-spectate-self' : ''}" data-user-id="${_esc(o.user_id)}">
                <span class="mp-spectate-name">${_esc(o.nickname || o.user_id.slice(0, 8))}${o.self ? ' (나)' : ''}</span>
                <span class="mp-spectate-score" data-score="0">0</span>
                <span class="mp-spectate-combo">0 combo</span>
            </div>`).join('');
        DOM.spectateHudEl.classList.remove('hidden');
    },
    // progressByUserId: { [user_id]: { score, accuracy, combo } } — 상대들의 마지막 broadcast 값.
    updateSpectateHud(progressByUserId) {
        if (!DOM.spectateHudEl || !progressByUserId) return;
        Object.keys(progressByUserId).forEach(userId => {
            const row = DOM.spectateHudEl.querySelector(`[data-user-id="${CSS.escape(userId)}"]`);
            if (!row) return;
            const p = progressByUserId[userId];
            const scoreEl = row.querySelector('.mp-spectate-score');
            const comboEl = row.querySelector('.mp-spectate-combo');
            if (scoreEl) scoreEl.dataset.score = Math.round(p.score || 0);
            if (scoreEl) scoreEl.textContent = Math.round(p.score || 0);
            if (comboEl) {
                comboEl.dataset.combo = p.combo || 0;
                comboEl.textContent = `${p.combo || 0} combo`;
            }
        });
        // 점수 내림차순으로 행을 다시 정렬 — DOM 순서만 바꾸므로 각 행의 리스너/상태는 그대로 유지된다.
        const rows = Array.from(DOM.spectateHudEl.querySelectorAll('.mp-spectate-row'));
        rows.sort((a, b) => {
            const scoreA = Number(a.querySelector('.mp-spectate-score')?.dataset.score || 0);
            const scoreB = Number(b.querySelector('.mp-spectate-score')?.dataset.score || 0);
            return scoreB - scoreA;
        });
        rows.forEach(row => DOM.spectateHudEl.appendChild(row));
    },
    // onlineIds: presence sync 스냅샷의 키(user_id) 집합. 여기 없는 상대는 연결이 끊긴 것으로 표시.
    updateSpectateConnectionStatus(opponents, onlineIds) {
        if (!DOM.spectateHudEl || !onlineIds) return;
        (opponents || []).forEach(o => {
            const row = DOM.spectateHudEl.querySelector(`[data-user-id="${CSS.escape(o.user_id)}"]`);
            if (!row) return;
            const offline = !onlineIds.has(o.user_id);
            row.classList.toggle('mp-spectate-offline', offline);
            const comboEl = row.querySelector('.mp-spectate-combo');
            if (comboEl) comboEl.textContent = offline ? '연결 끊김' : `${comboEl.dataset.combo || 0} combo`;
        });
    },
    hideSpectateHud() {
        if (!DOM.spectateHudEl) return;
        DOM.spectateHudEl.classList.add('hidden');
        DOM.spectateHudEl.innerHTML = '';
    },
    // ── 멀티플레이 결과 비교(Phase 6): 결과 화면에서 각자 broadcast('finish')한 값을
    // 클라이언트끼리만 비교해 표시한다(서버 검증 없음). 호출될 때마다 전체를 다시 그린다 —
    // 참가자 수가 적어(관전형 스코프) 매번 새로 렌더링해도 비용이 크지 않다.
    // opponents: [{ user_id, nickname }] — 나를 제외한 참가자. results: { [user_id]: { finalScore, finalCombo, judgements } }.
    renderMultiplayerResultCompare(opponents, results, selfUserId) {
        const container = document.getElementById('mp-result-compare');
        const list = document.getElementById('mp-result-compare-list');
        if (!container || !list || !selfUserId) return;

        const entries = [
            { user_id: selfUserId, isSelf: true },
            ...(opponents || []),
        ].map(p => {
            const r = results ? results[p.user_id] : null;
            return {
                user_id: p.user_id,
                nickname: p.isSelf ? '나' : (p.nickname ? p.nickname : `${String(p.user_id).slice(0, 8)}…`),
                isSelf: !!p.isSelf,
                finished: !!r,
                finalScore: r ? r.finalScore : null,
                finalCombo: r ? r.finalCombo : null,
                rank: (r && r.judgements)
                    ? this.rankFromJudgements(r.judgements.perfect, r.judgements.good, r.judgements.bad, r.judgements.miss)
                    : null,
            };
        });

        // 완료한 참가자는 점수 내림차순으로, 아직 플레이 중인 참가자는 뒤에 원래 순서대로.
        entries.sort((a, b) => {
            if (a.finished && b.finished) return b.finalScore - a.finalScore;
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            return 0;
        });

        list.innerHTML = entries.map((e, i) => `
            <div class="flex items-center justify-between py-2 px-3 rounded-lg text-sm ${e.isSelf ? 'bg-teal-900 border border-teal-600' : 'bg-gray-700'}">
                <span class="flex items-center gap-2 text-gray-200 truncate min-w-0">
                    ${e.finished ? `<span class="text-xs text-gray-400 flex-shrink-0">${i + 1}위</span>` : ''}
                    <span class="truncate">${_esc(e.nickname)}</span>
                    ${e.isSelf ? '<span class="text-xs text-teal-400 flex-shrink-0">(나)</span>' : ''}
                </span>
                ${e.finished ? `
                <span class="flex items-center gap-2 flex-shrink-0">
                    ${e.rank ? `<span class="text-xs text-gray-400">${e.rank}</span>` : ''}
                    <span class="font-bold text-white">${Math.round(e.finalScore).toLocaleString()}</span>
                </span>` : `
                <span class="text-xs text-gray-500 flex-shrink-0">플레이 중…</span>`}
            </div>`).join('');

        container.classList.remove('hidden');
    },

    hideMultiplayerResultCompare() {
        const container = document.getElementById('mp-result-compare');
        const list = document.getElementById('mp-result-compare-list');
        if (container) container.classList.add('hidden');
        if (list) list.innerHTML = '';
    },
    // 우측 메뉴 패널(#ui-area) 접기/펼치기.
    // 접으면 #app-shell에 'ui-collapsed' 클래스가 붙어 #ui-area가 사라지고
    // #game-area(레인/노트)가 전체 폭으로 확장되어 중앙에 오도록 CSS가 처리한다.
    // 세션 간 저장하지 않는 일시적 상태 — 게임플레이 화면에 들어갈 때마다
    // "게임플레이 시 우측 화면 숨기기" 설정값에 따라 다시 결정된다.
    setPanelCollapsed(collapsed) {
        const appShell = document.getElementById('app-shell');
        const btn = DOM.panelToggleBtn;
        if (!appShell) return;
        appShell.classList.toggle('ui-collapsed', collapsed);
        if (btn) {
            const label = collapsed ? '패널 펼치기' : '패널 접기';
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    },
    // 접기/펼치기 핸들 버튼 초기화. 클릭 시 현재 상태를 그대로 반전만 시킨다.
    initPanelToggle() {
        const btn = DOM.panelToggleBtn;
        if (!btn) return;
        btn.addEventListener('click', () => {
            const appShell = document.getElementById('app-shell');
            const collapsed = !(appShell && appShell.classList.contains('ui-collapsed'));
            this.setPanelCollapsed(collapsed);
        });
    }
};

function resetPlayingScreenUI() {
    DOM.pauseGameBtn.classList.remove('hidden');
    DOM.resumeGameBtn.classList.add('hidden');
    DOM.playingStatusLabel.textContent = '플레이 중';
    DOM.settings.iconPlaying.classList.add('hidden');
}