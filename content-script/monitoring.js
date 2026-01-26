// content-script/monitoring.js
import { state } from "./state.js";
import { getVideoEl } from "./helpers.js";
import { safePost } from "./helpers.js";
import { sendPlayerInfo } from "./player-info.js";

function onTimeUpdate() { sendPlayerInfo(); }
function onPlay() { sendPlayerInfo(); }
function onPause() { sendPlayerInfo(); }

export function startMonitoring() {
  if (state.disabled) return;

  const video = getVideoEl();
  if (!video) {
    setTimeout(startMonitoring, 1000);
    return;
  }

  if (state.monitoringVideo !== video) {
    stopMonitoring();
    state.monitoringVideo = video;
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
  }

  sendPlayerInfo();
}

export function stopMonitoring() {
  try {
    if (state.monitoringVideo) {
      state.monitoringVideo.removeEventListener("timeupdate", onTimeUpdate);
      state.monitoringVideo.removeEventListener("play", onPlay);
      state.monitoringVideo.removeEventListener("pause", onPause);
    }
  } catch (_) { }
  state.monitoringVideo = null;
}
