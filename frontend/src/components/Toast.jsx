// Neon Studio retrofit of Toast.
//
// Visuals:
//   • Dark ns-panel surface.
//   • 3px left rail in the tone color (cyan success / amber warn /
//     danger error) — quickly scannable without a loud icon plate.
//   • Soft outer glow matching the tone for presence against the canvas.
//   • Close button: compact ghost with ×, hover brightens to cyan.

import { useEffect } from "react";
import Icon from "./Icon";

const TONES = {
  success: {
    rail: "#5eead4",
    text: "var(--ns-ink)",
    glow: "0 0 24px rgba(94,234,212,0.22), 0 12px 32px rgba(0,0,0,0.55)",
    icon: "check",
    iconColor: "#5eead4",
  },
  error: {
    rail: "#ff6a82",
    text: "var(--ns-ink)",
    glow: "0 0 24px rgba(255,106,130,0.22), 0 12px 32px rgba(0,0,0,0.55)",
    icon: "alert-triangle",
    iconColor: "#ff6a82",
  },
  warning: {
    rail: "#ffb547",
    text: "var(--ns-ink)",
    glow: "0 0 24px rgba(255,181,71,0.22), 0 12px 32px rgba(0,0,0,0.55)",
    icon: "alert-triangle",
    iconColor: "#ffb547",
  },
  info: {
    rail: "#a594ff",
    text: "var(--ns-ink)",
    glow: "0 0 24px rgba(165,148,255,0.22), 0 12px 32px rgba(0,0,0,0.55)",
    icon: "info",
    iconColor: "#a594ff",
  },
};

export default function Toast({
  kind = "info",
  message,
  onClose,
  autoDismissMs = 5000,
}) {
  useEffect(() => {
    if (!autoDismissMs) return undefined;
    const id = setTimeout(() => onClose?.(), autoDismissMs);
    return () => clearTimeout(id);
  }, [autoDismissMs, onClose]);

  const tone = TONES[kind] || TONES.info;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-start gap-3 rounded-xl text-[13px]"
      style={{
        maxWidth: 420,
        background: "var(--ns-panel)",
        border: "1px solid var(--ns-line-2)",
        boxShadow: tone.glow,
        color: tone.text,
        paddingLeft: 0,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        animation: "ns-fadeslide .28s ease-out both",
        overflow: "hidden",
      }}
    >
      {/* Tone rail */}
      <span
        aria-hidden="true"
        style={{ width: 3, alignSelf: "stretch", background: tone.rail, flex: "none" }}
      />
      <span style={{ color: tone.iconColor, display: "inline-flex", paddingTop: 1 }}>
        <Icon name={tone.icon} size={15} />
      </span>
      <span className="flex-1 whitespace-pre-wrap break-words" style={{ color: "var(--ns-ink)" }}>
        {message}
      </span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="btn btn-ghost"
        style={{ padding: 4 }}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
