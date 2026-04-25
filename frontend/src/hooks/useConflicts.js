// useConflicts — Neon Studio conflict detector.
// ─────────────────────────────────────────────────────────────
// Extends the FR-019 client-side `findConflicts` in components/utils.js
// with richness the UI needs for the amber-glow rail effect and the
// agent preview:
//
//   • Not just "is there a conflict" but the exact overlap delta
//   • Severity bucket so the UI can scale glow intensity visually
//   • Both sides of every pairing (so either card can render it)
//   • Stable sort so re-renders don't reshuffle the rail
//
// Semantics match backend/core/scheduling.py (check_platform_gap):
//   Same non-archived platform + |Δt| < 15 min → conflict
//
// Usage:
//   const { byId, pairs, countsByPlatform, hasConflicts } = useConflicts(posts);
//   const c = byId.get(post.id);            // null | { severity, worstDeltaMin, peers: [...] }
//   if (c?.severity === "critical") → red rail break
//   if (c?.severity === "warn")     → amber rail break
//

import { useMemo } from "react";
import { parseISO } from "date-fns";

const GAP_MIN = 15;

// Severity buckets — driven by the worst overlap for a given post.
// The Train-track view scales glow radius + break-marker size on this.
const SEVERITY = {
  critical: { label: "critical", weight: 2 }, // same minute (Δ 0–2)
  warn:     { label: "warn",     weight: 1 }, // 3–14 min
};

function bucketForDelta(deltaMin) {
  if (deltaMin <= 2) return SEVERITY.critical;
  return SEVERITY.warn;
}

// Normalize an ISO / Date into a timestamp, or null if bad.
function toTime(v) {
  if (!v) return null;
  const d = typeof v === "string" ? parseISO(v) : v;
  const t = d?.getTime?.();
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {Array<{id, platform, scheduled_at, status, series_id?, title?}>} posts
 * @returns {{
 *   byId: Map<string|number, {
 *     severity: "critical" | "warn",
 *     worstDeltaMin: number,            // minutes (absolute), ≤ 14
 *     peers: Array<{                    // all conflicting peers, sorted asc by delta
 *       peerId: string | number,
 *       peerTitle?: string,
 *       deltaMin: number,
 *       direction: "before" | "after" | "same",
 *       scheduled_at: string | null,
 *     }>,
 *   }>,
 *   pairs: Array<{                       // each overlap once, deterministic order
 *     aId, bId, platform, deltaMin, severity,
 *   }>,
 *   countsByPlatform: Record<string, number>,  // conflicts (pairs) per platform
 *   hasConflicts: boolean,
 * }}
 */
export function useConflicts(posts) {
  return useMemo(() => computeConflicts(posts), [posts]);
}

export function computeConflicts(posts) {
  const byId = new Map();
  const pairs = [];
  const countsByPlatform = {};

  if (!Array.isArray(posts) || posts.length < 2) {
    return { byId, pairs, countsByPlatform, hasConflicts: false };
  }

  // Pre-compute: drop archived, bad times, missing platform, group by platform.
  // FR-018: archived posts are invisible to the gap rule.
  const byPlatform = new Map();
  for (const p of posts) {
    if (!p || p.status === "archived") continue;
    if (!p.platform) continue;
    const t = toTime(p.scheduled_at);
    if (t == null) continue;
    if (!byPlatform.has(p.platform)) byPlatform.set(p.platform, []);
    byPlatform.get(p.platform).push({ post: p, t });
  }

  for (const [platform, list] of byPlatform) {
    // Sort ascending so we can sweep instead of N² checking every pair.
    list.sort((a, b) => a.t - b.t);

    for (let i = 0; i < list.length; i++) {
      // Compare forward only until we exceed the window — O(n) amortized
      // for typical creator schedules (posts cluster, most pairs skip).
      for (let j = i + 1; j < list.length; j++) {
        const deltaMs = list[j].t - list[i].t;
        const deltaMin = Math.round(deltaMs / 60000);
        if (deltaMin >= GAP_MIN) break; // sorted — no later j can be closer

        const a = list[i].post;
        const b = list[j].post;
        const severity = bucketForDelta(deltaMin);

        // Deterministic pair key regardless of sort input.
        const [aId, bId] =
          String(a.id) < String(b.id) ? [a.id, b.id] : [b.id, a.id];

        pairs.push({
          aId, bId, platform,
          deltaMin,
          severity: severity.label,
        });

        countsByPlatform[platform] = (countsByPlatform[platform] || 0) + 1;

        // Per-post annotations (both sides see the conflict).
        recordPeer(byId, a, {
          peerId: b.id,
          peerTitle: b.title,
          deltaMin,
          direction: "after",             // b is later than a
          scheduled_at: b.scheduled_at ?? null,
          severity: severity.label,
        });
        recordPeer(byId, b, {
          peerId: a.id,
          peerTitle: a.title,
          deltaMin,
          direction: "before",            // a is earlier than b
          scheduled_at: a.scheduled_at ?? null,
          severity: severity.label,
        });
      }
    }
  }

  // Freeze per-post peers in ascending-Δ order and finalize severity = worst.
  for (const entry of byId.values()) {
    entry.peers.sort((p, q) => p.deltaMin - q.deltaMin);
    entry.worstDeltaMin = entry.peers[0].deltaMin;
    entry.severity = entry.peers.some((p) => p.severity === "critical")
      ? "critical"
      : "warn";
  }

  return {
    byId,
    pairs,
    countsByPlatform,
    hasConflicts: pairs.length > 0,
  };
}

function recordPeer(byId, post, peer) {
  let entry = byId.get(post.id);
  if (!entry) {
    entry = { severity: "warn", worstDeltaMin: peer.deltaMin, peers: [] };
    byId.set(post.id, entry);
  }
  // Strip the `severity` field out of the peer payload — severity lives on
  // the entry itself (we finalize it after all peers are collected).
  const { severity: _unused, ...peerPayload } = peer;
  entry.peers.push(peerPayload);
}

// ─────────────────────────────────────────────────────────────
// Derived helpers the views will want.
// ─────────────────────────────────────────────────────────────

/**
 * Given a candidate post (unsaved or being dragged), compute what its
 * conflict state WOULD be if committed. Mirrors findConflicts() in
 * utils.js but returns the same severity-rich shape as the hook.
 *
 * Use from PostForm / SeriesBuilder / the Agent preview before submit.
 */
export function previewConflict(candidate, existing, excludeId = null) {
  if (!candidate?.scheduled_at || !candidate.platform) return null;
  const ct = toTime(candidate.scheduled_at);
  if (ct == null) return null;

  const peers = [];
  let worst = Infinity;

  for (const p of existing) {
    if (!p || p.status === "archived") continue;
    if (p.id === excludeId) continue;
    if (p.platform !== candidate.platform) continue;
    const pt = toTime(p.scheduled_at);
    if (pt == null) continue;
    const deltaMin = Math.abs(Math.round((ct - pt) / 60000));
    if (deltaMin >= GAP_MIN) continue;

    peers.push({
      peerId: p.id,
      peerTitle: p.title,
      deltaMin,
      direction: ct === pt ? "same" : ct > pt ? "after" : "before",
      scheduled_at: p.scheduled_at ?? null,
    });
    if (deltaMin < worst) worst = deltaMin;
  }

  if (peers.length === 0) return null;
  peers.sort((a, b) => a.deltaMin - b.deltaMin);

  return {
    severity: peers.some((p) => p.deltaMin <= 2) ? "critical" : "warn",
    worstDeltaMin: worst,
    peers,
  };
}

/**
 * Suggest a corrected ISO for a candidate that's conflicting.
 * Strategy: push forward past the latest conflicting peer by 15 min + 1.
 * Returns null if no conflict.
 *
 * This is what the Agent's Auto-Space button calls — kept here so the
 * train-track animation can dry-run the same resolution without a round
 * trip.
 */
export function suggestAutoSpace(candidate, existing, excludeId = null) {
  const conflict = previewConflict(candidate, existing, excludeId);
  if (!conflict) return null;

  const peerTimes = conflict.peers
    .map((p) => toTime(p.scheduled_at))
    .filter((t) => t != null);
  if (peerTimes.length === 0) return null;

  // Push 15 min past the LATEST peer (bigger nudge, but guaranteed to clear
  // every overlap in one step — critical for the agent's one-click fix).
  const latest = Math.max(...peerTimes);
  const nextMs = latest + (GAP_MIN + 1) * 60000;
  const iso = new Date(nextMs).toISOString().replace(/\.\d{3}Z$/, "");

  return {
    proposed: iso,
    shiftedByMin: Math.round((nextMs - toTime(candidate.scheduled_at)) / 60000),
    reason: conflict,
  };
}

export default useConflicts;
