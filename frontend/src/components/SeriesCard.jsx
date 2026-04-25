// Neon Studio retrofit of SeriesCard.
//
// Visual changes vs the warm build:
//   • Cream→white gradient replaced with cyan glow wash (decision A1).
//   • Title h2 set in Fraunces italic for editorial weight.
//   • Terracotta accents (oklch 25°) → Neon cyan tokens.
//   • "Published" state switched from forest green to emerald #10B981
//     with outer glow (decision B) — visible on .node.published and on
//     the overlay check-circle.
//   • Platform tabs: active tab inverts to cyan-on-ink instead of
//     black-on-white.
//   • Post cards inside the rail use the dark ns-panel-raised surface.
//
// Behaviour is byte-identical to the original: stable active tab,
// collapse toggle, Meatball render-props, clone guardrails, archived
// dimming.

import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { Meatball, PlatformDot, StatusChip } from "./listPrimitives";
import {
  PLATFORMS,
  PLATFORM_FALLBACK_COLOR,
  fmtDate,
  fmtDateShort,
  fmtTime,
  getPlatformLabel,
} from "./utils";

export default function SeriesCard({
  members,
  series, // back-compat single-series shape
  onEditPost,
  onDeletePost,
  onArchivePost,
  onUnarchivePost,
  onArchiveSeries,
  onUnarchiveSeries,
  onDeleteSeries,
  onCloneSeries,
}) {
  const memberList = useMemo(() => {
    if (Array.isArray(members) && members.length > 0) return members;
    return series ? [series] : [];
  }, [members, series]);

  const memberKey = memberList.map((m) => m.id).join(",");

  const [activeId, setActiveId] = useState(() => memberList[0]?.id ?? null);
  useEffect(() => {
    if (!memberList.length) return;
    if (!memberList.some((m) => m.id === activeId)) {
      setActiveId(memberList[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey]);

  const [collapsed, setCollapsed] = useState(false);

  if (memberList.length === 0) return null;

  const activeMember =
    memberList.find((m) => m.id === activeId) || memberList[0];
  const isFamily = memberList.length >= 2;
  const isArchivedSeries = activeMember.status === "archived";

  const posts = [...(activeMember.posts || [])].sort((a, b) => {
    if (a.series_position != null && b.series_position != null) {
      return a.series_position - b.series_position;
    }
    const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
    const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
    return ta - tb;
  });

  const counts = posts.reduce(
    (acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }),
    {}
  );
  const publishedCount = counts.published || 0;

  const firstAt = posts[0]?.scheduled_at;
  const lastAt = posts[posts.length - 1]?.scheduled_at;

  const seriesPlatform = activeMember.platform || posts[0]?.platform || null;

  const takenPlatforms = new Set(
    memberList.map((m) => m.platform).filter(Boolean)
  );
  const canClone = takenPlatforms.size < Object.keys(PLATFORMS).length;

  // Delete-gating (state-logic invariant):
  // Once ANY post in this series is published, the series has a public
  // footprint we can't retroactively unwind. Hard-delete is off the table —
  // the only allowed teardown is Archive (local soft-delete). We surface
  // this by swapping the Delete item for a locked, tooltip'd stand-in so
  // the constraint is explicit rather than silently missing.
  const hasPublished = publishedCount > 0;

  return (
    <section
      className="card ns-series-card fade-in"
      style={{
        // Cyan glow wash (A1). Tapers to transparent ~160px down so the
        // rail area below reads as pure panel.
        background:
          "linear-gradient(180deg, rgba(94,234,212,0.06) 0%, transparent 160px), var(--ns-panel)",
        borderColor: "rgba(94,234,212,0.18)",
        position: "relative",
        opacity: isArchivedSeries ? 0.55 : 1,
      }}
    >
      {/* Top 1px cyan hairline — reinforces the "series container" cue
          without competing with the inner post cards' borders. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "0 0 auto 0",
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(94,234,212,0.45), transparent)",
          borderTopLeftRadius: "inherit",
          borderTopRightRadius: "inherit",
        }}
      />

      <header className="px-5 pt-4 pb-4 flex items-start gap-3">
        <div
          className="flex items-center justify-center flex-none"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "rgba(94,234,212,0.10)",
            color: "#5eead4",
            marginTop: 2,
            boxShadow: "inset 0 0 0 1px rgba(94,234,212,0.25)",
          }}
        >
          <Icon name="git-branch" size={15} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="ns-eyebrow" style={{ color: "#5eead4" }}>
              Content series
            </span>
            {isFamily && (
              <span
                className="inline-flex items-center gap-1 font-mono text-[10.5px] font-medium px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(94,234,212,0.10)",
                  color: "#5eead4",
                  border: "1px solid rgba(94,234,212,0.25)",
                }}
                title="This series runs on multiple platforms"
              >
                <Icon name="copy" size={10} />
                {memberList.length} platforms
              </span>
            )}
            {isArchivedSeries && <StatusChip status="archived" />}
            {publishedCount > 0 && (
              <>
                <span style={{ color: "var(--ns-ink-faint)" }}>·</span>
                <span
                  className="inline-flex items-center gap-1 font-mono text-[10.5px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(16,185,129,0.14)",
                    color: "#34d399",
                    border: "1px solid rgba(16,185,129,0.40)",
                    boxShadow: "0 0 10px rgba(16,185,129,0.25)",
                  }}
                >
                  <Icon name="check" size={10} />
                  {publishedCount}/{posts.length} published
                </span>
              </>
            )}
          </div>

          <h2
            className="ns-headline ns-headline-italic mt-1 leading-tight"
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "var(--ns-ink)",
              letterSpacing: "-0.01em",
            }}
          >
            {activeMember.title}
          </h2>

          {activeMember.description && (
            <p
              className="text-[12.5px] mt-1 leading-relaxed"
              style={{ color: "var(--ns-ink-muted)" }}
            >
              {activeMember.description}
            </p>
          )}

          {firstAt && lastAt && (
            <div
              className="flex items-center gap-2 mt-2 font-mono text-[11px]"
              style={{ color: "var(--ns-ink-muted)" }}
            >
              <Icon name="calendar" size={11} />
              <span>
                {fmtDateShort(firstAt)} → {fmtDateShort(lastAt)}
              </span>
              <span style={{ color: "var(--ns-ink-faint)" }}>·</span>
              <span>
                {posts.length} post{posts.length === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {!isFamily && seriesPlatform && (
            <div
              className="flex items-center gap-1.5 mt-2 font-mono text-[11px]"
              style={{ color: "var(--ns-ink-2)" }}
            >
              <PlatformDot platform={seriesPlatform} />
              {getPlatformLabel(seriesPlatform)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-none">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <Icon name={collapsed ? "chevron-down" : "chevron-up"} size={14} />
          </button>
          <Meatball label="Series actions">
            {(close) => (
              <>
                <div className="menu-hint">
                  {isFamily
                    ? `Active: ${getPlatformLabel(seriesPlatform)}`
                    : "Series"}
                </div>
                {isArchivedSeries ? (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onUnarchiveSeries?.(activeMember);
                    }}
                  >
                    <Icon name="archive-restore" size={14} />
                    Unarchive series
                  </button>
                ) : (
                  <>
                    {canClone && (
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          onCloneSeries?.(activeMember);
                        }}
                      >
                        <Icon name="copy" size={14} />
                        Clone to another platform
                      </button>
                    )}
                    {canClone && <div className="menu-sep" />}
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        onArchiveSeries?.(activeMember);
                      }}
                    >
                      <Icon name="archive" size={14} />
                      Archive series
                    </button>
                    <div className="menu-sep" />
                    {hasPublished ? (
                      <button
                        type="button"
                        disabled
                        title="Can't delete — this series already has published posts. Archive it instead to hide it from the schedule without unpublishing."
                        style={{ opacity: 0.45, cursor: "not-allowed" }}
                      >
                        <Icon name="lock" size={14} />
                        Delete unavailable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          close();
                          onDeleteSeries?.(activeMember);
                        }}
                      >
                        <Icon name="trash-2" size={14} />
                        Delete series
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </Meatball>
        </div>
      </header>

      {isFamily && (
        <div
          className="px-5 pb-3 pt-0 flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Platform variants of this series"
        >
          {memberList.map((m) => {
            const active = m.id === activeMember.id;
            const archived = m.status === "archived";
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveId(m.id)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-mono transition-colors"
                }
                style={
                  active
                    ? {
                        background: "rgba(94,234,212,0.14)",
                        color: "#5eead4",
                        border: "1px solid rgba(94,234,212,0.55)",
                        boxShadow: "0 0 12px rgba(94,234,212,0.25)",
                      }
                    : {
                        background: "transparent",
                        color: "var(--ns-ink-2)",
                        border: "1px solid var(--ns-line-2)",
                        ...(archived
                          ? { textDecoration: "line-through", opacity: 0.55 }
                          : null),
                      }
                }
                title={
                  archived
                    ? `${getPlatformLabel(m.platform)} · archived`
                    : getPlatformLabel(m.platform)
                }
              >
                <PlatformDot platform={m.platform} />
                {getPlatformLabel(m.platform)}
              </button>
            );
          })}
        </div>
      )}

      {!collapsed && (
        <div
          className="hairline"
          style={{ background: "rgba(94,234,212,0.14)" }}
        />
      )}

      {!collapsed && posts.length > 0 && (
        <div className="relative px-5 pt-5 pb-5">
          <div className="rail rail-cyan" />
          <ul className="flex flex-col gap-5">
            {posts.map((post) => {
              const meta = PLATFORMS[post.platform] || {
                label: post.platform,
                color: PLATFORM_FALLBACK_COLOR,
              };
              const isPublished = post.status === "published";
              const isArchivedPost = post.status === "archived";
              const isCanceled = post.status === "canceled";
              const interactive = !isArchivedPost && !isCanceled;

              const nodeClasses = [
                "node",
                "block",
                isPublished && "published",
                isArchivedPost && "archived",
                isCanceled && "canceled",
                post.status === "scheduled" && "filled",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <li
                  key={post.id}
                  className="relative flex items-start gap-4 pl-0"
                >
                  <div
                    className="relative"
                    style={{ minWidth: 40, paddingTop: 6 }}
                  >
                    <span className={nodeClasses} style={{ marginLeft: 15 }} />
                    {isPublished && (
                      <span
                        className="absolute flex items-center justify-center"
                        style={{
                          left: 11,
                          top: 2,
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          background: "#10B981",
                          color: "#0a0b10",
                          // Ring + glow so the emerald pops off the rail.
                          boxShadow:
                            "0 0 0 3px var(--ns-panel), 0 0 12px rgba(16,185,129,0.55)",
                        }}
                        title="Published"
                      >
                        <Icon name="check" size={11} color="#0a0b10" />
                      </span>
                    )}
                  </div>

                  <div
                    onClick={() => interactive && onEditPost?.(post)}
                    className={
                      "flex-1 ns-panel-raised px-4 py-3 group " +
                      (interactive
                        ? "cursor-pointer hover:bg-panel-2"
                        : "cursor-default")
                    }
                    style={{
                      opacity: isArchivedPost ? 0.55 : isCanceled ? 0.5 : 1,
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {post.stage && (
                        <span
                          className="font-mono text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            background: "rgba(94,234,212,0.10)",
                            color: "#5eead4",
                            border: "1px solid rgba(94,234,212,0.22)",
                          }}
                        >
                          {post.stage}
                        </span>
                      )}
                      <PlatformDot platform={post.platform} />
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: "var(--ns-ink-2)" }}
                      >
                        {meta.label}
                      </span>
                      {post.scheduled_at && (
                        <>
                          <span style={{ color: "var(--ns-ink-faint)" }}>·</span>
                          <span
                            className="font-mono text-[11px]"
                            style={{ color: "var(--ns-ink-muted)" }}
                          >
                            {fmtDate(post.scheduled_at)} ·{" "}
                            {fmtTime(post.scheduled_at)}
                          </span>
                        </>
                      )}
                      <StatusChip status={post.status} />

                      <span className="flex-1" />

                      <div
                        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isArchivedPost ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            title="Restore post"
                            onClick={() => onUnarchivePost?.(post)}
                          >
                            <Icon name="archive-restore" size={13} />
                          </button>
                        ) : isPublished ? (
                          <>
                            {post.published_url && (
                              <a
                                href={post.published_url}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-ghost"
                                title="View on platform"
                              >
                                <Icon name="external-link" size={13} />
                              </a>
                            )}
                            <Meatball label="Post actions">
                              {(close) => (
                                <>
                                  <div className="menu-hint">Published post</div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      close();
                                      onArchivePost?.(post);
                                    }}
                                  >
                                    <Icon name="archive" size={14} />
                                    Archive
                                  </button>
                                </>
                              )}
                            </Meatball>
                          </>
                        ) : !isCanceled ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              title="Edit post"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditPost?.(post);
                              }}
                            >
                              <Icon name="edit" size={13} />
                            </button>
                            <Meatball label="Post actions">
                              {(close) => (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      close();
                                      onArchivePost?.(post);
                                    }}
                                  >
                                    <Icon name="archive" size={14} />
                                    Archive
                                  </button>
                                  <div className="menu-sep" />
                                  {/* Same guard as the series-level menu:
                                      once any sibling has published, the
                                      family has a public footprint and we
                                      stop offering hard-delete on its
                                      scheduled siblings. They can still be
                                      archived. */}
                                  {hasPublished ? (
                                    <button
                                      type="button"
                                      disabled
                                      title="Can't delete — a sibling in this series is already published. Archive this post instead."
                                      style={{ opacity: 0.45, cursor: "not-allowed" }}
                                    >
                                      <Icon name="lock" size={14} />
                                      Delete unavailable
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="danger"
                                      onClick={() => {
                                        close();
                                        onDeletePost?.(post);
                                      }}
                                    >
                                      <Icon name="trash-2" size={14} />
                                      Delete
                                    </button>
                                  )}
                                </>
                              )}
                            </Meatball>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <h4
                      className="text-[13.5px] font-medium mt-1.5 leading-snug"
                      style={{
                        color: "var(--ns-ink)",
                        textDecoration: isCanceled ? "line-through" : "none",
                      }}
                    >
                      {post.title}
                    </h4>
                    {post.body && (
                      <p
                        className="text-[12.5px] mt-1 leading-relaxed line-clamp-1"
                        style={{ color: "var(--ns-ink-muted)" }}
                      >
                        {post.body}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
