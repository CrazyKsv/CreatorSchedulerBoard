const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

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
    const msg = Array.isArray(err.detail)
      ? err.detail.map((e) => e.msg || e.message).join(", ")
      : err.detail;
    throw new Error(msg || JSON.stringify(err));
  }
  if (res.status === 204) return;
  return res.json();
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
};

export const postsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api(`/posts${q ? `?${q}` : ""}`);
  },
  get: (id) => api(`/posts/${id}`),
  create: (data) =>
    api("/posts", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) =>
    api(`/posts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id) => api(`/posts/${id}`, { method: "DELETE" }),
};
