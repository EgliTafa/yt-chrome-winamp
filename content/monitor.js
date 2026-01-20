// content/monitor.js
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});
  const S = CS.state;

  function attachVideoListeners(video) {
    if (!video) return;
    if (S.monitoredVideoEl === video) return;

    S.monitoredVideoEl = video;

    video.addEventListener("timeupdate", () => CS.sendPlayerInfo?.());
    video.addEventListener("play", () => CS.sendPlayerInfo?.());
    video.addEventListener("pause", () => CS.sendPlayerInfo?.());

    CS.sendPlayerInfo?.();
  }

  CS.startMonitoring =
    CS.startMonitoring ||
    (() => {
      const video = CS.getVideoEl();
      if (!video) {
        setTimeout(() => CS.startMonitoring?.(), 1000);
        return;
      }

      attachVideoListeners(video);

      // One DOM observer only
      if (!S.domObserver) {
        S.domObserver = new MutationObserver(() => {
          const newVideo = CS.getVideoEl();
          if (newVideo && newVideo !== S.monitoredVideoEl) {
            attachVideoListeners(newVideo);
          }

          const newVideoId = CS.extractVideoIdFromUrl?.(window.location.href);
          if (newVideoId && newVideoId !== S.currentVideoId) {
            S.currentVideoId = newVideoId;
            setTimeout(() => {
              CS.detectAndSendState?.();
              CS.sendPlayerInfo?.();
            }, 800);
          }
        });

        S.domObserver.observe(document.body, { childList: true, subtree: true });
      }

      // One URL watch timer only (YouTube SPA)
      if (!S.urlWatchTimer) {
        S.lastUrl = window.location.href;
        S.urlWatchTimer = setInterval(() => {
          const url = window.location.href;
          if (url !== S.lastUrl) {
            S.lastUrl = url;
            CS.detectAndSendState?.();
            setTimeout(() => CS.sendPlayerInfo?.(), 800);
            setTimeout(() => CS.startMonitoring?.(), 800);
          }
        }, 1000);
      }
    });
})();
