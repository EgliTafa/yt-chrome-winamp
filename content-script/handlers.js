// content-script/handlers.js
import { state } from "./state.js";
import { safePost } from "./helpers.js";
import { detectAndSendState, sendPlayerInfo } from "./player-info.js";
import { startMonitoring } from "./monitoring.js";
import { startVisualiserStream, stopVisualiserStream } from "./visualiser.js";
import { ensurePlaylistObserver } from "./playlist.js";
import { sendPlaylistItems, playPlaylistItemByVideoId } from "./playlist.js";
import {
  playVideo,
  pauseVideo,
  stopVideo,
  nextVideo,
  previousVideo,
  seekTo,
  setVolume,
  setMuted,
  setShuffle,
  setLoop,
} from "./player-controls.js";
import { getLoopState } from "./player-info.js";

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function normalizeLoopMode(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > 2) return null;
  return value;
}

function refreshStateAfterPlaylistJump(expectedVideoId, attempt = 0) {
  detectAndSendState();
  startMonitoring();
  sendPlayerInfo();

  const reachedTarget = !!expectedVideoId && state.currentVideoId === expectedVideoId;
  const shouldRetry = !reachedTarget && attempt < 4;
  if (shouldRetry) {
    setTimeout(() => refreshStateAfterPlaylistJump(expectedVideoId, attempt + 1), 300);
    return;
  }

  ensurePlaylistObserver(false);
  sendPlaylistItems(true);
}

export function handleExtensionMessage(msg) {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "PLAY": playVideo(); break;
    case "PAUSE": pauseVideo(); break;
    case "STOP": stopVideo(); break;
    case "NEXT": nextVideo(); break;
    case "PREV": previousVideo(); break;
    case "SEEK": {
      const seconds = clampNumber(msg.value, 0, Number.MAX_SAFE_INTEGER);
      if (seconds === null) break;
      seekTo(seconds);
      break;
    }
    case "VOLUME": {
      const volume = clampNumber(msg.value, 0, 100);
      if (volume === null) break;
      setVolume(volume);
      break;
    }
    case "MUTE": {
      const muted = asBoolean(msg.value);
      if (muted === null) break;
      setMuted(muted);
      break;
    }
    case "SHUFFLE": {
      const enabled = asBoolean(msg.value);
      if (enabled === null) break;
      setShuffle(enabled);
      break;
    }

    case "LOOP":
      if (normalizeLoopMode(msg.value) !== null) setLoop(msg.value);
      else setLoop((getLoopState() + 1) % 3);
      break;

    case "GET_STATE":
      detectAndSendState();
      sendPlayerInfo();
      break;

    case "START_VIZ":
      startVisualiserStream();
      break;

    case "STOP_VIZ":
      stopVisualiserStream();
      break;

    case "GET_PLAYLIST":
      ensurePlaylistObserver(true);
      sendPlaylistItems(true);
      break;

    case "PLAY_ITEM": {
      const videoId = msg.value?.videoId;
      if (typeof videoId !== "string" || !videoId.trim()) {
        safePost({ type: "PLAY_ITEM_ACK", ok: false, videoId: null });
        break;
      }

      const ok = playPlaylistItemByVideoId(videoId);

      // ✅ tell popup whether we managed to click/navigate
      safePost({ type: "PLAY_ITEM_ACK", ok: !!ok, videoId });
      refreshStateAfterPlaylistJump(videoId);
      break;
    }
    default:
      break;
  }
}
