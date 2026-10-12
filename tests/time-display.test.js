import test from "node:test";
import assert from "node:assert/strict";

test("formats elapsed, remaining, and hour-long playback times", async () => {
  globalThis.document = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };

  const { fmtTime, formatTimeDisplay } = await import("../player/status.js");

  assert.equal(fmtTime(192), "03:12");
  assert.equal(fmtTime(3906), "1:05:06");
  assert.equal(formatTimeDisplay(192, 2706, "elapsed"), "03:12 / 45:06");
  assert.equal(formatTimeDisplay(192, 2706, "remaining"), "-41:54 / 45:06");
});
