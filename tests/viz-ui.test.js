import test from "node:test";
import assert from "node:assert/strict";

test("visualizer can become visible from fresh audio data after a stop", async () => {
  const canvas = {
    width: 96,
    height: 24,
    style: { display: "none" },
    title: "",
    getContext() {
      return { clearRect() {} };
    },
  };
  const sent = [];

  globalThis.document = {
    documentElement: { style: { setProperty() {} } },
    querySelector(selector) {
      return selector.includes("visualisation") ? canvas : null;
    },
    querySelectorAll() { return []; },
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  const viz = await import("../player/viz.js");
  viz.initViz({ sendCommand(command) { sent.push(command); } });

  viz.startViz();
  assert.equal(canvas.style.display, "block");
  assert.deepEqual(sent, ["START_VIZ"]);

  viz.stopViz();
  assert.equal(canvas.style.display, "none");

  viz.startViz({ requestStream: false });
  assert.equal(canvas.style.display, "block");
  assert.deepEqual(sent, ["START_VIZ", "STOP_VIZ"]);
  viz.stopViz();
});
