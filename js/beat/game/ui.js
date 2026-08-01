const UI = {
    // 현재 표시 중인 화면 키 (DOM.screens의 키와 동일). showScreen() 호출마다 갱신된다.
    // 설정 화면을 닫을 때 "실제로 어느 화면에 있었는지"를 정확히 복원하기 위해 쓴다.
    currentScreen: 'menu',

    showScreen(screenName) {
        Object.values(DOM.screens).forEach(screen => screen.classList.add('hidden'));
        DOM.screens[screenName].classList.remove('hidden');
        this.currentScreen = screenName;
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
    // 점수/총 노트 수 → 랭크(S/A/B/C) 계산. 결과 화면과 온라인 리더보드에서 공용으로 쓴다.
    calculateRank(score, totalNotes) {
        if (!totalNotes || totalNotes <= 0) return 'C';
        const maxScore = totalNotes * CONFIG.POINTS.perfect;
        const percentage = (score / maxScore) * 100;
        if (percentage === 100) return 'S';
        if (percentage >= 90) return 'A';
        if (percentage >= 70) return 'B';
        return 'C';
    },
    updateResultScreen() {
        DOM.finalScoreEl.textContent = Game.state.score;
        DOM.rankEl.textContent = this.calculateRank(Game.state.score, Game.state.totalNotes);
        DOM.finalPerfectEl.textContent = Game.state.judgements.perfect;
        DOM.finalGoodEl.textContent = Game.state.judgements.good;
        DOM.finalBadEl.textContent = Game.state.judgements.bad;
        DOM.finalMissEl.textContent = Game.state.judgements.miss;
    }
};

function resetPlayingScreenUI() {
    DOM.pauseGameBtn.classList.remove('hidden');
    DOM.resumeGameBtn.classList.add('hidden');
    DOM.playingStatusLabel.textContent = '플레이 중';
    DOM.settings.iconPlaying.classList.add('hidden');
}