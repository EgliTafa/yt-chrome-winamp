import test from "node:test";
import assert from "node:assert/strict";

test("uses a fallback thumbnail and preserves a higher-priority scraped image", async () => {
  const listeners = {};
  const image = {
    hidden: true,
    src: "",
    dataset: {},
    addEventListener(type, listener) { listeners[type] = listener; },
    removeAttribute(name) {
      if (name === "src") this.src = "";
    },
  };

  globalThis.document = {
    documentElement: { style: { setProperty() {} } },
    querySelector(selector) {
      return selector === ".now-playing-thumbnail" ? image : null;
    },
    querySelectorAll() { return []; },
  };

  const {
    getDefaultThumbnailUrl,
    setNowPlayingThumbnail,
  } = await import("../player/now-playing.js");

  setNowPlayingThumbnail("abc_123");
  assert.equal(image.hidden, false);
  assert.equal(image.src, "https://i.ytimg.com/vi/abc_123/default.jpg");
  assert.equal(getDefaultThumbnailUrl("bad id"), "");

  setNowPlayingThumbnail("abc_123", "https://i.ytimg.com/vi/abc_123/mqdefault.jpg", 2);
  setNowPlayingThumbnail("abc_123", "", 0);
  assert.equal(image.src, "https://i.ytimg.com/vi/abc_123/mqdefault.jpg");
});
