// content/ns.js
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});

  // Single place for mutable state
  CS.state = CS.state || {
    port: null,
    currentVideoId: null,
    currentPlaylistId: null,

    // viz
    audioCtx: null,
    analyser: null,
    sourceNode: null,
    attachedVideoEl: null,
    vizTimer: null,

    // monitoring
    monitoredVideoEl: null,
    domObserver: null,
    urlWatchTimer: null,
    lastUrl: null,
  };

  // constants
  CS.consts = CS.consts || {
    VIZ_FPS_MS: 50,     // ~20 FPS
    VIZ_BARS_COUNT: 24, // bars sent to popup
  };

  CS.log = CS.log || ((...a) => console.debug("[WINAMP-CS]", ...a));
  CS.warn = CS.warn || ((...a) => console.warn("[WINAMP-CS]", ...a));
  CS.err = CS.err || ((...a) => console.error("[WINAMP-CS]", ...a));

  CS.getVideoEl =
    CS.getVideoEl ||
    (() => document.querySelector("video"));

  CS.safePost =
    CS.safePost ||
    ((msg) => {
      const port = CS.state.port;
      if (!port) return;
      try {
        port.postMessage(msg);
      } catch (_) {}
    });
})();
