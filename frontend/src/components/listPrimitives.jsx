// Neon Studio retrofit of the shared list primitives.
//
// Public API mirrors the original three call sites in the warm build:
//   <StatusChip status="scheduled" | "published" | "archived" | "canceled" />
//   <PlatformDot platform="youtube" />
//   <Meatball label="Post actions">{(close) => ...children}</Meatball>
//
// Anything that was an oklch terracotta value before is now a Neon token
// (cyan for brand/scheduled, emerald #10B981 for published, magenta for
// archived, amber for conflict). Colors are centralised in index.css
// via `.ns-chip-*`, so consumers stay clean.

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { PLATFORMS, PLATFORM_FALLBACK_COLOR, getPlatformLabel } from "./utils";

/* ───────────────────────── StatusChip ───────────────────────── */

const STATUS_META = {
  scheduled: { cls: "ns-chip-scheduled", label: "Scheduled" },
  published: { cls: "ns-chip-published", label: "Published", icon: "check" },
  archived:  { cls: "ns-chip-archived",  label: "Archived",  icon: "archive" },
  canceled:  { cls: "ns-chip-archived",  label: "Canceled",  icon: "ban" },
};

export function StatusChip({ status }) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <span className={`ns-chip ${meta.cls}`}>
      {meta.icon && <Icon name={meta.icon} size={10} />}
      {meta.label}
    </span>
  );
}

/* ───────────────────────── PlatformDot ───────────────────────── */

export function PlatformDot({ platform, size = 8 }) {
  const color = PLATFORMS[platform]?.color ?? PLATFORM_FALLBACK_COLOR;
  return (
    <span
      aria-label={getPlatformLabel(platform)}
      title={getPlatformLabel(platform)}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        // Outer ring so bright brand dots read on the dark panel without
        // halation artifacts around the edges.
        boxShadow: `0 0 0 1px rgba(0,0,0,.35), 0 0 0 2px ${color}22`,
        flex: "none",
      }}
    />
  );
}

/* ───────────────────────── Meatball ───────────────────────── */

// Popover menu. `children` is a render-prop `(close) => JSX` so items can
// call close() after triggering their action. Mirrors the call pattern in
// the original PostCard/SeriesCard.

export function Meatball({ label = "Actions", children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="btn btn-ghost"
      >
        <Icon name="more-horizontal" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
