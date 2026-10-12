import test from "node:test";
import assert from "node:assert/strict";

test("content controls mute without destroying the preamp volume", async () => {
  const video = {
    currentTime: 12,
    duration: 60,
    paused: false,
    volume: 0.72,
    muted: false,
  };
  const messages = [];

  globalThis.window = {
    location: {
      href: "https://www.youtube.com/watch?v=test",
      pathname: "/watch",
      search: "?v=test",
    },
  };
  globalThis.document = {
    querySelector(selector) {
      return selector === "video" ? video : null;
    },
  };

  const { state } = await import("../content-script/state.js");
  state.port = { postMessage(message) { messages.push(message); } };
  const { setMuted, setVolume } = await import("../content-script/player-controls.js");

  setVolume(38);
  setMuted(true);
  assert.equal(video.volume, 0.38);
  assert.equal(video.muted, true);

  setMuted(false);
  assert.equal(video.volume, 0.38, "unmute must preserve the pre-mute volume");
  assert.equal(video.muted, false);
  assert.ok(messages.some((message) => message.type === "PLAYER_INFO" && message.muted));
});
