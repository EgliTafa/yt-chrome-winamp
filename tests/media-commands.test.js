import test from "node:test";
import assert from "node:assert/strict";

test("routes global commands to the saved YouTube tab", async () => {
  const sent = [];
  const syncWrites = [];
  let fallbackJournal = {};
  globalThis.chrome = {
    storage: {
      sync: {
        async get() { return { youtubeTabId: 42 }; },
        async set(payload) { syncWrites.push(payload); },
      },
      local: {
        async get() { return { syncPrefsFallback: fallbackJournal }; },
        async set(payload) { fallbackJournal = payload.syncPrefsFallback; },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          if (list.includes("syncPrefsFallback")) fallbackJournal = {};
        },
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, url: "https://www.youtube.com/watch?v=saved" };
      },
      async query() { return []; },
      async sendMessage(tabId, message) {
        sent.push({ tabId, message });
        return message.command.type === "VOLUME_DELTA"
          ? { ok: true, volume: 35, muted: false }
          : { ok: true };
      },
    },
    scripting: { async executeScript() {} },
  };

  const { handleMediaCommand } = await import("../background/media-commands.js");
  assert.equal(await handleMediaCommand("media-play-pause"), true);
  assert.equal(await handleMediaCommand("volume-down"), true);
  assert.deepEqual(sent, [
    {
      tabId: 42,
      message: {
        source: "maxamp-media-command",
        command: { type: "PLAY_PAUSE" },
      },
    },
    {
      tabId: 42,
      message: {
        source: "maxamp-media-command",
        command: { type: "VOLUME_DELTA", value: -5 },
      },
    },
  ]);
  assert.deepEqual(syncWrites, [{ volume: 35, muted: false }]);
  assert.deepEqual(fallbackJournal, {});
});

test("falls back to the audible YouTube tab when no saved tab is valid", async () => {
  globalThis.chrome = {
    storage: {
      sync: { async get() { return {}; } },
      local: { async get() { return {}; } },
    },
    tabs: {
      async query() {
        return [
          { id: 1, url: "https://www.youtube.com/watch?v=active", active: true, audible: false },
          { id: 2, url: "https://www.youtube.com/watch?v=audible", active: false, audible: true },
        ];
      },
    },
  };

  const { resolveMediaCommandTab } = await import("../background/media-commands.js");
  assert.equal((await resolveMediaCommandTab()).id, 2);
});
