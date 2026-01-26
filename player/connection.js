// player/connection.js
import { state } from "./state.js";
import { setStatus } from "./status.js";
import { handleContentMessage } from "./handlers.js";
import { stopUpdateInterval, sendCommand } from "./commands.js"; 
import { stopViz } from "./viz.js";

export async function connectToYouTubeTab() {
  if (state.reconnectTimeout) {
    clearTimeout(state.reconnectTimeout);
    state.reconnectTimeout = null;
  }

  try {
    const activeTabs = await chrome.tabs.query({
      url: ["https://www.youtube.com/*", "https://youtube.com/*"],
      active: true,
      currentWindow: true,
    });

    if (activeTabs.length > 0) {
      state.youtubeTabId = activeTabs[0].id;
      setStatus("Connecting to your YouTube tab...");
    } else {
      const windowTabs = await chrome.tabs.query({
        url: ["https://www.youtube.com/*", "https://youtube.com/*"],
        currentWindow: true,
      });

      if (windowTabs.length > 0) {
        state.youtubeTabId = windowTabs[0].id;
        setStatus("Connecting to YouTube tab in this window...");
      } else {
        const allTabs = await chrome.tabs.query({
          url: ["https://www.youtube.com/*", "https://youtube.com/*"],
        });

        if (allTabs.length === 0) {
          setStatus("No YouTube tab found. Open a YouTube video/playlist first.");
          state.isConnected = false;
          state.reconnectAttempts = 0;
          stopUpdateInterval();
          stopViz();
          return;
        }

        state.youtubeTabId = allTabs[0].id;
        setStatus("Connecting to YouTube tab...");
      }
    }

    await chrome.tabs.get(state.youtubeTabId);

    // safe inject
    try {
      await chrome.scripting
        .executeScript({
          target: { tabId: state.youtubeTabId },
          files: ["content-script.js"],
        })
        .catch(() => {});
    } catch (_) {}

    await new Promise((r) => setTimeout(r, 800));

    state.contentPort = chrome.tabs.connect(state.youtubeTabId, { name: "youtube-content" });

    // ✅ all messages go through handlers.js
    state.contentPort.onMessage.addListener(handleContentMessage);

    state.contentPort.onDisconnect.addListener(() => {
      state.contentPort = null;
      state.isConnected = false;
      stopUpdateInterval();
      stopViz();

      if (state.reconnectAttempts < state.MAX_RECONNECT_ATTEMPTS) {
        state.reconnectAttempts++;
        setStatus(
          `Disconnected. Reconnecting... (${state.reconnectAttempts}/${state.MAX_RECONNECT_ATTEMPTS})`
        );
        state.reconnectTimeout = setTimeout(connectToYouTubeTab, 2000);
      } else {
        setStatus("Connection failed. Please refresh the YouTube page and try again.");
        state.reconnectAttempts = 0;
      }
    });

    // initial
    setTimeout(() => {
      if (state.contentPort) {
        state.contentPort.postMessage({ type: "GET_STATE" });
        state.isConnected = true;
        state.reconnectAttempts = 0;
        setStatus("Connected to YouTube player");

        // ✅ request playlist listing once connected
        sendCommand("GET_PLAYLIST");
      }
    }, 200);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
    state.isConnected = false;
    stopUpdateInterval();
    stopViz();

    if (state.reconnectAttempts < state.MAX_RECONNECT_ATTEMPTS) {
      state.reconnectAttempts++;
      state.reconnectTimeout = setTimeout(connectToYouTubeTab, 2000);
    } else {
      state.reconnectAttempts = 0;
    }
  }
}
