// content-script/url-watcher.js
import { state } from "./state.js";
import { detectAndSendState } from "./player-info.js";
import { sendPlayerInfo } from "./player-info.js";
import { startMonitoring } from "./monitoring.js";
import { ensurePlaylistObserver } from "./playlist.js";
import { sendPlaylistItems } from "./playlist.js";

let fallbackTimer = null;
let listenersBound = false;

function runUrlRefreshFlow() {
  detectAndSendState();
  startMonitoring();
  sendPlayerInfo();

  // Allow SPA-rendered playlist/content to settle over a couple frames.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ensurePlaylistObserver(true);
      sendPlaylistItems(true);
      sendPlayerInfo();
    });
  });
}

function onMaybeUrlChanged() {
  if (state.disabled) return;

  const now = window.location.href;
  if (now === state.lastUrl) return;
  state.lastUrl = now;
  runUrlRefreshFlow();
}

export function startUrlWatcher() {
  stopUrlWatcher();

  if (!listenersBound) {
    window.addEventListener("yt-navigate-finish", onMaybeUrlChanged);
    window.addEventListener("popstate", onMaybeUrlChanged);
    window.addEventListener("hashchange", onMaybeUrlChanged);
    listenersBound = true;
  }

  // Fallback for missed SPA events.
  fallbackTimer = setInterval(onMaybeUrlChanged, 3000);
  state.urlCheckTimer = fallbackTimer;

  // Initial sync on startup.
  runUrlRefreshFlow();
}

export function stopUrlWatcher() {
  if (state.urlCheckTimer) clearInterval(state.urlCheckTimer);
  state.urlCheckTimer = null;

  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  if (listenersBound) {
    window.removeEventListener("yt-navigate-finish", onMaybeUrlChanged);
    window.removeEventListener("popstate", onMaybeUrlChanged);
    window.removeEventListener("hashchange", onMaybeUrlChanged);
    listenersBound = false;
  }
}
