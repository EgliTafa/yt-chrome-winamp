// content-script/visualiser.js
import { state, VIZ_BARS_COUNT, VIZ_FPS_MS } from "./state.js";
import { getVideoEl } from "./helpers.js";
import { safePost } from "./helpers.js";

export function cleanupAudio() {
  try { state.sourceNode?.disconnect(); } catch (_) { }
  try { state.analyser?.disconnect(); } catch (_) { }
  try { state.audioCtx?.close(); } catch (_) { }

  state.audioCtx = null;
  state.analyser = null;
  state.sourceNode = null;
  state.attachedVideoEl = null;
}

export async function ensureAudioGraph() {
  const video = getVideoEl();
  if (!video) return false;

  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (state.audioCtx.state === "suspended") {
    try { await state.audioCtx.resume(); } catch (_) { }
  }

  if (!state.analyser) {
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.8;
    state.analyser.connect(state.audioCtx.destination);
  }

  if (state.attachedVideoEl !== video) {
    try {
      try { state.sourceNode?.disconnect(); } catch (_) { }
      state.sourceNode = state.audioCtx.createMediaElementSource(video);
      state.sourceNode.connect(state.analyser);
      state.attachedVideoEl = video;
    } catch (e) {
      // media element source can throw if created multiple times for same element -> rebuild once
      try { stopVisualiserStream(); } catch (_) { }
      try { cleanupAudio(); } catch (_) { }
      try { return await ensureAudioGraph(); } catch (_) { return false; }
    }
  }

  return true;
}

function downsampleToBars(freqData, barsCount = VIZ_BARS_COUNT) {
  const out = new Array(barsCount).fill(0);
  const binSize = Math.floor(freqData.length / barsCount) || 1;

  for (let i = 0; i < barsCount; i++) {
    let sum = 0;
    let count = 0;
    const start = i * binSize;
    const end = Math.min(freqData.length, start + binSize);

    for (let j = start; j < end; j++) {
      sum += freqData[j];
      count++;
    }

    out[i] = count ? Math.round(sum / count) : 0;
  }
  return out;
}

export async function startVisualiserStream() {
  if (state.disabled || state.vizTimer || !state.port) return;

  const ok = await ensureAudioGraph();
  if (!ok || !state.analyser) return;

  const freq = new Uint8Array(state.analyser.frequencyBinCount);

  state.vizTimer = setInterval(() => {
    if (state.disabled || !state.port || !state.analyser) return;

    // YouTube SPA can replace <video>, re-wire when needed
    if (state.attachedVideoEl !== getVideoEl()) {
      ensureAudioGraph().catch(() => { });
    }

    try {
      state.analyser.getByteFrequencyData(freq);
      const bars = downsampleToBars(freq, VIZ_BARS_COUNT);
      safePost({ type: "AUDIO_DATA", bars });
    } catch (e) {
      stopVisualiserStream();
    }
  }, VIZ_FPS_MS);
}

export function stopVisualiserStream() {
  if (state.vizTimer) clearInterval(state.vizTimer);
  state.vizTimer = null;
}
