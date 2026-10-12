// player/connection.js
import { state, CONNECTION_PHASES } from "./state.js";
import { setStatus } from "./status.js";
import { handleContentMessage } from "./handlers.js";
import { stopUpdateInterval, sendCommand } from "./commands.js"; 
import { stopViz } from "./viz.js";
import { savePreferredTabId } from "./prefs.js";

const ALLOWED_PHASE_TRANSITIONS = {
  [CONNECTION_PHASES.DISCONNECTED]: [CONNECTION_PHASES.CONNECTING, CONNECTION_PHASES.FAILED],
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
  ],
  [CONNECTION_PHASES.CONNECTED]: [CONNECTION_PHASES.RECONNECTING, CONNECTION_PHASES.DISCONNECTED],
  [CONNECTION_PHASES.RECONNECTING]: [
    CONNECTION_PHASES.CONNECTING,
    CONNECTION_PHASES.CONNECTED,
    CONNECTION_PHASES.FAILED,
  ],
  [CONNECTION_PHASES.FAILED]: [CONNECTION_PHASES.CONNECTING, CONNECTION_PHASES.DISCONNECTED],
};

function setConnectionPhase(next) {
  const current = state.connectionPhase;
  if (current === next) return;
  if (!(ALLOWED_PHASE_TRANSITIONS[current] || []).includes(next)) {
    return;
  }
  state.connectionPhase = next;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function isContentScriptReady(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__MAXAMP_CONTENT_SCRIPT_INSTANCE__),
    });
    return Boolean(result?.[0]?.result);
  } catch (_) {
    return false;
  }
}

async function ensureContentScriptReady(tabId) {
  const maxAttempts = 5;

  for (let i = 0; i < maxAttempts; i++) {
    if (await isContentScriptReady(tabId)) return true;

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"],
      });
    } catch (_) {}

    await sleep(250);
  }

  return isContentScriptReady(tabId);
}

async function tryGetPreferredYoutubeTabId() {
  const preferred = state.preferredYoutubeTabId;
  if (!Number.isInteger(preferred) || preferred <= 0) return null;
  try {
    const tab = await chrome.tabs.get(preferred);
    const url = tab?.url || "";
    if (!/https?:\/\/(www\.)?youtube\.com\//i.test(url)) return null;
    return tab.id;
  } catch (_) {
    return null;
  }
}

async function resolveYoutubeTabId() {
  const preferredId = await tryGetPreferredYoutubeTabId();
  if (preferredId != null) {
    setStatus("Connecting to your last YouTube tab...");
    return preferredId;
  }

  const activeTabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/*", "https://youtube.com/*"],
    active: true,
    currentWindow: true,
  });

  if (activeTabs.length > 0) {
    setStatus("Connecting to your YouTube tab...");
    return activeTabs[0].id;
  }

  const windowTabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/*", "https://youtube.com/*"],
    currentWindow: true,
  });

  if (windowTabs.length > 0) {
    setStatus("Connecting to YouTube tab in this window...");
    return windowTabs[0].id;
  }

  const allTabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/*", "https://youtube.com/*"],
  });

  if (allTabs.length === 0) return null;

  setStatus("Connecting to YouTube tab...");
  return allTabs[0].id;
}

async function establishPortWithHandshake(tabId) {
  const maxAttempts = 4;

  for (let i = 0; i < maxAttempts; i++) {
    setConnectionPhase(CONNECTION_PHASES.HANDSHAKING);
    const port = chrome.tabs.connect(tabId, { name: "youtube-content" });
    let handshakeResolved = false;

    const handshakeOk = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup(false);
      }, 1200);

      const onMessage = (msg) => {
        handleContentMessage(msg);
        if (!msg?.type || handshakeResolved) return;
        if (msg.type === "YOUTUBE_STATE" || msg.type === "PLAYER_INFO") {
          cleanup(true);
        }
      };

      const onDisconnect = () => {
        // Consume runtime.lastError to avoid noisy unchecked disconnect logs.
        void chrome.runtime.lastError;
        cleanup(false);
      };

      function cleanup(ok) {
        if (handshakeResolved) return;
        handshakeResolved = true;
        clearTimeout(timeout);
        try { port.onMessage.removeListener(onMessage); } catch (_) {}
        try { port.onDisconnect.removeListener(onDisconnect); } catch (_) {}
        resolve(ok);
      }

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);

      try {
        port.postMessage({ type: "GET_STATE" });
      } catch (_) {
        cleanup(false);
      }
    });

    if (handshakeOk) return port;

    try { port.disconnect(); } catch (_) {}
    await sleep(250);
  }

  return null;
}

export async function connectToYouTubeTab() {
  if (state.reconnectTimeout) {
    clearTimeout(state.reconnectTimeout);
    state.reconnectTimeout = null;
  }

  try {
    setConnectionPhase(
      state.reconnectAttempts > 0
        ? CONNECTION_PHASES.RECONNECTING
        : CONNECTION_PHASES.CONNECTING
    );

    const tabId = await resolveYoutubeTabId();
    if (tabId == null) {
      setStatus("No YouTube tab found. Open a YouTube video/playlist first.");
      state.isConnected = false;
      setConnectionPhase(CONNECTION_PHASES.DISCONNECTED);
      state.reconnectAttempts = 0;
      stopUpdateInterval();
      stopViz();
      return;
    }
    state.youtubeTabId = tabId;

    await chrome.tabs.get(state.youtubeTabId);

    const ready = await ensureContentScriptReady(state.youtubeTabId);
    if (!ready) {
      throw new Error("Content script is not ready on this YouTube tab");
    }

    state.contentPort = await establishPortWithHandshake(state.youtubeTabId);
    if (!state.contentPort) {
      throw new Error("Unable to establish connection with content script");
    }

    // ✅ all messages go through handlers.js
    state.contentPort.onMessage.addListener(handleContentMessage);

    state.contentPort.onDisconnect.addListener(() => {
      // Consume runtime.lastError so Chrome does not report it as unchecked.
      void chrome.runtime.lastError;
      state.contentPort = null;
      state.isConnected = false;
      setConnectionPhase(CONNECTION_PHASES.RECONNECTING);
      stopUpdateInterval();
      stopViz();

      if (state.reconnectAttempts < state.MAX_RECONNECT_ATTEMPTS) {
        state.reconnectAttempts++;
        setStatus(
          `Disconnected. Reconnecting... (${state.reconnectAttempts}/${state.MAX_RECONNECT_ATTEMPTS})`
        );
        state.reconnectTimeout = setTimeout(connectToYouTubeTab, 2000);
      } else {
        setConnectionPhase(CONNECTION_PHASES.FAILED);
        setStatus("Connection failed. Please refresh the YouTube page and try again.");
        state.reconnectAttempts = 0;
      }
    });

    state.isConnected = true;
    setConnectionPhase(CONNECTION_PHASES.CONNECTED);
    state.reconnectAttempts = 0;
    setStatus("Connected to YouTube player");
    savePreferredTabId(state.youtubeTabId);
    sendCommand("VOLUME", state.volume);
    sendCommand("GET_STATE");
    sendCommand("GET_PLAYLIST");
  } catch (e) {
    setStatus(`Error: ${e.message}`);
    state.isConnected = false;
    stopUpdateInterval();
    stopViz();

    if (state.reconnectAttempts < state.MAX_RECONNECT_ATTEMPTS) {
      setConnectionPhase(CONNECTION_PHASES.RECONNECTING);
      state.reconnectAttempts++;
      state.reconnectTimeout = setTimeout(connectToYouTubeTab, 2000);
    } else {
      setConnectionPhase(CONNECTION_PHASES.FAILED);
      state.reconnectAttempts = 0;
    }
  }
}
