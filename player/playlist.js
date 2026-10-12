// player/playlist.js
import { qs } from "./dom.js";
import { state } from "./state.js";
import { setStatus } from "./status.js";
import { sendCommand } from "./commands.js";
import { saveSortAlphabeticalPref } from "./prefs.js";

// Import resize function (will be defined in events.js)
let resizeWindowToContent = null;
export function setResizeFunction(fn) {
  resizeWindowToContent = fn;
}

const playlistSearch = qs(".playlist-search");
const playlistItemsEl = qs(".playlist-items");
const sortBtn = qs(".playlist-sort-btn");

let playlistItems = [];
let sortAlphabetical = false;

export function applyPlaylistSortPreference(on) {
  sortAlphabetical = !!on;
  if (sortBtn) {
    sortBtn.setAttribute("aria-pressed", sortAlphabetical ? "true" : "false");
    sortBtn.title = sortAlphabetical ? "Alphabetical sort ON" : "Alphabetical sort OFF";
    sortBtn.setAttribute("aria-label", sortBtn.title);
  }
  renderPlaylist();
}

export function getPlaylistSortAlphabetical() {
  return sortAlphabetical;
}

function getSortKey(title) {
  const t = String(title || "").normalize("NFKD").toLowerCase().trim();
  // Ignore leading non-alphanumeric chars so sorting starts at first valid letter/number.
  return t.replace(/^[^a-z0-9]+/i, "");
}

function normalizeRowTitle(it) {
  const raw = String(it?.title || "").trim();
  if (!raw) return "—";

  const withoutPlayGlyph = raw.replace(/^[►▷]\s*/, "").trim();
  if (!withoutPlayGlyph) return "—";

  // If the scraped title already includes its index prefix (e.g. "153. Foo"),
  // remove it so we don't show "153. 153. Foo" in the UI.
  const idx = Number(it?.index);
  if (Number.isFinite(idx) && idx > 0) {
    const re = new RegExp(`^${idx}\\s*\\.?\\s+`, "i");
    return withoutPlayGlyph.replace(re, "").trim() || "—";
  }

  // Generic fallback: strip a leading number prefix like "153. "
  return withoutPlayGlyph.replace(/^\d+\s*\.?\s+/, "").trim() || "—";
}

export function initPlaylistUI() {
  if (playlistSearch) {
    playlistSearch.addEventListener("input", renderPlaylist);
  }
  if (sortBtn) {
    sortBtn.addEventListener("click", () => {
      applyPlaylistSortPreference(!sortAlphabetical);
      saveSortAlphabeticalPref(sortAlphabetical);
    });
  }
}

export function setPlaylistItems(items) {
  playlistItems = Array.isArray(items) ? items : [];
  renderPlaylist();
  // Grow window when playlist fills in; never shrink (avoids hiding header after collapse/item click).
  if (resizeWindowToContent && !state.playlistCollapsed) {
    setTimeout(() => resizeWindowToContent({ growOnly: true }), 50);
  }
}

function renderPlaylist() {
  if (!playlistItemsEl) return;

  const q = (playlistSearch?.value || "").trim().toLowerCase();
  const filtered = q
    ? playlistItems.filter((x) => (x.title || "").toLowerCase().includes(q))
    : playlistItems;
  const itemsToRender = sortAlphabetical
    ? [...filtered].sort((a, b) => {
      const aTitle = normalizeRowTitle(a);
      const bTitle = normalizeRowTitle(b);
      const aKey = getSortKey(aTitle) || aTitle.toLowerCase();
      const bKey = getSortKey(bTitle) || bTitle.toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base", numeric: true });
    })
    : filtered;

  playlistItemsEl.innerHTML = "";

  if (!itemsToRender.length) {
    const empty = document.createElement("div");
    empty.className = "playlist-empty";
    empty.textContent = q
      ? "No matches."
      : "No playlist items found (open a playlist on YouTube).";
    playlistItemsEl.appendChild(empty);
    return;
  }

  for (const it of itemsToRender) {
    const row = document.createElement("div");
    row.className = "playlist-item" + (it.isCurrent ? " current" : "");
    
    // Only show number and title, with play icon for current track
    const displayTitle = normalizeRowTitle(it);
    row.textContent = it.isCurrent
      ? `► ${displayTitle}`
      : `${it.index}. ${displayTitle}`;
    row.title = displayTitle;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${it.index}. ${displayTitle === "—" ? "Untitled track" : displayTitle}`);
    row.setAttribute("aria-selected", it.isCurrent ? "true" : "false");
    row.tabIndex = 0;
    row.style.userSelect = "none";

    const triggerPlay = () => {
      if (!it.videoId) return;

      sendCommand("PLAY_ITEM", { videoId: it.videoId });
      setStatus(`Jump request: ${it.title || it.videoId}`);
    };

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerPlay();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      triggerPlay();
    });

    playlistItemsEl.appendChild(row);
  }
}
