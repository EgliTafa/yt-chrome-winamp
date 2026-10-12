// player.js (main)
import {
  bindUI,
  refreshYoutubeTabOptions,
  updateConnectionControls,
} from "./player/events.js";
import { connectToYouTubeTab } from "./player/connection.js";
import { initViz } from "./player/viz.js";
import { sendCommand } from "./player/commands.js";
import { initPlaylistUI } from "./player/playlist.js";
import { loadAndApplyPrefs, startPrefsPersistence } from "./player/prefs.js";

async function main() {
  await loadAndApplyPrefs();
  bindUI();
  initViz({ sendCommand });
  initPlaylistUI();
  startPrefsPersistence();
  await refreshYoutubeTabOptions();
  void connectToYouTubeTab().finally(async () => {
    await refreshYoutubeTabOptions();
    updateConnectionControls();
  });
}

main();
