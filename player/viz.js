// player/viz.js
import { el } from "./dom.js";

const ctx = el.visualisationCanvas ? el.visualisationCanvas.getContext("2d") : null;

let running = false;
let raf = null;

// incoming data
let latestBars = null;     // 0..255 length VIZ_BARS_COUNT
let latestWave = null;     // 0..255 length WAVE_POINTS_COUNT (e.g. 96)

// peaks
let peakBars = [];

// injected send fn
let send = null;

// 0 = classic symmetric (your current), 1 = left->right spectrum, 2 = waveform
let vizMode = 0;
const MODE_NAMES = ["CLASSIC", "SPECTRUM", "WAVE"];

export function initViz({ sendCommand }) {
  send = sendCommand;
}

export function getVizMode() {
  return vizMode;
}

export function getVizModeName() {
  return MODE_NAMES[vizMode] || "UNKNOWN";
}

export function setVizMode(mode) {
  vizMode = ((mode % 3) + 3) % 3;
  // reset peaks so switching feels clean
  peakBars = [];
}

export function cycleVizMode() {
  setVizMode(vizMode + 1);
}

export function setAudioBars(bars) {
  if (Array.isArray(bars)) latestBars = bars;
}

export function setWaveformPoints(points) {
  if (Array.isArray(points)) latestWave = points;
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

function clearBg(W, H) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawBarsLeftToRight(bars, W, H) {
  const n = bars.length;
  if (!n) return;

  if (peakBars.length !== n) peakBars = new Array(n).fill(0);

  const gap = 2;
  const barW = Math.max(1, Math.floor((W - (n - 1) * gap) / n));

  for (let i = 0; i < n; i++) {
    const v01 = (bars[i] ?? 0) / 255;
    const barH = Math.floor(v01 * H);
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

// This is your current algorithm (kept as-is for mode 0)
function drawBarsClassicSymmetric(bars, W, H) {
  const n = bars.length;
  if (!n) return;

  const pairCount = Math.floor(n / 2);
  const hasCenterBar = n % 2 === 1;
  const total = pairCount * 2 + (hasCenterBar ? 1 : 0);

  if (peakBars.length !== total) peakBars = new Array(total).fill(0);

  const gap = 2;
  const barW = Math.max(1, Math.floor((W - (total - 1) * gap) / total));
  const centerIdx = Math.floor(total / 2);

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

  if (hasCenterBar) {
    const v = (bars[0] ?? 0) / 255;
    drawOne(centerIdx, v);
  }

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

function drawWaveform(points, W, H) {
  const n = points.length;
  if (!n) return;

  const midY = H / 2;
  const stepX = n > 1 ? W / (n - 1) : W;

  // --- Auto-gain: scale small signals up so they are visible ---
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const v = points[i] ?? 128;          // 0..255
    const norm = (v - 128) / 128;        // -1..1
    const a = Math.abs(norm);
    if (a > maxAbs) maxAbs = a;
  }

  // Avoid crazy amplification + avoid flatline
  const floor = 0.06;                    // treat anything smaller as "quiet"
  const effective = Math.max(maxAbs, floor);

  // Target ~90% of available height
  let gain = 0.9 / effective;            // bigger when quiet
  gain = Math.min(Math.max(gain, 1), 8); // clamp 1..8

  const amp = (H * 0.45) * gain;

  ctx.save();
  ctx.strokeStyle = "#00ff66";
  ctx.lineWidth = 2;                     // thicker helps at small heights
  ctx.beginPath();

  for (let i = 0; i < n; i++) {
    const v = points[i] ?? 128;
    const norm = (v - 128) / 128;
    const y = midY - norm * amp;
    const x = i * stepX;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();

  // center line (subtle)
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "#aaffcc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(W, midY);
  ctx.stroke();

  ctx.restore();
}

function draw() {
  if (!running || !ctx || !el.visualisationCanvas) return;

  setCanvasCrispSize();

  const rect = el.visualisationCanvas.getBoundingClientRect();
  const W = rect.width || 96;
  const H = rect.height || 24;

  clearBg(W, H);

  if (vizMode === 2) {
    if (latestWave && latestWave.length) drawWaveform(latestWave, W, H);
  } else {
    const bars = latestBars;
    if (bars && bars.length) {
      if (vizMode === 1) drawBarsLeftToRight(bars, W, H);
      else drawBarsClassicSymmetric(bars, W, H);
    }
  }

  raf = requestAnimationFrame(draw);
}

export function startViz() {
  if (!el.visualisationCanvas || running) return;
  running = true;

  el.visualisationCanvas.style.display = "block";
  el.visualisationCanvas.style.cursor = "pointer";
  el.visualisationCanvas.title = "Click to change visualizer";

  peakBars = [];

  if (send) send("START_VIZ");
  raf = requestAnimationFrame(draw);
}

export function stopViz() {
  if (!el.visualisationCanvas || !running) return;
  running = false;

  try {
    if (send) send("STOP_VIZ");
  } catch (_) { }

  if (raf) cancelAnimationFrame(raf);
  raf = null;

  latestBars = null;
  latestWave = null;
  peakBars = [];

  if (ctx) ctx.clearRect(0, 0, el.visualisationCanvas.width, el.visualisationCanvas.height);
  el.visualisationCanvas.style.display = "none";
}
