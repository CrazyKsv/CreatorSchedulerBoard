// Neon Studio retrofit of ListView.
//
// Changes vs warm:
//   • Dark card on empty state, Fraunces italic title.
//   • Day-grouped headers: day-of-week in Fraunces italic, full date in
//     JetBrains Mono, hairline divider underneath.
//   • Count pill on the right uses --ns-ink-faint for a less-loud tally.
//   • Passes onAutoSpace + conflictsByPostId through to SeriesCard's post
//     rail so inline conflict remediation can happen there — optional for
//     now (SeriesCard will use it once the full conflict-detection wiring
//     lands in Dashboard).

import { useMemo } from "react";
import { format } from "date-fns";
import Icon from "./Icon";
import PostCard from "./PostCard";
import SeriesCard from "./SeriesCard";
import { latestPastMs, nextUpcomingMs, nowEstMs } from "./utils";

function familyAnchor(s) {
  return s.family_id ?? s.id;
}

function postsOf(item) {
  if (item.kind === "post") return [item.data];
  return (item.members || []).flatMap((m) => m.posts || []);
}

export default function ListView({
  posts,
  series,
  contentFilter = "all",
  onEditPost,
  onDeletePost,
  onArchivePost,
  onUnarchivePost,
  onArchiveSeries,
  onUnarchiveSeries,
  onDeleteSeries,
  onCloneSeries,
  onNewPost,
  onNewSeries,
}) {
  const standalonePosts = useMemo(
    () => posts.filter((p) => !p.series_id),
    [posts]
  );

  const filtered = useMemo(() => {
    const showStandalone = contentFilter !== "series";
    const showSeries = contentFilter !== "posts";

    const familyMap = new Map();
    if (showSeries) {
      for (const s of series) {
        const key = familyAnchor(s);
        if (!familyMap.has(key)) familyMap.set(key, []);
        familyMap.get(key).push(s);
      }
    }
    const familyItems = [];
    for (const [key, membersRaw] of familyMap) {
      const members = [...membersRaw].sort((a, b) => {
        const aIsAnchor = (a.family_id ?? a.id) === a.id;
        const bIsAnchor = (b.family_id ?? b.id) === b.id;
        if (aIsAnchor && !bIsAnchor) return -1;
        if (!aIsAnchor && bIsAnchor) return 1;
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return a.id - b.id;
      });
      familyItems.push({ kind: "series", id: `family-${key}`, members });
    }

    return [
      ...(showStandalone
        ? standalonePosts.map((p) => ({
            kind: "post",
            id: `post-${p.id}`,
            data: p,
          }))
        : []),
      ...familyItems,
    ];
  }, [standalonePosts, series, contentFilter]);

  // Partition into three buckets: upcoming items (grouped by the day of
  // their next-upcoming post, ascending), a single Past group (descending
  // by most-recently-shipped), and a single Unscheduled group at the end.
  const grouped = useMemo(() => {
    const now = nowEstMs();
    const upcomingByDay = new Map();
    const past = [];
    const unscheduled = [];

    for (const it of filtered) {
      const posts = postsOf(it);
      const next = nextUpcomingMs(posts, now);
      if (Number.isFinite(next)) {
        const nextDate = new Date(next);
        const key = format(nextDate, "yyyy-MM-dd");
        if (!upcomingByDay.has(key)) {
          upcomingByDay.set(key, { kind: "day", key, date: nextDate, items: [] });
        }
        upcomingByDay.get(key).items.push({ it, sortKey: next });
        continue;
      }
      const latest = latestPastMs(posts, now);
      if (latest !== -Infinity) {
        past.push({ it, sortKey: latest });
      } else {
        unscheduled.push({ it });
      }
    }

    const upcomingGroups = [...upcomingByDay.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((g) => ({
        ...g,
        items: g.items
          .sort((a, b) => a.sortKey - b.sortKey)
          .map(({ it }) => it),
      }));

    const out = [...upcomingGroups];
    if (past.length > 0) {
      out.push({
        kind: "past",
        key: "__past__",
        items: past
          .sort((a, b) => b.sortKey - a.sortKey)
          .map(({ it }) => it),
      });
    }
    if (unscheduled.length > 0) {
      out.push({
        kind: "unscheduled",
        key: "__unscheduled__",
        items: unscheduled.map(({ it }) => it),
      });
    }
    return out;
  }, [filtered]);

  const hasAnyItems = grouped.some((g) => g.items.length > 0);

  if (!hasAnyItems) {
    let iconName = "inbox";
    let title = "Nothing scheduled yet";
    let body = "Create a new post or series to get started.";
    let ctas = [
      onNewPost && { label: "New post", icon: "plus", primary: true, onClick: onNewPost },
      onNewSeries && { label: "New series", icon: "git-branch", onClick: onNewSeries },
    ].filter(Boolean);

    if (contentFilter === "posts") {
      iconName = "list";
      title = "No standalone posts yet";
      body = "Create your first post — it'll show up here as soon as it's scheduled.";
      ctas = [
        onNewPost && { label: "New post", icon: "plus", primary: true, onClick: onNewPost },
      ].filter(Boolean);
    } else if (contentFilter === "series") {
      iconName = "git-branch";
      title = "No series yet";
      body =
        "A series walks your audience through Teaser → Announcement → Follow-up → Reminder on one channel. Create one to see it here.";
      ctas = [
        onNewSeries && { label: "New series", icon: "git-branch", primary: true, onClick: onNewSeries },
      ].filter(Boolean);
    }

    return (
      <div className="card p-12 text-center" style={{ color: "var(--ns-ink-muted)" }}>
        <Icon name={iconName} size={28} className="mx-auto mb-3" />
        <div
          className="ns-headline ns-headline-italic"
          style={{ fontSize: 22, color: "var(--ns-ink)", fontWeight: 500 }}
        >
          {title}
        </div>
        <div className="text-[13px] mt-2 max-w-sm mx-auto leading-relaxed">
          {body}
        </div>
        {ctas.length > 0 && (
          <div className="mt-5 flex items-center justify-center gap-2">
            {ctas.map((c) => (
              <button
                key={c.label}
                type="button"
                className={c.primary ? "btn btn-primary" : "btn"}
                onClick={c.onClick}
              >
                <Icon name={c.icon} size={14} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {grouped.map((g) => (
        <div key={g.key}>
          <div className="flex items-baseline gap-3 mb-3 py-2">
            <h3 className="text-[15px] tracking-tight flex items-baseline gap-2.5">
              {g.kind === "day" ? (
                <>
                  <span
                    className="ns-headline ns-headline-italic"
                    style={{ fontSize: 18, fontWeight: 500, color: "var(--ns-ink)" }}
                  >
                    {format(g.date, "EEEE")}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--ns-ink-muted)" }}>
                    {format(g.date, "MMM d")}
                  </span>
                </>
              ) : (
                <span
                  className="ns-headline ns-headline-italic"
                  style={{ fontSize: 18, fontWeight: 500, color: "var(--ns-ink)" }}
                >
                  {g.kind === "past" ? "Past" : "Unscheduled"}
                </span>
              )}
            </h3>
            <div className="flex-1 hairline" />
            <span className="font-mono text-[10.5px]" style={{ color: "var(--ns-ink-faint)" }}>
              {g.items.length} item{g.items.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {g.items.map((it) =>
              it.kind === "post" ? (
                <PostCard
                  key={it.id}
                  post={it.data}
                  onEdit={onEditPost}
                  onDelete={onDeletePost}
                  onArchive={onArchivePost}
                  onUnarchive={onUnarchivePost}
                />
              ) : (
                <SeriesCard
                  key={it.id}
                  members={it.members}
                  onEditPost={onEditPost}
                  onDeletePost={onDeletePost}
                  onArchivePost={onArchivePost}
                  onUnarchivePost={onUnarchivePost}
                  onArchiveSeries={onArchiveSeries}
                  onUnarchiveSeries={onUnarchiveSeries}
                  onDeleteSeries={onDeleteSeries}
                  onCloneSeries={onCloneSeries}
                />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
