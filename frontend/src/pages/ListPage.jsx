// /list route — full ListView (day-grouped posts and series).
// All modal state lives in Layout; we just wire callbacks.

import { useOutletContext } from "react-router-dom";
import ListView from "../components/ListView";
import Icon from "../components/Icon";

export default function ListPage() {
  const s = useOutletContext();

  if (s.loading) {
    return (
      <div className="rounded-lg p-10 text-center text-[13px]"
        style={{
          background: "var(--ns-panel)",
          border: "1px dashed var(--ns-line-2)",
          color: "var(--ns-ink-muted)",
        }}>
        Loading your schedule…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-4 mb-2">
        <div>
          <div className="label mb-1">Content schedule</div>
          <h1 className="ns-headline ns-headline-italic text-[28px] leading-none tracking-tight"
            style={{ color: "var(--ns-ink)", fontWeight: 500 }}>
            All items
          </h1>
        </div>
      </div>

      {s.fetchError && (
        <div className="callout-error">
          <Icon name="alert-triangle" size={14} />
          <div className="whitespace-pre-wrap">{s.fetchError}</div>
        </div>
      )}

      <ListView
        posts={s.postsList}
        series={s.seriesList}
        contentFilter="all"
        onNewPost={s.openNewPost}
        onNewSeries={s.openNewSeries}
        onEditPost={s.openEditPost}
        onDeletePost={(p) =>
          s.setConfirm({
            title: "Delete post?",
            body: `"${p.title}" will be removed permanently.`,
            tone: "danger",
            confirmLabel: "Delete post",
            onConfirm: () => s.doDeletePost(p),
          })
        }
        onArchivePost={(p) =>
          s.setConfirm({
            title: "Archive post?",
            body: p.status === "published"
              ? "The published post will be hidden from active views and excluded from the 15-minute rule. You can unarchive later."
              : "The post will be hidden from active views. You can unarchive later.",
            tone: "warning",
            icon: "archive",
            confirmLabel: "Archive",
            onConfirm: () => s.doArchivePost(p),
          })
        }
        onUnarchivePost={s.doUnarchivePost}
        onArchiveSeries={(series) =>
          s.setConfirm({
            title: "Archive series?",
            body: `"${series.title}" and all of its future posts will be archived (not canceled), along with published history, so the full timeline is preserved.`,
            tone: "warning",
            icon: "archive",
            confirmLabel: "Archive series",
            onConfirm: () => s.doArchiveSeries(series),
          })
        }
        onUnarchiveSeries={s.doUnarchiveSeries}
        onDeleteSeries={(series) =>
          s.setConfirm({
            title: "Delete series?",
            body: `"${series.title}" and all of its posts will be removed. If any post is published the server will reject the delete and you'll see a message asking you to archive instead.`,
            tone: "danger",
            confirmLabel: "Delete series",
            onConfirm: () => s.doDeleteSeries(series),
          })
        }
        onCloneSeries={s.openCloneSeries}
      />
    </div>
  );
}
