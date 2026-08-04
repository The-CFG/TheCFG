// ── Editor: triggers 관련 메서드 ──
// editor.js에서 분리됨. editor-core.js 이후에 로드되어야 한다.
Object.assign(Editor, {
    placeTrigger(time) {
        this.state.pendingTriggerTime = time;
        this.showTriggerModal();
    },

    // 기존 트리거 마커를 클릭했을 때 — 같은 모달을 그 트리거의 현재 값으로 채워서 연다.
    // 확인을 누르면 confirmTrigger()가 같은 시간의 트리거를 교체하므로 자연히 "수정"이 된다.
    editTrigger(trigger) {
        this.state.pendingTriggerTime = trigger.time;
        this.showTriggerModal(trigger);
    },

    showTriggerModal(existingTrigger = null) {
        // 기존 트리거를 수정하는 경우 그 트리거의 값으로, 새로 만드는 경우 현재 설정값으로 모달을 채운다.
        DOM.triggerModal.bpmInput.value = existingTrigger ? existingTrigger.bpm : this.state.bpm;
        DOM.triggerModal.fallSpeedInput.value = existingTrigger
            ? existingTrigger.fallSpeed
            : (parseFloat(DOM.editor.noteFallSpeedInput?.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed);
        DOM.triggerModal.transitionInput.value = existingTrigger
            ? ((existingTrigger.transitionMs ?? 700) / 1000)
            : 0.7;
        DOM.triggerModal.container.classList.remove('hidden');
    },

    hideTriggerModal() {
        DOM.triggerModal.container.classList.add('hidden');
        this.state.pendingTriggerTime = null;
    },

    confirmTrigger() {
        const time = this.state.pendingTriggerTime;
        if (time == null) return;

        const bpm = parseFloat(DOM.triggerModal.bpmInput.value);
        const fallSpeed = parseFloat(DOM.triggerModal.fallSpeedInput.value);
        const transitionSec = parseFloat(DOM.triggerModal.transitionInput.value);
        const transitionMs = Math.max(0, (isNaN(transitionSec) ? 0.7 : transitionSec) * 1000);

        this._saveStateForUndo();

        // 기존 동일 시간 트리거 제거
        this.state.triggers = this.state.triggers.filter(t => Math.abs(t.time - time) >= 10);
        
        // 새 트리거 추가
        this.state.triggers.push({
            time,
            bpm,
            fallSpeed,
            transitionMs
        });

        this.state.triggers.sort((a, b) => a.time - b.time);
        this.renderTriggers();
        this.hideTriggerModal();
        this.setDirty(true);
    },

    renderTriggers() {
        try {
            DOM.editor.notesContainer.querySelectorAll('.editor-trigger').forEach(t => t.remove());
            const container = DOM.editor.container;
            if (container.clientWidth === 0) return;
            const offsetSec = this.state.song.startOffsetSec || 0;

            this.state.triggers.forEach(trigger => {
                const triggerEl = document.createElement('div');
                triggerEl.className = 'editor-trigger';
                triggerEl.style.width = '100%';
                triggerEl.style.height = '3px';
                triggerEl.style.backgroundColor = '#fbbf24';
                triggerEl.style.position = 'absolute';
                triggerEl.style.left = '0';
                triggerEl.style.cursor = 'pointer';
                triggerEl.style.zIndex = '5';
                
                // trigger.time도 오프셋 기준 상대시간 — 노트와 동일하게 오프셋을 더해 그린다.
                const yPosition = this._secondsToY((trigger.time / 1000) + offsetSec);
                triggerEl.style.top = `${yPosition}px`;
                
                triggerEl.dataset.time = trigger.time;
                triggerEl.title = `클릭: 수정 / 우클릭: 삭제\nBPM: ${trigger.bpm}, 하강: ${trigger.fallSpeed}, 전환: ${((trigger.transitionMs ?? 700) / 1000).toFixed(1)}s`;
                
                // 좌클릭 — 이 트리거를 수정하는 모달을 연다 (배치 클릭이 아래로 전파되는 것도 막는다).
                // 우클릭(컨텍스트 메뉴) — 삭제. 도구와 무관하게 항상 동작한다.
                triggerEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.editTrigger(trigger);
                });
                triggerEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._saveStateForUndo();
                    this.state.triggers = this.state.triggers.filter(t => t.time !== trigger.time);
                    this.renderTriggers();
                    this.setDirty(true);
                });
                
                DOM.editor.notesContainer.appendChild(triggerEl);
            });
        } catch (err) {
            Debugger.logError(err, 'Editor.renderTriggers');
        }
    },

});
