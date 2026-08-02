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
            } else if (Game.state.gameState === 'editor') {
                Editor.handleEditorKeyPress(e);
            } else {
                Game.handleKeyDown(e);
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!isListeningForKey) {
                Game.handleKeyUp(e);
            }
        });

        window.addEventListener('click', (e) => {
            if (isListeningForKey && !e.target.classList.contains('keybind-box')) {
                cancelKeyBinding();
            }
        });

        DOM.pauseGameBtn.addEventListener('click', () => Game.togglePause());
        DOM.resumeGameBtn.addEventListener('click', () => Game.togglePause());
        DOM.settings.iconMenu.addEventListener('click', showSettingsScreen);
        DOM.settings.iconPlaying.addEventListener('click', showSettingsScreen);

        DOM.settings.backBtn.addEventListener('click', () => {
            cancelKeyBinding();
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

        // 온라인 라이브러리 버튼
        document.getElementById('online-btn').addEventListener('click', () => {
            Game.state.gameState = 'online';
            Online.show('browse');
        });

        // Phase 3e: 비트맵 창의 개별 서버 업로드/불러오기 버튼은 제거됨.
        // 클라우드 업로드는 종합 창(EditorSong.uploadToCloud), 불러오기는 에디터 홈(EditorHome.open)에서 한다.
        // (upload-modal/cloud-load-modal 자체는 아직 DOM에 남아있지만 트리거 버튼이 없어 열리지 않는다.)
        document.getElementById('cloud-load-cancel-btn').addEventListener('click', () => CloudLoadModal.close());

        // 업로드 모달 버튼
        document.getElementById('upload-submit-btn').addEventListener('click', () => UploadModal.submit());
        document.getElementById('upload-cancel-btn').addEventListener('click', () => UploadModal.close());

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
        DOM.editorSong.audioFileInput.addEventListener('change', (e) => EditorSong.handleAudioSelect(e.target.files[0]));
        DOM.editorSong.coverFileInput.addEventListener('change', (e) => EditorSong.handleCoverSelect(e.target.files[0]));
        DOM.editorSong.saveLocalBtn.addEventListener('click', () => EditorSong.saveLocal());
        DOM.editorSong.loadLocalInput.addEventListener('change', (e) => {
            EditorSong.loadLocalFile(e.target.files[0]);
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

        // ── Phase 3d: 종합 창 클라우드 업로드 ──
        DOM.editorSong.uploadCloudBtn.addEventListener('click', () => EditorSong.uploadToCloud());

        // Trigger modal event listeners
        DOM.triggerModal.confirmBtn.addEventListener('click', () => {
            Editor.confirmTrigger();
        });

        DOM.triggerModal.cancelBtn.addEventListener('click', () => {
            Editor.hideTriggerModal();
        });

        DOM.triggerModal.container.addEventListener('click', (e) => {
            if (e.target === DOM.triggerModal.container) {
                Editor.hideTriggerModal();
            }
        });

        document.getElementById('difficulty-selector').addEventListener('click', (e) => {
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
            document.querySelectorAll('#difficulty-selector button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });

        DOM.difficulty.toggleBtn.addEventListener('click', () => {
            DOM.difficulty.detailsPanel.classList.toggle('hidden');
            DOM.difficulty.toggleIcon.classList.toggle('rotate-180');
        });

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

        // 키 상자는 레인 수 그룹에 따라 동적으로 생성되므로 이벤트 위임으로 처리
        DOM.settings.controls.rowsContainer.addEventListener('click', (e) => {
            const box = e.target.closest('.keybind-box');
            if (!box) return;
            if (isListeningForKey) cancelKeyBinding();
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

        DOM.editor.audioFileInput.addEventListener('change', (e) => Editor.handleAudioLoad(e));
        setupFileDropzone(DOM.editor.audioDropzone, () => DOM.editor.audioFileInput);
        // 비트맵 창 자체의 "미리보기 시작(초)" — song.startOffsetSec(종합 창의 "시작(초)")과는
        // 완전히 별개의 값(state.previewSeekSec)이다. 여기서 숫자를 바꿔도 종합 창 값에는
        // 전혀 영향이 없다.
        DOM.editor.startTimeInput.addEventListener('input', (e) => {
            const seconds = Math.max(0, parseFloat(e.target.value) || 0);
            Editor.seekPreviewTo(seconds);
        });
        // 재생헤드는 왼쪽 시크 거터(#editor-seek-gutter)에서만 드래그로 잡을 수 있다.
        // (재생헤드 선 자체는 CSS에서 pointer-events:none으로 꺼서 노트 찍는 영역
        //  클릭을 가로채지 않도록 함 — editor.css 참고)
        DOM.editor.seekGutter.addEventListener('mousedown', (e) => Editor.handleSeekPointerDown(e));
        DOM.editor.seekGutter.addEventListener('touchstart', (e) => Editor.handleSeekPointerDown(e), { passive: false });
        DOM.editor.bpmInput.addEventListener('input', (e) => {
            Editor.state.bpm = parseInt(e.target.value) || 120;
            Editor.setDirty(true);
            Editor.drawTimeline();
            Editor.renderNotes();
        });
        DOM.editor.snapSelector.addEventListener('change', (e) => Editor.handleSnapChange(e));
        DOM.editor.noteTypeSelector.addEventListener('click', (e) => Editor.handleNoteTypeSelect(e));
        DOM.editor.toolSelector.addEventListener('click', (e) => Editor.handleToolSelect(e));
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
        UI.showMessage('settings', '키 설정이 저장되었습니다.');
        DOM.settings.controls.statusLabel.textContent = '저장되었습니다!';
        setTimeout(() => {
            if (DOM.settings.controls.statusLabel.textContent === '저장되었습니다!') {
                DOM.settings.controls.statusLabel.textContent = '';
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
        DOM.settings.musicVolumeSlider.value = Game.state.settings.musicVolume;
        DOM.settings.musicVolumeValue.textContent = Game.state.settings.musicVolume;
        DOM.settings.sfxVolumeSlider.value = Game.state.settings.sfxVolume;
        DOM.settings.sfxVolumeValue.textContent = Game.state.settings.sfxVolume;
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
        document.querySelectorAll('#difficulty-selector button').forEach(b => b.classList.remove('active'));
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

    function initialize() {
        setupEventListeners();
        document.querySelector('#difficulty-selector button[data-difficulty="normal"]').classList.add('active');
        updateDetailedSettingsUI();
        Debugger.init();
        I18n.init();
        Appearance.init();
        if (typeof setupAuthUI === 'function') setupAuthUI();

        // 최초 세션 복원 / 로그인 / 로그아웃 시 볼륨 동기화
        _supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) applyAccountVolume(session.user);
            else _lastVolumeAppliedUserId = null;
        });
    }

    initialize();
});