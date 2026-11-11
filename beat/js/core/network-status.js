// 오프라인 배너 — 네트워크가 끊기면 화면 위쪽에 작은 알림을 띄우고, 복구되면 잠깐 안내 후 숨긴다.
// 기존 화면/로직은 건드리지 않는 독립 모듈(요소를 직접 만들어 body에 붙인다).
// - 플레이 중(UI.currentScreen === 'playing')에는 게임을 가리지 않도록 숨겨둔다.
// - 서비스워커/오프라인 캐시는 아직 없으므로 "안내"만 한다. 온라인 라이브러리·저장·멀티플레이가 대상.
const NetworkStatus = {
    _el: null,
    _hideTimer: null,
    _watchTimer: null,
    _offline: false,

    init() {
        this._el = document.createElement('div');
        this._el.id = 'network-banner';
        this._el.className = 'network-banner hidden';
        this._el.setAttribute('role', 'status');
        this._el.setAttribute('aria-live', 'polite');
        document.body.appendChild(this._el);

        window.addEventListener('offline', () => this._setOffline(true));
        window.addEventListener('online', () => this._setOffline(false));
        if (!navigator.onLine) this._setOffline(true);
    },

    _text(key, fallback) {
        return (typeof I18n !== 'undefined' && I18n.t) ? I18n.t(key) : fallback;
    },

    _setOffline(isOffline) {
        if (this._offline === isOffline) return;
        this._offline = isOffline;
        clearTimeout(this._hideTimer);
        clearInterval(this._watchTimer);
        const el = this._el;
        if (isOffline) {
            el.classList.remove('network-banner--ok');
            el.textContent = this._text('offline_banner', '오프라인 상태예요. 온라인 라이브러리·저장·멀티플레이는 연결이 필요해요.');
            // 오프라인인 동안에만 화면 전환을 감시해서, 플레이 중에는 배너를 숨긴다
            const sync = () => el.classList.toggle('hidden', typeof UI !== 'undefined' && UI.currentScreen === 'playing');
            sync();
            this._watchTimer = setInterval(sync, 1000);
        } else {
            el.classList.add('network-banner--ok');
            el.textContent = this._text('online_restored', '다시 연결되었어요.');
            el.classList.remove('hidden');
            this._hideTimer = setTimeout(() => el.classList.add('hidden'), 3000);
        }
    },
};

document.addEventListener('DOMContentLoaded', () => NetworkStatus.init());
