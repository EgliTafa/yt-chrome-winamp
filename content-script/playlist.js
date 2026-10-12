// content-script/playlist.js
import { state } from "./state.js";
import { extractVideoIdFromHref, clickLikeUser } from "./helpers.js";
import { safePost } from "./helpers.js";
import { SELECTORS, queryFirst } from "./selectors.js";

function selectorList(value) {
  return Array.isArray(value) ? value : [value];
}

function queryAll(root, selectors) {
  if (!root) return [];

  const found = [];
  const seen = new Set();
  for (const selector of selectorList(selectors)) {
    for (const node of root.querySelectorAll(selector)) {
      if (seen.has(node)) continue;
      seen.add(node);
      found.push(node);
    }
  }
  return found;
}

function isPlaylistPage() {
  return window.location.pathname === "/playlist" ||
    !!document.querySelector("ytd-browse[page-subtype='playlist']");
}

export function findPlaylistPanelRoot() {
  // Watch page: playlist panel on the right.
  return queryFirst(SELECTORS.playlistPanelRoot);
}

export function findPlaylistPageRoot() {
  // Do not let a generic renderer elsewhere on YouTube masquerade as a
  // playlist page. The URL check survives renderer attribute changes.
  if (!isPlaylistPage()) return null;
  return queryFirst(SELECTORS.playlistPageRoot);
}

function findItemAnchor(node) {
  if (!node) return null;

  for (const selector of selectorList(SELECTORS.playlistItemAnchor)) {
    if (node.matches?.(selector) && extractVideoIdFromHref(node.getAttribute("href") || "")) {
      return node;
    }

    const anchor = node.querySelector?.(selector);
    if (anchor && extractVideoIdFromHref(anchor.getAttribute("href") || "")) {
      return anchor;
    }
  }

  return null;
}

function collectItemNodes(root, itemSelectors) {
  const rendererNodes = queryAll(root, itemSelectors);
  if (rendererNodes.length) return rendererNodes;

  // YouTube periodically changes renderer element names. Keep extraction
  // working by falling back to unique watch links within the selected surface.
  return queryAll(root, SELECTORS.playlistFallbackAnchor);
}

function getPlaylistSurface() {
  // On the standalone playlist route, prefer its own listing even if YouTube
  // leaves a hidden/stale watch-panel renderer in the SPA document.
  const pageRoot = findPlaylistPageRoot();
  if (pageRoot) {
    return {
      kind: "playlist-page",
      root: pageRoot,
      nodes: collectItemNodes(pageRoot, SELECTORS.playlistPageItem),
    };
  }

  const panelRoot = findPlaylistPanelRoot();
  if (panelRoot) {
    return {
      kind: "watch-panel",
      root: panelRoot,
      nodes: collectItemNodes(panelRoot, SELECTORS.playlistPanelItem),
    };
  }

  return null;
}

function cleanTitle(rawTitle) {
  let title = String(rawTitle || "").trim();
  title = title.replace(/now\s+playing\s*/gi, "").trim();
  title = title.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*/g, " ").trim();
  title = title.replace(/^(\d+)\.?\s+\1\s+/, "").trim();
  title = title.replace(/^(\d+)\.?\s+(\d+)\s+/, "").trim();
  title = title.replace(/^[►▷]\s*/, "").trim();
  return title.replace(/\s+/g, " ").trim();
}

function readTitle(node, anchor) {
  const preferredTitle = anchor?.getAttribute("title") || "";
  if (preferredTitle.trim()) return cleanTitle(preferredTitle);

  for (const selector of selectorList(SELECTORS.playlistItemTitle)) {
    const titleNode = node.matches?.(selector) ? node : node.querySelector?.(selector);
    const title = titleNode?.getAttribute?.("title") || titleNode?.textContent || "";
    if (title.trim()) return cleanTitle(title);
  }

  return cleanTitle(anchor?.getAttribute("aria-label") || anchor?.textContent || "");
}

function normalizeThumbnailUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch (_) {
    return "";
  }
}

function readThumbnailUrl(node, videoId) {
  for (const selector of selectorList(SELECTORS.playlistItemThumbnail)) {
    const image = node.matches?.(selector) ? node : node.querySelector?.(selector);
    if (!image) continue;

    const srcset = String(image.getAttribute?.("srcset") || "").trim();
    const largestSrcsetUrl = srcset
      ? srcset.split(",").at(-1)?.trim().split(/\s+/)[0]
      : "";
    const candidate = normalizeThumbnailUrl(
      largestSrcsetUrl ||
      image.currentSrc ||
      image.getAttribute?.("src") ||
      image.getAttribute?.("data-src")
    );
    if (candidate) return candidate;
  }

  return videoId
    ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/default.jpg`
    : "";
}

function isCurrentItem(node, anchor, videoId) {
  const currentVideoId = new URLSearchParams(window.location.search).get("v");
  return node.hasAttribute?.("selected") ||
    node.classList?.contains("selected") ||
    anchor?.getAttribute("aria-current") === "true" ||
    anchor?.getAttribute("aria-current") === "page" ||
    (!!currentVideoId && currentVideoId === videoId);
}

export function scrapePlaylistItems() {
  const surface = getPlaylistSurface();
  if (!surface?.nodes.length) return [];

  const items = [];
  const seenVideoIds = new Set();

  for (const node of surface.nodes) {
    const anchor = findItemAnchor(node);
    const href = anchor?.getAttribute("href") || "";
    const videoId = extractVideoIdFromHref(href) ||
      node.getAttribute?.("video-id") ||
      node.getAttribute?.("data-video-id") ||
      null;

    // Renderer fallbacks may expose the thumbnail link and title link for the
    // same track. De-duplicate them before assigning display indices.
    if (videoId && seenVideoIds.has(videoId)) continue;
    if (videoId) seenVideoIds.add(videoId);

    const title = readTitle(node, anchor);
    if (!title && !videoId) continue;

    items.push({
      index: items.length + 1,
      title,
      videoId,
      thumbnailUrl: readThumbnailUrl(node, videoId),
      isCurrent: !!isCurrentItem(node, anchor, videoId),
    });
  }

  return items;
}

function computeSig(items) {
  return items
    .map(x => `${x.videoId || ""}:${x.title}:${x.thumbnailUrl || ""}:${x.isCurrent ? 1 : 0}`)
    .join("|");
}

export function sendPlaylistItems(force = false) {
  if (state.disabled || !state.port) return;

  const surface = getPlaylistSurface();
  if (!surface) {
    // Only send empty ONCE until either playlist surface appears.
    if (!state.lastSentEmpty) {
      state.lastSentEmpty = true;
      state.lastPlaylistSig = "";
      safePost({
        type: "PLAYLIST_ITEMS",
        items: [],
        surface: null,
        playlistId: state.currentPlaylistId,
      });
    }
    return;
  }

  state.lastSentEmpty = false;

  const items = scrapePlaylistItems();
  const sig = computeSig(items);

  if (!force && sig === state.lastPlaylistSig) return;
  state.lastPlaylistSig = sig;

  safePost({
    type: "PLAYLIST_ITEMS",
    items,
    surface: surface.kind,
    playlistId: state.currentPlaylistId,
  });
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

  const surface = getPlaylistSurface();
  const root = surface?.root || null;

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
    attributeFilter: ["selected", "aria-current", "href", "title", "class", "src", "srcset"],
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
// PLAY_ITEM: click matching row on either playlist surface OR navigate fallback
// ---------------------------
function findPlaylistAnchorByVideoId(root, itemSelectors, videoId) {
  if (!root) return null;

  const nodes = collectItemNodes(root, itemSelectors);
  for (const node of nodes) {
    const anchor = findItemAnchor(node);
    const candidateId = extractVideoIdFromHref(anchor?.getAttribute("href") || "") ||
      node.getAttribute?.("video-id") ||
      node.getAttribute?.("data-video-id") ||
      null;
    if (candidateId === videoId) return anchor || node;
  }
  return null;
}

function findWatchPlaylistAnchorByVideoId(videoId) {
  return findPlaylistAnchorByVideoId(
    findPlaylistPanelRoot(),
    SELECTORS.playlistPanelItem,
    videoId,
  );
}

function findPlaylistPageAnchorByVideoId(videoId) {
  return findPlaylistAnchorByVideoId(
    findPlaylistPageRoot(),
    SELECTORS.playlistPageItem,
    videoId,
  );
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

  // 1) Watch page playlist panel (best).
  const watchAnchor = findWatchPlaylistAnchorByVideoId(videoId);
  if (watchAnchor && clickLikeUser(watchAnchor)) return true;

  // 2) Standalone /playlist page.
  const pageAnchor = findPlaylistPageAnchorByVideoId(videoId);
  if (pageAnchor && clickLikeUser(pageAnchor)) return true;

  // 3) URL fallback, preserving the current playlist id when available.
  return navigateToVideo(videoId);
}
