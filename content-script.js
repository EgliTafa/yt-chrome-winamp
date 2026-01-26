// content-script.js - Runs on YouTube pages to detect and control the player
(() => {

  // Import all modules
  import("./content-script/state.js").then(({ state }) => {
    import("./content-script/connection.js").then(({ initializeConnection }) => {
      import("./content-script/monitoring.js").then(({ startMonitoring }) => {
        import("./content-script/url-watcher.js").then(({ startUrlWatcher }) => {
          import("./content-script/playlist.js").then(({ ensurePlaylistObserver }) => {
            // Initialize connection
            initializeConnection();

            // Boot monitoring
            if (window.location.hostname.includes("youtube.com")) {
              if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => {
                  setTimeout(startMonitoring, 900);
                  setTimeout(startUrlWatcher, 1000);
                  setTimeout(() => ensurePlaylistObserver(false), 1200);
                });
              } else {
                setTimeout(startMonitoring, 900);
                setTimeout(startUrlWatcher, 1000);
                setTimeout(() => ensurePlaylistObserver(false), 1200);
              }
            }
          });
        });
      });
    });
  });
})();
