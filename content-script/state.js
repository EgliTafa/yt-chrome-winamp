// content-script/state.js
export const CONTENT_CONNECTION_PHASES = {
  IDLE: "idle",
  LISTENING: "listening",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  DESTROYED: "destroyed",
};

export const state = {
  // Core state
  port: null,
  disabled: false,
  connectionPhase: CONTENT_CONNECTION_PHASES.IDLE,
  currentVideoId: null,
  currentPlaylistId: null,
  /** User volume 0–100; null until first video read or VOLUME command */
  volume: null,
  lastVolumeSyncedVideoId: undefined,

  // Visualiser state
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  attachedVideoEl: null,
  vizTimer: null,
  vizRetryTimer: null,
  audioInitPromise: null,

  // Monitoring / SPA
  monitoringVideo: null,
  urlCheckTimer: null,
  lastUrl: window.location.href,

  // Playlist observer
  playlistObserver: null,
  playlistRoot: null,
  playlistRetryTimer: null,
  playlistSendTimer: null,
  lastPlaylistSig: "",
  lastSentEmpty: false,
};

export const VIZ_FPS_MS = 33;      // ~30 FPS
export const VIZ_BARS_COUNT = 24;  // bars sent to popup

export const INSTANCE_KEY = "__MAXAMP_CONTENT_SCRIPT_INSTANCE__";
