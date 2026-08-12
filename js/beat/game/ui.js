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
    // 점수/총 노트 수 → 랭크(S/A/B/C) 계산. 결과 화면(로컬 플레이 직후)에서 쓴다.
    calculateRank(score, totalNotes) {
        if (!totalNotes || totalNotes <= 0) return 'C';
        const maxScore = totalNotes * CONFIG.POINTS.perfect;
        const percentage = (score / maxScore) * 100;
        return this.rankFromPercentage(percentage);
    },
    // PERFECT/GOOD/BAD/MISS 개수 → 랭크(S/A/B/C) 계산. 서버에 저장된 판정 개수로부터
    // 직접 계산하므로, 온라인 리더보드처럼 note_count 등 별도 값 없이도 정확한 등급을 매길 수 있다.
    rankFromJudgements(perfect, good, bad, miss) {
        perfect = perfect || 0; good = good || 0; bad = bad || 0; miss = miss || 0;
        const judgedCount = perfect + good + bad + miss;
        if (judgedCount === 0) return 'C';
        const percentage = ((perfect * CONFIG.POINTS.perfect + good * CONFIG.POINTS.good + bad * CONFIG.POINTS.bad)
            / (judgedCount * CONFIG.POINTS.perfect)) * 100;
        return this.rankFromPercentage(percentage);
    },
    updateResultScreen() {
        DOM.finalScoreEl.textContent = Game.state.score;
        DOM.rankEl.textContent = this.calculateRank(Game.state.score, Game.state.totalNotes);
        DOM.finalPerfectEl.textContent = Game.state.judgements.perfect;
        DOM.finalGoodEl.textContent = Game.state.judgements.good;
        DOM.finalBadEl.textContent = Game.state.judgements.bad;
        DOM.finalMissEl.textContent = Game.state.judgements.miss;
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
    // 게임 시작 시 한 번 골격(닉네임 행)을 그려두고, 이후 'progress' 브로드캐스트가
    // 올 때마다 updateSpectateHud로 숫자만 갱신한다(매번 다시 그리지 않음).
    showSpectateHud(opponents) {
        if (!DOM.spectateHudEl) return;
        if (!opponents || opponents.length === 0) {
            this.hideSpectateHud();
            return;
        }
        DOM.spectateHudEl.innerHTML = opponents.map(o => `
            <div class="mp-spectate-row" data-user-id="${_esc(o.user_id)}">
                <span class="mp-spectate-name">${_esc(o.nickname || o.user_id.slice(0, 8))}</span>
                <span class="mp-spectate-score">0</span>
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
            if (scoreEl) scoreEl.textContent = Math.round(p.score || 0);
            if (comboEl) comboEl.textContent = `${p.combo || 0} combo`;
        });
    },
    hideSpectateHud() {
        if (!DOM.spectateHudEl) return;
        DOM.spectateHudEl.classList.add('hidden');
        DOM.spectateHudEl.innerHTML = '';
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