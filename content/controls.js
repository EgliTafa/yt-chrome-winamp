// content/controls.js
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});

  function playVideo() {
    const video = CS.getVideoEl();
    const playButton =
      document.querySelector(".ytp-play-button[aria-label*='Play']") ||
      document.querySelector(".ytp-play-button:not(.ytp-pause-button)");

    if (video && video.paused) video.play();
    else if (playButton) playButton.click();

    CS.sendPlayerInfo?.();
  }

  function pauseVideo() {
    const video = CS.getVideoEl();
    const pauseButton =
      document.querySelector(".ytp-play-button.ytp-pause-button") ||
      document.querySelector(".ytp-play-button[aria-label*='Pause']");

    if (video && !video.paused) video.pause();
    else if (pauseButton) pauseButton.click();

    CS.sendPlayerInfo?.();
  }

  function stopVideo() {
    const video = CS.getVideoEl();
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    CS.sendPlayerInfo?.();
  }

  function nextVideo() {
    const nextButton = document.querySelector(".ytp-next-button");
    if (nextButton) {
      nextButton.click();
      setTimeout(() => CS.sendPlayerInfo?.(), 500);
    }
  }

  function previousVideo() {
    const prevButton = document.querySelector(".ytp-prev-button");
    if (prevButton) {
      prevButton.click();
      setTimeout(() => CS.sendPlayerInfo?.(), 500);
    } else {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft" }));
      setTimeout(() => CS.sendPlayerInfo?.(), 500);
    }
  }

  function seekTo(seconds) {
    const video = CS.getVideoEl();
    if (video) {
      video.currentTime = seconds;
      CS.sendPlayerInfo?.();
    }
  }

  function setVolume(value) {
    const video = CS.getVideoEl();
    if (video) {
      video.volume = value / 100;
      CS.sendPlayerInfo?.();
    }
  }

  function setShuffle(enabled) {
    const selectors = [
      ".ytp-shuffle-button",
      "button[aria-label*='Shuffle']",
      "button[title*='Shuffle']",
      ".ytp-button[aria-label*='Shuffle']",
    ];

    let btn = null;
    for (const s of selectors) {
      btn = document.querySelector(s);
      if (btn) break;
    }
    if (!btn) return;

    const isActive =
      btn.classList.contains("ytp-shuffle-button-enabled") ||
      btn.getAttribute("aria-pressed") === "true";

    if (enabled !== isActive) {
      btn.click();
      setTimeout(() => CS.sendPlayerInfo?.(), 300);
    }
  }

  function setLoop(mode) {
    const selectors = [
      ".ytp-repeat-button",
      "button[aria-label*='Loop']",
      "button[aria-label*='Repeat']",
      "button[title*='Loop']",
      "button[title*='Repeat']",
      ".ytp-button[aria-label*='Loop']",
      ".ytp-button[aria-label*='Repeat']",
    ];

    let btn = null;
    for (const s of selectors) {
      btn = document.querySelector(s);
      if (btn) break;
    }
    if (!btn) return;

    const currentMode = CS.getLoopState?.() ?? 0;
    if (currentMode === mode) return;

    let clicksNeeded = 0;
    if (mode === 0) {
      if (currentMode === 1) clicksNeeded = 2;
      else if (currentMode === 2) clicksNeeded = 1;
    } else if (mode === 1) {
      if (currentMode === 0) clicksNeeded = 1;
      else if (currentMode === 2) clicksNeeded = 2;
    } else if (mode === 2) {
      if (currentMode === 0) clicksNeeded = 2;
      else if (currentMode === 1) clicksNeeded = 1;
    }

    for (let i = 0; i < clicksNeeded; i++) {
      setTimeout(() => btn.click(), i * 200);
    }
    setTimeout(() => CS.sendPlayerInfo?.(), clicksNeeded * 200 + 300);
  }

  CS.handleExtensionMessage =
    CS.handleExtensionMessage ||
    ((msg) => {
      if (!msg?.type) return;

      switch (msg.type) {
        case "PLAY":
          playVideo();
          break;
        case "PAUSE":
          pauseVideo();
          break;
        case "STOP":
          stopVideo();
          break;
        case "NEXT":
          nextVideo();
          break;
        case "PREV":
          previousVideo();
          break;
        case "SEEK":
          seekTo(msg.value);
          break;
        case "VOLUME":
          setVolume(msg.value);
          break;
        case "SHUFFLE":
          setShuffle(msg.value);
          break;
        case "LOOP":
          if (typeof msg.value === "number") {
            setLoop(msg.value);
          } else {
            const currentMode = CS.getLoopState?.() ?? 0;
            const nextMode = (currentMode + 1) % 3;
            setLoop(nextMode);
          }
          break;

        case "GET_STATE":
          CS.detectAndSendState?.();
          CS.sendPlayerInfo?.();
          break;

        // viz control
        case "START_VIZ":
          CS.startVisualiserStream?.();
          break;
        case "STOP_VIZ":
          CS.stopVisualiserStream?.();
          break;
      }
    });
})();
