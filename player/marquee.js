// player/marquee.js
import { el } from "./dom.js";

let lastTitle = "";
let scheduled = false;

export function setTrackTitle(title) {
  if (!el.trackTitleMarquee || !el.trackTitleInner || !el.trackTitleTextA || !el.trackTitleTextB) return;

  const next = title || "YouTube Player";
  if (next === lastTitle) return;
  lastTitle = next;

  el.trackTitleTextA.textContent = next;
  el.trackTitleTextB.textContent = next;

  scheduleUpdate();
}

export function scheduleUpdate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scheduled = false;
      updateMarquee();
    });
  });
}

export function updateMarquee() {
  if (!el.trackTitleMarquee || !el.trackTitleInner || !el.trackTitleTextA) return;

  el.trackTitleMarquee.classList.remove("scrolling");
  el.trackTitleMarquee.style.removeProperty("--marquee-duration");
  el.trackTitleMarquee.style.removeProperty("--marquee-shift");
  el.trackTitleInner.style.transform = "translateX(0)";
  void el.trackTitleInner.offsetWidth;

  const containerW = el.trackTitleMarquee.clientWidth;
  const textW = el.trackTitleTextA.scrollWidth;

  if (textW <= containerW - 8) return;

  const gap = 40;
  const shift = textW + gap;
  const pxPerSec = 45;
  const duration = Math.max(6, shift / pxPerSec);

  el.trackTitleMarquee.style.setProperty("--marquee-gap", `${gap}px`);
  el.trackTitleMarquee.style.setProperty("--marquee-shift", `${shift}px`);
  el.trackTitleMarquee.style.setProperty("--marquee-duration", `${duration}s`);
  el.trackTitleMarquee.classList.add("scrolling");
}
