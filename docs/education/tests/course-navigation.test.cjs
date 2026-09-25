const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { createFixture, FakeElement } = require('./dom-fixture.cjs');
const { initPresentation } = require('../assets/course-navigation.js');

function setup(options) {
  const fixture = createFixture(options);
  initPresentation(fixture.document, fixture.window);
  return fixture;
}

test('progressively enhances slides with accessible controls and a generated overview', () => {
  const { document, elements, slides } = setup();
  assert.equal(document.documentElement.classList.contains('presentation'), true);
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, true, true]);
  assert.equal(slides[0].classList.contains('is-active'), true);
  assert.equal(elements['previous-slide'].disabled, true);
  assert.equal(elements['next-slide'].disabled, false);
  assert.equal(elements['slide-count'].textContent, '1 / 3');
  assert.equal(elements['slide-progress'].max, 3);
  assert.equal(elements['slide-progress'].value, 1);
  assert.equal(elements['slide-select'].children.length, 3);
  assert.equal(elements['overview-list'].children.length, 3);
  assert.match(elements['overview-list'].children[1].children[0].textContent, /슬라이드 2/);
  assert.equal(slides[0].heading.getAttribute('tabindex'), '-1');
  assert.equal(slides[0].getAttribute('aria-labelledby'), slides[0].heading.id);
});

test('buttons and select navigate, update the hash, clamp boundaries, and focus the heading', () => {
  const { document, window, elements, slides } = setup();
  elements['next-slide'].emit('click');
  assert.equal(window.location.hash, '#slide-2');
  assert.equal(document.activeElement, slides[1].heading);
  assert.equal(elements['slide-select'].value, 'slide-2');
  elements['slide-select'].value = 'slide-3';
  elements['slide-select'].emit('change');
  assert.equal(elements['next-slide'].disabled, true);
  elements['next-slide'].emit('click');
  assert.equal(elements['slide-count'].textContent, '3 / 3');
  elements['previous-slide'].emit('click');
  assert.equal(elements['slide-count'].textContent, '2 / 3');
  elements['slide-select'].value = 'invalid';
  elements['slide-select'].emit('change');
  assert.equal(elements['slide-count'].textContent, '2 / 3');
});

test('deep links and hash changes select known slides; invalid fragments remain safe', () => {
  const { window, elements, slides } = setup({ hash: '#slide-3' });
  assert.equal(slides[2].hidden, false);
  window.location.hash = '#slide-1';
  window.emit('hashchange');
  assert.equal(elements['slide-count'].textContent, '1 / 3');
  for (const hash of ['#missing', '#%zz']) {
    window.location.hash = hash;
    window.emit('hashchange');
    assert.equal(elements['slide-count'].textContent, '1 / 3');
  }
  assert.equal(setup({ hash: '#%zz' }).slides[0].hidden, false);
});

test('browser Back to the initial empty hash restores the first slide', () => {
  const { window, elements } = setup();
  elements['next-slide'].emit('click');
  window.location.hash = '';
  window.emit('hashchange');
  assert.equal(elements['slide-count'].textContent, '1 / 3');
});

test('legacy bookmarks select their matching chapter without duplicating slides', () => {
  const fixture = createFixture({ hash: '#old-chapter' });
  fixture.slides[1].setAttribute('data-aliases', 'old-chapter second-alias');
  initPresentation(fixture.document, fixture.window);
  assert.equal(fixture.slides[1].hidden, false);
  fixture.window.location.hash = '#second-alias';
  fixture.window.emit('hashchange');
  assert.equal(fixture.elements['slide-count'].textContent, '2 / 3');
});

test('keyboard supports forward, backward, first and last slide shortcuts', () => {
  const { document, elements } = setup();
  for (const key of ['ArrowRight', 'PageDown', 'End']) {
    const event = document.emit('keydown', { key });
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(elements['slide-count'].textContent, '3 / 3');
  document.emit('keydown', { key: 'ArrowLeft' });
  document.emit('keydown', { key: 'PageUp' });
  assert.equal(elements['slide-count'].textContent, '1 / 3');
  document.emit('keydown', { key: ' ' });
  assert.equal(elements['slide-count'].textContent, '2 / 3');
  document.emit('keydown', { key: ' ', shiftKey: true });
  assert.equal(elements['slide-count'].textContent, '1 / 3');
  document.emit('keydown', { key: 'End' });
  document.emit('keydown', { key: 'Home' });
  assert.equal(elements['slide-count'].textContent, '1 / 3');
});

test('keyboard preserves native interactive controls, modifier shortcuts, and unrelated keys', () => {
  const { document, elements } = setup();
  const targets = ['input', 'select', 'textarea', 'button', 'a', 'summary'].map((tag) => new FakeElement(tag));
  const editable = new FakeElement();
  editable.setAttribute('contenteditable', 'true');
  targets.push(editable);
  for (const target of targets) {
    assert.equal(document.emit('keydown', { key: 'ArrowRight', target }).defaultPrevented, false);
  }
  for (const properties of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
    { defaultPrevented: true }, { key: 'x' }]) {
    document.emit('keydown', { key: 'ArrowRight', ...properties });
  }
  assert.equal(elements['slide-count'].textContent, '1 / 3');
});

test('overview opens, suspends global shortcuts, navigates links, and restores focus when closed', () => {
  const { document, elements } = setup();
  elements['toggle-overview'].emit('click');
  assert.equal(elements.overview.open, true);
  assert.equal(elements['toggle-overview'].getAttribute('aria-expanded'), 'true');
  document.emit('keydown', { key: 'End' });
  assert.equal(elements['slide-count'].textContent, '1 / 3');
  const event = elements['overview-list'].children[2].children[0].emit('click');
  assert.equal(event.defaultPrevented, true);
  assert.equal(elements.overview.open, false);
  assert.equal(elements['slide-count'].textContent, '3 / 3');
  elements['toggle-overview'].emit('click');
  elements['close-overview'].emit('click');
  assert.equal(document.activeElement, elements['toggle-overview']);
  assert.equal(elements['toggle-overview'].getAttribute('aria-expanded'), 'false');
});

test('overview closes using Escape or its toggle, including older dialog implementations', () => {
  const fixture = createFixture();
  fixture.elements.overview.showModal = undefined;
  fixture.elements.overview.close = undefined;
  initPresentation(fixture.document, fixture.window);
  const { elements } = fixture;
  elements['toggle-overview'].emit('click');
  assert.equal(elements.overview.open, true);
  elements.overview.emit('keydown', { key: 'x' });
  assert.equal(elements.overview.open, true);
  assert.equal(elements.overview.emit('keydown', { key: 'Escape' }).defaultPrevented, true);
  assert.equal(elements.overview.open, false);
  elements['toggle-overview'].emit('click');
  elements['toggle-overview'].emit('click');
  assert.equal(elements.overview.open, false);
});

test('notes and reading mode toggle; reading preserves scrolling and all slide visibility', () => {
  const { document, window, elements, slides } = setup();
  elements['toggle-notes'].emit('click');
  assert.equal(document.body.classList.contains('show-notes'), true);
  assert.equal(elements['toggle-notes'].getAttribute('aria-pressed'), 'true');
  elements['toggle-notes'].emit('click');
  assert.equal(document.body.classList.contains('show-notes'), false);
  elements['toggle-reading'].emit('click');
  assert.equal(document.body.classList.contains('reading-mode'), true);
  assert.equal(elements['toggle-reading'].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, false, false]);
  assert.equal(document.emit('keydown', { key: 'End' }).defaultPrevented, false);
  window.location.hash = '#slide-3';
  window.emit('hashchange');
  assert.equal(slides[2].scrolled, true);
  elements['toggle-reading'].emit('click');
  assert.deepEqual(slides.map((slide) => slide.hidden), [true, true, false]);
});

test('entering reading mode preserves the current slide in the viewport', () => {
  const { elements, slides } = setup({ hash: '#slide-3' });
  elements['toggle-reading'].emit('click');
  assert.equal(slides[2].scrolled, true);
});

test('print and fullscreen controls invoke the browser and reflect fullscreen changes', async () => {
  const { document, window, elements } = setup();
  elements['print-slides'].emit('click');
  assert.equal(window.printed, true);
  elements['toggle-fullscreen'].emit('click');
  await Promise.resolve();
  assert.equal(document.fullscreenElement, document.documentElement);
  assert.equal(elements['toggle-fullscreen'].getAttribute('aria-pressed'), 'true');
  elements['toggle-fullscreen'].emit('click');
  await Promise.resolve();
  assert.equal(document.fullscreenElement, null);
});

test('unavailable or denied fullscreen remains safe and exposes the reason', async () => {
  const unavailable = setup({ fullscreen: false });
  assert.equal(unavailable.elements['toggle-fullscreen'].disabled, true);
  const { document, elements } = setup();
  document.documentElement.requestFullscreen = async () => { throw new Error('denied'); };
  elements['toggle-fullscreen'].emit('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements['toggle-fullscreen'].title, /전체 화면/);
});

test('empty decks retain the readable fallback', () => {
  const { document } = setup({ count: 0 });
  assert.equal(document.documentElement.classList.contains('presentation'), false);
});

test('missing controls retain readable content rather than partially hiding slides', () => {
  const fixture = createFixture();
  delete fixture.elements['next-slide'];
  initPresentation(fixture.document, fixture.window);
  assert.equal(fixture.document.documentElement.classList.contains('presentation'), false);
  assert.deepEqual(fixture.slides.map((slide) => slide.hidden), [false, false, false]);
});

test('classic browser script initializes without CommonJS or a web server', () => {
  const fixture = createFixture({ hash: '#slide-2' });
  const source = readFileSync(require.resolve('../assets/course-navigation.js'), 'utf8');
  runInNewContext(source, { document: fixture.document, window: fixture.window });
  assert.equal(fixture.slides[1].classList.contains('is-active'), true);
  fixture.elements['next-slide'].emit('click');
  assert.equal(fixture.window.location.hash, '#slide-3');
});
