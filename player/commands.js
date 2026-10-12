// player/commands.js
import { state } from "./state.js";
import { setStatus } from "./status.js";

let visibilityListenerBound = false;

export function sendCommand(cmd, value) {
  if (typeof cmd !== "string" || !cmd) return false;
  if (!state.contentPort || !state.isConnected) {
    setStatus("Not connected to YouTube. Reconnecting...");
    return false;
  }
  try {
    state.contentPort.postMessage({ type: cmd, value });
    return true;
  } catch (e) {
    setStatus(`Error: ${e.message}`);
    state.contentPort = null;
    state.isConnected = false;
    return false;
  }
}

function requestStateNow() {
  if (!state.isConnected) return;
  sendCommand("GET_STATE");
}

export function startUpdateInterval() {
  if (state.updateInterval) clearInterval(state.updateInterval);

  requestStateNow();

  // Keep lightweight polling as a fallback, but avoid aggressive 1s traffic.
  state.updateInterval = setInterval(() => {
    if (!state.isConnected || document.hidden) return;
    requestStateNow();
  }, 2500);

  if (!visibilityListenerBound) {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) requestStateNow();
    });
    visibilityListenerBound = true;
  }
}

export function stopUpdateInterval() {
  if (state.updateInterval) {
    clearInterval(state.updateInterval);
    state.updateInterval = null;
  }
}
