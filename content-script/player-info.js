// content-script/player-info.js
import { state } from "./state.js";
import { extractVideoIdFromUrl } from "./helpers.js";
import { safePost } from "./helpers.js";
import { SELECTORS, queryFirst } from "./selectors.js";
import { scheduleVolumeSync } from "./volume-sync.js";

export function detectAndSendState() {
  if (state.disabled) return;

  const url = window.location.href;
  const urlParams = new URLSearchParams(window.location.search);

  const videoId = urlParams.get("v") || extractVideoIdFromUrl(url);
  const playlistId = urlParams.get("list");

  const videoChanged = videoId !== state.currentVideoId;
  state.currentVideoId = videoId;
  state.currentPlaylistId = playlistId;

  if (videoChanged) scheduleVolumeSync();

  safePost({
    type: "YOUTUBE_STATE",
    videoId,
    playlistId,
    url: window.location.href,
    hasPlayer: !!document.querySelector(SELECTORS.video),
  });
}

function getShuffleState() {
  const btn = queryFirst(SELECTORS.shuffleButton);
  if (btn) {
    return (
      btn.classList.contains("ytp-shuffle-button-enabled") ||
      btn.getAttribute("aria-pressed") === "true"
    );
  }
  return false;
}

function getLoopState() {
  for (const s of SELECTORS.loopButton) {
    const btn = document.querySelector(s);
    if (!btn) {
      continue;
    }

    const ariaLabel = btn.getAttribute("aria-label") || "";
    const title = btn.getAttribute("title") || "";
    const label = (ariaLabel + " " + title).toLowerCase();

    if (label.includes("repeat all") || label.includes("repeat playlist")) return 1;
    if (label.includes("repeat one") || label.includes("repeat current") || label.includes("repeat this")) return 2;

    if (btn.classList.contains("ytp-repeat-button-enabled") || btn.getAttribute("aria-pressed") === "true") return 1;
  }
  return 0;
}

export function sendPlayerInfo() {
  if (state.disabled) return;

  const video = document.querySelector(SELECTORS.video);
  if (!video) {
    safePost({ type: "PLAYER_INFO", error: "No video player found" });
    return;
  }

  const titleElement = queryFirst(SELECTORS.title);

  const title = titleElement ? titleElement.textContent.trim() : "";

  safePost({
    type: "PLAYER_INFO",
    currentTime: video.currentTime,
    duration: video.duration,
    playerState: video.paused ? 2 : 1,
    title,
    volume:
      state.volume !== null
        ? state.volume
        : Math.round(video.volume * 100),
    videoId: state.currentVideoId,
    playlistId: state.currentPlaylistId,
    shuffle: getShuffleState(),
    loop: getLoopState(),
  });
}

export { getLoopState };
