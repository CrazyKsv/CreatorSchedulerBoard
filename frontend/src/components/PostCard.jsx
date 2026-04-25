// Neon Studio retrofit of PostCard (standalone post row in ListView).
//
// Visuals:
//   • Dark card surface, cyan-scheduled / emerald-published chips.
//   • Platform brand tile keeps its full-color swatch (key visual cue);
//     gains a subtle ring to read against the dark panel.
//   • Metadata row uses JetBrains Mono with --ns-ink-muted.
//
// Delete-gating (state-logic invariant):
// A standalone post has no series siblings, so the "already publishing"
// constraint doesn't apply here the way it does in SeriesCard — the only
// rule is the original: no Delete on a Published post (archive only).
// That's already enforced below (the Delete item only appears in the
// `!isArchived && !isPublished` branch).

import Icon from "./Icon";
import { Meatball, StatusChip } from "./listPrimitives";
import { PLATFORMS, PLATFORM_FALLBACK_COLOR, fmtDate, fmtTime } from "./utils";

export default function PostCard({
  post,
  onEdit,
  onDelete,
  onArchive,
  onUnarchive,
}) {
  const meta = PLATFORMS[post.platform] || {
    label: post.platform,
    color: PLATFORM_FALLBACK_COLOR,
    short: "?",
  };
  const isPublished = post.status === "published";
  const isArchived = post.status === "archived";
  const interactive = !isArchived;

  function handleCardClick() {
    if (!interactive) return;
    onEdit?.(post);
  }

  return (
    <div
      onClick={handleCardClick}
      className={
        "card p-4 flex items-start gap-4 group transition-colors " +
        (interactive ? "hover:bg-panel-2 cursor-pointer" : "cursor-default")
      }
      style={{ position: "relative", opacity: isArchived ? 0.55 : 1 }}
    >
      <div
        className="flex flex-col items-center gap-2 pt-0.5"
        style={{ minWidth: 40 }}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-mono font-semibold"
          style={{
            background: meta.color,
            // Ring so bright brand tiles don't halate against the dark panel.
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.05)",
            filter: isArchived ? "grayscale(0.5)" : "none",
            // X (Twitter) on dark: #000 tile would disappear — inverse the
            // swatch so it still reads.
            ...(post.platform === "twitter"
              ? { background: "#ffffff", color: "#0a0b10" }
              : null),
          }}
        >
          {meta.short}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="ns-eyebrow">{meta.label}</span>
          {post.scheduled_at && (
            <>
              <span style={{ color: "var(--ns-ink-faint)" }}>·</span>
              <span className="font-mono text-[11px]" style={{ color: "var(--ns-ink-muted)" }}>
                {fmtTime(post.scheduled_at)}
              </span>
              <span style={{ color: "var(--ns-ink-faint)" }}>·</span>
              <span className="font-mono text-[11px]" style={{ color: "var(--ns-ink-muted)" }}>
                {fmtDate(post.scheduled_at)}
              </span>
            </>
          )}
          <StatusChip status={post.status} />
          {post.last_publish_attempt_at && post.last_publish_error && (
            <span
              title={`Last auto-publish attempt failed at ${new Date(post.last_publish_attempt_at).toLocaleString()}. The system will retry.`}
              className="font-mono text-[10.5px]"
              style={{
                color: "var(--ns-amber, #ffb547)",
                marginLeft: 4,
                letterSpacing: "0.06em",
              }}
            >
              ⚠ retry pending
            </span>
          )}
        </div>
        <h3 className="text-[14.5px] font-medium leading-snug truncate" style={{ color: "var(--ns-ink)" }}>
          {post.title}
        </h3>
        {post.body && (
          <p className="text-[13px] mt-1 line-clamp-2 leading-relaxed" style={{ color: "var(--ns-ink-muted)" }}>
            {post.body}
          </p>
        )}
        <div className="flex items-center gap-3 mt-3 text-[11.5px]" style={{ color: "var(--ns-ink-muted)" }}>
          <span className="inline-flex items-center gap-1">
            <Icon name="user" size={11} />
            {post.author || "unknown"}
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {isArchived && (
          <button
            type="button"
            className="btn btn-ghost"
            title="Restore post"
            onClick={() => onUnarchive?.(post)}
          >
            <Icon name="archive-restore" size={13} />
          </button>
        )}
        {!isArchived && isPublished && (
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
                  <button type="button" onClick={() => { close(); onArchive?.(post); }}>
                    <Icon name="archive" size={14} />
                    Archive
                  </button>
                </>
              )}
            </Meatball>
          </>
        )}
        {!isArchived && !isPublished && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              title="Edit post"
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(post);
              }}
            >
              <Icon name="edit" size={13} />
            </button>
            <Meatball label="Post actions">
              {(close) => (
                <>
                  <button type="button" onClick={() => { close(); onArchive?.(post); }}>
                    <Icon name="archive" size={14} />
                    Archive
                  </button>
                  <div className="menu-sep" />
                  <button type="button" className="danger" onClick={() => { close(); onDelete?.(post); }}>
                    <Icon name="trash-2" size={14} />
                    Delete
                  </button>
                </>
              )}
            </Meatball>
          </>
        )}
      </div>
    </div>
  );
}
