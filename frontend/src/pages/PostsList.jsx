import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { postsApi } from "../api/client";
import { format } from "date-fns";

export default function PostsList() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: "", platform: "" });

  useEffect(() => {
    let cancelled = false;
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.platform) params.platform = filter.platform;
    postsApi
      .list(params)
      .then((data) => {
        if (!cancelled) setPosts(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filter.status, filter.platform]);

  if (loading) return <div className="loading">Loading posts…</div>;

  return (
    <div className="posts-list-page">
      <div className="page-header">
        <h1>Your posts</h1>
        <Link to="/posts/new" className="btn primary">New post</Link>
      </div>
      <div className="filters">
        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={filter.platform}
          onChange={(e) => setFilter((f) => ({ ...f, platform: e.target.value }))}
        >
          <option value="">All platforms</option>
          <option value="youtube">YouTube</option>
          <option value="instagram">Instagram</option>
          <option value="twitter">Twitter</option>
          <option value="tiktok">TikTok</option>
          <option value="linkedin">LinkedIn</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="posts-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Platform</th>
              <th>Scheduled</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 ? (
              <tr>
                <td colSpan={5}>No posts yet. <Link to="/posts/new">Create one</Link>.</td>
              </tr>
            ) : (
              posts.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td><span className="platform">{p.platform}</span></td>
                  <td>
                    {p.scheduled_at
                      ? format(new Date(p.scheduled_at), "MMM d, yyyy HH:mm")
                      : "—"}
                  </td>
                  <td><span className={`status status-${p.status}`}>{p.status}</span></td>
                  <td>
                    <Link to={`/posts/${p.id}/edit`} className="btn small">Edit</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
