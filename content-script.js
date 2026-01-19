// content-script.js - Runs on YouTube pages to detect and control the player

let port = null;
let currentVideoId = null;
let currentPlaylistId = null;

// Listen for connection from extension popup
// Set up listener immediately when content script loads
chrome.runtime.onConnect.addListener((connectedPort) => {
  if (connectedPort.name === "youtube-content") {
    console.debug("Content script: Extension connecting...");
    port = connectedPort;
    
    port.onDisconnect.addListener(() => {
      port = null;
      console.debug("Content script: Extension disconnected");
    });

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      handleExtensionMessage(msg);
    });

    console.debug("Content script: Extension connected successfully");
    
    // Send initial state when connected
    detectAndSendState();
    setTimeout(() => {
      if (port) {
        sendPlayerInfo();
      }
    }, 300);
  }
});

// Signal that content script is ready (for debugging)
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
  if (!msg || !msg.type) return;

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
      // msg.value can be: true/false (toggle) or 0/1/2 (specific mode)
      if (typeof msg.value === "number") {
        setLoop(msg.value); // Direct mode: 0=off, 1=playlist, 2=current
      } else {
        // Toggle: cycle to next mode
        const currentMode = getLoopState();
        const nextMode = (currentMode + 1) % 3; // Cycle: 0->1->2->0
        setLoop(nextMode);
      }
      break;
    case "GET_STATE":
      detectAndSendState();
      sendPlayerInfo();
      break;
  }
}

// YouTube player control functions
function playVideo() {
  const video = document.querySelector("video");
  const playButton = document.querySelector(".ytp-play-button[aria-label*='Play']") ||
                     document.querySelector(".ytp-play-button:not(.ytp-pause-button)");
  
  if (video && video.paused) {
    video.play();
  } else if (playButton) {
    playButton.click();
  }
  
  sendPlayerInfo();
}

function pauseVideo() {
  const video = document.querySelector("video");
  const pauseButton = document.querySelector(".ytp-play-button.ytp-pause-button") ||
                      document.querySelector(".ytp-play-button[aria-label*='Pause']");
  
  if (video && !video.paused) {
    video.pause();
  } else if (pauseButton) {
    pauseButton.click();
  }
  
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
  // YouTube doesn't have a direct previous button, but we can try to go back in playlist
  const prevButton = document.querySelector(".ytp-prev-button");
  if (prevButton) {
    prevButton.click();
    setTimeout(sendPlayerInfo, 500);
  } else {
    // Try keyboard shortcut
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
  console.debug("Setting shuffle to:", enabled);
  
  // Try multiple selectors for shuffle button (YouTube may use different classes)
  const shuffleSelectors = [
    ".ytp-shuffle-button",
    "button[aria-label*='Shuffle']",
    "button[title*='Shuffle']",
    ".ytp-button[aria-label*='Shuffle']"
  ];
  
  let shuffleButton = null;
  for (const selector of shuffleSelectors) {
    shuffleButton = document.querySelector(selector);
    if (shuffleButton) break;
  }
  
  if (shuffleButton) {
    const isActive = shuffleButton.classList.contains("ytp-shuffle-button-enabled") ||
                     shuffleButton.getAttribute("aria-pressed") === "true" ||
                     shuffleButton.classList.contains("style-scope") && shuffleButton.querySelector(".ytp-shuffle-button-icon");
    
    console.debug("Shuffle button found, current state:", isActive);
    
    if (enabled !== isActive) {
      shuffleButton.click();
      console.debug("Shuffle button clicked");
      // Send updated state after a delay
      setTimeout(() => {
        sendPlayerInfo();
      }, 300);
    }
  } else {
    console.debug("Shuffle button not found");
  }
}

function setLoop(mode) {
  // mode: 0 = off, 1 = repeat playlist, 2 = repeat current video
  console.debug("Setting loop mode to:", mode);
  
  // Try multiple selectors for loop/repeat button
  const loopSelectors = [
    ".ytp-repeat-button",
    "button[aria-label*='Loop']",
    "button[aria-label*='Repeat']",
    "button[title*='Loop']",
    "button[title*='Repeat']",
    ".ytp-button[aria-label*='Loop']",
    ".ytp-button[aria-label*='Repeat']"
  ];
  
  let loopButton = null;
  for (const selector of loopSelectors) {
    loopButton = document.querySelector(selector);
    if (loopButton) break;
  }
  
  if (loopButton) {
    const currentMode = getLoopState();
    console.debug("Loop button found, current mode:", currentMode, "target mode:", mode);
    
    // Cycle to the target mode
    // YouTube's repeat button cycles: Off -> Playlist -> Current -> Off
    if (currentMode !== mode) {
      // Calculate how many clicks needed
      let clicksNeeded = 0;
      if (mode === 0) {
        // Turn off: click until we get to off
        if (currentMode === 1) clicksNeeded = 2; // Playlist -> Current -> Off
        else if (currentMode === 2) clicksNeeded = 1; // Current -> Off
      } else if (mode === 1) {
        // Repeat playlist
        if (currentMode === 0) clicksNeeded = 1; // Off -> Playlist
        else if (currentMode === 2) clicksNeeded = 2; // Current -> Off -> Playlist
      } else if (mode === 2) {
        // Repeat current
        if (currentMode === 0) clicksNeeded = 2; // Off -> Playlist -> Current
        else if (currentMode === 1) clicksNeeded = 1; // Playlist -> Current
      }
      
      // Perform clicks
      for (let i = 0; i < clicksNeeded; i++) {
        setTimeout(() => {
          loopButton.click();
        }, i * 200); // Small delay between clicks
      }
      
      console.debug("Loop button clicked", clicksNeeded, "times");
      // Send updated state after clicks complete
      setTimeout(() => {
        sendPlayerInfo();
      }, clicksNeeded * 200 + 300);
    }
  } else {
    console.debug("Loop button not found");
  }
}

// Get current shuffle/loop state from YouTube
function getShuffleState() {
  const shuffleSelectors = [
    ".ytp-shuffle-button",
    "button[aria-label*='Shuffle']"
  ];
  
  for (const selector of shuffleSelectors) {
    const button = document.querySelector(selector);
    if (button) {
      return button.classList.contains("ytp-shuffle-button-enabled") ||
             button.getAttribute("aria-pressed") === "true";
    }
  }
  return false;
}

function getLoopState() {
  // Returns: 0 = off, 1 = repeat playlist, 2 = repeat current video
  const loopSelectors = [
    ".ytp-repeat-button",
    "button[aria-label*='Loop']",
    "button[aria-label*='Repeat']"
  ];
  
  for (const selector of loopSelectors) {
    const button = document.querySelector(selector);
    if (button) {
      // Check aria-label to determine mode
      const ariaLabel = button.getAttribute("aria-label") || "";
      const title = button.getAttribute("title") || "";
      const label = (ariaLabel + " " + title).toLowerCase();
      
      if (label.includes("repeat all") || label.includes("repeat playlist")) {
        return 1; // Repeat playlist
      } else if (label.includes("repeat one") || label.includes("repeat current") || label.includes("repeat this")) {
        return 2; // Repeat current video
      } else if (button.classList.contains("ytp-repeat-button-enabled") || 
                 button.getAttribute("aria-pressed") === "true") {
        // Button is enabled but we can't determine which mode - check icon or default to playlist
        // YouTube usually defaults to playlist mode when enabled
        return 1;
      }
    }
  }
  return 0; // Off
}

// Send player info to extension
function sendPlayerInfo() {
  const video = document.querySelector("video");
  if (!video) {
    if (port) {
      port.postMessage({
        type: "PLAYER_INFO",
        error: "No video player found",
      });
    }
    return;
  }

  const titleElement = document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
                       document.querySelector(".ytp-title-link") ||
                       document.querySelector("h1.title");
  
  const title = titleElement ? titleElement.textContent.trim() : "";

  // Get shuffle and loop state from YouTube
  const shuffleState = getShuffleState();
  const loopState = getLoopState();

  if (port) {
    port.postMessage({
      type: "PLAYER_INFO",
      currentTime: video.currentTime,
      duration: video.duration,
      playerState: video.paused ? 2 : 1, // 1 = playing, 2 = paused
      title: title,
      volume: Math.round(video.volume * 100),
      videoId: currentVideoId,
      playlistId: currentPlaylistId,
      shuffle: shuffleState,
      loop: loopState,
    });
  }
}

// Monitor player state changes
function startMonitoring() {
  const video = document.querySelector("video");
  if (!video) {
    // Wait for video to load
    setTimeout(startMonitoring, 1000);
    return;
  }

  // Monitor time updates
  video.addEventListener("timeupdate", () => {
    sendPlayerInfo();
  });

  // Monitor play/pause
  video.addEventListener("play", () => {
    sendPlayerInfo();
  });

  video.addEventListener("pause", () => {
    sendPlayerInfo();
  });

  // Monitor video changes (for playlists)
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

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial send
  sendPlayerInfo();
}

// Initialize monitoring when page loads
if (window.location.hostname.includes("youtube.com")) {
  console.debug("Content script: YouTube page detected:", window.location.href);
  
  // Wait for page to load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      console.debug("Content script: DOM loaded");
      setTimeout(startMonitoring, 1000);
    });
  } else {
    console.debug("Content script: DOM already loaded");
    setTimeout(startMonitoring, 1000);
  }

  // Re-detect on navigation (YouTube SPA)
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      console.debug("Content script: URL changed to:", window.location.href);
      lastUrl = window.location.href;
      detectAndSendState();
      if (port) {
        setTimeout(sendPlayerInfo, 1000);
      }
      setTimeout(startMonitoring, 1000);
    }
  }, 1000);
} else {
  console.debug("Content script: Not a YouTube page:", window.location.hostname);
}
