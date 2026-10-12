// player/audio-ui.js
import { el, root } from "./dom.js";
import { state } from "./state.js";

export function normalizeVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return null;
  return Math.max(0, Math.min(100, Math.round(volume)));
}

export function applyVolumeUI(value) {
  const volume = normalizeVolume(value);
  if (volume === null) return false;

  state.volume = volume;
  if (el.volumeController) el.volumeController.value = String(volume);
  root.style.setProperty("--volume-track-lightness", 100 - volume / 2 + "%");
  return true;
}

export function applyMuteUI(muted) {
  state.isMuted = !!muted;
  if (!el.muteBtn) return;

  el.muteBtn.classList.toggle("highlighted", state.isMuted);
  el.muteBtn.setAttribute("aria-pressed", state.isMuted ? "true" : "false");
  el.muteBtn.title = state.isMuted
    ? `Unmute and restore volume to ${state.preMuteVolume}%`
    : "Mute audio";
}
