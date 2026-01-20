// player/viz.js
import { el } from "./dom.js";

const ctx = el.visualisationCanvas ? el.visualisationCanvas.getContext("2d") : null;

let running = false;
let raf = null;
let latestBars = null;
let peakBars = [];
let send = null; // injected

export function initViz({ sendCommand }) {
  send = sendCommand;
}

export function setAudioBars(bars) {
  if (Array.isArray(bars)) latestBars = bars;
}

function setCanvasCrispSize() {
  if (!el.visualisationCanvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = el.visualisationCanvas.getBoundingClientRect();
  const cssW = rect.width || el.visualisationCanvas.width || 96;
  const cssH = rect.height || el.visualisationCanvas.height || 24;

  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));

  if (el.visualisationCanvas.width !== w) el.visualisationCanvas.width = w;
  if (el.visualisationCanvas.height !== h) el.visualisationCanvas.height = h;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  if (!running || !ctx || !el.visualisationCanvas) return;

  setCanvasCrispSize();

  const rect = el.visualisationCanvas.getBoundingClientRect();
  const W = rect.width || 96;
  const H = rect.height || 24;

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const bars = latestBars;
  if (bars && bars.length) {
    const n = bars.length;
    if (peakBars.length !== n) peakBars = new Array(n).fill(0);

    const gap = 2;
    const barW = Math.max(1, Math.floor((W - (n - 1) * gap) / n));

    for (let i = 0; i < n; i++) {
      const v = bars[i] / 255;
      const barH = Math.floor(v * H);
      const x = i * (barW + gap);
      const y = H - barH;

      ctx.fillStyle = "#00ff66";
      ctx.fillRect(x, y, barW, barH);

      const nextPeak = Math.max(barH, peakBars[i] - 1);
      peakBars[i] = nextPeak;

      ctx.fillStyle = "#aaffcc";
      ctx.fillRect(x, H - peakBars[i], barW, 2);
    }
  }

  ctx.restore();
  raf = requestAnimationFrame(draw);
}

export function startViz() {
  if (!el.visualisationCanvas || running) return;
  running = true;
  el.visualisationCanvas.style.display = "block";
  peakBars = [];
  if (send) send("START_VIZ");
  raf = requestAnimationFrame(draw);
}

export function stopViz() {
  if (!el.visualisationCanvas || !running) return;
  running = false;

  try { if (send) send("STOP_VIZ"); } catch (_) {}

  if (raf) cancelAnimationFrame(raf);
  raf = null;
  latestBars = null;
  peakBars = [];

  if (ctx) ctx.clearRect(0, 0, el.visualisationCanvas.width, el.visualisationCanvas.height);
  el.visualisationCanvas.style.display = "none";
}
