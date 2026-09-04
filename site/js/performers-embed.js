// Performers accordion for the organizers' Squarespace site (www.midwaymusicandart.org).
//
// Loaded by a one-line code block on that page; it does not run on this site.
// Classic script, no imports: it executes on a foreign origin outside this
// repo's module graph. It reads the same validated content.json the festival
// app reads, so a sheet edit reaches both without anyone touching Squarespace.
//
// How it renders: it clones the accordion item the organizers authored in the
// Squarespace editor and fills a copy per performer. All styling therefore
// comes from Squarespace — this file adds no CSS and no classes of its own, so
// restyling the block in the editor restyles every generated item.
//
// Why it owns the toggle: Squarespace's accordion bundle binds a click handler
// to each item's button once, at init (website.components.accordion.visitor.js,
// `initialize()`), not by delegation on the container. Event listeners are not
// copied by cloneNode, so cloned items are inert under their JS — confirmed by
// console experiment on the live page, 2026-09-04. The open/close below is a
// faithful re-implementation of that bundle's `setItemOpen`, down to the 250ms
// curve and the pre-open measurement trick, and is guarded so a click can never
// double-fire if Squarespace ever does start handling clones.
//
// Fail closed: every step that can fail happens before the DOM is touched. On
// any failure the page keeps exactly what the organizers authored, because a
// half-rendered public page is worse than a stale one.

(() => {
  'use strict';

  // document.currentScript is only readable during synchronous execution.
  const SCRIPT =
    document.currentScript || document.querySelector('script[src*="performers-embed"]');

  const DEFAULT_CONTENT_URL = 'https://go.midwaymusicandart.org/data/content.json';
  const ID_PREFIX = 'performer-';
  const LOG = '[performers]';

  // Both taken from the Squarespace accordion bundle's setItemOpen.
  const ANIMATION_MS = 250;
  const EASING = 'cubic-bezier(0.66, 0, 0.34, 1.00)';

  // Role selectors, first match wins. Squarespace marks each role twice — a
  // BEM class and a data attribute — so either one surviving a redesign is
  // enough to keep finding it.
  const CONTAINER = ['.accordion-items-container', '[data-sqsp-block="accordion"] ul'];
  const ITEM = ['li.accordion-item', 'li'];
  const CLICK_TARGET = [
    '.accordion-item__click-target',
    '[data-sqsp-accordion-block-item-title] button',
    'button',
  ];
  const TITLE = ['.accordion-item__title', '[data-sqsp-accordion-block-item-title] span'];
  const BODY = ['.accordion-item__description', '[data-sqsp-accordion-block-item-description]'];
  const DROPDOWN = ['.accordion-item__dropdown', '[role="region"]'];
  const TOP_DIVIDER = ['.accordion-divider--top'];

  const first = (root, selectors) => {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  };

  const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  // ---------------------------------------------------------------- content

  /** Non-vendor events, alphabetical. Throws rather than render an empty list. */
  function performers(data) {
    const events = data && Array.isArray(data.events) ? data.events : null;
    if (!events) throw new Error('content.json has no events array');
    const list = events.filter(
      (event) => event && typeof event.id === 'string' && event.id && event.kind !== 'vendor',
    );
    if (!list.length) throw new Error('content.json has no non-vendor events');
    // 'base' folds case and accent together, which is what a name list wants:
    // "Émile" sorts next to "Emile" rather than after "Z".
    return list.sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), undefined, {
        sensitivity: 'base',
      }),
    );
  }

  /** Description text split into paragraphs. The sheet separates them with newlines. */
  const paragraphs = (description) =>
    String(description || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  /**
   * A link href only if it is one we are willing to put in the DOM. The build
   * already validates this column, but the sheet is untrusted content on
   * someone else's origin, so `javascript:` is rejected here too.
   */
  function safeHref(url) {
    const raw = String(url || '').trim();
    if (!raw) return null;
    let parsed;
    try {
      parsed = new URL(raw, location.href);
    } catch {
      return null;
    }
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  }

  // ------------------------------------------------------------------ items

  /**
   * The class Squarespace toggles to reveal a dropdown, derived from the
   * element's own class so a BEM rename carries through: `…__dropdown` ->
   * `…__dropdown--open`, and `--pre-open` for the offscreen height measurement.
   */
  function openClassFor(dropdown) {
    for (const name of dropdown.classList) {
      if (name.endsWith('__dropdown')) return name + '--open';
    }
    return 'accordion-item__dropdown--open';
  }

  const preOpenClassFor = (openClass) => openClass.replace(/--open$/, '--pre-open');

  /** The parts of an item this script fills in, or null if the markup lacks one. */
  function roles(item) {
    const button = first(item, CLICK_TARGET);
    const title = first(item, TITLE);
    const body = first(item, BODY);
    const dropdown = first(item, DROPDOWN);
    if (!button || !title || !body || !dropdown) return null;
    return { button, title, body, dropdown };
  }

  /** Forces a cloned item closed, in case the authored one was open. */
  function reset(item, parts) {
    const openClass = openClassFor(parts.dropdown);
    item.removeAttribute('data-is-open');
    item.removeAttribute('data-no-transition');
    parts.dropdown.classList.remove(openClass, preOpenClassFor(openClass));
    parts.dropdown.style.removeProperty('height');
    parts.dropdown.style.removeProperty('transition');
    parts.button.setAttribute('aria-expanded', 'false');
  }

  /**
   * One paragraph, shaped like whatever the organizers authored in the body so
   * their text styling applies. Always text, never innerHTML.
   */
  function paragraph(model, text) {
    const node = model ? model.cloneNode(false) : document.createElement('p');
    node.removeAttribute('id');
    node.textContent = text;
    return node;
  }

  /**
   * Squarespace's scroll-reveal animation marks elements with a pre-state
   * class (`preFade`, `preSlide`, …) that holds them at opacity 0 until its
   * engine adds the matching reveal class — and that engine only tracks
   * elements present at page init, so anything generated here would stay
   * invisible forever (bit on the live page 2026-09-04: every bio paragraph
   * inherited `preFade` and never faded in). Strip both halves and the
   * engine's inline transition; generated content is simply visible,
   * whatever the site's animation setting. The pre-class removal is the
   * load-bearing half — opacity 0 lives there — so an unrecognized reveal
   * variant costs nothing but a leftover class name.
   */
  const ANIMATION_PRE = /^pre[A-Z]/;
  const ANIMATION_REVEAL = /^(fade|slide|scale|flex|clip)In$/;
  function stripAnimationState(root) {
    for (const node of [root, ...root.querySelectorAll('*')]) {
      for (const name of [...node.classList]) {
        if (ANIMATION_PRE.test(name) || ANIMATION_REVEAL.test(name)) node.classList.remove(name);
      }
      for (const prop of ['transition-timing-function', 'transition-duration', 'transition-delay']) {
        node.style.removeProperty(prop);
      }
    }
  }

  function fillBody(body, event, model) {
    body.textContent = '';
    for (const text of paragraphs(event.description)) body.appendChild(paragraph(model, text));
    const href = safeHref(event.url);
    if (!href) return;
    const wrapper = paragraph(model, '');
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Website';
    link.setAttribute('aria-label', String(event.title || '') + ' website');
    wrapper.appendChild(link);
    body.appendChild(wrapper);
  }

  function buildItem(block, event, isFirst) {
    const item = block.template.cloneNode(true);
    const parts = roles(item);
    if (!parts) throw new Error('cloned item lost a role element');

    // Cloning duplicates the authored ids; replace them all with ours so the
    // aria wiring points at this item and nothing else.
    for (const node of item.querySelectorAll('[id]')) node.removeAttribute('id');
    item.id = ID_PREFIX + event.id;
    parts.button.id = 'button-' + item.id;
    parts.dropdown.id = 'dropdown-' + item.id;
    parts.button.setAttribute('aria-controls', parts.dropdown.id);
    parts.dropdown.setAttribute('aria-labelledby', parts.button.id);

    reset(item, parts);
    parts.title.textContent = String(event.title || '');
    fillBody(parts.body, event, block.paragraphModel);

    // Squarespace emits the top divider on the first item only; every item
    // carrying one would double the rule between items.
    if (!isFirst) {
      const divider = first(item, TOP_DIVIDER);
      if (divider) divider.remove();
    }

    stripAnimationState(item);

    parts.button.addEventListener('click', (clickEvent) => onClick(block, item, clickEvent));
    return item;
  }

  // ---------------------------------------------------------------- toggling

  function onClick(block, item, clickEvent) {
    if (clickEvent.__mmafPerformersHandled) return;
    clickEvent.__mmafPerformersHandled = true;
    clickEvent.preventDefault();
    // Squarespace binds per item at init and so never sees a clone. If that
    // ever changes, these stop a second handler from toggling the item back:
    // stopImmediatePropagation covers another listener on this same button
    // (ours is registered first, so it runs first), stopPropagation covers a
    // delegated listener on any ancestor.
    clickEvent.stopPropagation();
    if (clickEvent.stopImmediatePropagation) clickEvent.stopImmediatePropagation();
    toggleItem(block, item);
  }

  function toggleItem(block, item) {
    if (block.animations.size > 0) return; // as the native bundle does
    const dropdown = first(item, DROPDOWN);
    if (!dropdown) return;
    const isOpen = item.getAttribute('data-is-open') === 'true';
    if (isOpen) {
      setItemOpen(block, item, dropdown, false);
      return;
    }
    const allowMultiple =
      block.container.getAttribute('data-should-allow-multiple-open-items') === 'true';
    if (!allowMultiple) {
      for (const other of block.items.values()) {
        if (other !== item && other.getAttribute('data-is-open') === 'true') {
          const otherDropdown = first(other, DROPDOWN);
          if (otherDropdown) setItemOpen(block, other, otherDropdown, false);
        }
      }
    }
    setItemOpen(block, item, dropdown, true);
  }

  /**
   * The native bundle's setItemOpen. Animated on a click; the bundle's own
   * instant path is used instead when the visitor asked for reduced motion —
   * the stylesheet tries to suppress the transition there but the animated path
   * sets it inline, which wins.
   */
  function setItemOpen(block, item, dropdown, open) {
    const button = first(item, CLICK_TARGET);
    const openClass = openClassFor(dropdown);
    const applyState = () => {
      if (open) item.setAttribute('data-is-open', 'true');
      else item.removeAttribute('data-is-open');
      if (button) button.setAttribute('aria-expanded', String(open));
    };

    if (block.reducedMotion && block.reducedMotion.matches) {
      item.setAttribute('data-no-transition', '');
      void item.offsetWidth; // flush the attribute before the class flips
      applyState();
      dropdown.classList.toggle(openClass, open);
      nextFrame(() => item.removeAttribute('data-no-transition'));
      return;
    }

    applyState();
    let from;
    let to;
    if (open) {
      // Measure the natural height offscreen, then animate to it.
      dropdown.classList.add(preOpenClassFor(openClass));
      to = dropdown.getBoundingClientRect().height;
      dropdown.classList.remove(preOpenClassFor(openClass));
      from = 0;
    } else {
      from = dropdown.getBoundingClientRect().height;
      to = 0;
    }
    dropdown.style.height = from + 'px';
    if (open) dropdown.classList.add(openClass);
    dropdown.style.transition = 'height ' + ANIMATION_MS + 'ms ' + EASING;
    nextFrame(() => {
      dropdown.style.height = to + 'px';
    });
    const timer = window.setTimeout(() => {
      if (!open) dropdown.classList.remove(openClass);
      dropdown.style.removeProperty('height');
      dropdown.style.removeProperty('transition');
      block.animations.delete(timer);
      if (block.animations.size === 0 && block.pendingHash) applyHash(block);
    }, ANIMATION_MS);
    block.animations.add(timer);
  }

  // --------------------------------------------------------------- deep link

  /** #performer-<event id> opens that item the way a click does, and scrolls to it. */
  function applyHash(block) {
    block.pendingHash = null;
    let id = '';
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return; // malformed percent-encoding
    }
    const item = block.items.get(id);
    if (!item) return;
    // A click during an animation is dropped, by design, in the native bundle
    // and here. A deep link has no one to click again, so it waits its turn.
    if (block.animations.size > 0) {
      block.pendingHash = id;
      return;
    }
    if (item.getAttribute('data-is-open') !== 'true') {
      const button = first(item, CLICK_TARGET);
      if (button) button.click();
    }
    item.scrollIntoView();
  }

  // ----------------------------------------------------------------- render

  function findContainer(selector) {
    if (selector) {
      const root = document.querySelector(selector);
      if (!root) return null;
      return CONTAINER.some((s) => root.matches(s)) ? root : first(root, CONTAINER);
    }
    return first(document, CONTAINER);
  }

  function render(data, selector) {
    const events = performers(data);

    const container = findContainer(selector);
    if (!container) throw new Error('no accordion block found on this page');
    const authored = [];
    for (const child of container.children) {
      if (ITEM.some((s) => child.matches(s))) authored.push(child);
    }
    const template = authored[0];
    if (!template) throw new Error('the accordion has no item to clone');
    const parts = roles(template);
    if (!parts) throw new Error('the accordion item is missing a title or a description');

    const block = {
      container,
      template,
      // Body text keeps the authored paragraph's tag and classes when there is one.
      paragraphModel: parts.body.firstElementChild,
      items: new Map(),
      animations: new Set(),
      pendingHash: null,
      reducedMotion:
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : null,
    };

    const fragment = document.createDocumentFragment();
    events.forEach((event, index) => {
      const item = buildItem(block, event, index === 0);
      block.items.set(item.id, item);
      fragment.appendChild(item);
    });

    // Everything that can fail has failed by now. These two statements run in
    // one task, so the browser never paints the authored items alongside the
    // generated ones.
    for (const item of authored) {
      item.hidden = true;
      item.style.display = 'none';
    }
    container.appendChild(fragment);

    applyHash(block);
    window.addEventListener('hashchange', () => applyHash(block));
    return block.items.size;
  }

  const contentUrl = (SCRIPT && SCRIPT.getAttribute('data-content-url')) || DEFAULT_CONTENT_URL;
  const accordionSelector = SCRIPT && SCRIPT.getAttribute('data-accordion');

  const start = () => {
    fetch(contentUrl, { credentials: 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error('content.json returned HTTP ' + response.status);
        return response.json();
      })
      .then((data) => {
        const count = render(data, accordionSelector);
        console.info(LOG, count + ' performers rendered from ' + contentUrl);
      })
      .catch((error) => {
        console.warn(LOG, 'leaving the page as authored:', error && error.message ? error.message : error);
      });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
