// Right-rail agenda: posts within the next 48 hours, newest first.
// Editorial style — Fraunces italic day number, mono time/platform tag,
// truncated title. Clicking a row fires onSelectPost so the dashboard
// can open the PostForm (skipping series-children to match main's
// CalendarView behavior).

import { useMemo } from "react";
import { nowEstMs, parseIsoMs } from "./utils";

const DAY = 24 * 60 * 60 * 1000;

const PLATFORM_ACCENT = {
  instagram: "#f472b6",
  tiktok:    "#5eead4",
  youtube:   "#ef4444",
  twitter:   "#e5e7eb",
  x:         "#e5e7eb",
  linkedin:  "#60a5fa",
  facebook:  "#60a5fa",
};

const PLATFORM_SHORT = {
  instagram: "IG",
  tiktok:    "TT",
  youtube:   "YT",
  twitter:   "X",
  x:         "X",
  linkedin:  "LI",
  facebook:  "FB",
};

function fmtTime(d) {
  // 24h format — short, no AM/PM suffix to collide with the day number.
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function UpcomingRail({ posts = [], onSelectPost }) {
  const upcoming = useMemo(() => {
    // EST wall-clock "now" keeps the 48h window aligned with how the
    // backend stores scheduled_at (naive EST), regardless of browser tz.
    const now = nowEstMs();
    const end = now + 2 * DAY;
    return posts
      .filter((p) => {
        if (p.status === "archived" || p.status === "canceled" || p.status === "published") return false;
        const t = parseIsoMs(p.scheduled_at);
        return Number.isFinite(t) && t >= now - 1000 && t <= end;
      })
      .sort((a, b) => parseIsoMs(a.scheduled_at) - parseIsoMs(b.scheduled_at))
      .slice(0, 6);
  }, [posts]);

  return (
    <div
      className="ns-panel"
      style={{ padding: 16, minHeight: 120 }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.15em",
          color: "#a78bfa",
          marginBottom: 12,
        }}
      >
        ◆ UPCOMING · 48H
      </div>

      {upcoming.length === 0 ? (
        <div
          className="text-[12px]"
          style={{ color: "var(--ns-ink-muted)", paddingBlock: 8 }}
        >
          Nothing scheduled in the next 48 hours.
        </div>
      ) : (
        upcoming.map((p, i) => {
          const dt = new Date(p.scheduled_at);
          const accent = PLATFORM_ACCENT[p.platform] || "#9ca3af";
          const short = PLATFORM_SHORT[p.platform] || (p.platform || "—").slice(0, 2).toUpperCase();
          const clickable = !p.series_id && typeof onSelectPost === "function";
          return (
            <div
              key={p.id}
              onClick={clickable ? () => onSelectPost(p) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectPost(p);
                      }
                    }
                  : undefined
              }
              className="flex gap-3"
              style={{
                padding: "10px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--ns-line)",
                cursor: clickable ? "pointer" : "default",
              }}
            >
              <div style={{ textAlign: "center", minWidth: 44 }}>
                <div
                  className="ns-headline ns-headline-italic"
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--ns-ink)",
                    lineHeight: 1,
                    fontStyle: "italic",
                  }}
                >
                  {dt.getDate()}
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 9.5,
                    color: "var(--ns-ink-muted)",
                    marginTop: 3,
                    letterSpacing: "0.04em",
                  }}
                >
                  {fmtTime(dt)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    aria-hidden
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: accent,
                      boxShadow: `0 0 6px ${accent}`,
                      display: "inline-block",
                    }}
                  />
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 9.5,
                      color: accent,
                      letterSpacing: "0.08em",
                    }}
                  >
                    {short}
                  </span>
                  {p.series_id && (
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 9,
                        color: "var(--ns-ink-muted)",
                        marginLeft: "auto",
                        letterSpacing: "0.06em",
                      }}
                    >
                      SERIES
                    </span>
                  )}
                </div>
                <div
                  className="text-[12px]"
                  style={{
                    color: "var(--ns-ink)",
                    fontWeight: 500,
                    lineHeight: 1.35,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {p.title}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
