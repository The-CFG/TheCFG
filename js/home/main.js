// ════════════════════════════════════════════════
// 도구 목록 — 새 서브페이지를 추가할 때는
// 이 배열에 항목 하나만 추가하면 카드가 자동 생성됩니다.
// ════════════════════════════════════════════════
const TOOLS = [
    {
        path: '/hoi4',
        title: 'HOI4 Mod Editor',
        version: 'v0.8',
        desc: '기존 edge.hoi4modding.com을 대체하는 용도로 제작되었습니다. 계속 업데이트 중입니다.',
        href: 'hoi4.html',
        status: 'live', // live | planned
    },
    {
        path: '/beat',
        title: 'TheBeat',
        version: 'v2.0',
        desc: '웹 리듬게임입니다. 지금은 파일 업/다운로드 시스템이지만 조만간 서버 시스템을 구축하겠습니다.',
        href: 'beat.html',
        status: 'live',
    },
    {
        path: '/???',
        title: '다음 도구',
        version: '',
        desc: '새로운 도구가 만들어지면 이 자리에 추가됩니다.',
        href: null,
        status: 'planned',
    },
];

function renderTools() {
    const grid = document.getElementById('tool-grid');
    if (!grid) return;
    grid.innerHTML = '';

    TOOLS.forEach((tool, i) => {
        const isLive = tool.status === 'live';
        const card = document.createElement(isLive ? 'a' : 'div');

        card.className = `tool-card ${isLive ? 'is-live' : 'is-planned'}`;
        card.style.setProperty('--i', i);
        if (isLive) {
            card.href = tool.href;
            card.setAttribute('aria-label', `${tool.title} 열기`);
        }

        const statusLabel = isLive ? '온라인' : '준비 중';

        card.innerHTML = `
            <div class="tool-card-top">
                <span class="tool-path">${tool.path}</span>
                <span class="tool-status">${statusLabel}</span>
            </div>
            <h3 class="tool-title">${tool.title}</h3>
            <p class="tool-desc">${tool.desc}</p>
            <div class="tool-card-bottom">
                <span class="tool-version">${tool.version}</span>
                ${isLive ? '<span class="tool-link">열기 →</span>' : ''}
            </div>
        `;

        grid.appendChild(card);
    });
}

function renderYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
}

renderTools();
renderYear();
