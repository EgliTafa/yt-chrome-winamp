// player/handlers.js
import { el } from "./dom.js";
import { state } from "./state.js";
import { fmtTime, setHighlighted, setStatus } from "./status.js";
import { setTrackTitle } from "./marquee.js";
import { startUpdateInterval } from "./commands.js";
import { startViz, stopViz, setAudioBars } from "./viz.js";

export function handleContentMessage(msg) {
  if (!msg?.type) return;

  switch (msg.type) {
    case "YOUTUBE_STATE":
      handleYouTubeState(msg);
      break;
    case "PLAYER_INFO":
      handlePlayerInfo(msg);
      break;
    case "AUDIO_DATA":
      setAudioBars(msg.bars);
      break;
  }
}

export function handleYouTubeState(stateMsg) {
  if (!stateMsg.hasPlayer) {
    setStatus("No video player found on this YouTube page.");
    if (el.nowPlaying) el.nowPlaying.textContent = "No video player found. Navigate to a video or playlist.";
    stopViz();
    return;
  }

  if (stateMsg.playlistId) {
    setStatus(`Connected to playlist: ${stateMsg.playlistId}`);
    if (el.nowPlaying) el.nowPlaying.textContent = `Connected to playlist: ${stateMsg.playlistId}`;
  } else if (stateMsg.videoId) {
    setStatus(`Connected to video: ${stateMsg.videoId}`);
    if (el.nowPlaying) el.nowPlaying.textContent = `Connected to video: ${stateMsg.videoId}`;
  }

  startUpdateInterval();
}

export function handlePlayerInfo(info) {
  if (info.error) {
    setStatus(info.error);
    stopViz();
    return;
  }

  if (typeof info.currentTime === "number") state.lastCurrentTime = info.currentTime;
  if (typeof info.duration === "number" && info.duration > 0) state.lastDuration = info.duration;
  if (typeof info.title === "string" && info.title) state.lastTitle = info.title;

  if (typeof info.volume === "number" && el.volumeController) {
    el.volumeController.value = String(info.volume);
  }

  if (typeof info.shuffle === "boolean") {
    state.isShuffleOn = info.shuffle;
    setHighlighted(el.shuffleBtn, state.isShuffleOn);
  }

  if (typeof info.loop === "number") {
    state.repeatMode = info.loop;
    setHighlighted(el.repeatBtn, state.repeatMode > 0);
  } else if (typeof info.loop === "boolean") {
    state.repeatMode = info.loop ? 1 : 0;
    setHighlighted(el.repeatBtn, state.repeatMode > 0);
  }

  if (el.timeDisplayer) el.timeDisplayer.textContent = fmtTime(state.lastCurrentTime);
  setTrackTitle(state.lastTitle || "YouTube Player");
  if (el.nowPlaying) el.nowPlaying.textContent = state.lastTitle ? `Now Playing: ${state.lastTitle}` : "Now Playing: —";

  if (!state.userDraggingProgress && state.lastDuration > 0 && el.progressBar) {
    const frac = Math.max(0, Math.min(1, state.lastCurrentTime / state.lastDuration));
    el.progressBar.value = String(frac);
  }

  // playing / paused
  if (info.playerState === 1) {
    state.play = true;
    state.pause = false;
    setHighlighted(el.playBtn, true);
    setHighlighted(el.stopBtn, true);
    setHighlighted(el.pauseBtn, false);
    startViz();
  } else if (info.playerState === 2) {
    state.pause = true;
    setHighlighted(el.pauseBtn, true);
    stopViz();
  }
}
