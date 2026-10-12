// player/events.js
import { el, root } from "./dom.js";
import { state } from "./state.js";
import { setStatus, setHighlighted, fmtTime } from "./status.js";
import { sendCommand, stopUpdateInterval } from "./commands.js";
import {
  connectToYouTubeTab,
  disconnectFromYouTubeTab,
  listYoutubeTabs,
} from "./connection.js";
import { stopViz, cycleVizMode, getVizModeName } from "./viz.js";
import { scheduleUpdate as scheduleMarqueeUpdate } from "./marquee.js";
import { setResizeFunction } from "./playlist.js";
import {
  shouldSkipInitialWindowResize,
  saveVolumePref,
  saveVizModePref,
  savePlaylistCollapsedPref,
  saveWindowBoundsFromResize,
} from "./prefs.js";

function getVerticalPadding() {
  const outer = document.querySelector(".container");
  const outerStyle = outer ? getComputedStyle(outer) : null;
  return outerStyle
    ? (parseFloat(outerStyle.paddingTop) || 0) + (parseFloat(outerStyle.paddingBottom) || 0)
    : 24;
}

/** Minimum height so controls + "WINAMP PLAYLIST" header stay visible and clickable. */
function measureCollapsedHeight(verticalPadding) {
  const top = document.querySelector(".top-container");
  const playlistContainer = document.querySelector(".playlist-container");
  const bodyHeight =
    (top?.offsetHeight || 0) + (playlistContainer?.offsetHeight || 0);
  return Math.ceil(bodyHeight + verticalPadding + 8);
}

function measureExpandedHeight(verticalPadding) {
  const container = document.querySelector(".maxamp-container");
  if (!container) return measureCollapsedHeight(verticalPadding);
  return Math.ceil(container.offsetHeight + verticalPadding + 8);
}

export function setPlaylistCollapsed(collapsed) {
  state.playlistCollapsed = collapsed;
  const container = document.querySelector(".playlist-container");
  if (container) {
    container.classList.toggle("collapsed", collapsed);
  }
}

let boundsSaveTimer = null;
let tabListRefreshTimer = null;
let tabDiscoveryBound = false;

function getSelectedYoutubeTabId() {
  const tabId = Number(el.youtubeTabSelector?.value);
  return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
}

function formatTabLabel(tab) {
  const title = String(tab?.title || "YouTube").trim() || "YouTube";
  const activeMarker = tab.active ? "▶ " : "";
  return `${activeMarker}${title}`;
}

export function updateConnectionControls() {
  const selectedTabId = getSelectedYoutubeTabId();
  const isSwitch = state.isConnected && selectedTabId !== state.youtubeTabId;

  if (el.connectBtn) {
    el.connectBtn.textContent = isSwitch
      ? "SWITCH"
      : state.isConnected
        ? "RECONNECT"
        : "CONNECT";
    el.connectBtn.disabled = !selectedTabId;
  }

  if (el.disconnectBtn) {
    const attemptInProgress = [
      "connecting",
      "handshaking",
      "reconnecting",
    ].includes(state.connectionPhase);
    el.disconnectBtn.disabled = !state.isConnected && !attemptInProgress;
  }
}

export async function refreshYoutubeTabOptions(preferredSelection = null) {
  if (!el.youtubeTabSelector) return [];

  const previousSelection = getSelectedYoutubeTabId();
  const tabs = await listYoutubeTabs();
  const desiredTabId = preferredSelection ||
    previousSelection ||
    state.youtubeTabId ||
    state.preferredYoutubeTabId ||
    tabs[0]?.id ||
    null;

  el.youtubeTabSelector.replaceChildren();

  if (!tabs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No YouTube tabs found";
    el.youtubeTabSelector.appendChild(option);
    el.youtubeTabSelector.disabled = true;
    updateConnectionControls();
    return [];
  }

  el.youtubeTabSelector.disabled = false;
  for (const tab of tabs) {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = formatTabLabel(tab);
    option.title = tab.url || option.textContent;
    el.youtubeTabSelector.appendChild(option);
  }

  const desiredExists = tabs.some((tab) => tab.id === desiredTabId);
  el.youtubeTabSelector.value = String(
    desiredExists ? desiredTabId : tabs[0].id
  );
  updateConnectionControls();
  return tabs;
}

function scheduleTabListRefresh() {
  if (tabListRefreshTimer) clearTimeout(tabListRefreshTimer);
  tabListRefreshTimer = setTimeout(() => {
    tabListRefreshTimer = null;
    void refreshYoutubeTabOptions();
  }, 150);
}

function bindTabDiscovery() {
  if (tabDiscoveryBound) return;
  tabDiscoveryBound = true;

  try {
    chrome.tabs.onCreated.addListener(scheduleTabListRefresh);
    chrome.tabs.onRemoved.addListener(scheduleTabListRefresh);
    chrome.tabs.onUpdated.addListener(scheduleTabListRefresh);
    chrome.tabs.onActivated.addListener(scheduleTabListRefresh);
  } catch (_) { /* optional in test/mocked environments */ }
}

function debouncedSaveWindowBounds() {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    saveWindowBoundsFromResize();
  }, 450);
}

async function resizeWindowToContent(options = {}) {
  const { growOnly = false } = options;

  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (!currentWindow?.id) return;

    const verticalPadding = getVerticalPadding();
    const collapsedMin = measureCollapsedHeight(verticalPadding);

    // Let layout settle before measuring after collapse/expand changes.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const desiredHeight = state.playlistCollapsed
      ? collapsedMin
      : measureExpandedHeight(verticalPadding);

    let newHeight = Math.max(240, collapsedMin, desiredHeight);

    if (growOnly && typeof currentWindow.height === "number") {
      newHeight = Math.max(newHeight, currentWindow.height);
    }

    await chrome.windows.update(currentWindow.id, {
      height: newHeight
    });
    debouncedSaveWindowBounds();
  } catch (error) {
    console.error("Failed to resize window:", error);
  }
}

export function bindUI() {
  // hide unused
  // (if these exist in DOM)
  const playlistInput = document.querySelector(".playlist-input");
  const loadBtn = document.querySelector(".load-btn");
  if (loadBtn) loadBtn.style.display = "none";
  if (playlistInput) playlistInput.style.display = "none";

  if (el.playBtn) el.playBtn.addEventListener("click", () => sendCommand("PLAY"));
  if (el.stopBtn) el.stopBtn.addEventListener("click", onStop);
  if (el.pauseBtn) el.pauseBtn.addEventListener("click", onPause);

  el.navBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.isConnected) return setStatus("Not connected to YouTube.");
      if (btn.dataset.nav === "prev") sendCommand("PREV");
      if (btn.dataset.nav === "next") sendCommand("NEXT");
    });
  });

  if (el.progressBar) {
    const updateScrubPreview = () => {
      if (!el.timeDisplayer) return;
      if (!state.lastDuration || !Number.isFinite(state.lastDuration) || state.lastDuration <= 0) return;

      const fraction = Number(el.progressBar.value || 0);
      const t = Math.max(0, Math.min(state.lastDuration, state.lastDuration * fraction));

      state.scrubTime = t;

      // Show the scrubbed time while dragging
      el.timeDisplayer.textContent = fmtTime(t);
      // Optional: hover tooltip for precise seconds
      el.timeDisplayer.title = `${t.toFixed(3)}s`;
    };

    el.progressBar.addEventListener("input", () => {
      state.userDraggingProgress = true;
      updateScrubPreview();
    });

    if (el.visualisationCanvas) {
      el.visualisationCanvas.addEventListener("click", () => {
        cycleVizMode();
        saveVizModePref();
        setStatus(`Visualizer: ${getVizModeName()}`);
      });
    }

    el.progressBar.addEventListener("change", () => {
      state.userDraggingProgress = false;
      if (!state.isConnected || !state.lastDuration) return;

      const fraction = Number(el.progressBar.value || 0);
      const t = Math.max(0, Math.min(state.lastDuration, state.lastDuration * fraction));

      state.lastCurrentTime = t;
      state.scrubTime = null;
      if (el.timeDisplayer) {
        el.timeDisplayer.textContent = fmtTime(t);
        el.timeDisplayer.title = `${t.toFixed(3)}s`;
      }

      sendCommand("SEEK", t);
    });
  }


  if (el.volumeController) {
    state.volume = Number(el.volumeController.value || state.volume);
    root.style.setProperty("--volume-track-lightness", 100 - state.volume / 2 + "%");

    el.volumeController.addEventListener("input", (e) => {
      const v = Number(e.target.value || 0);
      state.volume = v;
      sendCommand("VOLUME", v);
      saveVolumePref(v);
      root.style.setProperty("--volume-track-lightness", 100 - v / 2 + "%");
    });
  }

  if (el.shuffleBtn) {
    el.shuffleBtn.addEventListener("click", () => {
      if (!state.isConnected) return setStatus("Not connected to YouTube.");
      state.isShuffleOn = !state.isShuffleOn;
      setHighlighted(el.shuffleBtn, state.isShuffleOn);

      if (state.isShuffleOn && state.repeatMode > 0) {
        state.repeatMode = 0;
        setHighlighted(el.repeatBtn, false);
        sendCommand("LOOP", 0);
      }

      sendCommand("SHUFFLE", state.isShuffleOn);
      setStatus(state.isShuffleOn ? "Shuffle ON" : "Shuffle OFF");
    });
  }

  if (el.repeatBtn) {
    el.repeatBtn.addEventListener("click", () => {
      if (!state.isConnected) return setStatus("Not connected to YouTube.");

      state.repeatMode = (state.repeatMode + 1) % 3;
      setHighlighted(el.repeatBtn, state.repeatMode > 0);

      if (state.repeatMode > 0 && state.isShuffleOn) {
        state.isShuffleOn = false;
        setHighlighted(el.shuffleBtn, false);
        sendCommand("SHUFFLE", false);
      }

      sendCommand("LOOP", state.repeatMode);
      setStatus(`Loop: ${["OFF", "REPEAT PLAYLIST", "REPEAT CURRENT"][state.repeatMode]}`);
    });
  }

  el.resizable?.forEach((resize) => {
    resize.addEventListener("click", async (e) => {
      e.stopPropagation();
      const container = resize.closest(".playlist-container, .visualisation-container");
      if (!container) return;

      if (container.classList.contains("playlist-container")) {
        setPlaylistCollapsed(!state.playlistCollapsed);
        savePlaylistCollapsedPref(state.playlistCollapsed);
        await resizeWindowToContent();
        debouncedSaveWindowBounds();
        return;
      }

      const currentHeight = container.style.height;
      const newHeight = currentHeight === "auto" ? "2rem" : "auto";
      container.style.height = newHeight;
      if (container.classList.contains("visualisation-container") && newHeight === "2rem") stopViz();
      await resizeWindowToContent();
    });
  });

  if (el.youtubeTabSelector) {
    el.youtubeTabSelector.addEventListener("focus", () => {
      void refreshYoutubeTabOptions();
    });
    el.youtubeTabSelector.addEventListener("change", () => {
      const selected = el.youtubeTabSelector.selectedOptions?.[0]?.textContent || "YouTube tab";
      updateConnectionControls();
      setStatus(`Selected ${selected}. Press ${el.connectBtn?.textContent || "CONNECT"}.`);
    });
  }

  if (el.connectBtn) {
    el.connectBtn.addEventListener("click", async () => {
      const tabId = getSelectedYoutubeTabId();
      if (!tabId) {
        setStatus("No YouTube tab selected.");
        await refreshYoutubeTabOptions();
        return;
      }

      const switchingTabs = state.isConnected && tabId !== state.youtubeTabId;
      setStatus(
        switchingTabs
          ? "Switching YouTube tab..."
          : state.isConnected
            ? "Reconnecting..."
            : "Connecting..."
      );
      updateConnectionControls();
      await connectToYouTubeTab({ tabId });
      await refreshYoutubeTabOptions(tabId);
      updateConnectionControls();
    });
  }

  if (el.disconnectBtn) {
    el.disconnectBtn.addEventListener("click", () => {
      disconnectFromYouTubeTab();
      updateConnectionControls();
    });
  }

  bindTabDiscovery();
  updateConnectionControls();
  window.addEventListener("maxamp-connection-change", updateConnectionControls);

  window.addEventListener("resize", () => scheduleMarqueeUpdate());

  // Export resize function to playlist module
  setResizeFunction(resizeWindowToContent);

  if (!shouldSkipInitialWindowResize()) {
    setTimeout(resizeWindowToContent, 100);
  }
}

function onStop() {
  sendCommand("STOP");
  state.play = false;
  state.pause = false;
  setHighlighted(el.playBtn, false);
  setHighlighted(el.stopBtn, false);
  setHighlighted(el.pauseBtn, false);
  if (el.progressBar) el.progressBar.value = "0";
  if (el.timeDisplayer) el.timeDisplayer.textContent = "00:00";
  stopUpdateInterval();
  stopViz();
  state.scrubTime = null;
}

function onPause() {
  if (!state.play) return;
  if (!state.pause) sendCommand("PAUSE");
  else sendCommand("PLAY");
}
