// Classic script (not a module) so registration still happens if module loading breaks.
if ('serviceWorker' in navigator) {
  // A new version's worker takes control of this page the moment it activates
  // (skipWaiting + clients.claim), but the page keeps running the code it loaded
  // with, so without a reload a deploy only shows up on the visit after next.
  // Reload onto it at once while that costs nothing — the page is hidden, or
  // nobody has touched it since it loaded — and otherwise at the next
  // visibility change (usually leaving the tab), so nobody loses their place
  // mid-use. Content changes reach an in-use page without this, through the
  // worker's content-updated message (app.js).
  // An immediate reload also waits for the next visibility change if the page
  // reloaded itself within the last minute. Without that, a sw.js whose bytes
  // flip between CDN edges mid-deploy would bounce an untouched page between
  // versions, re-downloading the whole precache each time.
  var RELOAD_KEY = 'mfc:update-reloaded-at';
  var controlled = !!navigator.serviceWorker.controller;
  var touched = false;
  var pending = false;
  var reloading = false;
  var reload = function () {
    if (reloading) return;
    reloading = true;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    location.reload();
  };
  var reloadedRecently = function () {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || '0') < 60 * 1000;
  };
  // click, because screen-reader activation (VoiceOver double-tap, Enter in
  // browse mode), switch control and voice control may produce nothing else.
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'click'].forEach(function (type) {
    addEventListener(type, function () {
      touched = true;
    }, { capture: true, passive: true, once: true });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    // A first install claims an uncontrolled page too; that page is already current.
    if (!controlled) {
      controlled = true;
      return;
    }
    if ((document.hidden || !touched) && !reloadedRecently()) reload();
    else pending = true;
  });
  document.addEventListener('visibilitychange', function () {
    if (pending) reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('./sw.js')
      .then(function (reg) {
        var check = function () {
          reg.update().catch(function () {});
        };
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) check();
        });
        setInterval(check, 15 * 60 * 1000);
      })
      .catch(function (err) {
        console.warn('service worker registration failed', err);
      });
  });
}
