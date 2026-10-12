import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface MenuItem {
  id: string;
  label: ReactNode;
  trailing?: ReactNode;
  checked?: boolean;
  onSelect: () => void;
}

/** A pull-down menu button (SwiftUI `Menu` with a visible indicator). */
export function MenuButton({
  label,
  items,
  title,
  style,
  align = "left",
}: {
  label: ReactNode;
  items: MenuItem[];
  title?: string;
  style?: CSSProperties;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", () => setOpen(false), { once: true });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="toolbar-button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ gap: 4, ...style }}
      >
        {label}
        <ChevronDown size={10} strokeWidth={2.5} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="menu-popup" role="menu" style={align === "right" ? { right: 0 } : { left: 0 }}>
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span style={{ width: 14, display: "inline-grid", placeItems: "center" }}>
                {item.checked && <Check size={12} strokeWidth={2.5} />}
              </span>
              <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
              {item.trailing != null && <span className="menu-trailing tabular">{item.trailing}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
