// player.js - Controls active YouTube player via content script

const qs = document.querySelector.bind(document);
const qsall = document.querySelectorAll.bind(document);
const root = document.documentElement;

const timeDisplayer = qs(".time-displayer");
const trackInfoDisplayer = qs(".track-info-displayer");
const volumeController = qs(".volume-controller");
const progressBar = qs(".progress-bar");
const visualisation = qs(".visualisation");
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

let play = false;
let pause = false;
// ✅ CHANGE #1: shuffle is boolean only
let isShuffleOn = false;

// ✅ CHANGE #2: repeat is number only (0=off, 1=playlist, 2=current)
let repeatMode = 0;

let lastDuration = 0;
let lastCurrentTime = 0;
let lastTitle = "";
let userDraggingProgress = false;

let contentPort = null;
let youtubeTabId = null;
let updateInterval = null;
let isConnected = false;

/** ---------------------------
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

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let reconnectTimeout = null;

/** ---------------------------
 *  Connect to YouTube tab
 *  --------------------------*/
async function connectToYouTubeTab() {
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    console.debug("Looking for YouTube tabs...");
    
    // First, try to find the currently active/visible YouTube tab (the one user is viewing)
    const activeTabs = await chrome.tabs.query({
      url: ["https://www.youtube.com/*", "https://youtube.com/*"],
      active: true,
      currentWindow: true
    });

    console.debug("Active YouTube tabs found:", activeTabs.length);

    if (activeTabs.length > 0) {
      // User is viewing a YouTube tab - connect to it
      youtubeTabId = activeTabs[0].id;
      console.debug("Connecting to active YouTube tab:", youtubeTabId, activeTabs[0].url);
      setStatus(`Connecting to your YouTube tab...`);
    } else {
      // No active YouTube tab - check if there's a YouTube tab in the current window
      const windowTabs = await chrome.tabs.query({
        url: ["https://www.youtube.com/*", "https://youtube.com/*"],
        currentWindow: true
      });

      console.debug("YouTube tabs in current window:", windowTabs.length);

      if (windowTabs.length > 0) {
        // Found YouTube tab in current window
        youtubeTabId = windowTabs[0].id;
        console.debug("Connecting to YouTube tab in window:", youtubeTabId, windowTabs[0].url);
        setStatus(`Connecting to YouTube tab in this window...`);
      } else {
        // Try all windows as last resort
        const allTabs = await chrome.tabs.query({
          url: ["https://www.youtube.com/*", "https://youtube.com/*"]
        });

        console.debug("YouTube tabs in all windows:", allTabs.length);

        if (allTabs.length > 0) {
          youtubeTabId = allTabs[0].id;
          console.debug("Connecting to YouTube tab (any window):", youtubeTabId, allTabs[0].url);
          setStatus(`Connecting to YouTube tab...`);
        } else {
          // No YouTube tab found at all
          console.debug("No YouTube tabs found");
          setStatus("No YouTube tab found. Open a YouTube video/playlist first.");
          if (nowPlaying) {
            nowPlaying.innerHTML = "⚠️ No YouTube tab found<br><small>Open a YouTube video or playlist page first, then open this extension</small>";
          }
          isConnected = false;
          reconnectAttempts = 0;
          return;
        }
      }
    }

    // Check if tab exists and is accessible
    try {
      await chrome.tabs.get(youtubeTabId);
    } catch (error) {
      console.error("Tab not accessible:", error);
      setStatus("YouTube tab not accessible. Please refresh the YouTube page.");
      isConnected = false;
      reconnectAttempts = 0;
      return;
    }

    // Ensure content script is injected (in case tab was opened before extension loaded)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: youtubeTabId },
        files: ['content-script.js']
      }).catch((err) => {
        // Script might already be injected, that's okay
        console.debug("Content script injection (may already exist):", err.message);
      });
    } catch (error) {
      console.debug("Could not inject content script:", error);
    }

    // Wait a bit for content script to be ready (content scripts load at document_idle)
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.debug("Attempting to connect to content script on tab:", youtubeTabId);

    // Connect to content script with error handling
    try {
      contentPort = chrome.tabs.connect(youtubeTabId, { name: "youtube-content" });

      // Check for runtime errors immediately after connection attempt
      // Note: lastError is only set if connection fails immediately
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message;
        console.error("Connection error:", errorMsg);
        // Suppress "Receiving end does not exist" on first attempt - content script might not be ready
        if (reconnectAttempts === 0 && errorMsg.includes("Receiving end does not exist")) {
          console.debug("Content script not ready yet, will retry...");
          reconnectAttempts++;
          setStatus("Content script loading... retrying...");
          reconnectTimeout = setTimeout(() => {
            connectToYouTubeTab();
          }, 1500);
          return;
        }
        throw new Error(errorMsg);
      }

      console.debug("Connection established, setting up listeners...");

      contentPort.onMessage.addListener((msg) => {
        handleContentMessage(msg);
      });

      contentPort.onDisconnect.addListener(() => {
        const wasConnected = isConnected;
        contentPort = null;
        isConnected = false;
        
        // Check if disconnect was due to an error (only log if we were actually connected)
        if (chrome.runtime.lastError && wasConnected) {
          const errorMsg = chrome.runtime.lastError.message;
          // Don't log "Receiving end does not exist" if we weren't connected - it's expected
          if (!errorMsg.includes("Receiving end does not exist") || wasConnected) {
            console.error("Connection error:", errorMsg);
          }
        }
        
        // Only reconnect if we haven't exceeded max attempts
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          setStatus(`Disconnected. Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          stopUpdateInterval();
          reconnectTimeout = setTimeout(() => {
            connectToYouTubeTab();
          }, 2000);
        } else {
          setStatus("Connection failed. Please refresh the YouTube page and try again.");
          reconnectAttempts = 0;
          stopUpdateInterval();
        }
      });

      // Request initial state with a small delay to ensure connection is stable
      setTimeout(() => {
        try {
          if (contentPort && chrome.runtime.lastError) {
            // Connection failed after setup
            const errorMsg = chrome.runtime.lastError.message;
            if (!errorMsg.includes("Receiving end does not exist")) {
              console.error("Connection error after setup:", errorMsg);
            }
            contentPort = null;
            isConnected = false;
            return;
          }
          
          if (contentPort) {
            contentPort.postMessage({ type: "GET_STATE" });
            isConnected = true;
            reconnectAttempts = 0; // Reset on successful connection
            setStatus("Connected to YouTube player");
          }
        } catch (error) {
          console.error("Error sending initial message:", error);
          contentPort = null;
          isConnected = false;
        }
      }, 200);

    } catch (error) {
      console.error("Error connecting to content script:", error);
      contentPort = null;
      isConnected = false;
      
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        setStatus(`Connection failed. Retrying... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimeout = setTimeout(() => {
          connectToYouTubeTab();
        }, 2000);
      } else {
        setStatus("Could not connect to YouTube page. Please refresh the YouTube page and reopen this extension.");
        reconnectAttempts = 0;
      }
    }

  } catch (error) {
    console.error("Error in connectToYouTubeTab:", error);
    setStatus(`Error: ${error.message}`);
    isConnected = false;
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      reconnectTimeout = setTimeout(() => {
        connectToYouTubeTab();
      }, 2000);
    } else {
      reconnectAttempts = 0;
    }
  }
}

function handleContentMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "YOUTUBE_STATE":
      handleYouTubeState(msg);
      break;
    case "PLAYER_INFO":
      handlePlayerInfo(msg);
      break;
  }
}

function handleYouTubeState(state) {
  if (!state.hasPlayer) {
    setStatus("No video player found on this YouTube page.");
    if (nowPlaying) {
      nowPlaying.textContent = "No video player found. Navigate to a video or playlist.";
    }
    return;
  }

  if (state.playlistId) {
    setStatus(`Connected to playlist: ${state.playlistId}`);
    if (nowPlaying) {
      nowPlaying.textContent = `Connected to playlist: ${state.playlistId}`;
    }
  } else if (state.videoId) {
    setStatus(`Connected to video: ${state.videoId}`);
    if (nowPlaying) {
      nowPlaying.textContent = `Connected to video: ${state.videoId}`;
    }
  }

  // Start monitoring
  startUpdateInterval();
}

function handlePlayerInfo(info) {
  if (info.error) {
    setStatus(info.error);
    return;
  }

  if (typeof info.currentTime === "number") lastCurrentTime = info.currentTime;
  if (typeof info.duration === "number" && info.duration > 0) lastDuration = info.duration;
  if (typeof info.title === "string" && info.title) lastTitle = info.title;
  if (typeof info.volume === "number") {
    if (volumeController) volumeController.value = String(info.volume);
  }

  // Sync shuffle and loop state from YouTube
  if (typeof info.shuffle === "boolean") {
    shuffle = info.shuffle;
    setHighlighted(shuffleBtn, shuffle);
  }
  if (typeof info.loop === "number") {
    // Loop mode: 0 = off, 1 = playlist, 2 = current
    repeat = info.loop;
    setHighlighted(repeatBtn, repeat > 0);
  } else if (typeof info.loop === "boolean") {
    // Legacy boolean support
    repeat = info.loop ? 1 : 0; // Default to playlist mode if enabled
    setHighlighted(repeatBtn, repeat > 0);
  }

  // Update UI
  if (timeDisplayer) timeDisplayer.textContent = fmtTime(lastCurrentTime);

  if (trackInfoDisplayer) {
    trackInfoDisplayer.textContent = lastTitle ? lastTitle : "YouTube Player";
  }

  if (nowPlaying) {
    nowPlaying.textContent = lastTitle ? `Now Playing: ${lastTitle}` : "Now Playing: —";
  }

  if (!userDraggingProgress && lastDuration > 0 && progressBar) {
    const frac = Math.max(0, Math.min(1, lastCurrentTime / lastDuration));
    progressBar.value = String(frac);
  }

  // Update player state UI
  const playerState = info.playerState;
  if (playerState === 1) {
    // Playing
    console.debug("[VISUALISATION] Player state: PLAYING - showing visualisation");
    play = true;
    pause = false;
    setHighlighted(playBtn, true);
    setHighlighted(stopBtn, true);
    setHighlighted(pauseBtn, false);
    if (visualisation) visualisation.style.display = "block";
  } else if (playerState === 2) {
    // Paused
    console.debug("[VISUALISATION] Player state: PAUSED - hiding visualisation");
    pause = true;
    setHighlighted(pauseBtn, true);
    if (visualisation) visualisation.style.display = "none";
  }
}

function sendCommand(cmd, value) {
  if (!contentPort || !isConnected) {
    setStatus("Not connected to YouTube. Reconnecting...");
    reconnectAttempts = 0; // Reset attempts when user tries to use controls
    connectToYouTubeTab();
    return;
  }

  try {
    contentPort.postMessage({ type: cmd, value });
    
    // Check for runtime errors after sending
    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }
  } catch (error) {
    console.error("Error sending command:", error);
    setStatus(`Error: ${error.message}`);
    contentPort = null;
    isConnected = false;
    reconnectAttempts = 0;
    connectToYouTubeTab();
  }
}

function startUpdateInterval() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => {
    if (isConnected) {
      sendCommand("GET_STATE");
    }
  }, 1000);
}

function stopUpdateInterval() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

/** ---------------------------
 *  UI Events
 *  --------------------------*/
if (loadBtn) {
  loadBtn.style.display = "none"; // Hide load button - not needed
}

if (playlistInput) {
  playlistInput.style.display = "none"; // Hide input - not needed
}

if (playBtn) {
  playBtn.addEventListener("click", () => {
    console.debug("[VISUALISATION] Play button clicked");
    sendCommand("PLAY");
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    console.debug("[VISUALISATION] Stop button clicked");
    sendCommand("STOP");
    play = false;
    pause = false;
    setHighlighted(playBtn, false);
    setHighlighted(stopBtn, false);
    setHighlighted(pauseBtn, false);
    if (progressBar) progressBar.value = "0";
    if (timeDisplayer) timeDisplayer.textContent = "00:00";
    if (visualisation) {
      visualisation.style.display = "none";
      console.debug("[VISUALISATION] Display set to none on stop click");
    }
    stopUpdateInterval();
  });
}

if (pauseBtn) {
  pauseBtn.addEventListener("click", () => {
    if (!play) {
      console.debug("[VISUALISATION] Pause button clicked but play is false");
      return;
    }

    if (!pause) {
      console.debug("[VISUALISATION] Pausing - hiding visualisation");
      sendCommand("PAUSE");
    } else {
      console.debug("[VISUALISATION] Resuming - showing visualisation");
      sendCommand("PLAY");
    }
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
  root.style.setProperty("--volume-track-lightness", (100 - (initV / 2)) + "%");

  volumeController.addEventListener("input", (e) => {
    const v = Number(e.target.value || 0);
    sendCommand("VOLUME", v);

    const lightness = (100 - (v / 2)) + "%";
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

    // Cycle through loop modes: Off -> Playlist -> Current -> Off
    repeatMode = (repeatMode + 1) % 3; // 0->1->2->0

    // Update button highlight (highlighted for any repeat mode)
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

// Expand/collapse playlist/visualisation sections
resizable.forEach((resize) => {
  resize.addEventListener("click", () => {
    const container = resize.closest(".playlist-container, .visualisation-container");
    if (!container) {
      console.debug("resizable click: container not found");
      return;
    }

    const isVisualisation = container.classList.contains("visualisation-container");
    const currentHeight = container.style.height;
    const newHeight = currentHeight === "auto" ? "2rem" : "auto";

    console.debug(`[VISUALISATION] Container ${isVisualisation ? "visualisation" : "playlist"} clicked:`, {
      currentHeight,
      newHeight,
      container: container.className
    });

    container.style.height = newHeight;

    if (isVisualisation) {
      const visualisationImg = container.querySelector(".visualisation");
      console.debug("[VISUALISATION] Image element:", {
        found: !!visualisationImg,
        display: visualisationImg ? window.getComputedStyle(visualisationImg).display : "N/A",
        src: visualisationImg ? visualisationImg.src : "N/A"
      });
    }
  });
});

// Manual connect button
if (connectBtn) {
  connectBtn.addEventListener("click", () => {
    reconnectAttempts = 0; // Reset attempts
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    setStatus("Connecting...");
    connectToYouTubeTab();
  });
}

// Initialize connection when page loads
connectToYouTubeTab();

// Debug: Log visualisation element initialization
console.debug("[VISUALISATION] Initialization:", {
  found: !!visualisation,
  display: visualisation ? window.getComputedStyle(visualisation).display : "N/A",
  src: visualisation ? visualisation.src : "N/A",
  container: visualisation ? visualisation.closest(".visualisation-container")?.className : "N/A"
});
