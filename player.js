// player.js - Controls active YouTube player via content script

const qs = document.querySelector.bind(document);
const qsall = document.querySelectorAll.bind(document);
const root = document.documentElement;

// Marquee title elements (Winamp-style)
const trackTitleMarquee = qs(".track-title-marquee");
const trackTitleInner = qs(".track-title-inner");
const trackTitleTextA = qs(".track-title-text");
const trackTitleTextB = qs(".track-title-text.clone");

// UI elements
const timeDisplayer = qs(".time-displayer");
const trackInfoDisplayer = qs(".track-info-displayer"); // legacy (kept)
const volumeController = qs(".volume-controller");
const progressBar = qs(".progress-bar");
const resizable = qsall(".resizable");
const navBtns = qsall(".nav-btn");

const playBtn = qs(".play-btn");
const pauseBtn = qs(".pause-btn");
const stopBtn = qs(".stop-btn");
const shuffleBtn = qs(".shuffle-btn");
const repeatBtn = qs(".repeat-btn");

const playlistInput = qs(".playlist-input");
const loadBtn = qs(".load-btn");
const connectBtn = qs(".connect-btn");

const statusText = qs(".status-text");
const nowPlaying = qs(".now-playing");

/* ---------------------------
 *  Visualisation (Winamp-style)
 *  --------------------------*/
const visualisationCanvas = qs(".visualisation");
const vizCtx = visualisationCanvas ? visualisationCanvas.getContext("2d") : null;

let vizRunning = false;
let latestVizBars = null; // array 0..255
let peakBars = [];        // peak-hold effect
let vizRaf = null;

function setCanvasCrispSize() {
  if (!visualisationCanvas || !vizCtx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = visualisationCanvas.getBoundingClientRect();

  // If canvas is display:none, rect can be 0; fallback to attributes
  const cssW = rect.width || visualisationCanvas.getAttribute("width") || 320;
  const cssH = rect.height || visualisationCanvas.getAttribute("height") || 80;

  const w = Math.max(1, Math.floor(Number(cssW) * dpr));
  const h = Math.max(1, Math.floor(Number(cssH) * dpr));

  if (visualisationCanvas.width !== w) visualisationCanvas.width = w;
  if (visualisationCanvas.height !== h) visualisationCanvas.height = h;

  // Draw in CSS pixels
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawViz() {
  if (!vizRunning || !vizCtx || !visualisationCanvas) return;

  setCanvasCrispSize();

  const rect = visualisationCanvas.getBoundingClientRect();
  const W = rect.width || 96;
  const H = rect.height || 24;

  // Background
  vizCtx.save();
  vizCtx.fillStyle = "#000000";
  vizCtx.fillRect(0, 0, W, H);

  const bars = latestVizBars;
  if (bars && bars.length) {
    const n = bars.length;
    if (peakBars.length !== n) peakBars = new Array(n).fill(0);

    const gap = 1; // tiny canvas -> small gap
    const barW = Math.max(1, Math.floor((W - (n - 1) * gap) / n));

    for (let i = 0; i < n; i++) {
      const v = bars[i] / 255; // 0..1
      const barH = Math.max(0, Math.floor(v * H));
      const x = i * (barW + gap);
      const y = H - barH;

      // Bars
      vizCtx.fillStyle = "#00ff66";
      vizCtx.fillRect(x, y, barW, barH);

      // Peak hold (decay)
      const nextPeak = Math.max(barH, peakBars[i] - 1);
      peakBars[i] = nextPeak;

      vizCtx.fillStyle = "#aaffcc";
      vizCtx.fillRect(x, H - peakBars[i], barW, 2);
    }
  }

  vizCtx.restore();
  vizRaf = requestAnimationFrame(drawViz);
}

function startViz() {
  if (!visualisationCanvas || vizRunning) return;
  vizRunning = true;
  visualisationCanvas.style.display = "block";
  peakBars = [];
  sendCommand("START_VIZ");
  vizRaf = requestAnimationFrame(drawViz);
}

function stopViz() {
  if (!visualisationCanvas || !vizRunning) return;
  vizRunning = false;

  // best-effort stop
  try { sendCommand("STOP_VIZ"); } catch (_) { }

  if (vizRaf) cancelAnimationFrame(vizRaf);
  vizRaf = null;
  latestVizBars = null;
  peakBars = [];

  if (vizCtx) vizCtx.clearRect(0, 0, visualisationCanvas.width, visualisationCanvas.height);
  visualisationCanvas.style.display = "none";
}

/* ---------------------------
 *  Player state
 *  --------------------------*/
let play = false;
let pause = false;

// shuffle boolean only
let isShuffleOn = false;

// repeat numeric only: 0=off, 1=playlist, 2=current
let repeatMode = 0;

let lastDuration = 0;
let lastCurrentTime = 0;
let lastTitle = "";
let userDraggingProgress = false;

let contentPort = null;
let youtubeTabId = null;
let updateInterval = null;
let isConnected = false;

/* ---------------------------
 *  Status helpers
 *  --------------------------*/
function setStatus(t) {
  if (statusText) statusText.textContent = t ?? "";
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setHighlighted(btn, on) {
  if (!btn) return;
  if (on) btn.classList.add("highlighted");
  else btn.classList.remove("highlighted");
}

/* ---------------------------
 *  Winamp-style scrolling title
 *  --------------------------*/
// IMPORTANT: avoid restarting animation every second.
// Only update when title changes, and schedule measurement once per frame burst.
let lastMarqueeTitle = "";
let marqueeScheduled = false;

function setTrackTitle(title) {
  if (!trackTitleMarquee || !trackTitleInner || !trackTitleTextA || !trackTitleTextB) return;

  const next = title || "YouTube Player";
  if (next === lastMarqueeTitle) return;

  lastMarqueeTitle = next;

  // set BOTH copies
  trackTitleTextA.textContent = next;
  trackTitleTextB.textContent = next;

  scheduleMarqueeUpdate();
}

function scheduleMarqueeUpdate() {
  if (marqueeScheduled) return;
  marqueeScheduled = true;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      marqueeScheduled = false;
      updateMarquee();
    });
  });
}

function updateMarquee() {
  if (!trackTitleMarquee || !trackTitleInner || !trackTitleTextA) return;

  // stop animation cleanly
  trackTitleMarquee.classList.remove("scrolling");
  trackTitleMarquee.style.removeProperty("--marquee-duration");
  trackTitleMarquee.style.removeProperty("--marquee-shift");
  trackTitleInner.style.transform = "translateX(0)";

  // force restart capability
  void trackTitleInner.offsetWidth;

  const containerW = trackTitleMarquee.clientWidth;
  const textW = trackTitleTextA.scrollWidth;

  // if it fits, don't scroll
  if (textW <= containerW - 8) return;

  // how far to shift to bring the 2nd copy to where the 1st started
  const gap = 40;
  const shift = textW + gap;

  // speed control
  const pxPerSec = 45;
  const duration = Math.max(6, shift / pxPerSec);

  trackTitleMarquee.style.setProperty("--marquee-gap", `${gap}px`);
  trackTitleMarquee.style.setProperty("--marquee-shift", `${shift}px`);
  trackTitleMarquee.style.setProperty("--marquee-duration", `${duration}s`);

  trackTitleMarquee.classList.add("scrolling");
}

window.addEventListener("resize", scheduleMarqueeUpdate);

/* ---------------------------
 *  Reconnect helpers
 *  --------------------------*/
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let reconnectTimeout = null;

/* ---------------------------
 *  Connect to YouTube tab
 *  --------------------------*/
async function connectToYouTubeTab() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    console.debug("Looking for YouTube tabs...");

    // Prefer active YouTube tab
    const activeTabs = await chrome.tabs.query({
      url: ["https://www.youtube.com/*", "https://youtube.com/*"],
      active: true,
      currentWindow: true,
    });

    if (activeTabs.length > 0) {
      youtubeTabId = activeTabs[0].id;
      setStatus("Connecting to your YouTube tab...");
    } else {
      // Any YT tab in current window
      const windowTabs = await chrome.tabs.query({
        url: ["https://www.youtube.com/*", "https://youtube.com/*"],
        currentWindow: true,
      });

      if (windowTabs.length > 0) {
        youtubeTabId = windowTabs[0].id;
        setStatus("Connecting to YouTube tab in this window...");
      } else {
        // Any YT tab anywhere
        const allTabs = await chrome.tabs.query({
          url: ["https://www.youtube.com/*", "https://youtube.com/*"],
        });

        if (allTabs.length > 0) {
          youtubeTabId = allTabs[0].id;
          setStatus("Connecting to YouTube tab...");
        } else {
          setStatus("No YouTube tab found. Open a YouTube video/playlist first.");
          if (nowPlaying) {
            nowPlaying.innerHTML =
              "⚠️ No YouTube tab found<br><small>Open a YouTube video or playlist page first, then open this extension</small>";
          }
          isConnected = false;
          reconnectAttempts = 0;
          stopViz();
          return;
        }
      }
    }

    // Validate tab exists
    try {
      await chrome.tabs.get(youtubeTabId);
    } catch (error) {
      console.error("Tab not accessible:", error);
      setStatus("YouTube tab not accessible. Please refresh the YouTube page.");
      isConnected = false;
      reconnectAttempts = 0;
      stopViz();
      return;
    }

    // Ensure content script is injected (safe if already injected)
    try {
      await chrome.scripting
        .executeScript({
          target: { tabId: youtubeTabId },
          files: ["content-script.js"],
        })
        .catch(() => { });
    } catch (_) { }

    // Give it a moment
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Connect
    contentPort = chrome.tabs.connect(youtubeTabId, { name: "youtube-content" });

    contentPort.onMessage.addListener((msg) => handleContentMessage(msg));

    contentPort.onDisconnect.addListener(() => {
      const wasConnected = isConnected;
      contentPort = null;
      isConnected = false;

      stopUpdateInterval();
      stopViz();

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        setStatus(`Disconnected. Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimeout = setTimeout(() => connectToYouTubeTab(), 2000);
      } else {
        setStatus("Connection failed. Please refresh the YouTube page and try again.");
        reconnectAttempts = 0;
      }

      if (chrome.runtime.lastError && wasConnected) {
        console.debug("Disconnect reason:", chrome.runtime.lastError.message);
      }
    });

    // Request initial state
    setTimeout(() => {
      try {
        if (contentPort) {
          contentPort.postMessage({ type: "GET_STATE" });
          isConnected = true;
          reconnectAttempts = 0;
          setStatus("Connected to YouTube player");
        }
      } catch (e) {
        console.error("Initial GET_STATE failed:", e);
        contentPort = null;
        isConnected = false;
      }
    }, 200);

  } catch (error) {
    console.error("Error in connectToYouTubeTab:", error);
    setStatus(`Error: ${error.message}`);
    isConnected = false;
    stopViz();

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      reconnectTimeout = setTimeout(() => connectToYouTubeTab(), 2000);
    } else {
      reconnectAttempts = 0;
    }
  }
}

/* ---------------------------
 *  Content messages
 *  --------------------------*/
function handleContentMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "YOUTUBE_STATE":
      handleYouTubeState(msg);
      break;
    case "PLAYER_INFO":
      handlePlayerInfo(msg);
      break;
    case "AUDIO_DATA":
      if (Array.isArray(msg.bars)) latestVizBars = msg.bars;
      break;
  }
}

function handleYouTubeState(state) {
  if (!state.hasPlayer) {
    setStatus("No video player found on this YouTube page.");
    if (nowPlaying) nowPlaying.textContent = "No video player found. Navigate to a video or playlist.";
    stopViz();
    return;
  }

  if (state.playlistId) {
    setStatus(`Connected to playlist: ${state.playlistId}`);
    if (nowPlaying) nowPlaying.textContent = `Connected to playlist: ${state.playlistId}`;
  } else if (state.videoId) {
    setStatus(`Connected to video: ${state.videoId}`);
    if (nowPlaying) nowPlaying.textContent = `Connected to video: ${state.videoId}`;
  }

  startUpdateInterval();
}

function handlePlayerInfo(info) {
  if (info.error) {
    setStatus(info.error);
    stopViz();
    return;
  }

  if (typeof info.currentTime === "number") lastCurrentTime = info.currentTime;
  if (typeof info.duration === "number" && info.duration > 0) lastDuration = info.duration;
  if (typeof info.title === "string") lastTitle = info.title || lastTitle;

  if (typeof info.volume === "number" && volumeController) {
    volumeController.value = String(info.volume);
  }

  // Sync shuffle / loop from YouTube
  if (typeof info.shuffle === "boolean") {
    isShuffleOn = info.shuffle;
    setHighlighted(shuffleBtn, isShuffleOn);
  }
  if (typeof info.loop === "number") {
    repeatMode = info.loop; // 0/1/2
    setHighlighted(repeatBtn, repeatMode > 0);
  } else if (typeof info.loop === "boolean") {
    repeatMode = info.loop ? 1 : 0;
    setHighlighted(repeatBtn, repeatMode > 0);
  }

  if (timeDisplayer) timeDisplayer.textContent = fmtTime(lastCurrentTime);
  setTrackTitle(lastTitle ? lastTitle : "YouTube Player");

  if (nowPlaying) {
    nowPlaying.textContent = lastTitle ? `Now Playing: ${lastTitle}` : "Now Playing: —";
  }

  if (!userDraggingProgress && lastDuration > 0 && progressBar) {
    const frac = Math.max(0, Math.min(1, lastCurrentTime / lastDuration));
    progressBar.value = String(frac);
  }

  const playerState = info.playerState;
  if (playerState === 1) {
    // Playing
    play = true;
    pause = false;
    setHighlighted(playBtn, true);
    setHighlighted(stopBtn, true);
    setHighlighted(pauseBtn, false);
    startViz();
  } else if (playerState === 2) {
    // Paused
    pause = true;
    setHighlighted(pauseBtn, true);
    stopViz();
  }
}

/* ---------------------------
 *  Send command
 *  --------------------------*/
function sendCommand(cmd, value) {
  if (!contentPort || !isConnected) {
    setStatus("Not connected to YouTube. Reconnecting...");
    reconnectAttempts = 0;
    connectToYouTubeTab();
    return;
  }

  try {
    contentPort.postMessage({ type: cmd, value });
  } catch (error) {
    console.error("Error sending command:", error);
    setStatus(`Error: ${error.message}`);
    contentPort = null;
    isConnected = false;
    reconnectAttempts = 0;
    stopViz();
    connectToYouTubeTab();
  }
}

/* ---------------------------
 *  Update polling
 *  --------------------------*/
function startUpdateInterval() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => {
    if (isConnected) sendCommand("GET_STATE");
  }, 1000);
}

function stopUpdateInterval() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

/* ---------------------------
 *  UI Events
 *  --------------------------*/
if (loadBtn) loadBtn.style.display = "none";
if (playlistInput) playlistInput.style.display = "none";

if (playBtn) {
  playBtn.addEventListener("click", () => {
    sendCommand("PLAY");
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    sendCommand("STOP");
    play = false;
    pause = false;
    setHighlighted(playBtn, false);
    setHighlighted(stopBtn, false);
    setHighlighted(pauseBtn, false);
    if (progressBar) progressBar.value = "0";
    if (timeDisplayer) timeDisplayer.textContent = "00:00";
    stopUpdateInterval();
    stopViz();
  });
}

if (pauseBtn) {
  pauseBtn.addEventListener("click", () => {
    if (!play) return;
    if (!pause) sendCommand("PAUSE");
    else sendCommand("PLAY");
  });
}

navBtns.forEach((btn) => {
  btn.addEventListener("mousedown", () => btn.classList.add("highlighted"));
  btn.addEventListener("mouseup", () => btn.classList.remove("highlighted"));
  btn.addEventListener("mouseleave", () => btn.classList.remove("highlighted"));

  btn.addEventListener("click", () => {
    if (!isConnected) {
      setStatus("Not connected to YouTube.");
      return;
    }

    if (btn.dataset.nav === "prev") {
      sendCommand("PREV");
      setStatus("Previous video...");
    }
    if (btn.dataset.nav === "next") {
      sendCommand("NEXT");
      setStatus("Next video...");
    }
  });
});

// Seek
if (progressBar) {
  progressBar.addEventListener("input", () => {
    userDraggingProgress = true;
  });

  progressBar.addEventListener("change", () => {
    userDraggingProgress = false;

    if (!isConnected || !lastDuration || lastDuration <= 0) return;

    const fraction = Number(progressBar.value || 0);
    const seconds = lastDuration * fraction;
    sendCommand("SEEK", seconds);
  });
}

// Volume
if (volumeController) {
  const initV = Number(volumeController.value || 0);
  root.style.setProperty("--volume-track-lightness", 100 - initV / 2 + "%");

  volumeController.addEventListener("input", (e) => {
    const v = Number(e.target.value || 0);
    sendCommand("VOLUME", v);

    const lightness = 100 - v / 2 + "%";
    root.style.setProperty("--volume-track-lightness", lightness);
  });
}

// Shuffle / Repeat
if (shuffleBtn) {
  shuffleBtn.addEventListener("click", () => {
    if (!isConnected) {
      setStatus("Not connected to YouTube.");
      return;
    }

    isShuffleOn = !isShuffleOn;
    setHighlighted(shuffleBtn, isShuffleOn);

    // If enabling shuffle, disable repeat
    if (isShuffleOn && repeatMode > 0) {
      repeatMode = 0;
      setHighlighted(repeatBtn, false);
      sendCommand("LOOP", 0);
    }

    sendCommand("SHUFFLE", isShuffleOn);
    setStatus(isShuffleOn ? "Shuffle ON" : "Shuffle OFF");
  });
}

if (repeatBtn) {
  repeatBtn.addEventListener("click", () => {
    if (!isConnected) {
      setStatus("Not connected to YouTube.");
      return;
    }

    // Cycle: 0->1->2->0
    repeatMode = (repeatMode + 1) % 3;
    setHighlighted(repeatBtn, repeatMode > 0);

    // If enabling repeat, disable shuffle
    if (repeatMode > 0 && isShuffleOn) {
      isShuffleOn = false;
      setHighlighted(shuffleBtn, false);
      sendCommand("SHUFFLE", false);
    }

    sendCommand("LOOP", repeatMode);

    const modeNames = ["OFF", "REPEAT PLAYLIST", "REPEAT CURRENT"];
    setStatus(`Loop: ${modeNames[repeatMode]}`);
  });
}

// Expand/collapse sections (playlist container still exists, visualisation container may not)
resizable.forEach((resize) => {
  resize.addEventListener("click", () => {
    const container = resize.closest(".playlist-container, .visualisation-container");
    if (!container) return;

    const currentHeight = container.style.height;
    const newHeight = currentHeight === "auto" ? "2rem" : "auto";
    container.style.height = newHeight;

    if (container.classList.contains("visualisation-container") && newHeight === "2rem") {
      stopViz();
    }
  });
});

// Manual connect
if (connectBtn) {
  connectBtn.addEventListener("click", () => {
    reconnectAttempts = 0;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    setStatus("Connecting...");
    connectToYouTubeTab();
  });
}

// Initialize connection
connectToYouTubeTab();
