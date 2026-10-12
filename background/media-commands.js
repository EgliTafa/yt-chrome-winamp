// background/media-commands.js
const YOUTUBE_URL_PATTERNS = [
  "https://www.youtube.com/*",
  "https://youtube.com/*",
];

export const COMMAND_MESSAGES = {
  "media-play-pause": { type: "PLAY_PAUSE" },
  "media-next": { type: "NEXT" },
  "media-previous": { type: "PREV" },
  "volume-up": { type: "VOLUME_DELTA", value: 5 },
  "volume-down": { type: "VOLUME_DELTA", value: -5 },
};

const LOCAL_SYNC_FALLBACK_KEY = "syncPrefsFallback";
let preferenceWriteQueue = Promise.resolve();

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?youtube\.com\//i.test(String(url || ""));
}

async function readPreferredTabId() {
  let syncData = {};
  let localData = {};
  try { syncData = await chrome.storage.sync.get("youtubeTabId"); } catch (_) { }
  try {
    localData = await chrome.storage.local.get(["youtubeTabId", "syncPrefsFallback"]);
  } catch (_) { }

  const journal = localData.syncPrefsFallback;
  const candidate = journal && typeof journal === "object" && "youtubeTabId" in journal
    ? journal.youtubeTabId
    : "youtubeTabId" in localData
      ? localData.youtubeTabId
      : syncData.youtubeTabId;
  const tabId = Number(candidate);
  return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
}

async function getYouTubeTab(tabId) {
  if (!tabId) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return isYouTubeUrl(tab?.url || tab?.pendingUrl) ? tab : null;
  } catch (_) {
    return null;
  }
}

export async function resolveMediaCommandTab() {
  const preferredTab = await getYouTubeTab(await readPreferredTabId());
  if (preferredTab) return preferredTab;

  try {
    const tabs = await chrome.tabs.query({ url: YOUTUBE_URL_PATTERNS });
    return tabs
      .filter((tab) => Number.isInteger(tab?.id) && isYouTubeUrl(tab.url || tab.pendingUrl))
      .sort((a, b) => {
        if (!!a.audible !== !!b.audible) return a.audible ? -1 : 1;
        if (!!a.active !== !!b.active) return a.active ? -1 : 1;
        return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
      })[0] || null;
  } catch (_) {
    return null;
  }
}

async function sendToContentScript(tabId, commandMessage) {
  const message = {
    source: "maxamp-media-command",
    command: commandMessage,
  };

  try {
    return await chrome.tabs.sendMessage(tabId, message) || { ok: true };
  } catch (_) {
    // A YouTube tab that predates extension installation/reload may not have
    // the declared content script yet. Inject once, then retry the command.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"],
      });
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 75));
        try {
          return await chrome.tabs.sendMessage(tabId, message) || { ok: true };
        } catch (_) { }
      }
      return null;
    } catch (_) {
      return null;
    }
  }
}

function persistCommandPreferences(payload) {
  const persist = async () => {
    let localData = {};
    try {
      localData = await chrome.storage.local.get(LOCAL_SYNC_FALLBACK_KEY);
    } catch (_) { }

    const current = localData[LOCAL_SYNC_FALLBACK_KEY];
    const journal = current && typeof current === "object" ? current : {};
    const nextJournal = { ...journal, ...payload };

    try {
      await chrome.storage.local.set({ [LOCAL_SYNC_FALLBACK_KEY]: nextJournal });
    } catch (_) { }

    try {
      await chrome.storage.sync.set(payload);
    } catch (_) {
      return;
    }

    try {
      await chrome.storage.local.remove(Object.keys(payload));
    } catch (_) { }

    // Clear only values that still match this write so a newer queued value
    // can never be removed by an older successful sync operation.
    try {
      const latestData = await chrome.storage.local.get(LOCAL_SYNC_FALLBACK_KEY);
      const latest = latestData[LOCAL_SYNC_FALLBACK_KEY];
      if (!latest || typeof latest !== "object") return;
      const remaining = { ...latest };
      for (const [key, value] of Object.entries(payload)) {
        if (Object.is(remaining[key], value)) delete remaining[key];
      }
      if (Object.keys(remaining).length) {
        await chrome.storage.local.set({ [LOCAL_SYNC_FALLBACK_KEY]: remaining });
      } else {
        await chrome.storage.local.remove(LOCAL_SYNC_FALLBACK_KEY);
      }
    } catch (_) { }
  };

  preferenceWriteQueue = preferenceWriteQueue.then(persist, persist);
  return preferenceWriteQueue;
}

export async function handleMediaCommand(command) {
  const commandMessage = COMMAND_MESSAGES[command];
  if (!commandMessage) return false;

  const tab = await resolveMediaCommandTab();
  if (!tab?.id) return false;
  const response = await sendToContentScript(tab.id, commandMessage);
  if (!response?.ok) return false;

  if (commandMessage.type === "VOLUME_DELTA" && Number.isFinite(response.volume)) {
    await persistCommandPreferences({
      volume: Math.max(0, Math.min(100, Math.round(response.volume))),
      muted: !!response.muted,
    });
  }
  return true;
}
