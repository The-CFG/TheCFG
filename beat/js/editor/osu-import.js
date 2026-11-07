/**
 * OsuImport
 * ---------
 * osu!mania 채보(.osu) 텍스트를 TheBeat 채보 포맷(v2, ChartFormat과 호환)으로 변환한다.
 * changer.py를 그대로 JS로 옮긴 버전 — BPM 타이밍 포인트 선택 버그 수정, BOM 처리 포함.
 *
 * 파일 읽기/쓰기는 전혀 하지 않는 순수 변환 함수다. 호출하는 쪽(브라우저면 FileReader,
 * Node면 fs)에서 .osu 파일을 문자열로 읽어서 넘겨주면 된다.
 *
 * 반환값은 ChartFormat.normalizeAll()에 그대로 넣을 수 있는 v2 포맷 객체다:
 *   { formatVersion: 2, songName, artist, beatmaps: [{ difficultyLabel, laneCount, bpm,
 *     startTimeOffset, notes, triggers }] }
 */
const OsuImport = {
    LANE_IDS_ORDER: {
        4: ['L2', 'L1', 'R1', 'R2'],
        5: ['L2', 'L1', 'C1', 'R1', 'R2'],
        6: ['L3', 'L2', 'L1', 'R1', 'R2', 'R3'],
        7: ['L3', 'L2', 'L1', 'C1', 'R1', 'R2', 'R3'],
        8: ['L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4'],
    },

    // [SectionName] 블록 하나를 줄 배열로 뽑아낸다. (changer.py의 get_section과 동일)
    _getSection(lines, name) {
        const out = [];
        let inSec = false;
        for (const rawLine of lines) {
            const l = rawLine.trim();
            if (l.startsWith('[') && l.endsWith(']')) {
                inSec = (l === `[${name}]`);
                continue;
            }
            if (inSec && l) out.push(l);
        }
        return out;
    },

    // "Key: Value" 줄로만 이루어진 섹션(Metadata, Difficulty 등)을 객체로 파싱한다.
    _parseKeyValueSection(lines, name) {
        const map = {};
        for (const l of this._getSection(lines, name)) {
            const idx = l.indexOf(':');
            if (idx === -1) continue;
            map[l.slice(0, idx)] = l.slice(idx + 1);
        }
        return map;
    },

    // osuText: .osu 파일 전체 내용. fileName은 에러 메시지에만 쓰인다(선택).
    parse(osuText, fileName = '') {
        // BOM(유니코드 시그니처) 제거 — python 쪽 utf-8-sig 인코딩 수정에 대응.
        const text = osuText.charCodeAt(0) === 0xFEFF ? osuText.slice(1) : osuText;
        const lines = text.split(/\r?\n/);

        const meta = this._parseKeyValueSection(lines, 'Metadata');
        const diff = this._parseKeyValueSection(lines, 'Difficulty');

        const circleSize = Math.trunc(parseFloat(diff.CircleSize ?? '4'));
        const laneCount = circleSize;

        // beatLength가 양수인 첫 타이밍 포인트만 실제 BPM(uninherited) 포인트다.
        // 음수는 SV(속도 변경, inherited) 포인트라서 그대로 쓰면 BPM이 음수로 계산되는
        // 버그가 있었다 — 원본 스크립트에서 수정된 부분을 그대로 옮김.
        const timingPoints = this._getSection(lines, 'TimingPoints');
        let beatLenMs = null;
        for (const tp of timingPoints) {
            const parts = tp.split(',');
            const bl = parseFloat(parts[1]);
            if (bl > 0) {
                beatLenMs = bl;
                break;
            }
        }
        if (beatLenMs === null) {
            throw new Error(`${fileName ? fileName + ': ' : ''}BPM 타이밍 포인트를 찾을 수 없습니다 (모든 타이밍 포인트가 SV 포인트).`);
        }
        const bpm = Math.round(60000.0 / beatLenMs);

        const laneIds = this.LANE_IDS_ORDER[laneCount] || this.LANE_IDS_ORDER[4];

        const hitObjects = this._getSection(lines, 'HitObjects');
        const notes = [];
        for (const ho of hitObjects) {
            const parts = ho.split(',');
            const x = parseInt(parts[0], 10);
            const time = parseInt(parts[2], 10);
            const objType = parseInt(parts[3], 10);
            const column = Math.min(laneCount - 1, Math.max(0, Math.trunc(x * laneCount / 512)));
            const lane = laneIds[column];
            const isHold = (objType & 128) !== 0;
            if (isHold) {
                const extras = parts[5];
                const endTime = parseInt(extras.split(':')[0], 10);
                const duration = endTime - time;
                notes.push({ time, lane, duration });
            } else {
                notes.push({ time, lane });
            }
        }
        notes.sort((a, b) => a.time - b.time);

        const difficultyLabel = (meta.Version || '').replace(/^"+|"+$/g, '') || '기본';

        return {
            formatVersion: 2,
            songName: meta.Title || '',
            artist: meta.Artist || null,
            beatmaps: [
                {
                    difficultyLabel,
                    laneCount,
                    bpm,
                    startTimeOffset: 0,
                    notes,
                    triggers: [],
                },
            ],
        };
    },
};

// Node 환경(테스트 등)에서 require로도 쓸 수 있게. 브라우저에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OsuImport;
}