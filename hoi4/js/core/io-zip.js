// ════════════════════════════════════════════════════════
//  io-zip.js — ZIP 패킹 / 언패킹
//  의존: io-parsers.js, io-image.js, state.js
// ════════════════════════════════════════════════════════

// allowedPaths: Set<string> | null — null이면 전체 포함
async function packProjectZip(allowedPaths = null) {
    if (typeof JSZip === 'undefined') return null;
    const zip  = new JSZip();
    const root = appState.project.name || 'hoi4_mod';

    const entries = Object.entries(appState.project.files)
        .filter(([path]) => !allowedPaths || allowedPaths.has(path));

    entries.forEach(([path, fd]) => {
        try {
            if (fd.type === 'national_focus')
                zip.file(`${root}/${path}`, buildFocusTxt(fd));
            else if (fd.type === 'localisation')
                zip.file(`${root}/${path}`, buildLocYml(fd));
            else if ((fd.type === 'dds' || fd.type === 'image') && fd.base64) {
                // data: 헤더 제거 후 raw base64로 바이너리 저장
                const raw  = fd.base64.replace(/^data:[^;]+;base64,/, '');
                const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
                zip.file(`${root}/${path}`, bytes, { binary: true });
            } else if (fd.type === 'gfx_define')
                zip.file(`${root}/${path}`, buildGfxFile(fd));
            else if (fd.raw != null)
                zip.file(`${root}/${path}`, fd.raw);
        } catch(e) { console.warn('pack error', path, e); }
    });

    return zip.generateAsync({ type: 'blob' });
}

async function unpackProjectZip(arrayBuffer, onProgress = null) {
    const prog = (pct, detail) => onProgress?.(pct, detail);
    if (typeof JSZip === 'undefined') throw new Error('JSZip 라이브러리가 없습니다.');
    prog(2, 'ZIP 압축 해제 중...');
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 레거시 호환
    const oldMeta = Object.values(zip.files)
        .find(f => f.name.endsWith('_project.json') || f.name.endsWith('_hoi4editor_project.json'));
    if (oldMeta) {
        prog(90, '프로젝트 메타 파싱 중...');
        const json = JSON.parse(await oldMeta.async('string'));
        prog(100, '완료');
        if (json.version === 2) return json;
        return migrateV1Project(json);
    }

    const project    = { name: '', files: {} };
    const rootFolder = zip.files[Object.keys(zip.files)[0]]?.name.split('/')[0] || 'mod';
    project.name     = rootFolder;

    const allFiles = Object.entries(zip.files).filter(([, f]) => !f.dir);
    const total    = allFiles.length;

    for (let idx = 0; idx < total; idx++) {
        const [zipPath, zipFile] = allFiles[idx];
        const relPath  = zipPath.replace(rootFolder + '/', '');
        const filename = relPath.split('/').pop().toLowerCase();

        prog(5 + Math.round((idx / total) * 90),
             relPath.length > 45 ? '...' + relPath.slice(-42) : relPath);

        if (idx % 50 === 0) await new Promise(r => setTimeout(r, 0));

        if (filename.endsWith('.dds')) {
            const buf = await zipFile.async('arraybuffer');
            project.files[relPath] = { type: 'dds', base64: _arrayBufferToBase64Io(buf), filename };
            continue;
        }
        if (['.png','.jpg','.jpeg','.bmp','.tga'].some(e => filename.endsWith(e))) {
            const buf = await zipFile.async('arraybuffer');
            project.files[relPath] = { type: 'image', base64: _arrayBufferToBase64Io(buf), filename };
            continue;
        }
        if (filename.endsWith('.gfx')) {
            project.files[relPath] = { type: 'gfx_define', sprites: parseGfxFile(await zipFile.async('string')) };
            continue;
        }
        if (filename.endsWith('.gui')) {
            project.files[relPath] = { type: 'gui', raw: await zipFile.async('string') };
            continue;
        }
        const content = await zipFile.async('string');
        const type    = detectFileType(filename, content, relPath);
        if (!type) continue;

        if (type === 'national_focus') {
            const parsed = parseFocusFile(content);
            if (parsed) project.files[relPath] = { type, ...parsed };
        } else if (type === 'localisation') {
            const parsed = parseLocalisationFile(content, filename);
            if (parsed) project.files[relPath] = { type, lang: parsed.lang, data: parsed.data };
        } else {
            project.files[relPath] = { type, raw: content };
        }
    }

    prog(100, `완료 — ${Object.keys(project.files).length}개 파일`);
    return project;
}

// ── ArrayBuffer → base64 헬퍼 ────────────────────────────
function _arrayBufferToBase64Io(buf) {
    const bytes = new Uint8Array(buf);
    let binary  = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk)
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}
