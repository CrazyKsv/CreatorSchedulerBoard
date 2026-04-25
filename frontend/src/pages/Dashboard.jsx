// Dashboard homepage — matches pic1 Option B exactly:
//   1. DashboardHero (weekly title + stats + Ask Agent CTA)
//   2. 2-column grid:
//      LEFT:  FeaturedSeriesCard (most recent active series) + StandaloneToday
//      RIGHT: UpcomingRail + AgentSuggestCard
//
// No ContentFilter, no List/Calendar/Track toggle, no ListView. Those
// live at their own routes (/list, /calendar, /track) and the sidebar
// is the only way to reach them.

import { useOutletContext } from "react-router-dom";
import DashboardHero from "../components/DashboardHero";
import FeaturedSeriesCard from "../components/FeaturedSeriesCard";
import StandaloneToday from "../components/StandaloneToday";
import UpcomingRail from "../components/UpcomingRail";
import AgentSuggestCard from "../components/AgentSuggestCard";
import Icon from "../components/Icon";
import { nowEstMs, parseIsoMs } from "../components/utils";

export default function Dashboard() {
  const s = useOutletContext();

  if (s.loading) {
    return (
      <div
        className="rounded-lg p-10 text-center text-[13px]"
        style={{
          background: "var(--ns-panel)",
          border: "1px dashed var(--ns-line-2)",
          color: "var(--ns-ink-muted)",
        }}
      >
        Loading your schedule…
      </div>
    );
  }

  // Pick the "featured" series: prefer a non-archived series with the
  // earliest upcoming post, falling back to the most recently updated.
  // `nowEstMs()` keeps "upcoming" anchored to EST wall-clock (project
  // convention) so the featured pick doesn't drift for browsers outside
  // EST.
  const now = nowEstMs();
  const candidateSeries = s.seriesList.filter((x) => !x.archived_at);
  const featured = [...candidateSeries]
    .sort((a, b) => {
      const nextA = Math.min(
        ...(a.posts || [])
          .map((p) => parseIsoMs(p.scheduled_at))
          .filter((t) => Number.isFinite(t) && t > now),
        Number.POSITIVE_INFINITY
      );
      const nextB = Math.min(
        ...(b.posts || [])
          .map((p) => parseIsoMs(p.scheduled_at))
          .filter((t) => Number.isFinite(t) && t > now),
        Number.POSITIVE_INFINITY
      );
      return nextA - nextB;
    })[0];

  // Collapse featured + siblings into a single card by family.
  const featuredFamily = featured
    ? candidateSeries.filter(
        (m) => (m.family_id ?? m.id) === (featured.family_id ?? featured.id)
      )
    : [];

  return (
    <div className="space-y-5">
      {s.fetchError && (
        <div className="callout-error">
          <Icon name="alert-triangle" size={14} />
          <div className="whitespace-pre-wrap">{s.fetchError}</div>
        </div>
      )}

      <DashboardHero
        posts={s.postsList}
        series={s.seriesList}
        allFlatPosts={s.allFlatPosts}
        stats={s.stats}
        onOpenAgent={s.openAgent}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
        {/* LEFT — featured series + standalone today */}
        <div className="space-y-5 min-w-0">
          {featuredFamily.length > 0 ? (
            <FeaturedSeriesCard
              family={featuredFamily}
              onEditPost={s.openEditPost}
              onOpenSeries={() => s.navigate("/track")}
            />
          ) : (
            <div
              className="rounded-[14px] p-8 text-center text-[13px]"
              style={{
                background: "var(--ns-panel)",
                border: "1px dashed var(--ns-line-2)",
                color: "var(--ns-ink-muted)",
              }}
            >
              No series in flight. <button
                type="button"
                className="underline"
                style={{ color: "#5eead4", background: "transparent", border: "none", cursor: "pointer" }}
                onClick={s.openNewSeries}
              >Start one</button>.
            </div>
          )}

          <StandaloneToday
            posts={s.allFlatPosts}
            onEditPost={s.openEditPost}
            onOpenList={() => s.navigate("/list")}
          />
        </div>

        {/* RIGHT — upcoming + agent suggests */}
        <div className="space-y-5">
          <UpcomingRail
            posts={s.allFlatPosts}
            onSelectPost={s.openEditPost}
          />
          <AgentSuggestCard onOpen={s.openAgent} />
        </div>
      </div>
    </div>
  );
}
