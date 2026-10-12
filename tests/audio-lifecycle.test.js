import test from "node:test";
import assert from "node:assert/strict";

test("reuses the audio context and one source per video element", async () => {
  let currentVideo = { id: "video-a" };
  let contextCount = 0;
  let sourceCount = 0;

  class FakeAudioNode {
    connect() {}
    disconnect() {}
  }

  class FakeAnalyser extends FakeAudioNode {
    frequencyBinCount = 32;

    getByteFrequencyData(data) {
      data.fill(24);
    }

    getByteTimeDomainData(data) {
      data.fill(128);
    }
  }

  class FakeAudioContext {
    constructor() {
      contextCount++;
      this.state = "running";
      this.destination = new FakeAudioNode();
    }

    createAnalyser() {
      return new FakeAnalyser();
    }

    createMediaElementSource(video) {
      assert.ok(video);
      sourceCount++;
      return new FakeAudioNode();
    }

    async resume() {
      this.state = "running";
    }
  }

  globalThis.window = {
    location: {
      href: "https://www.youtube.com/watch?v=a",
      pathname: "/watch",
      search: "?v=a",
    },
    AudioContext: FakeAudioContext,
  };
  globalThis.document = {
    querySelector(selector) {
      return selector === "video" ? currentVideo : null;
    },
  };

  const visualiser = await import("../content-script/visualiser.js");

  assert.equal(await visualiser.ensureAudioGraph(), true);
  visualiser.cleanupAudio();
  assert.equal(await visualiser.ensureAudioGraph(), true);
  assert.equal(contextCount, 1, "popup reconnect must reuse the AudioContext");
  assert.equal(sourceCount, 1, "popup reconnect must reuse the media source");

  const firstVideo = currentVideo;
  currentVideo = { id: "video-b" };
  assert.equal(await visualiser.ensureAudioGraph(), true);

  currentVideo = firstVideo;
  assert.equal(await visualiser.ensureAudioGraph(), true);
  assert.equal(contextCount, 1, "SPA navigation must keep one AudioContext");
  assert.equal(sourceCount, 2, "each unique video element gets exactly one source");

  const { state } = await import("../content-script/state.js");
  state.port = { postMessage() {} };
  await visualiser.startVisualiserStream();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.notEqual(state.vizTimer, null, "stream should schedule sampling while connected");

  state.port = null;
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(state.vizTimer, null, "a disconnected stream must clear its restart guard");
});
