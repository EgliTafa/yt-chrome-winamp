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
  playlistPanelRoot: [
    "ytd-watch-flexy ytd-playlist-panel-renderer",
    "ytd-playlist-panel-renderer",
    "ytd-watch-flexy #playlist",
  ],
  playlistPanelItem: [
    "ytd-playlist-panel-video-renderer",
    "ytd-playlist-panel-video-wrapper-renderer",
  ],
  playlistPageRoot: [
    "ytd-browse[page-subtype='playlist'] ytd-playlist-video-list-renderer",
    "ytd-browse[page-subtype='playlist'] #contents.ytd-playlist-video-list-renderer",
    "ytd-playlist-video-list-renderer",
    "ytd-browse[page-subtype='playlist'] #contents",
    "ytd-browse",
  ],
  playlistPageItem: [
    "ytd-playlist-video-renderer",
    "ytd-playlist-video-list-renderer ytd-rich-item-renderer",
    "ytd-playlist-video-list-renderer ytd-video-renderer",
  ],
  playlistItemAnchor: [
    "a#video-title",
    "a[href*='watch?v=']",
    "#video-title",
  ],
  playlistItemTitle: [
    "a#video-title",
    "#video-title",
    "yt-formatted-string#video-title",
    "[title]",
  ],
  playlistFallbackAnchor: [
    "a#video-title[href*='watch?v=']",
    "a.yt-simple-endpoint[href*='watch?v=']",
    "a[href*='watch?v='][href*='list=']",
  ],
};

export function queryFirst(selectorList) {
  const selectors = Array.isArray(selectorList) ? selectorList : [selectorList];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}
