// ── Editor: notes 관련 메서드 ──
// editor.js에서 분리됨. editor-core.js 이후에 로드되어야 한다.
Object.assign(Editor, {
    handleReset() {
        const confirmMessage = this.state.isDirty
            ? '저장하지 않은 변경사항이 있습니다. 모든 노트를 삭제하고 재설정하시겠습니까?'
            : '모든 노트를 삭제합니다. 정말로 재설정하시겠습니까?';

        if (confirm(confirmMessage)) {
            this._saveStateForUndo();
            this.state.notes = [];
            this.renderNotes();
            UI.showMessage('editor', '모든 노트를 삭제했습니다.');
            this.setDirty(true);
        }
    },

    handleTimelineClick(e) {
        try {
            if (this.state.isPlaying) return;
            // 재생헤드 선은 pointer-events:none이라 e.target이 될 수 없음 —
            // 드래그는 시크 거터(#editor-seek-gutter)에서만 가능 (handleSeekPointerDown 참고)

            // 기존 노트를 좌클릭한 경우: 아무 동작도 하지 않는다.
            // 삭제는 우클릭(컨텍스트 메뉴) 전용 — handleTimelineContextMenu 참고.
            if (e.target.classList.contains('editor-note')) return;

            // 빈 칸 클릭: Create 도구일 때만 새 노트를 찍는다.
            // Edit 도구는 아직 담을 기능이 없어 자리만 마련해둔 상태다.
            if (this.state.activeTool !== 'create') return;

            // setDirty/undo 저장은 여기서 미리 하지 않는다 — 트리거 클릭(모달만 열림)이나
            // 롱노트 시작점 클릭(아직 노트 미생성)처럼 실제로는 아무것도 안 바뀌는 클릭까지
            // undo 히스토리를 채우던 문제가 있었다. 대신 각 place*() 함수가 실제로 데이터를
            // 바꾸는 시점에 알아서 저장한다.
            const container = DOM.editor.container;
            // 시간(Y)은 반드시 스크롤되지 않는 container의 rect를 기준으로 + scrollTop을 더해야 한다.
            // gridContainer는 스크롤되는 내용물 안에 있어서 자신의 rect.top 자체가 스크롤할 때마다
            // 바뀌므로, 여기에 scrollTop을 또 더하면 스크롤량이 두 번 반영돼 롱노트처럼 스크롤 위치가
            // 달라진 두 지점을 연속 클릭하는 경우 시간 계산이 크게 어긋나는 버그가 있었다.
            const containerRect = container.getBoundingClientRect();
            const y = e.clientY - containerRect.top + container.scrollTop;

            const laneId = this._xToLaneId(e.clientX);
            const timeInMs = this._yToSnappedRelativeTimeMs(y);
            if (timeInMs < this._minAllowedRelativeTimeMs()) {
                UI.showMessage('editor', '시작 지점 또는 타이밍 시작보다 앞에는 노트를 찍을 수 없습니다.');
                return;
            }

            switch (this.state.selectedNoteType) {
                case 'long': this.placeLongNote(timeInMs, laneId); break;
                case 'trigger': this.placeTrigger(timeInMs); break;
                case 'tap': case 'false': this.placeSimpleNote(timeInMs, laneId); break;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.handleTimelineClick');
        }
    },

    // 우클릭(컨텍스트 메뉴)으로 기존 노트를 삭제한다. 도구(생성/편집)와 무관하게 항상 동작한다.
    // preventDefault는 조건과 무관하게 항상 먼저 호출한다 — 안 그러면 노트가 아닌 빈 칸을
    // 우클릭하거나(삭제 대상 없음) 재생 중일 때(isPlaying) 브라우저 기본 컨텍스트 메뉴가 뜬다.
    handleTimelineContextMenu(e) {
        try {
            e.preventDefault();
            if (this.state.isPlaying) return;
            if (!e.target.classList.contains('editor-note')) return;
            this.setDirty(true);
            this._saveStateForUndo();
            const time = parseFloat(e.target.dataset.time);
            const lane = e.target.dataset.lane;
            this.state.notes = this.state.notes.filter(note => note.time !== time || note.lane !== lane);
            this.state.selectedNotes = this.state.selectedNotes.filter(n => n.time !== time || n.lane !== lane);
            this.renderNotes();
        } catch (err) {
            Debugger.logError(err, 'Editor.handleTimelineContextMenu');
        }
    },

    // 모바일 등 우클릭(컨텍스트 메뉴)을 쓸 수 없는 환경을 위한 삭제 버튼.
    // 편집(Edit) 도구로 선택해둔 노트들(state.selectedNotes)을 한 번에 지운다.
    // 우클릭 삭제(handleTimelineContextMenu)와 동일한 로직이지만 다중 노트를 대상으로 한다.
    deleteSelectedNotes() {
        try {
            if (this.state.isPlaying) return;
            if (!this.state.selectedNotes.length) {
                UI.showMessage('editor', '삭제할 노트를 먼저 선택해주세요 (편집 도구로 탭).');
                return;
            }
            this.setDirty(true);
            this._saveStateForUndo();
            const selectedKeys = new Set(this.state.selectedNotes.map(n => `${n.time}|${n.lane}`));
            this.state.notes = this.state.notes.filter(note => !selectedKeys.has(`${note.time}|${note.lane}`));
            this.state.selectedNotes = [];
            this.renderNotes();
        } catch (err) {
            Debugger.logError(err, 'Editor.deleteSelectedNotes');
        }
    },

    // ── Edit 도구: 노트 선택(드래그 박스 / 클릭) ─────────────────────────
    // 빈 칸에서 mousedown하면 드래그로 사각 영역을 그려 겹치는 노트를 모두 선택하고,
    // 노트를 직접 mousedown하면 그 노트 하나를 선택한다. Shift를 누른 채로 하면 기존
    // 선택에 추가/제거된다.
    handleEditorMouseDown(e) {
        try {
            if (this.state.activeTool !== 'edit') return;
            if (this.state.isPlaying) return;
            if (e.button !== 0) return; // 좌클릭만 (우클릭은 삭제 컨텍스트 메뉴)

            if (e.target.classList.contains('editor-note')) {
                e.preventDefault();
                const time = parseFloat(e.target.dataset.time);
                const lane = e.target.dataset.lane;

                if (e.shiftKey) {
                    // Shift-클릭은 다중 선택 구성 전용 — 드래그로 넘어가지 않는다.
                    this._toggleNoteSelection(time, lane, true);
                    return;
                }

                const alreadySelected = this.state.selectedNotes.some(n => n.time === time && n.lane === lane);
                if (!alreadySelected) {
                    // 선택 안 된 노트를 클릭 → 그 노트 하나만 선택
                    this.state.selectedNotes = [{ time, lane }];
                    this.renderNotes();
                }
                // 이미 여러 개가 선택된 상태에서 그중 하나를 클릭한 경우엔 선택을 그대로
                // 유지해서 전체를 함께 드래그할 수 있게 한다.
                this._startNoteDrag(e, time, lane);
                return;
            }

            if (!e.shiftKey) {
                this.state.selectedNotes = [];
                this.renderNotes();
            }

            const gridRect = DOM.editor.gridContainer.getBoundingClientRect();
            const containerRect = DOM.editor.container.getBoundingClientRect();
            const startX = e.clientX - gridRect.left;
            const startY = e.clientY - containerRect.top + DOM.editor.container.scrollTop;

            const boxEl = document.createElement('div');
            boxEl.className = 'editor-selection-box';
            DOM.editor.notesContainer.appendChild(boxEl);

            const updateBox = (curX, curY) => {
                const left = Math.min(startX, curX);
                const top = Math.min(startY, curY);
                const width = Math.abs(curX - startX);
                const height = Math.abs(curY - startY);
                boxEl.style.left = `${left}px`;
                boxEl.style.top = `${top}px`;
                boxEl.style.width = `${width}px`;
                boxEl.style.height = `${height}px`;
                return { left, top, width, height };
            };
            let lastRect = updateBox(startX, startY);

            const onMove = (moveEvt) => {
                const curX = moveEvt.clientX - gridRect.left;
                const curY = moveEvt.clientY - containerRect.top + DOM.editor.container.scrollTop;
                lastRect = updateBox(curX, curY);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                boxEl.remove();
                this._applyBoxSelection(lastRect, e.shiftKey);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        } catch (err) {
            Debugger.logError(err, 'Editor.handleEditorMouseDown');
        }
    },

    _toggleNoteSelection(time, lane, additive) {
        const idx = this.state.selectedNotes.findIndex(n => n.time === time && n.lane === lane);
        if (additive) {
            if (idx === -1) this.state.selectedNotes.push({ time, lane });
            else this.state.selectedNotes.splice(idx, 1);
        } else {
            this.state.selectedNotes = [{ time, lane }];
        }
        this.renderNotes();
    },

    // ── Edit 도구: 선택한 노트를 드래그로 이동 ─────────────────────────
    // 여러 노트가 선택된 상태면 시간(Y)만 옮기고 레인(X)은 고정한다 — 서로 다른 레인의
    // 노트를 한꺼번에 옆 레인으로 옮기면 뭘 어디로 보낼지 모호해지기 때문이다.
    // 선택이 하나뿐이면 레인 이동도 허용한다.
    _startNoteDrag(e, clickedTime, clickedLane) {
        const containerRect = DOM.editor.container.getBoundingClientRect();
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const isSingle = this.state.selectedNotes.length <= 1;

        // 드래그 대상 노트들의 실제 state.notes 참조를 찾아 원본 time/lane을 기억해둔다.
        // 참조를 직접 들고 있어야 드래그 중 실시간으로 위치를 바꿔가며 미리보기를 그릴 수 있다.
        const draggedKeys = new Set(this.state.selectedNotes.map(n => `${n.time}|${n.lane}`));
        const originals = this.state.notes
            .filter(n => draggedKeys.has(`${n.time}|${n.lane}`))
            .map(n => ({ ref: n, time: n.time, lane: n.lane }));
        if (!originals.length) return;

        const DRAG_THRESHOLD_PX = 4;
        let isDragging = false;

        const onMove = (moveEvt) => {
            const dx = moveEvt.clientX - startClientX;
            const dy = moveEvt.clientY - startClientY;
            if (!isDragging) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                isDragging = true;
                this._saveStateForUndo(); // 실제로 옮기기 시작하는 순간에만 undo 스냅샷 1회 저장
            }

            const curY = moveEvt.clientY - containerRect.top + DOM.editor.container.scrollTop;
            const newTimeAtCursor = this._yToSnappedRelativeTimeMs(curY);
            let deltaMs = newTimeAtCursor - clickedTime;

            // 그룹 전체가 허용 하한(시작 지점/타이밍 시작)보다 앞으로 밀리지 않도록,
            // "가장 앞선 노트" 기준으로 delta 자체를 한 번만 제한한다. 노트마다 따로
            // clamp하면 하한에 걸리는 노트들이 전부 같은 값으로 끌려가 뭉쳐버린다 —
            // 여기서는 delta를 제한해서 선택된 노트들 사이의 간격(상대 위치)을 그대로 유지한다.
            const minAllowedMs = this._minAllowedRelativeTimeMs();
            const earliestOriginalTime = Math.min(...originals.map(o => o.time));
            deltaMs = Math.max(deltaMs, minAllowedMs - earliestOriginalTime);

            let deltaLaneIndex = 0;
            if (isSingle) {
                const newLaneId = this._xToLaneId(moveEvt.clientX);
                const fromIdx = CONFIG.EDITOR_LANE_IDS.indexOf(clickedLane);
                const toIdx = CONFIG.EDITOR_LANE_IDS.indexOf(newLaneId);
                deltaLaneIndex = toIdx - fromIdx;
            }

            originals.forEach(o => {
                o.ref.time = o.time + deltaMs;
                if (deltaLaneIndex !== 0) {
                    const idx = CONFIG.EDITOR_LANE_IDS.indexOf(o.lane);
                    const clampedIdx = Math.min(CONFIG.EDITOR_LANE_IDS.length - 1, Math.max(0, idx + deltaLaneIndex));
                    o.ref.lane = CONFIG.EDITOR_LANE_IDS[clampedIdx];
                }
            });
            this.state.selectedNotes = originals.map(o => ({ time: o.ref.time, lane: o.ref.lane }));
            this.renderNotes();
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            if (!isDragging) {
                // 실제로는 안 움직인 순수 클릭 — 클릭한 노트 하나로 선택을 좁힌다.
                this.state.selectedNotes = [{ time: clickedTime, lane: clickedLane }];
                this.renderNotes();
                return;
            }
            this._finishNoteDrag(originals);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    },

    _finishNoteDrag(originals) {
        const draggedRefs = new Set(originals.map(o => o.ref));
        // 옮긴 자리에 드래그 대상이 아닌 다른 노트가 이미 있으면(같은 레인, 10ms 이내) 충돌로
        // 보고 전체 이동을 취소한다 — 노트가 겹쳐써지는 것을 막기 위함.
        const collided = originals.some(o =>
            this.state.notes.some(n => !draggedRefs.has(n) && n.lane === o.ref.lane && Math.abs(n.time - o.ref.time) < 10)
        );
        if (collided) {
            originals.forEach(o => { o.ref.time = o.time; o.ref.lane = o.lane; });
            this.state.selectedNotes = originals.map(o => ({ time: o.ref.time, lane: o.ref.lane }));
            // 취소된 이동이라 undo 스냅샷도 의미가 없으니 방금 저장한 것을 버린다.
            this.state.history.pop();
            UI.showMessage('editor', '다른 노트와 겹쳐서 이동을 취소했습니다.');
            this.renderNotes();
            return;
        }
        // measure 필드도 새 시간 기준으로 갱신 — 타임라인 길이 계산(마디 자동 늘리기 등)이
        // 이 필드를 참조하므로 이동 후에도 정확해야 한다.
        originals.forEach(o => { o.ref.measure = this._getMeasureFromTime(o.ref.time); });
        this.state.selectedNotes = originals.map(o => ({ time: o.ref.time, lane: o.ref.lane }));
        this.setDirty(true);
        this.renderNotes();
    },

    _applyBoxSelection(rect, additive) {
        // 실질적으로 클릭에 가까운(거의 움직이지 않은) 드래그는 새로 선택할 노트가 없다 —
        // additive가 아니면 이미 위에서 선택을 비워뒀으므로 다시 그리기만 한다.
        if (rect.width < 2 && rect.height < 2) {
            this.renderNotes();
            return;
        }
        const boxLeft = rect.left, boxTop = rect.top;
        const boxRight = rect.left + rect.width, boxBottom = rect.top + rect.height;
        const picked = [];
        DOM.editor.notesContainer.querySelectorAll('.editor-note').forEach(noteEl => {
            const left = parseFloat(noteEl.style.left) || 0;
            const top = parseFloat(noteEl.style.top) || 0;
            const right = left + noteEl.offsetWidth;
            const bottom = top + noteEl.offsetHeight;
            const intersects = left < boxRight && right > boxLeft && top < boxBottom && bottom > boxTop;
            if (intersects) {
                picked.push({ time: parseFloat(noteEl.dataset.time), lane: noteEl.dataset.lane });
            }
        });
        if (additive) {
            picked.forEach(p => {
                if (!this.state.selectedNotes.some(n => n.time === p.time && n.lane === p.lane)) {
                    this.state.selectedNotes.push(p);
                }
            });
        } else {
            this.state.selectedNotes = picked;
        }
        this.renderNotes();
    },

    // ── Edit 도구: 복사 / 붙여넣기 ─────────────────────────────────────
    copySelectedNotes() {
        if (!this.state.selectedNotes.length) return;
        const selectedKeys = new Set(this.state.selectedNotes.map(n => `${n.time}|${n.lane}`));
        this.state.clipboardNotes = this.state.notes
            .filter(note => selectedKeys.has(`${note.time}|${note.lane}`))
            .map(note => ({ ...note }));
        if (DOM.editor.statusLabel) {
            DOM.editor.statusLabel.textContent = `${this.state.clipboardNotes.length}개 노트를 복사했습니다.`;
        }
    },

    // 클립보드에 복사해 둔 노트들을 (스냅 격자에 맞춘) 현재 재생헤드 위치를 기준으로
    // 붙여넣는다. 복사한 노트들 중 가장 이른 시각을 기준점 삼아, 그 노트가 재생헤드
    // 위치에 오도록 나머지 노트들도 같은 만큼 통째로 시간축을 밀어서 배치한다 —
    // 복사했던 노트들 사이의 상대적인 배치(간격/레인 구성)는 그대로 유지된다.
    pasteNotes() {
        try {
            if (!this.state.clipboardNotes.length) {
                UI.showMessage('editor', '복사된 노트가 없습니다. 먼저 Ctrl+C로 복사하세요.');
                return;
            }

            const playheadTop = parseFloat(DOM.editor.playhead.style.top) || 0;
            const targetTimeMs = this._yToSnappedRelativeTimeMs(playheadTop);

            const anchorTime = Math.min(...this.state.clipboardNotes.map(n => n.time));
            const deltaMs = targetTimeMs - anchorTime;

            const newNotes = this.state.clipboardNotes.map(note => {
                const newTime = note.time + deltaMs;
                return { ...note, time: newTime, measure: this._getMeasureFromTime(newTime) };
            });

            // 시작 지점(오프셋) 또는 타이밍 시작보다 앞으로 밀려나는 노트가 하나라도 있으면
            // 전체를 취소한다 — 일부만 잘려서 붙여넣어지면 오히려 헷갈리기 때문.
            const minAllowedMs = this._minAllowedRelativeTimeMs();
            if (newNotes.some(n => n.time < minAllowedMs)) {
                UI.showMessage('editor', '재생헤드 위치가 너무 앞이라 붙여넣을 수 없습니다 (시작 지점 또는 타이밍 시작보다 앞).');
                return;
            }

            // 이미 노트가 있는 자리는 덮어쓰지 않고 건너뛴다.
            const existingKeys = new Set(this.state.notes.map(n => `${n.time}|${n.lane}`));
            const toInsert = newNotes.filter(n => !existingKeys.has(`${n.time}|${n.lane}`));

            if (!toInsert.length) {
                UI.showMessage('editor', '붙여넣을 자리에 이미 노트가 있습니다.');
                return;
            }

            this._saveStateForUndo();
            this.setDirty(true);
            this.state.notes.push(...toInsert);
            this.state.selectedNotes = toInsert.map(n => ({ time: n.time, lane: n.lane }));
            this.renderNotes();

            const skipped = newNotes.length - toInsert.length;
            if (DOM.editor.statusLabel) {
                DOM.editor.statusLabel.textContent = skipped > 0
                    ? `${toInsert.length}개 붙여넣음 (${skipped}개는 자리가 겹쳐서 건너뜀)`
                    : `${toInsert.length}개 노트를 붙여넣었습니다.`;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.pasteNotes');
        }
    },

    placeSimpleNote(time, laneId) {
        if (!this.state.notes.some(n => Math.abs(n.time - time) < 10 && n.lane === laneId)) {
            this._saveStateForUndo();
            this.setDirty(true);
            const measure = this._getMeasureFromTime(time);
            this.state.notes.push({ time, lane: laneId, type: this.state.selectedNoteType, measure });
            this.renderNotes();
        }
    },

    placeLongNote(time, laneId) {
        if (!this.state.isPlacingLongNote) {
            // 시작 지점만 지정하는 단계 — 아직 노트가 생기지 않으므로 undo/dirty는 다음
            // (끝 지점을 찍어 실제로 노트가 추가되는) 단계에서만 저장한다.
            this.state.longNoteStart = { time, lane: laneId };
            this.state.isPlacingLongNote = true;
            DOM.editor.statusLabel.textContent = '롱노트의 끝 지점을 지정해주세요.';
        } else {
            if (laneId !== this.state.longNoteStart.lane) {
                UI.showMessage('editor', '시작 지점과 같은 레인을 선택해주세요.');
                return;
            }
            if (time <= this.state.longNoteStart.time) {
                UI.showMessage('editor', '끝 지점은 시작 지점보다 뒤에 있어야 합니다.');
                return;
            }
            this._saveStateForUndo();
            this.setDirty(true);
            const duration = time - this.state.longNoteStart.time;
            const measure = this._getMeasureFromTime(this.state.longNoteStart.time);
            this.state.notes.push({ ...this.state.longNoteStart, duration, type: 'long_head', measure });
            this.renderNotes();
            this.resetLongNotePlacement();
            DOM.editor.statusLabel.textContent = '롱노트의 시작 지점을 지정해주세요.';
        }
    },

    renderNotes() {
        try {
            DOM.editor.notesContainer.querySelectorAll('.editor-note').forEach(n => n.remove());
            // 노트는 타임라인(시크 거터를 뺀 나머지 영역) 너비를 기준으로 배치해야 한다.
            const timelineWidth = DOM.editor.timeline.clientWidth;
            if (timelineWidth === 0) return;
            const adjustedBeatHeight = this._getAdjustedBeatHeight();
            const laneWidth = timelineWidth / CONFIG.EDITOR_LANE_IDS.length;
            const beatsPerSecond = this.state.bpm / 60;
            const offsetSec = this.state.song.startOffsetSec || 0;

            this.state.notes.forEach(note => {
                const noteEl = document.createElement('div');
                noteEl.className = 'editor-note';
                if (note.duration) noteEl.classList.add('long');
                if (note.type === 'false') noteEl.classList.add('false');
                if (this.state.selectedNotes.some(n => n.time === note.time && n.lane === note.lane)) {
                    noteEl.classList.add('selected');
                }
                const laneIndex = CONFIG.EDITOR_LANE_IDS.indexOf(note.lane);
                if (laneIndex === -1) return;
                noteEl.style.width = `${laneWidth}px`;
                noteEl.style.left = `${laneIndex * laneWidth}px`;
                
                // note.time은 오프셋(빨간선) 기준 상대시간이므로, 절대 타임라인 좌표로
                // 그리려면 오프셋을 다시 더해줘야 그리드/빨간선과 정확히 일치한다.
                const yPosition = this._secondsToY((note.time / 1000) + offsetSec);
                noteEl.style.top = `${yPosition}px`;
                
                if (note.duration) {
                    const durationInBeats = (note.duration / 1000) * beatsPerSecond;
                    noteEl.style.height = `${durationInBeats * adjustedBeatHeight}px`;
                }
                noteEl.dataset.time = note.time;
                noteEl.dataset.lane = note.lane;
                
                // 레인별 색상 모드일 때 인라인 스타일 적용
                if (Appearance.settings.colorMode === 'lane' && note.lane) {
                    const color = Appearance.settings.laneColors[note.lane];
                    if (color) {
                        if (note.duration) {
                            const gradientStart = Appearance.adjustColor(color, -20);
                            noteEl.style.background = `linear-gradient(to top, ${gradientStart}, ${color})`;
                        } else {
                            noteEl.style.backgroundColor = color;
                            if (note.type === 'false') {
                                noteEl.style.boxShadow = `0 0 4px ${color}`;
                            }
                        }
                    }
                }
                
                DOM.editor.notesContainer.appendChild(noteEl);
            });
            
            // 트리거도 함께 렌더링
            this.renderTriggers();
        } catch (err) {
            Debugger.logError(err, 'Editor.renderNotes');
        }
    },

    resetLongNotePlacement(clearMessage = true) {
        this.state.isPlacingLongNote = false;
        this.state.longNoteStart = null;
        if (clearMessage && DOM.editor.statusLabel) {
            DOM.editor.statusLabel.textContent = '';
        }
    },

    updateNoteTypeUI() {
        DOM.editor.noteTypeSelector.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === this.state.selectedNoteType);
        });
    },

    handleNoteTypeSelect(e) {
        if (e.target.tagName !== 'BUTTON') return;
        this.setSelectedNoteType(e.target.dataset.type);
    },

    // ── 도구(Create/Edit/Delete) 선택 ─────────────────────────────────
    updateToolUI() {
        DOM.editor.toolSelector.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === this.state.activeTool);
        });
        // Create 도구가 아닐 때는 노트타입 선택이 의미가 없으므로 비활성/dim 처리한다.
        const isCreate = this.state.activeTool === 'create';
        DOM.editor.noteTypeSelector.classList.toggle('tool-disabled', !isCreate);
        DOM.editor.noteTypeSelector.querySelectorAll('button').forEach(btn => {
            btn.disabled = !isCreate;
        });
    },

    handleToolSelect(e) {
        if (e.target.tagName !== 'BUTTON') return;
        this.setActiveTool(e.target.dataset.tool);
    },

    setActiveTool(tool) {
        this.state.activeTool = tool;
        this.updateToolUI();
        // 도구를 바꾸면 진행 중이던 롱노트 배치는 취소한다.
        this.resetLongNotePlacement();
        // Edit 도구를 벗어나면 선택 상태도 함께 비운다.
        if (tool !== 'edit' && this.state.selectedNotes.length) {
            this.state.selectedNotes = [];
            this.renderNotes();
        }
        if (tool === 'edit') {
            DOM.editor.statusLabel.textContent = '드래그 또는 클릭으로 노트를 선택하세요. (Ctrl+C: 복사, Ctrl+V: 붙여넣기)';
        } else if (DOM.editor.statusLabel) {
            DOM.editor.statusLabel.textContent = '';
        }
    },

    handleSnapChange(e) {
        this.setDirty(true);
        this.state.snapDivision = parseInt(e.target.value) || 4;
        this.drawGrid();
        this.renderNotes();
    },

    // 왼쪽/오른쪽 화살표 키: 스냅 분할(#editor-snap-selector의 <option> 목록 기준)을
    // 이전/다음 단계로 바꾼다. 12·24처럼 2배씩 늘어나지 않는 옵션도 있어서 숫자를 직접
    // 연산하지 않고 select의 실제 옵션 순서를 따라간다. direction: -1 = 더 큰 분할(왼쪽),
    // 1 = 더 작은 분할(오른쪽).
    adjustSnapDivision(direction) {
        try {
            const select = DOM.editor.snapSelector;
            if (!select || !select.options.length) return;
            const options = Array.from(select.options).map(o => parseInt(o.value, 10));
            const currentIndex = options.indexOf(this.state.snapDivision);
            const baseIndex = currentIndex === -1 ? 0 : currentIndex;
            const newIndex = Math.min(options.length - 1, Math.max(0, baseIndex + direction));
            const newDivision = options[newIndex];
            if (newDivision === this.state.snapDivision) return;

            this.state.snapDivision = newDivision;
            select.value = String(newDivision);
            this.setDirty(true);
            this.drawGrid();
            this.renderNotes();
            if (DOM.editor.statusLabel) {
                DOM.editor.statusLabel.textContent = `스냅 분할: 1/${newDivision}`;
            }
        } catch (err) {
            Debugger.logError(err, 'Editor.adjustSnapDivision');
        }
    },

    setSelectedNoteType(type) {
        this.state.selectedNoteType = type;
        this.updateNoteTypeUI();
        if (type === 'long') {
            this.state.isPlacingLongNote = false;
            DOM.editor.statusLabel.textContent = '롱노트의 시작 지점을 지정해주세요.';
        } else {
            this.resetLongNotePlacement();
        }
    },

    placeNoteAtPlayhead(laneId) {
        if (!laneId) return;
        const playheadTop = parseFloat(DOM.editor.playhead.style.top) || 0;
        // handleTimelineClick과 동일한 계산이라 중복을 없애고 공용 헬퍼를 재사용한다.
        const timeInMs = this._yToSnappedRelativeTimeMs(playheadTop);
        if (timeInMs < this._minAllowedRelativeTimeMs()) return; // 시작 지점/타이밍 시작보다 앞에는 찍지 않음
        this.placeSimpleNote(timeInMs, laneId);
    },

    handleUndo() {
        if (this.state.history.length > 0) {
            this.setDirty(true);
            const previous = this.state.history.pop();
            this.state.notes = previous.notes;
            this.state.triggers = previous.triggers;
            this.renderNotes(); // 내부에서 renderTriggers()도 함께 호출됨
        }
    },

    // ===== 에디터 미리보기 기능 =====
    
});
