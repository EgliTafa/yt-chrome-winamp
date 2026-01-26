// player/playlist.js
import { qs } from "./dom.js";
import { setStatus } from "./status.js";
import { sendCommand } from "./commands.js";

const playlistSearch = qs(".playlist-search");
const playlistItemsEl = qs(".playlist-items");

let playlistItems = [];

export function initPlaylistUI() {
  if (playlistSearch) {
    playlistSearch.addEventListener("input", renderPlaylist);
  }
}

export function setPlaylistItems(items) {
  playlistItems = Array.isArray(items) ? items : [];
  renderPlaylist();
}

function renderPlaylist() {
  if (!playlistItemsEl) return;

  const q = (playlistSearch?.value || "").trim().toLowerCase();
  const filtered = q
    ? playlistItems.filter((x) => (x.title || "").toLowerCase().includes(q))
    : playlistItems;

  playlistItemsEl.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "playlist-empty";
    empty.textContent = q
      ? "No matches."
      : "No playlist items found (open a playlist on YouTube).";
    playlistItemsEl.appendChild(empty);
    return;
  }

  for (const it of filtered) {
    const row = document.createElement("div");
    row.className = "playlist-item" + (it.isCurrent ? " current" : "");
    row.textContent = `${it.index}. ${it.title || "—"}`;
    row.title = it.title || "";

    row.addEventListener("click", () => {
      if (!it.videoId) return;
      sendCommand("PLAY_ITEM", { videoId: it.videoId });
      setStatus(`Jumping to: ${it.title || it.videoId}`);
    });

    playlistItemsEl.appendChild(row);
  }
}
