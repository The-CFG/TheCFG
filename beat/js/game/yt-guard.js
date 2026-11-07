/**
 * YTGuard — YouTube 곡 견고성 (S4)
 * - 광고: 재생 중 광고가 감지되면 "광고 종료 대기" 문구를 띄우고(시계는 YouTubeSource가 동결),
 *         광고가 끝나면 자동 일시정지해서 유저가 재개(3초 카운트다운)로 이어가게 한다. has_ads 자동 누적.
 * - 버퍼링: 시계가 같이 멈추므로 문구만 표시하고 끝나면 복구.
 * - 오류: 게임 중 영상 사용 불가(삭제/임베드 금지/지역 차단)면 게임을 중단하고 메뉴로 돌아간다.
 * 플레이어 위에는 아무것도 얹지 않는다(문구는 우측 패널의 상태 라벨).
 */
const YTGuard = {
    _TEXT_AD: '광고 재생 중 — 종료를 기다리는 중…',
    _TEXT_BUF: '버퍼링 중…',

    _isYtPlaying() {
        const g = typeof Game !== 'undefined' ? Game : null;
        return !!g && g.state.settings.mode === 'music' && DOM.musicPlayer.kind === 'yt'
            && (g.state.gameState === 'playing' || g.state.gameState === 'countdown');
    },
    _setLabel(text) { if (DOM.playingStatusLabel) DOM.playingStatusLabel.textContent = text; },
    _restoreLabel() {
        const el = DOM.playingStatusLabel;
        if (el && (el.textContent === this._TEXT_AD || el.textContent === this._TEXT_BUF)) {
            el.textContent = Game.state.isPaused ? '일시 정지 중' : '플레이 중';
        }
    },

    init() {
        if (this._inited || typeof DOM === 'undefined' || !DOM.musicPlayer) return;
        this._inited = true;

        // 광고 최초 관찰 → has_ads 누적 (현재 온라인 곡)
        DOM.musicPlayer.onAdDetected = () => {
            const id = Game.state._onlineSongId;
            if (id && typeof CloudCharts !== 'undefined' && CloudCharts.reportSongAds) CloudCharts.reportSongAds(id);
        };

        DOM.musicPlayer.addEventListener('ad', () => {
            if (!this._isYtPlaying()) return;
            this._setLabel(this._TEXT_AD);
        });

        DOM.musicPlayer.addEventListener('adend', () => {
            if (!this._isYtPlaying()) return;
            this._restoreLabel();
            // 광고 직후엔 바로 노트가 흐르지 않게 자동 일시정지 → 재개 시 카운트다운
            if (Game.state.gameState === 'playing' && !Game.state.isPaused) Game.togglePause();
        });

        DOM.musicPlayer.addEventListener('waiting', () => {
            if (!this._isYtPlaying() || Game.state.gameState !== 'playing' || !Game.state.audioReady) return;
            if (DOM.musicPlayer.inAd) return;
            this._setLabel(this._TEXT_BUF);
        });

        DOM.musicPlayer.addEventListener('playing', () => {
            if (DOM.musicPlayer.inAd) return;
            this._restoreLabel();
        });

        DOM.musicPlayer.addEventListener('error', () => {
            if (!this._isYtPlaying()) return;
            this.abort((DOM.musicPlayer.error && DOM.musicPlayer.error.message) || '영상을 재생할 수 없습니다.');
        });
    },

    // 게임 중단 + 메뉴 복귀 (결과 화면/점수 제출 없이)
    abort(message) {
        const g = Game;
        try {
            g.cancelCountdown();
            cancelAnimationFrame(g.state.animationFrameId);
            g.state.animationFrameId = null;
            g.state.isPaused = false;
            try { DOM.musicPlayer.pause(); } catch (e) { /* 무시 */ }
            g.state.gameState = 'menu';
            this._restoreLabel();
            if (typeof g._teardownMultiplayerSpectate === 'function') g._teardownMultiplayerSpectate();
        } catch (e) { console.error(e); }
        UI.showScreen('menu');
        UI.showMessage('menu', message);
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => YTGuard.init());
else YTGuard.init();