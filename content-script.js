// content-script.js - Runs on YouTube pages to detect and control the player

let port = null;
let currentVideoId = null;
let currentPlaylistId = null;

/* ---------------------------
 *  Winamp-like Visualiser (WebAudio)
 *  --------------------------*/
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let attachedVideoEl = null;
let vizTimer = null;

const VIZ_FPS_MS = 50;       // ~20 FPS
const VIZ_BARS_COUNT = 64;   // bars sent to popup

function getVideoEl() {
  return document.querySelector("video");
}

async function ensureAudioGraph() {
  const video = getVideoEl();
  if (!video) return false;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch (_) {}
  }

  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    analyser.connect(audioCtx.destination);
  }

  if (attachedVideoEl !== video) {
    try {
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (_) {}
        sourceNode = null;
      }
      sourceNode = audioCtx.createMediaElementSource(video);
      sourceNode.connect(analyser);
      attachedVideoEl = video;
    } catch (e) {
      // Reset graph and retry once
      try { stopVisualiserStream(); } catch (_) {}
      try { if (audioCtx) { try { audioCtx.close(); } catch (_) {} } } catch (_) {}
      audioCtx = null;
      analyser = null;
      sourceNode = null;
      attachedVideoEl = null;

      try {
        return await ensureAudioGraph();
      } catch (_) {
        return false;
      }
    }
  }

  return true;
}

function downsampleToBars(freqData, barsCount = VIZ_BARS_COUNT) {
  const out = new Array(barsCount).fill(0);
  const binSize = Math.floor(freqData.length / barsCount) || 1;

  for (let i = 0; i < barsCount; i++) {
    let sum = 0;
    let count = 0;
    const start = i * binSize;
    const end = Math.min(freqData.length, start + binSize);

    for (let j = start; j < end; j++) {
      sum += freqData[j];
      count++;
    }
    out[i] = count ? Math.round(sum / count) : 0;
  }

  return out;
}

async function startVisualiserStream() {
  if (vizTimer || !port) return;

  const ok = await ensureAudioGraph();
  if (!ok || !analyser) return;

  const freq = new Uint8Array(analyser.frequencyBinCount);

  vizTimer = setInterval(() => {
    if (!port || !analyser) return;

    // YouTube SPA can replace <video>; re-wire when needed
    if (attachedVideoEl !== getVideoEl()) {
      ensureAudioGraph().catch(() => {});
    }

    try {
      analyser.getByteFrequencyData(freq);
      const bars = downsampleToBars(freq, VIZ_BARS_COUNT);
      port.postMessage({ type: "AUDIO_DATA", bars });
    } catch (e) {
      stopVisualiserStream();
    }
  }, VIZ_FPS_MS);
}

function stopVisualiserStream() {
  if (vizTimer) clearInterval(vizTimer);
  vizTimer = null;
}

/* ---------------------------
 *  Port connection
 *  --------------------------*/
chrome.runtime.onConnect.addListener((connectedPort) => {
  if (connectedPort.name === "youtube-content") {
    console.debug("Content script: Extension connecting...");
    port = connectedPort;

    port.onDisconnect.addListener(() => {
      port = null;
      stopVisualiserStream();
      console.debug("Content script: Extension disconnected");
    });

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      handleExtensionMessage(msg);
    });

    console.debug("Content script: Extension connected successfully");

    detectAndSendState();
    setTimeout(() => {
      if (port) sendPlayerInfo();
    }, 300);
  }
});

console.debug("Content script loaded and ready for connections");

// Detect current video/playlist state
function detectAndSendState() {
  const url = window.location.href;
  const urlParams = new URLSearchParams(window.location.search);

  const videoId = urlParams.get("v") || extractVideoIdFromUrl(url);
  const playlistId = urlParams.get("list");

  currentVideoId = videoId;
  currentPlaylistId = playlistId;

  if (port) {
    port.postMessage({
      type: "YOUTUBE_STATE",
      videoId,
      playlistId,
      url: window.location.href,
      hasPlayer: !!document.querySelector("video"),
    });
  }
}

function extractVideoIdFromUrl(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

// Handle messages from extension popup
function handleExtensionMessage(msg) {
  switch (msg.type) {
    case "PLAY":
      playVideo();
      break;
    case "PAUSE":
      pauseVideo();
      break;
    case "STOP":
      stopVideo();
      break;
    case "NEXT":
      nextVideo();
      break;
    case "PREV":
      previousVideo();
      break;
    case "SEEK":
      seekTo(msg.value);
      break;
    case "VOLUME":
      setVolume(msg.value);
      break;
    case "SHUFFLE":
      setShuffle(msg.value);
      break;
    case "LOOP":
      if (typeof msg.value === "number") {
        setLoop(msg.value); // 0=off, 1=playlist, 2=current
      } else {
        const currentMode = getLoopState();
        const nextMode = (currentMode + 1) % 3;
        setLoop(nextMode);
      }
      break;
    case "GET_STATE":
      detectAndSendState();
      sendPlayerInfo();
      break;

    // ✅ Visualiser control
    case "START_VIZ":
      startVisualiserStream();
      break;
    case "STOP_VIZ":
      stopVisualiserStream();
      break;
  }
}

// YouTube player control functions
function playVideo() {
  const video = document.querySelector("video");
  const playButton =
    document.querySelector(".ytp-play-button[aria-label*='Play']") ||
    document.querySelector(".ytp-play-button:not(.ytp-pause-button)");

  if (video && video.paused) video.play();
  else if (playButton) playButton.click();

  sendPlayerInfo();
}

function pauseVideo() {
  const video = document.querySelector("video");
  const pauseButton =
    document.querySelector(".ytp-play-button.ytp-pause-button") ||
    document.querySelector(".ytp-play-button[aria-label*='Pause']");

  if (video && !video.paused) video.pause();
  else if (pauseButton) pauseButton.click();

  sendPlayerInfo();
}

function stopVideo() {
  const video = document.querySelector("video");
  if (video) {
    video.pause();
    video.currentTime = 0;
  }
  sendPlayerInfo();
}

function nextVideo() {
  const nextButton = document.querySelector(".ytp-next-button");
  if (nextButton) {
    nextButton.click();
    setTimeout(sendPlayerInfo, 500);
  }
}

function previousVideo() {
  const prevButton = document.querySelector(".ytp-prev-button");
  if (prevButton) {
    prevButton.click();
    setTimeout(sendPlayerInfo, 500);
  } else {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft" }));
    setTimeout(sendPlayerInfo, 500);
  }
}

function seekTo(seconds) {
  const video = document.querySelector("video");
  if (video) {
    video.currentTime = seconds;
    sendPlayerInfo();
  }
}

function setVolume(value) {
  const video = document.querySelector("video");
  if (video) {
    video.volume = value / 100;
    sendPlayerInfo();
  }
}

function setShuffle(enabled) {
  const selectors = [
    ".ytp-shuffle-button",
    "button[aria-label*='Shuffle']",
    "button[title*='Shuffle']",
    ".ytp-button[aria-label*='Shuffle']",
  ];

  let btn = null;
  for (const s of selectors) {
    btn = document.querySelector(s);
    if (btn) break;
  }

  if (!btn) return;

  const isActive = btn.classList.contains("ytp-shuffle-button-enabled") || btn.getAttribute("aria-pressed") === "true";
  if (enabled !== isActive) {
    btn.click();
    setTimeout(sendPlayerInfo, 300);
  }
}

function setLoop(mode) {
  const selectors = [
    ".ytp-repeat-button",
    "button[aria-label*='Loop']",
    "button[aria-label*='Repeat']",
    "button[title*='Loop']",
    "button[title*='Repeat']",
    ".ytp-button[aria-label*='Loop']",
    ".ytp-button[aria-label*='Repeat']",
  ];

  let btn = null;
  for (const s of selectors) {
    btn = document.querySelector(s);
    if (btn) break;
  }
  if (!btn) return;

  const currentMode = getLoopState();
  if (currentMode === mode) return;

  let clicksNeeded = 0;
  if (mode === 0) {
    if (currentMode === 1) clicksNeeded = 2;
    else if (currentMode === 2) clicksNeeded = 1;
  } else if (mode === 1) {
    if (currentMode === 0) clicksNeeded = 1;
    else if (currentMode === 2) clicksNeeded = 2;
  } else if (mode === 2) {
    if (currentMode === 0) clicksNeeded = 2;
    else if (currentMode === 1) clicksNeeded = 1;
  }

  for (let i = 0; i < clicksNeeded; i++) {
    setTimeout(() => btn.click(), i * 200);
  }
  setTimeout(sendPlayerInfo, clicksNeeded * 200 + 300);
}

function getShuffleState() {
  const selectors = [".ytp-shuffle-button", "button[aria-label*='Shuffle']"];
  for (const s of selectors) {
    const btn = document.querySelector(s);
    if (btn) return btn.classList.contains("ytp-shuffle-button-enabled") || btn.getAttribute("aria-pressed") === "true";
  }
  return false;
}

function getLoopState() {
  const selectors = [".ytp-repeat-button", "button[aria-label*='Loop']", "button[aria-label*='Repeat']"];
  for (const s of selectors) {
    const btn = document.querySelector(s);
    if (!btn) continue;

    const ariaLabel = btn.getAttribute("aria-label") || "";
    const title = btn.getAttribute("title") || "";
    const label = (ariaLabel + " " + title).toLowerCase();

    if (label.includes("repeat all") || label.includes("repeat playlist")) return 1;
    if (label.includes("repeat one") || label.includes("repeat current") || label.includes("repeat this")) return 2;

    if (btn.classList.contains("ytp-repeat-button-enabled") || btn.getAttribute("aria-pressed") === "true") return 1;
  }
  return 0;
}

// Send player info to extension
function sendPlayerInfo() {
  const video = document.querySelector("video");
  if (!video) {
    if (port) port.postMessage({ type: "PLAYER_INFO", error: "No video player found" });
    return;
  }

  const titleElement =
    document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
    document.querySelector(".ytp-title-link") ||
    document.querySelector("h1.title");

  const title = titleElement ? titleElement.textContent.trim() : "";

  if (port) {
    port.postMessage({
      type: "PLAYER_INFO",
      currentTime: video.currentTime,
      duration: video.duration,
      playerState: video.paused ? 2 : 1,
      title,
      volume: Math.round(video.volume * 100),
      videoId: currentVideoId,
      playlistId: currentPlaylistId,
      shuffle: getShuffleState(),
      loop: getLoopState(),
    });
  }
}

// Monitor player state changes
function startMonitoring() {
  const video = document.querySelector("video");
  if (!video) {
    setTimeout(startMonitoring, 1000);
    return;
  }

  video.addEventListener("timeupdate", sendPlayerInfo);
  video.addEventListener("play", sendPlayerInfo);
  video.addEventListener("pause", sendPlayerInfo);

  const observer = new MutationObserver(() => {
    const newVideoId = extractVideoIdFromUrl(window.location.href);
    if (newVideoId !== currentVideoId) {
      currentVideoId = newVideoId;
      setTimeout(() => {
        detectAndSendState();
        sendPlayerInfo();
      }, 1000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  sendPlayerInfo();
}

// Initialize monitoring when page loads
if (window.location.hostname.includes("youtube.com")) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(startMonitoring, 1000));
  } else {
    setTimeout(startMonitoring, 1000);
  }

  // YouTube SPA navigation
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      detectAndSendState();
      if (port) setTimeout(sendPlayerInfo, 1000);
      setTimeout(startMonitoring, 1000);
    }
  }, 1000);
}
