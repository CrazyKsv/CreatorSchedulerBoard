// Neon Studio retrofit of SeriesBuilder.
//
// Visuals:
//   • Full-bleed dark backdrop, scrollable; centered ns-panel form.
//   • Sticky header with Fraunces italic title + pinned violet info
//     banner (the 15-min rule reminder — ns-banner-info).
//   • Stage cards use .ns-stage-card with .ns-stage-error glow on
//     conflict or ordering violation.
//   • Inline per-stage conflict text uses ns-banner-danger color palette.
//   • Lock glyph on stage label uses ns-ink-faint (fixed-order marker).
//
// The autofill + clone semantics, ordering check, and conflict math are
// byte-identical to the original.

import { useMemo, useState } from "react";
import Icon from "./Icon";
import { PlatformDot } from "./listPrimitives";
import {
  PLATFORMS,
  STAGE_LABELS,
  checkPositionOrdering,
  findConflicts,
  getPlatformLabel,
  toIsoLocal,
} from "./utils";
import { seriesApi } from "../api/client";

function blankStage(label) {
  return { stage: label, title: "", body: "", date: "", time: "", titleTouched: false };
}

function suggestStageTitle(seriesName, stageLabel) {
  const name = seriesName.trim();
  return name ? `${name} — ${stageLabel}` : "";
}

function hydrateStages(initial) {
  const bySource = new Map((initial?.stages || []).map((s) => [s.stage, s]));
  return STAGE_LABELS.map((label) => {
    const src = bySource.get(label);
    if (!src) return blankStage(label);
    return {
      stage: label,
      title: src.title || "",
      body: src.body || "",
      date: src.date || "",
      time: src.time || "",
      titleTouched: Boolean(src.title),
    };
  });
}

const STAGE_ICONS = ["sparkles", "megaphone", "message-square", "bell"];

export default function SeriesBuilder({
  existingPosts = [],
  initial = null,
  onSaved,
  onCancel,
  onToast,
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [seriesPlatform, setSeriesPlatform] = useState(initial?.platform || "");
  const disabledPlatformSet = new Set(initial?.disabledPlatforms || []);
  const [stages, setStages] = useState(() =>
    initial ? hydrateStages(initial) : STAGE_LABELS.map(blankStage)
  );
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [offendingIndex, setOffendingIndex] = useState(null);

  const stageIsos = useMemo(() => stages.map((s) => toIsoLocal(s.date, s.time)), [stages]);
  const ordering = useMemo(() => checkPositionOrdering(stageIsos), [stageIsos]);

  const perStageConflicts = useMemo(() => {
    if (!seriesPlatform) return stages.map(() => []);
    const siblings = stages
      .map((s, i) => ({
        id: `__sib_${i}`,
        platform: seriesPlatform,
        scheduled_at: stageIsos[i],
        status: "scheduled",
      }))
      .filter((s) => s.scheduled_at);
    return stages.map((_, i) => {
      if (!stageIsos[i]) return [];
      const universe = [...existingPosts, ...siblings.filter((_, j) => j !== i)];
      return findConflicts(
        { platform: seriesPlatform, scheduled_at: stageIsos[i] },
        universe
      );
    });
  }, [stages, stageIsos, existingPosts, seriesPlatform]);

  const allFilled = stages.every((s) => s.title.trim() && s.date && s.time);
  const anyConflict = perStageConflicts.some((list) => list.length > 0);
  const canSubmit =
    title.trim() &&
    seriesPlatform &&
    allFilled &&
    !anyConflict &&
    !ordering &&
    !submitting;

  function updateStage(i, patch) {
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    setOffendingIndex(null);
    const payload = {
      title: title.trim(),
      description: description || null,
      stages: stages.map((s, i) => ({
        stage: s.stage,
        platform: seriesPlatform,
        title: s.title.trim(),
        body: s.body || null,
        scheduled_at: stageIsos[i],
      })),
    };
    if (initial?.sourceSeriesId) payload.source_series_id = initial.sourceSeriesId;
    try {
      const saved = await seriesApi.create(payload);
      onToast?.({ kind: "success", message: initial ? "Series cloned." : "Series created." });
      onSaved?.(saved);
    } catch (err) {
      setServerError(err.message);
      if (typeof err.offendingIndex === "number") setOffendingIndex(err.offendingIndex);
      onToast?.({ kind: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  const isClone = Boolean(initial);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-auto py-10"
      style={{
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      <form
        className="w-[760px] max-w-[94vw] ns-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          animation: "ns-overlay-in .18s cubic-bezier(.2,.9,.25,1) both",
          boxShadow: "0 50px 100px rgba(0,0,0,.70), 0 0 0 1px rgba(255,255,255,.04)",
        }}
      >
        <div
          className="sticky top-0 z-10"
          style={{ background: "var(--ns-panel)", borderBottom: "1px solid var(--ns-line)", borderTopLeftRadius: "inherit", borderTopRightRadius: "inherit" }}
        >
          <div className="flex items-center justify-between px-5 py-3.5">
            <h2
              className="ns-headline ns-headline-italic"
              style={{ fontSize: 20, fontWeight: 500, color: "var(--ns-ink)", letterSpacing: "-0.01em" }}
            >
              {isClone ? "Clone series to another platform" : "New series"}
              <span className="ns-eyebrow ml-3" style={{ fontSize: 10 }}>
                4-STAGE TEMPLATE
              </span>
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="btn btn-ghost"
              style={{ padding: 6 }}
              onClick={onCancel}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
          {/* FR-003 pinned banner — info category, not warning.
              Warning is reserved for active conflict states. */}
          <div className="px-5 pb-3">
            <div className="ns-banner ns-banner-info">
              <Icon name="info" size={14} />
              <span className="flex-1">
                {isClone
                  ? "Pick a different platform below. Posts on that platform must be at least 15 minutes apart from anything already scheduled there."
                  : "Posts on the same platform must be at least 15 minutes apart. Stages must be scheduled in order (Teaser → Reminder)."}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-[1fr_220px] gap-3">
            <label className="block">
              <span className="ns-eyebrow block mb-1.5">Series name</span>
              <input
                type="text"
                required
                autoFocus
                value={title}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setTitle(nextName);
                  setStages((prev) =>
                    prev.map((s) =>
                      s.titleTouched
                        ? s
                        : { ...s, title: suggestStageTitle(nextName, s.stage) }
                    )
                  );
                }}
                className="ns-input"
                placeholder="Spring Launch"
              />
            </label>
            <label className="block">
              <span className="ns-eyebrow block mb-1.5">Platform</span>
              <select
                required
                value={seriesPlatform}
                onChange={(e) => setSeriesPlatform(e.target.value)}
                className="ns-select"
              >
                <option value="" disabled>Choose a platform…</option>
                {Object.entries(PLATFORMS).map(([key, meta]) => {
                  const taken = disabledPlatformSet.has(key);
                  return (
                    <option key={key} value={key} disabled={taken}>
                      {meta.label}{taken ? " — already in this family" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="ns-eyebrow block mb-1.5">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="ns-textarea"
            />
          </label>

          {stages.map((s, i) => {
            const conflicts = perStageConflicts[i];
            const highlight =
              (conflicts && conflicts.length > 0) ||
              offendingIndex === i ||
              (ordering && ordering.offendingIndex === i);
            return (
              <div key={s.stage} className={`ns-stage-card ${highlight ? "ns-stage-error" : ""}`}>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--ns-ink)" }}>
                    <span
                      className="inline-flex items-center justify-center"
                      style={{
                        width: 22, height: 22, borderRadius: 6,
                        background: "rgba(94,234,212,0.10)", color: "#5eead4",
                        boxShadow: "inset 0 0 0 1px rgba(94,234,212,0.25)",
                      }}
                    >
                      <Icon name={STAGE_ICONS[i]} size={12} />
                    </span>
                    <span className="ns-eyebrow" style={{ fontSize: 10 }}>STAGE {String(i + 1).padStart(2, "0")}</span>
                    <span>{s.stage}</span>
                    <Icon name="lock" size={11} className="ml-0.5" style={{ color: "var(--ns-ink-faint)" }} />
                  </span>
                  {seriesPlatform && (
                    <span
                      className="inline-flex items-center gap-1.5 font-mono text-[11px]"
                      style={{ color: "var(--ns-ink-muted)" }}
                    >
                      <PlatformDot platform={seriesPlatform} />
                      {getPlatformLabel(seriesPlatform)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block col-span-2">
                    <span className="ns-eyebrow block mb-1.5">Title</span>
                    <input
                      type="text"
                      required
                      value={s.title}
                      onChange={(e) => updateStage(i, { title: e.target.value, titleTouched: true })}
                      className="ns-input"
                    />
                  </label>
                  <label className="block col-span-2">
                    <span className="ns-eyebrow block mb-1.5">Body (optional)</span>
                    <textarea
                      rows={2}
                      value={s.body}
                      onChange={(e) => updateStage(i, { body: e.target.value })}
                      className="ns-textarea"
                      maxLength={5000}
                    />
                  </label>
                  <label className="block">
                    <span className="ns-eyebrow block mb-1.5">Date</span>
                    <input
                      type="date"
                      required
                      value={s.date}
                      onChange={(e) => updateStage(i, { date: e.target.value })}
                      className="ns-input"
                      style={{ colorScheme: "dark" }}
                    />
                  </label>
                  <label className="block">
                    <span className="ns-eyebrow block mb-1.5">Time</span>
                    <input
                      type="time"
                      required
                      value={s.time}
                      onChange={(e) => updateStage(i, { time: e.target.value })}
                      className="ns-input"
                      style={{ colorScheme: "dark" }}
                    />
                  </label>
                </div>

                {conflicts && conflicts.length > 0 && (
                  <div
                    className="mt-3 text-[12px] flex items-start gap-2"
                    style={{ color: "#ff8a9e" }}
                  >
                    <Icon name="alert-triangle" size={12} className="mt-0.5 flex-none" />
                    <span>
                      Conflicts with{" "}
                      <strong style={{ color: "var(--ns-ink)" }}>
                        {conflicts.map((c) => (c.title ? c.title : "a sibling stage")).join(", ")}
                      </strong>
                      .
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {ordering && (
            <div className="ns-banner ns-banner-danger">
              <Icon name="alert-triangle" size={14} />
              <span className="flex-1">
                Stages must be scheduled in strict forward order. Stage #
                {ordering.offendingIndex + 1} is scheduled at or before stage #
                {ordering.priorIndex + 1}.
              </span>
            </div>
          )}

          {serverError && (
            <div className="ns-banner ns-banner-danger whitespace-pre-wrap">
              <Icon name="alert-triangle" size={14} />
              <span className="flex-1">{serverError}</span>
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--ns-line)" }}
        >
          <button
            type="button"
            className="btn"
            style={{ border: "1px solid var(--ns-line-2)" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn btn-primary"
            style={{ opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            {submitting
              ? isClone ? "Cloning…" : "Creating…"
              : isClone ? "Clone series" : "Create series"}
          </button>
        </div>
      </form>
    </div>
  );
}
