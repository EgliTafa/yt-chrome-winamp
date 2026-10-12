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
const LOCAL_SYNC_FALLBACK_KEY = "syncPrefsFallback";

let restoredWindowBounds = false;
let pendingSync = {};
let saveSyncTimer = null;
let persistenceQueue = Promise.resolve();

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
  saveSyncTimer = setTimeout(() => {
    void flushSavePrefs();
  }, 280);
}

async function readLocalFallback() {
  try {
    const keys = [...SYNC_KEYS, LOCAL_SYNC_FALLBACK_KEY];
    const localData = await chrome.storage.local.get(keys);
    const legacyFallback = {};
    for (const key of SYNC_KEYS) {
      if (key in localData) legacyFallback[key] = localData[key];
    }

    const journal = localData[LOCAL_SYNC_FALLBACK_KEY];
    return {
      ...legacyFallback,
      ...(journal && typeof journal === "object" ? journal : {}),
    };
  } catch (_) {
    return {};
  }
}

async function journalLocalFallback(payload) {
  try {
    const current = await readLocalFallback();
    await chrome.storage.local.set({
      [LOCAL_SYNC_FALLBACK_KEY]: { ...current, ...payload },
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function clearSyncedFallback(payload) {
  try {
    const current = await readLocalFallback();
    for (const [key, value] of Object.entries(payload)) {
      // Do not clear a newer local value if this function is ever called from
      // an overlapping write path. Writes are serialized today, but this guard
      // keeps the fallback journal safe if that implementation changes.
      if (Object.is(current[key], value)) delete current[key];
    }

    // Remove values written directly to local storage by earlier versions
    // before editing the journal. If this removal fails, the journal still
    // contains the newly synced value and continues to override legacy data.
    await chrome.storage.local.remove(Object.keys(payload));

    if (Object.keys(current).length) {
      await chrome.storage.local.set({ [LOCAL_SYNC_FALLBACK_KEY]: current });
    } else {
      await chrome.storage.local.remove(LOCAL_SYNC_FALLBACK_KEY);
    }
  } catch (_) { /* keep the local copy; it contains the same just-synced value */ }
}

async function persistBatch(batch) {
  const syncPayload = {};
  for (const key of SYNC_KEYS) {
    if (key in batch) syncPayload[key] = batch[key];
  }

  if (Object.keys(syncPayload).length) {
    // Local-first journaling closes the gap between a failed sync write and the
    // next launch. A successful sync removes only this batch from the journal.
    await journalLocalFallback(syncPayload);
    try {
      await chrome.storage.sync.set(syncPayload);
      await clearSyncedFallback(syncPayload);
    } catch (_) {
      // The journal remains authoritative until a later successful sync.
    }
  }

  if (batch.windowBounds) {
    try {
      await chrome.storage.local.set({ windowBounds: batch.windowBounds });
    } catch (_) { /* ignore */ }
  }
}

async function retryLocalFallbackSync(fallback) {
  if (!Object.keys(fallback).length) return;
  try {
    await chrome.storage.sync.set(fallback);
    await clearSyncedFallback(fallback);
  } catch (_) {
    // Keep the fallback journal for the next launch or preference write.
  }
}

export function flushSavePrefs() {
  if (saveSyncTimer) clearTimeout(saveSyncTimer);
  saveSyncTimer = null;
  const batch = { ...pendingSync };
  pendingSync = {};
  if (!Object.keys(batch).length) return persistenceQueue;

  const persist = () => persistBatch(batch);
  persistenceQueue = persistenceQueue.then(persist, persist);
  return persistenceQueue;
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
  } catch (_) { /* local fallback is merged below */ }
  try {
    localData = await chrome.storage.local.get([
      "windowBounds",
      LOCAL_SYNC_FALLBACK_KEY,
      ...SYNC_KEYS,
    ]);
  } catch (_) { /* ignore */ }

  const legacyFallback = {};
  for (const key of SYNC_KEYS) {
    if (key in localData) legacyFallback[key] = localData[key];
  }
  const fallbackJournal = localData[LOCAL_SYNC_FALLBACK_KEY];
  const localFallback = {
    ...legacyFallback,
    ...(fallbackJournal && typeof fallbackJournal === "object" ? fallbackJournal : {}),
  };
  const prefs = {
    ...syncData,
    ...localFallback,
  };

  // Retry previously failed sync writes. Reads still use the local values in
  // this launch, whether this retry succeeds or not.
  await retryLocalFallbackSync(localFallback);

  const volume = clampVolume(prefs.volume);
  if (volume !== null) applyVolumeToUI(volume);

  const vizMode = clampVizMode(prefs.vizMode);
  if (vizMode !== null) setVizMode(vizMode);

  if (typeof prefs.playlistCollapsed === "boolean") {
    state.playlistCollapsed = prefs.playlistCollapsed;
    const container = document.querySelector(".playlist-container");
    if (container) {
      container.classList.toggle("collapsed", prefs.playlistCollapsed);
    }
  }

  if (typeof prefs.sortAlphabetical === "boolean") {
    const { applyPlaylistSortPreference } = await import("./playlist.js");
    applyPlaylistSortPreference(prefs.sortAlphabetical);
  }

  const tabId = Number(prefs.youtubeTabId);
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
