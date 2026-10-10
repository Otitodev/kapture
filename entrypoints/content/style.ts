/**
 * Styles for in-page overlays. They live in a shadow root, so the host page cannot
 * restyle them. Overlay chrome is always dark (as in the design) because it sits on
 * a dimmed page, whatever the user's theme.
 */
export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  position: fixed; inset: 0; z-index: 2147483647;
  font: 400 13px/18px system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #efefe4; user-select: none; -webkit-user-select: none;
  cursor: crosshair; touch-action: none;
}
.dim { position: absolute; background: rgba(0, 0, 0, 0.55); pointer-events: none; }
.guide { position: absolute; background: rgba(239, 239, 228, 0.5); pointer-events: none; }
.guide.v { top: 0; bottom: 0; width: 1px; }
.guide.h { left: 0; right: 0; height: 1px; }
.sel { position: absolute; border: 1px solid #efefe4; cursor: move; }
.sel.element { border-width: 2px; }
.handle { position: absolute; width: 8px; height: 8px; background: #efefe4; }
.handle[data-h='nw'] { left: -5px; top: -5px; cursor: nwse-resize; }
.handle[data-h='n']  { left: calc(50% - 4px); top: -5px; cursor: ns-resize; }
.handle[data-h='ne'] { right: -5px; top: -5px; cursor: nesw-resize; }
.handle[data-h='e']  { right: -5px; top: calc(50% - 4px); cursor: ew-resize; }
.handle[data-h='se'] { right: -5px; bottom: -5px; cursor: nwse-resize; }
.handle[data-h='s']  { left: calc(50% - 4px); bottom: -5px; cursor: ns-resize; }
.handle[data-h='sw'] { left: -5px; bottom: -5px; cursor: nesw-resize; }
.handle[data-h='w']  { left: -5px; top: calc(50% - 4px); cursor: ew-resize; }
.pill {
  position: absolute; display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 8px;
  background: #181818; border-radius: 4px; pointer-events: none; white-space: nowrap;
  font: 400 12px/16px ui-monospace, 'Cascadia Mono', Menlo, monospace;
}
.hint {
  position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; justify-content: center; gap: 10px;
  min-width: 300px; height: 36px; padding: 0 16px; background: #181818; border-radius: 6px;
  pointer-events: none; white-space: nowrap;
}
.hint .muted { color: #909090; }
.hint kbd { font: 400 12px/16px ui-monospace, 'Cascadia Mono', Menlo, monospace; color: #909090; }
.bar {
  position: absolute; display: flex; align-items: center; gap: 4px; padding: 4px;
  background: #1f1f1f; border: 1px solid #333; border-radius: 6px; cursor: default;
}
.bar button {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 28px; padding: 0 12px;
  border-radius: 4px; font: 500 13px/18px system-ui, -apple-system, 'Segoe UI', sans-serif; color: #efefe4; cursor: pointer;
}
.bar button:hover { background: #2a2a2a; }
.bar button.primary { background: #efefe4; color: #181818; }
.bar button.primary:hover { background: #fff; }
.bar button:focus-visible { outline: 2px solid #efefe4; outline-offset: 1px; }
.hidden { display: none !important; }

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647;
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  background: #1f1f1f; color: #efefe4; border: 1px solid #333; border-radius: 6px;
  font: 500 13px/18px system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.toast.error { border-color: #ff5a4f; }
.toast button { all: unset; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; font-weight: 500; }
`;
