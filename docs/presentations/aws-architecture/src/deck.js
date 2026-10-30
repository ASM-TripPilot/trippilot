/* TripPilot 인프라 덱 공용 컨트롤러
   - 1920x1080 아트보드를 창에 맞게 스케일
   - 키보드(←→ ↑↓ Space PageUp/Down Home End) · 휠 · 스와이프 · 클릭 이동
   - #번호 해시 동기화, 진행바, 다이어그램 확대 보기(data-zoom), F 전체화면 */
(() => {
  const WHEEL_COOLDOWN_MS = 700;
  const SWIPE_MIN_PX = 50;
  const HINT_VISIBLE_MS = 4500;

  class Deck {
    constructor(root) {
      this.root = root;
      this.slides = Array.from(root.querySelectorAll('.slide'));
      this.index = 0;
      this.lastWheel = 0;
      this.progress = document.querySelector('.progress i');
      this.lightbox = document.querySelector('.lightbox');
      this.decorate();
      this.bind();
      this.fit();
      this.go(this.fromHash(), false);
    }

    decorate() {
      const total = String(this.slides.length).padStart(2, '0');
      this.slides.forEach((slide, i) => {
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-roledescription', '슬라이드');
        slide.setAttribute('aria-label', `${i + 1} / ${this.slides.length}`);
        const count = slide.querySelector('.chrome .count');
        if (count) count.textContent = `${String(i + 1).padStart(2, '0')} / ${total}`;
      });
    }

    fit() {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      this.root.style.transformOrigin = '50% 50%';
      this.root.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }

    fromHash() {
      const n = parseInt(location.hash.replace('#', ''), 10);
      return Number.isFinite(n) ? Math.min(Math.max(n - 1, 0), this.slides.length - 1) : 0;
    }

    go(target, pushHash = true) {
      const next = Math.min(Math.max(target, 0), this.slides.length - 1);
      this.slides.forEach((slide, i) => {
        const active = i === next;
        slide.classList.toggle('active', active);
        slide.setAttribute('aria-hidden', String(!active));
      });
      this.index = next;
      if (this.progress) this.progress.style.width = `${((next + 1) / this.slides.length) * 100}%`;
      if (pushHash) history.replaceState(null, '', `#${next + 1}`);
    }

    next() { this.go(this.index + 1); }
    prev() { this.go(this.index - 1); }

    openZoom(src) {
      if (!this.lightbox) return;
      this.lightbox.querySelector('img').src = src;
      this.lightbox.classList.add('open');
      this.lightbox.focus();
    }

    closeZoom() { this.lightbox && this.lightbox.classList.remove('open'); }

    get zoomOpen() { return Boolean(this.lightbox && this.lightbox.classList.contains('open')); }

    bind() {
      window.addEventListener('resize', () => this.fit());
      window.addEventListener('hashchange', () => this.go(this.fromHash(), false));

      document.addEventListener('keydown', (e) => {
        if (this.zoomOpen) { if (e.key === 'Escape') this.closeZoom(); return; }
        const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
        const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
        if (forward.includes(e.key)) { e.preventDefault(); this.next(); }
        else if (back.includes(e.key)) { e.preventDefault(); this.prev(); }
        else if (e.key === 'Home') this.go(0);
        else if (e.key === 'End') this.go(this.slides.length - 1);
        else if (e.key === 'f' || e.key === 'F') {
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen?.();
        }
      });

      window.addEventListener('wheel', (e) => {
        if (this.zoomOpen) return;
        const now = Date.now();
        if (now - this.lastWheel < WHEEL_COOLDOWN_MS || Math.abs(e.deltaY) < 8) return;
        this.lastWheel = now;
        if (e.deltaY > 0) this.next(); else this.prev();
      }, { passive: true });

      let startX = null;
      window.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
      window.addEventListener('touchend', (e) => {
        if (startX === null || this.zoomOpen) return;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > SWIPE_MIN_PX) { if (dx < 0) this.next(); else this.prev(); }
        startX = null;
      });

      document.addEventListener('click', (e) => {
        const zoom = e.target.closest('[data-zoom]');
        if (zoom) { this.openZoom(zoom.dataset.zoom || zoom.currentSrc); return; }
        if (this.zoomOpen) { this.closeZoom(); return; }
        if (e.target.closest('a, button')) return;
        if (e.clientX < window.innerWidth * 0.25) this.prev(); else this.next();
      });

      const hint = document.querySelector('.hint');
      if (hint) setTimeout(() => hint.classList.add('gone'), HINT_VISIBLE_MS);
    }
  }

  /* ?qa — 빌드 검사용. 스케일을 끄고 모든 슬라이드에서 1920x1080 밖으로 나간 요소와
     .pad 영역을 넘친 내용을 찾아 body[data-qa] 에 JSON 으로 남긴다(build.py 가 읽는다). */
  function runQa(root) {
    const report = [];
    root.querySelectorAll('.slide').forEach((slide, i) => {
      const box = slide.getBoundingClientRect();
      const pad = slide.querySelector('.pad');
      if (pad && pad.scrollHeight > pad.clientHeight + 2) {
        report.push({ slide: i + 1, issue: 'pad-overflow', by: pad.scrollHeight - pad.clientHeight });
      }
      slide.querySelectorAll('.pad *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const over = Math.max(r.right - box.left - 1920, r.bottom - box.top - 1080);
        if (over > 1) report.push({ slide: i + 1, issue: 'out-of-slide', el: el.tagName + '.' + el.className, by: Math.round(over) });
      });
    });
    document.body.dataset.qa = JSON.stringify(report);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('.deck');
    if (new URLSearchParams(location.search).has('qa')) {
      root.style.transform = 'none';
      root.style.left = '0';
      root.style.top = '0';
      const still = document.createElement('style');
      still.textContent = '.rv{transform:none!important;transition:none!important}';
      document.head.appendChild(still);
      document.fonts.ready.then(() => runQa(root));
      return;
    }
    new Deck(root);
  });
})();
