// player/status.js
import { el } from "./dom.js";

export function setStatus(t) {
  if (el.statusText) el.statusText.textContent = t ?? "";
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function setHighlighted(btn, on) {
  if (!btn) return;
  btn.classList.toggle("highlighted", !!on);
}
