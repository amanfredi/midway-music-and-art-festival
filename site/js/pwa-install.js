// Install-to-home-screen affordance shown at the bottom of the Now view.
// Two paths, no third: Chromium's beforeinstallprompt flow, and an inline
// instructions sheet for iOS Safari (which has no install-prompt API at
// all). Hidden entirely once already standalone, or on browsers where
// neither path applies (e.g. desktop Firefox) — see BACKLOG.md "PWA
// platform" for the rationale (home-screen install is what exempts iOS
// storage from the 7-day ITP wipe; this button is the real durability
// feature for starred events, not navigator.storage.persist()).

import { openInstallInstructionsSheet } from './views/sheet.js';

let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true
  );
}

// `navigator.standalone` is WebKit-only and marks the browsers that will
// never fire beforeinstallprompt — but it is NOT iOS-only: macOS Safari
// exposes it too, and has its own install flow ("Add to Dock", Safari 17+).
// Telling them apart matters because the instruction steps differ, and
// showing a Mac user "Add to Home Screen" is simply wrong (QA, 2026-08-08).
//
// maxTouchPoints is the discriminator rather than a UA string: iPhone and
// iPad both report a nonzero value (iPadOS reports a Mac UA, so UA sniffing
// would misfile every iPad), and desktop Safari reports 0.
function safariFlavor() {
  if (typeof navigator.standalone !== 'boolean') return null;
  return navigator.maxTouchPoints > 0 ? 'ios' : 'macos';
}

function mode() {
  if (installed || isStandalone()) return null;
  if (deferredPrompt) return 'chromium';
  return safariFlavor();
}

/** Call once at startup. Wires the Chromium install-prompt lifecycle. */
export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
}

/** Subscribe to changes that affect whether/how the button should render. Returns an unsubscribe function. */
export function onInstallStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** HTML for the install button, or '' when it shouldn't show right now. */
export function installButtonHtml() {
  const m = mode();
  if (!m) return '';
  return `
    <div class="install-prompt">
      <button type="button" class="btn btn--secondary install-prompt__button" data-testid="install-button" data-install-mode="${m}">Install this app</button>
    </div>`;
}

/** Wire the click handler after inserting installButtonHtml() into the DOM. No-op if the button isn't present. */
export function bindInstallButton(container) {
  const btn = container.querySelector('[data-testid="install-button"]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const m = mode();
    if (m === 'chromium' && deferredPrompt) {
      const event = deferredPrompt;
      deferredPrompt = null;
      event.prompt();
      try {
        await event.userChoice;
      } catch {
        /* dismissed, or the browser doesn't support userChoice */
      }
      notify();
    } else if (m === 'ios' || m === 'macos') {
      openInstallInstructionsSheet(m);
    }
  });
}
