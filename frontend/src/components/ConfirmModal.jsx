// Neon Studio retrofit of ConfirmModal.
//
// Visuals:
//   • Backdrop: rgba(0,0,0,0.72) + subtle backdrop-blur for depth.
//   • Panel: dark ns-panel with ns-overlay-in entry animation.
//   • Icon plate: tone-coloured soft fill + matching ring.
//   • Title: Fraunces italic, soft-display for authority.
//   • Primary button: gradient for confirm (neutral), amber for warning,
//     danger #ff6a82 with glow for destructive.
//
// Delete-gating support: callers can pass `disabled: true` to render a
// permanently-disabled confirm button. Lets the consumer surface an
// explanation (e.g. "You've confirmed, but this series has published
// posts — archive instead") without a second modal round-trip.

import { useEffect } from "react";
import Icon from "./Icon";

export default function ConfirmModal({
  icon = "alert-triangle",
  tone = "danger", // "danger" | "warning" | "neutral"
  title,
  body,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  disabled = false,
  onCancel,
  onConfirm,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onCancel?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const toneStyles = {
    danger: {
      iconBg: "rgba(255,106,130,0.14)",
      iconRing: "inset 0 0 0 1px rgba(255,106,130,0.40)",
      iconColor: "#ff6a82",
      btnBg: "#ff6a82",
      btnColor: "#1a0508",
      btnGlow: "0 8px 24px rgba(255,106,130,0.32)",
    },
    warning: {
      iconBg: "rgba(255,181,71,0.14)",
      iconRing: "inset 0 0 0 1px rgba(255,181,71,0.40)",
      iconColor: "#ffb547",
      btnBg: "#ffb547",
      btnColor: "#241500",
      btnGlow: "0 8px 24px rgba(255,181,71,0.30)",
    },
    neutral: {
      iconBg: "rgba(94,234,212,0.10)",
      iconRing: "inset 0 0 0 1px rgba(94,234,212,0.30)",
      iconColor: "#5eead4",
      btnBg: "linear-gradient(135deg, #5eead4, #a594ff)",
      btnColor: "#0a0b10",
      btnGlow: "0 8px 24px rgba(94,234,212,0.28)",
    },
  };
  const t = toneStyles[tone] || toneStyles.neutral;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      <div
        className="w-[480px] max-w-[92vw] ns-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          animation: "ns-overlay-in .18s cubic-bezier(.2,.9,.25,1) both",
          boxShadow: "0 50px 100px rgba(0,0,0,.70), 0 0 0 1px rgba(255,255,255,.04)",
        }}
      >
        <div className="flex items-start gap-4 p-5">
          <div
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
            style={{
              background: t.iconBg,
              boxShadow: t.iconRing,
              color: t.iconColor,
            }}
          >
            <Icon name={icon} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="ns-headline ns-headline-italic"
              style={{ fontSize: 20, fontWeight: 500, color: "var(--ns-ink)", letterSpacing: "-0.01em" }}
            >
              {title}
            </h3>
            <div
              className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--ns-ink-2)" }}
            >
              {body}
            </div>
          </div>
        </div>
        <div
          className="flex items-center justify-end gap-2 px-5 pb-4 pt-1 border-t"
          style={{ borderColor: "var(--ns-line)" }}
        >
          <button
            className="btn"
            style={{ border: "1px solid var(--ns-line-2)" }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            onClick={disabled ? undefined : onConfirm}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all"
            style={{
              background: t.btnBg,
              color: t.btnColor,
              border: "1px solid transparent",
              boxShadow: disabled ? "none" : t.btnGlow,
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
