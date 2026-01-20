// player/dom.js
export const qs = document.querySelector.bind(document);
export const qsall = document.querySelectorAll.bind(document);
export const root = document.documentElement;

export const el = {
  // marquee
  trackTitleMarquee: qs(".track-title-marquee"),
  trackTitleInner: qs(".track-title-inner"),
  trackTitleTextA: qs(".track-title-text"),
  trackTitleTextB: qs(".track-title-text.clone"),

  // controls
  timeDisplayer: qs(".time-displayer"),
  volumeController: qs(".volume-controller"),
  progressBar: qs(".progress-bar"),

  playBtn: qs(".play-btn"),
  pauseBtn: qs(".pause-btn"),
  stopBtn: qs(".stop-btn"),
  shuffleBtn: qs(".shuffle-btn"),
  repeatBtn: qs(".repeat-btn"),

  connectBtn: qs(".connect-btn"),
  statusText: qs(".status-text"),
  nowPlaying: qs(".now-playing"),

  navBtns: qsall(".nav-btn"),
  resizable: qsall(".resizable"),

  // visualisation
  visualisationCanvas: qs("canvas.visualisation.viz-mini") || qs(".visualisation"),
};
