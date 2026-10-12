// player/status.js
import { el } from "./dom.js";

export function setStatus(t) {
  if (el.statusText) el.statusText.textContent = t ?? "";
}

export function fmtTime(seconds) {
  const numericSeconds = Number(seconds);
  const s = Number.isFinite(numericSeconds)
    ? Math.max(0, Math.floor(numericSeconds))
    : 0;
  const hours = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTimeDisplay(currentTime, duration, mode = "elapsed") {
  const rawCurrent = Number(currentTime);
  const rawTotal = Number(duration);
  const current = Number.isFinite(rawCurrent) ? Math.max(0, rawCurrent) : 0;
  const total = Number.isFinite(rawTotal) ? Math.max(0, rawTotal) : 0;
  const shown = mode === "remaining" ? Math.max(0, total - current) : current;
  const prefix = mode === "remaining" ? "-" : "";
  return `${prefix}${fmtTime(shown)} / ${fmtTime(total)}`;
}

export function updateTimeDisplay(currentTime, duration, mode = "elapsed") {
  if (!el.timeDisplayer) return;
  el.timeDisplayer.textContent = formatTimeDisplay(currentTime, duration, mode);
  el.timeDisplayer.title = mode === "remaining"
    ? "Showing remaining time. Click for elapsed time."
    : "Showing elapsed time. Click for remaining time.";
  el.timeDisplayer.setAttribute(
    "aria-label",
    `${mode === "remaining" ? "Remaining" : "Elapsed"} time ${el.timeDisplayer.textContent}. Click to toggle.`
  );
}

export function setHighlighted(btn, on) {
  if (!btn) return;
  btn.classList.toggle("highlighted", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}
