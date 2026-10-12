// player/prefs.js — chrome.storage.sync (settings) + local (window bounds)
import { el, root } from "./dom.js";
import { state } from "./state.js";
import { setVizMode, getVizMode } from "./viz.js";

const SYNC_KEYS = [
  "volume",
  "vizMode",
  "playlistCollapsed",
  "sortAlphabetical",
  "youtubeTabId",
];

let restoredWindowBounds = false;
let pendingSync = {};
let saveSyncTimer = null;

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampVizMode(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return ((Math.round(n) % 3) + 3) % 3;
}

export function shouldSkipInitialWindowResize() {
  return restoredWindowBounds;
}

export function queueSavePrefs(partial) {
  if (!partial || typeof partial !== "object") return;
  Object.assign(pendingSync, partial);
  if (saveSyncTimer) clearTimeout(saveSyncTimer);
  saveSyncTimer = setTimeout(flushSavePrefs, 280);
}

async function flushSavePrefs() {
  saveSyncTimer = null;
  const batch = { ...pendingSync };
  pendingSync = {};
  if (!Object.keys(batch).length) return;

  const syncPayload = {};
  for (const key of SYNC_KEYS) {
    if (key in batch) syncPayload[key] = batch[key];
  }
  if (Object.keys(syncPayload).length) {
    try {
      await chrome.storage.sync.set(syncPayload);
    } catch (_) {
      try {
        await chrome.storage.local.set(syncPayload);
      } catch (_) { /* ignore */ }
    }
  }

  if (batch.windowBounds) {
    try {
      await chrome.storage.local.set({ windowBounds: batch.windowBounds });
    } catch (_) { /* ignore */ }
  }
}

function applyVolumeToUI(volume) {
  const v = clampVolume(volume);
  if (v === null) return;
  state.volume = v;
  if (el.volumeController) el.volumeController.value = String(v);
  root.style.setProperty("--volume-track-lightness", 100 - v / 2 + "%");
}

export async function loadAndApplyPrefs() {
  let syncData = {};
  let localData = {};
  try {
    syncData = await chrome.storage.sync.get(SYNC_KEYS);
  } catch (_) {
    try {
      syncData = await chrome.storage.local.get(SYNC_KEYS);
    } catch (_) { /* ignore */ }
  }
  try {
    localData = await chrome.storage.local.get(["windowBounds"]);
  } catch (_) { /* ignore */ }

  const volume = clampVolume(syncData.volume);
  if (volume !== null) applyVolumeToUI(volume);

  const vizMode = clampVizMode(syncData.vizMode);
  if (vizMode !== null) setVizMode(vizMode);

  if (typeof syncData.playlistCollapsed === "boolean") {
    state.playlistCollapsed = syncData.playlistCollapsed;
    const container = document.querySelector(".playlist-container");
    if (container) {
      container.classList.toggle("collapsed", syncData.playlistCollapsed);
    }
  }

  if (typeof syncData.sortAlphabetical === "boolean") {
    const { applyPlaylistSortPreference } = await import("./playlist.js");
    applyPlaylistSortPreference(syncData.sortAlphabetical);
  }

  const tabId = Number(syncData.youtubeTabId);
  if (Number.isInteger(tabId) && tabId > 0) {
    state.preferredYoutubeTabId = tabId;
  }

  const bounds = localData.windowBounds;
  if (bounds && typeof bounds === "object") {
    await restoreWindowBounds(bounds);
  }
}

async function restoreWindowBounds(bounds) {
  try {
    const win = await chrome.windows.getCurrent();
    if (!win?.id) return;

    const update = {};
    if (Number.isFinite(bounds.width) && bounds.width >= 320) {
      update.width = Math.round(bounds.width);
    }
    if (Number.isFinite(bounds.height) && bounds.height >= 240) {
      update.height = Math.round(bounds.height);
    }
    if (Number.isFinite(bounds.left)) update.left = Math.round(bounds.left);
    if (Number.isFinite(bounds.top)) update.top = Math.round(bounds.top);

    if (Object.keys(update).length) {
      await chrome.windows.update(win.id, update);
      restoredWindowBounds = true;
    }
  } catch (_) { /* ignore */ }
}

export async function saveWindowBoundsFromResize() {
  try {
    const win = await chrome.windows.getCurrent();
    if (!win?.id) return;
    const windowBounds = {
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
    };
    await chrome.storage.local.set({ windowBounds });
  } catch (_) { /* ignore */ }
}

export function startPrefsPersistence() {
  let boundsTimer = null;
  const debouncedBoundsSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveWindowBoundsFromResize, 450);
  };

  try {
    chrome.windows.onBoundsChanged.addListener((windowId) => {
      chrome.windows.getCurrent().then((w) => {
        if (w?.id === windowId) debouncedBoundsSave();
      });
    });
  } catch (_) { /* ignore */ }

  window.addEventListener("beforeunload", () => {
    void saveWindowBoundsFromResize();
    void flushSavePrefs();
  });
}

export function savePreferredTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId <= 0) return;
  state.preferredYoutubeTabId = tabId;
  queueSavePrefs({ youtubeTabId: tabId });
}

export function saveVolumePref(volume) {
  const v = clampVolume(volume);
  if (v === null) return;
  queueSavePrefs({ volume: v });
}

export function saveVizModePref() {
  queueSavePrefs({ vizMode: getVizMode() });
}

export function savePlaylistCollapsedPref(collapsed) {
  queueSavePrefs({ playlistCollapsed: !!collapsed });
}

export function saveSortAlphabeticalPref(on) {
  queueSavePrefs({ sortAlphabetical: !!on });
}
