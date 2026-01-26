// player/events.js
import { el, root } from "./dom.js";
import { state } from "./state.js";
import { setStatus, setHighlighted, fmtTime } from "./status.js";
import { sendCommand, stopUpdateInterval } from "./commands.js";
import { connectToYouTubeTab } from "./connection.js";
import { stopViz } from "./viz.js";
import { scheduleUpdate as scheduleMarqueeUpdate } from "./marquee.js";
import { setResizeFunction } from "./playlist.js";

async function resizeWindowToContent() {
  try {
    // Get the current window
    const windows = await chrome.windows.getAll();
    const currentWindow = windows.find(w => w.type === "popup" && w.url?.includes("player.html"));

    if (!currentWindow) return;

    // Calculate the new height based on content
    const container = document.querySelector(".maxamp-container");
    if (!container) return;

    // Get the actual content height
    const contentHeight = container.scrollHeight;
    const padding = 24; // 12px top + 12px bottom
    const newHeight = contentHeight + padding;

    // Resize the window
    await chrome.windows.update(currentWindow.id, {
      height: newHeight,
      width: currentWindow.width // Keep the same width
    });
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
    const initV = Number(el.volumeController.value || 0);
    root.style.setProperty("--volume-track-lightness", 100 - initV / 2 + "%");

    el.volumeController.addEventListener("input", (e) => {
      const v = Number(e.target.value || 0);
      sendCommand("VOLUME", v);
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
    resize.addEventListener("click", async () => {
      const container = resize.closest(".playlist-container, .visualisation-container");
      if (!container) return;

      // For playlist container, toggle the playlist content visibility
      if (container.classList.contains("playlist-container")) {
        const playlist = container.querySelector(".playlist");
        const isCollapsed = playlist?.style.display === "none";

        if (playlist) {
          playlist.style.display = isCollapsed ? "" : "none";
          container.classList.toggle("collapsed", !isCollapsed);
        }

        // Resize window automatically
        await resizeWindowToContent();
      } else {
        // For visualisation container, use the old behavior
        const currentHeight = container.style.height;
        const newHeight = currentHeight === "auto" ? "2rem" : "auto";
        container.style.height = newHeight;
        if (container.classList.contains("visualisation-container") && newHeight === "2rem") stopViz();
        await resizeWindowToContent();
      }
    });
  });

  if (el.connectBtn) {
    el.connectBtn.addEventListener("click", () => {
      state.reconnectAttempts = 0;
      if (state.reconnectTimeout) {
        clearTimeout(state.reconnectTimeout);
        state.reconnectTimeout = null;
      }
      setStatus("Connecting...");
      connectToYouTubeTab();
    });
  }

  window.addEventListener("resize", () => scheduleMarqueeUpdate());

  // Export resize function to playlist module
  setResizeFunction(resizeWindowToContent);

  // Resize window on initial load
  setTimeout(resizeWindowToContent, 100);
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
