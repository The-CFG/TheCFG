// ── Editor: input 관련 메서드 ──
// editor.js에서 분리됨. editor-core.js 이후에 로드되어야 한다.
Object.assign(Editor, {
    highlightEditorLanes(laneCount) {
        try {
            // 먼저 모든 하이라이트 제거
            this.clearEditorLaneHighlight();
            
            // 선택된 레인에 해당하는 레인 ID 가져오기
            const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
            if (!requiredLaneIds) return;
            
            // 해당 레인들 하이라이트
            requiredLaneIds.forEach(laneId => {
                const laneEl = DOM.editor.gridContainer.querySelector(`[data-lane-id="${laneId}"]`);
                if (laneEl) {
                    laneEl.classList.add('highlighted');
                }
            });
        } catch (err) {
            Debugger.logError(err, 'Editor.highlightEditorLanes');
        }
    },
    
    clearEditorLaneHighlight() {
        try {
            const lanes = DOM.editor.gridContainer.querySelectorAll('.editor-lane');
            lanes.forEach(lane => lane.classList.remove('highlighted'));
        } catch (err) {
            Debugger.logError(err, 'Editor.clearEditorLaneHighlight');
        }
    },
    
    addLaneLabels() {
        try {
            // 기존 라벨 제거
            DOM.editor.gridContainer.querySelectorAll('.editor-lane-label').forEach(label => label.remove());
            
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const beatsPerMeasure = 4;
            const measureHeight = beatsPerMeasure * adjustedBeatHeight;
            
            // 8마디마다 라벨 추가
            const lanes = DOM.editor.gridContainer.querySelectorAll('.editor-lane');
            lanes.forEach((laneEl, index) => {
                const laneId = CONFIG.EDITOR_LANE_IDS[index];
                
                for (let measure = 0; measure < this.state.totalMeasures; measure += 8) {
                    const label = document.createElement('div');
                    label.className = 'editor-lane-label';
                    label.textContent = `${laneId} - ${measure}`;
                    label.style.top = `${measure * measureHeight}px`;
                    laneEl.appendChild(label);
                }
            });
        } catch (err) {
            Debugger.logError(err, 'Editor.addLaneLabels');
        }
    },

    handleEditorKeyPress(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.handleUndo();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            this.copySelectedNotes();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            this.pasteNotes();
            return;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return;

        switch (e.key) {
            case ' ':
            case 'Spacebar': // 일부 구형 브라우저 호환
                e.preventDefault();
                if (e.repeat) return; // 꾹 누르고 있을 때 반복 토글되는 것 방지
                this.handlePlayPause();
                return;
            case 'ArrowUp': e.preventDefault(); this.movePlayheadBySnapStep(-1); return;
            case 'ArrowDown': e.preventDefault(); this.movePlayheadBySnapStep(1); return;
            case 'ArrowLeft': e.preventDefault(); this.adjustSnapDivision(-1); return;
            case 'ArrowRight': e.preventDefault(); this.adjustSnapDivision(1); return;
        }

        switch (e.key) {
            case '1': e.preventDefault(); this.setSelectedNoteType('tap'); return;
            case '2': e.preventDefault(); this.setSelectedNoteType('long'); return;
            case '3': e.preventDefault(); this.setSelectedNoteType('false'); return;
        }

        // 도구 전환 단축키. Q/W/E/R/T/Y/U/I/O는 이미 EDITOR_KEY_LANE_MAP에서
        // 레인 배치 키로 쓰이고 있어서 겹치지 않는 Z/X를 사용한다.
        // 삭제는 별도 도구가 아니라 우클릭(컨텍스트 메뉴)으로 대체되었다.
        const pressedKey = e.key.toLowerCase();
        if (pressedKey === CONFIG.EDITOR_TOOL_KEYS.create) { e.preventDefault(); this.setActiveTool('create'); return; }
        if (pressedKey === CONFIG.EDITOR_TOOL_KEYS.edit) { e.preventDefault(); this.setActiveTool('edit'); return; }

        const laneId = CONFIG.EDITOR_KEY_LANE_MAP[e.code];
        if (laneId) {
            e.preventDefault();
            this.placeNoteAtPlayhead(laneId);
        }
    }
});
