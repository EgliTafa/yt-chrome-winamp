// content-script/helpers.js
import { state } from "./state.js";

export function getVideoEl() {
  return document.querySelector("video");
}

export function extractVideoIdFromUrl(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

export function extractVideoIdFromHref(href) {
  if (!href) return null;
  try {
    const q = href.split("?")[1] || "";
    const params = new URLSearchParams(q);
    return params.get("v");
  } catch (_) {
    return null;
  }
}

export function clickLikeUser(target) {
  if (!target) return false;
  try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) { }

  try {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  } catch (_) {
    try { target.click(); return true; } catch (_) { }
  }
  return false;
}

export function safePost(msg) {
  if (state.disabled || !state.port) return;
  try {
    state.port.postMessage(msg);
  } catch (e) {
    const m = String(e?.message || e);
    if (m.includes("Extension context invalidated")) {
      // Will be handled by connection module
      state.disabled = true;
    } else {
      // drop the port (popup will reconnect)
      state.port = null;
    }
  }
}
