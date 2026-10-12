// content-script.js - Runs on YouTube pages to detect and control the player
(() => {

  async function start() {
    const [
      { initializeConnection },
      { startMonitoring },
      { startUrlWatcher },
      { ensurePlaylistObserver },
    ] = await Promise.all([
      import("./content-script/connection.js"),
      import("./content-script/monitoring.js"),
      import("./content-script/url-watcher.js"),
      import("./content-script/playlist.js"),
    ]);

    initializeConnection();

    if (!window.location.hostname.includes("youtube.com")) return;

    const boot = () => {
      // Start all subsystems immediately; each module handles its own retries.
      startMonitoring();
      startUrlWatcher();
      ensurePlaylistObserver(false);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  start().catch((err) => {
    try {
      console.error("[MAXAMP] failed to bootstrap content script", err);
    } catch (_) {}
  });
})();
