#!/usr/bin/env node
// 모든 페이지의 </head> 앞에 공지 배너 스크립트 태그를 추가한다. 이미 있으면 건너뛴다(여러 번 실행해도 안전).
//   사용: 레포 루트에서  node add-announcement.mjs [--dry]
import fs from 'fs';

const dry = process.argv.includes('--dry');
const PAGES = ['index.html', 'beat/index.html', 'hoi4/index.html', 'limbus/index.html',
               'accounts/index.html', 'profiles/index.html', 'confirmed/index.html'];
const TAG = '    <script defer src="/assets/announcement.js"></script><!-- 사이트 공지 배너 (Supabase site_announcements) -->\n';

for (const p of PAGES) {
  if (!fs.existsSync(p)) { console.log(`skip (없음)  ${p}`); continue; }
  const s = fs.readFileSync(p, 'utf8');
  if (s.includes('/assets/announcement.js')) { console.log(`이미 있음   ${p}`); continue; }
  if (s.split('</head>').length !== 2) { console.warn(`⚠ </head>가 1개가 아님, 건너뜀: ${p}`); continue; }
  console.log(`추가        ${p}`);
  if (!dry) fs.writeFileSync(p, s.replace('</head>', TAG + '</head>'));
}
