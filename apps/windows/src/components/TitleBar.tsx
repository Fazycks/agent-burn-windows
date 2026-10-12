import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { isTauri } from "../lib/native";

const glyph: CSSProperties = {
  fontFamily: '"Segoe Fluent Icons", "Segoe MDL2 Assets"',
  fontSize: 10,
};

/** Windows caption buttons for the undecorated windows (min / max / close). */
export function WindowControls({
  minimize = true,
  maximize = true,
  onClose,
}: {
  minimize?: boolean;
  maximize?: boolean;
  onClose?: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri() || !maximize) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => void win.isMaximized().then(setMaximized))
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, [maximize]);
  if (!isTauri()) return null;
  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      {minimize && (
        <button aria-label="Minimize" onClick={() => void win.minimize()}>
          <span style={glyph}>{""}</span>
        </button>
      )}
      {maximize && (
        <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()}>
          <span style={glyph}>{maximized ? "" : ""}</span>
        </button>
      )}
      <button className="close" aria-label="Close" onClick={() => (onClose ? onClose() : void win.close())}>
        <span style={glyph}>{""}</span>
      </button>
    </div>
  );
}

/** A draggable title bar region; double-click toggles maximize like a native caption. */
export function TitleBar({
  children,
  height = 38,
  style,
  controls,
}: {
  children?: ReactNode;
  height?: number;
  style?: CSSProperties;
  controls?: ReactNode;
}) {
  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      style={{ height, ...style }}
    >
      {children}
      {controls}
    </div>
  );
}
