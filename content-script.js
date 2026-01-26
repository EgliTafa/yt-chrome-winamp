// content-script.js - Runs on YouTube pages to detect and control the player
(() => {
  /**
   * Fixes:
   * - Infinite loop / spam from observing document.body (YouTube churns DOM constantly)
   * - Double injection issues
   * - "Extension context invalidated" safety
   *
   * Includes:
   * - Playlist scraping (watch playlist panel)
   * - PLAY_ITEM(videoId): click matching playlist row OR navigate fallback
   * - PLAY_ITEM_ACK back to popup so you can see if it worked
   */

  const INSTANCE_KEY = "__MAXAMP_CONTENT_SCRIPT_INSTANCE__";

  // Kill previous instance if we reinject
  const prev = globalThis[INSTANCE_KEY];
  if (prev?.destroy) {
    try { prev.destroy("reinjected"); } catch (_) { }
  }

  // --- Core state ---
  let port = null;
  let disabled = false;

  let currentVideoId = null;
  let currentPlaylistId = null;

  // --- Visualiser state ---
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let attachedVideoEl = null;
  let vizTimer = null;

  const VIZ_FPS_MS = 50;      // ~20 FPS
  const VIZ_BARS_COUNT = 24;  // bars sent to popup

  // --- Monitoring / SPA ---
  let monitoringVideo = null;
  let urlCheckTimer = null;
  let lastUrl = window.location.href;

  // --- Playlist observer (IMPORTANT: never observe document.body) ---
  let playlistObserver = null;
  let playlistRoot = null;
  let playlistRetryTimer = null;
  let playlistSendTimer = null;
  let lastPlaylistSig = "";
  let lastSentEmpty = false;

  function destroy(reason) {
    try { console.debug("[MAXAMP] destroy:", reason); } catch (_) { }

    disabled = true;

    try { stopVisualiserStream(); } catch (_) { }
    try { cleanupAudio(); } catch (_) { }

    try { stopMonitoring(); } catch (_) { }
    try { stopUrlWatcher(); } catch (_) { }

    try { stopPlaylistObserver(); } catch (_) { }

    try {
      if (onConnectHandler) chrome.runtime?.onConnect?.removeListener(onConnectHandler);
    } catch (_) { }

    try { port?.disconnect(); } catch (_) { }
    port = null;

    try {
      if (globalThis[INSTANCE_KEY]?.destroy === destroy) {
        globalThis[INSTANCE_KEY] = null;
      }
    } catch (_) { }
  }

  globalThis[INSTANCE_KEY] = { destroy };

  function disableBecauseInvalidated(err) {
    console.debug("[MAXAMP] disabled: extension context invalidated", err);
    destroy("context invalidated");
  }

  function safePost(msg) {
    if (disabled || !port) return;
    try {
      port.postMessage(msg);
    } catch (e) {
      const m = String(e?.message || e);
      if (m.includes("Extension context invalidated")) {
        disableBecauseInvalidated(e);
      } else {
        // drop the port (popup will reconnect)
        port = null;
      }
    }
  }

  function getVideoEl() {
    return document.querySelector("video");
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  function extractVideoIdFromUrl(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? match[1] : null;
  }

  function extractVideoIdFromHref(href) {
    if (!href) return null;
    try {
      const q = href.split("?")[1] || "";
      const params = new URLSearchParams(q);
      return params.get("v");
    } catch (_) {
      return null;
    }
  }

  function clickLikeUser(target) {
    if (!target) return false;
    try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) { }

    try {
      target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (_) {
      try { target.click(); return true; } catch (_) { }
    }
    return false;
  }

  // ---------------------------
  // Visualiser (WebAudio)
  // ---------------------------
  function cleanupAudio() {
    try { sourceNode?.disconnect(); } catch (_) { }
    try { analyser?.disconnect(); } catch (_) { }
    try { audioCtx?.close(); } catch (_) { }

    audioCtx = null;
    analyser = null;
    sourceNode = null;
    attachedVideoEl = null;
  }

  async function ensureAudioGraph() {
    const video = getVideoEl();
    if (!video) return false;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch (_) { }
    }

    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(audioCtx.destination);
    }

    if (attachedVideoEl !== video) {
      try {
        try { sourceNode?.disconnect(); } catch (_) { }
        sourceNode = audioCtx.createMediaElementSource(video);
        sourceNode.connect(analyser);
        attachedVideoEl = video;
      } catch (e) {
        // media element source can throw if created multiple times for same element -> rebuild once
        try { stopVisualiserStream(); } catch (_) { }
        try { cleanupAudio(); } catch (_) { }
        try { return await ensureAudioGraph(); } catch (_) { return false; }
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
    if (disabled || vizTimer || !port) return;

    const ok = await ensureAudioGraph();
    if (!ok || !analyser) return;

    const freq = new Uint8Array(analyser.frequencyBinCount);

    vizTimer = setInterval(() => {
      if (disabled || !port || !analyser) return;

      // YouTube SPA can replace <video>, re-wire when needed
      if (attachedVideoEl !== getVideoEl()) {
        ensureAudioGraph().catch(() => { });
      }

      try {
        analyser.getByteFrequencyData(freq);
        const bars = downsampleToBars(freq, VIZ_BARS_COUNT);
        safePost({ type: "AUDIO_DATA", bars });
      } catch (e) {
        stopVisualiserStream();
      }
    }, VIZ_FPS_MS);
  }

  function stopVisualiserStream() {
    if (vizTimer) clearInterval(vizTimer);
    vizTimer = null;
  }

  // ---------------------------
  // State detection
  // ---------------------------
  function detectAndSendState() {
    if (disabled) return;

    const url = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);

    const videoId = urlParams.get("v") || extractVideoIdFromUrl(url);
    const playlistId = urlParams.get("list");

    currentVideoId = videoId;
    currentPlaylistId = playlistId;

    safePost({
      type: "YOUTUBE_STATE",
      videoId,
      playlistId,
      url: window.location.href,
      hasPlayer: !!document.querySelector("video"),
    });
  }

  // ---------------------------
  // Player Info -> popup
  // ---------------------------
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

  function sendPlayerInfo() {
    if (disabled) return;

    const video = document.querySelector("video");
    if (!video) {
      safePost({ type: "PLAYER_INFO", error: "No video player found" });
      return;
    }

    const titleElement =
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
      document.querySelector(".ytp-title-link") ||
      document.querySelector("h1.title");

    const title = titleElement ? titleElement.textContent.trim() : "";

    safePost({
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

  // ---------------------------
  // Monitoring (video events)
  // ---------------------------
  function onTimeUpdate() { sendPlayerInfo(); }
  function onPlay() { sendPlayerInfo(); }
  function onPause() { sendPlayerInfo(); }

  function startMonitoring() {
    if (disabled) return;

    const video = getVideoEl();
    if (!video) {
      setTimeout(startMonitoring, 1000);
      return;
    }

    if (monitoringVideo !== video) {
      stopMonitoring();
      monitoringVideo = video;
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("play", onPlay);
      video.addEventListener("pause", onPause);
    }

    sendPlayerInfo();
  }

  function stopMonitoring() {
    try {
      if (monitoringVideo) {
        monitoringVideo.removeEventListener("timeupdate", onTimeUpdate);
        monitoringVideo.removeEventListener("play", onPlay);
        monitoringVideo.removeEventListener("pause", onPause);
      }
    } catch (_) { }
    monitoringVideo = null;
  }

  // ---------------------------
  // SPA URL watcher (lightweight)
  // ---------------------------
  function startUrlWatcher() {
    stopUrlWatcher();
    urlCheckTimer = setInterval(() => {
      if (disabled) return;

      const now = window.location.href;
      if (now !== lastUrl) {
        lastUrl = now;

        detectAndSendState();
        setTimeout(sendPlayerInfo, 600);
        setTimeout(startMonitoring, 700);

        // playlist often re-renders after nav
        setTimeout(() => {
          ensurePlaylistObserver(true);
          sendPlaylistItems(true);
        }, 900);
      }
    }, 1000);
  }

  function stopUrlWatcher() {
    if (urlCheckTimer) clearInterval(urlCheckTimer);
    urlCheckTimer = null;
  }

  // ---------------------------
  // Playlist Handling (NO BODY OBSERVER)
  // ---------------------------
  function findPlaylistPanelRoot() {
    // Watch page: playlist panel on the right
    return document.querySelector("ytd-playlist-panel-renderer");
  }

  function scrapePlaylistItems() {
    const nodes = Array.from(document.querySelectorAll("ytd-playlist-panel-video-renderer"));
    if (!nodes.length) return [];

    return nodes.map((node, i) => {
      const a =
        node.querySelector("a#video-title") ||
        node.querySelector("a[href*='watch?v=']") ||
        node.querySelector("#video-title"); // fallback

      const title =
        (a?.getAttribute("title") || a?.textContent || "").trim();

      const href = a?.getAttribute("href") || "";
      const videoId = extractVideoIdFromHref(href);

      const isCurrent =
        node.hasAttribute("selected") ||
        node.classList.contains("selected") ||
        a?.getAttribute("aria-current") === "true";

      return {
        index: i + 1,
        title,
        videoId: videoId || null,
        isCurrent: !!isCurrent,
      };
    });
  }

  function computeSig(items) {
    return items.map(x => `${x.videoId || ""}:${x.title}:${x.isCurrent ? 1 : 0}`).join("|");
  }

  function sendPlaylistItems(force = false) {
    if (disabled || !port) return;

    const root = findPlaylistPanelRoot();
    if (!root) {
      // Only send empty ONCE until the panel appears
      if (!lastSentEmpty) {
        lastSentEmpty = true;
        lastPlaylistSig = "";
        safePost({ type: "PLAYLIST_ITEMS", items: [] });
      }
      return;
    }

    lastSentEmpty = false;

    const items = scrapePlaylistItems();
    const sig = computeSig(items);

    if (!force && sig === lastPlaylistSig) return;
    lastPlaylistSig = sig;

    safePost({ type: "PLAYLIST_ITEMS", items });
  }

  function throttledSendPlaylist() {
    if (playlistSendTimer) return;
    playlistSendTimer = setTimeout(() => {
      playlistSendTimer = null;
      sendPlaylistItems(false);
    }, 250);
  }

  function ensurePlaylistObserver(forceRestart = false) {
    if (disabled) return;

    const root = findPlaylistPanelRoot();

    if (!root) {
      if (!playlistRetryTimer) {
        playlistRetryTimer = setTimeout(() => {
          playlistRetryTimer = null;
          ensurePlaylistObserver(false);
          sendPlaylistItems(true);
        }, 1000);
      }
      return;
    }

    if (!forceRestart && playlistObserver && playlistRoot === root) return;

    stopPlaylistObserver();
    playlistRoot = root;

    playlistObserver = new MutationObserver(() => {
      throttledSendPlaylist();
    });

    playlistObserver.observe(playlistRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["selected", "aria-current", "href", "title", "class"],
    });

    sendPlaylistItems(true);
  }

  function stopPlaylistObserver() {
    try { playlistObserver?.disconnect(); } catch (_) { }
    playlistObserver = null;
    playlistRoot = null;

    if (playlistRetryTimer) clearTimeout(playlistRetryTimer);
    playlistRetryTimer = null;

    if (playlistSendTimer) clearTimeout(playlistSendTimer);
    playlistSendTimer = null;
  }

  // ---------------------------
  // PLAY_ITEM: click matching playlist row (watch panel) OR navigate fallback
  // ---------------------------
  function findWatchPlaylistAnchorByVideoId(videoId) {
    const items = Array.from(document.querySelectorAll("ytd-playlist-panel-video-renderer"));
    for (const node of items) {
      const a =
        node.querySelector("a#video-title") ||
        node.querySelector("a[href*='watch?v=']");
      const v = extractVideoIdFromHref(a?.getAttribute("href") || "");
      if (v === videoId) return a || node;
    }
    return null;
  }

  function findPlaylistPageAnchorByVideoId(videoId) {
    const items = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
    for (const node of items) {
      const a =
        node.querySelector("a#video-title") ||
        node.querySelector("a[href*='watch?v=']");
      const v = extractVideoIdFromHref(a?.getAttribute("href") || "");
      if (v === videoId) return a || node;
    }
    return null;
  }

  function navigateToVideo(videoId) {
    const urlParams = new URLSearchParams(window.location.search);
    const list = urlParams.get("list");
    const target = list
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(list)}`
      : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

    window.location.href = target;
    return true;
  }

  function playPlaylistItemByVideoId(videoId) {
    if (!videoId) return false;

    // 1) Watch page playlist panel (best)
    const a1 = findWatchPlaylistAnchorByVideoId(videoId);
    if (a1 && clickLikeUser(a1)) return true;

    // 2) Playlist page
    const a2 = findPlaylistPageAnchorByVideoId(videoId);
    if (a2 && clickLikeUser(a2)) return true;

    // 3) Fallback navigation
    return navigateToVideo(videoId);
  }

  // ---------------------------
  // Popup commands
  // ---------------------------
  function setVolume(value) {
    const video = getVideoEl();
    if (video) {
      video.volume = Number(value) / 100;
      sendPlayerInfo();
    }
  }

  function seekTo(seconds) {
    const video = getVideoEl();
    if (video) {
      video.currentTime = Number(seconds);
      sendPlayerInfo();
    }
  }

  function nextVideo() {
    const btn = document.querySelector(".ytp-next-button");
    if (btn) {
      btn.click();
      setTimeout(sendPlayerInfo, 500);
    }
  }

  function previousVideo() {
    const btn = document.querySelector(".ytp-prev-button");
    if (btn) {
      btn.click();
      setTimeout(sendPlayerInfo, 500);
    } else {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft" }));
      setTimeout(sendPlayerInfo, 500);
    }
  }

  function playVideo() {
    const video = getVideoEl();
    const playButton =
      document.querySelector(".ytp-play-button[aria-label*='Play']") ||
      document.querySelector(".ytp-play-button:not(.ytp-pause-button)");

    if (video && video.paused) video.play();
    else if (playButton) playButton.click();

    sendPlayerInfo();
  }

  function pauseVideo() {
    const video = getVideoEl();
    const pauseButton =
      document.querySelector(".ytp-play-button.ytp-pause-button") ||
      document.querySelector(".ytp-play-button[aria-label*='Pause']");

    if (video && !video.paused) video.pause();
    else if (pauseButton) pauseButton.click();

    sendPlayerInfo();
  }

  function stopVideo() {
    const video = getVideoEl();
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    sendPlayerInfo();
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

    if (Boolean(enabled) !== isActive) {
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
    if (mode === 0) clicksNeeded = currentMode === 1 ? 2 : currentMode === 2 ? 1 : 0;
    if (mode === 1) clicksNeeded = currentMode === 0 ? 1 : currentMode === 2 ? 2 : 0;
    if (mode === 2) clicksNeeded = currentMode === 0 ? 2 : currentMode === 1 ? 1 : 0;

    for (let i = 0; i < clicksNeeded; i++) setTimeout(() => btn.click(), i * 200);
    setTimeout(sendPlayerInfo, clicksNeeded * 200 + 300);
  }

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
        else setLoop((getLoopState() + 1) % 3);
        break;

      case "GET_STATE":
        detectAndSendState();
        sendPlayerInfo();
        break;

      case "START_VIZ":
        startVisualiserStream();
        break;

      case "STOP_VIZ":
        stopVisualiserStream();
        break;

      case "GET_PLAYLIST":
        ensurePlaylistObserver(true);
        sendPlaylistItems(true);
        break;

      case "PLAY_ITEM": {
        const videoId = msg.value?.videoId;
        const ok = playPlaylistItemByVideoId(videoId);

        // ✅ tell popup whether we managed to click/navigate
        safePost({ type: "PLAY_ITEM_ACK", ok: !!ok, videoId });

        setTimeout(() => {
          detectAndSendState();
          sendPlayerInfo();
          ensurePlaylistObserver(false);
          sendPlaylistItems(true);
        }, 900);
        break;
      }
    }
  }

  // ---------------------------
  // Port connection
  // ---------------------------
  function onConnectHandler(connectedPort) {
    if (disabled) return;
    if (connectedPort.name !== "youtube-content") return;

    port = connectedPort;

    port.onDisconnect.addListener(() => {
      port = null;
      stopVisualiserStream();
      stopPlaylistObserver();
    });

    port.onMessage.addListener((msg) => {
      if (!msg?.type || disabled) return;
      handleExtensionMessage(msg);
    });

    // initial handshake
    detectAndSendState();
    setTimeout(sendPlayerInfo, 250);

    // Playlist observer setup (safe)
    ensurePlaylistObserver(false);
    sendPlaylistItems(true);
  }

  try {
    chrome.runtime.onConnect.addListener(onConnectHandler);
  } catch (e) {
    disableBecauseInvalidated(e);
    return;
  }

  // boot monitoring
  if (window.location.hostname.includes("youtube.com")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(startMonitoring, 900);
        setTimeout(startUrlWatcher, 1000);
        setTimeout(() => ensurePlaylistObserver(false), 1200);
      });
    } else {
      setTimeout(startMonitoring, 900);
      setTimeout(startUrlWatcher, 1000);
      setTimeout(() => ensurePlaylistObserver(false), 1200);
    }
  }
})();
