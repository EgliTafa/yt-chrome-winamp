// content/viz.js
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});
  const S = CS.state;
  const { VIZ_FPS_MS, VIZ_BARS_COUNT } = CS.consts;

  async function ensureAudioGraph() {
    const video = CS.getVideoEl();
    if (!video) return false;

    if (!S.audioCtx) {
      S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (S.audioCtx.state === "suspended") {
      try { await S.audioCtx.resume(); } catch (_) {}
    }

    if (!S.analyser) {
      S.analyser = S.audioCtx.createAnalyser();
      S.analyser.fftSize = 2048;
      S.analyser.smoothingTimeConstant = 0.8;
      // keep audio audible
      S.analyser.connect(S.audioCtx.destination);
    }

    if (S.attachedVideoEl !== video) {
      try {
        if (S.sourceNode) {
          try { S.sourceNode.disconnect(); } catch (_) {}
          S.sourceNode = null;
        }
        S.sourceNode = S.audioCtx.createMediaElementSource(video);
        S.sourceNode.connect(S.analyser);
        S.attachedVideoEl = video;
      } catch (e) {
        // reset + retry once
        try { CS.stopVisualiserStream?.(); } catch (_) {}
        try { if (S.audioCtx) { try { S.audioCtx.close(); } catch (_) {} } } catch (_) {}

        S.audioCtx = null;
        S.analyser = null;
        S.sourceNode = null;
        S.attachedVideoEl = null;

        try {
          return await ensureAudioGraph();
        } catch (_) {
          return false;
        }
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

  CS.startVisualiserStream =
    CS.startVisualiserStream ||
    (async () => {
      if (S.vizTimer || !S.port) return;

      const ok = await ensureAudioGraph();
      if (!ok || !S.analyser) return;

      const freq = new Uint8Array(S.analyser.frequencyBinCount);

      S.vizTimer = setInterval(() => {
        if (!S.port || !S.analyser) return;

        // YouTube SPA can replace <video>; re-wire when needed
        if (S.attachedVideoEl !== CS.getVideoEl()) {
          ensureAudioGraph().catch(() => {});
        }

        try {
          S.analyser.getByteFrequencyData(freq);
          const bars = downsampleToBars(freq, VIZ_BARS_COUNT);
          CS.safePost({ type: "AUDIO_DATA", bars });
        } catch (e) {
          CS.stopVisualiserStream?.();
        }
      }, VIZ_FPS_MS);
    });

  CS.stopVisualiserStream =
    CS.stopVisualiserStream ||
    (() => {
      if (S.vizTimer) clearInterval(S.vizTimer);
      S.vizTimer = null;
    });
})();
