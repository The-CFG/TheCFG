/**
 * Calibration — 탭 타이밍 자동 보정 (연습모드-개선계획.md 4번)
 * ----------------------------------------------------------------
 * 기존 설정(inputOffsetMs / touchInputOffsetMs)을 사용자가 슬라이더로 감 잡아가며
 * 맞춰야 했던 걸, 일정 박자에 맞춰 20여 회 탭하게 하고 그 편차를 재서 대신 계산해주는
 * 모듈. 실제 오프셋 슬라이더/판정 로직(game.js getInputOffsetMs)은 전혀 건드리지 않고
 * 마지막에 그 값을 얼마로 할지만 대신 계산해서 넣어준다.
 *
 * 측정값의 성격에 대한 중요한 전제(연습모드-개선계획.md 4번 참고):
 * 브라우저 환경에서는 "기기 자체의 지연"과 "사람이 반응하는 시간"을 물리적으로
 * 분리할 수 없다. 이 모듈이 재는 건 정확한 레이턴시 스펙이 아니라 "이 기기 + 이 설정 +
 * 이 사람의 탭 습관을 합친 평균 편차"이며, 오프셋 슬라이더가 보정하려는 대상도 정확히
 * 이거라서(판정 로직이 원인을 나누지 않고 그냥 더해서 쓸 뿐) 목적에는 맞다.
 */
const Calibration = {
    TOTAL_BEATS: 25,
    INTERVAL_MS: 500,
    LEAD_IN_MS: 1200, // 시작 버튼을 누르고 첫 신호가 나오기까지 준비 시간
    CAPTURE_WINDOW_MS: 250, // 이 범위 밖에서 들어온 탭은 엉뚱한 탭으로 보고 버린다
    DISCARD_START: 2, // 적응 구간 — 앞쪽 N회는 평균 계산에서 제외
    DISCARD_END: 1,   // 마지막 박자는 "이제 끝났다"는 걸 알고 서두르는 경향이 있어 제외
    MAX_MISSED_RATIO: 0.3, // 유효 박자 중 이 비율 이상 놓쳤으면 결과 신뢰도 경고 표시

    mode: null, // 'general' | 'touch'
    _synth: null,
    _rafId: null,
    _scheduledTimes: [],
    _fired: [],     // 박자별로 신호를 이미 냈는지
    _matched: [],   // 박자별로 매칭된 signedDelta(ms). null이면 그 박자는 못 잡음(놓침)
    _startTime: 0,
    _running: false,
    _lastResult: null, // 확인 화면에서 "이 값으로 보정" 누를 때 쓸 계산 결과

    _ensureSynth() {
        if (this._synth) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx || typeof Tone === 'undefined') return;
        this._synth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }
        }).toDestination();
        const volume = Game.state.settings.sfxVolume;
        const db = (volume - 100) * 0.5;
        this._synth.volume.value = (volume === 0) ? -Infinity : db;
    },

    async _playBeep() {
        try {
            await Tone.start();
        } catch (err) {
            // 사용자 제스처 없이 호출되는 경우는 없지만 실패해도 신호(시각)는 계속 진행한다
        }
        this._ensureSynth();
        if (!this._synth) return;
        this._synth.triggerAttackRelease('A5', '32n');
    },

    init() {
        DOM.calibration = {
            openBtn: document.getElementById('open-calibration-btn'),
            backBtn: document.getElementById('calibration-back-btn'),
            stepIntro: document.getElementById('calibration-step-intro'),
            stepRunning: document.getElementById('calibration-step-running'),
            stepResult: document.getElementById('calibration-step-result'),
            modeGeneralBtn: document.getElementById('calibration-mode-general-btn'),
            modeTouchBtn: document.getElementById('calibration-mode-touch-btn'),
            progressText: document.getElementById('calibration-progress-text'),
            tapZone: document.getElementById('calibration-tap-zone'),
            tapZoneLabel: document.getElementById('calibration-tap-zone-label'),
            cancelBtn: document.getElementById('calibration-cancel-btn'),
            resultHeadline: document.getElementById('calibration-result-headline'),
            resultDetail: document.getElementById('calibration-result-detail'),
            resultWarning: document.getElementById('calibration-result-warning'),
            retryBtn: document.getElementById('calibration-retry-btn'),
            applyBtn: document.getElementById('calibration-apply-btn'),
        };
        const dom = DOM.calibration;
        if (!dom.openBtn) return; // 화면 자체가 없는 빌드일 수 있으니 방어적으로 처리

        dom.openBtn.addEventListener('click', () => {
            this._showIntro();
            UI.showScreen('calibration');
        });
        dom.backBtn.addEventListener('click', () => {
            this._stop();
            UI.showScreen('settings');
        });
        dom.modeGeneralBtn.addEventListener('click', () => this._start('general'));
        dom.modeTouchBtn.addEventListener('click', () => this._start('touch'));
        dom.cancelBtn.addEventListener('click', () => this._showIntro());
        dom.retryBtn.addEventListener('click', () => this._start(this.mode));
        dom.applyBtn.addEventListener('click', () => this._applyResult());
    },

    _showIntro() {
        this._stop();
        const dom = DOM.calibration;
        dom.stepIntro.classList.remove('hidden');
        dom.stepRunning.classList.add('hidden');
        dom.stepResult.classList.add('hidden');
    },

    _start(mode) {
        this.mode = mode;
        const dom = DOM.calibration;
        dom.stepIntro.classList.add('hidden');
        dom.stepResult.classList.add('hidden');
        dom.stepRunning.classList.remove('hidden');
        dom.tapZoneLabel.textContent = I18n.t('calibration_tap_zone_label');
        dom.progressText.textContent = `0 / ${this.TOTAL_BEATS}`;

        this._scheduledTimes = [];
        this._fired = [];
        this._matched = [];
        this._startTime = performance.now() + this.LEAD_IN_MS;
        for (let i = 0; i < this.TOTAL_BEATS; i++) {
            this._scheduledTimes.push(this._startTime + i * this.INTERVAL_MS);
            this._fired.push(false);
            this._matched.push(null);
        }
        this._running = true;

        // 모드에 따라 실제 게임 입력과 최대한 같은 종류의 이벤트로 탭을 받는다
        // (게임은 mousedown/touchstart/keydown을 쓰지, pointerdown 하나로 묶어 쓰지 않는다).
        this._onTap = (e) => {
            if (e.type === 'keydown' && e.repeat) return;
            this._recordTap(performance.now());
        };
        if (mode === 'touch') {
            dom.tapZone.addEventListener('touchstart', this._onTap, { passive: true });
        } else {
            dom.tapZone.addEventListener('mousedown', this._onTap);
            document.addEventListener('keydown', this._onTap);
        }

        // 첫 신호음을 내려면 사용자 제스처가 한 번 필요한데, 모드 버튼 클릭 자체가 제스처이므로
        // 여기서 Tone.start()를 미리 한 번 시도해둔다(신호 지연 없이 바로 재생되도록).
        Tone.start().catch(() => {});
        this._ensureSynth();

        this._loop();
    },

    _loop() {
        if (!this._running) return;
        const now = performance.now();

        for (let i = 0; i < this.TOTAL_BEATS; i++) {
            if (!this._fired[i] && now >= this._scheduledTimes[i]) {
                this._fired[i] = true;
                this._playBeep();
                this._flashBeat();
                DOM.calibration.progressText.textContent = `${i + 1} / ${this.TOTAL_BEATS}`;
            }
        }

        const lastBeatTime = this._scheduledTimes[this.TOTAL_BEATS - 1];
        if (now >= lastBeatTime + this.CAPTURE_WINDOW_MS) {
            this._finish();
            return;
        }
        this._rafId = requestAnimationFrame(() => this._loop());
    },

    _flashBeat() {
        const zone = DOM.calibration.tapZone;
        zone.classList.add('beat-flash');
        setTimeout(() => zone.classList.remove('beat-flash'), 100);
    },

    _recordTap(tapTime) {
        if (!this._running) return;
        // 아직 매칭 안 된 박자 중 가장 가까운 것을 찾는다
        let bestIndex = -1;
        let bestDiff = Infinity;
        for (let i = 0; i < this.TOTAL_BEATS; i++) {
            if (this._matched[i] !== null) continue;
            const diff = Math.abs(tapTime - this._scheduledTimes[i]);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIndex = i;
            }
        }
        if (bestIndex === -1 || bestDiff > this.CAPTURE_WINDOW_MS) return; // 엉뚱한 탭은 버린다

        this._matched[bestIndex] = tapTime - this._scheduledTimes[bestIndex]; // signed: 양수=늦게 탭함
        const zone = DOM.calibration.tapZone;
        zone.classList.add('tap-flash');
        setTimeout(() => zone.classList.remove('tap-flash'), 100);
    },

    _stop() {
        this._running = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = null;
        const dom = DOM.calibration;
        if (dom && dom.tapZone && this._onTap) {
            dom.tapZone.removeEventListener('touchstart', this._onTap);
            dom.tapZone.removeEventListener('mousedown', this._onTap);
            document.removeEventListener('keydown', this._onTap);
        }
    },

    _finish() {
        this._stop();
        const usable = [];
        for (let i = this.DISCARD_START; i < this.TOTAL_BEATS - this.DISCARD_END; i++) {
            if (this._matched[i] !== null) usable.push(this._matched[i]);
        }
        const totalConsidered = this.TOTAL_BEATS - this.DISCARD_START - this.DISCARD_END;
        const missedCount = totalConsidered - usable.length;

        const dom = DOM.calibration;
        dom.stepRunning.classList.add('hidden');
        dom.stepResult.classList.remove('hidden');

        if (usable.length < Math.max(3, totalConsidered * (1 - this.MAX_MISSED_RATIO))) {
            // 놓친 박자가 너무 많으면 평균 자체가 의미 없으니 적용 버튼을 막고 다시 측정을 권한다
            this._lastResult = null;
            dom.resultHeadline.textContent = I18n.t('calibration_failed_headline');
            dom.resultDetail.textContent = '';
            dom.resultWarning.classList.remove('hidden');
            dom.applyBtn.classList.add('hidden');
            return;
        }

        usable.sort((a, b) => a - b);
        const mean = usable.reduce((sum, v) => sum + v, 0) / usable.length;
        const mid = Math.floor(usable.length / 2);
        const median = usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];

        // 5ms 단위 슬라이더에 맞춰 반올림, ±300ms 범위로 클램프
        const recommended = Math.max(-300, Math.min(300, Math.round(mean / 5) * 5));

        this._lastResult = { mean, median, recommended, sampleCount: usable.length, mode: this.mode };

        const direction = recommended > 0
            ? I18n.t('calibration_direction_late')
            : (recommended < 0 ? I18n.t('calibration_direction_early') : I18n.t('calibration_direction_ontime'));
        dom.resultHeadline.textContent = I18n.t('calibration_result_headline', {
            ms: Math.abs(recommended),
            direction,
        });
        dom.resultDetail.textContent = I18n.t('calibration_result_detail', {
            count: usable.length,
            total: totalConsidered,
            median: Math.round(median),
        });

        if (missedCount > totalConsidered * this.MAX_MISSED_RATIO) {
            dom.resultWarning.classList.remove('hidden');
        } else {
            dom.resultWarning.classList.add('hidden');
        }
        dom.applyBtn.classList.remove('hidden');
    },

    _applyResult() {
        if (!this._lastResult) return;
        const { recommended, mode } = this._lastResult;

        // main.js에 이미 붙어 있는 슬라이더 리스너(input/change)를 그대로 재사용한다 — 그쪽이
        // Game.state.settings 갱신, localStorage 저장, 라벨(ms) 갱신, 전체 재생 설정을 묶어서
        // 보내는 savePlaySettingsToCloud()까지 다 검증된 상태로 하고 있다. 여기서 CloudAuth를
        // 직접 불러 값만 따로 저장하면 upsert 방식이라 클라우드에 저장된 다른 재생 설정(볼륨 등)을
        // 통째로 덮어써버릴 위험이 있어서, 그 경로를 그대로 타도록 이벤트만 발생시킨다.
        if (mode === 'general' && DOM.settings.inputOffsetSlider) {
            DOM.settings.inputOffsetSlider.value = recommended;
            DOM.settings.inputOffsetSlider.dispatchEvent(new Event('input', { bubbles: true }));
            DOM.settings.inputOffsetSlider.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (mode === 'touch' && DOM.settings.touchInputOffsetSlider) {
            // 터치 보정값은 "일반 보정에 추가로 더해지는 값"이므로, 방금 잰 터치 전체 지연에서
            // 이미 적용돼 있는 일반 보정값을 빼서 순수 추가분만 저장한다.
            const base = Game.state.settings.inputOffsetMs || 0;
            const touchExtra = Math.max(-300, Math.min(300, Math.round((recommended - base) / 5) * 5));
            DOM.settings.touchInputOffsetSlider.value = touchExtra;
            DOM.settings.touchInputOffsetSlider.dispatchEvent(new Event('input', { bubbles: true }));
            DOM.settings.touchInputOffsetSlider.dispatchEvent(new Event('change', { bubbles: true }));
        }

        UI.showMessage('settings', I18n.t('calibration_applied_message'));
        UI.showScreen('settings');
    },
};