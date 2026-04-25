// Client-side mirror of backend scheduling invariants.
// Matches app/core/scheduling.py (check_platform_gap + check_sequential_integrity)
// so the UI can pre-validate before the user submits.

import {
  differenceInMinutes,
  format,
  parseISO,
} from "date-fns";

export const PLATFORMS = {
  youtube: { label: "YouTube", color: "#FF0033", short: "YT" },
  instagram: { label: "Instagram", color: "#E1306C", short: "IG" },
  twitter: { label: "X (Twitter)", color: "#e5e7eb", short: "X" },
  tiktok: { label: "TikTok", color: "#25F4EE", short: "TT" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", short: "LI" },
};

// Shared fallback for render sites that want to draw something for an
// unknown platform key instead of blanking out (e.g. calendar events).
export const PLATFORM_FALLBACK_COLOR = "#6b7280";

export function getPlatformColor(key) {
  return PLATFORMS[key]?.color ?? PLATFORM_FALLBACK_COLOR;
}

export function getPlatformLabel(key) {
  return PLATFORMS[key]?.label ?? key;
}

export const STAGE_LABELS = [
  "Teaser",
  "Announcement",
  "Follow-up",
  "Reminder",
];

/** FR-019: same-platform + 15-min + non-archived client pre-check.
 *
 * @param candidate { scheduled_at: string | Date, platform: string }
 * @param existing [{ id, platform, scheduled_at, status }]
 * @param excludeId optional — the candidate's own id (self-exclude on PATCH)
 * @returns array of conflicting `existing` entries
 */
export function findConflicts(candidate, existing, excludeId = null) {
  if (!candidate?.scheduled_at) return [];
  const t =
    typeof candidate.scheduled_at === "string"
      ? parseISO(candidate.scheduled_at)
      : candidate.scheduled_at;
  if (Number.isNaN(t?.getTime())) return [];
  return existing.filter((p) => {
    if (p.id === excludeId) return false;
    if (p.platform !== candidate.platform) return false;
    if (!p.scheduled_at) return false;
    if (p.status === "archived") return false; // FR-018
    const pt = parseISO(p.scheduled_at);
    if (Number.isNaN(pt.getTime())) return false;
    const diff = Math.abs(differenceInMinutes(t, pt));
    return diff < 15;
  });
}

/** FR-020 client-side mirror of check_sequential_integrity.
 *
 * @param times array of ISO strings OR Date objects, in stage-position order
 * @returns { offendingIndex, priorIndex } | null
 */
export function checkPositionOrdering(times) {
  const parsed = times.map((t) => {
    if (!t) return null;
    return typeof t === "string" ? parseISO(t) : t;
  });
  for (let i = 1; i < parsed.length; i++) {
    if (!parsed[i] || !parsed[i - 1]) continue;
    if (parsed[i].getTime() <= parsed[i - 1].getTime()) {
      return { offendingIndex: i, priorIndex: i - 1 };
    }
  }
  return null;
}

export function fmtTime(iso) {
  return iso ? format(parseISO(iso), "h:mm a") : "";
}
export function fmtDate(iso) {
  return iso ? format(parseISO(iso), "EEE, MMM d") : "";
}
export function fmtDateShort(iso) {
  return iso ? format(parseISO(iso), "MMM d") : "";
}
export function fmtDateTime(iso) {
  return iso ? format(parseISO(iso), "EEE, MMM d • h:mm a") : "";
}

/** Build a naive ISO string from a (YYYY-MM-DD) date + (HH:mm) time pair.
 *
 * We intentionally do NOT apply a timezone: the backend uses
 * `DateTime(timezone=True)` which, under SQLite, drops tz info on read
 * (values come back like `"2026-10-15T14:00:00"` with no offset). If we
 * sent a UTC ISO here via `new Date(...).toISOString()`, the round-trip
 * `splitIso` → `toIsoLocal` → server → `splitIso` would shift every
 * wall-clock by the user's UTC offset — visible as clone-series timelines
 * drifting by several hours. Keeping the wire format naive makes the
 * round-trip stable and matches what the backend already echoes back.
 */
export function toIsoLocal(date, time) {
  if (!date || !time) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const hhmm = time.length === 5 ? `${time}:00` : time;
  return `${date}T${hhmm}`;
}

/** Split an ISO string into local-TZ `{ date: "YYYY-MM-DD", time: "HH:mm" }`
 * pair suitable for <input type="date"> + <input type="time"> controls.
 * Returns empty strings when iso is null/invalid. */
/** Current wall-clock in the project-standard EST (America/New_York)
 *  timezone, as a plain object. Used by isPastEst to compare a naive ISO
 *  written by the UI against "now" without introducing a Date round-trip
 *  that would shift by the browser's local offset.
 */
function nowEstParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map = Object.fromEntries(
    fmt.formatToParts(new Date()).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return [
    Number(map.year),
    Number(map.month),
    Number(map.day),
    hour,
    Number(map.minute),
  ];
}

/** Current "now" as an EST wall-clock timestamp, expressed as a
 *  browser-local-tz ms so it is directly comparable to
 *  `parseIsoMs(scheduled_at)` — which, by our naive-ISO wire convention
 *  (see toIsoLocal), also gets interpreted in the browser's local tz.
 *  The two values share the same frame of reference, so the subtraction
 *  gives a correct EST delta regardless of where the browser is running.
 *  Prefer this over `Date.now()` / `new Date().getTime()` in any code
 *  comparing against `scheduled_at`.
 *
 *  Precision: minute-grained (same as nowEstParts / isPastEst) — matches
 *  the backend's is_past_est check and the dashboard filters don't need
 *  sub-minute accuracy.
 */
export function nowEstMs() {
  const [y, mo, d, h, mi] = nowEstParts();
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Null-safe wrapper around date-fns' `parseISO` for `scheduled_at` —
 *  returns NaN for null / undefined / empty / unparseable input so the
 *  standard `Number.isFinite(t)` filter still works. Drafts can carry
 *  `scheduled_at: null`, and `parseISO(null)` throws in date-fns v3.
 */
export function parseIsoMs(iso) {
  if (typeof iso !== "string" || iso.length === 0) return NaN;
  try {
    const t = parseISO(iso).getTime();
    return Number.isFinite(t) ? t : NaN;
  } catch {
    return NaN;
  }
}

/** Smallest future scheduled_at ms across a list of posts, or Infinity
 *  when none are in the future. Primary key for "coming next first"
 *  ordering in ListView and TrainTrackView.
 */
export function nextUpcomingMs(posts, now = nowEstMs()) {
  let best = Infinity;
  for (const p of posts || []) {
    const t = parseIsoMs(p?.scheduled_at);
    if (Number.isFinite(t) && t > now && t < best) best = t;
  }
  return best;
}

/** Largest past-or-present scheduled_at ms, or -Infinity when none are
 *  past. Secondary key so the bottom "past" bucket lines up
 *  most-recent-first.
 */
export function latestPastMs(posts, now = nowEstMs()) {
  let best = -Infinity;
  for (const p of posts || []) {
    const t = parseIsoMs(p?.scheduled_at);
    if (Number.isFinite(t) && t <= now && t > best) best = t;
  }
  return best;
}

/** True when the naive ISO (written by toIsoLocal as an EST wall clock)
 *  is at or before the current EST wall clock. Used by PostForm and
 *  SeriesBuilder to block submission of past times — mirror of the
 *  backend `is_past_est` check in app/core/scheduling.py.
 */
export function isPastEst(iso) {
  if (!iso) return false;
  const m = String(iso).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
  );
  if (!m) return false;
  // Minute-precision comparison — seconds are ignored on both sides.
  const candidate = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ];
  const now = nowEstParts();
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] < now[i]) return true;
    if (candidate[i] > now[i]) return false;
  }
  return true;
}

export function splitIso(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
