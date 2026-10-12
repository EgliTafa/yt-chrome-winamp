import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnchor,
  createRendererRow,
  createRoot,
  installPlaylistPageDocument,
  installWatchPanelDocument,
} from "./fixtures/playlist-surfaces.js";

globalThis.window = {
  location: {
    href: "https://www.youtube.com/watch?v=panel-2&list=PL_TEST",
    pathname: "/watch",
    search: "?v=panel-2&list=PL_TEST",
  },
};
globalThis.document = { querySelector: () => null };

const { scrapePlaylistItems } = await import("../content-script/playlist.js");

test("scrapes the watch-page playlist panel", () => {
  const root = createRoot({
    "ytd-playlist-panel-video-renderer": [
      createRendererRow("panel-1", "Panel One", {
        thumbnailUrl: "https://i.ytimg.com/vi/panel-1/mqdefault.jpg",
      }),
      createRendererRow("panel-2", "Panel Two", { selected: true }),
    ],
  });
  installWatchPanelDocument(root);

  const items = scrapePlaylistItems();
  assert.deepEqual(items.map(({ videoId, title, isCurrent }) => ({ videoId, title, isCurrent })), [
    { videoId: "panel-1", title: "Panel One", isCurrent: false },
    { videoId: "panel-2", title: "Panel Two", isCurrent: true },
  ]);
  assert.equal(items[0].thumbnailUrl, "https://i.ytimg.com/vi/panel-1/mqdefault.jpg");
  assert.equal(items[1].thumbnailUrl, "https://i.ytimg.com/vi/panel-2/default.jpg");
});

test("scrapes the standalone playlist-page listing", () => {
  window.location.href = "https://www.youtube.com/playlist?list=PL_TEST";
  window.location.pathname = "/playlist";
  window.location.search = "?list=PL_TEST";

  const root = createRoot({
    "ytd-playlist-video-renderer": [
      createRendererRow("page-1", "Page One"),
      createRendererRow("page-2", "Page Two"),
    ],
  });
  installPlaylistPageDocument(root);

  const items = scrapePlaylistItems();
  assert.deepEqual(items.map(({ videoId, title }) => ({ videoId, title })), [
    { videoId: "page-1", title: "Page One" },
    { videoId: "page-2", title: "Page Two" },
  ]);
});

test("falls back to unique watch links when renderer tags change", () => {
  const anchors = [
    createAnchor("fallback-1", "Fallback One"),
    createAnchor("fallback-2", "Fallback Two"),
  ];
  const root = createRoot({
    "a#video-title[href*='watch?v=']": anchors,
    "a.yt-simple-endpoint[href*='watch?v=']": anchors,
  });
  installPlaylistPageDocument(root);

  const items = scrapePlaylistItems();
  assert.deepEqual(items.map(({ videoId, title }) => ({ videoId, title })), [
    { videoId: "fallback-1", title: "Fallback One" },
    { videoId: "fallback-2", title: "Fallback Two" },
  ]);
});
