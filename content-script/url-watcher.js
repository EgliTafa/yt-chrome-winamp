// content-script/url-watcher.js
import { state } from "./state.js";
import { detectAndSendState } from "./player-info.js";
import { sendPlayerInfo } from "./player-info.js";
import { startMonitoring } from "./monitoring.js";
import { ensurePlaylistObserver } from "./playlist.js";
import { sendPlaylistItems } from "./playlist.js";

export function startUrlWatcher() {
  stopUrlWatcher();
  state.urlCheckTimer = setInterval(() => {
    if (state.disabled) return;

    const now = window.location.href;
    if (now !== state.lastUrl) {
      state.lastUrl = now;

      detectAndSendState();
      setTimeout(sendPlayerInfo, 600);
      setTimeout(startMonitoring, 700);

      // playlist often re-renders after nav
      setTimeout(() => {
        ensurePlaylistObserver(true);
        sendPlaylistItems(true);
      }, 900);
    }
  }, 1000);
}

export function stopUrlWatcher() {
  if (state.urlCheckTimer) clearInterval(state.urlCheckTimer);
  state.urlCheckTimer = null;
}
