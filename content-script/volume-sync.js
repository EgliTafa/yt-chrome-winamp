// content-script/volume-sync.js
import { state } from "./state.js";
import { getVideoEl } from "./helpers.js";

function initVolumeFromVideo(video) {
  if (state.volume === null && video) {
    state.volume = Math.round(video.volume * 100);
  }
}

/** Apply saved volume when YouTube swaps the <video> element (defaults to 1.0). */
export function applyVolumeToVideo(video) {
  if (!video) return;
  initVolumeFromVideo(video);
  if (state.volume === null) return;

  const target = state.volume / 100;
  // Skip redundant writes — resetting volume every timeupdate causes audio stutter.
  if (Math.abs(video.volume - target) < 0.005) return;
  video.volume = target;
}

const volumeListenerVideos = new WeakSet();
let volumeSyncTimeout = null;

function bindVolumePersistenceListeners(video) {
  if (!video || volumeListenerVideos.has(video)) return;
  volumeListenerVideos.add(video);

  const reapply = () => {
    if (state.volume !== null) applyVolumeToVideo(video);
  };
  video.addEventListener("loadeddata", reapply);
  video.addEventListener("canplay", reapply);
}

/** Re-apply saved volume after navigation (same or new <video>; YouTube often resets to 1.0). */
export function scheduleVolumeSync(attempt = 0) {
  if (volumeSyncTimeout) clearTimeout(volumeSyncTimeout);

  const delay = attempt === 0 ? 0 : Math.min(400, 40 + attempt * 35);
  volumeSyncTimeout = setTimeout(() => {
    volumeSyncTimeout = null;

    const video = getVideoEl();
    if (!video) {
      if (attempt < 15) scheduleVolumeSync(attempt + 1);
      return;
    }

    bindVolumePersistenceListeners(video);
    applyVolumeToVideo(video);

    const target = state.volume !== null ? state.volume / 100 : null;
    const drift =
      target !== null && Math.abs(video.volume - target) >= 0.005;

    state.lastVolumeSyncedVideoId = state.currentVideoId;

    if (drift && attempt < 15) scheduleVolumeSync(attempt + 1);
  }, delay);
}
