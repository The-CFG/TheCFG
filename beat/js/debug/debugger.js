// Debugger: 에러 로그 / 성능·게임 상태 오버레이 (설정 > 디버그 모드 토글).
// - 원래 main.js 맨 위에 있던 코드를 그대로 옮긴 파일 (동작 변경 없음).
// - Debugger.logError는 editor/game/appearance 등 앱 전체에서 호출하므로 앱 코드보다 먼저 로드할 것 (index.html: dom.js 바로 다음).
// - 오버레이 HTML은 index.html의 #debug-overlay, 스타일은 css/debug.css.
// - 디버그 도구(yt-tools 등)는 Debugger.registerTool({ id, onToggle(enabled), onFrame(timestamp) })로 붙는다.
//   onToggle: 디버그 모드가 켜지거나 꺼질 때, onFrame: 플레이/카운트다운 중 매 프레임(디버그 모드 ON일 때만).
const Debugger = {
    isActive: false,
    perf: {
        lastFrameTime: 0,
        frames: 0,
        fps: 0,
        timings: new Map(),
        lastPerfUpdate: 0,
    },

    dragState: {
        isDragging: false,
        offsetX: 0,
        offsetY: 0,
    },

    tools: new Map(),

    init() {
        const toggleEl = DOM.settings && DOM.settings.debugModeToggle;
        if (toggleEl) {
            toggleEl.addEventListener('change', (e) => {
                this.toggle(e.target.checked);
            });
        }

        const titleEl = DOM.debugTitle;
        if (titleEl) {
            titleEl.addEventListener('mousedown', (e) => this.dragStart(e));
            titleEl.addEventListener('touchstart', (e) => this.dragStart(e));
        }
    },

    toggle(isEnabled) {
        this.isActive = isEnabled;
        if (DOM.debugOverlay) DOM.debugOverlay.classList.toggle('hidden', !isEnabled);
        this._callTools('onToggle', isEnabled);
    },

    // ── 도구 등록 ──
    // tool: { id, onToggle(enabled), onFrame(timestamp) } — 훅은 모두 선택. 이미 디버그 모드가 켜져 있으면 등록 즉시 onToggle(true).
    registerTool(tool) {
        if (!tool || !tool.id) return;
        this.tools.set(tool.id, tool);
        if (this.isActive) this._callTool(tool, 'onToggle', true);
    },

    unregisterTool(id) {
        const tool = this.tools.get(id);
        if (!tool) return;
        if (this.isActive) this._callTool(tool, 'onToggle', false);
        this.tools.delete(id);
    },

    // 도구 하나가 던진 에러가 다른 도구/게임 루프로 번지지 않게 격리한다.
    _callTool(tool, hook, arg) {
        if (typeof tool[hook] !== 'function') return;
        try {
            tool[hook](arg);
        } catch (err) {
            console.error(`[Debugger.tool:${tool.id}.${hook}]`, err);
        }
    },

    _callTools(hook, arg) {
        this.tools.forEach((tool) => this._callTool(tool, hook, arg));
    },

    // 게임 루프에서 매 프레임 호출 (game.js, updatePerf/updateState 옆)
    updateTools(timestamp) {
        if (!this.isActive) return;
        this._callTools('onFrame', timestamp);
    },

    _getEventCoords(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    },

    dragStart(e) {
        const overlay = DOM.debugOverlay;
        if (!overlay) return;
        this.dragState.isDragging = true;
        const coords = this._getEventCoords(e);
        this.dragState.offsetX = coords.x - overlay.offsetLeft;
        this.dragState.offsetY = coords.y - overlay.offsetTop;
        overlay.style.right = 'auto';
        this.boundDragMove = (ev) => this.dragMove(ev);
        this.boundDragEnd = () => this.dragEnd();
        window.addEventListener('mousemove', this.boundDragMove);
        window.addEventListener('mouseup', this.boundDragEnd);
        window.addEventListener('touchmove', this.boundDragMove, { passive: true });
        window.addEventListener('touchend', this.boundDragEnd, { passive: true });
        e.preventDefault();
    },

    dragMove(e) {
        if (!this.dragState.isDragging) return;
        const coords = this._getEventCoords(e);
        const overlay = DOM.debugOverlay;
        let newX = coords.x - this.dragState.offsetX;
        let newY = coords.y - this.dragState.offsetY;
        newX = Math.max(0, Math.min(newX, window.innerWidth - overlay.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - overlay.offsetHeight));
        overlay.style.left = `${newX}px`;
        overlay.style.top = `${newY}px`;
    },

    dragEnd() {
        this.dragState.isDragging = false;
        window.removeEventListener('mousemove', this.boundDragMove);
        window.removeEventListener('mouseup', this.boundDragEnd);
        window.removeEventListener('touchmove', this.boundDragMove);
        window.removeEventListener('touchend', this.boundDragEnd);
    },

    // catch 블록 안에서 불리는 함수라 절대 throw하지 않는다. 메시지는 textContent로만 넣는다(HTML 주입 방지).
    logError(error, context = 'Unknown') {
        const message = error && error.message ? error.message : String(error);
        console.error(`[${context}]`, message, error && error.stack ? error.stack : '');
        if (!this.isActive) return;
        try {
            const logContainer = DOM.debugLogContainer;
            if (!logContainer) return;
            const ctxEl = document.createElement('span');
            ctxEl.className = 'error-context';
            ctxEl.textContent = `[${context}]`;
            const msgEl = document.createElement('span');
            msgEl.className = 'error-message';
            msgEl.textContent = message;
            const errorEl = document.createElement('p');
            errorEl.append(ctxEl, ': ', msgEl);
            logContainer.appendChild(errorEl);
            logContainer.scrollTop = logContainer.scrollHeight;
        } catch (e) {
            console.error('[Debugger.logError] 오버레이 기록 실패', e);
        }
    },

    updateState(stateObject) {
        if (!this.isActive) return;
        const replacer = (key, value) => {
            if (key === "notes" && Array.isArray(value)) {
                return `[...Array(${value.length})]`;
            }
            return value;
        };
        const pre = DOM.debugStateContainer && DOM.debugStateContainer.querySelector('pre');
        if (!pre) return;
        try {
            pre.textContent = JSON.stringify(stateObject, replacer, 2);
        } catch (e) {
            pre.textContent = `(상태 직렬화 실패: ${e.message})`;
        }
    },

    profileStart(name) {
        if (!this.isActive) return;
        this.perf.timings.set(name, { start: performance.now() });
    },

    profileEnd(name) {
        if (!this.isActive || !this.perf.timings.has(name)) return;
        const timing = this.perf.timings.get(name);
        timing.duration = performance.now() - timing.start;
    },

    updatePerf(timestamp) {
        if (!this.isActive) return;
        this.perf.frames++;
        if (timestamp > this.perf.lastPerfUpdate + 1000) {
            this.perf.fps = Math.round((this.perf.frames * 1000) / (timestamp - this.perf.lastPerfUpdate));
            this.perf.lastPerfUpdate = timestamp;
            this.perf.frames = 0;
        }
        let perfHTML = `<p>FPS: ${this.perf.fps}</p>`;
        this.perf.timings.forEach((timing, name) => {
            if (timing.duration !== undefined) {
                perfHTML += `<p>${name}: ${timing.duration.toFixed(2)}ms</p>`;
            }
        });
        if (DOM.debugPerfContainer) DOM.debugPerfContainer.innerHTML = perfHTML;
    }
};
