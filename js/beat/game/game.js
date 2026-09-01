const Game = {
    state: {
        gameState: 'menu',
        settings: {
            mode: 'random',
            difficulty: 'normal',
            noteSpeed: 0, // 노트 하강 속도
            noteSpawnSpeed: CONFIG.NOTE_SPAWN_SPEED.normal, // 노트 생성 속도
            dongtaProbability: CONFIG.SIMULTANEOUS_NOTE_PROBABILITY.normal,
            maxSimultaneousNotes: CONFIG.MAX_SIMULTANEOUS_NOTES.normal,
            dongtaNoteTypeProbabilities: CONFIG.SIMULTANEOUS_NOTE_TYPE_PROBABILITY.normal,
            longNoteProbability: CONFIG.LONG_NOTE_PROBABILITY.normal,
            falseNoteProbability: 0,
            lanes: 4,
            musicSrc: null,
            musicFileObject: null,
            musicVolume: 100,
            sfxVolume: 100,
            // 게임플레이 중 노래 커버 이미지를 배경으로 표시할 불투명도 (0~100). 새로고침해도
            // 유지되도록 localStorage에서 미리 읽어둔다 (계정 볼륨과 달리 계정 연동은 하지 않음).
            // 예전 버전(체크박스)의 저장값이 남아있으면 꺼짐→0, 켜짐→100으로 이어받는다.
            gameplayImageOpacity: (() => {
                const stored = localStorage.getItem('theBeat_gameplayImageOpacity');
                if (stored !== null) {
                    const parsed = parseInt(stored, 10);
                    return Number.isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
                }
                return localStorage.getItem('theBeat_showGameplayImage') === 'false' ? 0 : 100;
            })(),
            // 레인 영역에 검은색~회색 톤의 배경을 얼마나 진하게 표시할지 (0~100).
            laneBackgroundOpacity: (() => {
                const stored = localStorage.getItem('theBeat_laneBackgroundOpacity');
                if (stored === null) return 30;
                const parsed = parseInt(stored, 10);
                return Number.isNaN(parsed) ? 30 : Math.max(0, Math.min(100, parsed));
            })(),
            // 입력 시 레인이 하얗게 하이라이트되는 피드백을 표시할지 여부
            laneHighlightOnInput: localStorage.getItem('theBeat_laneHighlightOnInput') !== 'false',
            // 게임플레이 중 우측 메뉴/점수 패널(#ui-area)을 자동으로 접을지 여부. 기본값 false(끔).
            autoHideUiOnPlay: localStorage.getItem('theBeat_autoHideUiOnPlay') === 'true',
            // 플레이어가 지정한 "기본 하강 속도"를 쓸지 여부. 켜져 있으면 비트맵 자체의 하강 속도
            // 대신 이 값을 쓴다 — 단, 비트맵이 "이 맵 전용 하강 속도 사용"으로 저장된 경우는 예외
            // (그 비트맵은 항상 자신의 하강 속도를 유지한다). Game.loadChartNotes()에서 적용.
            useDefaultFallSpeed: localStorage.getItem('theBeat_useDefaultFallSpeed') === 'true',
            defaultFallSpeedValue: (() => {
                const stored = localStorage.getItem('theBeat_defaultFallSpeedValue');
                const parsed = parseInt(stored, 10);
                return Number.isNaN(parsed) ? 7 : Math.max(1, Math.min(20, parsed));
            })(),
            // 입력 판정 보정(ms). 기기/브라우저마다 입력이 인지되는 시점에 지연이 있을 수 있어
            // (예: 오디오 출력 지연) 값을 올릴수록 입력을 그만큼 더 빨리 인식된 것으로 쳐서 판정한다.
            // 키보드/마우스에는 이 값만 적용되고, 터치에는 아래 touchInputOffsetMs가 추가로 더해진다.
            inputOffsetMs: (() => {
                const stored = localStorage.getItem('theBeat_inputOffsetMs');
                const parsed = parseInt(stored, 10);
                return Number.isNaN(parsed) ? 0 : Math.max(-300, Math.min(300, parsed));
            })(),
            // 터치 입력 전용 추가 보정(ms). iOS의 Chrome 등 WKWebView 기반 브라우저는
            // 터치 이벤트가 JS로 전달되기까지 자체 지연이 더 붙는 경우가 있어, 위의 일반
            // 보정과 별도로 터치에만 추가로 적용할 수 있게 분리했다.
            touchInputOffsetMs: (() => {
                const stored = localStorage.getItem('theBeat_touchInputOffsetMs');
                const parsed = parseInt(stored, 10);
                return Number.isNaN(parsed) ? 0 : Math.max(-300, Math.min(300, parsed));
            })(),
            bpm: 120,
            startTimeOffset: 0, // 채보 박자 계산 기준점 (bpm/noteoffset 등 노트 타이밍용)
            songStartOffset: 0, // 실제 오디오 재생을 시작할 지점 (종합 창의 "시작(초)")
            // 새로고침해도 유지되도록 config.js가 localStorage에서 미리 읽어둔 값으로 초기화한다.
            userKeyMappingsByLanes: CONFIG.PERSISTED_USER_KEY_MAPPINGS || null,
            requiredSongName: null,
        },
        keyMapping: [],
        activeLanes: [],
        notes: [],
        score: 0,
        combo: 0,
        maxCombo: 0,
        judgements: { perfect: 0, good: 0, bad: 0, miss: 0 },
        gameStartTime: 0,
        animationFrameId: null,
        totalNotes: 0,
        processedNotes: 0,
        isPaused: false,
        pauseStartTime: 0,
        totalPausedTime: 0,
        previousScreen: 'menu',
        countdownIntervalId: null,
        unprocessedNoteIndex: 0,
        chartData: null,
        triggers: [],       // 구간별 BPM/하강 속도 변경 트리거
        baseBpm: 120,
        baseNoteSpeed: 6,

        // ── 멀티플레이 관전(Phase 5): 진행 중 상대 점수/콤보 broadcast + 미니 HUD ──────
        _multiplayerActive: false,   // 현재 판이 멀티플레이인지
        _multiplayerUserId: null,    // 내 user_id (progress/finish broadcast의 발신자 식별용)
        _multiplayerOpponents: [],   // [{ user_id, nickname }] — 나를 제외한 같은 방 참가자
        _multiplayerProgress: {},    // { [user_id]: { score, accuracy, combo } } — 상대들의 마지막 수신값
        _multiplayerLastBroadcastAt: 0,
        _multiplayerProgressHandler: null,

        // ── 멀티플레이 결과 비교(Phase 6): 종료 시 finish broadcast + 결과 화면 비교 ────
        _multiplayerRoomId: null,        // beat_rooms.id — 결과 화면에서 room 상태 정리에 사용
        _multiplayerHostId: null,        // beat_rooms.host_id — 결과 화면에서 재도전 버튼을 호스트에게만 보여주는 데 사용
        _multiplayerResults: {},         // { [user_id]: { finalScore, finalCombo, judgements, self? } }
        _multiplayerFinishHandler: null,
        _multiplayerPresenceHandler: null,
        _multiplayerSelfFinished: false,
    },

    // ─── Canvas 렌더러 ───────────────────────────────────────────────────────
    canvas: {
        el: null,   // <canvas> 엘리먼트
        ctx: null,  // 2D 컨텍스트
        w: 0,       // 현재 캔버스 너비
        h: 0,       // 현재 캔버스 높이

        LANE_BORDER_COLOR: '#4a5568',
        JUDGEMENT_LINE_Y_FROM_BOTTOM: 100,      // 판정선 하단 여백(px) — '기본' 위치
        JUDGEMENT_LINE_Y_FROM_BOTTOM_LOW: 20,   // 판정선 하단 여백(px) — '아래' 위치
        JUDGEMENT_LINE_H: 4,
        NOTE_BAR_H: 25,
        NOTE_CIRCLE_D: 90,  // 원형 노트 지름
        NOTE_RADIUS: 5,     // 바 노트 모서리 둥글기

        init() {
            this.el = DOM.gameCanvas;
            this.ctx = this.el.getContext('2d');
        },

        // 레인 수·게임 영역 크기에 맞게 캔버스 크기 동기화
        resize(laneCount) {
            const laneW = 100;
            this.w = laneCount * laneW;
            this.h = DOM.lanesContainer.clientHeight || DOM.gameArea.clientHeight;
            // devicePixelRatio 반영으로 Retina/모바일 선명하게
            const dpr = window.devicePixelRatio || 1;
            this.el.width  = this.w * dpr;
            this.el.height = this.h * dpr;
            this.el.style.width  = `${this.w}px`;
            this.el.style.height = `${this.h}px`;

            // 업스크롤: 모든 그리기 로직(다운스크롤 기준 좌표 계산)은 그대로 두고,
            // 캔버스 좌표계 자체를 세로로 뒤집어서 렌더링만 반전시킨다.
            // (판정선 Y는 항상 h - margin으로 계산되지만, 뒤집힌 좌표계에서는
            //  화면상 위쪽에 그려지고, 노트는 아래에서 위로 올라오게 된다)
            const isUpscroll = Appearance.settings.scrollDirection === 'up';
            if (isUpscroll) {
                this.ctx.setTransform(dpr, 0, 0, -dpr, 0, this.h * dpr);
            } else {
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        },

        // 판정선 Y 좌표 (상단 기준). Appearance 설정의 노트 판정 위치(기본/아래)를 반영한다.
        judgementLineY() {
            const margin = Appearance.settings.judgementPosition === 'low'
                ? this.JUDGEMENT_LINE_Y_FROM_BOTTOM_LOW
                : this.JUDGEMENT_LINE_Y_FROM_BOTTOM;
            return this.h - margin;
        },

        // 노트 색상 결정 (Appearance 설정 반영)
        _noteColor(noteType, laneId, isLong) {
            const ap = Appearance.settings;
            if (ap.colorMode === 'lane' && laneId && ap.laneColors[laneId]) {
                return ap.laneColors[laneId];
            }
            if (noteType === 'long_head' || isLong) return ap.colors.long;
            if (noteType === 'false') return ap.colors.false;
            return ap.colors.tap;
        },

        // 레인 배경(경계선) + 판정선 그리기
        drawLaneBackground(laneCount, activeLanes) {
            const ctx = this.ctx;
            const laneW = 100;
            const jY = this.judgementLineY();
            const isCircle = document.body.classList.contains('circle-notes');

            // 레인 구분선
            ctx.strokeStyle = this.LANE_BORDER_COLOR;
            ctx.lineWidth = 1;
            for (let i = 0; i <= laneCount; i++) {
                // 마지막 선(i === laneCount)은 canvas 오른쪽 끝과 겹쳐 잘리므로
                // 0.5px 안쪽으로 당겨서 완전히 표시되게 한다
                const x = (i === laneCount) ? this.w - 0.5 : i * laneW + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.h);
                ctx.stroke();
            }

            // 활성 레인 피드백 (설정에서 끌 수 있음)
            if (Game.state.settings.laneHighlightOnInput) {
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                for (let i = 0; i < laneCount; i++) {
                    if (activeLanes[i]) {
                        ctx.fillRect(i * laneW + 1, 0, laneW - 2, this.h);
                    }
                }
            }

            // 판정선 — 커스터마이징 계획 2단계: Appearance.settings.judgementLineColor를
            // 기준으로 그라데이션/발광 색을 계산한다(기본값은 기존과 동일한 흰색).
            const lineColor = Appearance.settings.judgementLineColor || '#ffffff';
            if (isCircle) {
                // 원형 노트: 레인마다 원형 판정선
                // 커스터마이징 계획 2단계: 노트 크기 배율을 판정선 원 크기에도 반영해
                // 노트와 시각적으로 어긋나지 않게 한다.
                const sizeMul = Appearance.settings.noteSize || 1;
                const scaledCircleD = this.NOTE_CIRCLE_D * sizeMul;
                for (let i = 0; i < laneCount; i++) {
                    const cx = i * laneW + laneW / 2;
                    const cy = jY - scaledCircleD / 2;
                    const r = scaledCircleD / 2;
                    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                    grad.addColorStop(0, Appearance.hexToRgba(lineColor, 0.8));
                    grad.addColorStop(0.5, Appearance.hexToRgba(lineColor, 0.4));
                    grad.addColorStop(1, Appearance.hexToRgba(lineColor, 0.1));
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fill();
                    // 테두리 — 채워진 그라데이션만으로는 원 가장자리가 흐릿하게 퍼져
                    // 경계가 잘 안 보여서, 얇은 테두리선을 하나 둘러 판정 위치를 명확히 한다.
                    ctx.strokeStyle = Appearance.hexToRgba(lineColor, 1);
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            } else {
                // 바 노트: 전체 너비 가로선
                const totalW = laneCount * laneW;
                const grad = ctx.createLinearGradient(0, 0, totalW, 0);
                grad.addColorStop(0,   Appearance.hexToRgba(lineColor, 0.2));
                grad.addColorStop(0.5, Appearance.hexToRgba(lineColor, 0.8));
                grad.addColorStop(1,   Appearance.hexToRgba(lineColor, 0.2));
                ctx.fillStyle = grad;
                ctx.shadowColor = lineColor;
                ctx.shadowBlur  = 10;
                ctx.fillRect(0, jY, totalW, this.JUDGEMENT_LINE_H);
                ctx.shadowBlur = 0;
            }
        },

        // 노트 애니메이션(페이드/스케일) 진행도 계산. 0~1, 1이면 원래 크기/불투명도.
        // note._spawnedAt(최초로 화면에 들어온 시각, updateNotes()에서 기록)이 없으면
        // (예: 게임 재시작 직후 이미 화면 안에 있는 노트) 애니메이션 없이 바로 1을 반환.
        _noteAnimationProgress(note, elapsedTime) {
            const anim = Appearance.settings.noteAnimation;
            if (!anim || anim === 'none' || note._spawnedAt === undefined) return 1;
            const ANIM_DURATION_MS = 220;
            const age = elapsedTime - note._spawnedAt;
            if (age >= ANIM_DURATION_MS) return 1;
            return Math.max(0, Math.min(1, age / ANIM_DURATION_MS));
        },

        // 노트 이미지 스킨(Appearance.settings.noteImages가 아니라 BeatSkinImages 슬롯을
        // 직접 참조 — 폰트와 마찬가지로 이미지는 별도 모듈이 등록소 역할을 한다).
        // 레인별 오버라이드(note-tap@L2 등)가 있으면 그걸, 없으면 종류별 기본값을 쓴다.
        _noteImage(noteType, laneId) {
            if (typeof BeatSkinImages === 'undefined' || !BeatSkinImages.getImage) return null;
            const base = noteType === 'long_head' ? 'note-long' : (noteType === 'false' ? 'note-false' : 'note-tap');
            if (laneId && BeatSkinImages.laneSlotId) {
                const laneImg = BeatSkinImages.getImage(BeatSkinImages.laneSlotId(base, laneId));
                if (laneImg) return laneImg;
            }
            return BeatSkinImages.getImage(base);
        },

        // 노트 한 개 그리기
        // elapsedTime, noteSpeed를 받아 위치를 직접 계산 → _drawH/_drawTop 불일치 버그 원천 제거
        drawNote(note, laneIdMapping, elapsedTime, noteSpeed) {
            if (!note._visible) return;

            const ctx = this.ctx;
            const laneW = 100;
            const laneIndex = note.lane;
            const laneId = laneIdMapping ? laneIdMapping[laneIndex] : null;
            const isCircle = document.body.classList.contains('circle-notes');
            const jY = this.judgementLineY();

            const color = this._noteColor(note.type, laneId, note.type === 'long_head');
            const darkerColor = Appearance.adjustColor(color, -20);

            // 커스터마이징 계획 2단계: 노트 크기 배율(Appearance.settings.noteSize).
            // 기본값 1일 때 기존 NOTE_BAR_H/NOTE_CIRCLE_D와 완전히 동일하게 렌더링된다.
            const sizeMul = Appearance.settings.noteSize || 1;
            const noteBarH   = this.NOTE_BAR_H * sizeMul;
            const noteCircleD = this.NOTE_CIRCLE_D * sizeMul;
            const minH = isCircle ? noteCircleD : noteBarH;

            // 위치/높이 계산
            let topY, bodyH;

            if (note.type === 'long_head') {
                if (note.shrinking && note.tailTime !== undefined) {
                    // 수축 중: 하단을 판정선에 고정하고 남은 duration으로 높이 계산
                    const timeUntilTail = note.tailTime - elapsedTime;
                    const currentDuration = Math.max(0, timeUntilTail);
                    bodyH = Math.max((currentDuration / 10) * noteSpeed, minH);
                    topY  = jY - bodyH;
                } else {
                    // 일반 하강: note.time 기준으로 하단 Y 계산
                    const timeToHit = note.time - elapsedTime;
                    const noteBottomY = jY - (timeToHit * noteSpeed / 10);
                    bodyH = Math.max((note.duration / 10) * noteSpeed, minH);
                    topY  = noteBottomY - bodyH;
                }
            } else {
                // tap / false
                const timeToHit = note.time - elapsedTime;
                const noteBottomY = jY - (timeToHit * noteSpeed / 10);
                bodyH = minH;
                topY  = noteBottomY - bodyH;
            }

            // 애니메이션(페이드/스케일) 적용 준비 — 이미지/도형 드로잉 공통으로 감싼다.
            const animMode = Appearance.settings.noteAnimation;
            const animProgress = this._noteAnimationProgress(note, elapsedTime);
            const cxCommon = laneIndex * laneW + laneW / 2;

            ctx.save();
            if (animMode === 'fade' && animProgress < 1) {
                ctx.globalAlpha = animProgress;
            }
            if (animMode === 'scale' && animProgress < 1 && animProgress > 0) {
                const scaleCx = cxCommon;
                const scaleCy = topY + bodyH / 2;
                ctx.translate(scaleCx, scaleCy);
                ctx.scale(animProgress, animProgress);
                ctx.translate(-scaleCx, -scaleCy);
            } else if (animMode === 'scale' && animProgress <= 0) {
                ctx.restore();
                return; // 스케일 0이면 그리지 않음(음수 크기 drawImage 에러 방지)
            }

            const img = this._noteImage(note.type, laneId);

            if (img && note.type !== 'long_tail') {
                // 이미지 스킨: 캔버스 도형 대신 사용자가 업로드한 이미지를 노트 판정 박스에
                // 맞춰 그린다. 원형/바 모드 모두 (topY, bodyH)로 계산된 같은 박스를 쓴다.
                if (isCircle) {
                    const D = noteCircleD;
                    const R = D / 2;
                    ctx.drawImage(img, cxCommon - R, topY, D, bodyH);
                } else {
                    const x = laneIndex * laneW + 1;
                    const w = laneW - 2;
                    ctx.drawImage(img, x, topY, w, bodyH);
                }
                ctx.restore();
                return;
            }

            if (isCircle) {
                const D = noteCircleD;
                const R = D / 2;
                const cx = cxCommon;

                if (note.type === 'long_head') {
                    const grad = ctx.createLinearGradient(cx - R, topY + bodyH, cx - R, topY);
                    grad.addColorStop(0, darkerColor);
                    grad.addColorStop(1, color);
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(cx, topY + R,         R, Math.PI, 0);
                    ctx.lineTo(cx + R, topY + bodyH - R);
                    ctx.arc(cx, topY + bodyH - R, R, 0, Math.PI);
                    ctx.closePath();
                    ctx.fill();
                } else if (note.type !== 'long_tail') {
                    const cy = topY + R;
                    ctx.beginPath();
                    ctx.arc(cx, cy, R, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    if (note.type === 'false') {
                        ctx.shadowColor = color;
                        ctx.shadowBlur  = 12;
                        ctx.fill();
                        ctx.shadowBlur  = 0;
                    }
                }
            } else {
                const x = laneIndex * laneW + 1;
                const w = laneW - 2;

                if (note.type === 'long_head') {
                    const grad = ctx.createLinearGradient(x, topY + bodyH, x, topY);
                    grad.addColorStop(0, darkerColor);
                    grad.addColorStop(1, color);
                    ctx.fillStyle  = grad;
                    ctx.globalAlpha = (animMode === 'fade' && animProgress < 1) ? ctx.globalAlpha * 0.9 : 0.9;
                    this._roundRect(ctx, x, topY, w, bodyH, this.NOTE_RADIUS);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                } else if (note.type !== 'long_tail') {
                    ctx.fillStyle = color;
                    if (note.type === 'false') {
                        ctx.shadowColor = color;
                        ctx.shadowBlur  = 8;
                    }
                    this._roundRect(ctx, x, topY, w, noteBarH, this.NOTE_RADIUS);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
            ctx.restore();
        },

        // 둥근 사각형 path 헬퍼 (Path2D 미지원 구형 브라우저 대응)
        _roundRect(ctx, x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arcTo(x + w, y,     x + w, y + r,     r);
            ctx.lineTo(x + w, y + h - r);
            ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h);
            ctx.arcTo(x,     y + h, x,     y + h - r, r);
            ctx.lineTo(x,     y + r);
            ctx.arcTo(x,     y,     x + r, y,         r);
            ctx.closePath();
        },

        // 매 프레임 전체 씬 렌더링
        render(notes, laneCount, activeLanes, laneIdMapping, elapsedTime, noteSpeed) {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.w, this.h);
            this.drawLaneBackground(laneCount, activeLanes);
            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (note._visible) {
                    this.drawNote(note, laneIdMapping, elapsedTime, noteSpeed);
                }
            }
        },
    },
    // ────────────────────────────────────────────────────────────────────────

    // 트리거 전환 기본 소요 시간(ms) — 트리거에 개별 transitionMs가 없을 때(구버전 차트) 사용하는 기본값
    TRIGGER_TRANSITION_MS: 700,

    // 특정 시점 기준으로, 몇 번째 트리거가 적용 중인지 인덱스를 찾는다.
    // (-1이면 아직 첫 트리거에 도달하지 않음)
    _findActiveTriggerIndex(elapsedTime) {
        const triggers = this.state.triggers;
        if (!triggers || triggers.length === 0) return -1;
        let idx = -1;
        for (let i = 0; i < triggers.length; i++) {
            if (triggers[i].time <= elapsedTime) idx = i;
            else break; // triggers는 시간순 정렬되어 있음
        }
        return idx;
    },

    // 특정 시점에 적용 중인 트리거(가장 최근에 지난 트리거)를 찾는다.
    // 트리거가 없거나 아직 첫 트리거에 도달하지 않았으면 null.
    getActiveTrigger(elapsedTime) {
        const idx = this._findActiveTriggerIndex(elapsedTime);
        return idx >= 0 ? this.state.triggers[idx] : null;
    },

    // 트리거에 따라 현재 BPM/하강 속도를 갱신한다.
    // 트리거 시점부터 TRIGGER_TRANSITION_MS 동안 이전 값 → 목표 값으로 부드럽게(ease-in-out) 전환한다.
    applyActiveTrigger(elapsedTime) {
        const triggers = this.state.triggers;
        if (!triggers || triggers.length === 0) return;

        const base = { bpm: this.state.baseBpm, fallSpeed: this.state.baseNoteSpeed };
        const idx = this._findActiveTriggerIndex(elapsedTime);

        const target = idx >= 0 ? triggers[idx] : base;
        const from   = idx >= 1 ? triggers[idx - 1] : base;
        const transitionStart = idx >= 0 ? triggers[idx].time : 0;

        const progress = Math.min(1, Math.max(0, (elapsedTime - transitionStart) / (target.transitionMs ?? this.TRIGGER_TRANSITION_MS)));
        // ease-in-out (급가속/급감속 없이 부드럽게 목표 속도에 도달)
        const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        this.state.settings.bpm       = from.bpm       + (target.bpm       - from.bpm)       * eased;
        this.state.settings.noteSpeed = from.fallSpeed + (target.fallSpeed - from.fallSpeed) * eased;
    },

    resetState() {
        this.state.score = 0;
        this.state.combo = 0;
        this.state.maxCombo = 0;
        this.state.judgements = { perfect: 0, good: 0, bad: 0, miss: 0 };
        // 판정 타이밍 편향(빠름/느림) 누적 — 실제로 입력이 들어온 판정(perfect/good/bad)에서만
        // 부호 있는 시간차(note.time - elapsedTime)를 집계한다. 자동 MISS(입력 없음)는 타이밍
        // 정보가 없으므로 제외.
        this.state.earlyLateStats = { early: 0, late: 0 };
        // 판정 타이밍 분포 그래프용 — 실제 입력 판정(perfect/good/bad)의 signedDiffMs를 발생 순서대로 누적.
        this.state.timingHits = [];
        // 레인별 미스율 집계 — { [laneIndex]: { total, miss } }. 판정이 실제로 일어난 레인만 채워진다.
        this.state.laneStats = {};
        this.state.processedNotes = 0;
        this.state.isPaused = false;
        this.state.totalPausedTime = 0;
        this.state.unprocessedNoteIndex = 0;
        this.state.settings.requiredSongName = null;
        this.state.animationFrameId = null;
        this.state.countdownIntervalId = null;
        this.state.audioReady = false;
    },

    // 커스터마이징 계획 2단계: 카운트다운 숫자(3/2/1/START) 이미지 스킨. runCountdown()/
    // runSyncedCountdown() 둘 다 여기를 거친다. num: 3/2/1 또는 0(=START). BeatSkinImages에
    // 해당 슬롯 이미지가 없으면 기존처럼 텍스트를 그대로 쓴다.
    renderCountdownFrame(countdownEl, num) {
        const slotId = num > 0 ? `countdown-${num}` : 'countdown-start';
        const imgUrl = (typeof BeatSkinImages !== 'undefined' && BeatSkinImages.getURL) ? BeatSkinImages.getURL(slotId) : null;
        if (imgUrl) {
            countdownEl.textContent = '';
            const img = document.createElement('img');
            img.src = imgUrl;
            img.alt = num > 0 ? String(num) : 'START';
            countdownEl.appendChild(img);
        } else {
            countdownEl.textContent = num > 0 ? String(num) : 'START!';
        }
    },

    runCountdown(onComplete) {
        this.cancelCountdown();
        let count = 3;
        const countdownEl = DOM.countdownTextEl;
        const tick = () => {
            countdownEl.classList.remove('show');
            void countdownEl.offsetWidth;
            if (count >= 0) {
                this.renderCountdownFrame(countdownEl, count);
                if (count > 0) {
                    Audio.playCountdownTick();
                } else {
                    Audio.playCountdownStart();
                }
                countdownEl.classList.add('show');
                count--;
            } else {
                this.cancelCountdown();
                onComplete();
            }
        };
        tick();
        this.state.countdownIntervalId = setInterval(tick, 1000);
    },

    // targetPerfTime(이 클라이언트의 performance.now() 기준 목표 시작 시각)에 맞춰
    // 3-2-1-START! 를 표시한다. runCountdown과 달리 고정 1초 간격이 아니라
    // "목표 시각까지 남은 시간"을 기준으로 각 틱의 발동 시점을 미리 계산해 예약한다 —
    // 그래야 브로드캐스트 수신 지연이 제각각이어도 화면 카운트다운이 실제 오디오 시작(syncTarget)과
    // 항상 정확히 맞아떨어진다.
    runSyncedCountdown(targetPerfTime, onComplete) {
        this.cancelCountdown();
        const countdownEl = DOM.countdownTextEl;

        const showTick = (num) => {
            countdownEl.classList.remove('show');
            void countdownEl.offsetWidth;
            this.renderCountdownFrame(countdownEl, num);
            if (num > 0) {
                Audio.playCountdownTick();
            } else {
                Audio.playCountdownStart();
            }
            countdownEl.classList.add('show');
        };

        const now = performance.now();
        const remainingMs = targetPerfTime - now;
        const timers = [3, 2, 1, 0].map(num =>
            setTimeout(() => showTick(num), Math.max(0, remainingMs - num * 1000))
        );
        timers.push(setTimeout(() => {
            this.cancelCountdown();
            onComplete();
        }, Math.max(0, remainingMs)));

        this._syncCountdownTimers = timers;
    },

    cancelCountdown() {
        if (this.state.countdownIntervalId) {
            clearInterval(this.state.countdownIntervalId);
            this.state.countdownIntervalId = null;
        }
        if (this._syncCountdownTimers) {
            this._syncCountdownTimers.forEach(id => clearTimeout(id));
            this._syncCountdownTimers = null;
        }
        DOM.countdownTextEl.classList.remove('show');
    },

    // opts.syncStartPerfTime: 멀티플레이 동시 시작 시, 이 클라이언트의 performance.now() 기준
    // 목표 시작 시각. 주어지면 고정 4초 카운트다운 대신 이 시각에 맞춰 오디오를 예약하고
    // 화면 카운트다운도 여기 맞춘다(runSyncedCountdown). 생략하면 기존 동작(로컬 4초 카운트다운) 그대로.
    async start(opts = {}) {
        await Audio.start();
        // Fix (iPad 판정 오류): 실제 곡 재생에 쓰이는 AudioEngine의 AudioContext는
        // Tone.js(Audio.start)의 AudioContext와 별개다. 기존에는 이 컨텍스트가
        // 카운트다운이 끝난 뒤(사용자 제스처와 무관한 시점) play() 안에서야 처음 resume()됐는데,
        // iOS/iPadOS Safari는 오토플레이 정책이 엄격해서 제스처 시점에서 몇 초 지난 뒤의
        // resume()은 지연되거나 불안정하게 동작할 수 있다. 이게 원인이 되어 실제로 소리가
        // 나오기 시작하는 시점과 게임 내부 시계(AudioEngine.currentTime)가 어긋나면,
        // 터치/키보드 입력 자체는 정상이어도 판정만 이상해 보이는 증상이 생긴다.
        // 사용자가 "시작"을 누른 이 시점(제스처 콜스택 안)에 곧바로 resume해두면
        // 4초 카운트다운이 끝나기 전에 컨텍스트가 이미 안정적으로 활성화된 상태가 된다.
        try { await AudioEngine.resumeContext(); } catch (e) { /* 무시 — play() 시점에 재시도됨 */ }
        this.resetState();
        resetPlayingScreenUI();

        if (this.state.settings.mode === 'random') {
            this.generateRandomNotes();
        } else { // Music Mode
            if (!this.state.chartData) {
                UI.showMessage('menu', '뮤직 모드를 시작하려면 차트 파일을 먼저 불러와주세요.');
                return;
            }
            if (!this.state.settings.musicFileObject && !this.state.settings.musicSrc) {
                UI.showMessage('menu', '뮤직 모드를 시작하려면 음악 파일을 먼저 불러와주세요.');
                return;
            }
            this.prepareNotesFromChartData();
        }

        this.setupLanes();

        // Canvas 초기화 (레인 생성 후 크기 확정)
        this.canvas.init();
        this.canvas.resize(this.state.settings.lanes);

        UI.showScreen('playing');
        UI.updateScoreboard();
        // HUD 초기값 표시 — 실패해도 게임 시작 흐름에 영향 없도록 격리
        try {
            const lastNote = this.state.notes.length ? this.state.notes[this.state.notes.length - 1] : null;
            UI.updateHud(lastNote ? lastNote.time : 0, 100);
        } catch (hudErr) {
            Debugger.logError(hudErr, 'Game.start:hud');
        }
        this.state.gameState = 'countdown';
        this.state.audioReady = false; // Fix 2: 오디오가 실제로 진행 중일 때만 오디오 클럭 사용

        if (this.state.settings.mode === 'music') {
            if (this.state.settings.musicFileObject) {
                const musicUrl = URL.createObjectURL(this.state.settings.musicFileObject);
                DOM.musicPlayer.src = musicUrl;
            } else if (this.state.settings.musicSrc) {
                // 같은 URL이면 재할당하지 않는다 — AudioEngine의 src setter는 할당될 때마다
                // 무조건 버퍼를 버리고 fetch+decode를 처음부터 다시 하므로, 같은 곡으로
                // restartCurrentChart()(길게 눌러 즉시 재시작)를 반복 호출할 때마다 매번
                // 다운로드+디코딩이 새로 걸려 "즉시" 재시작이 실제로는 느려지는 문제가 있었다.
                // 이미 로드된 같은 src라면 기존 버퍼를 그대로 재사용한다.
                if (DOM.musicPlayer.src !== this.state.settings.musicSrc) {
                    DOM.musicPlayer.src = this.state.settings.musicSrc;
                }
            }

            // AudioEngine은 src 할당 시점에 이미 fetch+decode를 시작하므로,
            // 카운트다운 4초 동안 디코딩이 끝나 재생 시작 시 버퍼링 지연이 없다.
            // (기존의 "미리 play 후 pause" 워밍업 트릭은 더 이상 필요 없음)
            DOM.musicPlayer.currentTime = this.state.settings.songStartOffset || 0;
        }

        const COUNTDOWN_DURATION_MS = 4000;
        const syncTarget = opts.syncStartPerfTime != null ? opts.syncStartPerfTime : null;
        this.state.gameStartTime = syncTarget != null ? syncTarget : (performance.now() + COUNTDOWN_DURATION_MS);

        this.loop(performance.now());

        if (syncTarget != null) {
            // 멀티플레이 동시 시작: 화면 카운트다운의 타이머 지터와 무관하게, 지금 이 순간
            // AudioContext의 샘플 단위 클럭으로 목표 시각(syncTarget)에 맞춰 재생을 예약해버린다.
            // 단, audioReady는 예약이 끝난 직후가 아니라 카운트다운이 실제로 끝나는 시점(아래
            // runSyncedCountdown 콜백)에 켠다 — AudioEngine.currentTime은 재생이 실제로 시작되기
            // 전까지 한 값에 고정돼 있어서(0으로 클램프), 예약 직후 바로 켜버리면 그 사이 loop()가
            // 이 고정된 시간을 기준으로 elapsedTime을 계산해 노트가 멈춰 보이다가 시작 순간 튀는
            // 문제가 있었다. 싱글플레이(runCountdown)도 같은 이유로 카운트다운 종료 시점에만
            // audioReady를 켠다 — 그 전까지는 performance.now() 기반 elapsedTime으로 노트가
            // 자연스럽게 미끄러져 내려온다.
            if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                const whenSec = Math.max(0, (syncTarget - performance.now()) / 1000);
                DOM.musicPlayer.play(whenSec).catch(() => {});
            }
            this.runSyncedCountdown(syncTarget, () => {
                this.state.gameState = 'playing';
                if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                    this.state.audioReady = true;
                }
            });
        } else {
            this.runCountdown(() => {
                this.state.gameState = 'playing';
                if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                    DOM.musicPlayer.currentTime = this.state.settings.songStartOffset || 0;
                    DOM.musicPlayer.play().then(() => {
                        this.state.audioReady = true;
                    }).catch(() => {});
                }
            });
        }
    },

    end() {
        try {
            const activeStates = ['playing', 'countdown'];
            if (!activeStates.includes(this.state.gameState) && !this.state.isPaused) return;

            this.cancelCountdown();

            cancelAnimationFrame(this.state.animationFrameId);
            this.state.animationFrameId = null;

            // 멀티플레이 관전 HUD/progress broadcast 중지. 방 Realtime 채널 자체는
            // MultiplayerLobby가 소유하므로 여기서는 우리가 등록한 리스너만 뗀다.
            this._teardownMultiplayerSpectate();

            if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
                DOM.musicPlayer.pause();
                DOM.musicPlayer.load();

                if (DOM.musicPlayer.src.startsWith('blob:')) {
                    URL.revokeObjectURL(DOM.musicPlayer.src);
                }
            }

            // Canvas 클리어
            if (this.canvas.ctx) {
                this.canvas.ctx.clearRect(0, 0, this.canvas.w, this.canvas.h);
            }

            this.state.gameState = 'result';
            resetPlayingScreenUI();
            UI.updateResultScreen();
            // 연습 모드로 끝난 세션만 기록 — 실제 채보 플레이는 곡마다 난이도가 달라
            // "최근 성적 추이"에 섞으면 비교가 무의미하다 (연습모드-개선계획.md 2번).
            if (this.state.settings.mode === 'random' && typeof SessionHistory !== 'undefined') {
                SessionHistory.recordSession();
            }
            if (typeof SessionHistory !== 'undefined') SessionHistory.renderResultTrend();
            UI.showScreen('result');

            // 결과 화면 하단 버튼: 멀티플레이는 전용 버튼(재시작/방으로 돌아가기)을,
            // 싱글/온라인은 기존 버튼(리더보드 보기/메인으로 돌아가기)을 보여준다.
            const isMultiplayer = !!this.state._multiplayerRoomId;
            document.getElementById('mp-result-buttons')?.classList.toggle('hidden', !isMultiplayer);
            document.getElementById('back-to-menu-btn')?.classList.toggle('hidden', isMultiplayer);
            document.getElementById('result-leaderboard-btn')?.classList.toggle('hidden', isMultiplayer);
            if (isMultiplayer && typeof MultiplayerLobby !== 'undefined') {
                MultiplayerLobby.resetResultButtons();
            }

            if (this.state._onlineChartId) {
                const resultEl = document.getElementById('online-score-result');
                if (resultEl) {
                    resultEl.textContent = '점수 등록 중…';
                    resultEl.className = 'text-sm text-gray-400 mt-2';
                    resultEl.classList.remove('hidden');
                }
                submitOnlineScore().catch(() => {});
            }

            // 멀티플레이: 내 결과를 broadcast('finish')로 방에 알리고, 서버 검증 없이
            // 클라이언트가 받은 finish 값들끼리 비교해서 결과 화면에만 표시한다.
            // finish 리스너 자체는 여기서 떼지 않는다 — 결과 화면에서 상대가 늦게 끝내도
            // 계속 갱신되어야 하므로, 결과 화면을 벗어날 때(back-to-menu)에 정리한다.
            if (this.state._multiplayerRoomId) {
                this._finishMultiplayer().catch(err => Debugger.logError(err, 'Game.end:multiplayerFinish'));
            }
        } catch (err) {
            Debugger.logError(err, 'Game.end');
        }
    },

    // 환경설정 → 조작 탭에서 지정한 키를 길게 눌렀을 때 호출되는 "즉시 재시작".
    // end()와 달리 결과 제출/결과 화면 전환 없이 현재 차트를 그대로 처음부터 다시 시작한다.
    // 멀티플레이는 대상에서 제외 — 전원 동의가 필요한 mp-restart-btn(_maybeStartRestart) 절차를
    // 별도로 쓰고 있어서, 방 상태와 어긋나지 않도록 여기서는 아예 건드리지 않는다(호출부인
    // handleRestartHoldKeyDown에서도 한 번 더 막지만, 안전하게 여기서도 확인).
    async restartCurrentChart() {
        if (this.state._multiplayerActive) return;
        const activeStates = ['playing', 'countdown'];
        if (!activeStates.includes(this.state.gameState) && !this.state.isPaused) return;

        this.cancelCountdown();
        cancelAnimationFrame(this.state.animationFrameId);
        this.state.animationFrameId = null;

        if (this.state.settings.mode === 'music' && DOM.musicPlayer.src) {
            DOM.musicPlayer.pause();
        }

        await this.start();
    },

    prepareNotesFromChartData() {
        const chartData = JSON.parse(JSON.stringify(this.state.chartData));

        // loadChartNotes()가 미리 settings.lanes를 chartData.laneCount로 맞춰주지만,
        // 이 함수가 실제 게임플레이 노트를 최종적으로 만드는 지점이므로
        // 여기서도 직접 한 번 더 확인해 어떤 호출 경로로 오든 항상 정확한 레인 수를 쓰도록 한다.
        if (chartData.laneCount && CONFIG.LANE_KEY_MAPPING_ORDER[chartData.laneCount]) {
            this.state.settings.lanes = chartData.laneCount;
        }
        const playerLaneCount = this.state.settings.lanes;
        const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[playerLaneCount];

        const processedNotes = [];
        let noteIdCounter = 0;

        chartData.notes.forEach(note => {
            const laneId = note.lane;
            const gameLaneIndex = requiredLaneIds.indexOf(laneId);
            if (gameLaneIndex !== -1) {
                const newNoteBase = { time: note.time, lane: gameLaneIndex, processed: false };
                const type = note.type || 'tap';
                if (note.duration) {
                    const noteId = noteIdCounter++;
                    processedNotes.push({ ...newNoteBase, type: 'long_head', duration: note.duration, noteId, headProcessed: false });
                    processedNotes.push({ ...newNoteBase, time: note.time + note.duration, type: 'long_tail', noteId });
                } else {
                    processedNotes.push({ ...newNoteBase, type: type });
                }
            }
        });

        this.state.notes = processedNotes.sort((a, b) => a.time - b.time);
        this.state.totalNotes = this.state.notes.filter(n => n.type !== 'long_tail').length;
    },

    loop(timestamp) {
        try {
            Debugger.profileStart('Game.loop');
            if (this.state.isPaused) return;

            const self = this;
            let elapsedTime;

            if (self.state.settings.mode === 'music' && self.state.audioReady) {
                elapsedTime = Math.max(0, (DOM.musicPlayer.currentTime - self.state.settings.startTimeOffset) * 1000);
            } else {
                elapsedTime = timestamp - self.state.gameStartTime - self.state.totalPausedTime;
            }

            self.applyActiveTrigger(elapsedTime);

            self.updateNotes(elapsedTime);

            // Canvas 렌더
            self.canvas.render(
                self.state.notes,
                self.state.settings.lanes,
                self.state.activeLanes,
                self.state.laneIdMapping,
                elapsedTime,
                self.state.settings.noteSpeed
            );

            // 인게임 HUD: 남은 시간(마지막 노트 기준) / 현재 정확도(판정 가중 평균)
            // 렌더링/다음 프레임 예약보다 뒤에서, 자체 try/catch로 실행 — 여기서 문제가 생겨도
            // 게임 진행(렌더링, requestAnimationFrame 재예약)에는 영향을 주지 않도록 격리.
            try {
                const lastNote = self.state.notes.length ? self.state.notes[self.state.notes.length - 1] : null;
                const totalMs = lastNote ? lastNote.time : 0;
                const remainingMs = totalMs - elapsedTime;
                const j = self.state.judgements;
                const accuracyPercent = UI.accuracyFromJudgements(j.perfect, j.good, j.bad, j.miss);
                UI.updateHud(remainingMs, accuracyPercent);

                // 멀티플레이 관전: 500ms~1s 간격으로 내 진행 상황(점수/정확도/콤보)을 방 채널에
                // broadcast한다. HUD와 마찬가지로 이미 계산된 값을 재사용하며, 실패해도
                // 게임 진행에는 영향을 주지 않도록 이 try/catch 안에서만 처리한다.
                if (self.state._multiplayerActive && typeof MultiplayerRealtime !== 'undefined' && MultiplayerRealtime.isConnected) {
                    if (timestamp - self.state._multiplayerLastBroadcastAt >= 750) {
                        self.state._multiplayerLastBroadcastAt = timestamp;
                        // 내 점수도 상대와 같은 갱신 주기로 HUD에 반영 — updateSpectateHud가
                        // 끝에서 점수 내림차순으로 행을 다시 정렬하므로, 순위가 바뀌면
                        // 그 즉시(다음 판별 시각) 리스트 순서도 같이 바뀐다.
                        UI.updateSpectateHud({
                            [self.state._multiplayerUserId]: {
                                score: self.state.score,
                                accuracy: accuracyPercent,
                                combo: self.state.combo,
                            },
                        });
                        MultiplayerRealtime.send('progress', {
                            user_id: self.state._multiplayerUserId,
                            score: self.state.score,
                            accuracy: accuracyPercent,
                            combo: self.state.combo,
                        }).catch(() => {});
                    }
                }
            } catch (hudErr) {
                Debugger.logError(hudErr, 'Game.loop:hud');
            }

            if (self.state.processedNotes >= self.state.totalNotes && self.state.totalNotes > 0) {
                setTimeout(() => self.end(), 500);
                return;
            }
            self.state.animationFrameId = requestAnimationFrame(self.loop.bind(self));
        } catch (err) {
            Debugger.logError(err, 'Game.loop');
        } finally {
            Debugger.profileEnd('Game.loop');
            if (this.state.gameState === 'playing' || this.state.gameState === 'countdown') {
                Debugger.updatePerf(timestamp);
                Debugger.updateState(this.state);
            }
        }
    },

    updateNotes(elapsedTime) {
        try {
            Debugger.profileStart('Game.updateNotes');
            const gameHeight = this.canvas.h || DOM.lanesContainer.clientHeight;
            if (gameHeight === 0) return;

            const isCircle = document.body.classList.contains('circle-notes');
            // 커스터마이징 계획 2단계: drawNote()가 실제로 그리는 크기(NOTE_*_배율)와
            // 화면 진입/이탈(가시성) 판정 기준 크기가 어긋나면 노트가 잘려 보이거나
            // 화면 밖에서 미리 나타나므로, 여기서도 같은 배율을 적용한다.
            const sizeMul = Appearance.settings.noteSize || 1;
            const noteH    = (isCircle ? this.canvas.NOTE_CIRCLE_D : this.canvas.NOTE_BAR_H) * sizeMul;
            const jY       = this.canvas.judgementLineY(); // 판정선 top Y

            for (let i = this.state.unprocessedNoteIndex; i < this.state.notes.length; i++) {
                const note = this.state.notes[i];

                // 이미 처리 완료되고 visible도 false면 인덱스 전진
                if (note.processed && !note._visible) {
                    if (i === this.state.unprocessedNoteIndex) {
                        this.state.unprocessedNoteIndex++;
                    }
                    continue;
                }

                // long_head 처리 완료 → 롱노트 꼬리 미처리 감지
                if (note.type === 'long_head' && note.processed) {
                    const tailNote = this.state.notes.find(n => n.noteId === note.noteId && n.type === 'long_tail');
                    if (tailNote && !tailNote.processed && !this.state.activeLanes[note.lane]) {
                        this.handleJudgement('miss', tailNote);
                    }
                }

                const timeToHit = note.time - elapsedTime;
                // 노트 하단 Y (판정선 기준: 0ms = jY, 음수 = 판정선 아래)
                const noteBottomY = jY - (timeToHit * this.state.settings.noteSpeed / 10);

                // 아직 화면 밖(위)이고 처리 안됐으면 이후 노트도 마찬가지 → 중단
                // long_tail은 건너뜀: tail.time이 멀어도 그 뒤에 있는 다른 노트들은
                // 실제로는 head보다 먼저 등장할 수 있으므로 break 판단에서 제외한다
                if (note.type !== 'long_tail' && !note._visible && !note.processed && noteBottomY <= -noteH) {
                    break;
                }

                // 롱노트 높이 계산
                let drawH;
                if (note.type === 'long_head') {
                    const minH = (isCircle ? this.canvas.NOTE_CIRCLE_D : this.canvas.NOTE_BAR_H) * sizeMul;
                    drawH = Math.max((note.duration / 10) * this.state.settings.noteSpeed, minH);
                } else {
                    drawH = noteH;
                }

                const noteTopY = noteBottomY - drawH;

                // 화면 안에 들어왔는지 여부
                const inView = noteBottomY > -noteH && noteTopY < gameHeight;

                if (!note.processed && (note.type === 'tap' || note.type === 'long_head' || note.type === 'false')) {
                    // 커스터마이징 계획 2단계(노트 애니메이션): 화면에 처음 들어온 시각을
                    // 기록해 drawNote()의 페이드/스케일 인 애니메이션 기준점으로 쓴다.
                    if (inView && !note._visible) {
                        note._spawnedAt = elapsedTime;
                    }
                    note._visible = inView;
                }

                // 롱노트 수축 처리: _visible만 관리 (위치/높이는 drawNote에서 직접 계산)
                if (note.type === 'long_head' && note.shrinking && note.tailTime !== undefined) {
                    const timeUntilTail = note.tailTime - elapsedTime;
                    note._visible = timeUntilTail > 0;
                }

                // MISS 판정 (판정선을 완전히 지난 노트)
                // false 노트는 안 눌렀을 때 perfect이므로 판정선을 막 지난 순간 바로 처리
                if (!note.processed) {
                    const autoMissThreshold = note.type === 'false'
                        ? -CONFIG.JUDGEMENT_WINDOWS_MS.perfect
                        : -CONFIG.JUDGEMENT_WINDOWS_MS.miss;
                    if (timeToHit < autoMissThreshold) {
                        this.handleJudgement('miss', note);
                    }
                }
            }
        } catch (err) {
            Debugger.logError(err, 'Game.updateNotes');
        } finally {
            Debugger.profileEnd('Game.updateNotes');
        }
    },

    // signedDiffMs: note.time - elapsedTime의 부호를 유지한 값. 실제 입력으로 인한 판정(perfect/
    // good/bad)일 때만 넘어온다 — 양수면 판정선 도달 전에 누른 것(빠름), 음수면 지난 뒤에 누른 것(느림).
    _processSingleJudgement(judgement, note, signedDiffMs) {
        note.processed = true;

        // 레인별 판정 집계 (미스율 계산용) — 노트 타입 상관없이 실제 판정이 난 모든 노트를 센다.
        if (note.lane !== undefined && note.lane !== null) {
            if (!this.state.laneStats[note.lane]) this.state.laneStats[note.lane] = { total: 0, miss: 0 };
            this.state.laneStats[note.lane].total++;
            if (judgement === 'miss') this.state.laneStats[note.lane].miss++;
        }

        // 빠름/느림 편향 집계 — 'false' 노트는 안 누르는 게 정답이라 타이밍의 의미가 달라 제외.
        if (typeof signedDiffMs === 'number' && judgement !== 'miss' && note.type !== 'false') {
            if (signedDiffMs > 0) this.state.earlyLateStats.early++;
            else if (signedDiffMs < 0) this.state.earlyLateStats.late++;
            this.state.timingHits.push(signedDiffMs);
        }
        // long_head + perfect/good/bad(=miss가 아닌 모든 판정): shrinking 수축 애니메이션 → updateNotes가 _visible 관리
        // miss만 즉시 숨김
        const willShrink = note.type === 'long_head' && judgement !== 'miss';
        if (!willShrink) {
            note._visible = false;
        }

        if (note.type === 'long_tail') {
            // 헤드도 숨김 처리
            const headNote = this.state.notes.find(n => n.noteId === note.noteId && n.type === 'long_head');
            if (headNote) headNote._visible = false;
        }

        this.state.judgements[judgement]++;
        if (note.type !== 'long_head') {
            this.state.processedNotes++;
        }
        this.state.score += CONFIG.POINTS[judgement];
        // 버그 수정: 이전에는 이 shrinking 설정이 콤보 증가(else) 분기 안에만 있어서,
        // long_head가 'bad'로 판정되면(콤보는 리셋되지만 miss는 아님 → willShrink는 true) shrinking
        // 플래그가 끝내 설정되지 않아 노트가 판정선에서 수축도 안 되고 사라지지도 않는 문제가 있었다.
        // 콤보 증감과 무관하게, willShrink 조건(=miss가 아닌 모든 long_head 판정)과 항상 함께 처리한다.
        if (willShrink) {
            note.shrinking = true;
            const tailNote = this.state.notes.find(n => n.noteId === note.noteId && n.type === 'long_tail');
            if (tailNote) {
                tailNote.headProcessed = true;
                note.tailTime = tailNote.time;
            }
        }
        if (judgement === 'miss' || judgement === 'bad') {
            this.state.combo = 0;
        } else {
            this.state.combo++;
            if (this.state.combo > this.state.maxCombo) this.state.maxCombo = this.state.combo;
        }
    },

    // signedDiffMs: 입력으로 인한 판정일 때 handleInputDown/Up이 넘겨주는 부호 있는 시간차.
    // updateNotes()의 자동 MISS 호출에서는 넘기지 않는다(입력 자체가 없었으므로 타이밍 없음).
    handleJudgement(judgement, note, signedDiffMs) {
        try {
            if (note.processed) return;
            if (note.type === 'false') {
                judgement = (judgement === 'miss') ? 'perfect' : 'miss';
            }
            if (judgement === 'miss' && note.time > 0) {
                if (note.type === 'tap' || note.type === 'false') {
                    const notesAtSameTime = this.state.notes.filter(n =>
                        !n.processed && n.time === note.time && (n.type === 'tap' || n.type === 'false')
                    );
                    notesAtSameTime.forEach(n => this._processSingleJudgement('miss', n));
                } else {
                    this._processSingleJudgement('miss', note);
                }
                UI.showJudgementFeedback('MISS', 0);
                UI.updateScoreboard();
            } else {
                this._processSingleJudgement(judgement, note, signedDiffMs);
                UI.showJudgementFeedback(judgement.toUpperCase(), this.state.combo);
                UI.updateScoreboard();
            }
        } catch (err) {
            Debugger.logError(err, 'Game.handleJudgement');
        }
    },

    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.togglePause();
            return;
        }
        if (this.state.gameState !== 'playing' || this.state.isPaused) return;
        const laneIndex = this.state.keyMapping.findIndex(code => code === e.keyCode || code === e.key.toUpperCase().charCodeAt(0));
        if (laneIndex === -1 || this.state.activeLanes[laneIndex]) return;
        this.handleInputDown(laneIndex, false);
    },

    handleKeyUp(e) {
        if (this.state.gameState !== 'playing' || this.state.isPaused) return;
        const laneIndex = this.state.keyMapping.findIndex(code => code === e.keyCode || code === e.key.toUpperCase().charCodeAt(0));
        if (laneIndex === -1) return;
        this.handleInputUp(laneIndex, false);
    },

    // isTouch: 설정의 "판정 보정"에 터치 전용 추가 보정을 더할지 여부.
    // (키보드/마우스에는 일반 보정만, 터치에는 일반 보정 + 터치 전용 보정이 함께 적용된다)
    getInputOffsetMs(isTouch) {
        const base = this.state.settings.inputOffsetMs || 0;
        const touchExtra = isTouch ? (this.state.settings.touchInputOffsetMs || 0) : 0;
        return base + touchExtra;
    },

    handleInputDown(laneIndex, isTouch = false) {
        try {
            if (this.state.gameState !== 'playing') return;

            this.state.activeLanes[laneIndex] = true;
            const laneEl = DOM.lanesContainer.children[laneIndex];
            if (laneEl && this.state.settings.laneHighlightOnInput) laneEl.classList.add('active-feedback');

            const offsetMs = this.getInputOffsetMs(isTouch);
            let elapsedTime;
            if (this.state.settings.mode === 'music') {
                elapsedTime = Math.max(0, (DOM.musicPlayer.currentTime - this.state.settings.startTimeOffset) * 1000 - offsetMs);
            } else {
                elapsedTime = performance.now() - this.state.gameStartTime - this.state.totalPausedTime - offsetMs;
            }

            const isCircleMode = document.body.classList.contains('circle-notes');
            const noteSize = isCircleMode ? 90 : 25;
            const extraWindow = isCircleMode ? (noteSize / 2) * (10 / this.state.settings.noteSpeed) : 0;
            const judgementWindow = {
                perfect: CONFIG.JUDGEMENT_WINDOWS_MS.perfect + extraWindow,
                good: CONFIG.JUDGEMENT_WINDOWS_MS.good + extraWindow,
                bad: CONFIG.JUDGEMENT_WINDOWS_MS.bad + extraWindow,
                miss: CONFIG.JUDGEMENT_WINDOWS_MS.miss + extraWindow
            };

            let bestMatch = null;
            let smallestDiff = Infinity;
            let bestSignedDiff = 0;
            for (let i = this.state.unprocessedNoteIndex; i < this.state.notes.length; i++) {
                const note = this.state.notes[i];
                if (note.time - elapsedTime > judgementWindow.miss) break;
                if (!note.processed && note.lane === laneIndex && (note.type === 'tap' || note.type === 'long_head' || note.type === 'false')) {
                    const rawDiff = note.time - elapsedTime;
                    const timeDiff = Math.abs(rawDiff);
                    if (timeDiff <= judgementWindow.miss && timeDiff < smallestDiff) {
                        smallestDiff = timeDiff;
                        bestSignedDiff = rawDiff;
                        bestMatch = note;
                    }
                }
            }
            if (bestMatch) {
                if (smallestDiff <= judgementWindow.perfect) this.handleJudgement('perfect', bestMatch, bestSignedDiff);
                else if (smallestDiff <= judgementWindow.good) this.handleJudgement('good', bestMatch, bestSignedDiff);
                else if (smallestDiff <= judgementWindow.bad) this.handleJudgement('bad', bestMatch, bestSignedDiff);
            }
        } catch (err) {
            Debugger.logError(err, 'Game.handleInputDown');
        }
    },

    handleInputUp(laneIndex, isTouch = false) {
        try {
            this.state.activeLanes[laneIndex] = false;
            const laneEl = DOM.lanesContainer.children[laneIndex];
            if (laneEl) laneEl.classList.remove('active-feedback');

            if (this.state.gameState !== 'playing') return;

            const offsetMs = this.getInputOffsetMs(isTouch);
            let elapsedTime;
            if (this.state.settings.mode === 'music') {
                elapsedTime = Math.max(0, (DOM.musicPlayer.currentTime - this.state.settings.startTimeOffset) * 1000 - offsetMs);
            } else {
                elapsedTime = performance.now() - this.state.gameStartTime - this.state.totalPausedTime - offsetMs;
            }

            const isCircleMode = document.body.classList.contains('circle-notes');
            const noteSize = isCircleMode ? 90 : 25;
            const extraWindow = isCircleMode ? (noteSize / 2) * (10 / this.state.settings.noteSpeed) : 0;
            const judgementWindow = {
                perfect: CONFIG.JUDGEMENT_WINDOWS_MS.perfect + extraWindow,
                good: CONFIG.JUDGEMENT_WINDOWS_MS.good + extraWindow,
                bad: CONFIG.JUDGEMENT_WINDOWS_MS.bad + extraWindow,
                miss: CONFIG.JUDGEMENT_WINDOWS_MS.miss + extraWindow
            };

            let bestMatch = null;
            let smallestDiff = Infinity;
            let bestSignedDiff = 0;
            for (let i = this.state.unprocessedNoteIndex; i < this.state.notes.length; i++) {
                const note = this.state.notes[i];
                if (note.time - elapsedTime > judgementWindow.miss) break;
                if (!note.processed && note.lane === laneIndex && note.type === 'long_tail' && note.headProcessed) {
                    const rawDiff = note.time - elapsedTime;
                    const timeDiff = Math.abs(rawDiff);
                    if (timeDiff <= judgementWindow.miss && timeDiff < smallestDiff) {
                        smallestDiff = timeDiff;
                        bestSignedDiff = rawDiff;
                        bestMatch = note;
                    }
                }
            }
            if (bestMatch) {
                if (smallestDiff <= judgementWindow.perfect) this.handleJudgement('perfect', bestMatch, bestSignedDiff);
                else if (smallestDiff <= judgementWindow.good) this.handleJudgement('good', bestMatch, bestSignedDiff);
                else if (smallestDiff <= judgementWindow.bad) this.handleJudgement('bad', bestMatch, bestSignedDiff);
            }
        } catch (err) {
            Debugger.logError(err, 'Game.handleInputUp');
        }
    },

    togglePause() {
        if (this.state.gameState !== 'playing' && this.state.gameState !== 'countdown') return;
        this.state.isPaused = !this.state.isPaused;
        if (this.state.isPaused) {
            this.cancelCountdown();
            this.state.pauseStartTime = performance.now();
            cancelAnimationFrame(this.state.animationFrameId);
            if (this.state.settings.mode === 'music') DOM.musicPlayer.pause();
            DOM.pauseGameBtn.classList.add('hidden');
            DOM.resumeGameBtn.classList.remove('hidden');
            DOM.playingStatusLabel.textContent = '일시 정지 중';
            DOM.settings.iconPlaying.classList.remove('hidden');
            // 자동 숨김 설정과 무관하게, 일시정지 중에는 우측 패널을 잠깐 다시 보여준다.
            UI.setPanelCollapsed(false);
            // 모바일(1024px 이하)에서는 ui-area가 게임 중 기본적으로 숨겨져 있으므로,
            // 일시정지되면 오버레이로 같이 띄워줘야 실제로 메뉴가 보인다.
            UI.setMobilePanelOpen(true);
        } else {
            DOM.pauseGameBtn.classList.remove('hidden');
            DOM.resumeGameBtn.classList.add('hidden');
            DOM.playingStatusLabel.textContent = '플레이 중';
            DOM.settings.iconPlaying.classList.add('hidden');
            // 카운트다운이 게임 화면(game-area) 위에서 보이도록, 재개 누르는 즉시(카운트다운
            // 끝나길 기다리지 않고) 모바일 오버레이부터 닫는다.
            UI.setMobilePanelOpen(false);
            this.runCountdown(() => {
                this.state.totalPausedTime += performance.now() - this.state.pauseStartTime;
                if (this.state.settings.mode === 'music') DOM.musicPlayer.play();
                this.state.gameState = 'playing';
                // 재개되면 "게임플레이 시 우측 화면 숨기기" 설정에 맞춰 다시 접는다.
                UI.setPanelCollapsed(this.state.settings.autoHideUiOnPlay === true);
                this.loop(performance.now());
            });
        }
    },

    setupLanes() {
        DOM.lanesContainer.innerHTML = '';
        DOM.lanesContainer.style.width = `${this.state.settings.lanes * 100}px`;
        this.state.activeLanes = Array(this.state.settings.lanes).fill(false);
        const laneCount = this.state.settings.lanes;
        const keyOrder = CONFIG.LANE_KEY_MAPPING_ORDER[laneCount];
        const activeKeyMap = (this.state.settings.userKeyMappingsByLanes && this.state.settings.userKeyMappingsByLanes[laneCount])
            || CONFIG.getDefaultKeyMap(laneCount);
        if (!keyOrder) {
            console.error(`Invalid number of lanes: ${laneCount}.`);
            UI.showScreen('menu');
            return;
        }

        this.state.laneIdMapping = keyOrder;

        const keysForCurrentLanes = keyOrder.map(keyId => activeKeyMap[keyId]);
        this.state.keyMapping = keysForCurrentLanes.map(keyName => {
            const upperKeyName = keyName.charAt(0).toUpperCase() + keyName.slice(1);
            return CONFIG.KEY_CODES[upperKeyName] || keyName.toUpperCase().charCodeAt(0);
        });
        const keyHintMap = { 'Space': '⎵', 'Semicolon': ';' };

        for (let i = 0; i < laneCount; i++) {
            const lane = document.createElement('div');
            lane.className = 'lane';
            lane.style.width = '100px';
            lane.dataset.laneIndex = i;
            lane.dataset.laneId = keyOrder[i];

            // 키 힌트 (DOM 텍스트, Canvas 아님)
            const keyHint = document.createElement('div');
            keyHint.className = 'key-hint';
            const keyName = keysForCurrentLanes[i];
            keyHint.textContent = keyHintMap[keyName] || keyName.toUpperCase();
            lane.appendChild(keyHint);

            // 이벤트: 클릭/터치 처리
            lane.addEventListener('mousedown',  (e) => { e.preventDefault(); this.handleInputDown(i, false); });
            lane.addEventListener('mouseup',    (e) => { e.preventDefault(); this.handleInputUp(i, false); });
            lane.addEventListener('mouseleave', (e) => { if (this.state.activeLanes[i]) this.handleInputUp(i, false); });
            // 터치 입력은 preventDefault로 스크롤/확대 등 브라우저 기본 동작을 실제로
            // 막아야 하므로 passive:false를 명시한다(안 그러면 판정 씹힘/오탭 유발).
            lane.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleInputDown(i, true); }, { passive: false });
            lane.addEventListener('touchend',   (e) => { e.preventDefault(); this.handleInputUp(i, true); }, { passive: false });
            DOM.lanesContainer.appendChild(lane);
        }
    },

    generateRandomNotes() {
        this.state.notes = [];
        let totalNotesToGenerate = parseInt(DOM.noteCountInput.value) || CONFIG.DEFAULT_NOTE_COUNT;
        if (totalNotesToGenerate < CONFIG.NOTE_COUNT_MIN) totalNotesToGenerate = CONFIG.NOTE_COUNT_MIN;
        if (totalNotesToGenerate > CONFIG.NOTE_COUNT_MAX) totalNotesToGenerate = CONFIG.NOTE_COUNT_MAX;
        const simProbability = this.state.settings.dongtaProbability;
        const maxSimultaneous = this.state.settings.maxSimultaneousNotes;
        const dongtaTypeProbs = this.state.settings.dongtaNoteTypeProbabilities;
        const longNoteProbability = this.state.settings.longNoteProbability;
        const falseNoteProbability = this.state.settings.falseNoteProbability;
        let generatedNotesCount = 0;
        let currentTime = 1000;
        let noteIdCounter = 0;

        const determineNoteType = () => {
            const rand = Math.random();
            const cumulative = {
                tap: dongtaTypeProbs.tap,
                long: dongtaTypeProbs.tap + dongtaTypeProbs.long,
                false: dongtaTypeProbs.tap + dongtaTypeProbs.long + dongtaTypeProbs.false
            };
            if (rand < cumulative.tap) return 'tap';
            if (rand < cumulative.long) return 'long';
            return 'false';
        };

        const activeLongNotes = new Map();

        while (generatedNotesCount < totalNotesToGenerate) {
            const remainingNotes = totalNotesToGenerate - generatedNotesCount;
            const canGenerateSimultaneous = this.state.settings.lanes > 1 && remainingNotes >= 2;
            const canGenerateLongNote = remainingNotes >= 1;

            const getAvailableLanes = () => {
                const available = [];
                for (let i = 0; i < this.state.settings.lanes; i++) {
                    const longNoteEndTime = activeLongNotes.get(i);
                    if (!longNoteEndTime || currentTime >= longNoteEndTime) {
                        available.push(i);
                    }
                }
                return available;
            };

            if (canGenerateSimultaneous && Math.random() < simProbability) {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length < 2) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const numSimultaneous = Math.min(maxSimultaneous, availableLanes.length, remainingNotes);
                const actualCount = Math.max(2, Math.floor(Math.random() * (numSimultaneous - 1)) + 2);
                for (let i = availableLanes.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [availableLanes[i], availableLanes[j]] = [availableLanes[j], availableLanes[i]];
                }
                for (let i = 0; i < actualCount && i < availableLanes.length; i++) {
                    const lane = availableLanes[i];
                    const noteType = determineNoteType();
                    if (noteType === 'long') {
                        const duration = 500 + Math.random() * 1000;
                        const noteId = noteIdCounter++;
                        this.state.notes.push({ lane, time: currentTime, duration, type: 'long_head', noteId });
                        this.state.notes.push({ lane, time: currentTime + duration, type: 'long_tail', noteId });
                        activeLongNotes.set(lane, currentTime + duration);
                    } else {
                        this.state.notes.push({ lane, time: currentTime, type: noteType });
                    }
                }
                generatedNotesCount += actualCount;
            } else if (canGenerateLongNote && Math.random() < longNoteProbability) {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length === 0) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
                const duration = 500 + Math.random() * 1000;
                const noteId = noteIdCounter++;
                this.state.notes.push({ lane, time: currentTime, duration, type: 'long_head', noteId });
                this.state.notes.push({ lane, time: currentTime + duration, type: 'long_tail', noteId });
                activeLongNotes.set(lane, currentTime + duration);
                generatedNotesCount += 1;
            } else if (falseNoteProbability > 0 && Math.random() < falseNoteProbability) {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length === 0) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
                this.state.notes.push({ lane, time: currentTime, type: 'false' });
                generatedNotesCount++;
            } else {
                const availableLanes = getAvailableLanes();
                if (availableLanes.length === 0) {
                    const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
                    currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
                    continue;
                }
                const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
                this.state.notes.push({ lane, time: currentTime, type: 'tap' });
                generatedNotesCount++;
            }
            const baseInterval = 500 - this.state.settings.lanes * CONFIG.NOTE_SPACING_FACTOR;
            currentTime += baseInterval / this.state.settings.noteSpawnSpeed;
        }
        this.state.totalNotes = generatedNotesCount;
        this.state.notes.sort((a, b) => a.time - b.time);
    },

    // ── 멀티플레이: 클록 동기화된 목표 시각(targetPerfTime)에 맞춰 동시 시작 ──────
    // online.js의 _playOnlineChart와 준비 과정은 동일하되, 고정 4초 카운트다운 대신
    // start()에 syncStartPerfTime을 넘겨 오디오/카운트다운을 목표 시각에 맞춘다.
    // userId: 나 자신의 user_id (progress/finish broadcast 발신자 식별용).
    // opponents: [{ user_id, nickname }] — 나를 제외한 같은 방 참가자 목록(관전 HUD/결과 비교 골격용).
    // selfNickname: 관전 HUD에 내 점수도 같이 띄우기 위한 내 닉네임.
    // roomId: beat_rooms.id — 결과 화면에서 전원 완료 시 status를 finished로 정리하는 데 쓴다.
    async startMultiplayer({ chartData, audioUrl, startOffsetMs = 0, targetPerfTime, onlineChartId = null, userId = null, opponents = [], roomId = null, hostId = null, selfNickname = null }) {
        chartData.startTimeOffset = (startOffsetMs || 0) / 1000;
        if (!this.loadChartNotes(chartData)) return;

        this.state._onlineChartId = onlineChartId;
        this.state.settings.mode = 'music';
        this.state.settings.musicSrc = audioUrl;
        this.state.settings.songStartOffset = (startOffsetMs || 0) / 1000;
        DOM.musicPlayer.src = audioUrl;

        this._setupMultiplayerSpectate(userId, opponents, roomId, hostId, selfNickname);

        // start()가 내부에서 UI.showScreen('playing')을 호출하므로 여기서 별도로 'menu'
        // 화면을 먼저 거칠 필요가 없다 — _playOnlineChart()와 동일한 이유로, 그 단계가
        // MenuFeatured.onEnter()/onLeave()를 오발동시켜 추천 곡 배경이 잠깐 떴다가
        // 실제 플레이할 곡 배경이 까맣게 지워지는 원인이었다.
        await this.start({ syncStartPerfTime: targetPerfTime });
        UI.showScreen('playing');
        this.state.gameState = 'playing';
    },

    // 진행 중 상대 관전(Phase 5) + 결과 비교(Phase 6) 준비: 상대 목록으로 HUD 골격을 그리고,
    // 방 채널의 'progress'/'finish' broadcast를 구독한다. 실제 progress 송신은 loop()에서,
    // finish 송신은 end()→_finishMultiplayer()에서, 채널 연결/해제는 MultiplayerLobby가 담당한다.
    _setupMultiplayerSpectate(userId, opponents, roomId, hostId, selfNickname = null) {
        this._teardownMultiplayerSpectate();
        this._teardownMultiplayerFinish();
        this.state._multiplayerActive = true;
        this.state._multiplayerUserId = userId;
        this.state._multiplayerOpponents = opponents || [];
        this.state._multiplayerRoomId = roomId || null;
        this.state._multiplayerHostId = hostId || null;
        this.state._multiplayerProgress = {};
        this.state._multiplayerResults = {};
        this.state._multiplayerSelfFinished = false;
        this.state._multiplayerLastBroadcastAt = 0;

        UI.showSpectateHud(this.state._multiplayerOpponents, userId, selfNickname);

        if (typeof MultiplayerRealtime === 'undefined') return;

        const progressHandler = (payload) => {
            if (!payload || !payload.user_id || payload.user_id === this.state._multiplayerUserId) return;
            this.state._multiplayerProgress[payload.user_id] = payload;
            UI.updateSpectateHud(this.state._multiplayerProgress);
        };
        this.state._multiplayerProgressHandler = progressHandler;
        MultiplayerRealtime.on('progress', progressHandler);

        const finishHandler = (payload) => {
            if (!payload || !payload.user_id || payload.user_id === this.state._multiplayerUserId) return;
            this.state._multiplayerResults[payload.user_id] = {
                finalScore: payload.finalScore || 0,
                finalCombo: payload.finalCombo || 0,
                judgements: payload.judgements || null,
            };
            UI.renderMultiplayerResultCompare(
                this.state._multiplayerOpponents,
                this.state._multiplayerResults,
                this.state._multiplayerUserId
            );
            this._maybeFinalizeMultiplayerRoom();
        };
        this.state._multiplayerFinishHandler = finishHandler;
        MultiplayerRealtime.on('finish', finishHandler);

        // 게임 중에도 presence를 구독해 상대 연결 끊김을 감지한다(대기실 리스너와 별개).
        const presenceHandler = (state) => {
            const onlineIds = new Set(Object.keys(state));
            UI.updateSpectateConnectionStatus(this.state._multiplayerOpponents, onlineIds);
        };
        this.state._multiplayerPresenceHandler = presenceHandler;
        MultiplayerRealtime.onPresenceChange(presenceHandler);
    },

    // progress broadcast/미니 HUD만 중지(게임 종료 시 호출). finish 리스너와 결과 비교 화면은
    // 결과 화면에서도 계속 쓰이므로 별도로 _teardownMultiplayerFinish()가 담당한다.
    _teardownMultiplayerSpectate() {
        if (this.state._multiplayerProgressHandler && typeof MultiplayerRealtime !== 'undefined') {
            MultiplayerRealtime.off('progress', this.state._multiplayerProgressHandler);
        }
        if (this.state._multiplayerPresenceHandler && typeof MultiplayerRealtime !== 'undefined') {
            MultiplayerRealtime.offPresenceChange(this.state._multiplayerPresenceHandler);
        }
        this.state._multiplayerProgressHandler = null;
        this.state._multiplayerPresenceHandler = null;
        this.state._multiplayerActive = false;
        UI.hideSpectateHud();
    },

    // finish 리스너/결과 비교 상태를 완전히 정리한다. 결과 화면을 벗어날 때(back-to-menu)
    // main.js에서 호출한다 — 게임 종료(end()) 시점에는 아직 호출하지 않는다.
    _teardownMultiplayerFinish() {
        if (this.state._multiplayerFinishHandler && typeof MultiplayerRealtime !== 'undefined') {
            MultiplayerRealtime.off('finish', this.state._multiplayerFinishHandler);
        }
        this.state._multiplayerFinishHandler = null;
        this.state._multiplayerResults = {};
        this.state._multiplayerRoomId = null;
        this.state._multiplayerHostId = null;
        this.state._multiplayerOpponents = [];
        this.state._multiplayerUserId = null;
        this.state._multiplayerSelfFinished = false;
        UI.hideMultiplayerResultCompare();
    },

    // 내 결과를 broadcast('finish')로 방에 알리고, CloudScores.submitScore와 별개로
    // beat_room_players.final_score/final_combo도 기록한다(관전용 표시 전용, 리더보드 아님).
    async _finishMultiplayer() {
        const { perfect, good, bad, miss } = this.state.judgements;
        const finalScore = this.state.score;
        const finalCombo = this.state.maxCombo || 0;
        const judgements = { perfect, good, bad, miss };

        this.state._multiplayerResults[this.state._multiplayerUserId] = { finalScore, finalCombo, judgements, self: true };
        this.state._multiplayerSelfFinished = true;
        UI.renderMultiplayerResultCompare(
            this.state._multiplayerOpponents,
            this.state._multiplayerResults,
            this.state._multiplayerUserId
        );

        if (typeof MultiplayerRealtime !== 'undefined' && MultiplayerRealtime.isConnected) {
            await MultiplayerRealtime.send('finish', {
                user_id: this.state._multiplayerUserId,
                finalScore,
                finalCombo,
                judgements,
            }).catch(() => {});
        }
        if (typeof MultiplayerRooms !== 'undefined' && this.state._multiplayerRoomId) {
            MultiplayerRooms.setFinalResult(this.state._multiplayerRoomId, finalScore, finalCombo).catch(() => {});
        }
        this._maybeFinalizeMultiplayerRoom();
    },

    _isMultiplayerHost() {
        return !!this.state._multiplayerUserId && this.state._multiplayerUserId === this.state._multiplayerHostId;
    },

    _allMultiplayerResultsIn() {
        const total = (this.state._multiplayerOpponents?.length || 0) + 1;
        return Object.keys(this.state._multiplayerResults).length >= total;
    },

    // 내가 관측한 참가자 전원(나 + opponents)이 전부 finish를 broadcast했으면
    // beat_rooms.status를 finished로 정리한다. 여러 클라이언트가 동시에 이 조건을 만족해
    // 중복 호출될 수 있지만 단순 상태 갱신이라 멱등하다.
    _maybeFinalizeMultiplayerRoom() {
        if (!this.state._multiplayerRoomId || typeof MultiplayerRooms === 'undefined') return;
        const total = (this.state._multiplayerOpponents?.length || 0) + 1;
        const finishedCount = Object.keys(this.state._multiplayerResults).length;
        if (finishedCount >= total) {
            MultiplayerRooms.updateRoomStatus(this.state._multiplayerRoomId, 'finished').catch(() => {});
        }
    },

    loadChartNotes(chartData) {
        try {
            this.state.chartData = chartData;
            this.state.settings.requiredSongName = chartData.songName || null;
            this.state.settings.startTimeOffset = chartData.startTimeOffset || 0;
            this.state.settings.songStartOffset = 0;
            const chartBPM = chartData.bpm || 120;
            this.state.settings.bpm = chartBPM;
            // 하강 속도 결정 우선순위:
            // 1) 비트맵이 "이 맵 전용 하강 속도 사용"으로 저장되어 있으면 항상 그 값을 쓴다.
            // 2) 아니고, 플레이어가 "플레이어 기본 하강 속도 지정"을 켜뒀으면 그 값으로 덮어쓴다.
            // 3) 둘 다 아니면(구버전 차트 등) 기존처럼 차트의 fallSpeed → 없으면 BPM 기반 계산값.
            const mapHasCustomFallSpeed = !!chartData.useCustomFallSpeed
                && typeof chartData.fallSpeed === 'number' && chartData.fallSpeed > 0;
            let speedSource;
            if (mapHasCustomFallSpeed) {
                speedSource = chartData.fallSpeed;
            } else if (this.state.settings.useDefaultFallSpeed) {
                speedSource = this.state.settings.defaultFallSpeedValue;
            } else if (typeof chartData.fallSpeed === 'number' && chartData.fallSpeed > 0) {
                speedSource = chartData.fallSpeed;
            } else {
                speedSource = Math.round(chartBPM / 20);
            }
            this.state.settings.noteSpeed = Math.max(1, Math.min(20, speedSource));
            this.state.settings.usingMapCustomFallSpeed = mapHasCustomFallSpeed;

            // 트리거(구간별 BPM/하강 속도 변경) 로드 — 시간순 정렬 보장
            this.state.triggers = Array.isArray(chartData.triggers)
                ? [...chartData.triggers].sort((a, b) => a.time - b.time)
                : [];
            this.state.baseBpm = chartBPM;
            this.state.baseNoteSpeed = this.state.settings.noteSpeed;

            // 버그 수정: 지금까지 여기서 settings.lanes(기본값 4)를 그대로 썼기 때문에,
            // 5키 이상으로 저장된 차트를 불러와도 항상 4키 매핑으로 강제되어
            // 5번째 레인 이상의 노트가 전부 누락되는 문제가 있었다.
            // 차트에 저장된 laneCount를 실제 플레이 레인 수로 반영한다.
            const chartLaneCount = chartData.laneCount;
            if (chartLaneCount && CONFIG.LANE_KEY_MAPPING_ORDER[chartLaneCount]) {
                this.state.settings.lanes = chartLaneCount;
            }
            const playerLaneCount = this.state.settings.lanes;
            const requiredLaneIds = CONFIG.LANE_KEY_MAPPING_ORDER[playerLaneCount];
            if (!requiredLaneIds) {
                throw new Error(`${playerLaneCount}레인에 대한 키 매핑 정보가 없습니다.`);
            }
            const processedNotes = [];
            let noteIdCounter = 0;
            chartData.notes.forEach(note => {
                const laneId = note.lane;
                const gameLaneIndex = requiredLaneIds.indexOf(laneId);
                if (gameLaneIndex !== -1) {
                    const newNoteBase = { time: note.time, lane: gameLaneIndex, processed: false };
                    const type = note.type || 'tap';
                    if (note.duration) {
                        const noteId = noteIdCounter++;
                        processedNotes.push({ ...newNoteBase, type: 'long_head', duration: note.duration, noteId });
                        processedNotes.push({ ...newNoteBase, time: note.time + note.duration, type: 'long_tail', noteId });
                    } else {
                        processedNotes.push({ ...newNoteBase, type: type });
                    }
                }
            });
            this.state.notes = processedNotes.sort((a, b) => a.time - b.time);
            this.state.totalNotes = this.state.notes.filter(n => n.type !== 'long_tail').length;
            return true;
        } catch (err) {
            Debugger.logError(err, 'Game.loadChartNotes');
            UI.showMessage('menu', `차트 로딩 오류: ${err.message}`);
            return false;
        }
    },
};