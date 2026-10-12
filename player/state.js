// player/state.js
export const CONNECTION_PHASES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  HANDSHAKING: "handshaking",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  FAILED: "failed",
};

export const state = {
  play: false,
  pause: false,

  isShuffleOn: false,
  repeatMode: 0, // 0 off, 1 playlist, 2 current

  lastDuration: 0,
  lastCurrentTime: 0,
  lastTitle: "",
  lastVideoId: "",
  lastPlaylistId: "",
  lastYouTubeUrl: "",
  timeDisplayMode: "elapsed",

  userDraggingProgress: false,

  contentPort: null,
  youtubeTabId: null,
  youtubeTabTitle: "",
  updateInterval: null,
  isConnected: false,
  connectionPhase: CONNECTION_PHASES.DISCONNECTED,

  reconnectAttempts: 0,
  MAX_RECONNECT_ATTEMPTS: 3,
  reconnectTimeout: null,
  connectionAttemptToken: 0,
  userDisconnected: false,
  scrubTime: null,

  volume: 100,
  isMuted: false,
  preMuteVolume: 100,

  playlistCollapsed: false,
  shadeMode: false,

  preferredYoutubeTabId: null,
};
