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
        // ── 커스터마이징 계획 2단계 후속: 판정/콤보/카운트다운 텍스트 위치·애니메이션 ──
        // 오프셋은 기존 중앙 기준 top/left(50%/60%/40%)에서 px 단위로 더해지는 값이다
        // (css/beat/game.css calc() 참고) — 0이면 기존과 완전히 동일한 위치.
        // 애니메이션은 'pop'(기존 기본 동작)/'fade'/'slideUp'/'bounce' 중 하나.
        judgementOffsetX: 0,
        judgementOffsetY: 0,
        judgementAnimation: 'pop',
        comboOffsetX: 0,
        comboOffsetY: 0,
        comboAnimation: 'pop',
        countdownOffsetX: 0,
        countdownOffsetY: 0,
        countdownAnimation: 'pop',
        // 커스터마이징 계획 1-B단계: BeatFonts(js/beat/appearance/fonts.js)에 업로드된
        // 폰트의 id. null이면 CSS 기본값(inherit → 전역 UI 폰트)을 그대로 쓴다.
        judgementFontId: null,
        comboFontId: null,
        countdownFontId: null,
        // 전체 UI 폰트(사이트 전역 --tb-font-family). 버그 수정: 예전엔 BeatFonts가 이 값을
        // 스킨과 무관한 별도 전역 저장소(IndexedDB 'misc' 스토어)에 두고 있어서 스킨을
        // 바꿔도 UI 폰트만 그대로 남는 문제가 있었다 — 판정/콤보/카운트다운 폰트와 동일하게
        // 여기(스킨 소유)로 옮겨서 스킨 전환 시 함께 바뀌게 한다. null이면 기본 서체.
        uiFontId: null,
        // ── 커스터마이징 계획 2단계: 노트 크기/애니메이션 ──
        // 실제 이미지 스킨 등록소는 BeatSkinImages(js/beat/appearance/skin-images.js)가
        // 별도로 관리한다(폰트와 마찬가지로 "몇 번째 노트가 어떤 이미지를 쓰는지"가 아니라
        // 슬롯 3개 고정이라 Appearance.settings에는 크기/애니메이션 값만 둔다).
        noteSize: 1,       // 배율(0.5~2). 1이면 기존 NOTE_BAR_H/NOTE_CIRCLE_D와 동일.
        noteAnimation: 'none', // 'none' | 'fade' | 'scale' — 노트가 화면에 나타날 때 인 애니메이션.
        // ── 커스터마이징 계획 1/4단계: 원래 main.js PLAY_SETTINGS_KEYS/Game.state.settings에
        // 있던 시각 항목 3개를 스킨 소유로 이관. 스킨을 바꾸면 이 값들도 함께 바뀐다.
        // UI(슬라이더/토글)는 "플레이" 탭에 그대로 있고, applyPlayVisualSettings()가
        // applySettings()를 통해 그 UI/CSS 변수/GameBackground에 반영한다.
        gameplayImageOpacity: 100, // 게임플레이 중 노래 커버 이미지 배경 불투명도 (0~100)
        laneBackgroundOpacity: 30, // 레인 영역 배경 진하기 (0~100)
        laneHighlightOnInput: true, // 입력 시 레인 하이라이트 피드백 표시 여부
        // ── 커스터마이징 계획 2단계: 배경 확장(비디오/그라디언트) ──
        // 'cover'(노래 커버, 기본) | 'video'(업로드한 배경 동영상 — BeatSkinImages의
        // 'background-video' 슬롯에 스킨별로 저장, 없으면 커버로 자동 폴백) |
        // 'gradient'(아래 backgroundGradient 색상으로 그라데이션). 파티클은 범위가 커서
        // 이번 단계에서 제외(후순위). GameBackground.set()/applyMode()가 이 값을 읽는다.
        backgroundMode: 'cover',
        backgroundGradient: { from: '#0f172a', to: '#1e293b', angle: 135 },
        // ── UI 테마도 스킨 소유로 이관 ──
        // 원래 BeatTheme(theme.js)가 localStorage(theBeat_theme/theBeat_customTheme)에
        // 독립적으로 저장하던 사이트 전체 색상 테마('dark'|'blue'|'light'|'custom')를
        // 여기로 옮겨 다른 항목들과 동일하게 스킨을 바꾸면 함께 바뀌게 한다.
        // 'custom'일 때 themeCustomColors가 null이면 BeatTheme.CUSTOM_TOKENS 기본값을 쓴다.
        // localStorage의 두 키는 완전히 없애지 않고 "지금 활성 스킨 테마의 캐시"로 남겨둔다
        // (theme.js 상단 즉시실행 함수가 최초 페인트 전에 동기로 읽어 깜빡임을 막는 용도라
        // IndexedDB의 비동기 로드를 기다릴 수 없음 — applyFromSettings()가 실제 적용 때마다
        // 이 캐시도 함께 갱신해 다음 새로고침부터는 캐시 자체가 최신 스킨 값과 일치하게 한다).
        themeId: 'blue',
        themeCustomColors: null
    },
    
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
            
            // 초기 UI 반영
            this.applySettings();
            this.updateColorModeUI();
            this.updateScrollDirectionUI();
            this.updateJudgementPositionUI();
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

            // 판정/콤보/카운트다운 위치(오프셋)·애니메이션(커스터마이징 계획 2단계 후속)
            [
                { prefix: 'judgement' },
                { prefix: 'combo' },
                { prefix: 'countdown' },
            ].forEach(({ prefix }) => {
                const animSelect = document.getElementById(`${prefix}-animation-select`);
                if (animSelect) {
                    animSelect.addEventListener('change', (e) => {
                        this.settings[`${prefix}Animation`] = e.target.value;
                        this.updateJudgementCssVariables();
                    });
                }
                const offsetXInput = document.getElementById(`${prefix}-offset-x`);
                if (offsetXInput) {
                    offsetXInput.addEventListener('input', (e) => {
                        const value = parseInt(e.target.value, 10);
                        this.settings[`${prefix}OffsetX`] = value;
                        const label = document.getElementById(`${prefix}-offset-x-value`);
                        if (label) label.textContent = `${value}px`;
                        this.updateJudgementCssVariables();
                    });
                }
                const offsetYInput = document.getElementById(`${prefix}-offset-y`);
                if (offsetYInput) {
                    offsetYInput.addEventListener('input', (e) => {
                        const value = parseInt(e.target.value, 10);
                        this.settings[`${prefix}OffsetY`] = value;
                        const label = document.getElementById(`${prefix}-offset-y-value`);
                        if (label) label.textContent = `${value}px`;
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
            
            // 배경 모드 선택(커버/동영상/그라디언트) — 커스터마이징 계획 2단계 배경 확장.
            // 값 자체는 saveSettings()(적용 버튼)에서 저장되지만, 다른 색상/모양 입력과
            // 마찬가지로 여기서는 즉시 GameBackground에 반영해 실시간 미리보기를 준다.
            const bgModeSelector = document.getElementById('background-mode-selector');
            if (bgModeSelector) {
                bgModeSelector.addEventListener('click', (e) => {
                    const btn = e.target.closest('button[data-bgmode]');
                    if (!btn) return;
                    this.settings.backgroundMode = btn.dataset.bgmode;
                    this.updateBackgroundModeUI();
                    if (typeof GameBackground !== 'undefined' && GameBackground.applyMode) {
                        GameBackground.applyMode();
                    }
                });
            }

            // 그라디언트 배경 색상(시작/끝)·각도
            const gradFromInput = document.getElementById('color-background-gradient-from');
            if (gradFromInput) {
                gradFromInput.addEventListener('input', (e) => {
                    this.settings.backgroundGradient.from = e.target.value;
                    if (typeof GameBackground !== 'undefined' && GameBackground.applyMode) GameBackground.applyMode();
                });
            }
            const gradToInput = document.getElementById('color-background-gradient-to');
            if (gradToInput) {
                gradToInput.addEventListener('input', (e) => {
                    this.settings.backgroundGradient.to = e.target.value;
                    if (typeof GameBackground !== 'undefined' && GameBackground.applyMode) GameBackground.applyMode();
                });
            }
            const gradAngleInput = document.getElementById('background-gradient-angle');
            if (gradAngleInput) {
                gradAngleInput.addEventListener('input', (e) => {
                    const angle = parseInt(e.target.value, 10);
                    this.settings.backgroundGradient.angle = angle;
                    const label = document.getElementById('background-gradient-angle-value');
                    if (label) label.textContent = `${angle}°`;
                    if (typeof GameBackground !== 'undefined' && GameBackground.applyMode) GameBackground.applyMode();
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

        // 위치(오프셋) — 기본 top/left(50%/60%/40%)에 px로 더해진다(css/beat/game.css calc() 참고).
        root.setProperty('--judgement-offset-x', `${this.settings.judgementOffsetX || 0}px`);
        root.setProperty('--judgement-offset-y', `${this.settings.judgementOffsetY || 0}px`);
        root.setProperty('--combo-offset-x', `${this.settings.comboOffsetX || 0}px`);
        root.setProperty('--combo-offset-y', `${this.settings.comboOffsetY || 0}px`);
        root.setProperty('--countdown-offset-x', `${this.settings.countdownOffsetX || 0}px`);
        root.setProperty('--countdown-offset-y', `${this.settings.countdownOffsetY || 0}px`);

        // 폰트(1-B단계): BeatFonts가 아직 로드/초기화되지 않았을 수 있어 존재 체크 후 폴백.
        const fontCss = (id) => (typeof BeatFonts !== 'undefined' && BeatFonts.getFontFamilyCss)
            ? BeatFonts.getFontFamilyCss(id, 'inherit')
            : 'inherit';
        root.setProperty('--judgement-font-family', fontCss(this.settings.judgementFontId));
        root.setProperty('--combo-font-family', fontCss(this.settings.comboFontId));
        root.setProperty('--countdown-font-family', fontCss(this.settings.countdownFontId));

        // 전체 UI 폰트(사이트 전역 --tb-font-family) — 버그 수정: 스킨을 바꿀 때마다 다른
        // 판정/콤보/카운트다운 폰트처럼 이 값도 함께 바뀌어야 한다(이 함수는 applySettings()를
        // 통해 스킨 전환/최초 로드/계정 값 수신 시점마다 항상 호출된다). 폴백은 기존
        // BeatFonts._applyUiFontVariable()이 쓰던 것과 동일한 'Inter'.
        root.setProperty('--tb-font-family', (typeof BeatFonts !== 'undefined' && BeatFonts.getFontFamilyCss)
            ? BeatFonts.getFontFamilyCss(this.settings.uiFontId, "'Inter', sans-serif")
            : "'Inter', sans-serif");

        // 애니메이션(pop/fade/slideUp/bounce) — 판정/콤보는 ui.js가 판정마다 className을
        // 통째로 새로 만들면서(reflow 트릭) 그때그때 Appearance.settings를 직접 읽어 반영하므로
        // 여기서 미리 클래스를 걸어둘 필요가 없다. 카운트다운은 game.js가 className을 갈아
        // 끼우지 않고 'show' 클래스만 add/remove하므로, anim-* 클래스는 여기서(스킨
        // 전환/슬라이더 변경 등 이 함수가 불리는 시점마다) 미리 심어둬야 한다.
        if (typeof DOM !== 'undefined' && DOM.countdownTextEl) {
            ['anim-pop', 'anim-fade', 'anim-slideUp', 'anim-bounce'].forEach(c => {
                DOM.countdownTextEl.classList.remove(c);
            });
            DOM.countdownTextEl.classList.add(`anim-${this.settings.countdownAnimation || 'pop'}`);
        }
    },

    // "플레이" 탭의 gameplayImageOpacity/laneBackgroundOpacity/laneHighlightOnInput UI(슬라이더/
    // 토글)와 그 CSS 변수/GameBackground 반영. 커스터마이징 계획 1/4단계로 이 3개 값의 소유권이
    // main.js/Game.state.settings에서 여기로 옮겨오면서, main.js의 옛 refreshPlaySettingsUI()가
    // 하던 일 중 이 3개에 해당하는 부분을 흡수했다. applySettings()가 호출되는 모든 시점
    // (최초 로드, 스킨 전환, 계정에서 커스터마이징 값을 받아온 직후)에 자동으로 함께 반영된다.
    // DOM/GameBackground가 아직 없는 시점(초기 로드 순서)이나 없는 페이지일 수 있어 존재 체크.
    applyPlayVisualSettings() {
        try {
            if (typeof DOM === 'undefined' || !DOM.settings) return;

            if (DOM.settings.gameplayImageOpacitySlider) {
                const opacityValue = this.settings.gameplayImageOpacity;
                DOM.settings.gameplayImageOpacitySlider.value = opacityValue;
                if (DOM.settings.gameplayImageOpacityValue) {
                    DOM.settings.gameplayImageOpacityValue.textContent = opacityValue;
                }
            }
            if (DOM.settings.laneBackgroundOpacitySlider) {
                const laneBgValue = this.settings.laneBackgroundOpacity;
                DOM.settings.laneBackgroundOpacitySlider.value = laneBgValue;
                if (DOM.settings.laneBackgroundOpacityValue) {
                    DOM.settings.laneBackgroundOpacityValue.textContent = laneBgValue;
                }
                document.documentElement.style.setProperty('--lane-bg-opacity', laneBgValue / 100);
            }
            if (DOM.settings.laneHighlightToggle) {
                DOM.settings.laneHighlightToggle.checked = this.settings.laneHighlightOnInput !== false;
            }

            this.updateBackgroundModeUI();

            if (typeof GameBackground !== 'undefined' && GameBackground.applyOpacity) {
                GameBackground.applyOpacity();
            }
            // 스킨 전환/최초 로드/계정 값 수신 등 applySettings()가 호출되는 모든 시점에
            // backgroundMode/backgroundGradient도 함께 바뀌었을 수 있으므로 다시 그린다.
            if (typeof GameBackground !== 'undefined' && GameBackground.applyMode) {
                GameBackground.applyMode();
            }

            // UI 테마도 이제 스킨 소유(themeId/themeCustomColors)이므로, 같은 시점에 함께
            // 반영한다. BeatSkin.switchTo() 한 번으로 노트 색/이미지/폰트뿐 아니라 사이트
            // 전체 테마까지 그 스킨의 값으로 바뀌게 하려는 목적.
            if (typeof BeatTheme !== 'undefined' && BeatTheme.applyFromSettings) {
                BeatTheme.applyFromSettings(this.settings.themeId, this.settings.themeCustomColors);
            }
        } catch (err) {
            this._logError(err, 'Appearance.applyPlayVisualSettings');
        }
    },

    // 배경 모드 선택 버튼(#background-mode-selector)의 active 상태, 모드별 패널(동영상 업로드/
    // 그라디언트 색상 선택) 표시 여부, 그라디언트 입력값을 현재 settings와 동기화한다.
    updateBackgroundModeUI() {
        try {
            const selector = document.getElementById('background-mode-selector');
            if (selector) {
                selector.querySelectorAll('button').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.bgmode === this.settings.backgroundMode);
                });
            }
            const videoPanel = document.getElementById('background-mode-video-panel');
            if (videoPanel) videoPanel.classList.toggle('hidden', this.settings.backgroundMode !== 'video');
            const gradientPanel = document.getElementById('background-mode-gradient-panel');
            if (gradientPanel) gradientPanel.classList.toggle('hidden', this.settings.backgroundMode !== 'gradient');

            const g = this.settings.backgroundGradient || { from: '#0f172a', to: '#1e293b', angle: 135 };
            const fromInput = document.getElementById('color-background-gradient-from');
            if (fromInput) fromInput.value = g.from;
            const toInput = document.getElementById('color-background-gradient-to');
            if (toInput) toInput.value = g.to;
            const angleInput = document.getElementById('background-gradient-angle');
            if (angleInput) angleInput.value = g.angle;
            const angleLabel = document.getElementById('background-gradient-angle-value');
            if (angleLabel) angleLabel.textContent = `${g.angle}°`;
        } catch (err) {
            this._logError(err, 'Appearance.updateBackgroundModeUI');
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

            this.updateJudgementCssVariables();
            this.applyPlayVisualSettings();

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
            // 버그 수정: 노트 타입별/레인별 색상 미리보기(#preview-tap-note 등)가 지금까지
            // 색상 피커를 "직접 드래그할 때"만(각 input 리스너 안에서) 갱신되고 있었다 —
            // 스킨 전환/최초 로드/계정 값 수신처럼 applySettings()가 도는 다른 모든 경로에서는
            // 갱신되지 않아, 미리보기가 이전 스킨의 색을 그대로 보여주는 버그가 있었다.
            // 여기서 함께 호출해 applySettings()가 도는 모든 시점에 항상 최신 상태를 반영한다.
            this.updatePreview();
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

            // 판정/콤보/카운트다운 위치(오프셋)·애니메이션 입력값 동기화(스킨 전환 시 등)
            [
                { prefix: 'judgement' },
                { prefix: 'combo' },
                { prefix: 'countdown' },
            ].forEach(({ prefix }) => {
                const animSelect = document.getElementById(`${prefix}-animation-select`);
                if (animSelect) animSelect.value = this.settings[`${prefix}Animation`] || 'pop';

                const offsetX = this.settings[`${prefix}OffsetX`] || 0;
                const offsetXInput = document.getElementById(`${prefix}-offset-x`);
                if (offsetXInput) offsetXInput.value = offsetX;
                const offsetXLabel = document.getElementById(`${prefix}-offset-x-value`);
                if (offsetXLabel) offsetXLabel.textContent = `${offsetX}px`;

                const offsetY = this.settings[`${prefix}OffsetY`] || 0;
                const offsetYInput = document.getElementById(`${prefix}-offset-y`);
                if (offsetYInput) offsetYInput.value = offsetY;
                const offsetYLabel = document.getElementById(`${prefix}-offset-y-value`);
                if (offsetYLabel) offsetYLabel.textContent = `${offsetY}px`;
            });
        } catch (err) {
            this._logError(err, 'Appearance.updateColorInputs');
        }
    },

    // ── 커스터마이징 계획 "로컬 저장소 정책" 정리(3단계 후속) ──
    // BeatSkin(IndexedDB)이 유일한 저장소다. 예전에는 여기서 localStorage.theBeat_appearance에도
    // 매번 같이 썼는데(레거시 이관 전 남아있던 이중 저장), 지금은 IndexedDB 하나로만 저장한다.
    // theBeat_appearance 자체는 BeatSkin.init()이 최초 1회 마이그레이션 때 읽은 뒤 지운다
    // (skin.js _migrateLegacy/_cleanupLegacyLocalStorage 참고).
    saveSettings() {
        try {
            // BeatSkin(스킨 시스템)에 지금 값을 캡처해 IndexedDB에 반영한다.
            // BeatSkin이 아직 초기화 전이거나(로드 순서 문제) 없는 페이지일 수 있어 존재 체크.
            if (typeof BeatSkin !== 'undefined' && BeatSkin.captureFromAppearance) {
                BeatSkin.captureFromAppearance();
            }
        } catch (err) {
            this._logError(err, 'Appearance.saveSettings');
        }
    },

    // 레거시 localStorage(theBeat_appearance)가 아직 지워지기 전(BeatSkin.init()이 끝나기 전)
    // 짧은 구간에 대한 1회성 폴백 읽기다. BeatSkin.init()이 곧이어 IndexedDB 값으로 이 설정을
    // 덮어쓰고(applyActive()), 그 시점에 legacy 키도 정리되므로 이후로는 이 읽기가 아무것도
    // 찾지 못하는 것이 정상이다(신규 유저/이미 마이그레이션된 유저 모두).
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
                judgementOffsetX: 0,
                judgementOffsetY: 0,
                judgementAnimation: 'pop',
                comboOffsetX: 0,
                comboOffsetY: 0,
                comboAnimation: 'pop',
                countdownOffsetX: 0,
                countdownOffsetY: 0,
                countdownAnimation: 'pop',
                judgementFontId: null,
                comboFontId: null,
                countdownFontId: null,
                uiFontId: null,
                noteSize: 1,
                noteAnimation: 'none',
                gameplayImageOpacity: 100,
                laneBackgroundOpacity: 30,
                laneHighlightOnInput: true,
                backgroundMode: 'cover',
                backgroundGradient: { from: '#0f172a', to: '#1e293b', angle: 135 },
                themeId: 'blue',
                themeCustomColors: null
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
    
    getNoteClass() {
        return this.settings.noteShape === 'circle' ? 'circle' : '';
    }
};