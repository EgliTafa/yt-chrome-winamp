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
const VIZ_BARS_COUNT = 24;   // bars sent to popup

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

    // Note: connecting analyser to destination is OK for analysis,
    // but on some pages it can double-route audio if you also connect source to destination.
    // We do NOT connect source to destination here, only analyser to destination.
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
      // Reset graph and retry once (YouTube can block MediaElementSource sometimes)
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
  if (connectedPort.name !== "youtube-content") return;

  console.debug("Content script: Extension connecting...");
  port = connectedPort;

  port.onDisconnect.addListener(() => {
    port = null;
    stopVisualiserStream();
    stopPlaylistObserver();
    console.debug("Content script: Extension disconnected");
  });

  port.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    handleExtensionMessage(msg);
  });

  console.debug("Content script: Extension connected successfully");

  detectAndSendState();
  startPlaylistObserver(); // ✅ only once
  setTimeout(() => {
    if (port) sendPlayerInfo();
  }, 300);
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

/* ---------------------------
 *  Messages from popup
 *  --------------------------*/
function handleExtensionMessage(msg) {
  switch (msg.type) {
    case "PLAY": playVideo(); break;
    case "PAUSE": pauseVideo(); break;
    case "STOP": stopVideo(); break;
    case "NEXT": nextVideo(); break;
    case "PREV": previousVideo(); break;
    case "SEEK": seekTo(msg.value); break;
    case "VOLUME": setVolume(msg.value); break;
    case "SHUFFLE": setShuffle(msg.value); break;

    case "LOOP":
      if (typeof msg.value === "number") setLoop(msg.value);
      else {
        const currentMode = getLoopState();
        const nextMode = (currentMode + 1) % 3;
        setLoop(nextMode);
      }
      break;

    case "GET_STATE":
      detectAndSendState();
      sendPlayerInfo();
      break;

    // Visualiser control
    case "START_VIZ": startVisualiserStream(); break;
    case "STOP_VIZ": stopVisualiserStream(); break;

    // Playlist
    case "GET_PLAYLIST":
      startPlaylistObserver();
      sendPlaylistItems(true);
      break;

    case "PLAY_ITEM":
      playPlaylistItemByVideoId(msg.value?.videoId);
      setTimeout(() => {
        detectAndSendState();
        sendPlayerInfo();
        sendPlaylistItems(true);
      }, 800);
      break;
  }
}

/* ---------------------------
 *  YouTube player control
 *  --------------------------*/
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

  const isActive =
    btn.classList.contains("ytp-shuffle-button-enabled") ||
    btn.getAttribute("aria-pressed") === "true";

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
  if (mode === 0) clicksNeeded = (currentMode === 1) ? 2 : (currentMode === 2 ? 1 : 0);
  if (mode === 1) clicksNeeded = (currentMode === 0) ? 1 : (currentMode === 2 ? 2 : 0);
  if (mode === 2) clicksNeeded = (currentMode === 1) ? 1 : (currentMode === 0 ? 2 : 0);

  for (let i = 0; i < clicksNeeded; i++) {
    setTimeout(() => btn.click(), i * 200);
  }
  setTimeout(sendPlayerInfo, clicksNeeded * 200 + 300);
}

function getShuffleState() {
  const selectors = [".ytp-shuffle-button", "button[aria-label*='Shuffle']"];
  for (const s of selectors) {
    const btn = document.querySelector(s);
    if (btn) {
      return (
        btn.classList.contains("ytp-shuffle-button-enabled") ||
        btn.getAttribute("aria-pressed") === "true"
      );
    }
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

/* ---------------------------
 *  Send player info to popup
 *  --------------------------*/
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

/* ---------------------------
 *  Monitoring (SPA-safe)
 *  --------------------------*/
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
        // playlist panel often updates too
        sendPlaylistItems(true);
      }, 600);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  sendPlayerInfo();
}

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
      startPlaylistObserver(); // ✅ reattach on SPA nav
      if (port) setTimeout(sendPlayerInfo, 1000);
      setTimeout(startMonitoring, 1000);
    }
  }, 1000);
}

/* ---------------------------
 *  Playlist Handling
 *  --------------------------*/
let playlistObserver = null;
let playlistSendTimer = null;
let lastPlaylistSig = "";
let observedRoot = null;

function isCurrentPlaylistNode(node, titleEl) {
  const ariaCurrent = (titleEl?.getAttribute("aria-current") || "").toLowerCase();
  // aria-current is often "page" on YouTube, not "true"
  const ariaCurrentActive = ariaCurrent && ariaCurrent !== "false";

  return (
    node.hasAttribute("selected") ||
    node.classList.contains("selected") ||
    ariaCurrentActive
  );
}

function scrapePlaylistItems() {
  const nodes = Array.from(document.querySelectorAll("ytd-playlist-panel-video-renderer"));
  if (!nodes.length) return [];

  return nodes.map((node, i) => {
    const titleEl =
      node.querySelector("a#video-title") ||
      node.querySelector("#video-title") ||
      node.querySelector("a[title]");

    const title = (titleEl?.textContent || titleEl?.getAttribute("title") || "").trim();

    // Prefer attribute when present (often exists)
    const attrVid = node.getAttribute("video-id");

    // Fallback: parse href
    const href = titleEl?.getAttribute("href") || "";
    const params = new URLSearchParams(href.split("?")[1] || "");
    const urlVid = params.get("v");

    const videoId = attrVid || urlVid || null;
    const isCurrent = isCurrentPlaylistNode(node, titleEl);

    return {
      index: i + 1,
      title,
      videoId,
      isCurrent: !!isCurrent,
    };
  });
}

function computeSig(items) {
  return items.map(x => `${x.videoId || ""}:${x.title}:${x.isCurrent ? 1 : 0}`).join("|");
}

function sendPlaylistItems(force = false) {
  if (!port) return;

  const items = scrapePlaylistItems();
  const sig = computeSig(items);

  if (!force && sig === lastPlaylistSig) return;
  lastPlaylistSig = sig;

  port.postMessage({ type: "PLAYLIST_ITEMS", items });
}

function throttledSendPlaylist() {
  if (playlistSendTimer) return;
  playlistSendTimer = setTimeout(() => {
    playlistSendTimer = null;
    sendPlaylistItems(false);
  }, 250);
}

function findPlaylistRootForObserver() {
  return document.querySelector("ytd-playlist-panel-renderer") || document.body;
}

function startPlaylistObserver() {
  const root = findPlaylistRootForObserver();
  if (playlistObserver && observedRoot === root) {
    // already observing the right root
    sendPlaylistItems(true);
    return;
  }

  stopPlaylistObserver();
  observedRoot = root;

  playlistObserver = new MutationObserver(() => {
    // If SPA swapped the playlist root, reattach
    const newRoot = findPlaylistRootForObserver();
    if (newRoot !== observedRoot) {
      startPlaylistObserver();
      return;
    }
    throttledSendPlaylist();
  });

  playlistObserver.observe(root, { childList: true, subtree: true, attributes: true });

  // initial push
  sendPlaylistItems(true);
}

function stopPlaylistObserver() {
  if (playlistObserver) playlistObserver.disconnect();
  playlistObserver = null;
  observedRoot = null;

  if (playlistSendTimer) clearTimeout(playlistSendTimer);
  playlistSendTimer = null;
}

function playPlaylistItemByVideoId(videoId) {
  if (!videoId) return false;

  const items = Array.from(document.querySelectorAll("ytd-playlist-panel-video-renderer"));
  for (const node of items) {
    const a = node.querySelector("a#video-title, #video-title");
    if (!a) continue;

    const href = a.getAttribute("href") || "";
    const params = new URLSearchParams(href.split("?")[1] || "");
    const v = node.getAttribute("video-id") || params.get("v");

    if (v === videoId) {
      try { a.scrollIntoView({ block: "center" }); } catch (_) {}

      // More reliable than bare a.click() on some layouts
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }
  }

  // Fallback: navigate to watch URL with same playlist (if any)
  const urlParams = new URLSearchParams(window.location.search);
  const list = urlParams.get("list");
  const target = list
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(list)}`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  window.location.href = target;
  return true;
}
