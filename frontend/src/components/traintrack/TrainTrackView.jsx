// TrainTrackView — Neon Studio dashboard view.
// ─────────────────────────────────────────────────────────────
// Third view alongside List + Calendar. Groups series by family
// (family_id ?? id), shows one rail per platform, one station per
// stage. Conflicts from useConflicts() drive the amber/red glow.
//
// Props:
//   series:          array of series objects (with .posts[])
//   posts:           flat list of ALL posts (for cross-series conflicts)
//   onEditPost(p)
//   onAutoSpace(p)   optional — if omitted, Auto-Space button is hidden
//   onOpenAgent()    optional — Cmd+K agent trigger
//
// Conflict severity → visual:
//   "critical" (Δ ≤ 2 min): red pulse + ns-pulse on marker
//   "warn"     (3–14 min):  steady amber glow
//

import { useMemo } from "react";
import Icon from "../Icon";
import {
  PLATFORMS,
  STAGE_LABELS,
  fmtDateShort,
  fmtTime,
  getPlatformLabel,
  latestPastMs,
  nextUpcomingMs,
  nowEstMs,
} from "../utils";
import { useConflicts } from "../../hooks/useConflicts";

const STAGE_KEYS = ["Teaser", "Announcement", "Follow-up", "Reminder"];

export default function TrainTrackView({
  series = [],
  posts = [],
  onEditPost,
  onAutoSpace,
  onOpenAgent,
}) {
  // Conflicts span the ENTIRE schedule, not just this series — a post in
  // Series A can collide with a standalone post on the same platform.
  const conflicts = useConflicts(posts);

  // Group series by family anchor, then order "coming next first": the
  // family whose soonest upcoming post is nearest the current EST
  // wall-clock renders at the top, all-past families sink to the bottom
  // (most-recent-shipped within that tail).
  const families = useMemo(() => {
    const now = nowEstMs();
    return groupFamilies(series).sort((a, b) => {
      const aPosts = a.members.flatMap((m) => m.posts || []);
      const bPosts = b.members.flatMap((m) => m.posts || []);
      const aNext = nextUpcomingMs(aPosts, now);
      const bNext = nextUpcomingMs(bPosts, now);
      if (aNext !== bNext) return aNext - bNext;
      return latestPastMs(bPosts, now) - latestPastMs(aPosts, now);
    });
  }, [series]);

  if (families.length === 0) {
    return (
      <div className="ns-panel p-12 text-center">
        <Icon name="git-branch" size={20} />
        <p className="ns-headline ns-headline-italic text-[22px] mt-3">No series yet.</p>
        <p className="text-ink-muted text-[13px] mt-2">
          Press{" "}
          <kbd className="font-mono text-[11px] px-1.5 py-0.5 border border-line-2 rounded bg-panel-2">⌘K</kbd>{" "}
          to summon the agent, or click "New series".
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {families.map((fam) => (
        <FamilyTrack
          key={fam.anchorId}
          family={fam}
          conflicts={conflicts}
          onEditPost={onEditPost}
          onAutoSpace={onAutoSpace}
          onOpenAgent={onOpenAgent}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function groupFamilies(series) {
  const map = new Map();
  for (const s of series) {
    const anchorId = s.family_id ?? s.id;
    if (!map.has(anchorId)) {
      map.set(anchorId, {
        anchorId,
        title: s.title,
        description: s.description,
        members: [],
      });
    }
    map.get(anchorId).members.push(s);
  }
  return [...map.values()];
}

// ─────────────────────────────────────────────────────────────
function FamilyTrack({ family, conflicts, onEditPost, onAutoSpace, onOpenAgent }) {
  // Platforms in a stable order (insertion order of members).
  const platforms = family.members.map((m) => m.platform).filter(Boolean);

  // Per-platform posts keyed by stage position (0..3).
  // We index by *position* when available, else fall back to label match,
  // else sorted-by-time index. Mirrors SeriesCard's logic.
  const postsByPlatformStage = useMemo(() => {
    const out = {};
    for (const m of family.members) {
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
      out[m.platform] = byStage;
    }
    return out;
  }, [family.members]);

  // How many family-wide conflicts live on this track?
  const famConflictCount = platforms.reduce((n, pl) => {
    return n + (conflicts.countsByPlatform[pl] || 0);
  }, 0);

  return (
    <section className="ns-panel p-8 relative overflow-hidden">
      {/* ambient halos */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: -80, right: -80, width: 400, height: 300,
          background: "radial-gradient(circle, rgba(255,94,181,.10), transparent 70%)",
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: -60, left: -60, width: 350, height: 260,
          background: "radial-gradient(circle, rgba(94,234,212,.08), transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="flex items-end gap-4 mb-7 relative">
        <div className="flex-1 min-w-0">
          <div className="ns-eyebrow text-cyan">◈ CONTENT SERIES · {platforms.length}-PLATFORM RAIL</div>
          <h2 className="ns-headline text-[32px] mt-1.5">
            {family.title}
            {" "}
            {family.description && (
              <span className="ns-headline-italic ns-gradient-text">
                — {family.description.split(/[.\n]/)[0]}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-4 mt-3">
            <div className="font-mono text-[11px] text-ink-muted tracking-wider-2 uppercase">
              {summarizeRange(family)}
            </div>
            {famConflictCount > 0 && (
              <>
                <div className="w-px h-3.5 bg-line-2" />
                <div className="font-mono text-[11px] text-amber tracking-wider-2 uppercase animate-ns-glitch">
                  ⚠ {famConflictCount} CONFLICT{famConflictCount === 1 ? "" : "S"}
                </div>
              </>
            )}
          </div>
        </div>
        <button type="button" className="ns-btn-ghost" onClick={onOpenAgent}>
          <Icon name="sparkles" size={13} /> Agent
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 border border-line-2 rounded bg-panel-2 ml-1">⌘K</kbd>
        </button>
      </header>

      {/* Station headers */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "140px repeat(4, 1fr)" }}>
        <div />
        {STAGE_KEYS.map((stage, i) => (
          <div key={stage} className="text-center">
            <div className="ns-eyebrow text-ink-faint">STATION 0{i + 1}</div>
            <div
              className="ns-headline ns-headline-italic text-[18px] text-ink mt-1"
              style={{ letterSpacing: "-0.01em" }}
            >
              {stage}
            </div>
            <div
              className="mt-2 h-px mx-auto w-[60%]"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(94,234,212,.5), transparent)",
              }}
            />
          </div>
        ))}
      </div>

      {/* Rails */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "140px 1fr" }}>
        {/* Labels */}
        <div className="flex flex-col gap-5">
          {platforms.map((pl, i) => {
            const postCount = (postsByPlatformStage[pl] || []).filter(Boolean).length;
            return (
              <div key={pl} className="h-[148px] flex items-center gap-3 pl-1">
                <div className="relative w-7 h-7 flex items-center justify-center">
                  <div
                    className="absolute inset-0 rounded-full opacity-20 blur-md"
                    style={{ background: PLATFORMS[pl]?.color }}
                  />
                  <div
                    className="w-2.5 h-2.5 rounded-full z-10"
                    style={{
                      background: PLATFORMS[pl]?.color,
                      boxShadow: `0 0 16px ${PLATFORMS[pl]?.color}`,
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="ns-headline ns-headline-italic text-[15px] text-ink">
                    {getPlatformLabel(pl)}
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted tracking-wider-2 uppercase">
                    {postCount} POSTS · RAIL {i + 1}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tracks */}
        <div className="flex flex-col gap-5">
          {platforms.map((pl) => (
            <PlatformRail
              key={pl}
              platform={pl}
              stages={postsByPlatformStage[pl] || []}
              conflicts={conflicts}
              cardAbove={platforms.indexOf(pl) % 2 === 0}
              onEditPost={onEditPost}
              onAutoSpace={onAutoSpace}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
function PlatformRail({ platform, stages, conflicts, cardAbove, onEditPost, onAutoSpace }) {
  const color = PLATFORMS[platform]?.color || "#6b7280";
  // Is ANY post on this rail in conflict? Drive the rail-line treatment.
  const railHasConflict = stages.some((p) => p && conflicts.byId.has(p.id));
  const worstSeverity = stages.reduce((acc, p) => {
    if (!p) return acc;
    const c = conflicts.byId.get(p.id);
    if (!c) return acc;
    if (c.severity === "critical") return "critical";
    return acc === "critical" ? acc : "warn";
  }, null);

  return (
    <div
      className="relative h-[148px] grid items-center"
      style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
    >
      {/* Rail line */}
      <RailLine color={color} severity={worstSeverity} hasConflict={railHasConflict} />

      {stages.map((post, si) => (
        <StationCell
          key={si}
          stationIndex={si}
          post={post}
          platform={platform}
          color={color}
          cardAbove={cardAbove}
          conflicts={conflicts}
          onEditPost={onEditPost}
          onAutoSpace={onAutoSpace}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function RailLine({ color, severity, hasConflict }) {
  if (!hasConflict) {
    return (
      <div
        className="absolute left-[5%] right-[5%] top-1/2 -translate-y-1/2 ns-rail animate-ns-rail-flow"
        style={{ color, boxShadow: `0 0 14px ${color}55` }}
      />
    );
  }
  const breakColor = severity === "critical" ? "#ff6a82" : "#ffb547";
  return (
    <>
      <div
        className={"absolute left-[5%] right-[5%] top-1/2 -translate-y-1/2 ns-rail-conflict " + (severity === "critical" ? "animate-ns-pulse" : "animate-ns-glitch")}
        style={{ color, "--tw-shadow-color": breakColor }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
function StationCell({ post, platform, color, cardAbove, conflicts, onEditPost, onAutoSpace }) {
  const conflict = post ? conflicts.byId.get(post.id) : null;
  const isPub = post?.status === "published";
  const isSevCritical = conflict?.severity === "critical";

  const nodeColor =
    isSevCritical ? "#ff6a82" :
    conflict ? "#ffb547" :
    isPub ? "#5eead4" :
    color;

  return (
    <div className="relative h-[148px] flex justify-center items-center">
      {/* Station node */}
      <div className="relative w-[22px] h-[22px] z-[3]">
        <div
          className={"absolute -inset-2 rounded-full blur-md " + (conflict ? "animate-ns-pulse" : "")}
          style={{ background: `${nodeColor}33` }}
        />
        <div
          className="absolute inset-0 rounded-full flex items-center justify-center"
          style={{
            background: isPub ? nodeColor : conflict ? nodeColor : "#0d0e14",
            border: `2.5px solid ${nodeColor}`,
            boxShadow: `0 0 0 4px #0d0e14, 0 0 18px ${nodeColor}aa`,
          }}
        >
          {isPub && <Icon name="check" size={11} color="#000" />}
          {conflict && !isPub && (
            <span className="text-[11px] font-extrabold" style={{ color: "#241500" }}>!</span>
          )}
        </div>
      </div>

      {post && (
        <>
          {/* connector */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-px h-[18px] opacity-60 z-[2]"
            style={{
              background: nodeColor,
              top: cardAbove ? "calc(50% - 30px)" : "50%",
              bottom: cardAbove ? "auto" : "calc(50% - 30px)",
            }}
          />
          <StationCard
            post={post}
            platform={platform}
            color={color}
            conflict={conflict}
            cardAbove={cardAbove}
            onEdit={() => onEditPost?.(post)}
            onAutoSpace={onAutoSpace ? () => onAutoSpace(post) : null}
          />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function StationCard({ post, color, conflict, cardAbove, onEdit, onAutoSpace }) {
  const isPub = post.status === "published";
  const isCritical = conflict?.severity === "critical";
  const edgeColor = isCritical ? "#ff6a82" : conflict ? "#ffb547" : isPub ? "#5eead4" : color;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 w-[min(240px,95%)] cursor-pointer group"
      style={{
        top: cardAbove ? 4 : "auto",
        bottom: cardAbove ? "auto" : 4,
      }}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onEdit?.(); }}
    >
      <div
        className="relative rounded-[10px] p-3 overflow-hidden transition-transform group-hover:-translate-y-0.5"
        style={{
          background: conflict
            ? `linear-gradient(135deg, ${isCritical ? "rgba(255,106,130,.12)" : "rgba(255,181,71,.10)"}, #151723)`
            : "#151723",
          border: `1px solid ${conflict ? edgeColor + "88" : isPub ? "rgba(94,234,212,.35)" : "rgba(255,255,255,.08)"}`,
          boxShadow: conflict
            ? `0 8px 28px rgba(0,0,0,.5), 0 0 24px ${edgeColor}33`
            : `0 6px 20px rgba(0,0,0,.4)`,
        }}
      >
        {/* accent strip */}
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: edgeColor, boxShadow: `0 0 10px ${edgeColor}` }}
        />

        <div className="flex flex-col gap-1">
          <div
            className="font-mono text-[9px] tracking-wider-3 uppercase"
            style={{ color: conflict ? edgeColor : isPub ? "#5eead4" : "#8a8d99" }}
          >
            {isPub
              ? "◉ PUBLISHED"
              : post.scheduled_at
                ? `${fmtDateShort(post.scheduled_at).toUpperCase()} · ${fmtTime(post.scheduled_at)}`
                : "UNSCHEDULED"}
          </div>
          <div
            className="ns-headline font-semibold text-[13px] text-ink leading-tight line-clamp-2"
            style={{ letterSpacing: "-0.005em", fontStyle: "normal" }}
          >
            {post.title}
          </div>
        </div>

        {conflict && (
          <div
            className="mt-2 px-2 py-1.5 rounded flex items-center gap-1.5"
            style={{
              background: isCritical ? "rgba(255,106,130,.12)" : "rgba(255,181,71,.10)",
              border: `1px dashed ${edgeColor}66`,
            }}
          >
            <span className="text-[10px]">{isCritical ? "✕" : "⚠"}</span>
            <div
              className="font-mono text-[9.5px] tracking-wide flex-1 truncate"
              style={{ color: isCritical ? "#ffb8c2" : "#ffd17a" }}
            >
              {conflict.worstDeltaMin}m from "{conflict.peers[0].peerTitle || "another post"}"
            </div>
            {onAutoSpace && (
              <button
                type="button"
                className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-amber text-[#241500] font-bold uppercase tracking-wide"
                onClick={(e) => { e.stopPropagation(); onAutoSpace(); }}
                title="Auto-Space this post"
              >
                FIX
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function summarizeRange(family) {
  let min = null, max = null, count = 0;
  for (const m of family.members) {
    for (const p of (m.posts || [])) {
      if (!p.scheduled_at) continue;
      const t = new Date(p.scheduled_at).getTime();
      if (Number.isNaN(t)) continue;
      if (min == null || t < min) min = t;
      if (max == null || t > max) max = t;
      count++;
    }
  }
  if (count === 0) return `${family.members.length} RAIL${family.members.length === 1 ? "" : "S"}`;
  const fd = (ms) => fmtDateShort(new Date(ms).toISOString());
  return `${fd(min)} → ${fd(max)} · ${count} POSTS · ${family.members.length} RAIL${family.members.length === 1 ? "" : "S"}`;
}
