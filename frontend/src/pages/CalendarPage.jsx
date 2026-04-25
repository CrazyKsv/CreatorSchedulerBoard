// /calendar route — full-width CalendarView.

import { useOutletContext } from "react-router-dom";
import CalendarView from "../components/CalendarView";
import Icon from "../components/Icon";

export default function CalendarPage() {
  const s = useOutletContext();

  if (s.loading) {
    return (
      <div className="rounded-lg p-10 text-center text-[13px]"
        style={{
          background: "var(--ns-panel)",
          border: "1px dashed var(--ns-line-2)",
          color: "var(--ns-ink-muted)",
        }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="label mb-1">Content schedule</div>
        <h1 className="ns-headline ns-headline-italic text-[28px] leading-none tracking-tight"
          style={{ color: "var(--ns-ink)", fontWeight: 500 }}>
          Calendar
        </h1>
      </div>

      {s.fetchError && (
        <div className="callout-error">
          <Icon name="alert-triangle" size={14} />
          <div className="whitespace-pre-wrap">{s.fetchError}</div>
        </div>
      )}

      <CalendarView
        posts={s.allFlatPosts}
        onSelectEvent={(p) => {
          if (p.series_id) return;
          s.openEditPost(p);
        }}
      />
    </div>
  );
}
