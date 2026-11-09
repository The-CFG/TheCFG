// Icon: /assets/icons.svg 스프라이트(Lucide) 아이콘을 JS에서 쉽게 쓰기 위한 헬퍼.
//   Icon.html('users')          → innerHTML 템플릿에 끼워 넣는 <svg> 문자열
//   Icon.el('users')            → append()/replaceChildren()에 넘기는 <svg> 요소 (textContent 대신 쓸 때)
// 새 아이콘은 assets/icons.svg에 <symbol id="i-이름">을 추가하면 된다.
const Icon = {
    html(name, extraCls = '') {
        return `<svg class="icon${extraCls ? ' ' + extraCls : ''}" aria-hidden="true"><use href="/assets/icons.svg#i-${name}"/></svg>`;
    },
    el(name, extraCls = '') {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'icon' + (extraCls ? ' ' + extraCls : ''));
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(NS, 'use');
        use.setAttribute('href', `/assets/icons.svg#i-${name}`);
        svg.appendChild(use);
        return svg;
    }
};