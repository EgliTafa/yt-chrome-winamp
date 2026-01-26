// content-script/playlist.js
import { state } from "./state.js";
import { extractVideoIdFromHref, clickLikeUser } from "./helpers.js";
import { safePost } from "./helpers.js";

export function findPlaylistPanelRoot() {
  // Watch page: playlist panel on the right
  return document.querySelector("ytd-playlist-panel-renderer");
}

export function scrapePlaylistItems() {
  const nodes = Array.from(document.querySelectorAll("ytd-playlist-panel-video-renderer"));
  if (!nodes.length) return [];

  return nodes.map((node, i) => {
    const a =
      node.querySelector("a#video-title") ||
      node.querySelector("a[href*='watch?v=']") ||
      node.querySelector("#video-title"); // fallback

    const title =
      (a?.getAttribute("title") || a?.textContent || "").trim();

    const href = a?.getAttribute("href") || "";
    const videoId = extractVideoIdFromHref(href);

    const isCurrent =
      node.hasAttribute("selected") ||
      node.classList.contains("selected") ||
      a?.getAttribute("aria-current") === "true";

    return {
      index: i + 1,
      title,
      videoId: videoId || null,
      isCurrent: !!isCurrent,
    };
  });
}

function computeSig(items) {
  return items.map(x => `${x.videoId || ""}:${x.title}:${x.isCurrent ? 1 : 0}`).join("|");
}

export function sendPlaylistItems(force = false) {
  if (state.disabled || !state.port) return;

  const root = findPlaylistPanelRoot();
  if (!root) {
    // Only send empty ONCE until the panel appears
    if (!state.lastSentEmpty) {
      state.lastSentEmpty = true;
      state.lastPlaylistSig = "";
      safePost({ type: "PLAYLIST_ITEMS", items: [] });
    }
    return;
  }

  state.lastSentEmpty = false;

  const items = scrapePlaylistItems();
  const sig = computeSig(items);

  if (!force && sig === state.lastPlaylistSig) return;
  state.lastPlaylistSig = sig;

  safePost({ type: "PLAYLIST_ITEMS", items });
}

function throttledSendPlaylist() {
  if (state.playlistSendTimer) return;
  state.playlistSendTimer = setTimeout(() => {
    state.playlistSendTimer = null;
    sendPlaylistItems(false);
  }, 250);
}

export function ensurePlaylistObserver(forceRestart = false) {
  if (state.disabled) return;

  const root = findPlaylistPanelRoot();

  if (!root) {
    if (!state.playlistRetryTimer) {
      state.playlistRetryTimer = setTimeout(() => {
        state.playlistRetryTimer = null;
        ensurePlaylistObserver(false);
        sendPlaylistItems(true);
      }, 1000);
    }
    return;
  }

  if (!forceRestart && state.playlistObserver && state.playlistRoot === root) return;

  stopPlaylistObserver();
  state.playlistRoot = root;

  state.playlistObserver = new MutationObserver(() => {
    throttledSendPlaylist();
  });

  state.playlistObserver.observe(state.playlistRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["selected", "aria-current", "href", "title", "class"],
  });

  sendPlaylistItems(true);
}

export function stopPlaylistObserver() {
  try { state.playlistObserver?.disconnect(); } catch (_) { }
  state.playlistObserver = null;
  state.playlistRoot = null;

  if (state.playlistRetryTimer) clearTimeout(state.playlistRetryTimer);
  state.playlistRetryTimer = null;

  if (state.playlistSendTimer) clearTimeout(state.playlistSendTimer);
  state.playlistSendTimer = null;
}

// ---------------------------
// PLAY_ITEM: click matching playlist row (watch panel) OR navigate fallback
// ---------------------------
function findWatchPlaylistAnchorByVideoId(videoId) {
  const items = Array.from(document.querySelectorAll("ytd-playlist-panel-video-renderer"));
  for (const node of items) {
    const a =
      node.querySelector("a#video-title") ||
      node.querySelector("a[href*='watch?v=']");
    const v = extractVideoIdFromHref(a?.getAttribute("href") || "");
    if (v === videoId) return a || node;
  }
  return null;
}

function findPlaylistPageAnchorByVideoId(videoId) {
  const items = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
  for (const node of items) {
    const a =
      node.querySelector("a#video-title") ||
      node.querySelector("a[href*='watch?v=']");
    const v = extractVideoIdFromHref(a?.getAttribute("href") || "");
    if (v === videoId) return a || node;
  }
  return null;
}

function navigateToVideo(videoId) {
  const urlParams = new URLSearchParams(window.location.search);
  const list = urlParams.get("list");
  const target = list
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(list)}`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  window.location.href = target;
  return true;
}

export function playPlaylistItemByVideoId(videoId) {
  if (!videoId) return false;

  // 1) Watch page playlist panel (best)
  const a1 = findWatchPlaylistAnchorByVideoId(videoId);
  if (a1 && clickLikeUser(a1)) return true;

  // 2) Playlist page
  const a2 = findPlaylistPageAnchorByVideoId(videoId);
  if (a2 && clickLikeUser(a2)) return true;

  // 3) Fallback navigation
  return navigateToVideo(videoId);
}
