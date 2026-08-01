// Classic script (not a module) so registration still happens if module loading breaks.
if ('serviceWorker' in navigator) {
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
