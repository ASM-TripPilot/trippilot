const controls = [
  'previous-slide', 'next-slide', 'toggle-overview', 'toggle-notes',
  'toggle-fullscreen', 'print-slides', 'toggle-reading', 'slide-select',
  'slide-count', 'slide-progress', 'overview', 'overview-list', 'close-overview',
];

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.open = false;
    this.textContent = '';
    this.value = '';
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const present = force === undefined ? !this.classes.has(name) : force;
        if (present) this.classes.add(name);
        else this.classes.delete(name);
        return present;
      },
    };
  }

  addEventListener(name, callback) {
    this.listeners[name] = [...(this.listeners[name] || []), callback];
  }

  emit(name, properties = {}) {
    const event = {
      target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const callback of this.listeners[name] || []) callback(event);
    return event;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'open') this.open = true;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'open') this.open = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  querySelector() { return this.heading || null; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }

  closest(selector) {
    return selector.split(',').some((part) => {
      const token = part.trim();
      if (token === '[contenteditable]') return this.hasAttribute('contenteditable');
      if (token.startsWith('[role=')) return this.getAttribute('role') === 'button';
      return token.toUpperCase() === this.tagName;
    }) ? this : null;
  }
}

function createFixture({ hash = '', count = 3, fullscreen = true } = {}) {
  const document = new FakeElement();
  const elements = Object.fromEntries(controls.map((id) => [id,
    new FakeElement(id === 'slide-select' ? 'select' : 'button', id)]));
  const slides = Array.from({ length: count }, (_, index) => {
    const slide = new FakeElement('section', `slide-${index + 1}`);
    slide.dataset = { chapter: index === 0 ? '시작' : 'Terraform' };
    slide.heading = new FakeElement(index === 0 ? 'h1' : 'h2');
    slide.heading.textContent = `슬라이드 ${index + 1}`;
    return slide;
  });
  document.documentElement = new FakeElement('html');
  document.body = new FakeElement('body');
  document.getElementById = (id) => elements[id] || slides.find((slide) => slide.id === id);
  document.querySelectorAll = () => slides;
  document.createElement = (tag) => {
    const element = new FakeElement(tag);
    element.ownerDocument = document;
    return element;
  };
  for (const element of [...Object.values(elements), ...slides, ...slides.map((s) => s.heading),
    document.documentElement, document.body]) element.ownerDocument = document;
  const window = new FakeElement();
  window.location = { hash };
  window.print = () => { window.printed = true; };
  if (fullscreen) {
    document.documentElement.requestFullscreen = async () => {
      document.fullscreenElement = document.documentElement;
      document.emit('fullscreenchange');
    };
    document.exitFullscreen = async () => {
      document.fullscreenElement = null;
      document.emit('fullscreenchange');
    };
  }
  return { document, window, elements, slides };
}

module.exports = { createFixture, FakeElement };
