const Appearance = {
    settings: {
        scrollDirection: 'down', // 'down' or 'up'
        noteShape: 'bar', // 'bar' or 'circle'
        judgementPosition: 'default', // 'default' or 'low'
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
        },
        // ── 커스터마이징 계획 2단계: 판정선/판정 텍스트/콤보/카운트다운 ──
        // 판정선(Canvas 드로잉)은 game.js drawLaneBackground()가 이 색을 기준으로
        // 그라데이션 rgba를 직접 계산해서 쓴다(hexToRgba 참고).
        judgementLineColor: '#ffffff',
        // 판정 텍스트/콤보/카운트다운(DOM 기반)은 CSS 변수(--judgement-*, --combo-*,
        // --countdown-*)로 css/beat/game.css의 .judgement-text 등에 주입된다
        // (applySettings() 참고). 위치(top/left)는 아직 UI가 없어 CSS 쪽 기본값을 그대로
        // 쓰고, 폰트(--judgement-font-family 등)는 1-B단계(BeatFonts)에서 연결 예정.
        judgementTextColor: '#ffffff',
        judgementTextSize: 4, // rem
        comboTextColor: '#f6e05e',
        comboTextSize: 2.5, // rem
        countdownTextColor: '#ffffff',
        countdownTextSize: 8, // rem
        // 커스터마이징 계획 1-B단계: BeatFonts(js/beat/appearance/fonts.js)에 업로드된
        // 폰트의 id. null이면 CSS 기본값(inherit → 전역 UI 폰트)을 그대로 쓴다.
        judgementFontId: null,
        comboFontId: null,
        countdownFontId: null,
        // ── 커스터마이징 계획 2단계: 노트 크기/애니메이션 ──
        // 실제 이미지 스킨 등록소는 BeatSkinImages(js/beat/appearance/skin-images.js)가
        // 별도로 관리한다(폰트와 마찬가지로 "몇 번째 노트가 어떤 이미지를 쓰는지"가 아니라
        // 슬롯 3개 고정이라 Appearance.settings에는 크기/애니메이션 값만 둔다).
        noteSize: 1,       // 배율(0.5~2). 1이면 기존 NOTE_BAR_H/NOTE_CIRCLE_D와 동일.
        noteAnimation: 'none' // 'none' | 'fade' | 'scale' — 노트가 화면에 나타날 때 인 애니메이션.
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
            this.updateScrollDirectionUI();
            this.updateJudgementPositionUI();
            this.updatePresetSlotsUI();
            this.updateNoteSizeAnimationUI();
            
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
            // 노트 방향(스크롤) 선택
            const scrollDirectionSelector = document.getElementById('scroll-direction-selector');
            if (scrollDirectionSelector) {
                scrollDirectionSelector.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        const direction = e.target.dataset.direction;
                        this.settings.scrollDirection = direction;
                        this.updateScrollDirectionUI();
                    }
                });
            }

            // 노트 판정 위치 선택
            const judgementPositionSelector = document.getElementById('judgement-position-selector');
            if (judgementPositionSelector) {
                judgementPositionSelector.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        this.settings.judgementPosition = e.target.dataset.position;
                        this.updateJudgementPositionUI();
                    }
                });
            }

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

            // 노트 크기(커스터마이징 계획 2단계) — 실시간 반영(게임 캔버스는 Appearance.settings를
            // 매 프레임 직접 읽으므로 별도 setProperty 없이 값만 바꾸면 된다).
            const noteSizeInput = document.getElementById('note-size-slider');
            if (noteSizeInput) {
                noteSizeInput.addEventListener('input', (e) => {
                    this.settings.noteSize = parseFloat(e.target.value);
                    const label = document.getElementById('note-size-value');
                    if (label) label.textContent = `${this.settings.noteSize.toFixed(2)}x`;
                });
            }

            // 노트 애니메이션(커스터마이징 계획 2단계)
            const noteAnimSelector = document.getElementById('note-animation-selector');
            if (noteAnimSelector) {
                noteAnimSelector.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        this.settings.noteAnimation = e.target.dataset.animation;
                        noteAnimSelector.querySelectorAll('button').forEach(btn => {
                            btn.classList.toggle('active', btn.dataset.animation === this.settings.noteAnimation);
                        });
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

            // 판정선 색상 (Canvas 드로잉 — CSS 변수가 아니라 game.js가 설정값을 직접 참조)
            const judgementLineInput = document.getElementById('color-judgement-line');
            if (judgementLineInput) {
                judgementLineInput.addEventListener('input', (e) => {
                    this.settings.judgementLineColor = e.target.value;
                });
            }

            // 판정 텍스트 / 콤보 텍스트 / 카운트다운 (색상 + 크기, CSS 변수로 주입)
            [
                { colorId: 'color-judgement-text', sizeId: 'judgement-text-size', labelId: 'judgement-text-size-value', colorKey: 'judgementTextColor', sizeKey: 'judgementTextSize' },
                { colorId: 'color-combo-text',      sizeId: 'combo-text-size',      labelId: 'combo-text-size-value',      colorKey: 'comboTextColor',      sizeKey: 'comboTextSize' },
                { colorId: 'color-countdown-text',  sizeId: 'countdown-text-size',  labelId: 'countdown-text-size-value',  colorKey: 'countdownTextColor',  sizeKey: 'countdownTextSize' }
            ].forEach(({ colorId, sizeId, labelId, colorKey, sizeKey }) => {
                const colorInput = document.getElementById(colorId);
                if (colorInput) {
                    colorInput.addEventListener('input', (e) => {
                        this.settings[colorKey] = e.target.value;
                        this.updateJudgementCssVariables();
                    });
                }
                const sizeInput = document.getElementById(sizeId);
                if (sizeInput) {
                    sizeInput.addEventListener('input', (e) => {
                        this.settings[sizeKey] = parseFloat(e.target.value);
                        const label = document.getElementById(labelId);
                        if (label) label.textContent = `${this.settings[sizeKey]}rem`;
                        this.updateJudgementCssVariables();
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
                    // 지금 활성 스킨(색상/모양/판정 텍스트/폰트 참조 등)이 바뀐 것이므로
                    // 클라우드 동기화 대상(계획 4단계)이다.
                    if (typeof BeatCustomizationSync !== 'undefined') BeatCustomizationSync.schedulePush();
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

    // 노트 크기 슬라이더 값 + 애니메이션 선택 버튼(커스터마이징 계획 2단계) 초기/갱신 반영.
    updateNoteSizeAnimationUI() {
        try {
            const sizeInput = document.getElementById('note-size-slider');
            if (sizeInput) sizeInput.value = this.settings.noteSize;
            const sizeLabel = document.getElementById('note-size-value');
            if (sizeLabel) sizeLabel.textContent = `${this.settings.noteSize.toFixed(2)}x`;

            const animButtons = document.querySelectorAll('#note-animation-selector button');
            animButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.animation === this.settings.noteAnimation);
            });
        } catch (err) {
            this._logError(err, 'Appearance.updateNoteSizeAnimationUI');
        }
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

            this.updateJudgementCssVariables();
        } catch (err) {
            this._logError(err, 'Appearance.updateCSSVariables');
        }
    },

    // 판정 텍스트/콤보/카운트다운(DOM 기반, css/beat/game.css)에 쓰이는 CSS 변수를
    // 주입한다. updateCSSVariables()/applySettings() 양쪽에서 공용으로 호출.
    updateJudgementCssVariables() {
        const root = document.documentElement.style;
        root.setProperty('--judgement-color', this.settings.judgementTextColor);
        root.setProperty('--judgement-font-size', `${this.settings.judgementTextSize}rem`);
        root.setProperty('--combo-color', this.settings.comboTextColor);
        root.setProperty('--combo-font-size', `${this.settings.comboTextSize}rem`);
        root.setProperty('--countdown-color', this.settings.countdownTextColor);
        root.setProperty('--countdown-font-size', `${this.settings.countdownTextSize}rem`);

        // 폰트(1-B단계): BeatFonts가 아직 로드/초기화되지 않았을 수 있어 존재 체크 후 폴백.
        const fontCss = (id) => (typeof BeatFonts !== 'undefined' && BeatFonts.getFontFamilyCss)
            ? BeatFonts.getFontFamilyCss(id, 'inherit')
            : 'inherit';
        root.setProperty('--judgement-font-family', fontCss(this.settings.judgementFontId));
        root.setProperty('--combo-font-family', fontCss(this.settings.comboFontId));
        root.setProperty('--countdown-font-family', fontCss(this.settings.countdownFontId));
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

            this.updateJudgementCssVariables();

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
            this.updateScrollDirectionUI();
            this.updateJudgementPositionUI();
            this.updateNoteSizeAnimationUI();
        } catch (err) {
            this._logError(err, 'Appearance.applySettings');
        }
    },

    updateScrollDirectionUI() {
        try {
            const buttons = document.querySelectorAll('#scroll-direction-selector button');
            buttons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.direction === this.settings.scrollDirection);
            });
        } catch (err) {
            this._logError(err, 'Appearance.updateScrollDirectionUI');
        }
    },

    updateJudgementPositionUI() {
        try {
            const buttons = document.querySelectorAll('#judgement-position-selector button');
            buttons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.position === this.settings.judgementPosition);
            });
        } catch (err) {
            this._logError(err, 'Appearance.updateJudgementPositionUI');
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

            // 판정선/판정 텍스트/콤보/카운트다운 입력 업데이트
            const jLineInput = document.getElementById('color-judgement-line');
            if (jLineInput) jLineInput.value = this.settings.judgementLineColor;

            const jTextColorInput = document.getElementById('color-judgement-text');
            if (jTextColorInput) jTextColorInput.value = this.settings.judgementTextColor;
            const jTextSizeInput = document.getElementById('judgement-text-size');
            if (jTextSizeInput) jTextSizeInput.value = this.settings.judgementTextSize;
            const jTextSizeLabel = document.getElementById('judgement-text-size-value');
            if (jTextSizeLabel) jTextSizeLabel.textContent = `${this.settings.judgementTextSize}rem`;

            const comboColorInput = document.getElementById('color-combo-text');
            if (comboColorInput) comboColorInput.value = this.settings.comboTextColor;
            const comboSizeInput = document.getElementById('combo-text-size');
            if (comboSizeInput) comboSizeInput.value = this.settings.comboTextSize;
            const comboSizeLabel = document.getElementById('combo-text-size-value');
            if (comboSizeLabel) comboSizeLabel.textContent = `${this.settings.comboTextSize}rem`;

            const countdownColorInput = document.getElementById('color-countdown-text');
            if (countdownColorInput) countdownColorInput.value = this.settings.countdownTextColor;
            const countdownSizeInput = document.getElementById('countdown-text-size');
            if (countdownSizeInput) countdownSizeInput.value = this.settings.countdownTextSize;
            const countdownSizeLabel = document.getElementById('countdown-text-size-value');
            if (countdownSizeLabel) countdownSizeLabel.textContent = `${this.settings.countdownTextSize}rem`;
        } catch (err) {
            this._logError(err, 'Appearance.updateColorInputs');
        }
    },

    saveSettings() {
        try {
            localStorage.setItem('theBeat_appearance', JSON.stringify(this.settings));
            // BeatSkin(스킨 시스템)에도 지금 값을 캡처해 IndexedDB에 반영한다.
            // BeatSkin이 아직 초기화 전이거나(로드 순서 문제) 없는 페이지일 수 있어 존재 체크.
            if (typeof BeatSkin !== 'undefined' && BeatSkin.captureFromAppearance) {
                BeatSkin.captureFromAppearance();
            }
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
                scrollDirection: 'down',
                noteShape: 'bar',
                judgementPosition: 'default',
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
                },
                judgementLineColor: '#ffffff',
                judgementTextColor: '#ffffff',
                judgementTextSize: 4,
                comboTextColor: '#f6e05e',
                comboTextSize: 2.5,
                countdownTextColor: '#ffffff',
                countdownTextSize: 8,
                judgementFontId: null,
                comboFontId: null,
                countdownFontId: null,
                noteSize: 1,
                noteAnimation: 'none'
            };
            this.updateColorInputs();
            this.updateShapeUI();
            this.updateColorModeUI();
            this.updateScrollDirectionUI();
            this.updateJudgementPositionUI();
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

    // HEX 색상 → "rgba(r, g, b, alpha)" 문자열. 판정선(Canvas 드로잉)처럼 CSS 변수를
    // 못 쓰는 곳에서 사용자가 고른 색으로 그라데이션/투명도를 직접 계산할 때 쓴다.
    hexToRgba(color, alpha) {
        const hex = (color || '#ffffff').replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    forceUpdateNotes() {
        // Canvas 기반 게임 노트는 매 프레임 Appearance 설정을 참조하므로 별도 업데이트 불필요.
        // 에디터 노트(DOM 기반)만 스타일 강제 갱신한다.
        try {
            const editorNotes = document.querySelectorAll('.editor-note');
            editorNotes.forEach(noteEl => {
                if (this.settings.colorMode === 'lane') {
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