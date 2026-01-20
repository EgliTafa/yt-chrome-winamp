// content-script.js (MAIN entry)
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});
  const S = CS.state;

  // Prevent duplicate bootstraps if injected multiple times
  if (CS.__bootstrapped) return;
  CS.__bootstrapped = true;

  CS.log?.("Content script bootstrapped");

  chrome.runtime.onConnect.addListener((connectedPort) => {
    if (connectedPort.name !== "youtube-content") return;

    CS.log?.("Extension connecting...");
    S.port = connectedPort;

    connectedPort.onDisconnect.addListener(() => {
      CS.log?.("Extension disconnected");
      S.port = null;
      CS.stopVisualiserStream?.();
    });

    connectedPort.onMessage.addListener((msg) => {
      CS.handleExtensionMessage?.(msg);
    });

    CS.detectAndSendState?.();
    setTimeout(() => {
      if (S.port) CS.sendPlayerInfo?.();
    }, 300);

    setTimeout(() => CS.startMonitoring?.(), 500);
  });

  if (window.location.hostname.includes("youtube.com")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(() => CS.startMonitoring?.(), 800));
    } else {
      setTimeout(() => CS.startMonitoring?.(), 800);
    }
  }
})();
