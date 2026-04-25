import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { api, authApi, postsApi, seriesApi } from "./client";

// Some test runs leave a fake localStorage stub in place. Restore a
// Map-backed shim for isolation.
beforeEach(() => {
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
});

describe("api", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends JSON body and Content-Type header", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    });
    await api("/test", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/test"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: '{"foo":"bar"}',
      })
    );
  });

  it("adds Authorization header when token in localStorage", async () => {
    window.localStorage.setItem("token", "secret");
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    await api("/posts");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      })
    );
  });

  it("throws with message from string detail when not ok", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Email already registered" }),
    });
    await expect(
      api("/auth/register", { method: "POST", body: "{}" })
    ).rejects.toThrow("Email already registered");
  });

  it("surfaces object detail.message verbatim (FR-011/FR-018a)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        detail: {
          error: "platform_gap_conflict",
          message:
            "Another post (#42) on the same platform is scheduled 7 minutes before this one.",
          conflict_with_post_id: 42,
        },
      }),
    });
    await expect(postsApi.create({ title: "X" })).rejects.toThrow(
      /Another post \(#42\)/
    );
  });

  it("attaches error.code and error.offendingIndex from object detail", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        detail: {
          error: "sequential_integrity_violation",
          message: "Stage #3 is scheduled at or before stage #2.",
          offending_post_index: 2,
          prior_post_index: 1,
        },
      }),
    });
    try {
      await seriesApi.create({ title: "X", stages: [] });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.code).toBe("sequential_integrity_violation");
      expect(err.offendingIndex).toBe(2);
    }
  });
});

describe("authApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("login posts to /auth/login", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "tok", token_type: "bearer" }),
    });
    await authApi.login("a@b.com", "pass");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "pass" }),
      })
    );
  });

  it("register posts to /auth/register", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, email: "u@x.com" }),
    });
    await authApi.register({ email: "u@x.com", password: "p", full_name: "U" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/register"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "u@x.com", password: "p", full_name: "U" }),
      })
    );
  });
});

describe("postsApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("list serializes include_archived query param", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    await postsApi.list({ include_archived: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/posts\?include_archived=true$/),
      expect.any(Object)
    );
  });

  it("list serializes status + include_archived compose", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    await postsApi.list({ status: "draft", include_archived: false });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/posts\?.*include_archived=false.*|.*status=draft.*/),
      expect.any(Object)
    );
  });

  it("create posts to /posts", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 1 }),
    });
    await postsApi.create({
      title: "T",
      platform: "youtube",
      status: "draft",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/posts"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "T",
          platform: "youtube",
          status: "draft",
        }),
      })
    );
  });

  it("archive posts to /posts/:id/archive", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 7, status: "archived" }),
    });
    await postsApi.archive(7);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/posts/7/archive"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("unarchive posts to /posts/:id/unarchive", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 7, status: "scheduled" }),
    });
    await postsApi.unarchive(7);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/posts/7/unarchive"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("delete sends DELETE and returns undefined on 204", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const result = await postsApi.delete(9);
    expect(result).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/posts/9"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("seriesApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("list defaults to no query string", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    await seriesApi.list();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/series$/),
      expect.any(Object)
    );
  });

  it("list serializes include_archived param", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    await seriesApi.list({ include_archived: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/series\?include_archived=true$/),
      expect.any(Object)
    );
  });

  it("create posts the new 4-stage body shape", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, title: "Launch", posts: [] }),
    });
    const payload = {
      title: "Launch",
      description: null,
      stages: [
        { stage: "Teaser", platform: "instagram", title: "T", body: "", scheduled_at: "2026-05-01T09:00:00Z" },
        { stage: "Announcement", platform: "instagram", title: "A", body: "", scheduled_at: "2026-05-08T09:00:00Z" },
        { stage: "Follow-up", platform: "instagram", title: "F", body: "", scheduled_at: "2026-05-15T09:00:00Z" },
        { stage: "Reminder", platform: "instagram", title: "R", body: "", scheduled_at: "2026-05-22T09:00:00Z" },
      ],
    };
    await seriesApi.create(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/series"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
  });

  it("archive posts to /series/:id/archive", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 3, status: "archived" }),
    });
    await seriesApi.archive(3);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/series/3/archive"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("unarchive posts to /series/:id/unarchive", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 3, status: "active" }),
    });
    await seriesApi.unarchive(3);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/series/3/unarchive"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("remove sends DELETE and returns undefined on 204", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const result = await seriesApi.remove(99);
    expect(result).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/series/99"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
