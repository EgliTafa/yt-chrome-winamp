// player/now-playing.js
import { el } from "./dom.js";

let currentVideoId = "";
let currentPriority = -1;

function normalizeVideoId(videoId) {
  const value = String(videoId || "").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "";
}

function normalizeThumbnailUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(String(url), "https://www.youtube.com");
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch (_) {
    return "";
  }
}

export function getDefaultThumbnailUrl(videoId) {
  const normalizedId = normalizeVideoId(videoId);
  return normalizedId
    ? `https://i.ytimg.com/vi/${encodeURIComponent(normalizedId)}/default.jpg`
    : "";
}

export function setNowPlayingThumbnail(videoId, thumbnailUrl = "", priority = 0) {
  if (!el.nowPlayingThumbnail) return;

  const normalizedId = normalizeVideoId(videoId);
  if (!normalizedId) {
    clearNowPlayingThumbnail();
    return;
  }

  if (currentVideoId !== normalizedId) {
    currentVideoId = normalizedId;
    currentPriority = -1;
  } else if (priority < currentPriority) {
    return;
  }

  const fallback = getDefaultThumbnailUrl(normalizedId);
  const source = normalizeThumbnailUrl(thumbnailUrl) || fallback;
  if (!source) return;

  currentPriority = priority;
  el.nowPlayingThumbnail.dataset.fallback = fallback;
  el.nowPlayingThumbnail.src = source;
  el.nowPlayingThumbnail.hidden = false;
}

export function clearNowPlayingThumbnail() {
  currentVideoId = "";
  currentPriority = -1;
  if (!el.nowPlayingThumbnail) return;
  el.nowPlayingThumbnail.hidden = true;
  el.nowPlayingThumbnail.removeAttribute("src");
  delete el.nowPlayingThumbnail.dataset.fallback;
}

if (el.nowPlayingThumbnail) {
  el.nowPlayingThumbnail.addEventListener("error", () => {
    const fallback = el.nowPlayingThumbnail.dataset.fallback || "";
    if (fallback && el.nowPlayingThumbnail.src !== fallback) {
      el.nowPlayingThumbnail.src = fallback;
      return;
    }
    el.nowPlayingThumbnail.hidden = true;
  });
}
