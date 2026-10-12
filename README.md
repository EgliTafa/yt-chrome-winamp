# YT Winamp Playlist Player

Winamp-inspired Chrome extension popup for controlling YouTube playback, playlists, and visualizer data.

## Features

- Lists open YouTube tabs and supports explicit connect, switch, and disconnect actions.
- Reads playlist items from YouTube and supports jump-to-track.
- Streams compact audio data from the content script for popup visualization.
- Handles YouTube SPA navigation with reconnect and refresh logic.
- Persists volume, visualizer mode, playlist collapse, sort order, last YouTube tab, and window bounds via `chrome.storage`, with a retryable local fallback for failed sync writes.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root folder.

## Usage

1. Open one or more YouTube video or playlist tabs.
2. Open the extension popup/player window.
3. Choose a tab from the selector and click **CONNECT** or **SWITCH**.
4. Click **DISCONNECT** to stop reconnect attempts and release the active port.
5. Use transport controls and playlist search/jump.

## Manual QA Checklist

- Select each available YouTube tab and verify connect/switch status updates.
- Disconnect during connection and after connection; verify no automatic retry occurs.
- Start two connection attempts quickly; verify only the latest selected tab connects.
- Play/pause/next/prev/seek/volume all update UI state.
- Navigate between videos in same YouTube tab; control remains functional.
- Playlist items populate, filter by search, and jump to selected item.
- Visualizer starts during playback and stops when paused/stopped.
- Disconnect/reconnect flow recovers after tab refresh.
- Force `chrome.storage.sync.set()` to fail, restart the player, and verify locally journaled preferences restore and later resync.

## Accessibility Notes

- Popup controls include explicit accessible labels.
- Playlist entries are keyboard-activatable (Enter/Space).
- Focus-visible styling is enabled for keyboard navigation.

## Release Checklist

- Update `manifest.json` version.
- Run CI checks and manual QA checklist.
- Reload unpacked extension and verify critical flows.
- Tag release in git with the matching manifest version.
