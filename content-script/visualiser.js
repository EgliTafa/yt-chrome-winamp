// content-script/visualiser.js
import { state, VIZ_BARS_COUNT } from "./state.js";
import { getVideoEl } from "./helpers.js";
import { safePost } from "./helpers.js";

function clearVizRetryTimer() {
  if (state.vizRetryTimer) {
    clearTimeout(state.vizRetryTimer);
    state.vizRetryTimer = null;
  }
}

export function cleanupAudio() {
  clearVizRetryTimer();

  // Deliberately keep the graph alive for the lifetime of this page.
  // Browsers allow only one MediaElementAudioSourceNode per media element;
  // closing the context and clearing sourceNode makes a later popup reconnect
  // attempt createMediaElementSource(video) for the same element and throw.
  // Stopping the sampling timer is enough: an idle analyser does no polling,
  // while retaining the graph also keeps the video's audio routed correctly.
}

export async function ensureAudioGraph() {
  if (state.audioInitPromise) return state.audioInitPromise;

  state.audioInitPromise = (async () => {
    const video = getVideoEl();
    if (!video) return false;

    if (!state.audioCtx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return false;

      try {
        state.audioCtx = new AudioContextCtor();
      } catch (_) {
        return false;
      }
    }

    // A closed context cannot be repaired for an element that was already
    // associated with one of its source nodes. Do not create a second context.
    if (state.audioCtx.state === "closed") return false;

    if (state.audioCtx.state === "suspended") {
      try { await state.audioCtx.resume(); } catch (_) { }
    }

    if (!state.analyser) {
      try {
        state.analyser = state.audioCtx.createAnalyser();
        state.analyser.fftSize = 2048;
        state.analyser.smoothingTimeConstant = 0.8;
        state.analyser.connect(state.audioCtx.destination);
      } catch (_) {
        return false;
      }
    }

    if (state.attachedVideoEl !== video) {
      try {
        // YouTube can replace its <video> during SPA navigation. Disconnect
        // the old node, but keep it in the WeakMap in case that element returns.
        try { state.sourceNode?.disconnect(); } catch (_) { }

        let sourceNode = state.mediaElementSources.get(video);
        if (!sourceNode) {
          sourceNode = state.audioCtx.createMediaElementSource(video);
          state.mediaElementSources.set(video, sourceNode);
        }

        sourceNode.connect(state.analyser);
        state.sourceNode = sourceNode;
        state.attachedVideoEl = video;
      } catch (_) {
        // Retrying createMediaElementSource() with another context can mute the
        // video and still fails for an already-associated element. Leave the
        // existing graph untouched and retry only when YouTube exposes a new
        // video element.
        return false;
      }
    }

    return true;
  })();

  try {
    return await state.audioInitPromise;
  } finally {
    state.audioInitPromise = null;
  }
}

function downsampleToWavePoints(timeData, pointsCount = 96) {
  const out = new Array(pointsCount).fill(128);
  const step = Math.floor(timeData.length / pointsCount) || 1;

  for (let i = 0; i < pointsCount; i++) {
    out[i] = timeData[Math.min(timeData.length - 1, i * step)] ?? 128;
  }
  return out;
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
  clearVizRetryTimer();

  const ok = await ensureAudioGraph();
  if (!ok || !state.analyser) {
    // Player/video can be briefly unavailable during SPA transitions.
    // Retry soon so popup does not stay in a black "started but no data" state.
    if (state.vizRetryTimer) return;
    state.vizRetryTimer = setTimeout(() => {
      state.vizRetryTimer = null;
      if (!state.disabled && !state.vizTimer && state.port) {
        startVisualiserStream().catch(() => { });
      }
    }, 400);
    return;
  }

  const MIN_FRAME_MS = 16; // ~60 FPS ceiling
  const MAX_FRAME_MS = 33; // ~30 FPS floor
  let targetFrameMs = 20;
  let lastTick = performance.now();
  const freq = new Uint8Array(state.analyser.frequencyBinCount);
  const time = new Uint8Array(state.analyser.fftSize); // time domain

  const tick = () => {
    if (state.disabled || !state.port || !state.analyser) return;

    if (state.attachedVideoEl !== getVideoEl()) {
      ensureAudioGraph().catch(() => { });
    }

    if (!state.port) {
      stopVisualiserStream();
      cleanupAudio();
      return;
    }

    try {
      const tickStart = performance.now();

      state.analyser.getByteFrequencyData(freq);
      state.analyser.getByteTimeDomainData(time);

      const bars = downsampleToBars(freq, VIZ_BARS_COUNT);
      const wave = downsampleToWavePoints(time, 96);

      safePost({ type: "AUDIO_DATA", bars, wave });

      const workMs = performance.now() - tickStart;
      // Adaptively move between 30-60 FPS based on processing cost.
      if (workMs > 8) targetFrameMs = Math.min(MAX_FRAME_MS, targetFrameMs + 2);
      else if (workMs < 4) targetFrameMs = Math.max(MIN_FRAME_MS, targetFrameMs - 1);
    } catch (e) {
      stopVisualiserStream();
      return;
    }

    const now = performance.now();
    const elapsed = now - lastTick;
    lastTick = now;

    // Keep stable pacing even if the current tick ran long.
    const delay = Math.max(0, targetFrameMs - elapsed);
    state.vizTimer = setTimeout(tick, delay);
  };

  state.vizTimer = setTimeout(tick, 0);
}

export function stopVisualiserStream() {
  clearVizRetryTimer();
  if (state.vizTimer) clearTimeout(state.vizTimer);
  state.vizTimer = null;
}
