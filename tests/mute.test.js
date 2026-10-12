import test from "node:test";
import assert from "node:assert/strict";

test("content controls mute without destroying the preamp volume", async () => {
  const video = {
    currentTime: 12,
    duration: 60,
    paused: false,
    volume: 0.72,
    muted: false,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
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
  const {
    adjustVolume,
    setMuted,
    setVolume,
    togglePlayPause,
  } = await import("../content-script/player-controls.js");

  setVolume(38);
  setMuted(true);
  assert.equal(video.volume, 0.38);
  assert.equal(video.muted, true);

  setMuted(false);
  assert.equal(video.volume, 0.38, "unmute must preserve the pre-mute volume");
  assert.equal(video.muted, false);
  assert.ok(messages.some((message) => message.type === "PLAYER_INFO" && message.muted));

  adjustVolume(5);
  assert.equal(video.volume, 0.43);
  adjustVolume(-100);
  assert.equal(video.volume, 0);

  togglePlayPause();
  assert.equal(video.paused, true);
  togglePlayPause();
  assert.equal(video.paused, false);
});
