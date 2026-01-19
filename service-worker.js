let playerWindowId = null;

chrome.action.onClicked.addListener(async () => {
  await openOrFocusPlayerWindow();
});

async function openOrFocusPlayerWindow() {
  if (playerWindowId != null) {
    try {
      await chrome.windows.update(playerWindowId, { focused: true });
      return;
    } catch {
      playerWindowId = null;
    }
  }

  const w = await chrome.windows.create({
    url: chrome.runtime.getURL("player.html"),
    type: "popup",
    width: 620,
    height: 980
  });
  playerWindowId = w.id;
}

chrome.windows.onRemoved.addListener((winId) => {
  if (winId === playerWindowId) playerWindowId = null;
});
