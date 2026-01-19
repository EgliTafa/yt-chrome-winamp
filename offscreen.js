const port = chrome.runtime.connect({ name: "offscreen" });

const iframe = document.getElementById("yt");

// Ensure referrerPolicy is set programmatically (offscreen documents may not respect HTML attribute)
// Also set it on the document level
if (iframe) {
  // Try multiple ways to set referrer policy
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  
  // Also ensure document-level referrer policy
  if (document.querySelector('meta[name="referrer"]')) {
    document.querySelector('meta[name="referrer"]').setAttribute("content", "strict-origin-when-cross-origin");
  }
  
  console.debug("[OFFSCREEN] Initial iframe.referrerPolicy:", iframe.referrerPolicy);
  console.debug("[OFFSCREEN] Initial iframe.getAttribute('referrerpolicy'):", iframe.getAttribute("referrerpolicy"));
}

let currentListId = null;
let iframeReady = false;
let retryCount = 0;
let usingNoCookie = false;

let lastSentSecond = -1;
let lastDuration = 0;
let lastTitle = "";
let lastCurrentTime = 0;

function extensionOrigin() {
  return new URL(chrome.runtime.getURL("")).origin;
}

function buildPlaylistEmbedUrl(listId, useNoCookie = false) {
  // Official embed parameters for playlist playback
  // Try youtube-nocookie.com as fallback for error 153
  const baseUrl = useNoCookie 
    ? "https://www.youtube-nocookie.com/embed/videoseries"
    : "https://www.youtube.com/embed/videoseries";
  
  const u = new URL(baseUrl);
  const origin = extensionOrigin();
  
  u.searchParams.set("list", listId);
  u.searchParams.set("enablejsapi", "1");
  u.searchParams.set("origin", origin); // Critical: must match extension origin
  u.searchParams.set("autoplay", "0"); // user presses play
  u.searchParams.set("controls", "0");
  u.searchParams.set("playsinline", "1");
  u.searchParams.set("rel", "0"); // Don't show related videos
  u.searchParams.set("modestbranding", "1"); // Minimal YouTube branding
  u.searchParams.set("iv_load_policy", "3"); // Hide annotations
  u.searchParams.set("cc_load_policy", "0"); // No captions by default
  u.searchParams.set("fs", "0"); // Disable fullscreen button
  u.searchParams.set("disablekb", "1"); // Disable keyboard controls
  
  console.debug("[OFFSCREEN] Built embed URL with origin:", origin, "useNoCookie:", useNoCookie);
  return u.toString();
}

function postToPlayer(obj) {
  if (!iframe.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify(obj), "*");
}

function ytCommand(func, args = []) {
  // PostMessage control format described here. :contentReference[oaicite:6]{index=6}
  postToPlayer({ event: "command", func, args });
}

function startListening() {
  // “listening” handshake described here; enables infoDelivery messages. :contentReference[oaicite:7]{index=7}
  postToPlayer({ event: "listening" });
}

function loadPlaylist(listId, retryWithNoCookie = false) {
  // Debug logs appear in offscreen document console (chrome://extensions → Service Worker → Inspect)
  console.debug("[OFFSCREEN] loadPlaylist called with:", listId, "retryWithNoCookie:", retryWithNoCookie);
  
  if (!listId || typeof listId !== "string" || listId.trim() === "") {
    console.error("[OFFSCREEN] Invalid playlist ID:", listId);
    port.postMessage({ type: "STATUS", text: "Error: Invalid playlist ID." });
    return;
  }

  currentListId = listId.trim();
  iframeReady = false;
  usingNoCookie = retryWithNoCookie;

  console.debug("[OFFSCREEN] Loading playlist:", currentListId, "usingNoCookie:", usingNoCookie);
  port.postMessage({ type: "STATUS", text: `Loading playlist: ${currentListId}...` });
  
  try {
    const embedUrl = buildPlaylistEmbedUrl(currentListId, usingNoCookie);
    console.debug("[OFFSCREEN] Embed URL:", embedUrl);
    
    // Ensure referrerPolicy is set before loading (critical for YouTube)
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    
    console.debug("[OFFSCREEN] Set referrerPolicy before load:");
    console.debug("  - iframe.referrerPolicy:", iframe.referrerPolicy);
    console.debug("  - iframe.getAttribute('referrerpolicy'):", iframe.getAttribute("referrerpolicy"));
    
    // Note: Offscreen documents in Chrome extensions have limitations with Referer headers
    // Even with correct referrerPolicy, YouTube may still reject due to extension origin
    // This is a known limitation - some playlists may not work in extension contexts
    
    iframe.src = embedUrl;
    port.postMessage({ type: "STATUS", text: "Playlist loaded. Waiting for player to initialize..." });
  } catch (error) {
    console.error("[OFFSCREEN] Error loading playlist:", error);
    port.postMessage({ type: "STATUS", text: `Error loading playlist: ${error.message}` });
  }
}

iframe.addEventListener("load", () => {
  console.debug("[OFFSCREEN] Iframe load event fired");
  
  // Re-apply referrerPolicy (sometimes gets reset)
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  
  console.debug("[OFFSCREEN] Iframe referrerPolicy:", iframe.referrerPolicy);
  console.debug("[OFFSCREEN] Iframe.getAttribute('referrerpolicy'):", iframe.getAttribute("referrerpolicy"));
  console.debug("[OFFSCREEN] Document referrer:", document.referrer);
  console.debug("[OFFSCREEN] Extension origin:", extensionOrigin());
  
  iframeReady = false;
  port.postMessage({ type: "STATUS", text: "Iframe loaded, initializing YouTube player..." });
  
  // Give the player more time to initialize, especially for playlists
  setTimeout(() => {
    try {
      console.debug("[OFFSCREEN] Initializing YouTube player API...");
      startListening();
      // Initialize volume to 100
      ytCommand("setVolume", [100]);
      // Set playback quality to audio-optimized (if available)
      // Note: YouTube may not honor this, but we try
      iframeReady = true;
      console.debug("[OFFSCREEN] Player initialization complete, ready:", iframeReady);
      port.postMessage({ type: "STATUS", text: "Player ready. Press ▶ to start playback." });
    } catch (error) {
      console.error("[OFFSCREEN] Initialization error:", error);
      port.postMessage({ type: "STATUS", text: `Initialization error: ${error.message}` });
      // Still mark as ready to allow retry
      iframeReady = true;
    }
  }, 500);
});

// Receive infoDelivery events and other YouTube iframe API messages
window.addEventListener("message", (event) => {
  // Strong origin checks (YouTube usually uses these origins)
  if (event.origin !== "https://www.youtube.com" && event.origin !== "https://www.youtube-nocookie.com") return;
  if (event.source !== iframe.contentWindow) return;

  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }

  // Handle onReady event
  if (data?.event === "onReady") {
    console.debug("[OFFSCREEN] YouTube player onReady event");
    port.postMessage({ type: "STATUS", text: "YouTube player ready" });
    return;
  }

  // Handle errors
  if (data?.event === "onError") {
    const errorCode = data.info || "unknown";
    console.error("[OFFSCREEN] YouTube player error:", errorCode);
    
    // YouTube error codes: https://developers.google.com/youtube/iframe_api_reference#Events
    const errorMessages = {
      2: "Invalid parameter value",
      5: "HTML5 player error",
      100: "Video not found or private",
      101: "Video not allowed in embedded players",
      150: "Video not allowed in embedded players",
      153: "Video player configuration error (missing Referer header or origin mismatch)",
    };
    
    const errorMsg = errorMessages[errorCode] || `Error code: ${errorCode}`;
    
    // For error 153, try retrying with youtube-nocookie.com if we haven't already
    if (errorCode === 153 && !usingNoCookie && retryCount < 1) {
      retryCount++;
      console.debug("[OFFSCREEN] Error 153 detected, retrying with youtube-nocookie.com...");
      port.postMessage({ type: "STATUS", text: "Error 153: Retrying with alternative player..." });
      setTimeout(() => {
        loadPlaylist(currentListId, true);
      }, 1000);
      return;
    }
    
    let fullMessage;
    if (errorCode === 153) {
      fullMessage = `Error ${errorCode}: ${errorMsg}\n\nTroubleshooting:\n` +
        `1. Sign into YouTube in your browser\n` +
        `2. Check if the playlist allows embedding (some playlists restrict this)\n` +
        `3. This is a known Chrome extension limitation - offscreen documents may not work with all playlists\n` +
        `4. Try opening the playlist directly on YouTube to verify it's public and embeddable`;
    } else {
      fullMessage = `Error ${errorCode}: ${errorMsg}`;
    }
    
    port.postMessage({ type: "STATUS", text: fullMessage });
    console.error("[OFFSCREEN] Final error message sent:", fullMessage);
    return;
  }

  // Handle video change events (for playlists)
  if (data?.event === "onStateChange") {
    const state = data.info;
    // State: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (state === 0) {
      // Video ended, playlist should auto-advance
      port.postMessage({ type: "STATUS", text: "Video ended, loading next..." });
    } else if (state === 3) {
      port.postMessage({ type: "STATUS", text: "Buffering..." });
    }
  }

  // Handle infoDelivery events
  if (data?.event !== "infoDelivery") return;
  const info = data.info || {};

  const currentTime = typeof info.currentTime === "number" ? info.currentTime : undefined;
  const duration = typeof info.duration === "number" ? info.duration : undefined;
  const playerState = typeof info.playerState === "number" ? info.playerState : undefined;

  if (typeof duration === "number" && duration > 0) lastDuration = duration;

  // Some deliveries include videoData (title/author). Not guaranteed, but handle if present.
  if (info.videoData) {
    if (typeof info.videoData.title === "string" && info.videoData.title) {
      lastTitle = info.videoData.title;
    }
    // Also check for author/channel info
    if (typeof info.videoData.author === "string" && info.videoData.author) {
      // Could store this if needed for display
    }
  }

  // Update lastCurrentTime
  if (typeof currentTime === "number") {
    lastCurrentTime = currentTime;
  }

  // Throttle to 1 update per second (UI doesn't need spam)
  if (typeof currentTime === "number") {
    const sec = Math.floor(currentTime);
    if (sec !== lastSentSecond) {
      lastSentSecond = sec;
      port.postMessage({
        type: "PLAYER_INFO",
        currentTime,
        duration: lastDuration || duration || 0,
        playerState,
        title: lastTitle
      });
    }
  } else if (typeof playerState === "number") {
    // Still forward state changes even if no time info this tick
    port.postMessage({
      type: "PLAYER_INFO",
      currentTime: lastCurrentTime || undefined,
      duration: lastDuration || 0,
      playerState,
      title: lastTitle
    });
  }
});

function handleCmd(cmd, value) {
  if (!iframeReady) {
    port.postMessage({ type: "STATUS", text: "Player not ready yet. Please wait..." });
    return;
  }

  try {
    switch (cmd) {
      case "PLAY": {
        ytCommand("playVideo");
        port.postMessage({ type: "STATUS", text: "Playing..." });
        break;
      }
      case "PAUSE": {
        ytCommand("pauseVideo");
        port.postMessage({ type: "STATUS", text: "Paused" });
        break;
      }
      case "STOP": {
        ytCommand("stopVideo");
        port.postMessage({ type: "STATUS", text: "Stopped" });
        break;
      }
      case "NEXT": {
        ytCommand("nextVideo");
        port.postMessage({ type: "STATUS", text: "Next video..." });
        break;
      }
      case "PREV": {
        ytCommand("previousVideo");
        port.postMessage({ type: "STATUS", text: "Previous video..." });
        break;
      }

      case "SEEK": {
        const seconds = Number(value || 0);
        if (isNaN(seconds) || seconds < 0) {
          port.postMessage({ type: "STATUS", text: "Invalid seek time" });
          return;
        }
        // IFrame API seekTo signature: seekTo(seconds, allowSeekAhead)
        ytCommand("seekTo", [seconds, true]);
        break;
      }

      case "VOLUME": {
        const v = Math.max(0, Math.min(100, Number(value ?? 100)));
        if (isNaN(v)) {
          port.postMessage({ type: "STATUS", text: "Invalid volume" });
          return;
        }
        ytCommand("setVolume", [v]);
        break;
      }

      case "SHUFFLE": {
        // Playlist method exists in IFrame API
        ytCommand("setShuffle", [Boolean(value)]);
        port.postMessage({ type: "STATUS", text: value ? "Shuffle ON" : "Shuffle OFF" });
        break;
      }

      case "LOOP": {
        // Playlist loop method exists in IFrame API
        ytCommand("setLoop", [Boolean(value)]);
        port.postMessage({ type: "STATUS", text: value ? "Loop ON" : "Loop OFF" });
        break;
      }

      default: {
        port.postMessage({ type: "STATUS", text: `Unknown command: ${cmd}` });
      }
    }
  } catch (error) {
    port.postMessage({ type: "STATUS", text: `Command error: ${error.message}` });
  }
}

port.onMessage.addListener((msg) => {
  if (msg?.type === "LOAD_PLAYLIST") {
    retryCount = 0; // Reset retry count for new playlist
    usingNoCookie = false; // Reset to try regular YouTube first
    loadPlaylist(msg.listId);
    return;
  }

  if (msg?.type === "CMD") {
    handleCmd(msg.cmd, msg.value);
  }
});
