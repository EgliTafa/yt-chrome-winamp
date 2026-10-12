# YT Winamp Playlist Player

Winamp-inspired Chrome extension popup for controlling YouTube playback, playlists, and visualizer data.

## Features

- Connects to the active YouTube tab and controls play/pause/seek/volume.
- Reads playlist items from YouTube and supports jump-to-track.
- Streams compact audio data from the content script for popup visualization.
- Handles YouTube SPA navigation with reconnect and refresh logic.
- Persists volume, visualizer mode, playlist collapse, sort order, last YouTube tab, and window bounds via `chrome.storage`.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root folder.

## Usage

1. Open a YouTube video or playlist tab.
2. Open the extension popup/player window.
3. Click **CONNECT** if not auto-connected.
4. Use transport controls and playlist search/jump.

## Manual QA Checklist

- Connect to active YouTube tab and verify status updates.
- Play/pause/next/prev/seek/volume all update UI state.
- Navigate between videos in same YouTube tab; control remains functional.
- Playlist items populate, filter by search, and jump to selected item.
- Visualizer starts during playback and stops when paused/stopped.
- Disconnect/reconnect flow recovers after tab refresh.

## Accessibility Notes

- Popup controls include explicit accessible labels.
- Playlist entries are keyboard-activatable (Enter/Space).
- Focus-visible styling is enabled for keyboard navigation.

## Release Checklist

- Update `manifest.json` version.
- Run CI checks and manual QA checklist.
- Reload unpacked extension and verify critical flows.
- Tag release in git with the matching manifest version.
