// "◇ STANDALONE · TODAY" card — 2-column grid of today's standalone
// posts (non-series-children only). Each tile has a platform-gradient
// thumbnail, title, status row, and HH:MM badge. Posts within 15 minutes
// of another get a cyan conflict outline.

import Icon from "./Icon";

const PLATFORM_META = {
  instagram: { short: "IG", grad: "linear-gradient(135deg,#f43f5e,#f472b6)" },
  tiktok:    { short: "TT", grad: "linear-gradient(135deg,#0f766e,#5eead4)" },
  x:         { short: "X",  grad: "linear-gradient(135deg,#334155,#64748b)" },
  youtube:   { short: "YT", grad: "linear-gradient(135deg,#7f1d1d,#ef4444)" },
};

function meta(pl) {
  return (
    PLATFORM_META[pl] || {
      short: (pl || "—").slice(0, 2).toUpperCase(),
      grad: "linear-gradient(135deg,#475569,#94a3b8)",
    }
  );
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function StandaloneToday({
  posts = [],
  onEditPost,
  onOpenList,
}) {
  const today = new Date();

  // Standalone = not a series child.
  const todays = posts
    .filter((p) => !p.series_id && p.scheduled_at)
    .filter((p) => sameDay(new Date(p.scheduled_at), today))
    .filter((p) => p.status !== "archived")
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  // 15-minute conflict detection on today's standalone set only.
  const conflictIds = new Set();
  for (let i = 0; i < todays.length; i++) {
    for (let j = i + 1; j < todays.length; j++) {
      const dt = Math.abs(
        new Date(todays[i].scheduled_at) - new Date(todays[j].scheduled_at)
      );
      if (dt < 15 * 60 * 1000) {
        conflictIds.add(todays[i].id);
        conflictIds.add(todays[j].id);
      }
    }
  }

  return (
    <div
      className="rounded-[14px] p-5"
      style={{
        background: "var(--ns-panel)",
        border: "1px solid var(--ns-line)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 6, height: 6, borderRadius: 999,
              background: "#a594ff",
              boxShadow: "0 0 8px rgba(165,148,255,0.7)",
            }}
          />
          <span
            className="font-mono uppercase"
            style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--ns-ink-muted)" }}
          >
            Standalone · Today
          </span>
        </div>
        <button
          type="button"
          className="text-[11px] font-mono"
          style={{
            color: "var(--ns-ink-muted)",
            background: "transparent",
            border: "none",
            cursor: onOpenList ? "pointer" : "default",
          }}
          onClick={onOpenList}
        >
          {todays.length} {todays.length === 1 ? "post" : "posts"}
        </button>
      </div>

      {todays.length === 0 ? (
        <div
          className="rounded-[10px] p-6 text-center text-[12.5px]"
          style={{
            border: "1px dashed var(--ns-line-2)",
            color: "var(--ns-ink-muted)",
          }}
        >
          Nothing standalone on deck for today.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {todays.slice(0, 4).map((p) => {
            const m = meta(p.platform);
            const conflict = conflictIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onEditPost?.(p)}
                className="text-left rounded-[10px] p-3 flex gap-3 items-start transition"
                style={{
                  background: "var(--ns-panel-2)",
                  border: conflict
                    ? "1px solid rgba(94,234,212,0.55)"
                    : "1px solid var(--ns-line-2)",
                  boxShadow: conflict
                    ? "0 0 0 2px rgba(94,234,212,0.14), 0 0 18px rgba(94,234,212,0.18)"
                    : "none",
                  cursor: "pointer",
                }}
              >
                <div
                  className="flex items-end justify-start p-1.5 shrink-0"
                  style={{
                    width: 44, height: 44, borderRadius: 8,
                    background: m.grad,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    fontSize: 9, fontWeight: 600, color: "#0d0e14",
                    letterSpacing: "0.08em",
                  }}
                >
                  {m.short}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="font-mono text-[10px] mb-1 flex items-center gap-1.5"
                    style={{ color: "var(--ns-ink-muted)", letterSpacing: "0.1em" }}
                  >
                    <span
                      style={{
                        width: 5, height: 5, borderRadius: 999,
                        background: "#5eead4", display: "inline-block",
                      }}
                    />
                    {hhmm(p.scheduled_at)}
                  </div>
                  <div
                    className="text-[13.5px] truncate"
                    style={{ color: "var(--ns-ink)", fontWeight: 500 }}
                  >
                    {p.title || "Untitled post"}
                  </div>
                  <div
                    className="font-mono uppercase text-[9.5px] mt-1.5 flex items-center gap-1.5"
                    style={{ color: "var(--ns-ink-muted)", letterSpacing: "0.14em" }}
                  >
                    {p.status || "scheduled"}
                    {conflict && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                        style={{
                          background: "rgba(94,234,212,0.12)",
                          color: "#5eead4",
                          border: "1px solid rgba(94,234,212,0.3)",
                        }}
                      >
                        <Icon name="alert-triangle" size={9} />
                        15m
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
