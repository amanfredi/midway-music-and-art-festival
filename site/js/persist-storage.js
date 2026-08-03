// Best-effort request for persistent storage. Silent regardless of outcome —
// no UI, no retry, never surfaced to the user. Per BACKLOG.md's PWA-platform
// research (2026-08-02): this protects Chrome/Android from disk-pressure
// eviction, but does NOT exempt a non-installed iOS Safari site from the
// 7-day ITP storage wipe (open WebKit bug 209563) — home-screen install is
// what does that (see README.md's Known limitations section).
export function requestPersistentStorage() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* best-effort; ignore */
  }
}
