// content-script/player-controls.js
import { state } from "./state.js";
import { getVideoEl } from "./helpers.js";
import { sendPlayerInfo } from "./player-info.js";
import { applyVolumeToVideo, scheduleVolumeSync } from "./volume-sync.js";
import { getLoopState } from "./player-info.js";
import { SELECTORS, queryFirst } from "./selectors.js";

export function setVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  state.volume = Math.max(0, Math.min(100, Math.round(n)));

  const video = getVideoEl();
  if (video) {
    applyVolumeToVideo(video);
    sendPlayerInfo();
  }
}

export function setMuted(enabled) {
  state.muted = !!enabled;

  const video = getVideoEl();
  if (video) {
    applyVolumeToVideo(video);
    sendPlayerInfo();
  }
}

export function seekTo(seconds) {
  const video = getVideoEl();
  if (video) {
    video.currentTime = Number(seconds);
    sendPlayerInfo();
  }
}

export function nextVideo() {
  const btn = queryFirst(SELECTORS.nextButton);
  if (btn) {
    btn.click();
    scheduleVolumeSync();
    setTimeout(sendPlayerInfo, 500);
  }
}

export function previousVideo() {
  const btn = queryFirst(SELECTORS.previousButton);
  if (btn) {
    btn.click();
    scheduleVolumeSync();
    setTimeout(sendPlayerInfo, 500);
  } else {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft" }));
    scheduleVolumeSync();
    setTimeout(sendPlayerInfo, 500);
  }
}

export function playVideo() {
  const video = getVideoEl();
  const playButton = queryFirst(SELECTORS.playButton);

  if (video && video.paused) video.play();
  else if (playButton) playButton.click();

  sendPlayerInfo();
}

export function pauseVideo() {
  const video = getVideoEl();
  const pauseButton = queryFirst(SELECTORS.pauseButton);

  if (video && !video.paused) video.pause();
  else if (pauseButton) pauseButton.click();

  sendPlayerInfo();
}

export function stopVideo() {
  const video = getVideoEl();
  if (video) {
    video.pause();
    video.currentTime = 0;
  }
  sendPlayerInfo();
}

export function setShuffle(enabled) {
  const btn = queryFirst(SELECTORS.shuffleButton);
  if (!btn) return;

  const isActive =
    btn.classList.contains("ytp-shuffle-button-enabled") ||
    btn.getAttribute("aria-pressed") === "true";

  if (Boolean(enabled) !== isActive) {
    btn.click();
    setTimeout(sendPlayerInfo, 300);
  }
}

export function setLoop(mode) {
  const btn = queryFirst(SELECTORS.loopButton);
  if (!btn) return;

  const currentMode = getLoopState();
  if (currentMode === mode) return;

  let clicksNeeded = 0;
  if (mode === 0) clicksNeeded = currentMode === 1 ? 2 : currentMode === 2 ? 1 : 0;
  if (mode === 1) clicksNeeded = currentMode === 0 ? 1 : currentMode === 2 ? 2 : 0;
  if (mode === 2) clicksNeeded = currentMode === 0 ? 2 : currentMode === 1 ? 1 : 0;

  for (let i = 0; i < clicksNeeded; i++) setTimeout(() => btn.click(), i * 200);
  setTimeout(sendPlayerInfo, clicksNeeded * 200 + 300);
}
