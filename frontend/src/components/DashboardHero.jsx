// Neon Studio — Dashboard hero band (Option B).
//
// Renders the weekly "This week you're shipping N." title, subtitle,
// the Ask Agent CTA, and the 5-stat ticker below a dashed divider.
//
// Inputs are the same data the Dashboard already has (postsList,
// seriesList, allFlatPosts, plus the useConflicts hook output). No
// backend changes required — all five stats are derived.
//
// All colors use Neon tokens from index.css. The cyan→violet gradient
// on "shipping N." is done with background-clip:text.

import { useMemo } from "react";
import Icon from "./Icon";
import { useAuth } from "../context/AuthContext";
import { nowEstMs, parseIsoMs } from "./utils";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function fmtDateEyebrow(d) {
  // "W17 · THU 04/23" — ISO-ish week label + weekday + m/d.
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return `W${week} · ${dow} ${md}`;
}

export default function DashboardHero({
  posts = [],
  series = [],
  allFlatPosts = [],
  stats: backendStats = null,
  onOpenAgent,
}) {
  const { user } = useAuth();
  // Display name preference: full_name → email's local-part → "there".
  const greetingName = (() => {
    if (user?.full_name && user.full_name.trim()) return user.full_name.trim();
    if (user?.email) return user.email.split("@")[0];
    return "there";
  })();

  // `now` drives the eyebrow display (browser-local weekday, deliberately
  // matches the user's clock). `nowMs` drives filter math and is anchored
  // to EST wall-clock so "published last 7d" / "shipping this week" stays
  // correct for browsers outside EST — the project convention (see
  // utils.js#nowEstMs / isPastEst).
  const now = new Date();
  const nowMs = nowEstMs();

  // Backend-aggregated counts when available; fall back to local
  // computation only on the very first paint (before /stats lands)
  // so the dashboard never flashes "0 0 0 0 0".
  const counts = useMemo(() => {
    if (backendStats) {
      return {
        scheduled: backendStats.scheduled_count ?? 0,
        publishedLast7: backendStats.published_last_7d ?? 0,
        seriesActive: backendStats.series_active_count ?? 0,
        conflicts: backendStats.conflicts_count ?? 0,
        drafts: backendStats.drafts_count ?? 0,
        upcoming7d: backendStats.upcoming_7d ?? 0,
      };
    }
    return {
      scheduled: allFlatPosts.filter((p) => p.status === "scheduled").length,
      publishedLast7: allFlatPosts.filter((p) => {
        if (p.status !== "published") return false;
        const t = parseIsoMs(p.scheduled_at);
        return Number.isFinite(t) && nowMs - t <= WEEK_MS;
      }).length,
      seriesActive: series.filter((s) => s.status !== "archived").length,
      conflicts: 0,
      drafts: posts.filter((p) => p.status === "draft").length,
      upcoming7d: 0,
    };
  }, [backendStats, posts, series, allFlatPosts, nowMs]);

  const stats = [
    { label: "SCHEDULED",     v: counts.scheduled,      c: "var(--ns-cyan, #5eead4)" },
    { label: "PUBLISHED 7D",  v: counts.publishedLast7, c: "#22c55e" },
    { label: "SERIES ACTIVE", v: counts.seriesActive,   c: "#a78bfa" },
    { label: "CONFLICTS",     v: counts.conflicts,      c: "#ffb547" },
    { label: "DRAFTS",        v: counts.drafts,         c: "#f472b6" },
  ];

  // "Shipping this week" — prefer the backend's upcoming_7d when
  // available so it matches /stats.
  const shippingThisWeek = backendStats
    ? counts.upcoming7d
    : allFlatPosts.filter((p) => {
        if (p.status === "archived" || p.status === "canceled") return false;
        const t = parseIsoMs(p.scheduled_at);
        return Number.isFinite(t) && t >= nowMs - 24 * 60 * 60 * 1000 && t <= nowMs + WEEK_MS;
      }).length;

  const platformsInPlay = backendStats
    ? Object.keys(backendStats.by_platform || {}).length
    : new Set(
        allFlatPosts
          .filter((p) => p.status === "scheduled")
          .map((p) => p.platform)
          .filter(Boolean)
      ).size;

  const subtitle =
    shippingThisWeek === 0
      ? "A clean week. Want to start a series?"
      : `${counts.seriesActive} series in flight · ${platformsInPlay} platforms${
          counts.conflicts > 0
            ? ` · ${counts.conflicts} conflict${counts.conflicts === 1 ? "" : "s"} blocking. Let's clear them.`
            : ". All clear."
        }`;

  return (
    <div
      className="relative"
      style={{
        padding: "4px 0 18px",
        borderBottom: "1px dashed var(--ns-line-2)",
      }}
    >
      {/* Soft magenta glow in top-right, purely decorative. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 420,
          height: 220,
          background:
            "radial-gradient(circle at 80% 20%, rgba(244,114,182,0.14), transparent 60%)",
          pointerEvents: "none",
        }}
      />

      <div className="flex items-end gap-4 relative">
        <div className="min-w-0">
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              color: "#5eead4",
              marginBottom: 8,
            }}
          >
            {fmtDateEyebrow(now)}
          </div>
          <div
            className="ns-headline ns-headline-italic"
            style={{
              fontSize: 18,
              fontWeight: 500,
              fontStyle: "italic",
              color: "var(--ns-ink-2)",
              letterSpacing: "-0.005em",
              marginBottom: 6,
            }}
          >
            Welcome,{" "}
            <span style={{ color: "var(--ns-ink)" }}>{greetingName}</span>.
          </div>
          <h1
            className="ns-headline"
            style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: "var(--ns-ink)",
            }}
          >
            This week you&rsquo;re{" "}
            <span
              className="ns-headline-italic"
              style={{
                fontStyle: "italic",
                background:
                  "linear-gradient(135deg, #5eead4, #a78bfa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              shipping {shippingThisWeek}.
            </span>
          </h1>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 13.5,
              color: "var(--ns-ink-muted)",
              maxWidth: 560,
            }}
          >
            {subtitle}
          </p>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onOpenAgent}
          className="inline-flex items-center gap-2"
          style={{
            background: "linear-gradient(135deg, #5eead4, #a78bfa)",
            color: "#0a0b10",
            border: "none",
            borderRadius: 10,
            padding: "11px 16px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(94,234,212,0.25)",
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="sparkles" size={14} />
          Ask Agent
          <kbd
            className="font-mono"
            style={{
              fontSize: 10,
              padding: "1px 5px",
              marginLeft: 2,
              border: "1px solid rgba(10,11,16,0.35)",
              borderRadius: 4,
              background: "rgba(10,11,16,0.12)",
              color: "#0a0b10",
            }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {/* 5-stat ticker */}
      <div
        className="grid mt-5 pt-4"
        style={{
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 24,
          borderTop: "1px dashed var(--ns-line-2)",
        }}
      >
        {stats.map((k) => (
          <div key={k.label}>
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                letterSpacing: "0.16em",
                color: "var(--ns-ink-muted)",
              }}
            >
              {k.label}
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className="ns-headline ns-headline-italic"
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: "var(--ns-ink)",
                  fontStyle: "italic",
                  lineHeight: 1,
                }}
              >
                {k.v}
              </span>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 24,
                  height: 2,
                  background: k.c,
                  boxShadow: `0 0 8px ${k.c}`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
