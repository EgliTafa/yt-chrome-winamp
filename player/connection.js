// player/connection.js
import { state, CONNECTION_PHASES } from "./state.js";
import { setStatus } from "./status.js";
import { handleContentMessage } from "./handlers.js";
import { stopUpdateInterval, sendCommand } from "./commands.js";
import { stopViz } from "./viz.js";
import { savePreferredTabId } from "./prefs.js";

const YOUTUBE_URL_PATTERNS = [
  "https://www.youtube.com/*",
  "https://youtube.com/*",
];

const ALLOWED_PHASE_TRANSITIONS = {
  [CONNECTION_PHASES.DISCONNECTED]: [
    CONNECTION_PHASES.CONNECTING,
    CONNECTION_PHASES.RECONNECTING,
    CONNECTION_PHASES.FAILED,
  ],
  [CONNECTION_PHASES.CONNECTING]: [
    CONNECTION_PHASES.HANDSHAKING,
    CONNECTION_PHASES.RECONNECTING,
    CONNECTION_PHASES.FAILED,
    CONNECTION_PHASES.DISCONNECTED,
  ],
  [CONNECTION_PHASES.HANDSHAKING]: [
    CONNECTION_PHASES.CONNECTED,
    CONNECTION_PHASES.RECONNECTING,
    CONNECTION_PHASES.FAILED,
    CONNECTION_PHASES.DISCONNECTED,
  ],
  [CONNECTION_PHASES.CONNECTED]: [
    CONNECTION_PHASES.CONNECTING,
    CONNECTION_PHASES.RECONNECTING,
    CONNECTION_PHASES.DISCONNECTED,
  ],
  [CONNECTION_PHASES.RECONNECTING]: [
    CONNECTION_PHASES.CONNECTING,
    CONNECTION_PHASES.HANDSHAKING,
    CONNECTION_PHASES.CONNECTED,
    CONNECTION_PHASES.FAILED,
    CONNECTION_PHASES.DISCONNECTED,
  ],
  [CONNECTION_PHASES.FAILED]: [
    CONNECTION_PHASES.CONNECTING,
    CONNECTION_PHASES.RECONNECTING,
    CONNECTION_PHASES.DISCONNECTED,
  ],
};

let attemptSequence = 0;
let activeAttempt = null;
let activePortBinding = null;

function setConnectionPhase(next) {
  const current = state.connectionPhase;
  if (current === next) return;
  if (!(ALLOWED_PHASE_TRANSITIONS[current] || []).includes(next)) return;
  state.connectionPhase = next;
  try {
    window.dispatchEvent(new CustomEvent("maxamp-connection-change", {
      detail: { phase: next },
    }));
  } catch (_) { }
}

function isYoutubeUrl(url) {
  return /^https?:\/\/(www\.)?youtube\.com\//i.test(String(url || ""));
}

function createAbortError() {
  const error = new Error("Connection attempt cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfCancelled(attempt) {
  if (
    !attempt ||
    attempt.signal.aborted ||
    state.connectionAttemptToken !== attempt.token
  ) {
    throw createAbortError();
  }
}

function abortableDelay(ms, attempt) {
  throwIfCancelled(attempt);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      attempt.signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    attempt.signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cancelReconnectTimer() {
  if (!state.reconnectTimeout) return;
  clearTimeout(state.reconnectTimeout);
  state.reconnectTimeout = null;
}

function beginConnectionAttempt() {
  cancelReconnectTimer();
  activeAttempt?.controller.abort();

  const controller = new AbortController();
  const token = ++attemptSequence;
  state.connectionAttemptToken = token;
  activeAttempt = { token, controller, signal: controller.signal };
  return activeAttempt;
}

function cancelActiveAttempt() {
  activeAttempt?.controller.abort();
  activeAttempt = null;
  state.connectionAttemptToken = ++attemptSequence;
}

function disconnectPort(port) {
  if (!port) return;
  try { port.disconnect(); } catch (_) { }
}

function disposeContentPort() {
  const binding = activePortBinding;
  activePortBinding = null;

  if (binding) {
    try { binding.port.onMessage.removeListener(binding.onMessage); } catch (_) { }
    try { binding.port.onDisconnect.removeListener(binding.onDisconnect); } catch (_) { }
  }

  const port = binding?.port || state.contentPort;
  state.contentPort = null;
  disconnectPort(port);
}

function resetConnectedState() {
  state.isConnected = false;
  stopUpdateInterval();
  stopViz();
}

async function getYoutubeTab(tabId) {
  if (!Number.isInteger(tabId) || tabId <= 0) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return isYoutubeUrl(tab?.url) ? tab : null;
  } catch (_) {
    return null;
  }
}

export async function listYoutubeTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: YOUTUBE_URL_PATTERNS });
    return tabs
      .filter((tab) => Number.isInteger(tab?.id) && isYoutubeUrl(tab?.url))
      .sort((a, b) => {
        if (!!a.active !== !!b.active) return a.active ? -1 : 1;
        return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
      });
  } catch (_) {
    return [];
  }
}

async function resolveYoutubeTab(explicitTabId, attempt) {
  if (Number.isInteger(explicitTabId) && explicitTabId > 0) {
    const explicitTab = await getYoutubeTab(explicitTabId);
    throwIfCancelled(attempt);
    return explicitTab;
  }

  const preferredTab = await getYoutubeTab(state.preferredYoutubeTabId);
  throwIfCancelled(attempt);
  if (preferredTab) {
    setStatus("Connecting to your last YouTube tab...");
    return preferredTab;
  }

  const tabs = await listYoutubeTabs();
  throwIfCancelled(attempt);
  if (!tabs.length) return null;

  setStatus("Connecting to YouTube tab...");
  return tabs[0];
}

async function isContentScriptReady(tabId, attempt) {
  throwIfCancelled(attempt);
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__MAXAMP_CONTENT_SCRIPT_INSTANCE__),
    });
    throwIfCancelled(attempt);
    return Boolean(result?.[0]?.result);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return false;
  }
}

async function ensureContentScriptReady(tabId, attempt) {
  const maxAttempts = 5;

  for (let i = 0; i < maxAttempts; i++) {
    if (await isContentScriptReady(tabId, attempt)) return true;
    throwIfCancelled(attempt);

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"],
      });
    } catch (_) { }

    await abortableDelay(250, attempt);
  }

  return isContentScriptReady(tabId, attempt);
}

function handshakePort(port, attempt) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      attempt.signal.removeEventListener("abort", onAbort);
      try { port.onMessage.removeListener(onMessage); } catch (_) { }
      try { port.onDisconnect.removeListener(onDisconnect); } catch (_) { }
      resolve(ok);
    };

    const onMessage = (message) => {
      if (attempt.signal.aborted || state.connectionAttemptToken !== attempt.token) {
        finish(false);
        return;
      }

      handleContentMessage(message);
      if (message?.type === "YOUTUBE_STATE" || message?.type === "PLAYER_INFO") {
        finish(true);
      }
    };

    const onDisconnect = () => {
      void chrome.runtime?.lastError;
      finish(false);
    };

    const onAbort = () => {
      finish(false);
      disconnectPort(port);
    };

    const timeout = setTimeout(() => finish(false), 1200);
    attempt.signal.addEventListener("abort", onAbort, { once: true });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    try {
      port.postMessage({ type: "GET_STATE" });
    } catch (_) {
      finish(false);
    }
  });
}

async function establishPortWithHandshake(tabId, attempt) {
  const maxAttempts = 4;

  for (let i = 0; i < maxAttempts; i++) {
    throwIfCancelled(attempt);
    setConnectionPhase(CONNECTION_PHASES.HANDSHAKING);

    let port;
    try {
      port = chrome.tabs.connect(tabId, { name: "youtube-content" });
    } catch (_) {
      port = null;
    }

    if (port && await handshakePort(port, attempt)) {
      throwIfCancelled(attempt);
      return port;
    }

    disconnectPort(port);
    await abortableDelay(250, attempt);
  }

  return null;
}

function finishReconnectFailure() {
  cancelReconnectTimer();
  setConnectionPhase(CONNECTION_PHASES.FAILED);
  setStatus("Connection failed. Refresh the YouTube page or select another tab.");
  state.reconnectAttempts = 0;
}

function scheduleReconnect(tabId) {
  if (state.userDisconnected) return;

  if (state.reconnectAttempts >= state.MAX_RECONNECT_ATTEMPTS) {
    finishReconnectFailure();
    return;
  }

  state.reconnectAttempts++;
  setConnectionPhase(CONNECTION_PHASES.RECONNECTING);
  setStatus(
    `Disconnected. Reconnecting... (${state.reconnectAttempts}/${state.MAX_RECONNECT_ATTEMPTS})`
  );

  cancelReconnectTimer();
  state.reconnectTimeout = setTimeout(() => {
    state.reconnectTimeout = null;
    if (state.userDisconnected) return;
    void connectToYouTubeTab({ tabId, retry: true });
  }, 2000);
}

function bindActivePort(port, tabId) {
  const onMessage = (message) => handleContentMessage(message);
  const onDisconnect = () => {
    void chrome.runtime?.lastError;

    if (state.contentPort !== port) return;
    try { port.onMessage.removeListener(onMessage); } catch (_) { }
    try { port.onDisconnect.removeListener(onDisconnect); } catch (_) { }
    activePortBinding = null;
    state.contentPort = null;
    resetConnectedState();

    if (state.userDisconnected) {
      setConnectionPhase(CONNECTION_PHASES.DISCONNECTED);
      return;
    }

    scheduleReconnect(tabId);
  };

  activePortBinding = { port, onMessage, onDisconnect };
  state.contentPort = port;
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
}

export function disconnectFromYouTubeTab() {
  state.userDisconnected = true;
  cancelReconnectTimer();
  cancelActiveAttempt();
  disposeContentPort();
  resetConnectedState();
  state.youtubeTabId = null;
  state.reconnectAttempts = 0;
  setConnectionPhase(CONNECTION_PHASES.DISCONNECTED);
  setStatus("Disconnected from YouTube.");
}

export async function connectToYouTubeTab(options = {}) {
  const normalized = Number.isInteger(options)
    ? { tabId: options, retry: false }
    : options || {};
  const explicitTabId = Number(normalized.tabId) || null;
  const isRetry = normalized.retry === true;

  state.userDisconnected = false;
  if (!isRetry) state.reconnectAttempts = 0;

  const attempt = beginConnectionAttempt();
  disposeContentPort();
  resetConnectedState();
  setConnectionPhase(CONNECTION_PHASES.DISCONNECTED);
  setConnectionPhase(
    isRetry ? CONNECTION_PHASES.RECONNECTING : CONNECTION_PHASES.CONNECTING
  );

  let targetTabId = explicitTabId;

  try {
    const tab = await resolveYoutubeTab(explicitTabId, attempt);
    throwIfCancelled(attempt);

    if (!tab) {
      setStatus(
        explicitTabId
          ? "The selected YouTube tab is no longer available."
          : "No YouTube tab found. Open a YouTube video or playlist first."
      );
      activeAttempt = null;
      state.reconnectAttempts = 0;
      setConnectionPhase(CONNECTION_PHASES.DISCONNECTED);
      return false;
    }

    targetTabId = tab.id;
    state.youtubeTabId = targetTabId;

    const ready = await ensureContentScriptReady(targetTabId, attempt);
    throwIfCancelled(attempt);
    if (!ready) throw new Error("Content script is not ready on this YouTube tab");

    const port = await establishPortWithHandshake(targetTabId, attempt);
    throwIfCancelled(attempt);
    if (!port) throw new Error("Unable to establish connection with content script");

    bindActivePort(port, targetTabId);
    state.isConnected = true;
    setConnectionPhase(CONNECTION_PHASES.CONNECTED);
    state.reconnectAttempts = 0;
    activeAttempt = null;

    setStatus(`Connected to ${tab.title || "YouTube player"}`);
    savePreferredTabId(targetTabId);
    sendCommand("VOLUME", state.volume);
    sendCommand("GET_STATE");
    sendCommand("GET_PLAYLIST");
    return true;
  } catch (error) {
    if (error?.name === "AbortError") return false;
    if (state.connectionAttemptToken !== attempt.token) return false;

    activeAttempt = null;
    resetConnectedState();
    setStatus(`Error: ${error?.message || "Connection failed"}`);
    scheduleReconnect(targetTabId);
    return false;
  }
}
