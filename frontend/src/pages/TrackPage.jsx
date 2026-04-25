// /track route — Train Track board for series timelines.

import { useOutletContext } from "react-router-dom";
import TrainTrackView from "../components/traintrack/TrainTrackView";
import Icon from "../components/Icon";

export default function TrackPage() {
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
        <div className="label mb-1">Series timeline</div>
        <h1 className="ns-headline ns-headline-italic text-[28px] leading-none tracking-tight"
          style={{ color: "var(--ns-ink)", fontWeight: 500 }}>
          Train Track
        </h1>
      </div>

      {s.fetchError && (
        <div className="callout-error">
          <Icon name="alert-triangle" size={14} />
          <div className="whitespace-pre-wrap">{s.fetchError}</div>
        </div>
      )}

      <TrainTrackView
        series={s.seriesList}
        posts={s.allFlatPosts}
        onEditPost={s.openEditPost}
        onAutoSpace={s.handleAutoSpacePost}
        onOpenAgent={s.openAgent}
      />
    </div>
  );
}
