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

    init() {
        DOM.settings.debugModeToggle.addEventListener('change', (e) => {
            this.toggle(e.target.checked);
        });

        const titleEl = DOM.debugTitle;
        if (titleEl) {
            titleEl.addEventListener('mousedown', (e) => this.dragStart(e));
            titleEl.addEventListener('touchstart', (e) => this.dragStart(e));
        }
    },

    toggle(isEnabled) {
        this.isActive = isEnabled;
        DOM.debugOverlay.classList.toggle('hidden', !isEnabled);
    },

    _getEventCoords(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    },

    dragStart(e) {
        this.dragState.isDragging = true;
        const overlay = DOM.debugOverlay;
        const coords = this._getEventCoords(e);
        this.dragState.offsetX = coords.x - overlay.offsetLeft;
        this.dragState.offsetY = coords.y - overlay.offsetTop;
        overlay.style.right = 'auto';
        this.boundDragMove = (ev) => this.dragMove(ev);
        this.boundDragEnd = () => this.dragEnd();
        window.addEventListener('mousemove', this.boundDragMove);
        window.addEventListener('mouseup', this.boundDragEnd);
        window.addEventListener('touchmove', this.boundDragMove);
        window.addEventListener('touchend', this.boundDragEnd);
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

    logError(error, context = 'Unknown') {
        console.error(`[${context}]`, error && error.message ? error.message : error, error && error.stack ? error.stack : '');
        if (!this.isActive) return;
        const logContainer = DOM.debugLogContainer;
        const errorEl = document.createElement('p');
        errorEl.innerHTML = `<span class="error-context">[${context}]</span>: <span class="error-message">${error.message}</span>`;
        logContainer.appendChild(errorEl);
        logContainer.scrollTop = logContainer.scrollHeight;
    },

    updateState(stateObject) {
        if (!this.isActive) return;
        const replacer = (key, value) => {
            if (key === "notes" && Array.isArray(value)) {
                return `[...Array(${value.length})]`;
            }
            return value;
        };
        const sanitizedState = JSON.stringify(stateObject, replacer, 2);
        DOM.debugStateContainer.querySelector('pre').textContent = sanitizedState;
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
        DOM.debugPerfContainer.innerHTML = perfHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    let isListeningForKey = false;
    let currentBindingElement = null;
    let currentKeybindLanes = 4; // 환경설정에서 현재 편집 중인 레인 수 그룹
    let tempKeyMappingsByLanes = {}; // { 4: {L2:'D', ...}, 5: {...}, ... } — 저장 전까지의 임시 편집본

    // ── 환경설정 → 에디터 탭 (차트 에디터 전용 단축키/기본값) ──────────────────
    let isListeningForEditorKey = false;
    let currentEditorBindingElement = null;
    let currentEditorBindingKind = null; // 'lane' | 'tool'
    let tempEditorLaneKeys = {}; // laneId -> code (e.g. 'KeyQ') — 저장 전까지의 임시 편집본
    let tempEditorToolKeys = {}; // { create: 'z', edit: 'x' } — 저장 전까지의 임시 편집본

    // ── 환경설정 → 조작 탭: 길게 눌러 즉시 재시작 단축키 ─────────────────────
    let isListeningForRestartKey = false;
    let tempRestartHotkeyCode = null; // 저장 전까지의 임시 편집본(e.code)
    let restartHoldTimer = null;      // 현재 누르고 있는 홀드의 setTimeout id
    let restartHoldActive = false;    // 지금 그 키를 누르고 있는 중인지(키 반복 이벤트 무시용)

    // 레인 id -> 라벨 i18n 키 (조작 탭에서 각 키 상자 옆에 표시할 텍스트)
    const KEYBIND_LABEL_I18N = {
        L4: 'left_4', L3: 'left_3', L2: 'left_2', L1: 'left_1',
        C1: 'center',
        R1: 'right_1', R2: 'right_2', R3: 'right_3', R4: 'right_4'
    };

    // ── Phase 3: 드래그앤드롭 파일 가져오기 ──────────────────────────────
    // dropzoneEl 영역(카드/패널 전체) 어디에 파일을 놓아도 인식한다.
    // resolveTarget(file)이 파일 종류에 맞는 <input type=file>을 돌려주면
    // 그 input.files에 반영하고 기존 'change' 리스너(handleAudioSelect 등)를
    // 그대로 재사용하도록 change 이벤트를 발생시킨다. 매칭되는 input이 없으면
    // (지원하지 않는 파일 형식) unsupportedMessage를 보여준다.
    function setupFileDropzone(dropzoneEl, resolveTarget, messageType, unsupportedMessage) {
        if (!dropzoneEl) return;

        dropzoneEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzoneEl.classList.add('dropzone-active');
        });

        dropzoneEl.addEventListener('dragleave', (e) => {
            // 자식 요소로 이동하며 발생하는 dragleave는 무시 (깜빡임 방지)
            if (!dropzoneEl.contains(e.relatedTarget)) {
                dropzoneEl.classList.remove('dropzone-active');
            }
        });

        dropzoneEl.addEventListener('drop', (e) => {
            e.preventDefault();
            // 이 존에서 처리했음을 표시 -> window의 전역 낙제 안내 메시지로 새지 않게 함
            e.stopPropagation();
            dropzoneEl.classList.remove('dropzone-active');

            const files = e.dataTransfer && e.dataTransfer.files;
            if (!files || files.length === 0) return;
            const file = files[0]; // 입력당 파일 1개만 취급 (동시 드롭은 범위 밖)

            const inputEl = resolveTarget(file);
            if (!inputEl) {
                if (messageType) UI.showMessage(messageType, unsupportedMessage || '지원하지 않는 파일 형식입니다.');
                return;
            }

            const dt = new DataTransfer();
            dt.items.add(file);
            inputEl.files = dt.files;
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    // 드롭존 밖(페이지 전체)에 파일을 놓으면 브라우저가 새 탭으로 여는 기본 동작을 막고,
    // 종합 창/에디터 화면에서 놓친 경우 어디에 놓아야 하는지 안내한다.
    // (드롭존의 drop 핸들러는 stopPropagation()하므로, 여기 도달했다는 건
    //  유효한 드롭존 밖에 놓았다는 뜻)
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        if (UI.currentScreen === 'editorSong') {
            UI.showMessage('editorSong', '회색 카드 영역 안에 놓아주세요 (오디오/이미지/json 파일 자동 인식됩니다)');
        } else if (UI.currentScreen === 'editor') {
            UI.showMessage('editor', '🎵 음악 설정 박스 안에 놓아주세요');
        }
    });

    function setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            if (isListeningForKey) {
                handleKeyBinding(e);
            } else if (isListeningForEditorKey) {
                handleEditorKeyBinding(e);
            } else if (isListeningForRestartKey) {
                handleRestartKeyBinding(e);
            } else if (Game.state.gameState === 'editor') {
                Editor.handleEditorKeyPress(e);
            } else {
                Game.handleKeyDown(e);
                handleRestartHoldKeyDown(e);
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!isListeningForKey && !isListeningForEditorKey && !isListeningForRestartKey) {
                Game.handleKeyUp(e);
                handleRestartHoldKeyUp(e);
            }
        });

        window.addEventListener('click', (e) => {
            if (isListeningForKey && !e.target.classList.contains('keybind-box')) {
                cancelKeyBinding();
            }
            if (isListeningForEditorKey && !e.target.classList.contains('keybind-box')) {
                cancelEditorKeyBinding();
            }
            if (isListeningForRestartKey && !e.target.classList.contains('keybind-box')) {
                cancelRestartKeyBinding();
            }
        });

        DOM.pauseGameBtn.addEventListener('click', () => Game.togglePause());
        DOM.resumeGameBtn.addEventListener('click', () => Game.togglePause());
        DOM.settings.iconMenu.addEventListener('click', showSettingsScreen);
        DOM.settings.iconPlaying.addEventListener('click', showSettingsScreen);

        DOM.settings.backBtn.addEventListener('click', () => {
            cancelKeyBinding();
            cancelEditorKeyBinding();
            Game.state.gameState = Game.state.previousScreen;
            UI.showScreen(Game.state.previousScreen);
            if (Game.state.previousScreen === 'playing' && Game.state.isPaused) {
                DOM.pauseGameBtn.classList.add('hidden');
                DOM.resumeGameBtn.classList.remove('hidden');
            }
        });

        document.getElementById('practice-btn').addEventListener('click', () => {
            UI.showScreen('practice');
        });

        document.getElementById('practice-back-btn').addEventListener('click', () => {
            UI.showScreen('menu');
        });

        document.getElementById('start-game-btn').addEventListener('click', async () => {
            // 연습 화면에서 오는 랜덤 모드 — 온라인 상태 초기화
            Game.state._onlineChartId = null;
            Game.state.settings.musicSrc = null;
            Game.state.settings.mode = 'random';
            DOM.musicPlayer.src = '';
            await Game.start();
        });

        document.getElementById('give-up-btn').addEventListener('click', () => Game.end());
        document.getElementById('back-to-menu-btn').addEventListener('click', () => {
            // 싱글/온라인 플레이 전용 — 멀티플레이 결과 화면은 이 버튼 자체가 숨겨지고
            // 대신 mp-restart-btn/mp-return-room-btn을 쓴다.
            DOM.lanesContainer.innerHTML = '';
            resetPlayingScreenUI();
            const wasOnline  = !!Game.state._onlineChartId;
            const wasRandom  = Game.state.settings.mode === 'random';
            Game.state._onlineChartId = null;
            Game.state.gameState = 'menu';
            if (wasOnline) {
                Online.show('browse');
            } else if (wasRandom) {
                UI.showScreen('practice');
            } else {
                UI.showScreen('menu');
            }
        });

        // 멀티플레이 전용 결과 화면 버튼 — 재시작(전원 동의 시 방을 거치지 않고 즉시 재시작) /
        // 방으로 돌아가기(대기실로 복귀, 내 준비 상태 해제).
        document.getElementById('mp-restart-btn')?.addEventListener('click', () => MultiplayerLobby.requestRestart());
        document.getElementById('mp-return-room-btn')?.addEventListener('click', () => {
            DOM.lanesContainer.innerHTML = '';
            resetPlayingScreenUI();
            Game.state._onlineChartId = null;
            Game.state.gameState = 'menu';
            MultiplayerLobby.returnToWaitingRoom();
        });

        // 온라인 라이브러리 버튼
        document.getElementById('online-btn').addEventListener('click', () => {
            Game.state.gameState = 'online';
            Online.show('browse', null, { pickMode: false });
        });

        // 멀티플레이 버튼
        document.getElementById('multiplayer-btn').addEventListener('click', () => {
            Game.state.gameState = 'multiplayer';
            MultiplayerLobby.show();
        });

        // Phase 3e: 비트맵 창의 개별 서버 업로드/불러오기 버튼은 제거됨.
        // 클라우드 업로드는 종합 창(EditorSong.uploadToCloud), 불러오기는 에디터 홈(EditorHome.open)에서 한다.

        document.getElementById('editor-btn').addEventListener('click', () => {
            // Phase 3a: '에디터' 버튼은 이제 비트맵 창으로 바로 안 들어가고 에디터 홈으로 감
            Game.state.gameState = 'editor';
            UI.showScreen('editorHome');
            EditorHome.refresh(); // Phase 3d: 내 노래(클라우드) 목록 새로고침
        });

        // ── Phase 3: 에디터 홈 / 종합 창 네비게이션 ──
        document.getElementById('editor-home-back-btn').addEventListener('click', () => {
            UI.showScreen('menu');
        });
        document.getElementById('editor-home-new-song-btn').addEventListener('click', () => {
            EditorSong.newSong();
        });
        // ── 베타: .osu 파일 변환 화면 ──
        document.getElementById('editor-home-osu-convert-btn').addEventListener('click', () => {
            EditorOsuConvert.reset();
            UI.showScreen('osuConvert');
        });
        DOM.osuConvert.backBtn.addEventListener('click', () => {
            UI.showScreen('editorHome');
            EditorHome.refresh();
        });
        DOM.osuConvert.fileInput.addEventListener('change', (e) => {
            EditorOsuConvert.handleFiles(e.target.files);
            e.target.value = ''; // 같은 파일을 다시 골라도 change가 또 발생하도록
        });
        DOM.osuConvert.fallSpeedSlider.addEventListener('input', (e) => {
            EditorOsuConvert.onFallSpeedInput(e.target.value);
        });
        DOM.osuConvert.importBtn.addEventListener('click', () => {
            EditorOsuConvert.importAsNewSong();
        });
        document.getElementById('editor-song-back-btn').addEventListener('click', () => {
            UI.showScreen('editorHome');
            EditorHome.refresh(); // Phase 3d: 방금 업로드했을 수 있으니 목록 새로고침
        });
        document.getElementById('editor-song-add-beatmap-btn').addEventListener('click', () => {
            EditorSong.addBeatmap();
        });
        document.getElementById('editor-back-to-song-btn').addEventListener('click', () => {
            // 재생/미리보기 중이었다면 나가기 전에 완전히 정지 (안 그러면 오디오/애니메이션이 백그라운드에 남음)
            Editor.stopPlayback();
            // Phase 3b: 현재 편집 상태를 beatmaps[activeBeatmapIndex]에 반영하고 종합 창으로 이동
            Editor.saveFlatStateToBeatmap();
            UI.showScreen('editorSong');
            EditorSong.render();
        });

        // ── Phase 3c: 종합 창 로컬 기능 (노래 메타 입력 / 로컬 저장·불러오기) ──
        DOM.editorSong.titleInput.addEventListener('input', (e) => EditorSong.onTitleInput(e.target.value));
        DOM.editorSong.artistInput.addEventListener('input', (e) => EditorSong.onArtistInput(e.target.value));
        DOM.editorSong.previewStartInput.addEventListener('input', (e) => EditorSong.onPreviewStartInput(e.target.value));
        DOM.editorSong.startTimeInput.addEventListener('input', (e) => EditorSong.onStartTimeInput(e.target.value));
        if (DOM.editorSong.timingStartInput) {
            DOM.editorSong.timingStartInput.addEventListener('input', (e) => EditorSong.onTimingStartInput(e.target.value));
        }
        DOM.editorSong.audioFileInput.addEventListener('change', (e) => EditorSong.handleAudioSelect(e.target.files[0]));
        DOM.editorSong.coverFileInput.addEventListener('change', (e) => EditorSong.handleCoverSelect(e.target.files[0]));
        DOM.editorSong.saveLocalBtn.addEventListener('click', () => EditorSong.saveLocal());
        DOM.editorSong.loadLocalInput.addEventListener('change', (e) => {
            EditorSong.loadLocalFiles(e.target.files);
            e.target.value = ''; // 같은 파일을 다시 골라도 change가 또 발생하도록
        });
        setupFileDropzone(
            DOM.editorSong.infoCardDropzone,
            (file) => {
                if (file.type.startsWith('audio/')) return DOM.editorSong.audioFileInput;
                if (file.type.startsWith('image/')) return DOM.editorSong.coverFileInput;
                if (file.name.toLowerCase().endsWith('.json')) return DOM.editorSong.loadLocalInput;
                return null;
            },
            'editorSong',
            '오디오/이미지/json(로컬 채보) 파일만 끌어다 놓을 수 있습니다.'
        );

        // ── Phase 3d/5a: 종합 창 클라우드 저장 — 공개(라이브러리 노출) / 비공개(서버 저장만) ──
        DOM.editorSong.uploadCloudBtn.addEventListener('click', () => EditorSong.uploadToCloud(true));
        if (DOM.editorSong.saveDraftBtn) {
            DOM.editorSong.saveDraftBtn.addEventListener('click', () => EditorSong.uploadToCloud(false));
        }

        // Trigger modal event listeners
        DOM.triggerModal.confirmBtn.addEventListener('click', () => {
            Editor.confirmTrigger();
        });

        DOM.triggerModal.cancelBtn.addEventListener('click', () => {
            Editor.hideTriggerModal();
        });

        document.getElementById('trigger-close-x')?.addEventListener('click', () => {
            Editor.hideTriggerModal();
        });

        DOM.triggerModal.container.addEventListener('click', (e) => {
            if (e.target === DOM.triggerModal.container) {
                Editor.hideTriggerModal();
            }
        });

        // 난이도(쉬움/보통/어려움) + 실전형 드릴(순발력/복합 패턴) 버튼 — 두 그룹 다 같은 프리셋
        // 적용 로직을 타므로 리스너를 공유한다. 클릭된 프리셋만 active로 남기려면 두 그룹의
        // 버튼을 모두 대상으로 active 클래스를 지워야 한다(안 그러면 난이도 버튼과 드릴 버튼이
        // 동시에 active로 남는 경우가 생김).
        document.getElementById('difficulty-selector').addEventListener('click', handleDifficultyPresetClick);
        document.getElementById('drill-selector').addEventListener('click', handleDifficultyPresetClick);

        function handleDifficultyPresetClick(e) {
            if (e.target.tagName !== 'BUTTON') return;
            const preset = e.target.dataset.difficulty;
            Game.state.settings.difficulty = preset;
            Game.state.settings.noteSpeed = CONFIG.DIFFICULTY_SPEED[preset];
            Game.state.settings.noteSpawnSpeed = CONFIG.NOTE_SPAWN_SPEED[preset];
            Game.state.settings.dongtaProbability = CONFIG.SIMULTANEOUS_NOTE_PROBABILITY[preset];
            Game.state.settings.maxSimultaneousNotes = CONFIG.MAX_SIMULTANEOUS_NOTES[preset];
            Game.state.settings.dongtaNoteTypeProbabilities = { ...CONFIG.SIMULTANEOUS_NOTE_TYPE_PROBABILITY[preset] };
            Game.state.settings.longNoteProbability = CONFIG.LONG_NOTE_PROBABILITY[preset];
            Game.state.settings.falseNoteProbability = CONFIG.FALSE_NOTE_PROBABILITY[preset];
            updateDetailedSettingsUI();
            document.querySelectorAll('#difficulty-selector button, #drill-selector button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            saveLastPracticeSettings();
        }

        DOM.difficulty.toggleBtn.addEventListener('click', () => {
            DOM.difficulty.detailsPanel.classList.toggle('hidden');
            DOM.difficulty.toggleIcon.classList.toggle('rotate-180');
        });

        // 노트 밀도/패턴 복잡도/특수 노트 섹션 접기·펼치기 (연습모드-개선계획.md 1번)
        document.querySelectorAll('.settings-section-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = document.getElementById(btn.dataset.target);
                if (!body) return;
                body.classList.toggle('hidden');
                const icon = btn.querySelector('.section-toggle-icon');
                if (icon) icon.classList.toggle('rotate-180');
            });
        });

        // "?" 툴팁 — 데스크톱은 CSS hover만으로 뜨지만, 모바일은 호버가 없으므로 탭으로 토글한다.
        // 한 번에 하나만 열리도록 다른 툴팁은 탭 시 닫는다. 툴팁 바깥을 탭하면 모두 닫는다.
        document.querySelectorAll('.info-tooltip').forEach(tip => {
            tip.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasActive = tip.classList.contains('active');
                document.querySelectorAll('.info-tooltip.active').forEach(t => t.classList.remove('active'));
                if (!wasActive) tip.classList.add('active');
            });
        });
        document.addEventListener('click', () => {
            document.querySelectorAll('.info-tooltip.active').forEach(t => t.classList.remove('active'));
        });

        // 내 프리셋(이름 붙여 저장/불러오기/삭제) — 연습모드-개선계획.md 1번
        const customPresetSelect = document.getElementById('custom-preset-select');
        const customPresetLoadBtn = document.getElementById('custom-preset-load-btn');
        const customPresetSaveBtn = document.getElementById('custom-preset-save-btn');
        const customPresetDeleteBtn = document.getElementById('custom-preset-delete-btn');

        customPresetSaveBtn.addEventListener('click', () => {
            const name = (prompt(I18n.t('custom_preset_name_prompt')) || '').trim();
            if (!name) return;
            const map = loadCustomPresetsMap();
            map[name] = collectPracticeSettings();
            saveCustomPresetsMap(map);
            refreshCustomPresetSelect();
            customPresetSelect.value = name;
        });

        customPresetLoadBtn.addEventListener('click', () => {
            if (!customPresetSelect.value) return;
            const map = loadCustomPresetsMap();
            const preset = map[customPresetSelect.value];
            if (preset) {
                applyPracticeSettings(preset);
                saveLastPracticeSettings();
            }
        });

        customPresetDeleteBtn.addEventListener('click', () => {
            if (!customPresetSelect.value) return;
            if (!confirm(I18n.t('custom_preset_delete_confirm', { name: customPresetSelect.value }))) return;
            const map = loadCustomPresetsMap();
            delete map[customPresetSelect.value];
            saveCustomPresetsMap(map);
            refreshCustomPresetSelect();
        });

        DOM.noteCountInput.addEventListener('change', saveLastPracticeSettings);

        DOM.difficulty.fallSpeedSlider.addEventListener('input', (e) => {
            Game.state.settings.noteSpeed = parseInt(e.target.value);
            DOM.difficulty.fallSpeedValue.textContent = e.target.value;
            setCustomDifficulty();
        });

        DOM.difficulty.spawnSpeedSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            Game.state.settings.noteSpawnSpeed = value / 100;
            DOM.difficulty.spawnSpeedValue.textContent = `${(value / 100).toFixed(1)}x`;
            setCustomDifficulty();
        });

        DOM.difficulty.dongtaSlider.addEventListener('input', (e) => {
            Game.state.settings.dongtaProbability = parseInt(e.target.value) / 100;
            DOM.difficulty.dongtaValue.textContent = `${e.target.value}%`;
            setCustomDifficulty();
        });

        DOM.difficulty.maxSimultaneousSlider.addEventListener('input', (e) => {
            const requestedMax = parseInt(e.target.value);
            const currentLanes = Game.state.settings.lanes;
            
            if (requestedMax > currentLanes) {
                Game.state.settings.maxSimultaneousNotes = currentLanes;
                DOM.difficulty.maxSimultaneousSlider.value = currentLanes;
                DOM.difficulty.maxSimultaneousValue.textContent = currentLanes;
                UI.showMessage('menu', `최대 동시타 개수가 지정된 레인 수(${currentLanes})를 넘어 자동으로 ${currentLanes}개로 조정되었습니다.`);
            } else {
                Game.state.settings.maxSimultaneousNotes = requestedMax;
                DOM.difficulty.maxSimultaneousValue.textContent = requestedMax;
            }
            setCustomDifficulty();
        });

        DOM.difficulty.dongtaTapProbSlider.addEventListener('input', (e) => {
            const tapProb = parseInt(e.target.value) / 100;
            Game.state.settings.dongtaNoteTypeProbabilities.tap = tapProb;
            DOM.difficulty.dongtaTapProbValue.textContent = `${e.target.value}%`;
            setCustomDifficulty();
        });

        DOM.difficulty.dongtaLongProbSlider.addEventListener('input', (e) => {
            const longProb = parseInt(e.target.value) / 100;
            Game.state.settings.dongtaNoteTypeProbabilities.long = longProb;
            DOM.difficulty.dongtaLongProbValue.textContent = `${e.target.value}%`;
            setCustomDifficulty();
        });

        DOM.difficulty.dongtaFalseProbSlider.addEventListener('input', (e) => {
            const falseProb = parseInt(e.target.value) / 100;
            Game.state.settings.dongtaNoteTypeProbabilities.false = falseProb;
            DOM.difficulty.dongtaFalseProbValue.textContent = `${e.target.value}%`;
            setCustomDifficulty();
        });

        DOM.difficulty.longNoteSlider.addEventListener('input', (e) => {
            Game.state.settings.longNoteProbability = parseInt(e.target.value) / 100;
            DOM.difficulty.longNoteValue.textContent = `${e.target.value}%`;
            setCustomDifficulty();
        });

        DOM.difficulty.falseNoteToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            DOM.difficulty.falseNoteProbContainer.classList.toggle('hidden', !isEnabled);
            if (isEnabled) {
                const probValue = parseInt(DOM.difficulty.falseNoteProbSlider.value);
                Game.state.settings.falseNoteProbability = probValue / 1000;
            } else {
                Game.state.settings.falseNoteProbability = 0;
            }
            setCustomDifficulty();
        });

        DOM.difficulty.falseNoteProbSlider.addEventListener('input', (e) => {
            const probValue = parseInt(e.target.value);
            Game.state.settings.falseNoteProbability = probValue / 1000;
            DOM.difficulty.falseNoteProbValue.textContent = `${(probValue / 10)}%`;
            setCustomDifficulty();
        });

        document.getElementById('lanes-selector').addEventListener('change', (e) => {
            const newLanes = parseInt(e.target.value);
            Game.state.settings.lanes = newLanes;
            
            // 최대 동시타 개수가 레인 수를 초과하는지 검증
            if (Game.state.settings.maxSimultaneousNotes > newLanes) {
                Game.state.settings.maxSimultaneousNotes = newLanes;
                DOM.difficulty.maxSimultaneousSlider.value = newLanes;
                DOM.difficulty.maxSimultaneousValue.textContent = newLanes;
                UI.showMessage('menu', `레인 수가 ${newLanes}개로 변경되어 최대 동시타 개수도 ${newLanes}개로 조정되었습니다.`);
            }
            saveLastPracticeSettings();
        });

        document.getElementById('chart-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const rawChartData = JSON.parse(event.target.result);
                    const normalized = ChartFormat.normalize(rawChartData);
                    if (normalized.beatmapCount > 1) {
                        UI.showMessage('menu', `이 파일에는 난이도가 ${normalized.beatmapCount}개 있습니다. 첫 번째 난이도로 플레이합니다.`);
                    }
                    const chartData = { songName: normalized.songName, ...normalized.beatmap };
                    if (Game.loadChartNotes(chartData)) {
                        DOM.chartFileNameEl.textContent = `차트: ${file.name}`;
                        if (Game.state.settings.requiredSongName) {
                            DOM.requiredMusicFileNameEl.textContent = `요구 음악 파일: ${Game.state.settings.requiredSongName}`;
                        } else {
                            DOM.requiredMusicFileNameEl.textContent = '';
                        }
                    }
                } catch (error) {
                    UI.showMessage('menu', '잘못된 차트 파일 형식입니다.');
                }
            };
            reader.readAsText(file);
            e.target.value = null;
        });

        document.getElementById('music-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                Game.state.settings.musicFileObject = file;
                Game.state.settings.musicSrc = null;
                DOM.musicFileNameEl.textContent = `음악: ${file.name}`;
            }
            e.target.value = null;
        });

        DOM.settings.tabsContainer.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') return;
            const tabName = e.target.dataset.tab;
            DOM.settings.tabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            DOM.settings.tabContents.forEach(content => content.classList.add('hidden'));
            e.target.classList.add('active');
            document.getElementById(`tab-content-${tabName}`).classList.remove('hidden');
        });

        if (DOM.settings.editorTab.gridStyleSelector) {
            DOM.settings.editorTab.gridStyleSelector.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-grid-style]');
                if (!btn) return;
                CONFIG.EDITOR_GRID_LINE_STYLE = btn.dataset.gridStyle;
                persistEditorSettings();
                updateGridStyleButtons();
                // 지금 비트맵 창이 열려있으면 그리드도 바로 다시 그려서 즉시 반영한다.
                if (Game.state.gameState === 'editor') Editor.drawGrid();
            });
        }

        DOM.settings.musicVolumeSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            Game.state.settings.musicVolume = value;
            DOM.settings.musicVolumeValue.textContent = value;
            Audio.setMusicVolume(value);
        });
        // 드래그가 끝났을 때(change)만 계정에 저장 — input마다 저장하면 요청이 너무 잦음
        DOM.settings.musicVolumeSlider.addEventListener('change', () => {
            CloudAuth.saveVolumeSettings(Game.state.settings.musicVolume, Game.state.settings.sfxVolume);
        });

        DOM.settings.sfxVolumeSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            Game.state.settings.sfxVolume = value;
            DOM.settings.sfxVolumeValue.textContent = value;
            Audio.setSfxVolume(value);
        });
        DOM.settings.sfxVolumeSlider.addEventListener('change', () => {
            CloudAuth.saveVolumeSettings(Game.state.settings.musicVolume, Game.state.settings.sfxVolume);
        });

        if (DOM.settings.gameplayImageOpacitySlider) {
            DOM.settings.gameplayImageOpacitySlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                Game.state.settings.gameplayImageOpacity = value;
                if (DOM.settings.gameplayImageOpacityValue) {
                    DOM.settings.gameplayImageOpacityValue.textContent = value;
                }
                GameBackground.applyOpacity();
            });
            // 드래그가 끝났을 때(change)만 저장 — input마다 저장하면 요청이 너무 잦음
            DOM.settings.gameplayImageOpacitySlider.addEventListener('change', () => {
                localStorage.setItem('theBeat_gameplayImageOpacity', Game.state.settings.gameplayImageOpacity);
                savePlaySettingsToCloud();
            });
        }

        if (DOM.settings.laneBackgroundOpacitySlider) {
            DOM.settings.laneBackgroundOpacitySlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                Game.state.settings.laneBackgroundOpacity = value;
                if (DOM.settings.laneBackgroundOpacityValue) {
                    DOM.settings.laneBackgroundOpacityValue.textContent = value;
                }
                document.documentElement.style.setProperty('--lane-bg-opacity', value / 100);
            });
            DOM.settings.laneBackgroundOpacitySlider.addEventListener('change', () => {
                localStorage.setItem('theBeat_laneBackgroundOpacity', Game.state.settings.laneBackgroundOpacity);
                savePlaySettingsToCloud();
            });
        }

        if (DOM.settings.laneHighlightToggle) {
            DOM.settings.laneHighlightToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                Game.state.settings.laneHighlightOnInput = enabled;
                localStorage.setItem('theBeat_laneHighlightOnInput', enabled ? 'true' : 'false');
                savePlaySettingsToCloud();
            });
        }

        if (DOM.settings.autoHideUiToggle) {
            DOM.settings.autoHideUiToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                Game.state.settings.autoHideUiOnPlay = enabled;
                localStorage.setItem('theBeat_autoHideUiOnPlay', enabled ? 'true' : 'false');
                savePlaySettingsToCloud();
                // 플레이 중(일시정지 아님)에 설정을 켜고 끄면 즉시 반영
                if (UI.currentScreen === 'playing' && !Game.state.isPaused) {
                    UI.setPanelCollapsed(enabled);
                }
            });
        }

        if (DOM.settings.defaultFallSpeedToggle) {
            DOM.settings.defaultFallSpeedToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                Game.state.settings.useDefaultFallSpeed = enabled;
                localStorage.setItem('theBeat_useDefaultFallSpeed', enabled ? 'true' : 'false');
                savePlaySettingsToCloud();
                if (DOM.settings.defaultFallSpeedContainer) {
                    DOM.settings.defaultFallSpeedContainer.classList.toggle('hidden', !enabled);
                }
            });
        }

        if (DOM.settings.defaultFallSpeedSlider) {
            DOM.settings.defaultFallSpeedSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                Game.state.settings.defaultFallSpeedValue = value;
                if (DOM.settings.defaultFallSpeedValue) {
                    DOM.settings.defaultFallSpeedValue.textContent = value;
                }
            });
            DOM.settings.defaultFallSpeedSlider.addEventListener('change', () => {
                localStorage.setItem('theBeat_defaultFallSpeedValue', Game.state.settings.defaultFallSpeedValue);
                savePlaySettingsToCloud();
            });
        }

        if (DOM.settings.inputOffsetSlider) {
            DOM.settings.inputOffsetSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                Game.state.settings.inputOffsetMs = value;
                if (DOM.settings.inputOffsetValue) {
                    DOM.settings.inputOffsetValue.textContent = `${value}ms`;
                }
            });
            DOM.settings.inputOffsetSlider.addEventListener('change', () => {
                localStorage.setItem('theBeat_inputOffsetMs', Game.state.settings.inputOffsetMs);
                savePlaySettingsToCloud();
            });
        }

        if (DOM.settings.touchInputOffsetSlider) {
            DOM.settings.touchInputOffsetSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                Game.state.settings.touchInputOffsetMs = value;
                if (DOM.settings.touchInputOffsetValue) {
                    DOM.settings.touchInputOffsetValue.textContent = `${value}ms`;
                }
            });
            DOM.settings.touchInputOffsetSlider.addEventListener('change', () => {
                localStorage.setItem('theBeat_touchInputOffsetMs', Game.state.settings.touchInputOffsetMs);
                savePlaySettingsToCloud();
            });
        }

        // 키 상자는 레인 수 그룹에 따라 동적으로 생성되므로 이벤트 위임으로 처리
        DOM.settings.controls.rowsContainer.addEventListener('click', (e) => {
            const box = e.target.closest('.keybind-box');
            if (!box) return;
            if (isListeningForKey) cancelKeyBinding();
            if (isListeningForRestartKey) cancelRestartKeyBinding();
            startKeyBinding(box);
        });

        DOM.settings.controls.lanesSelector.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') return;
            if (isListeningForKey) cancelKeyBinding();
            currentKeybindLanes = parseInt(e.target.dataset.lanes, 10);
            updateKeybindLanesSelectorUI();
            renderKeybindGroup(currentKeybindLanes);
        });

        DOM.settings.controls.saveBtn.addEventListener('click', () => saveKeyBindings());

        DOM.settings.controls.restartHotkeyBox.addEventListener('click', () => {
            if (isListeningForKey) cancelKeyBinding();
            if (isListeningForEditorKey) cancelEditorKeyBinding();
            if (isListeningForRestartKey) cancelRestartKeyBinding();
            startRestartKeyBinding();
        });

        // 환경설정 → 에디터 탭: 키 상자는 동적 생성이므로 이벤트 위임으로 처리
        DOM.settings.editorTab.keybindRows.addEventListener('click', (e) => {
            const box = e.target.closest('.keybind-box');
            if (!box) return;
            if (isListeningForEditorKey) cancelEditorKeyBinding();
            startEditorKeyBinding(box, 'lane');
        });
        DOM.settings.editorTab.toolKeyRows.addEventListener('click', (e) => {
            const box = e.target.closest('.keybind-box');
            if (!box) return;
            if (isListeningForEditorKey) cancelEditorKeyBinding();
            startEditorKeyBinding(box, 'tool');
        });
        DOM.settings.editorTab.saveBtn.addEventListener('click', () => saveEditorKeybinds());
        DOM.settings.editorTab.resetBtn.addEventListener('click', () => resetEditorKeybinds());
        DOM.settings.editorTab.saveDefaultsBtn.addEventListener('click', () => saveEditorDefaults());
        DOM.settings.editorTab.resetDefaultsBtn.addEventListener('click', () => resetEditorDefaults());

        window.addEventListener('resize', () => {
            if (Game.state.gameState === 'editor') {
                Editor.drawTimeline();
                Editor.renderNotes();
            }
            // 게임 중이거나 카운트다운 중일 때 canvas 크기 재동기화
            const activeGameStates = ['playing', 'countdown'];
            if (activeGameStates.includes(Game.state.gameState) && Game.canvas.ctx) {
                Game.canvas.resize(Game.state.settings.lanes);
            }
        });

        // 개별 비트맵 창의 "음악 불러오기"는 제거됨 — 음악은 종합 창(EditorSong)에서만 로드/교체한다.
        // 비트맵 창의 audioFileNameEl은 EditorSong이 loadAudioFromUrl()로 넣어준 음악의
        // 파일명을 그냥 보여주기만 한다.
        // 비트맵 창 자체의 "미리보기 시작(초)" — song.startOffsetSec(종합 창의 "시작(초)")과는
        // 완전히 별개의 값(state.previewSeekSec)이다. 여기서 숫자를 바꿔도 종합 창 값에는
        // 전혀 영향이 없다.
        DOM.editor.startTimeInput.addEventListener('input', (e) => {
            const seconds = Math.max(0, parseFloat(e.target.value) || 0);
            Editor.seekPreviewTo(seconds);
        });
        if (DOM.editor.timingStartInput) {
            DOM.editor.timingStartInput.addEventListener('input', (e) => {
                Editor.setTimingStartSec(parseFloat(e.target.value) || 0);
            });
        }
        // 재생헤드는 왼쪽 시크 거터(#editor-seek-gutter)에서만 드래그로 잡을 수 있다.
        // (재생헤드 선 자체는 CSS에서 pointer-events:none으로 꺼서 노트 찍는 영역
        //  클릭을 가로채지 않도록 함 — editor.css 참고)
        DOM.editor.seekGutter.addEventListener('mousedown', (e) => Editor.handleSeekPointerDown(e));
        DOM.editor.seekGutter.addEventListener('touchstart', (e) => Editor.handleSeekPointerDown(e), { passive: false });
        // 시크 거터를 포함한 편집 화면 전체에서 브라우저 기본 우클릭 메뉴를 막는다.
        // notesContainer 안에서는 Editor.handleTimelineContextMenu가 노트 삭제까지 처리하며
        // 거기서도 preventDefault를 하지만, 이 리스너가 먼저(캡처 없이 버블링 중 도달) 걸려도
        // 중복 호출은 무해하다 — 거터처럼 notesContainer 바깥 영역까지 덮기 위한 용도다.
        DOM.editor.container.addEventListener('contextmenu', (e) => e.preventDefault());
        DOM.editor.bpmInput.addEventListener('input', (e) => {
            Editor.state.bpm = parseInt(e.target.value) || 120;
            Editor.setDirty(true);
            Editor.drawTimeline();
            Editor.renderNotes();
        });
        DOM.editor.snapSelector.addEventListener('change', (e) => Editor.handleSnapChange(e));
        DOM.editor.noteTypeSelector.addEventListener('click', (e) => Editor.handleNoteTypeSelect(e));
        DOM.editor.toolSelector.addEventListener('click', (e) => Editor.handleToolSelect(e));
        if (DOM.editor.deleteSelectedBtn) {
            DOM.editor.deleteSelectedBtn.addEventListener('click', () => Editor.deleteSelectedNotes());
        }
        DOM.editor.addMeasureBtn.addEventListener('click', () => Editor.addMeasure());
        DOM.editor.removeMeasureBtn.addEventListener('click', () => Editor.removeMeasure());
        DOM.editor.playBtn.addEventListener('click', () => Editor.handlePlayPause());
        DOM.editor.stopBtn.addEventListener('click', () => Editor.stopPlayback());
        DOM.editor.quickSaveBtn.addEventListener('click', () => Editor.quickSaveBeatmap());
        DOM.editor.resetBtn.addEventListener('click', () => Editor.handleReset());
        DOM.editor.notesContainer.addEventListener('click', (e) => Editor.handleTimelineClick(e));
        DOM.editor.notesContainer.addEventListener('contextmenu', (e) => Editor.handleTimelineContextMenu(e));
        DOM.editor.notesContainer.addEventListener('mousedown', (e) => Editor.handleEditorMouseDown(e));
    }

    function populateKeybindUI() {
        // 저장된(또는 기본) 매핑을 레인 수마다 복사해서 임시 편집본을 만든다.
        const savedMappings = Game.state.settings.userKeyMappingsByLanes || {};
        tempKeyMappingsByLanes = {};
        CONFIG.VALID_LANES.forEach(laneCount => {
            const base = savedMappings[laneCount] || CONFIG.getDefaultKeyMap(laneCount);
            tempKeyMappingsByLanes[laneCount] = { ...base };
        });

        currentKeybindLanes = 4;
        updateKeybindLanesSelectorUI();
        renderKeybindGroup(currentKeybindLanes);
    }

    // 레인 수 선택 버튼의 active 상태를 currentKeybindLanes에 맞춰 갱신
    function updateKeybindLanesSelectorUI() {
        DOM.settings.controls.lanesSelector.querySelectorAll('button').forEach(btn => {
            const laneCount = parseInt(btn.dataset.lanes, 10);
            btn.classList.toggle('active', laneCount === currentKeybindLanes);
        });
    }

    // 선택된 레인 수에 해당하는 키 상자 목록을 그린다
    function renderKeybindGroup(laneCount) {
        const keyOrder = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        const mapping = tempKeyMappingsByLanes[laneCount] || CONFIG.getDefaultKeyMap(laneCount);
        const rowsContainer = DOM.settings.controls.rowsContainer;
        rowsContainer.innerHTML = '';

        keyOrder.forEach(keyId => {
            let keyName = mapping[keyId] || '';
            if (keyName === ' ') keyName = 'Space';

            const row = document.createElement('div');
            row.className = 'flex justify-between items-center p-2 rounded-lg hover:bg-gray-700';

            const label = document.createElement('span');
            const labelI18nKey = KEYBIND_LABEL_I18N[keyId];
            label.setAttribute('data-i18n', labelI18nKey);
            label.textContent = I18n.t(labelI18nKey);

            const box = document.createElement('div');
            box.className = 'keybind-box w-28 text-center';
            box.dataset.keyId = keyId;
            box.textContent = keyName.replace('Semicolon', ';');

            row.appendChild(label);
            row.appendChild(box);
            rowsContainer.appendChild(row);
        });
    }

    function startKeyBinding(element) {
        isListeningForKey = true;
        currentBindingElement = element;
        element.classList.add('listening');
        element.textContent = '...';
        DOM.settings.controls.statusLabel.textContent = '지정을 원하는 키를 입력하세요.';
    }

    function handleKeyBinding(e) {
        e.preventDefault();
        if (e.key === 'Escape') {
            cancelKeyBinding();
            return;
        }
        let keyName = e.key;
        if (keyName === ' ') keyName = 'Space';
        if (e.code === 'Semicolon') keyName = 'Semicolon';
        const keyId = currentBindingElement.dataset.keyId;
        tempKeyMappingsByLanes[currentKeybindLanes][keyId] = keyName;
        currentBindingElement.textContent = keyName.replace('Semicolon', ';');
        currentBindingElement.classList.remove('listening');
        isListeningForKey = false;
        currentBindingElement = null;
        DOM.settings.controls.statusLabel.textContent = '';
    }

    function cancelKeyBinding() {
        if (!isListeningForKey) return;
        const keyId = currentBindingElement.dataset.keyId;
        const savedMappings = Game.state.settings.userKeyMappingsByLanes || {};
        const originalMappings = savedMappings[currentKeybindLanes] || CONFIG.getDefaultKeyMap(currentKeybindLanes);
        let originalKeyName = originalMappings[keyId] || '';
        if (originalKeyName === ' ') originalKeyName = 'Space';
        currentBindingElement.textContent = originalKeyName.replace('Semicolon', ';');
        currentBindingElement.classList.remove('listening');
        isListeningForKey = false;
        currentBindingElement = null;
        DOM.settings.controls.statusLabel.textContent = '';
    }

    function saveKeyBindings() {
        const savedMappings = {};
        CONFIG.VALID_LANES.forEach(laneCount => {
            savedMappings[laneCount] = { ...tempKeyMappingsByLanes[laneCount] };
        });
        Game.state.settings.userKeyMappingsByLanes = savedMappings;
        // 새로고침해도 유지되도록 localStorage에도 저장한다 (기존에는 메모리에만 저장되어
        // 새로고침 시 초기화되는 버그가 있었다).
        try {
            localStorage.setItem('theBeat_userKeyBindings', JSON.stringify(savedMappings));
        } catch (err) {
            console.warn('키 설정 저장 실패:', err);
        }
        saveRestartHotkey();
        UI.showMessage('settings', '키 설정이 저장되었습니다.');
        DOM.settings.controls.statusLabel.textContent = '저장되었습니다!';
        setTimeout(() => {
            if (DOM.settings.controls.statusLabel.textContent === '저장되었습니다!') {
                DOM.settings.controls.statusLabel.textContent = '';
            }
        }, 2000);
    }

    // ── 조작 탭: 길게 눌러 즉시 재시작 단축키 ────────────────────────────────
    function populateRestartHotkeyUI() {
        tempRestartHotkeyCode = CONFIG.RESTART_HOTKEY || CONFIG.RESTART_HOTKEY_DEFAULT;
        renderRestartHotkeyBox();
    }

    function renderRestartHotkeyBox() {
        DOM.settings.controls.restartHotkeyBox.textContent = codeToKeyLabel(tempRestartHotkeyCode);
    }

    function startRestartKeyBinding() {
        isListeningForRestartKey = true;
        DOM.settings.controls.restartHotkeyBox.classList.add('listening');
        DOM.settings.controls.restartHotkeyBox.textContent = '...';
        DOM.settings.controls.statusLabel.textContent = '지정을 원하는 키를 입력하세요.';
    }

    function cancelRestartKeyBinding() {
        if (!isListeningForRestartKey) return;
        isListeningForRestartKey = false;
        DOM.settings.controls.restartHotkeyBox.classList.remove('listening');
        renderRestartHotkeyBox();
        DOM.settings.controls.statusLabel.textContent = '';
    }

    function handleRestartKeyBinding(e) {
        e.preventDefault();
        if (e.key === 'Escape') {
            cancelRestartKeyBinding();
            return;
        }
        // 레인 키(main.js 상단 tempKeyMappingsByLanes)와 겹치는 키를 고르면 플레이 중
        // 두 기능이 동시에 반응해버리므로, 현재 편집 중인 레인 수 그룹의 키와 충돌하는지
        // 확인해서 막는다. (다른 레인 수 그룹과의 충돌까지는 확인하지 않음 — 한 번에 한
        // 레인 수만 쓰기 때문에 실사용에는 지금 그룹만 확인하면 충분하다.)
        const code = e.code;
        const laneMapping = tempKeyMappingsByLanes[currentKeybindLanes] || {};
        const conflictLaneId = Object.keys(laneMapping).find(laneId => {
            let laneKeyName = laneMapping[laneId];
            if (laneKeyName === ' ') laneKeyName = 'Space';
            return laneKeyName === codeToKeyLabel(code) || laneKeyName === code;
        });
        if (conflictLaneId) {
            DOM.settings.controls.statusLabel.textContent = '이미 레인 조작에 쓰는 키입니다.';
            return;
        }
        tempRestartHotkeyCode = code;
        isListeningForRestartKey = false;
        DOM.settings.controls.restartHotkeyBox.classList.remove('listening');
        renderRestartHotkeyBox();
        DOM.settings.controls.statusLabel.textContent = '';
    }

    function saveRestartHotkey() {
        CONFIG.RESTART_HOTKEY = tempRestartHotkeyCode || CONFIG.RESTART_HOTKEY_DEFAULT;
        try {
            localStorage.setItem('theBeat_restartHotkey', CONFIG.RESTART_HOTKEY);
        } catch (err) {
            console.warn('재시작 단축키 저장 실패:', err);
        }
    }

    // 플레이 화면에서 실제로 홀드를 감지해 즉시 재시작을 트리거하는 부분.
    // isListeningForKey 등 어떤 키 캡처 모드도 아닐 때만(= 실제 게임 입력 처리 분기에서만)
    // 호출된다(setupEventListeners 참고).
    function handleRestartHoldKeyDown(e) {
        if (e.code !== CONFIG.RESTART_HOTKEY) return;
        if (restartHoldActive) return; // 길게 눌러 반복 발생하는 keydown 이벤트는 무시
        if (Game.state.gameState !== 'playing' && !Game.state.isPaused) return;
        if (Game.state._multiplayerActive) return; // 멀티플레이는 mp-restart-btn(전원 동의) 절차를 따로 씀
        restartHoldActive = true;
        restartHoldTimer = setTimeout(() => {
            restartHoldTimer = null;
            restartHoldActive = false;
            Game.restartCurrentChart();
        }, CONFIG.RESTART_HOTKEY_HOLD_MS);
    }

    function handleRestartHoldKeyUp(e) {
        if (e.code !== CONFIG.RESTART_HOTKEY) return;
        restartHoldActive = false;
        if (restartHoldTimer) {
            clearTimeout(restartHoldTimer);
            restartHoldTimer = null;
        }
    }

    // localStorage에 현재 CONFIG의 에디터 설정을 저장한다(계정 없이도 유지됨).
    function persistEditorSettings() {
        try {
            localStorage.setItem('theBeat_editorSettings', JSON.stringify({
                laneKeyMap: { ...CONFIG.EDITOR_KEY_LANE_MAP },
                toolKeys: { ...CONFIG.EDITOR_TOOL_KEYS },
                defaults: { ...CONFIG.EDITOR_DEFAULT_SETTINGS },
                gridLineStyle: CONFIG.EDITOR_GRID_LINE_STYLE,
            }));
        } catch (err) {
            console.warn('에디터 설정 저장 실패:', err);
        }
    }

    // 환경설정 → 에디터 탭의 "그리드 선 스타일" 버튼 활성 상태 + 미리보기를 현재 CONFIG 값에 맞춰 그린다.
    function updateGridStyleButtons() {
        if (!DOM.settings.editorTab.gridStyleSelector) return;
        DOM.settings.editorTab.gridStyleSelector.querySelectorAll('button[data-grid-style]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.gridStyle === CONFIG.EDITOR_GRID_LINE_STYLE);
        });
        renderGridStylePreview();
    }

    // 실제 비트맵 창의 drawGrid()와 같은 색상 규칙(Editor._beatLineColorForDenominator)을 그대로 써서
    // 미니 미리보기를 그린다 — snapDivision=16 기준 한 마디 분량을 보여준다.
    function renderGridStylePreview() {
        const container = DOM.settings.editorTab.gridStylePreview;
        if (!container) return;
        container.innerHTML = '';
        const total = 16;
        const height = 96; // css의 미리보기 박스 높이(px)와 맞춘 고정값 — 탭이 숨겨진 동안엔 clientHeight가 0이라 고정값을 쓴다.
        for (let j = 0; j <= total; j++) {
            const line = document.createElement('div');
            line.style.position = 'absolute';
            line.style.left = '0';
            line.style.width = '100%';
            line.style.height = '1px';
            line.style.top = `${Math.min((j / total) * height, height - 1)}px`;
            if (j === 0 || j === total) {
                line.style.backgroundColor = '#a0aec0'; // 마디선 — 스타일과 무관하게 항상 밝은 회색
            } else {
                const denominator = total / Editor._gcd(j, total);
                line.style.backgroundColor = Editor._beatLineColorForDenominator(denominator);
            }
            container.appendChild(line);
        }
    }

    function codeToKeyLabel(code) {
        if (!code) return '';
        if (code === 'Space') return 'Space';
        if (code === 'Semicolon') return ';';
        return code.replace(/^Key/, '').replace(/^Digit/, '');
    }

    function populateEditorKeybindUI() {
        tempEditorLaneKeys = {};
        Object.entries(CONFIG.EDITOR_KEY_LANE_MAP).forEach(([code, laneId]) => {
            tempEditorLaneKeys[laneId] = code;
        });
        tempEditorToolKeys = { ...CONFIG.EDITOR_TOOL_KEYS };
        renderEditorLaneKeybindRows();
        renderEditorToolKeybindRows();

        DOM.settings.editorTab.defaultBpmInput.value = CONFIG.EDITOR_DEFAULT_SETTINGS.bpm;
        DOM.settings.editorTab.defaultSnapSelect.value = CONFIG.EDITOR_DEFAULT_SETTINGS.snapDivision;
        DOM.settings.editorTab.defaultFallSpeedInput.value = CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
    }

    function renderEditorLaneKeybindRows() {
        const container = DOM.settings.editorTab.keybindRows;
        container.innerHTML = '';
        CONFIG.EDITOR_LANE_IDS.forEach(laneId => {
            const row = document.createElement('div');
            row.className = 'flex justify-between items-center p-2 rounded-lg hover:bg-gray-700';

            const label = document.createElement('span');
            label.setAttribute('data-i18n', KEYBIND_LABEL_I18N[laneId]);
            label.textContent = I18n.t(KEYBIND_LABEL_I18N[laneId]);

            const box = document.createElement('div');
            box.className = 'keybind-box w-28 text-center';
            box.dataset.laneId = laneId;
            box.textContent = codeToKeyLabel(tempEditorLaneKeys[laneId]);

            row.appendChild(label);
            row.appendChild(box);
            container.appendChild(row);
        });
    }

    function renderEditorToolKeybindRows() {
        const container = DOM.settings.editorTab.toolKeyRows;
        container.innerHTML = '';
        [['create', '생성 도구'], ['edit', '편집 도구']].forEach(([toolId, labelText]) => {
            const row = document.createElement('div');
            row.className = 'flex justify-between items-center p-2 rounded-lg hover:bg-gray-700';

            const label = document.createElement('span');
            label.textContent = labelText;

            const box = document.createElement('div');
            box.className = 'keybind-box w-28 text-center';
            box.dataset.toolId = toolId;
            box.textContent = (tempEditorToolKeys[toolId] || '').toUpperCase();

            row.appendChild(label);
            row.appendChild(box);
            container.appendChild(row);
        });
    }

    function startEditorKeyBinding(element, kind) {
        isListeningForEditorKey = true;
        currentEditorBindingElement = element;
        currentEditorBindingKind = kind;
        element.classList.add('listening');
        element.textContent = '...';
        DOM.settings.editorTab.statusLabel.textContent = '지정을 원하는 키를 입력하세요.';
    }

    function handleEditorKeyBinding(e) {
        e.preventDefault();
        if (e.key === 'Escape') {
            cancelEditorKeyBinding();
            return;
        }

        if (currentEditorBindingKind === 'lane') {
            const code = e.code;
            const laneId = currentEditorBindingElement.dataset.laneId;
            const conflictLane = Object.entries(tempEditorLaneKeys).find(([id, c]) => id !== laneId && c === code);
            if (conflictLane) {
                DOM.settings.editorTab.statusLabel.textContent = `이미 ${KEYBIND_LABEL_I18N[conflictLane[0]] ? I18n.t(KEYBIND_LABEL_I18N[conflictLane[0]]) : conflictLane[0]} 레인에서 쓰는 키입니다.`;
                return;
            }
            tempEditorLaneKeys[laneId] = code;
            currentEditorBindingElement.textContent = codeToKeyLabel(code);
        } else if (currentEditorBindingKind === 'tool') {
            const key = e.key.toLowerCase();
            const toolId = currentEditorBindingElement.dataset.toolId;
            const otherToolId = toolId === 'create' ? 'edit' : 'create';
            if (tempEditorToolKeys[otherToolId] === key) {
                DOM.settings.editorTab.statusLabel.textContent = '이미 다른 도구에서 쓰는 키입니다.';
                return;
            }
            tempEditorToolKeys[toolId] = key;
            currentEditorBindingElement.textContent = key.toUpperCase();
        }

        currentEditorBindingElement.classList.remove('listening');
        isListeningForEditorKey = false;
        currentEditorBindingElement = null;
        currentEditorBindingKind = null;
        DOM.settings.editorTab.statusLabel.textContent = '';
    }

    function cancelEditorKeyBinding() {
        if (!isListeningForEditorKey) return;
        if (currentEditorBindingKind === 'lane') {
            const laneId = currentEditorBindingElement.dataset.laneId;
            currentEditorBindingElement.textContent = codeToKeyLabel(tempEditorLaneKeys[laneId]);
        } else if (currentEditorBindingKind === 'tool') {
            const toolId = currentEditorBindingElement.dataset.toolId;
            currentEditorBindingElement.textContent = (tempEditorToolKeys[toolId] || '').toUpperCase();
        }
        currentEditorBindingElement.classList.remove('listening');
        isListeningForEditorKey = false;
        currentEditorBindingElement = null;
        currentEditorBindingKind = null;
        DOM.settings.editorTab.statusLabel.textContent = '';
    }

    function saveEditorKeybinds() {
        Object.keys(CONFIG.EDITOR_KEY_LANE_MAP).forEach(code => delete CONFIG.EDITOR_KEY_LANE_MAP[code]);
        Object.entries(tempEditorLaneKeys).forEach(([laneId, code]) => {
            CONFIG.EDITOR_KEY_LANE_MAP[code] = laneId;
        });
        CONFIG.EDITOR_TOOL_KEYS.create = tempEditorToolKeys.create;
        CONFIG.EDITOR_TOOL_KEYS.edit = tempEditorToolKeys.edit;
        persistEditorSettings();
        DOM.settings.editorTab.statusLabel.textContent = '저장되었습니다!';
        setTimeout(() => {
            if (DOM.settings.editorTab.statusLabel.textContent === '저장되었습니다!') {
                DOM.settings.editorTab.statusLabel.textContent = '';
            }
        }, 2000);
    }

    function resetEditorKeybinds() {
        Object.keys(CONFIG.EDITOR_KEY_LANE_MAP).forEach(code => delete CONFIG.EDITOR_KEY_LANE_MAP[code]);
        Object.assign(CONFIG.EDITOR_KEY_LANE_MAP, CONFIG.EDITOR_DEFAULT_KEY_LANE_MAP);
        CONFIG.EDITOR_TOOL_KEYS.create = CONFIG.EDITOR_DEFAULT_TOOL_KEYS.create;
        CONFIG.EDITOR_TOOL_KEYS.edit = CONFIG.EDITOR_DEFAULT_TOOL_KEYS.edit;
        persistEditorSettings();
        populateEditorKeybindUI();
        DOM.settings.editorTab.statusLabel.textContent = '기본값으로 복원되었습니다.';
        setTimeout(() => {
            if (DOM.settings.editorTab.statusLabel.textContent === '기본값으로 복원되었습니다.') {
                DOM.settings.editorTab.statusLabel.textContent = '';
            }
        }, 2000);
    }

    function saveEditorDefaults() {
        const bpm = parseInt(DOM.settings.editorTab.defaultBpmInput.value, 10) || CONFIG.EDITOR_DEFAULT_SETTINGS.bpm;
        const snapDivision = parseInt(DOM.settings.editorTab.defaultSnapSelect.value, 10) || CONFIG.EDITOR_DEFAULT_SETTINGS.snapDivision;
        const fallSpeed = parseFloat(DOM.settings.editorTab.defaultFallSpeedInput.value) || CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
        CONFIG.EDITOR_DEFAULT_SETTINGS.bpm = bpm;
        CONFIG.EDITOR_DEFAULT_SETTINGS.snapDivision = snapDivision;
        CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed = fallSpeed;
        persistEditorSettings();
        DOM.settings.editorTab.defaultsStatusLabel.textContent = '저장되었습니다!';
        setTimeout(() => {
            if (DOM.settings.editorTab.defaultsStatusLabel.textContent === '저장되었습니다!') {
                DOM.settings.editorTab.defaultsStatusLabel.textContent = '';
            }
        }, 2000);
    }

    function resetEditorDefaults() {
        Object.assign(CONFIG.EDITOR_DEFAULT_SETTINGS, CONFIG.EDITOR_FACTORY_DEFAULT_SETTINGS);
        persistEditorSettings();
        DOM.settings.editorTab.defaultBpmInput.value = CONFIG.EDITOR_DEFAULT_SETTINGS.bpm;
        DOM.settings.editorTab.defaultSnapSelect.value = CONFIG.EDITOR_DEFAULT_SETTINGS.snapDivision;
        DOM.settings.editorTab.defaultFallSpeedInput.value = CONFIG.EDITOR_DEFAULT_SETTINGS.fallSpeed;
        DOM.settings.editorTab.defaultsStatusLabel.textContent = '기본값으로 복원되었습니다.';
        setTimeout(() => {
            if (DOM.settings.editorTab.defaultsStatusLabel.textContent === '기본값으로 복원되었습니다.') {
                DOM.settings.editorTab.defaultsStatusLabel.textContent = '';
            }
        }, 2000);
    }

    function showSettingsScreen() {
        if (Game.state.gameState === 'playing' && !Game.state.isPaused) return;
        // Game.state.gameState는 editorHome/editorSong/editor를 뭉뚱그려 'editor'로만 표시하기 때문에
        // (에디터 진입 시 한 번만 설정되고 하위 화면 전환 때 갱신되지 않음) previousScreen으로 쓰면
        // 설정을 닫을 때 항상 에디터(비트맵 편집) 화면으로 돌아가버리는 버그가 있었다.
        // 실제로 표시 중이던 화면(UI.currentScreen)을 그대로 기억해서 정확히 복원한다.
        Game.state.previousScreen = UI.currentScreen;
        Game.state.gameState = 'settings';
        UI.showScreen('settings');
        populateKeybindUI();
        populateEditorKeybindUI();
        populateRestartHotkeyUI();
        updateGridStyleButtons();
        DOM.settings.musicVolumeSlider.value = Game.state.settings.musicVolume;
        DOM.settings.musicVolumeValue.textContent = Game.state.settings.musicVolume;
        DOM.settings.sfxVolumeSlider.value = Game.state.settings.sfxVolume;
        DOM.settings.sfxVolumeValue.textContent = Game.state.settings.sfxVolume;
        refreshPlaySettingsUI();
    }

    // ── 플레이 탭 설정(계정 동기화 대상) UI 반영 ──────────────────────
    // Game.state.settings의 값을 화면의 슬라이더/토글에 그대로 그려준다.
    // showSettingsScreen()에서 설정 화면을 열 때, 그리고 계정에서 값을 불러온 직후
    // (applyAccountPlaySettings) 양쪽에서 재사용한다.
    function refreshPlaySettingsUI() {
        if (DOM.settings.gameplayImageOpacitySlider) {
            const opacityValue = Game.state.settings.gameplayImageOpacity;
            DOM.settings.gameplayImageOpacitySlider.value = opacityValue;
            if (DOM.settings.gameplayImageOpacityValue) {
                DOM.settings.gameplayImageOpacityValue.textContent = opacityValue;
            }
        }
        if (DOM.settings.laneBackgroundOpacitySlider) {
            const laneBgValue = Game.state.settings.laneBackgroundOpacity;
            DOM.settings.laneBackgroundOpacitySlider.value = laneBgValue;
            if (DOM.settings.laneBackgroundOpacityValue) {
                DOM.settings.laneBackgroundOpacityValue.textContent = laneBgValue;
            }
            document.documentElement.style.setProperty('--lane-bg-opacity', laneBgValue / 100);
        }
        if (DOM.settings.laneHighlightToggle) {
            DOM.settings.laneHighlightToggle.checked = Game.state.settings.laneHighlightOnInput !== false;
        }
        if (DOM.settings.autoHideUiToggle) {
            DOM.settings.autoHideUiToggle.checked = Game.state.settings.autoHideUiOnPlay === true;
        }
        if (DOM.settings.defaultFallSpeedToggle) {
            const enabled = Game.state.settings.useDefaultFallSpeed === true;
            DOM.settings.defaultFallSpeedToggle.checked = enabled;
            if (DOM.settings.defaultFallSpeedContainer) {
                DOM.settings.defaultFallSpeedContainer.classList.toggle('hidden', !enabled);
            }
        }
        if (DOM.settings.defaultFallSpeedSlider) {
            const speed = Game.state.settings.defaultFallSpeedValue;
            DOM.settings.defaultFallSpeedSlider.value = speed;
            if (DOM.settings.defaultFallSpeedValue) {
                DOM.settings.defaultFallSpeedValue.textContent = speed;
            }
        }
        if (DOM.settings.inputOffsetSlider) {
            const offset = Game.state.settings.inputOffsetMs;
            DOM.settings.inputOffsetSlider.value = offset;
            if (DOM.settings.inputOffsetValue) {
                DOM.settings.inputOffsetValue.textContent = `${offset}ms`;
            }
        }
        if (DOM.settings.touchInputOffsetSlider) {
            const touchOffset = Game.state.settings.touchInputOffsetMs;
            DOM.settings.touchInputOffsetSlider.value = touchOffset;
            if (DOM.settings.touchInputOffsetValue) {
                DOM.settings.touchInputOffsetValue.textContent = `${touchOffset}ms`;
            }
        }
    }

    function updateDetailedSettingsUI() {
        const speed = Game.state.settings.noteSpeed;
        const spawnSpeed = Game.state.settings.noteSpawnSpeed;
        const dongtaProb = Math.round(Game.state.settings.dongtaProbability * 100);
        const maxSimultaneous = Game.state.settings.maxSimultaneousNotes;
        const dongtaTypeProbs = Game.state.settings.dongtaNoteTypeProbabilities;
        const longNoteProb = Math.round(Game.state.settings.longNoteProbability * 100);
        const falseNoteProb = Game.state.settings.falseNoteProbability;
        
        DOM.difficulty.fallSpeedSlider.value = speed;
        DOM.difficulty.fallSpeedValue.textContent = speed;
        DOM.difficulty.spawnSpeedSlider.value = Math.round(spawnSpeed * 100);
        DOM.difficulty.spawnSpeedValue.textContent = `${spawnSpeed.toFixed(1)}x`;
        DOM.difficulty.dongtaSlider.value = dongtaProb;
        DOM.difficulty.dongtaValue.textContent = `${dongtaProb}%`;
        
        DOM.difficulty.maxSimultaneousSlider.value = maxSimultaneous;
        DOM.difficulty.maxSimultaneousValue.textContent = maxSimultaneous;
        
        const tapProb = Math.round(dongtaTypeProbs.tap * 100);
        const longProbDongta = Math.round(dongtaTypeProbs.long * 100);
        const falseProbDongta = Math.round(dongtaTypeProbs.false * 100);
        
        DOM.difficulty.dongtaTapProbSlider.value = tapProb;
        DOM.difficulty.dongtaTapProbValue.textContent = `${tapProb}%`;
        DOM.difficulty.dongtaLongProbSlider.value = longProbDongta;
        DOM.difficulty.dongtaLongProbValue.textContent = `${longProbDongta}%`;
        DOM.difficulty.dongtaFalseProbSlider.value = falseProbDongta;
        DOM.difficulty.dongtaFalseProbValue.textContent = `${falseProbDongta}%`;
        
        DOM.difficulty.longNoteSlider.value = longNoteProb;
        DOM.difficulty.longNoteValue.textContent = `${longNoteProb}%`;
        
        const falseNoteEnabled = falseNoteProb > 0;
        DOM.difficulty.falseNoteToggle.checked = falseNoteEnabled;
        DOM.difficulty.falseNoteProbContainer.classList.toggle('hidden', !falseNoteEnabled);
        const sliderValue = Math.round(falseNoteProb * 1000);
        DOM.difficulty.falseNoteProbSlider.value = sliderValue;
        DOM.difficulty.falseNoteProbValue.textContent = `${(sliderValue / 10).toFixed(1)}%`;
    }

    function setCustomDifficulty() {
        Game.state.settings.difficulty = 'custom';
        document.querySelectorAll('#difficulty-selector button, #drill-selector button').forEach(b => b.classList.remove('active'));
        saveLastPracticeSettings();
    }

    // ── 연습 모드: 마지막 사용 설정 자동 저장/복원 + 이름 붙인 내 프리셋 (연습모드-개선계획.md 1번) ──
    // 설정 UI를 나갔다 들어오면 값이 초기화되던 문제 해결. 여기 담기는 값은 detailed-difficulty-settings의
    // 슬라이더 7종 + 노트 수 + 레인 수 + 어떤 프리셋(난이도/드릴/custom)이 선택돼 있었는지다.
    const PRACTICE_DIFFICULTY_FIELDS = [
        'noteSpeed', 'noteSpawnSpeed', 'dongtaProbability', 'maxSimultaneousNotes',
        'dongtaNoteTypeProbabilities', 'longNoteProbability', 'falseNoteProbability',
    ];

    function collectPracticeSettings() {
        const s = Game.state.settings;
        const settings = { difficulty: s.difficulty, lanes: s.lanes };
        for (const key of PRACTICE_DIFFICULTY_FIELDS) {
            settings[key] = key === 'dongtaNoteTypeProbabilities' ? { ...s[key] } : s[key];
        }
        const noteCount = parseInt(DOM.noteCountInput.value);
        if (noteCount) settings.noteCount = noteCount;
        return settings;
    }

    function applyPracticeSettings(settings) {
        const s = Game.state.settings;
        for (const key of PRACTICE_DIFFICULTY_FIELDS) {
            if (settings[key] === undefined) continue;
            s[key] = key === 'dongtaNoteTypeProbabilities' ? { ...settings[key] } : settings[key];
        }
        if (settings.lanes) {
            s.lanes = settings.lanes;
            const lanesSelector = document.getElementById('lanes-selector');
            if (lanesSelector) lanesSelector.value = settings.lanes;
        }
        if (settings.noteCount) DOM.noteCountInput.value = settings.noteCount;
        s.difficulty = settings.difficulty || 'custom';
        updateDetailedSettingsUI();
        document.querySelectorAll('#difficulty-selector button, #drill-selector button').forEach(b => {
            b.classList.toggle('active', b.dataset.difficulty === s.difficulty);
        });
    }

    // 슬라이더를 드래그하는 동안 계속 input이 튈 수 있어 짧게 디바운스한다.
    let _savePracticeSettingsTimer = null;
    function saveLastPracticeSettings() {
        clearTimeout(_savePracticeSettingsTimer);
        _savePracticeSettingsTimer = setTimeout(() => {
            try {
                localStorage.setItem('theBeat_lastPracticeSettings', JSON.stringify(collectPracticeSettings()));
            } catch (err) {
                // localStorage 저장 실패해도 연습 진행에는 지장 없으므로 조용히 무시
            }
        }, 300);
    }

    function loadLastPracticeSettings() {
        try {
            const raw = localStorage.getItem('theBeat_lastPracticeSettings');
            if (!raw) return false;
            applyPracticeSettings(JSON.parse(raw));
            return true;
        } catch (err) {
            return false;
        }
    }

    function loadCustomPresetsMap() {
        try {
            const raw = localStorage.getItem('theBeat_customPresets');
            return raw ? JSON.parse(raw) : {};
        } catch (err) {
            return {};
        }
    }

    function saveCustomPresetsMap(map) {
        try {
            localStorage.setItem('theBeat_customPresets', JSON.stringify(map));
        } catch (err) {
            // 저장 실패해도 화면상의 선택 목록은 그대로 둔다
        }
    }

    function refreshCustomPresetSelect() {
        const select = document.getElementById('custom-preset-select');
        if (!select) return;
        const map = loadCustomPresetsMap();
        const currentValue = select.value;
        select.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.setAttribute('data-i18n', 'custom_preset_placeholder');
        placeholder.textContent = I18n.t('custom_preset_placeholder');
        select.appendChild(placeholder);
        Object.keys(map).sort((a, b) => a.localeCompare(b, 'ko')).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
        if (Object.prototype.hasOwnProperty.call(map, currentValue)) select.value = currentValue;
    }

    // ── 플레이 탭 설정 계정 동기화 ──────────────────────────────────
    // localStorage는 기기별로만 남기 때문에, 로그인 상태라면 계정(user_profiles.beat_settings,
    // jsonb 한 컬럼에 묶어서 저장 — HOI4Editor가 쓰는 settings 컬럼과는 별개)에도 함께 저장해서
    // 다른 기기/브라우저에서 로그인했을 때도 같은 설정으로 이어서 플레이할 수 있게 한다.
    // localStorage 저장은 그대로 유지 — 로그아웃 상태(게스트)에서도 기기별로는 계속 동작해야 하고,
    // 오프라인/서버 오류 시에도 최소한 이 기기에서는 값이 남아있도록 하는 폴백이다.
    const PLAY_SETTINGS_KEYS = [
        'gameplayImageOpacity', 'laneBackgroundOpacity', 'laneHighlightOnInput',
        'autoHideUiOnPlay', 'useDefaultFallSpeed', 'defaultFallSpeedValue',
        'inputOffsetMs', 'touchInputOffsetMs',
    ];

    function collectPlaySettings() {
        const settings = {};
        for (const key of PLAY_SETTINGS_KEYS) settings[key] = Game.state.settings[key];
        return settings;
    }

    // 슬라이더를 드래그하는 동안 계속 change가 튈 수 있어(터치 기기 등) 짧게 디바운스한다.
    let _savePlaySettingsTimer = null;
    function savePlaySettingsToCloud() {
        clearTimeout(_savePlaySettingsTimer);
        _savePlaySettingsTimer = setTimeout(() => {
            CloudAuth.savePlaySettings(collectPlaySettings());
        }, 500);
    }

    // ── 계정 볼륨 설정 자동 적용 ──────────────────────────────────
    // 로그인 상태가 될 때(최초 로드 시 세션 복원 포함 / 로그인 직후) 계정에 저장된
    // 볼륨을 불러와 적용한다. 같은 유저에 대해 중복 적용되지 않도록 가드한다.
    let _lastVolumeAppliedUserId = null;
    async function applyAccountVolume(user) {
        if (!user || user.id === _lastVolumeAppliedUserId) return;
        _lastVolumeAppliedUserId = user.id;
        const vol = await CloudAuth.getVolumeSettings();
        if (!vol) return; // 아직 저장한 적 없는 계정 → 기본값 유지
        Game.state.settings.musicVolume = vol.musicVolume;
        Game.state.settings.sfxVolume = vol.sfxVolume;
        Audio.setMusicVolume(vol.musicVolume);
        Audio.setSfxVolume(vol.sfxVolume);
        DOM.settings.musicVolumeSlider.value = vol.musicVolume;
        DOM.settings.musicVolumeValue.textContent = vol.musicVolume;
        DOM.settings.sfxVolumeSlider.value = vol.sfxVolume;
        DOM.settings.sfxVolumeValue.textContent = vol.sfxVolume;
    }

    // 로그인 시 계정에 저장된 플레이 탭 설정을 불러와 적용한다. 처음 저장해본 적 없는
    // 계정(null)이거나 개별 값이 비어있는 경우 그 항목은 건드리지 않고 기존(localStorage 기반)
    // 기본값을 그대로 둔다 — 계정에 일부만 저장돼 있어도 나머지가 초기화되지 않도록.
    let _lastPlaySettingsAppliedUserId = null;
    async function applyAccountPlaySettings(user) {
        if (!user || user.id === _lastPlaySettingsAppliedUserId) return;
        _lastPlaySettingsAppliedUserId = user.id;
        const settings = await CloudAuth.getPlaySettings();
        if (!settings) return; // 아직 저장한 적 없는 계정 → 기존 기본값 유지
        for (const key of PLAY_SETTINGS_KEYS) {
            if (settings[key] !== undefined && settings[key] !== null) {
                Game.state.settings[key] = settings[key];
            }
        }
        GameBackground.applyOpacity();
        refreshPlaySettingsUI();
    }

    function initialize() {
        setupEventListeners();
        document.querySelector('#difficulty-selector button[data-difficulty="normal"]').classList.add('active');
        updateDetailedSettingsUI();
        // 저장된 레인 배경 불투명도를 CSS 변수로 반영 (레인 div는 setupLanes()에서 매번
        // 새로 만들어지지만, CSS 변수는 documentElement에 있으므로 새 레인에도 그대로 적용된다).
        document.documentElement.style.setProperty('--lane-bg-opacity', Game.state.settings.laneBackgroundOpacity / 100);
        Debugger.init();
        I18n.init();
        // 연습 화면을 나갔다 들어와도 마지막에 쓰던 설정이 유지되도록 복원 (없으면 기본값 '보통' 유지).
        // "내 프리셋" 목록도 여기서 채운다 — I18n.init() 이후라야 플레이스홀더가 올바른 언어로 나온다.
        loadLastPracticeSettings();
        refreshCustomPresetSelect();
        Appearance.init();
        UI.initPanelToggle();
        if (typeof setupAuthUI === 'function') setupAuthUI();

        // 최초 세션 복원 / 로그인 / 로그아웃 시 볼륨·플레이 설정 동기화
        _supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                applyAccountVolume(session.user);
                applyAccountPlaySettings(session.user);
            } else {
                _lastVolumeAppliedUserId = null;
                _lastPlaySettingsAppliedUserId = null;
            }
        });
    }

    initialize();
});