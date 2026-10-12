export const SELECTORS = {
  video: "video",
  title: [
    "h1.ytd-watch-metadata yt-formatted-string",
    ".ytp-title-link",
    "h1.title",
  ],
  nextButton: [".ytp-next-button"],
  previousButton: [".ytp-prev-button"],
  playButton: [
    ".ytp-play-button[aria-label*='Play']",
    ".ytp-play-button:not(.ytp-pause-button)",
  ],
  pauseButton: [
    ".ytp-play-button.ytp-pause-button",
    ".ytp-play-button[aria-label*='Pause']",
  ],
  shuffleButton: [
    ".ytp-shuffle-button",
    "button[aria-label*='Shuffle']",
    "button[title*='Shuffle']",
    ".ytp-button[aria-label*='Shuffle']",
  ],
  loopButton: [
    ".ytp-repeat-button",
    "button[aria-label*='Loop']",
    "button[aria-label*='Repeat']",
    "button[title*='Loop']",
    "button[title*='Repeat']",
    ".ytp-button[aria-label*='Loop']",
    ".ytp-button[aria-label*='Repeat']",
  ],
  playlistPanelRoot: "ytd-playlist-panel-renderer",
  playlistPanelItem: "ytd-playlist-panel-video-renderer",
  playlistPageItem: "ytd-playlist-video-renderer",
  playlistItemAnchor: [
    "a#video-title",
    "a[href*='watch?v=']",
    "#video-title",
  ],
};

export function queryFirst(selectorList) {
  for (const selector of selectorList) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}
