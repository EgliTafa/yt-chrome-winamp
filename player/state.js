// player/state.js
export const state = {
  play: false,
  pause: false,

  isShuffleOn: false,
  repeatMode: 0, // 0 off, 1 playlist, 2 current

  lastDuration: 0,
  lastCurrentTime: 0,
  lastTitle: "",

  userDraggingProgress: false,

  contentPort: null,
  youtubeTabId: null,
  updateInterval: null,
  isConnected: false,

  reconnectAttempts: 0,
  MAX_RECONNECT_ATTEMPTS: 3,
  reconnectTimeout: null,
  scrubTime: null
};
