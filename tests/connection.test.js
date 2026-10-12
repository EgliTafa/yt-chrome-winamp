import test from "node:test";
import assert from "node:assert/strict";

class ListenerSet {
  constructor() {
    this.listeners = new Set();
  }

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  emit(value) {
    for (const listener of [...this.listeners]) listener(value);
  }
}

class FakePort {
  constructor(tabId) {
    this.tabId = tabId;
    this.disconnected = false;
    this.onMessage = new ListenerSet();
    this.onDisconnect = new ListenerSet();
    this.messages = [];
  }

  postMessage(message) {
    if (this.disconnected) throw new Error("Port is disconnected");
    this.messages.push(message);
    if (message?.type === "GET_STATE") {
      queueMicrotask(() => {
        if (!this.disconnected) {
          this.onMessage.emit({ type: "YOUTUBE_STATE", hasPlayer: true, videoId: `video-${this.tabId}` });
        }
      });
    }
  }

  disconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
    this.onDisconnect.emit();
  }
}

test("cancels overlapping attempts, switches tabs, and explicitly disconnects", async () => {
  const ports = new Map();
  let resolveFirstReadiness;

  globalThis.document = {
    hidden: false,
    documentElement: { style: { setProperty() {} } },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  globalThis.window = {
    location: { href: "chrome-extension://test/player.html" },
    addEventListener() {},
    dispatchEvent() {},
  };
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async get(tabId) {
        return {
          id: tabId,
          title: `Tab ${tabId}`,
          url: `https://www.youtube.com/watch?v=${tabId}`,
        };
      },
      async query() {
        return [
          { id: 1, title: "First", url: "https://www.youtube.com/watch?v=1", active: false, lastAccessed: 20 },
          { id: 2, title: "Second", url: "https://www.youtube.com/watch?v=2", active: true, lastAccessed: 10 },
          { id: 99, title: "Other", url: "https://example.com", active: true, lastAccessed: 30 },
        ];
      },
      connect(tabId) {
        const port = new FakePort(tabId);
        ports.set(tabId, port);
        return port;
      },
    },
    scripting: {
      async executeScript({ target, func }) {
        if (!func) return [];
        if (target.tabId === 1) {
          return new Promise((resolve) => {
            resolveFirstReadiness = () => resolve([{ result: true }]);
          });
        }
        return [{ result: true }];
      },
    },
    storage: {
      sync: {
        async get() { return {}; },
        async set() {},
      },
      local: {
        async get() { return {}; },
        async set() {},
        async remove() {},
      },
    },
  };

  const connection = await import("../player/connection.js");
  const { state, CONNECTION_PHASES } = await import("../player/state.js");
  const { flushSavePrefs } = await import("../player/prefs.js");

  const availableTabs = await connection.listYoutubeTabs();
  assert.deepEqual(availableTabs.map((tab) => tab.id), [2, 1]);

  const firstAttempt = connection.connectToYouTubeTab({ tabId: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolveFirstReadiness, "function");

  const secondAttempt = connection.connectToYouTubeTab({ tabId: 2 });
  assert.equal(await secondAttempt, true);
  resolveFirstReadiness();
  assert.equal(await firstAttempt, false);
  assert.equal(state.youtubeTabId, 2);
  assert.equal(state.contentPort, ports.get(2));
  assert.equal(state.connectionPhase, CONNECTION_PHASES.CONNECTED);
  assert.equal(state.youtubeTabTitle, "Tab 2");
  assert.ok(
    ports.get(2).messages.some((message) => message.type === "MUTE" && message.value === false),
    "connection must apply the player mute state"
  );

  const secondPort = ports.get(2);
  assert.equal(await connection.connectToYouTubeTab({ tabId: 3 }), true);
  assert.equal(secondPort.disconnected, true, "switching must dispose the previous port");
  assert.equal(state.youtubeTabId, 3);
  assert.equal(state.contentPort, ports.get(3));

  const thirdPort = ports.get(3);
  connection.disconnectFromYouTubeTab();
  assert.equal(thirdPort.disconnected, true);
  assert.equal(state.contentPort, null);
  assert.equal(state.isConnected, false);
  assert.equal(state.userDisconnected, true);
  assert.equal(state.youtubeTabTitle, "");
  assert.equal(state.reconnectTimeout, null);
  assert.equal(state.connectionPhase, CONNECTION_PHASES.DISCONNECTED);

  resolveFirstReadiness = null;
  const cancelledAttempt = connection.connectToYouTubeTab({ tabId: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolveFirstReadiness, "function");
  connection.disconnectFromYouTubeTab();
  resolveFirstReadiness();
  assert.equal(await cancelledAttempt, false);
  assert.equal(state.userDisconnected, true);
  assert.equal(state.reconnectTimeout, null, "user cancellation must not schedule a retry");

  await flushSavePrefs();
});
