// content-script/handlers.js
import { state } from "./state.js";
import { safePost } from "./helpers.js";
import { detectAndSendState, sendPlayerInfo } from "./player-info.js";
import { startVisualiserStream, stopVisualiserStream } from "./visualiser.js";
import { ensurePlaylistObserver } from "./playlist.js";
import { sendPlaylistItems, playPlaylistItemByVideoId } from "./playlist.js";
import {
  playVideo,
  pauseVideo,
  stopVideo,
  nextVideo,
  previousVideo,
  seekTo,
  setVolume,
  setShuffle,
  setLoop,
} from "./player-controls.js";
import { getLoopState } from "./player-info.js";

export function handleExtensionMessage(msg) {
  switch (msg.type) {
    case "PLAY": playVideo(); break;
    case "PAUSE": pauseVideo(); break;
    case "STOP": stopVideo(); break;
    case "NEXT": nextVideo(); break;
    case "PREV": previousVideo(); break;
    case "SEEK": seekTo(msg.value); break;
    case "VOLUME": setVolume(msg.value); break;
    case "SHUFFLE": setShuffle(msg.value); break;

    case "LOOP":
      if (typeof msg.value === "number") setLoop(msg.value);
      else setLoop((getLoopState() + 1) % 3);
      break;

    case "GET_STATE":
      detectAndSendState();
      sendPlayerInfo();
      break;

    case "START_VIZ":
      startVisualiserStream();
      break;

    case "STOP_VIZ":
      stopVisualiserStream();
      break;

    case "GET_PLAYLIST":
      ensurePlaylistObserver(true);
      sendPlaylistItems(true);
      break;

    case "PLAY_ITEM": {
      const videoId = msg.value?.videoId;
      const ok = playPlaylistItemByVideoId(videoId);

      // ✅ tell popup whether we managed to click/navigate
      safePost({ type: "PLAY_ITEM_ACK", ok: !!ok, videoId });

      setTimeout(() => {
        detectAndSendState();
        sendPlayerInfo();
        ensurePlaylistObserver(false);
        sendPlaylistItems(true);
      }, 900);
      break;
    }
  }
}
