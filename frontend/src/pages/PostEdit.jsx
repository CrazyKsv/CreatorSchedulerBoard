import { useState, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { postsApi } from "../api/client";

const PLATFORMS = ["youtube", "instagram", "twitter", "tiktok", "linkedin"];
const STATUSES = ["draft", "scheduled", "published", "failed"];

export default function PostEdit() {
  const { id } = useParams();
  // When creating a new post the route is `/posts/new`, which does not
  // provide an `id` param. Treat both an absent `id` and the literal
  // string "new" as the "new post" case so we don't call the detail
  // endpoint with an invalid path parameter.
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    platform: "youtube",
    scheduled_at: "",
    status: "draft",
  });

  useEffect(() => {
    if (isNew) return;
    postsApi
      .get(id)
      .then((p) => {
        setForm({
          title: p.title,
          platform: p.platform,
          scheduled_at: p.scheduled_at
            ? new Date(p.scheduled_at).toISOString().slice(0, 16)
            : "",
          status: p.status,
        });
      })
      .catch(() => setError("Post not found"))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload = {
      title: form.title,
      platform: form.platform,
      status: form.status,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
    };
    try {
      if (isNew) {
        const created = await postsApi.create(payload);
        navigate(`/posts/${created.id}/edit`, { replace: true });
      } else {
        await postsApi.update(id, payload);
        navigate("/");
      }
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="post-edit-page">
      <div className="page-header">
        <h1>{isNew ? "New post" : "Edit post"}</h1>
        <Link to="/" className="btn">Back to list</Link>
      </div>
      <form onSubmit={handleSubmit} className="post-form">
        {error && <div className="error">{error}</div>}
        <label>
          Title
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            placeholder="Post title"
          />
        </label>
        <label>
          Platform
          <select
            value={form.platform}
            onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
          >
            {PLATFORMS.map((pl) => (
              <option key={pl} value={pl}>{pl}</option>
            ))}
          </select>
        </label>
        <label>
          Scheduled at (optional)
          <input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving} className="btn primary">
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
          {!isNew && (
            <Link to="/" className="btn">Cancel</Link>
          )}
        </div>
      </form>
    </div>
  );
}
