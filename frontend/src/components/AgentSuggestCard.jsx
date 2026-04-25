// Right-rail "Agent suggests" card — magenta → violet gradient panel with
// a single CTA that opens the SchedulerAgent. Copy adapts to what's in
// the schedule: conflicts first, then empty-week nudge, else a neutral
// planning prompt. Deliberately short — a long card would compete with
// the dashboard hero for attention.

import Icon from "./Icon";

export default function AgentSuggestCard({
  conflictCount = 0,
  nextConflictLabel,
  shippingThisWeek = 0,
  onOpen,
}) {
  let actionCount = 1;
  let body;
  if (conflictCount > 0) {
    actionCount = Math.min(3, conflictCount + 1);
    body = (
      <>
        &ldquo;Auto-space the{" "}
        {nextConflictLabel ? (
          <em
            style={{
              color: "#5eead4",
              fontStyle: "italic",
              whiteSpace: "nowrap",
            }}
          >
            {nextConflictLabel}
          </em>
        ) : (
          "current"
        )}{" "}
        conflict and line up a fresh{" "}
        <em style={{ color: "#5eead4", fontStyle: "italic" }}>series</em> for
        next month?&rdquo;
      </>
    );
  } else if (shippingThisWeek === 0) {
    actionCount = 2;
    body = (
      <>
        &ldquo;Want me to draft a 4-stage{" "}
        <em style={{ color: "#5eead4", fontStyle: "italic" }}>series</em> and
        slot it across this week?&rdquo;
      </>
    );
  } else {
    actionCount = 2;
    body = (
      <>
        &ldquo;Clone your best-performing series to another platform, or fill
        a{" "}
        <em style={{ color: "#5eead4", fontStyle: "italic" }}>quiet day</em>{" "}
        with a teaser?&rdquo;
      </>
    );
  }

  return (
    <div
      style={{
        background:
          "linear-gradient(160deg, rgba(244,114,182,0.14), rgba(167,139,250,0.14))",
        border: "1px solid rgba(244,114,182,0.28)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className="flex items-center justify-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "linear-gradient(135deg, #f472b6, #a78bfa)",
            color: "#0a0b10",
            flexShrink: 0,
          }}
        >
          <Icon name="sparkles" size={15} />
        </div>
        <div className="min-w-0">
          <div
            className="text-[13px]"
            style={{ color: "var(--ns-ink)", fontWeight: 600, lineHeight: 1.2 }}
          >
            Agent suggests
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 9.5,
              color: "var(--ns-ink-muted)",
              letterSpacing: "0.08em",
              marginTop: 2,
            }}
          >
            {actionCount} ACTION{actionCount === 1 ? "" : "S"} READY
          </div>
        </div>
      </div>

      <div
        className="text-[12px]"
        style={{
          color: "var(--ns-ink-2)",
          lineHeight: 1.5,
          marginBottom: 12,
        }}
      >
        {body}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="w-full inline-flex items-center justify-center gap-1.5"
        style={{
          background: "var(--ns-ink)",
          color: "var(--ns-bg)",
          border: "none",
          borderRadius: 8,
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Open Agent
        <Icon name="arrow-right" size={12} />
      </button>
    </div>
  );
}
