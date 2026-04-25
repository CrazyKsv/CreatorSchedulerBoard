import { useMemo, useState } from "react";
import Icon from "./Icon";
import { PLATFORMS, findConflicts, splitIso, toIsoLocal } from "./utils";
import { postsApi } from "../api/client";

// `published` and `failed` are server-only outcomes — see FR-018.
const USER_SETTABLE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "archived", label: "Archived" },
];
const TERMINAL_STATUSES = new Set(["published", "failed"]);
const STATUS_LABEL = {
  draft: "Draft",
  scheduled: "Scheduled",
  archived: "Archived",
  published: "Published",
  failed: "Failed",
};

export default function PostForm({
  editing,
  existingPosts = [],
  onSaved,
  onCancel,
  onToast,
  onConfirm,
}) {
  const initial = editing || {};
  const [title, setTitle] = useState(initial.title || "");
  const [body, setBody] = useState(initial.body || "");
  const [platform, setPlatform] = useState(initial.platform || "instagram");
  const [status, setStatus] = useState(initial.status || "scheduled");
  const initDT = splitIso(initial.scheduled_at);
  const [date, setDate] = useState(initDT.date);
  const [time, setTime] = useState(initDT.time);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);

  const statusReadOnly = TERMINAL_STATUSES.has(initial.status);

  const candidateIso = useMemo(() => toIsoLocal(date, time), [date, time]);
  const conflicts = useMemo(
    () =>
      findConflicts(
        { scheduled_at: candidateIso, platform },
        existingPosts,
        editing?.id ?? null
      ),
    [candidateIso, platform, existingPosts, editing?.id]
  );

  const isSeriesChild = editing?.series_id != null;

  const canSubmit =
    title.trim() &&
    platform &&
    (status === "draft" || (date && time)) &&
    conflicts.length === 0 &&
    !busy;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    const payload = {
      title: title.trim(),
      platform,
      status,
      body: body || null,
      scheduled_at: status === "draft" ? null : candidateIso,
    };
    try {
      const saved = editing
        ? await postsApi.update(editing.id, payload)
        : await postsApi.create(payload);
      onToast?.({ kind: "success", message: editing ? "Post updated." : "Post created." });
      onSaved?.(saved);
    } catch (err) {
      setServerError(err.message);
      onToast?.({ kind: "error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      <form
        className="w-[560px] max-w-[92vw] ns-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          animation: "ns-overlay-in .18s cubic-bezier(.2,.9,.25,1) both",
          boxShadow: "0 50px 100px rgba(0,0,0,.70), 0 0 0 1px rgba(255,255,255,.04)",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid var(--ns-line)" }}
        >
          <h2
            className="ns-headline ns-headline-italic"
            style={{ fontSize: 20, fontWeight: 500, color: "var(--ns-ink)", letterSpacing: "-0.01em" }}
          >
            {editing ? "Edit post" : "New post"}
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

        <div className="space-y-3 p-5">
          <label className="block">
            <span className="ns-eyebrow block mb-1.5">Title</span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="ns-input"
              placeholder="Announcement: Summer Drop"
            />
          </label>

          <label className="block">
            <span className="ns-eyebrow block mb-1.5">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="ns-textarea"
              rows={4}
              placeholder="Post copy (optional)…"
              maxLength={5000}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="ns-eyebrow block mb-1.5">Platform</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                disabled={isSeriesChild}
                className="ns-select"
              >
                {Object.entries(PLATFORMS).map(([k, meta]) => (
                  <option key={k} value={k}>{meta.label}</option>
                ))}
              </select>
              {isSeriesChild && (
                <span className="mt-1 block text-[11px]" style={{ color: "var(--ns-ink-muted)" }}>
                  Platform is set by the series.
                </span>
              )}
            </label>
            <label className="block">
              <span className="ns-eyebrow block mb-1.5">Status</span>
              {statusReadOnly ? (
                <div
                  className="ns-input"
                  data-testid="status-readonly"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    color: "var(--ns-ink-muted)",
                    cursor: "not-allowed",
                  }}
                >
                  {STATUS_LABEL[status] || status}
                </div>
              ) : (
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="ns-select"
                  data-testid="status-select"
                >
                  {USER_SETTABLE_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}
            </label>
          </div>

          {/* 006 — failure annotation surfaced inline (FR-007a). */}
          {initial.last_publish_attempt_at && initial.last_publish_error && (
            <div className="ns-banner ns-banner-warning" data-testid="publish-failure-annotation">
              <Icon name="alert-triangle" size={14} />
              <span className="flex-1">
                Last auto-publish attempt failed at{" "}
                {new Date(initial.last_publish_attempt_at).toLocaleString()}.
                The system will retry.
              </span>
            </div>
          )}

          {status !== "draft" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="ns-eyebrow block mb-1.5">Date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="ns-input"
                  required
                  style={{ colorScheme: "dark" }}
                />
              </label>
              <label className="block">
                <span className="ns-eyebrow block mb-1.5">Time</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="ns-input"
                  required
                  style={{ colorScheme: "dark" }}
                />
              </label>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="ns-banner ns-banner-warning">
              <Icon name="alert-triangle" size={14} />
              <div className="flex-1">
                <div className="font-medium">Within 15 minutes of an existing post</div>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      <strong style={{ color: "var(--ns-ink)" }}>{c.title}</strong> — {c.scheduled_at}
                    </li>
                  ))}
                </ul>
              </div>
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
          {/* 006 — manual publish action (FR-010). Visible only on existing
              posts in draft/scheduled status. Routes through a confirm
              modal owned by the parent (Layout) via onConfirm. */}
          {editing && (status === "draft" || status === "scheduled") && (
            <button
              type="button"
              data-testid="publish-button"
              className="btn"
              style={{ border: "1px solid var(--ns-line-2)" }}
              disabled={busy}
              onClick={() => {
                if (!onConfirm) return;
                onConfirm({
                  title: "Publish this post now?",
                  message: "This cannot be undone. The post status will flip to published immediately.",
                  confirmLabel: "Publish post",
                  onConfirm: async () => {
                    setBusy(true);
                    setServerError(null);
                    try {
                      const updated = await postsApi.publish(editing.id);
                      onToast?.({ kind: "success", message: "Post published." });
                      onSaved?.(updated);
                    } catch (err) {
                      setServerError(err.message);
                      onToast?.({ kind: "error", message: err.message });
                    } finally {
                      setBusy(false);
                    }
                  },
                });
              }}
            >
              <Icon name="zap" size={13} /> {busy ? "Publishing…" : "Publish post"}
            </button>
          )}
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
            {busy ? "Saving…" : editing ? "Save changes" : "Create post"}
          </button>
        </div>
      </form>
    </div>
  );
}
