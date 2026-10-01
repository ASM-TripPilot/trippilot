/* Offline presentation controls. Load with <script defer src="...">. */
(() => {
  'use strict';

  function indexFromHash(slides, location) {
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return 0;
      return slides.findIndex((slide) => slide.id === id ||
        (slide.getAttribute('data-aliases') || '').split(' ').includes(id));
    } catch {
      return -1;
    }
  }

  function getControls(document) {
    const ids = {
      previous: 'previous-slide', next: 'next-slide', overviewToggle: 'toggle-overview',
      notes: 'toggle-notes', fullscreen: 'toggle-fullscreen', print: 'print-slides',
      reading: 'toggle-reading', select: 'slide-select', count: 'slide-count',
      progress: 'slide-progress', overview: 'overview', list: 'overview-list',
      close: 'close-overview',
    };
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)]));
  }

  function render({ document, slides, controls }, state) {
    slides.forEach((slide, index) => {
      const active = index === state.index;
      slide.hidden = !state.reading && !active;
      slide.classList.toggle('is-active', active);
      if (active) slide.setAttribute('aria-current', 'step');
      else slide.removeAttribute('aria-current');
    });
    controls.previous.disabled = state.index === 0;
    controls.next.disabled = state.index === slides.length - 1;
    controls.select.value = slides[state.index].id;
    controls.count.textContent = `${state.index + 1} / ${slides.length}`;
    controls.progress.max = slides.length;
    controls.progress.value = state.index + 1;
    controls.notes.setAttribute('aria-pressed', String(state.notes));
    controls.reading.setAttribute('aria-pressed', String(state.reading));
    document.body.classList.toggle('show-notes', state.notes);
    document.body.classList.toggle('reading-mode', state.reading);
  }

  function setupOverview({ document, slides, controls }, navigate) {
    const close = (restoreFocus = true) => {
      if (typeof controls.overview.close === 'function') controls.overview.close();
      else controls.overview.removeAttribute('open');
      controls.overviewToggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus) controls.overviewToggle.focus();
    };
    controls.select.replaceChildren();
    controls.list.replaceChildren();
    slides.forEach((slide, index) => {
      const heading = slide.querySelector('h1, h2');
      const label = `${index + 1}. ${heading ? heading.textContent.trim() : slide.id}`;
      const option = document.createElement('option');
      option.value = slide.id;
      option.textContent = label;
      controls.select.append(option);
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${encodeURIComponent(slide.id)}`;
      link.textContent = label;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        close(false);
        navigate(index);
      });
      item.append(link);
      controls.list.append(item);
    });
    controls.overviewToggle.setAttribute('aria-expanded', 'false');
    controls.overviewToggle.addEventListener('click', () => {
      if (controls.overview.open) return close();
      if (typeof controls.overview.showModal === 'function') controls.overview.showModal();
      else controls.overview.setAttribute('open', '');
      controls.overviewToggle.setAttribute('aria-expanded', 'true');
      controls.close.focus();
    });
    controls.close.addEventListener('click', () => close());
    controls.overview.addEventListener('close', () => controls.overviewToggle.setAttribute('aria-expanded', 'false'));
    controls.overview.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
  }

  function setupNavigation(context, getState, navigate) {
    const { document, window, slides, controls } = context;
    controls.previous.addEventListener('click', () => navigate(getState().index - 1));
    controls.next.addEventListener('click', () => navigate(getState().index + 1));
    controls.select.addEventListener('change', () => {
      const index = slides.findIndex((slide) => slide.id === controls.select.value);
      if (index >= 0) navigate(index);
    });
    window.addEventListener('hashchange', () => {
      const index = indexFromHash(slides, window.location);
      if (index >= 0) navigate(index, false);
    });
    document.addEventListener('keydown', (event) => {
      const state = getState();
      if (state.reading || controls.overview.open || event.defaultPrevented ||
        event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key !== ' ')) return;
      const interactive = 'input, select, textarea, button, a, summary, [contenteditable], [role="button"]';
      if (event.target.closest && event.target.closest(interactive)) return;
      const destinations = {
        ArrowLeft: state.index - 1, PageUp: state.index - 1,
        ArrowRight: state.index + 1, PageDown: state.index + 1,
        ' ': state.index + (event.shiftKey ? -1 : 1), Home: 0, End: slides.length - 1,
      };
      if (!Object.hasOwn(destinations, event.key)) return;
      event.preventDefault();
      navigate(destinations[event.key]);
    });
  }

  function setupFullscreen({ document, controls }) {
    const button = controls.fullscreen;
    button.setAttribute('aria-pressed', 'false');
    if (typeof document.documentElement.requestFullscreen !== 'function') {
      button.disabled = true;
      button.title = '이 브라우저에서는 전체 화면을 지원하지 않습니다.';
      return;
    }
    button.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        button.title = '브라우저가 전체 화면 전환을 허용하지 않았습니다.';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      button.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    });
  }

  function initPresentation(document, window) {
    const slides = Array.from(document.querySelectorAll('#deck .slide'));
    const controls = getControls(document);
    if (!slides.length || Object.values(controls).some((control) => !control)) return;
    const context = { document, window, slides, controls };
    let state = { index: Math.max(0, indexFromHash(slides, window.location)), notes: false, reading: false };
    const update = (changes) => {
      state = { ...state, ...changes };
      render(context, state);
    };
    const navigate = (index, writeHash = true) => {
      update({ index: Math.max(0, Math.min(slides.length - 1, index)) });
      const slide = slides[state.index];
      const hash = `#${encodeURIComponent(slide.id)}`;
      if (writeHash && window.location.hash !== hash) window.location.hash = hash;
      if (state.reading) slide.scrollIntoView({ block: 'start' });
      else slide.querySelector('h1, h2')?.focus({ preventScroll: true });
    };
    slides.forEach((slide) => {
      const heading = slide.querySelector('h1, h2');
      if (!heading) return;
      if (!heading.id) heading.id = `${slide.id}-title`;
      heading.setAttribute('tabindex', '-1');
      slide.setAttribute('aria-labelledby', heading.id);
    });
    controls.count.setAttribute('aria-live', 'polite');
    controls.count.setAttribute('aria-atomic', 'true');
    setupOverview(context, navigate);
    setupNavigation(context, () => state, navigate);
    setupFullscreen(context);
    controls.notes.addEventListener('click', () => update({ notes: !state.notes }));
    controls.reading.addEventListener('click', () => {
      update({ reading: !state.reading });
      if (state.reading) slides[state.index].scrollIntoView({ block: 'start' });
    });
    controls.print.addEventListener('click', () => window.print());
    render(context, state);
    document.documentElement.classList.add('presentation');
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { initPresentation };
  if (typeof document !== 'undefined') initPresentation(document, window);
})();
