// content/player_info.js
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});
  const S = CS.state;

  CS.getShuffleState =
    CS.getShuffleState ||
    (() => {
      const selectors = [".ytp-shuffle-button", "button[aria-label*='Shuffle']"];
      for (const s of selectors) {
        const btn = document.querySelector(s);
        if (btn) {
          return (
            btn.classList.contains("ytp-shuffle-button-enabled") ||
            btn.getAttribute("aria-pressed") === "true"
          );
        }
      }
      return false;
    });

  CS.getLoopState =
    CS.getLoopState ||
    (() => {
      // 0=off, 1=repeat playlist, 2=repeat current
      const selectors = [".ytp-repeat-button", "button[aria-label*='Loop']", "button[aria-label*='Repeat']"];
      for (const s of selectors) {
        const btn = document.querySelector(s);
        if (!btn) continue;

        const ariaLabel = btn.getAttribute("aria-label") || "";
        const title = btn.getAttribute("title") || "";
        const label = (ariaLabel + " " + title).toLowerCase();

        if (label.includes("repeat all") || label.includes("repeat playlist")) return 1;
        if (label.includes("repeat one") || label.includes("repeat current") || label.includes("repeat this")) return 2;

        if (btn.classList.contains("ytp-repeat-button-enabled") || btn.getAttribute("aria-pressed") === "true") {
          return 1;
        }
      }
      return 0;
    });

  CS.sendPlayerInfo =
    CS.sendPlayerInfo ||
    (() => {
      const video = CS.getVideoEl();
      if (!video) {
        CS.safePost({ type: "PLAYER_INFO", error: "No video player found" });
        return;
      }

      const titleElement =
        document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
        document.querySelector(".ytp-title-link") ||
        document.querySelector("h1.title");

      const title = titleElement ? titleElement.textContent.trim() : "";

      CS.safePost({
        type: "PLAYER_INFO",
        currentTime: video.currentTime,
        duration: video.duration,
        playerState: video.paused ? 2 : 1,
        title,
        volume: Math.round(video.volume * 100),
        videoId: S.currentVideoId,
        playlistId: S.currentPlaylistId,
        shuffle: CS.getShuffleState(),
        loop: CS.getLoopState(),
      });
    });
})();
