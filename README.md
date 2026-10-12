# YT Winamp Playlist Player

Winamp-inspired Chrome extension popup for controlling YouTube playback, playlists, and visualizer data.

## Features

- Lists open YouTube tabs, remembers the last selection, and supports explicit connect, instant switch, and disconnect actions.
- Reads playlist items from YouTube and supports jump-to-track.
- Shows the current video's thumbnail beside the title, using the playlist image when available and a YouTube thumbnail fallback otherwise.
- Provides a playlist recovery hint and opens the standalone YouTube playlist page when the watch-panel listing is unavailable.
- Streams compact audio data from the content script for popup visualization.
- Provides one-click mute with pre-mute volume restore and a clickable elapsed/remaining time display.
- Provides a Winamp-style shade mode that keeps the marquee, visualizer, volume, time, and playback controls visible while hiding the connection and playlist workspace.
- Routes global play/pause, next, previous, volume-up, and volume-down commands to the saved YouTube tab (or the audible YouTube tab as fallback).
- Handles YouTube SPA navigation with reconnect and refresh logic.
- Persists volume/mute, time display mode, visualizer mode, playlist collapse, shade mode, sort order, last YouTube tab, and separate full/compact window bounds via `chrome.storage`, with a retryable local fallback for failed sync writes.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root folder.

## Usage

1. Open one or more YouTube video or playlist tabs.
2. Open the extension popup/player window.
3. Choose a tab from the selector and click **CONNECT**. Selecting another tab while connected switches immediately; the connected-tab status also opens the picker.
4. Click **DISCONNECT** to stop reconnect attempts and release the active port.
5. Use transport controls and playlist search/jump.
6. If the playlist is not visible, click **SHOW PLAYLIST ON YOUTUBE**, then select the opened playlist tab.
7. Click the arrow in the top-right corner to enter or exit compact shade mode.

## Global shortcuts

- Play/pause: `Ctrl+Shift+7`
- Next: `Ctrl+Shift+8`
- Previous: `Ctrl+Shift+9`
- Volume up/down commands are included but intentionally unbound. Assign them—and remap the other commands to media keys if preferred—at `chrome://extensions/shortcuts`.

Chrome permits many extension commands but only four suggested shortcuts, so the two volume commands are left as a pair for the user to bind.

## Manual QA Checklist

- Select each available YouTube tab and verify the `Connected: <tab title>` control updates and switches tabs.
- Disconnect during connection and after connection; verify no automatic retry occurs.
- Start two connection attempts quickly; verify only the latest selected tab connects.
- Play/pause/next/prev/seek/volume/mute all update UI state; unmute restores the pre-mute volume.
- Click the time display and verify it toggles between elapsed and remaining time.
- Navigate between videos in same YouTube tab; control remains functional.
- Playlist items populate, filter by search, and jump to selected item.
- Verify the now-playing thumbnail changes between videos and falls back cleanly if a scraped image fails.
- Hide/collapse the YouTube watch-page playlist panel, verify the recovery hint appears, then open and connect to the standalone playlist page.
- Trigger each configured shortcut while Chrome is unfocused and verify it controls the saved tab without disconnecting the player window.
- Visualizer starts during playback, stops when paused/stopped, and returns after disconnect/reconnect.
- Enter shade mode, resize or reopen the player, and verify the compact preference and size return; exit shade mode and verify the prior full-player bounds return.
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
