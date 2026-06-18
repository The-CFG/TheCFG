const Appearance = {
    settings: {
        noteShape: 'bar', // 'bar' or 'circle'
        colorMode: 'note-type', // 'note-type' or 'lane'
        colors: {
            tap: '#63b3ed',
            long: '#a78bfa',
            false: '#fca5a5'
        },
        laneColors: {
            L4: '#ef4444',
            L3: '#f59e0b',
            L2: '#eab308',
            L1: '#84cc16',
            C1: '#06b6d4',
            R1: '#3b82f6',
            R2: '#8b5cf6',
            R3: '#a855f7',
            R4: '#ec4899'
        }
    },
    
    presets: {
        'note-type': [{}, {}, {}, {}, {}], // 5 slots for note-type mode
        'lane': [{}, {}, {}, {}, {}]        // 5 slots for lane mode
    },
    
    currentPresetSlot: 1,

    _logError(err, context) {
        if (typeof Debugger !== 'undefined' && Debugger.logError) {
            Debugger.logError(err, context);
        } else {
            console.error(`[${context}]`, err);
        }
    },

    init() {
        try {
            // 로컬 스토리지에서 설정 불러오기
            this.loadSettings();
            this.loadPresets();
            
            // 초기 UI 반영
            this.applySettings();
            this.updateColorModeUI();
            this.updatePresetSlotsUI();
            
            // 미리보기 요소가 있을 때만 업데이트
            if (document.getElementById('preview-tap-note')) {
                this.updatePreview();
            }
            
            // 이벤트 리스너 등록
            this.setupEventListeners();
        } catch (err) {
            this._logError(err, 'Appearance.init');
        }
    },

    setupEventListeners() {
        try {
            // 노트 모양 선택
            const shapeSelector = document.getElementById('note-shape-selector');
            if (shapeSelector) {
                shapeSelector.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        const shape = e.target.dataset.shape;
                        this.settings.noteShape = shape;
                        this.updateShapeUI();
                        this.updatePreview();
                        // 즉시 body 클래스 업데이트
                        if (shape === 'circle') {
                            document.body.classList.add('circle-notes');
                        } else {
                            document.body.classList.remove('circle-notes');
                        }
                    }
                });
            }

            // 색상 변경 (노트별)
            ['tap', 'long', 'false'].forEach(type => {
                const colorInput = document.getElementById(`color-${type}-note`);
                if (colorInput) {
                    colorInput.addEventListener('input', (e) => {
                        this.settings.colors[type] = e.target.value;
                        this.updatePreview();
                        this.updateCSSVariables();
                        this.forceUpdateNotes();
                    });
                }
            });
            
            // 색상 변경 (레인별)
            ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'].forEach(lane => {
                const colorInput = document.getElementById(`color-lane-${lane}`);
                if (colorInput) {
                    colorInput.addEventListener('input', (e) => {
                        this.settings.laneColors[lane] = e.target.value;
                        this.updatePreview();
                        this.updateCSSVariables();
                        this.forceUpdateNotes();
                    });
                }
            });

            // 색상 모드 선택
            const colorModeSelector = document.getElementById('color-mode-selector');
            if (colorModeSelector) {
                colorModeSelector.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        const mode = e.target.dataset.mode;
                        this.settings.colorMode = mode;
                        
                        // body 클래스 토글
                        if (mode === 'lane') {
                            document.body.classList.add('lane-color-mode');
                        } else {
                            document.body.classList.remove('lane-color-mode');
                        }
                        
                        this.updateColorModeUI();
                        this.updatePreview();
                        this.updateCSSVariables();
                        this.forceUpdateNotes();
                    }
                });
            }
            
            // 프리셋 슬롯 선택
            const presetSlots = document.getElementById('color-preset-slots');
            if (presetSlots) {
                presetSlots.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        const slot = parseInt(e.target.dataset.slot);
                        this.currentPresetSlot = slot;
                        this.loadPreset(slot);
                        this.updatePresetSlotsUI();
                    }
                });
            }
            
            // 프리셋 저장 버튼
            const savePresetBtn = document.getElementById('save-preset-btn');
            if (savePresetBtn) {
                savePresetBtn.addEventListener('click', () => {
                    this.savePreset(this.currentPresetSlot);
                    UI.showMessage('settings', `프리셋 ${this.currentPresetSlot}에 저장되었습니다.`);
                });
            }

            // 적용 버튼
            const applyBtn = document.getElementById('apply-appearance-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    this.saveSettings();
                    this.applySettings();
                    UI.showMessage('settings', '모양 설정이 적용되었습니다.');
                });
            }

            // 초기화 버튼
            const resetBtn = document.getElementById('reset-appearance-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    if (confirm('모든 모양 설정을 초기화하시겠습니까?')) {
                        this.resetSettings();
                        this.updatePreview();
                        UI.showMessage('settings', '모양 설정이 초기화되었습니다.');
                    }
                });
            }
        } catch (err) {
            this._logError(err, 'Appearance.setupEventListeners');
        }
    },

    updateShapeUI() {
        const buttons = document.querySelectorAll('#note-shape-selector button');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.shape === this.settings.noteShape);
        });
    },

    updatePreview() {
        try {
            const tapPreview = document.getElementById('preview-tap-note');
            const longPreview = document.getElementById('preview-long-note');
            const falsePreview = document.getElementById('preview-false-note');

            if (tapPreview) {
                tapPreview.style.backgroundColor = this.settings.colors.tap;
                tapPreview.className = 'note-preview';
                if (this.settings.noteShape === 'circle') {
                    tapPreview.style.borderRadius = '50%';
                    tapPreview.style.width = '60px';
                    tapPreview.style.height = '60px';
                } else {
                    tapPreview.style.borderRadius = '5px';
                    tapPreview.style.width = '80px';
                    tapPreview.style.height = '25px';
                }
            }

            if (longPreview) {
                const longColor = this.settings.colors.long;
                // 그라디언트를 위한 밝은 색상 계산
                const darkerColor = this.adjustColor(longColor, -20);
                longPreview.style.background = `linear-gradient(to top, ${darkerColor}, ${longColor})`;
                longPreview.className = 'note-preview note-preview-long';
                if (this.settings.noteShape === 'circle') {
                    longPreview.style.borderRadius = '50% 50% 0 0';
                    longPreview.style.width = '60px';
                } else {
                    longPreview.style.borderRadius = '5px';
                    longPreview.style.width = '80px';
                }
            }

            if (falsePreview) {
                falsePreview.style.backgroundColor = this.settings.colors.false;
                falsePreview.className = 'note-preview';
                if (this.settings.noteShape === 'circle') {
                    falsePreview.style.borderRadius = '50%';
                    falsePreview.style.width = '60px';
                    falsePreview.style.height = '60px';
                } else {
                    falsePreview.style.borderRadius = '5px';
                    falsePreview.style.width = '80px';
                    falsePreview.style.height = '25px';
                }
            }
            
            // 레인별 미리보기 업데이트
            ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'].forEach(lane => {
                const preview = document.querySelector(`#preview-lanes .note-preview[data-lane="${lane}"]`);
                if (preview && this.settings.laneColors[lane]) {
                    preview.style.backgroundColor = this.settings.laneColors[lane];
                    if (this.settings.noteShape === 'circle') {
                        preview.style.borderRadius = '50%';
                        preview.style.width = '40px';
                        preview.style.height = '40px';
                    } else {
                        preview.style.borderRadius = '5px';
                        preview.style.width = '50px';
                        preview.style.height = '20px';
                    }
                }
            });
        } catch (err) {
            this._logError(err, 'Appearance.updatePreview');
        }
    },

    updateCSSVariables() {
        try {
            // CSS 변수만 업데이트 (저장하지 않고 미리보기용)
            document.documentElement.style.setProperty('--note-tap-color', this.settings.colors.tap);
            document.documentElement.style.setProperty('--note-long-color', this.settings.colors.long);
            
            // 롱노트 그라디언트 시작 색상 계산 및 적용
            const gradientStart = this.adjustColor(this.settings.colors.long, -20);
            document.documentElement.style.setProperty('--note-long-gradient-start', gradientStart);
            
            document.documentElement.style.setProperty('--note-false-color', this.settings.colors.false);
        } catch (err) {
            this._logError(err, 'Appearance.updateCSSVariables');
        }
    },

    applySettings() {
        try {
            // CSS 변수로 색상 적용 (노트 타입별 색상 모드용)
            document.documentElement.style.setProperty('--note-tap-color', this.settings.colors.tap);
            document.documentElement.style.setProperty('--note-long-color', this.settings.colors.long);
            
            // 롱노트 그라디언트 시작 색상 계산 및 적용
            const gradientStart = this.adjustColor(this.settings.colors.long, -20);
            document.documentElement.style.setProperty('--note-long-gradient-start', gradientStart);
            
            document.documentElement.style.setProperty('--note-false-color', this.settings.colors.false);

            // 색상 모드에 따라 body 클래스 설정
            if (this.settings.colorMode === 'lane') {
                document.body.classList.add('lane-color-mode');
            } else {
                document.body.classList.remove('lane-color-mode');
            }

            // 노트 모양 클래스 적용
            if (this.settings.noteShape === 'circle') {
                document.body.classList.add('circle-notes');
            } else {
                document.body.classList.remove('circle-notes');
            }

            // UI 업데이트
            this.updateShapeUI();
            this.updateColorInputs();
            this.updateColorModeUI();
        } catch (err) {
            this._logError(err, 'Appearance.applySettings');
        }
    },

    updateColorInputs() {
        try {
            const tapInput = document.getElementById('color-tap-note');
            const longInput = document.getElementById('color-long-note');
            const falseInput = document.getElementById('color-false-note');

            if (tapInput) tapInput.value = this.settings.colors.tap;
            if (longInput) longInput.value = this.settings.colors.long;
            if (falseInput) falseInput.value = this.settings.colors.false;
            
            // 레인별 색상 입력 업데이트
            ['L4', 'L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3', 'R4'].forEach(lane => {
                const input = document.getElementById(`color-lane-${lane}`);
                if (input && this.settings.laneColors[lane]) {
                    input.value = this.settings.laneColors[lane];
                }
            });
        } catch (err) {
            this._logError(err, 'Appearance.updateColorInputs');
        }
    },

    saveSettings() {
        try {
            localStorage.setItem('theBeat_appearance', JSON.stringify(this.settings));
        } catch (err) {
            this._logError(err, 'Appearance.saveSettings');
        }
    },

    loadSettings() {
        try {
            const saved = localStorage.getItem('theBeat_appearance');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.settings = { ...this.settings, ...parsed };
            }
        } catch (err) {
            this._logError(err, 'Appearance.loadSettings');
        }
    },

    resetSettings() {
        try {
            this.settings = {
                noteShape: 'bar',
                colorMode: 'note-type',
                colors: {
                    tap: '#63b3ed',
                    long: '#a78bfa',
                    false: '#fca5a5'
                },
                laneColors: {
                    L4: '#ef4444',
                    L3: '#f59e0b',
                    L2: '#eab308',
                    L1: '#84cc16',
                    C1: '#06b6d4',
                    R1: '#3b82f6',
                    R2: '#8b5cf6',
                    R3: '#a855f7',
                    R4: '#ec4899'
                }
            };
            this.updateColorInputs();
            this.updateShapeUI();
            this.updateColorModeUI();
            this.applySettings();
        } catch (err) {
            this._logError(err, 'Appearance.resetSettings');
        }
    },

    adjustColor(color, amount) {
        // HEX 색상을 RGB로 변환하고 밝기 조절
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    },

    forceUpdateNotes() {
        // 게임 중이거나 에디터 중일 때 기존 노트들의 스타일을 강제로 업데이트
        try {
            const notes = document.querySelectorAll('.note, .editor-note');
            notes.forEach(noteEl => {
                if (this.settings.colorMode === 'lane') {
                    // 레인별 색상 모드
                    const lane = noteEl.dataset.lane;
                    if (lane && this.settings.laneColors[lane]) {
                        const color = this.settings.laneColors[lane];
                        if (noteEl.classList.contains('long')) {
                            const gradientStart = this.adjustColor(color, -20);
                            noteEl.style.background = `linear-gradient(to top, ${gradientStart}, ${color})`;
                        } else {
                            noteEl.style.backgroundColor = color;
                            if (noteEl.classList.contains('false')) {
                                noteEl.style.boxShadow = `0 0 8px ${color}`;
                            }
                        }
                    }
                } else {
                    // 노트 타입별 색상 모드
                    if (noteEl.classList.contains('long')) {
                        const gradientStart = this.adjustColor(this.settings.colors.long, -20);
                        noteEl.style.background = `linear-gradient(to top, ${gradientStart}, ${this.settings.colors.long})`;
                    } else if (noteEl.classList.contains('false')) {
                        noteEl.style.backgroundColor = this.settings.colors.false;
                        noteEl.style.boxShadow = `0 0 8px ${this.settings.colors.false}`;
                    } else {
                        noteEl.style.backgroundColor = this.settings.colors.tap;
                    }
                }
            });
        } catch (err) {
            // 조용히 무시
        }
    },

    updateColorModeUI() {
        try {
            // 색상 모드 버튼 활성화 상태 업데이트
            const buttons = document.querySelectorAll('#color-mode-selector button');
            buttons.forEach(btn => {
                if (btn.dataset.mode === this.settings.colorMode) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
            
            // 해당 색상 설정 패널 표시/숨김
            const noteTypePanel = document.getElementById('note-type-colors');
            const lanePanel = document.getElementById('lane-colors');
            const noteTypePreview = document.getElementById('preview-note-type');
            const lanePreview = document.getElementById('preview-lanes');
            
            if (this.settings.colorMode === 'lane') {
                if (noteTypePanel) noteTypePanel.classList.add('hidden');
                if (lanePanel) lanePanel.classList.remove('hidden');
                if (noteTypePreview) noteTypePreview.classList.add('hidden');
                if (lanePreview) lanePreview.classList.remove('hidden');
            } else {
                if (noteTypePanel) noteTypePanel.classList.remove('hidden');
                if (lanePanel) lanePanel.classList.add('hidden');
                if (noteTypePreview) noteTypePreview.classList.remove('hidden');
                if (lanePreview) lanePreview.classList.add('hidden');
            }
        } catch (err) {
            this._logError(err, 'Appearance.updateColorModeUI');
        }
    },
    
    updatePresetSlotsUI() {
        try {
            const buttons = document.querySelectorAll('.preset-slot');
            buttons.forEach(btn => {
                const slot = parseInt(btn.dataset.slot);
                if (slot === this.currentPresetSlot) {
                    btn.classList.add('active');
                    btn.classList.add('border-blue-500');
                } else {
                    btn.classList.remove('active');
                    btn.classList.remove('border-blue-500');
                }
            });
        } catch (err) {
            this._logError(err, 'Appearance.updatePresetSlotsUI');
        }
    },
    
    savePreset(slot) {
        try {
            const index = slot - 1;
            const mode = this.settings.colorMode;
            
            if (mode === 'note-type') {
                this.presets['note-type'][index] = {
                    noteShape: this.settings.noteShape,
                    colors: { ...this.settings.colors }
                };
            } else {
                this.presets['lane'][index] = {
                    noteShape: this.settings.noteShape,
                    laneColors: { ...this.settings.laneColors }
                };
            }
            
            localStorage.setItem('theBeat_colorPresets', JSON.stringify(this.presets));
        } catch (err) {
            this._logError(err, 'Appearance.savePreset');
        }
    },
    
    loadPreset(slot) {
        try {
            const index = slot - 1;
            const mode = this.settings.colorMode;
            const preset = this.presets[mode][index];
            
            if (preset && Object.keys(preset).length > 0) {
                if (mode === 'note-type' && preset.colors) {
                    this.settings.colors = { ...preset.colors };
                    if (preset.noteShape) this.settings.noteShape = preset.noteShape;
                } else if (mode === 'lane' && preset.laneColors) {
                    this.settings.laneColors = { ...preset.laneColors };
                    if (preset.noteShape) this.settings.noteShape = preset.noteShape;
                }
                
                this.updateColorInputs();
                this.updateShapeUI();
                this.updatePreview();
                this.updateCSSVariables();
                this.forceUpdateNotes();
            }
        } catch (err) {
            this._logError(err, 'Appearance.loadPreset');
        }
    },
    
    loadPresets() {
        try {
            const saved = localStorage.getItem('theBeat_colorPresets');
            if (saved) {
                this.presets = JSON.parse(saved);
            }
        } catch (err) {
            this._logError(err, 'Appearance.loadPresets');
        }
    },

    getNoteClass() {
        return this.settings.noteShape === 'circle' ? 'circle' : '';
    }
};
