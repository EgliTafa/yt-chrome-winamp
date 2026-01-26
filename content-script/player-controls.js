// content-script/player-controls.js
import { getVideoEl } from "./helpers.js";
import { sendPlayerInfo } from "./player-info.js";
import { getLoopState } from "./player-info.js";

export function setVolume(value) {
  const video = getVideoEl();
  if (video) {
    video.volume = Number(value) / 100;
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
  const btn = document.querySelector(".ytp-next-button");
  if (btn) {
    btn.click();
    setTimeout(sendPlayerInfo, 500);
  }
}

export function previousVideo() {
  const btn = document.querySelector(".ytp-prev-button");
  if (btn) {
    btn.click();
    setTimeout(sendPlayerInfo, 500);
  } else {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft" }));
    setTimeout(sendPlayerInfo, 500);
  }
}

export function playVideo() {
  const video = getVideoEl();
  const playButton =
    document.querySelector(".ytp-play-button[aria-label*='Play']") ||
    document.querySelector(".ytp-play-button:not(.ytp-pause-button)");

  if (video && video.paused) video.play();
  else if (playButton) playButton.click();

  sendPlayerInfo();
}

export function pauseVideo() {
  const video = getVideoEl();
  const pauseButton =
    document.querySelector(".ytp-play-button.ytp-pause-button") ||
    document.querySelector(".ytp-play-button[aria-label*='Pause']");

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
  const selectors = [
    ".ytp-shuffle-button",
    "button[aria-label*='Shuffle']",
    "button[title*='Shuffle']",
    ".ytp-button[aria-label*='Shuffle']",
  ];

  let btn = null;
  for (const s of selectors) {
    btn = document.querySelector(s);
    if (btn) break;
  }
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
  const selectors = [
    ".ytp-repeat-button",
    "button[aria-label*='Loop']",
    "button[aria-label*='Repeat']",
    "button[title*='Loop']",
    "button[title*='Repeat']",
    ".ytp-button[aria-label*='Loop']",
    ".ytp-button[aria-label*='Repeat']",
  ];

  let btn = null;
  for (const s of selectors) {
    btn = document.querySelector(s);
    if (btn) break;
  }
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
