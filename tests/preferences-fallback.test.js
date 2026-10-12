import test from "node:test";
import assert from "node:assert/strict";

test("local fallback overrides stale sync data and is cleared after recovery", async () => {
  const syncData = { volume: 10 };
  const localData = {};
  let failSyncWrites = true;

  function selectKeys(source, keys) {
    const selected = {};
    for (const key of keys || []) {
      if (key in source) selected[key] = source[key];
    }
    return selected;
  }

  globalThis.document = {
    documentElement: { style: { setProperty() {} } },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.chrome = {
    storage: {
      sync: {
        async get(keys) { return selectKeys(syncData, keys); },
        async set(payload) {
          if (failSyncWrites) throw new Error("sync unavailable");
          Object.assign(syncData, payload);
        },
      },
      local: {
        async get(keys) { return selectKeys(localData, keys); },
        async set(payload) { Object.assign(localData, payload); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key];
        },
      },
    },
    windows: {
      async getCurrent() { return {}; },
      async update() {},
      onBoundsChanged: { addListener() {} },
    },
  };

  const prefs = await import("../player/prefs.js");
  const { state } = await import("../player/state.js");

  prefs.queueSavePrefs({ volume: 42 });
  await prefs.flushSavePrefs();
  assert.equal(syncData.volume, 10, "failed sync must leave the old sync value unchanged");
  assert.equal(localData.syncPrefsFallback.volume, 42);

  await prefs.loadAndApplyPrefs();
  assert.equal(state.volume, 42, "local fallback must override stale sync data");

  failSyncWrites = false;
  await prefs.loadAndApplyPrefs();
  assert.equal(syncData.volume, 42, "a later read retries the failed sync write");
  assert.equal(localData.syncPrefsFallback, undefined);

  // Values written directly to local storage by the old implementation are
  // treated as fallback data and migrated on the next successful sync.
  syncData.volume = 12;
  localData.volume = 33;
  await prefs.loadAndApplyPrefs();
  assert.equal(state.volume, 33);
  assert.equal(syncData.volume, 33);
  assert.equal(localData.volume, undefined);

  prefs.queueSavePrefs({ volume: 55 });
  await prefs.flushSavePrefs();
  assert.equal(syncData.volume, 55);
  assert.equal(localData.syncPrefsFallback, undefined);
});
