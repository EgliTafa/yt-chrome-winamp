// content-script/state.js
export const state = {
  // Core state
  port: null,
  disabled: false,
  currentVideoId: null,
  currentPlaylistId: null,

  // Visualiser state
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  attachedVideoEl: null,
  vizTimer: null,

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

export const VIZ_FPS_MS = 50;      // ~20 FPS
export const VIZ_BARS_COUNT = 24;  // bars sent to popup

export const INSTANCE_KEY = "__MAXAMP_CONTENT_SCRIPT_INSTANCE__";
