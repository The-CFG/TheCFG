#!/usr/bin/env node
// TheCFG 폴더 구조 변경: css/<proj>, js/<proj>  →  <proj>/css, <proj>/js
//   css/beat  → beat/css      js/beat  → beat/js
//   css/hoi4  → hoi4/css      js/hoi4  → hoi4/js
//   css/limbus→ limbus/css    js/limbus→ limbus/js
//   css/home  → home/css      js/home  → home/js   (/, accounts, profiles, confirmed 공용)
//   css/favicon.png → assets/favicon.png            (전체 공용)
// 사용: 레포 루트에서  node restructure.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const dry = process.argv.includes('--dry');
const useGit = fs.existsSync(path.join(root, '.git'));
const PROJECTS = ['beat', 'hoi4', 'limbus', 'home'];

const moves = [['css/favicon.png', 'assets/favicon.png']];
for (const p of PROJECTS) moves.push([`css/${p}`, `${p}/css`], [`js/${p}`, `${p}/js`]);

// 1) 이동
for (const [from, to] of moves) {
  const src = path.join(root, from), dst = path.join(root, to);
  if (!fs.existsSync(src)) { console.log(`skip (없음)  ${from}`); continue; }
  if (fs.existsSync(dst)) { console.error(`중단: 이미 존재 ${to}`); process.exit(1); }
  console.log(`move  ${from}  ->  ${to}`);
  if (dry) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let done = false;
  if (useGit) {
    // git이 PATH에 없거나 실패하면 일반 이동으로 대체 (커밋 시 git이 이름 변경을 알아서 감지함)
    try { execSync(`git mv "${from}" "${to}"`, { cwd: root, stdio: 'pipe' }); done = true; } catch { /* fallback */ }
  }
  if (!done) fs.renameSync(src, dst);
}
if (!dry) for (const d of ['css', 'js']) {
  const dp = path.join(root, d);
  if (fs.existsSync(dp) && fs.readdirSync(dp).length === 0) fs.rmdirSync(dp);
}

// 2) 경로 문자열 치환 (코드 + 주석 + README)
const SKIP = new Set(['node_modules', '.git', 'supabase']);
const EXT = new Set(['.html', '.js', '.css', '.md', '.toml']);
const re = new RegExp(`\\b(css|js)/(${PROJECTS.join('|')})/`, 'g');
function rewrite(t) {
  return t.replace(/\bcss\/favicon\.png/g, 'assets/favicon.png').replace(re, '$2/$1/');
}
let changed = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!EXT.has(path.extname(e.name)) || e.name === 'package-lock.json') continue;
    const before = fs.readFileSync(p, 'utf8'), after = rewrite(before);
    if (before !== after) { changed++; console.log(`edit  ${path.relative(root, p)}`); if (!dry) fs.writeFileSync(p, after); }
  }
})(root);
console.log(`\n수정된 파일 ${changed}개`);

// 3) 검증: HTML의 절대경로 src/href 와 JS의 fetch('/...') 대상이 실제로 존재하는지
if (!dry) {
  let missing = 0;
  const check = (file, ref) => {
    const clean = ref.split(/[?#]/)[0];
    if (!/\.(js|css|png|json|svg|ico|jpg|webp)$/.test(clean)) return;
    if (!fs.existsSync(path.join(root, clean))) { missing++; console.log(`누락  ${path.relative(root, file)} -> ${ref}`); }
  };
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const ext = path.extname(e.name);
      if (ext !== '.html' && ext !== '.js') continue;
      const t = fs.readFileSync(p, 'utf8');
      const rx = ext === '.html' ? /(?:src|href)="(\/[^"\/][^"]*)"/g : /fetch\(\s*["'`](\/[^"'`$]+)["'`]/g;
      for (const m of t.matchAll(rx)) check(p, m[1]);
    }
  })(root);
  console.log(missing ? `\n⚠ 누락 ${missing}건` : '\n✔ 모든 참조 경로 확인 완료');
}
