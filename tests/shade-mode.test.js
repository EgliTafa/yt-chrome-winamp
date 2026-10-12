import test from "node:test";
import assert from "node:assert/strict";

test("shade mode updates its UI, persists, and keeps separate window bounds", async () => {
  const bodyClasses = new Set();
  const buttonAttributes = {};
  const shadeButton = {
    textContent: "",
    title: "",
    setAttribute(name, value) {
      buttonAttributes[name] = value;
    },
  };
  const syncData = {};
  const localData = {};
  const windowUpdates = [];
  let currentWindow = { id: 7, left: 20, top: 30, width: 620, height: 720 };

  function selectKeys(source, keys) {
    const selected = {};
    for (const key of keys || []) {
      if (key in source) selected[key] = source[key];
    }
    return selected;
  }

  globalThis.document = {
    body: {
      classList: {
        toggle(name, enabled) {
          if (enabled) bodyClasses.add(name);
          else bodyClasses.delete(name);
        },
      },
    },
    documentElement: { style: { setProperty() {} } },
    querySelector(selector) {
      return selector === ".shade-toggle-btn" ? shadeButton : null;
    },
    querySelectorAll() { return []; },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.chrome = {
    storage: {
      sync: {
        async get(keys) { return selectKeys(syncData, keys); },
        async set(payload) { Object.assign(syncData, payload); },
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
      async getCurrent() { return { ...currentWindow }; },
      async update(_windowId, update) {
        windowUpdates.push(update);
        currentWindow = { ...currentWindow, ...update };
      },
      onBoundsChanged: { addListener() {} },
    },
  };

  const { state } = await import("../player/state.js");
  const { applyShadeModeUI } = await import("../player/shade.js");
  const prefs = await import("../player/prefs.js");

  applyShadeModeUI(false);
  await prefs.saveWindowBoundsFromResize();
  assert.equal(localData.windowBounds.height, 720);

  currentWindow = { ...currentWindow, height: 190 };
  applyShadeModeUI(true);
  await prefs.saveWindowBoundsFromResize();
  prefs.saveShadeModePref(true);
  await prefs.flushSavePrefs();

  assert.equal(state.shadeMode, true);
  assert.equal(bodyClasses.has("shade-mode"), true);
  assert.equal(shadeButton.textContent, "▾");
  assert.equal(buttonAttributes["aria-pressed"], "true");
  assert.equal(syncData.shadeMode, true);
  assert.equal(localData.shadeWindowBounds.height, 190);
  assert.equal(localData.windowBounds.height, 720);

  applyShadeModeUI(false);
  const restored = await prefs.restoreWindowBoundsForMode(false);
  assert.equal(restored, true);
  assert.equal(windowUpdates.at(-1).height, 720);
  assert.equal(bodyClasses.has("shade-mode"), false);
  assert.equal(buttonAttributes["aria-label"], "Enter shade mode");
});
