// player/events.js
import { el, root } from "./dom.js";
import { state } from "./state.js";
import { setStatus, setHighlighted } from "./status.js";
import { sendCommand, stopUpdateInterval } from "./commands.js";
import { connectToYouTubeTab } from "./connection.js";
import { stopViz } from "./viz.js";
import { scheduleUpdate as scheduleMarqueeUpdate } from "./marquee.js";

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
    el.progressBar.addEventListener("input", () => (state.userDraggingProgress = true));
    el.progressBar.addEventListener("change", () => {
      state.userDraggingProgress = false;
      if (!state.isConnected || !state.lastDuration) return;
      const fraction = Number(el.progressBar.value || 0);
      sendCommand("SEEK", state.lastDuration * fraction);
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
    resize.addEventListener("click", () => {
      const container = resize.closest(".playlist-container, .visualisation-container");
      if (!container) return;
      const currentHeight = container.style.height;
      const newHeight = currentHeight === "auto" ? "2rem" : "auto";
      container.style.height = newHeight;
      if (container.classList.contains("visualisation-container") && newHeight === "2rem") stopViz();
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
}

function onPause() {
  if (!state.play) return;
  if (!state.pause) sendCommand("PAUSE");
  else sendCommand("PLAY");
}
