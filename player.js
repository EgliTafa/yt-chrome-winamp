// player.js (main)
import { bindUI } from "./player/events.js";
import { connectToYouTubeTab } from "./player/connection.js";
import { initViz } from "./player/viz.js";
import { sendCommand } from "./player/commands.js";
import { initPlaylistUI } from "./player/playlist.js";

bindUI();
initViz({ sendCommand });
initPlaylistUI();
connectToYouTubeTab();
