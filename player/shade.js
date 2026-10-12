import { el } from "./dom.js";
import { state } from "./state.js";

export function applyShadeModeUI(enabled) {
  const isShadeMode = !!enabled;
  state.shadeMode = isShadeMode;

  document.body?.classList?.toggle("shade-mode", isShadeMode);

  if (!el.shadeToggleBtn) return;
  const action = isShadeMode ? "Exit shade mode" : "Enter shade mode";
  el.shadeToggleBtn.textContent = isShadeMode ? "▾" : "▴";
  el.shadeToggleBtn.title = action;
  el.shadeToggleBtn.setAttribute("aria-label", action);
  el.shadeToggleBtn.setAttribute("aria-pressed", String(isShadeMode));
}
