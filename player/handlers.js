// player/handlers.js
import { el } from "./dom.js";
import { state } from "./state.js";
import { setHighlighted, setStatus, updateTimeDisplay } from "./status.js";
import { setTrackTitle } from "./marquee.js";
import { startUpdateInterval } from "./commands.js";
import { startViz, stopViz, setAudioBars, setWaveformPoints } from "./viz.js";
import { setPlaylistContext, setPlaylistItems } from "./playlist.js";
import { applyMuteUI, applyVolumeUI } from "./audio-ui.js";
import { clearNowPlayingThumbnail, setNowPlayingThumbnail } from "./now-playing.js";

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
      if (msg.bars) setAudioBars(msg.bars);
      if (msg.wave) setWaveformPoints(msg.wave);
      if (state.play && !state.pause) startViz({ requestStream: false });
      break;

    case "PLAYLIST_ITEMS":
      setPlaylistItems(msg.items, {
        surface: msg.surface,
        playlistId: msg.playlistId,
      });
      break;

    case "PLAY_ITEM_ACK":
      if (msg.ok) {
        setStatus(`Jumped to: ${msg.videoId}`);
      } else {
        setStatus(`Could not jump (not found): ${msg.videoId}`);
      }
      break;

    default:
      break;
  }
}

export function handleYouTubeState(stateMsg) {
  state.lastPlaylistId = String(stateMsg.playlistId || "");
  state.lastYouTubeUrl = String(stateMsg.url || "");
  if (stateMsg.videoId) state.lastVideoId = String(stateMsg.videoId);
  setPlaylistContext({ playlistId: state.lastPlaylistId });

  if (!stateMsg.hasPlayer) {
    const isPlaylistPage = state.lastPlaylistId && (() => {
      try { return new URL(state.lastYouTubeUrl).pathname === "/playlist"; }
      catch (_) { return false; }
    })();
    setStatus(isPlaylistPage
      ? `Connected to playlist page: ${state.lastPlaylistId}`
      : "No video player found on this YouTube page.");
    if (el.nowPlaying) el.nowPlaying.textContent = "";
    if (!stateMsg.videoId) clearNowPlayingThumbnail();
    stopViz();
    return;
  }

  if (stateMsg.playlistId) {
    setStatus(`Connected to playlist: ${stateMsg.playlistId}`);
    if (el.nowPlaying) el.nowPlaying.textContent = "";
  } else if (stateMsg.videoId) {
    setStatus(`Connected to video: ${stateMsg.videoId}`);
    if (el.nowPlaying) el.nowPlaying.textContent = "";
  }

  startUpdateInterval();
}

export function handlePlayerInfo(info) {
  if (info.error) {
    let isPlaylistPage = false;
    try { isPlaylistPage = new URL(state.lastYouTubeUrl).pathname === "/playlist"; }
    catch (_) { }
    setStatus(isPlaylistPage && state.lastPlaylistId
      ? `Connected to playlist page: ${state.lastPlaylistId}`
      : info.error);
    stopViz();
    return;
  }

  if (Number.isFinite(info.currentTime)) state.lastCurrentTime = info.currentTime;
  if (Number.isFinite(info.duration) && info.duration > 0) state.lastDuration = info.duration;
  if (typeof info.title === "string" && info.title) state.lastTitle = info.title;
  if (typeof info.videoId === "string" && info.videoId) {
    state.lastVideoId = info.videoId;
    setNowPlayingThumbnail(info.videoId);
  }

  if (typeof info.volume === "number" && info.volume !== state.volume) {
    applyVolumeUI(info.volume);
  }
  if (typeof info.volume === "number" && info.volume > 0) {
    state.preMuteVolume = info.volume;
  }
  if (typeof info.muted === "boolean") applyMuteUI(info.muted);

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

  const t =
    state.userDraggingProgress && typeof state.scrubTime === "number"
      ? state.scrubTime
      : state.lastCurrentTime;
  updateTimeDisplay(t, state.lastDuration, state.timeDisplayMode);

  setTrackTitle(state.lastTitle || "YouTube Player");
  // Hide now-playing section to avoid duplication
  if (el.nowPlaying) el.nowPlaying.textContent = "";

  if (!state.userDraggingProgress && state.lastDuration > 0 && el.progressBar) {
    const frac = Math.max(0, Math.min(1, state.lastCurrentTime / state.lastDuration));
    el.progressBar.value = String(frac);
  }

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
  } else {
    state.play = false;
    state.pause = false;
    setHighlighted(el.playBtn, false);
    setHighlighted(el.pauseBtn, false);
    stopViz();
  }
}
