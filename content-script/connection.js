// content-script/connection.js
import { state, INSTANCE_KEY } from "./state.js";
import { handleExtensionMessage } from "./handlers.js";
import { detectAndSendState } from "./player-info.js";
import { sendPlayerInfo } from "./player-info.js";
import { stopVisualiserStream, cleanupAudio } from "./visualiser.js";
import { stopPlaylistObserver } from "./playlist.js";
import { ensurePlaylistObserver } from "./playlist.js";
import { sendPlaylistItems } from "./playlist.js";
import { stopMonitoring } from "./monitoring.js";
import { stopUrlWatcher } from "./url-watcher.js";

export function disableBecauseInvalidated(err) {
  console.debug("[MAXAMP] disabled: extension context invalidated", err);
  destroy("context invalidated");
}

let onConnectHandler = null;

export function destroy(reason) {
  try { console.debug("[MAXAMP] destroy:", reason); } catch (_) { }

  state.disabled = true;

  try { stopVisualiserStream(); } catch (_) { }
  try { cleanupAudio(); } catch (_) { }

  try { stopMonitoring(); } catch (_) { }
  try { stopUrlWatcher(); } catch (_) { }

  try { stopPlaylistObserver(); } catch (_) { }

  try {
    if (onConnectHandler) chrome.runtime?.onConnect?.removeListener(onConnectHandler);
  } catch (_) { }

  try { state.port?.disconnect(); } catch (_) { }
  state.port = null;

  try {
    if (globalThis[INSTANCE_KEY]?.destroy === destroy) {
      globalThis[INSTANCE_KEY] = null;
    }
  } catch (_) { }
}

onConnectHandler = function(connectedPort) {
  if (state.disabled) return;
  if (connectedPort.name !== "youtube-content") return;

  state.port = connectedPort;

  state.port.onDisconnect.addListener(() => {
    state.port = null;
    stopVisualiserStream();
    stopPlaylistObserver();
  });

  state.port.onMessage.addListener((msg) => {
    if (!msg?.type || state.disabled) return;
    handleExtensionMessage(msg);
  });

  // initial handshake
  detectAndSendState();
  setTimeout(sendPlayerInfo, 250);

  // Playlist observer setup (safe)
  ensurePlaylistObserver(false);
  sendPlaylistItems(true);
};

export function initializeConnection() {
  // Kill previous instance if we reinject
  const prev = globalThis[INSTANCE_KEY];
  if (prev?.destroy) {
    try { prev.destroy("reinjected"); } catch (_) { }
  }

  globalThis[INSTANCE_KEY] = { destroy };

  try {
    chrome.runtime.onConnect.addListener(onConnectHandler);
  } catch (e) {
    disableBecauseInvalidated(e);
    return;
  }
}
