export function createAnchor(videoId, title, { current = false } = {}) {
  return {
    textContent: title,
    matches(selector) {
      return selector === "a#video-title" || selector.startsWith("a#video-title[");
    },
    querySelector() {
      return null;
    },
    getAttribute(name) {
      const attributes = {
        href: `/watch?v=${videoId}&list=PL_TEST`,
        title,
        "aria-current": current ? "page" : null,
        "aria-label": title,
      };
      return attributes[name] ?? null;
    },
  };
}

export function createRendererRow(videoId, title, { selected = false, thumbnailUrl = "" } = {}) {
  const anchor = createAnchor(videoId, title);
  const image = thumbnailUrl ? {
    currentSrc: thumbnailUrl,
    matches() { return false; },
    getAttribute(name) {
      return name === "src" ? thumbnailUrl : null;
    },
  } : null;
  return {
    textContent: title,
    matches() {
      return false;
    },
    querySelector(selector) {
      if (image && selector.includes("img")) return image;
      return anchor;
    },
    hasAttribute(name) {
      return name === "selected" && selected;
    },
    classList: {
      contains() {
        return false;
      },
    },
    getAttribute() {
      return null;
    },
  };
}

export function createRoot(selectorToNodes) {
  return {
    querySelectorAll(selector) {
      return selectorToNodes[selector] || [];
    },
  };
}

export function installWatchPanelDocument(root) {
  globalThis.document = {
    querySelector(selector) {
      if (selector === "ytd-watch-flexy ytd-playlist-panel-renderer") return root;
      return null;
    },
  };
}

export function installPlaylistPageDocument(root) {
  globalThis.document = {
    querySelector(selector) {
      if (selector === "ytd-browse[page-subtype='playlist']") return {};
      if (selector === "ytd-browse[page-subtype='playlist'] ytd-playlist-video-list-renderer") {
        return root;
      }
      return null;
    },
  };
}
