// player/commands.js
import { state } from "./state.js";
import { setStatus } from "./status.js";

export function sendCommand(cmd, value) {
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

export function startUpdateInterval() {
  if (state.updateInterval) clearInterval(state.updateInterval);
  state.updateInterval = setInterval(() => {
    if (state.isConnected) sendCommand("GET_STATE");
  }, 1000);
}

export function stopUpdateInterval() {
  if (state.updateInterval) {
    clearInterval(state.updateInterval);
    state.updateInterval = null;
  }
}
