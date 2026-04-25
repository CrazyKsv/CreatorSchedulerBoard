const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

function getToken() {
  return localStorage.getItem("token");
}

export async function api(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    // detail can be: a string (FastAPI default), an array (validation
    // errors from Pydantic), or an object with .message (FR-011 shape).
    // Principle VII / FR-018a requires we surface the server's message
    // verbatim — never "[object Object]".
    let msg;
    let errorCode = null;
    let offendingIndex = null;
    if (Array.isArray(err.detail)) {
      msg = err.detail.map((e) => e.msg || e.message).join(", ");
    } else if (err.detail && typeof err.detail === "object") {
      msg = err.detail.message || JSON.stringify(err.detail);
      errorCode = err.detail.error || null;
      // Series create conflict / seq integrity surfaces offending index.
      offendingIndex =
        err.detail.series_post_index ??
        err.detail.offending_post_index ??
        null;
    } else {
      msg = err.detail;
    }
    const error = new Error(msg || JSON.stringify(err));
    error.status = res.status;
    error.code = errorCode;
    error.offendingIndex = offendingIndex;
    error.detail = err.detail;
    throw error;
  }
  if (res.status === 204) return;
  return res.json();
}

function qs(params) {
  const entries = Object.entries(params || {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export const authApi = {
  login: (email, password) =>
    api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (data) =>
    api("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  me: () => api("/auth/me"),
};

export const postsApi = {
  list: (params = {}) => api(`/posts${qs(params)}`),
  get: (id) => api(`/posts/${id}`),
  create: (data) =>
    api("/posts", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) =>
    api(`/posts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id) => api(`/posts/${id}`, { method: "DELETE" }),
  archive: (id) => api(`/posts/${id}/archive`, { method: "POST" }),
  unarchive: (id) => api(`/posts/${id}/unarchive`, { method: "POST" }),
  // 006 — manual publish (FR-015). Bypasses server-side sequential rule.
  publish: (id) => api(`/posts/${id}/publish`, { method: "POST" }),
};

export const statsApi = {
  dashboard: () => api(`/stats/dashboard`),
  upcoming: (params = {}) => api(`/stats/upcoming${qs(params)}`),
};

export const agentApi = {
  chat: (message, history = []) =>
    api(`/agent/chat`, {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
};

export const seriesApi = {
  list: (params = {}) => api(`/series${qs(params)}`),
  get: (id) => api(`/series/${id}`),
  create: (data) =>
    api("/series", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) =>
    api(`/series/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id) => api(`/series/${id}`, { method: "DELETE" }),
  archive: (id) => api(`/series/${id}/archive`, { method: "POST" }),
  unarchive: (id) => api(`/series/${id}/unarchive`, { method: "POST" }),
};
