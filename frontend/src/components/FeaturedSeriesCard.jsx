// Option B — inline "featured series" hero card for the Dashboard list view.
//
// Compact editorial grid (NOT the full TrainTrackView):
//
//   ┌────────────────────────────────────────────────────────────────┐
//   │ ◈ CONTENT SERIES · N-PLATFORM RAIL                             │
//   │ Spring Drop — Studio Series                       [IG] [TT]    │
//   │ Apr 25 → May 3 · 8 posts · 2 rails                             │
//   ├────────────────────────────────────────────────────────────────┤
//   │ 80px │   #1       #2         #3         #4                     │
//   │      │   Teaser   Announce   Follow-up  Reminder               │
//   ├──────┼─────────┬─────────┬─────────┬─────────┐                 │
//   │ IG   │  [IG]   │  [IG]   │  [IG]   │  [IG]   │                 │
//   │      │  title  │  title  │  title  │  title  │                 │
//   ├──────┼─────────┴─────────┴─────────┴─────────┤                 │
//   │ TT   │  [TT]   │  [TT]   │  [TT]   │  [TT]   │                 │
//
// Passive: no per-card Agent button — the Agent CTA lives in the hero
// and right rail. Clicking a stage tile opens the PostForm.

import Icon from "./Icon";

const STAGE_LABELS = ["Teaser", "Announcement", "Follow-up", "Reminder"];

const PLATFORM_META = {
  instagram: { short: "IG", color: "#f472b6" },
  tiktok:    { short: "TT", color: "#5eead4" },
  youtube:   { short: "YT", color: "#ef4444" },
  twitter:   { short: "X",  color: "#e5e7eb" },
  x:         { short: "X",  color: "#e5e7eb" },
  linkedin:  { short: "LI", color: "#60a5fa" },
  facebook:  { short: "FB", color: "#60a5fa" },
};

function meta(pl) {
  return (
    PLATFORM_META[pl] || {
      short: (pl || "—").slice(0, 2).toUpperCase(),
      color: "#9ca3af",
    }
  );
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtTime(d) {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function FeaturedSeriesCard({
  family = [],        // all siblings of one family (filtered upstream)
  onEditPost,
}) {
  // Sort platforms deterministically by insertion order.
  const platforms = family.map((m) => m.platform).filter(Boolean);
  const anchor = family[0];

  // Build a { [platform]: [p0, p1, p2, p3] } matrix using series_position,
  // falling back to chronological order. Mirrors TrainTrackView's logic.
  const grid = {};
  for (const m of family) {
    const byStage = new Array(4).fill(null);
    const sorted = [...(m.posts || [])].sort((a, b) => {
      const pa = a.series_position ?? 99;
      const pb = b.series_position ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(a.scheduled_at) - new Date(b.scheduled_at);
    });
    sorted.forEach((p, i) => {
      const pos = p.series_position ?? i;
      if (pos >= 0 && pos < 4) byStage[pos] = p;
    });
    grid[m.platform] = byStage;
  }

  // Date range + post count for the subtitle.
  const allPosts = family.flatMap((m) => m.posts || []);
  const postCount = allPosts.length;
  const times = allPosts
    .map((p) => new Date(p.scheduled_at).getTime())
    .filter(Number.isFinite);
  const rangeLabel =
    times.length >= 2
      ? `${fmtDate(new Date(Math.min(...times)))} → ${fmtDate(new Date(Math.max(...times)))}`
      : times.length === 1
      ? fmtDate(new Date(times[0]))
      : "Not yet scheduled";

  if (!anchor) return null;

  return (
    <section
      style={{
        background: "var(--ns-panel)",
        border: "1px solid var(--ns-line)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* ─── Header ─── */}
      <header
        className="flex items-start gap-4"
        style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid var(--ns-line)",
        }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              color: "#f472b6",
            }}
          >
            ◈ CONTENT SERIES · {platforms.length}-PLATFORM RAIL
          </div>
          <h2
            className="ns-headline ns-headline-italic"
            style={{
              margin: "4px 0 3px",
              fontSize: 22,
              fontWeight: 600,
              color: "var(--ns-ink)",
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
            }}
          >
            {anchor.title}
          </h2>
          <p
            className="text-[13.5px]"
            style={{ margin: 0, color: "var(--ns-ink-muted)" }}
          >
            {rangeLabel} · {postCount} post{postCount === 1 ? "" : "s"} ·{" "}
            {platforms.map((p) => meta(p).short).join(" + ")}
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {platforms.map((pl) => {
            const m = meta(pl);
            return (
              <div
                key={pl}
                className="flex items-center gap-1.5"
                style={{
                  padding: "5px 9px",
                  background: `${m.color}1a`,
                  border: `1px solid ${m.color}44`,
                  borderRadius: 6,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: m.color,
                    boxShadow: `0 0 6px ${m.color}`,
                  }}
                />
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: m.color,
                    letterSpacing: "0.08em",
                  }}
                >
                  {m.short}
                </span>
              </div>
            );
          })}
        </div>
      </header>

      {/* ─── Compact rail grid ─── */}
      <div
        className="grid"
        style={{
          padding: 18,
          gridTemplateColumns: "88px repeat(4, minmax(0, 1fr))",
          columnGap: 10,
          rowGap: 16,
          alignItems: "center",
        }}
      >
        {/* Stage header row */}
        <div />
        {STAGE_LABELS.map((label, i) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: "var(--ns-ink-muted)",
                letterSpacing: "0.14em",
              }}
            >
              #{i + 1}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ns-ink-2)",
                letterSpacing: "0.03em",
                marginTop: 2,
              }}
            >
              {label}
            </div>
          </div>
        ))}

        {/* Platform rows */}
        {platforms.map((pl) => {
          const m = meta(pl);
          const row = grid[pl] || [];
          return (
            <PlatformRow
              key={pl}
              platform={pl}
              meta={m}
              posts={row}
              onEditPost={onEditPost}
            />
          );
        })}
      </div>
    </section>
  );
}

// ─── One platform's row: meta column + 4 stage tiles ───
function PlatformRow({ meta: m, posts, onEditPost }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: m.color,
            boxShadow: `0 0 8px ${m.color}`,
          }}
        />
        <span
          className="font-mono"
          style={{
            fontSize: 11.5,
            color: m.color,
            letterSpacing: "0.1em",
          }}
        >
          {m.short}
        </span>
      </div>
      {posts.map((p, i) => (
        <StageTile key={i} post={p} platformMeta={m} onEditPost={onEditPost} />
      ))}
    </>
  );
}

// ─── One stage tile ───
function StageTile({ post, platformMeta, onEditPost }) {
  if (!post) {
    return (
      <div
        style={{
          background: "var(--ns-panel-2)",
          border: "1px dashed var(--ns-line-2)",
          borderRadius: 8,
          padding: 10,
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="plus" size={14} />
      </div>
    );
  }
  const dt = new Date(post.scheduled_at);
  const published = post.status === "published";
  const canceled = post.status === "canceled";
  const clickable = typeof onEditPost === "function";

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onEditPost(post) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEditPost(post);
              }
            }
          : undefined
      }
      style={{
        background: "var(--ns-panel-2)",
        border: `1px solid ${
          published
            ? "rgba(34,197,94,0.45)"
            : canceled
            ? "var(--ns-line-2)"
            : "var(--ns-line)"
        }`,
        borderRadius: 8,
        padding: 10,
        position: "relative",
        cursor: clickable ? "pointer" : "default",
        opacity: canceled ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-1.5" style={{ marginBottom: 6 }}>
        <span
          aria-hidden
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: platformMeta.color,
          }}
        />
        <span
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: published ? "#22c55e" : "var(--ns-ink-muted)",
            letterSpacing: "0.06em",
          }}
        >
          {published
            ? "✓ LIVE"
            : `${fmtDate(dt).toUpperCase()} · ${fmtTime(dt)}`}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ns-ink)",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {post.title}
      </div>
    </div>
  );
}
