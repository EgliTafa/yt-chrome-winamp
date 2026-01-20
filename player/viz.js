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

  // draw in CSS pixels
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
    // We'll draw symmetric pairs around the center.
    // Pair count = floor(n/2). If odd, the "center" bar (last) goes in the middle.
    const n = bars.length;
    const pairCount = Math.floor(n / 2);
    const hasCenterBar = n % 2 === 1;

    // Visual layout:
    // [left ... center ... right]
    // totalBarsToDraw = pairCount*2 + (hasCenterBar ? 1 : 0)
    const total = pairCount * 2 + (hasCenterBar ? 1 : 0);

    if (peakBars.length !== total) peakBars = new Array(total).fill(0);

    const gap = 2;
    const barW = Math.max(1, Math.floor((W - (total - 1) * gap) / total));

    // Determine the center bar index in the drawn layout
    const centerIdx = Math.floor(total / 2);

    // Helper to draw one bar at "drawIndex" using value "v01"
    function drawOne(drawIndex, v01) {
      const barH = Math.floor(v01 * H);
      const x = drawIndex * (barW + gap);
      const y = H - barH;

      ctx.fillStyle = "#00ff66";
      ctx.fillRect(x, y, barW, barH);

      const nextPeak = Math.max(barH, peakBars[drawIndex] - 1);
      peakBars[drawIndex] = nextPeak;

      ctx.fillStyle = "#aaffcc";
      ctx.fillRect(x, H - peakBars[drawIndex], barW, 2);
    }

    // Draw center bar if odd
    if (hasCenterBar) {
      const v = (bars[0] ?? 0) / 255; // pick a stable source for center
      drawOne(centerIdx, v);
    }

    // Now fill outwards from the center:
    // We take pairs from the remaining bars, mapping low->center outward.
    // Strategy:
    // - Use bars starting at index (hasCenterBar ? 1 : 0)
    // - For each "k" from 1..pairCount:
    //     use a bar value and draw it to center-k (left) and center+k (right)
    // This yields “middle first” motion.
    const start = hasCenterBar ? 1 : 0;

    for (let k = 1; k <= pairCount; k++) {
      const srcIdx = start + (k - 1);
      const v = (bars[srcIdx] ?? 0) / 255;

      const leftIdx = centerIdx - k;
      const rightIdx = centerIdx + k;

      if (leftIdx >= 0) drawOne(leftIdx, v);
      if (rightIdx < total) drawOne(rightIdx, v);
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

  try {
    if (send) send("STOP_VIZ");
  } catch (_) {}

  if (raf) cancelAnimationFrame(raf);
  raf = null;
  latestBars = null;
  peakBars = [];

  if (ctx) ctx.clearRect(0, 0, el.visualisationCanvas.width, el.visualisationCanvas.height);
  el.visualisationCanvas.style.display = "none";
}
