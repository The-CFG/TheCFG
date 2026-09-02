const I18n = {
    currentLang: 'ko',
    
    translations: {
        ko: {
            // 메인 화면
            'game_title': 'TheBeat',
            'start_game': '게임 시작',
            'editor': '에디터',
            'game_mode': '게임 모드',
            'random_mode': '랜덤 모드',
            'music_mode': '뮤직 모드',
            'lanes': '레인 수',
            'lanes_4': '4레인',
            'lanes_5': '5레인',
            'lanes_6': '6레인',
            'lanes_7': '7레인',
            'lanes_8': '8레인',
            'difficulty': '난이도',
            'easy': '쉬움',
            'normal': '보통',
            'hard': '어려움',
            'note_count': '노트 수',
            'drill_section_title': '실전형 드릴',
            'drill_speed': '⚡ 순발력',
            'drill_complex': '🎯 복합 패턴',
            'custom_preset_placeholder': '내 프리셋 선택…',
            'custom_preset_load': '불러오기',
            'custom_preset_save': '저장',
            'custom_preset_delete': '삭제',
            'custom_preset_name_prompt': '프리셋 이름을 입력하세요.',
            'custom_preset_delete_confirm': '"{name}" 프리셋을 삭제할까요?',
            'settings_section_density': '노트 밀도',
            'settings_section_density_tip': "노트가 화면에 얼마나 자주 나올지를 조절합니다. 노트 수는 위쪽 '노트 수' 입력칸에서 따로 정할 수 있어요.",
            'settings_section_complexity': '패턴 복잡도',
            'settings_section_complexity_tip': "여러 노트가 동시에 나오는 '동시타'가 얼마나 자주, 몇 개씩, 어떤 타입으로 섞여 나올지를 조절합니다.",
            'settings_section_special': '특수 노트',
            'settings_section_special_tip': "누르고 있어야 하는 '롱노트'와, 누르면 안 되는 '가짜 노트'가 나올 확률을 조절합니다.",
            'calibration_open_btn': '🎯 탭 타이밍 자동 보정 (다시 측정)',
            'calibration_title': '탭 타이밍 자동 보정',
            'calibration_back': '← 설정',
            'calibration_intro_desc': '0.5초 간격으로 나오는 신호(깜빡임 + 소리)에 맞춰 20여 회 탭하면, 평소 얼마나 빠르거나 느리게 입력되는 경향이 있는지 측정해서 판정 보정값을 자동으로 맞춰줍니다.',
            'calibration_mode_general': '⌨️ 키보드 / 마우스',
            'calibration_mode_general_desc': '평소 플레이하는 키를 누르거나 화면을 클릭해서 박자에 맞춰 탭합니다.',
            'calibration_mode_touch': '👆 터치',
            'calibration_mode_touch_desc': '화면을 손가락으로 직접 두드려서 박자에 맞춰 탭합니다.',
            'calibration_intro_note': '언제든 다시 측정할 수 있으니 컨디션이 다른 날 한 번씩 다시 해봐도 좋습니다.',
            'calibration_tap_zone_label': '박자에 맞춰 여기를 탭하세요',
            'calibration_cancel': '취소',
            'calibration_too_many_missed': '놓친 박자가 너무 많아서 결과가 정확하지 않을 수 있어요. 다시 측정해보는 걸 권장합니다.',
            'calibration_retry': '다시 측정',
            'calibration_apply': '이 값으로 보정하기',
            'calibration_failed_headline': '측정에 실패했어요',
            'calibration_direction_late': '느리게',
            'calibration_direction_early': '빠르게',
            'calibration_direction_ontime': '거의 정확하게',
            'calibration_result_headline': '평균 {ms}ms {direction} 누르는 경향이 있습니다.',
            'calibration_result_detail': '유효 박자 {count}/{total}회 기준 (중앙값 {median}ms). 이 값으로 보정할까요?',
            'calibration_applied_message': '보정값이 적용되었습니다.',
            'session_history_title': '최근 5회 추이',
            'custom_difficulty_label': '커스텀',
            'drill_recommendation_complex': '최근 {count}회 연습에서 레인별 미스율 편차가 컸어요(±{std}%p) — 손이 꼬이기 쉬운 구간에 대응하는 드릴을 추천합니다.',
            'drill_recommendation_speed': '최근 {count}회 연습 정확도가 평균 {accuracy}%로 다소 낮아요 — 빠르게 쏟아지는 노트에 반응하는 힘을 기르는 드릴을 추천합니다.',
            'drill_recommendation_cta': '{drill} 시작하기',
            'load_chart': '차트 불러오기',
            'load_music': '음악 불러오기',
            
            // 환경설정
            'settings': '환경설정',
            'play_tab': '플레이',
            'appearance': '모양',
            'controls': '조작',
            'editor_settings_tab': '에디터',
            'keybind_select_lanes': '레인 수 선택',
            'keybind_instruction': '레인 수마다 키를 따로 지정할 수 있습니다. 위에서 레인 수를 고른 뒤 아래에서 키를 바꿔보세요.',
            'help': '도움말',
            'etc': '기타',
            'music_volume': '음악 볼륨',
            'sfx_volume': '효과음 볼륨',
            'show_gameplay_image': '게임플레이 시 이미지 표시',
            'lane_background': '레인 배경',
            'lane_highlight_on_input': '입력 시 레인 하이라이트',
            'auto_hide_ui_on_play': '게임플레이 시 우측 화면 숨기기',
            'use_default_fall_speed': '플레이어 기본 하강 속도 지정',
            'default_fall_speed_value': '기본 하강 속도',
            'input_offset': '판정 보정 (입력 지연 보정)',
            'touch_input_offset': '터치 입력 추가 보정',
            'show': '보이기',
            'hide': '숨기기',
            'back': '돌아가기',
            
            // 언어 설정
            'language': '언어 / Language',
            'debug_mode': '디버그 모드',
            'debug_overlay': '디버그 오버레이 활성화',
            'info': '정보',
            
            // 모양 설정
            'note_direction': '노트 방향',
            'scroll_down': '다운스크롤',
            'scroll_up': '업스크롤',
            'note_shape': '노트 모양',
            'bar_shape': '막대형',
            'circle_shape': '원형',
            'judgement_position': '노트 판정 위치',
            'judgement_position_default': '기본',
            'judgement_position_low': '아래',
            'color_mode': '색상 모드',
            'note_type_color': '노트별 색상',
            'lane_color': '레인별 색상',
            'note_colors': '노트 타입별 색상',
            'tap_note': '기본 노트',
            'long_note': '롱 노트',
            'false_note': '가짜 노트',
            'preview': '미리보기',
            'save': '저장',
            'reset': '초기화',
            'apply': '적용',
            // 테마
            'theme':       '테마',
            'theme_dark':  '🌙 다크',
            'theme_blue':  '🔵 블루 (기본)',
            'theme_light': '☀️ 라이트',
            
            // 조작 설정
            'left_4': '좌측 4',
            'left_3': '좌측 3',
            'left_2': '좌측 2',
            'left_1': '좌측 1',
            'center': '중앙',
            'right_1': '우측 1',
            'right_2': '우측 2',
            'right_3': '우측 3',
            'right_4': '우측 4',
            
            // 게임 중
            'playing': '플레이 중',
            'paused': '일시정지',
            'score': '점수',
            'combo': '콤보',
            'judgement': '판정',
            'perfect': 'PERFECT',
            'good': 'GOOD',
            'bad': 'BAD',
            'miss': 'MISS',
            'pause': '일시 정지',
            'resume': '계속하기',
            'give_up': '포기하기',
            
            // 결과 화면
            'game_result': '게임 결과',
            'final_score': '최종 점수',
            'rank': '랭크',
            'accuracy': '정확도',
            'max_combo': '최대 콤보',
            'timing_tendency': '타이밍 경향',
            'timing_distribution': '타이밍 분포',
            'early': '빠름',
            'late': '느림',
            'lane_miss_rate': '레인별 미스율',
            'lane': '레인',
            'retry': '다시 하기',
            'main_menu': '메인으로 돌아가기',
            
            // 에디터
            'editor_title': '차트 에디터',
            
            // 메시지
            'settings_applied': '모양 설정이 적용되었습니다.',
            'settings_reset': '모양 설정이 초기화되었습니다.',
            'preset_saved': '프리셋에 저장되었습니다.',
            'key_saved': '키 설정이 저장되었습니다.',
            'language_changed': '언어가 변경되었습니다.',
        },
        
        en: {
            // Main screen
            'game_title': 'TheBeat',
            'start_game': 'Start Game',
            'editor': 'Editor',
            'game_mode': 'Game Mode',
            'random_mode': 'Random',
            'music_mode': 'Music',
            'lanes': 'Lanes',
            'lanes_4': '4 Lanes',
            'lanes_5': '5 Lanes',
            'lanes_6': '6 Lanes',
            'lanes_7': '7 Lanes',
            'lanes_8': '8 Lanes',
            'difficulty': 'Difficulty',
            'easy': 'Easy',
            'normal': 'Normal',
            'hard': 'Hard',
            'note_count': 'Note Count (Random)',
            'drill_section_title': 'Real-World Drills',
            'drill_speed': '⚡ Reflex',
            'drill_complex': '🎯 Complex Pattern',
            'custom_preset_placeholder': 'Select my preset…',
            'custom_preset_load': 'Load',
            'custom_preset_save': 'Save',
            'custom_preset_delete': 'Delete',
            'custom_preset_name_prompt': 'Enter a name for this preset.',
            'custom_preset_delete_confirm': 'Delete preset "{name}"?',
            'settings_section_density': 'Note Density',
            'settings_section_density_tip': "Controls how often notes appear on screen. Note count is set separately in the 'Note Count' field above.",
            'settings_section_complexity': 'Pattern Complexity',
            'settings_section_complexity_tip': "Controls how often, how many, and what types of notes appear together as simultaneous hits.",
            'settings_section_special': 'Special Notes',
            'settings_section_special_tip': "Controls the chance of long notes (hold) and false notes (must not press) appearing.",
            'calibration_open_btn': '🎯 Auto-Calibrate Tap Timing (Re-measure)',
            'calibration_title': 'Tap Timing Calibration',
            'calibration_back': '← Settings',
            'calibration_intro_desc': 'Tap along with about 20 signals (a flash + a beep) spaced 0.5s apart, and we\'ll measure whether you tend to tap early or late, then set your offset automatically.',
            'calibration_mode_general': '⌨️ Keyboard / Mouse',
            'calibration_mode_general_desc': 'Tap along using the keys you normally play with, or by clicking the screen.',
            'calibration_mode_touch': '👆 Touch',
            'calibration_mode_touch_desc': 'Tap along by touching the screen directly with your finger.',
            'calibration_intro_note': 'You can re-measure any time — it\'s fine to redo it on a different day if you\'re feeling off.',
            'calibration_tap_zone_label': 'Tap here in time with the beat',
            'calibration_cancel': 'Cancel',
            'calibration_too_many_missed': 'You missed too many beats for an accurate result. We recommend measuring again.',
            'calibration_retry': 'Re-measure',
            'calibration_apply': 'Apply this offset',
            'calibration_failed_headline': 'Measurement failed',
            'calibration_direction_late': 'late',
            'calibration_direction_early': 'early',
            'calibration_direction_ontime': 'almost exactly on time',
            'calibration_result_headline': 'On average you tap {ms}ms {direction}.',
            'calibration_result_detail': 'Based on {count}/{total} valid beats (median {median}ms). Apply this offset?',
            'calibration_applied_message': 'Offset applied.',
            'session_history_title': 'Last 5 sessions',
            'custom_difficulty_label': 'Custom',
            'drill_recommendation_complex': 'Your lane miss rates varied a lot over the last {count} sessions (±{std}pp) — try a drill for hand-crossing situations.',
            'drill_recommendation_speed': 'Your average accuracy over the last {count} sessions was {accuracy}% — try a drill for reacting to fast single notes.',
            'drill_recommendation_cta': 'Start {drill}',
            'load_chart': 'Load Chart',
            'load_music': 'Load Music',
            
            // Settings
            'settings': 'Settings',
            'play_tab': 'Play',
            'appearance': 'Appearance',
            'controls': 'Controls',
            'editor_settings_tab': 'Editor',
            'keybind_select_lanes': 'Select Lane Count',
            'keybind_instruction': 'You can set different keys for each lane count. Pick a lane count above, then rebind keys below.',
            'help': 'Help',
            'etc': 'Etc',
            'music_volume': 'Music Volume',
            'sfx_volume': 'SFX Volume',
            'show_gameplay_image': 'Show Image During Gameplay',
            'lane_background': 'Lane Background',
            'lane_highlight_on_input': 'Lane Highlight on Input',
            'auto_hide_ui_on_play': 'Hide Right Panel During Gameplay',
            'use_default_fall_speed': 'Set Default Fall Speed',
            'default_fall_speed_value': 'Default Fall Speed',
            'input_offset': 'Judgement Offset (Input Delay Correction)',
            'touch_input_offset': 'Extra Touch Input Offset',
            'show': 'Show',
            'hide': 'Hide',
            'back': 'Back',
            
            // Language settings
            'language': '언어 / Language',
            'debug_mode': 'Debug Mode',
            'debug_overlay': 'Enable Debug Overlay',
            'info': 'Information',
            
            // Appearance settings
            'note_direction': 'Note Direction',
            'scroll_down': 'Downscroll',
            'scroll_up': 'Upscroll',
            'note_shape': 'Note Shape',
            'bar_shape': 'Bar',
            'circle_shape': 'Circle',
            'judgement_position': 'Judgement Line Position',
            'judgement_position_default': 'Default',
            'judgement_position_low': 'Lower',
            'color_mode': 'Color Mode',
            'note_type_color': 'By Note Type',
            'lane_color': 'By Lane',
            'note_colors': 'Note Type Colors',
            'tap_note': 'Tap Note',
            'long_note': 'Long Note',
            'false_note': 'False Note',
            'preview': 'Preview',
            'save': 'Save',
            'reset': 'Reset',
            'apply': 'Apply',
            // Theme
            'theme':       'Theme',
            'theme_dark':  '🌙 Dark',
            'theme_blue':  '🔵 Blue (Default)',
            'theme_light': '☀️ Light',
            
            // Control settings
            'left_4': 'Left 4',
            'left_3': 'Left 3',
            'left_2': 'Left 2',
            'left_1': 'Left 1',
            'center': 'Center',
            'right_1': 'Right 1',
            'right_2': 'Right 2',
            'right_3': 'Right 3',
            'right_4': 'Right 4',
            
            // In game
            'playing': 'Playing',
            'paused': 'Paused',
            'score': 'Score',
            'combo': 'Combo',
            'judgement': 'Judgement',
            'perfect': 'PERFECT',
            'good': 'GOOD',
            'bad': 'BAD',
            'miss': 'MISS',
            'pause': 'Pause',
            'resume': 'Resume',
            'give_up': 'Give Up',
            
            // Result screen
            'game_result': 'Game Result',
            'final_score': 'Final Score',
            'rank': 'Rank',
            'accuracy': 'Accuracy',
            'max_combo': 'Max Combo',
            'timing_tendency': 'Timing Tendency',
            'timing_distribution': 'Timing Distribution',
            'early': 'Early',
            'late': 'Late',
            'lane_miss_rate': 'Miss Rate by Lane',
            'lane': 'Lane',
            'retry': 'Retry',
            'main_menu': 'Back to Menu',
            
            // Editor
            'editor_title': 'Chart Editor',
            
            // Messages
            'settings_applied': 'Settings applied.',
            'settings_reset': 'Settings reset.',
            'preset_saved': 'Preset saved.',
            'key_saved': 'Key settings saved.',
            'language_changed': 'Language changed.',
        }
    },
    
    init() {
        // 로컬 스토리지에서 언어 설정 불러오기
        const savedLang = localStorage.getItem('theBeat_language');
        if (savedLang && this.translations[savedLang]) {
            this.currentLang = savedLang;
        }
        
        // 초기 번역 적용
        this.applyTranslations();
        
        // 언어 버튼 이벤트 리스너
        const koBtn = document.getElementById('lang-ko');
        const enBtn = document.getElementById('lang-en');
        
        if (koBtn) {
            koBtn.addEventListener('click', () => this.setLanguage('ko'));
        }
        if (enBtn) {
            enBtn.addEventListener('click', () => this.setLanguage('en'));
        }
        
        // 초기 버튼 상태 설정
        this.updateButtonStates();
    },
    
    setLanguage(lang) {
        if (!this.translations[lang]) return;
        
        this.currentLang = lang;
        localStorage.setItem('theBeat_language', lang);
        
        this.applyTranslations();
        this.updateButtonStates();
        
        UI.showMessage('settings', this.t('language_changed'));
    },
    
    applyTranslations() {
        // data-i18n 속성을 가진 모든 요소 번역
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.translations[this.currentLang][key];
            if (translation) {
                // 입력 요소의 placeholder
                if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                    el.placeholder = translation;
                } else {
                    el.textContent = translation;
                }
            }
        });

        // ?-아이콘 툴팁(data-tooltip)도 언어에 맞게 갱신 — data-i18n-tooltip에 번역 키를 지정한
        // 요소만 대상으로 하고, 나머지 개별 슬라이더 툴팁은 아직 한국어 텍스트만 있다.
        const tooltipElements = document.querySelectorAll('[data-i18n-tooltip]');
        tooltipElements.forEach(el => {
            const key = el.getAttribute('data-i18n-tooltip');
            const translation = this.translations[this.currentLang][key];
            if (translation) {
                el.setAttribute('data-tooltip', translation);
            }
        });
    },
    
    updateButtonStates() {
        const koBtn = document.getElementById('lang-ko');
        const enBtn = document.getElementById('lang-en');
        
        if (koBtn && enBtn) {
            if (this.currentLang === 'ko') {
                koBtn.classList.add('active');
                enBtn.classList.remove('active');
            } else {
                koBtn.classList.remove('active');
                enBtn.classList.add('active');
            }
        }
    },
    
    // params: { name: 'value', ... } — 번역 문자열 안의 {name} 같은 자리표시자를 치환한다.
    t(key, params) {
        const text = this.translations[this.currentLang][key] || key;
        if (!params) return text;
        return Object.keys(params).reduce((acc, k) => acc.split(`{${k}}`).join(params[k]), text);
    }
};