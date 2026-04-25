// Shared schedule data + CRUD handlers, lifted out of the old Dashboard
// so every routed page (Dashboard / List / Calendar / Track) reads the
// same state and shares the same PostForm / SeriesBuilder / Confirm /
// Toast modals without re-fetching on navigation.
//
// Mount this hook in one place (the Layout) and pass the returned value
// to each page via <Outlet context={...}>. Pages then call:
//
//   const schedule = useOutletContext();
//
// ...to access everything below.

import { useCallback, useEffect, useMemo, useState } from "react";
import { postsApi, seriesApi, statsApi } from "../api/client";
import { splitIso } from "../components/utils";

export default function useScheduleData() {
  const [postsList, setPostsList] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const [showPostForm, setShowPostForm] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [showSeriesBuilder, setShowSeriesBuilder] = useState(false);
  const [cloneInitial, setCloneInitial] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  const fetchAll = useCallback(async () => {
    // 006 — `loading` stays as a first-paint-only flag. We deliberately
    // do NOT setLoading(true) on refetch (heartbeat, post-save, agent
    // refresh) so the dashboard never flashes the page-level
    // "Loading your schedule…" placeholder mid-session. Data swaps in
    // place once the new payload arrives.
    try {
      const [posts, series, dash] = await Promise.all([
        postsApi.list({ include_archived: true }),
        seriesApi.list({ include_archived: true }),
        statsApi.dashboard().catch(() => null),
      ]);
      setPostsList(posts);
      setSeriesList(series);
      setStats(dash);
      setFetchError(null);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      // Always flip loading off after the first attempt; subsequent
      // attempts have no effect (the value is already false).
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 006 — heartbeat refetch (Q4 freshness mechanism).
  // Polls every 30s while the tab is visible so auto-published posts
  // surface in the UI within the SC-001 budget without SSE/WebSocket.
  useEffect(() => {
    let timer = null;
    function start() {
      if (timer != null) return;
      timer = setInterval(() => { fetchAll(); }, 30000);
    }
    function stop() {
      if (timer != null) { clearInterval(timer); timer = null; }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchAll]);

  function handleSaved() {
    setShowPostForm(false);
    setEditingPost(null);
    setShowSeriesBuilder(false);
    setCloneInitial(null);
    fetchAll();
  }

  function openNewPost() { setEditingPost(null); setShowPostForm(true); }
  function openEditPost(p) { setEditingPost(p); setShowPostForm(true); }
  function openNewSeries() { setCloneInitial(null); setShowSeriesBuilder(true); }

  function openCloneSeries(s) {
    const byPos = [...(s.posts || [])].sort(
      (a, b) => (a.series_position ?? 0) - (b.series_position ?? 0)
    );
    const stages = byPos.map((p) => {
      const { date, time } = splitIso(p.scheduled_at);
      return {
        stage: p.stage,
        title: p.title,
        body: p.body || "",
        date,
        time,
      };
    });
    const familyAnchor = s.family_id ?? s.id;
    const takenPlatforms = Array.from(
      new Set(
        seriesList
          .filter((m) => (m.family_id ?? m.id) === familyAnchor)
          .map((m) => m.platform)
          .filter(Boolean)
      )
    );
    setCloneInitial({
      title: s.title,
      description: s.description || "",
      platform: "",
      sourceSeriesId: s.id,
      disabledPlatforms: takenPlatforms,
      stages,
    });
    setShowSeriesBuilder(true);
  }

  async function doDeletePost(p) {
    try { await postsApi.delete(p.id); setToast({ kind: "success", message: "Post deleted." }); }
    catch (err) { setToast({ kind: "error", message: err.message }); }
    finally { setConfirm(null); fetchAll(); }
  }
  async function doArchivePost(p) {
    try { await postsApi.archive(p.id); setToast({ kind: "success", message: "Post archived." }); }
    catch (err) { setToast({ kind: "error", message: err.message }); }
    finally { setConfirm(null); fetchAll(); }
  }
  async function doUnarchivePost(p) {
    try {
      await postsApi.unarchive(p.id);
      setToast({
        kind: "success",
        message: "Post restored as draft. Edit to re-schedule.",
      });
    }
    catch (err) { setToast({ kind: "error", message: err.message }); }
    finally { fetchAll(); }
  }
  async function doArchiveSeries(s) {
    try {
      await seriesApi.archive(s.id);
      setToast({ kind: "success", message: "Series archived. All future posts will be archived (not canceled)." });
    } catch (err) { setToast({ kind: "error", message: err.message }); }
    finally { setConfirm(null); fetchAll(); }
  }
  async function doUnarchiveSeries(s) {
    try {
      await seriesApi.unarchive(s.id);
      setToast({
        kind: "success",
        message: "Series restored. All stages are now drafts — edit to re-schedule.",
      });
    }
    catch (err) { setToast({ kind: "error", message: err.message }); }
    finally { fetchAll(); }
  }
  async function doDeleteSeries(s) {
    try { await seriesApi.remove(s.id); setToast({ kind: "success", message: "Series deleted." }); }
    catch (err) { setToast({ kind: "error", message: err.message }); }
    finally { setConfirm(null); fetchAll(); }
  }

  async function handleAutoSpacePost(post, nextIso) {
    try {
      await postsApi.update(post.id, { scheduled_at: nextIso });
      setToast({ kind: "success", message: "Rescheduled to clear conflict." });
      fetchAll();
    } catch (err) {
      setToast({ kind: "error", message: err.message });
    }
  }

  const allFlatPosts = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of [...postsList, ...seriesList.flatMap((s) => s.posts || [])]) {
      if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out;
  }, [postsList, seriesList]);

  const uniqueFamilyCount = useMemo(
    () => new Set(seriesList.map((s) => s.family_id ?? s.id)).size,
    [seriesList]
  );

  return {
    // data
    postsList, seriesList, allFlatPosts, uniqueFamilyCount, stats,
    loading, fetchError, fetchAll,
    // modal state
    showPostForm, setShowPostForm,
    editingPost, setEditingPost,
    showSeriesBuilder, setShowSeriesBuilder,
    cloneInitial, setCloneInitial,
    confirm, setConfirm,
    toast, setToast,
    // handlers
    handleSaved,
    openNewPost, openEditPost, openNewSeries, openCloneSeries,
    doDeletePost, doArchivePost, doUnarchivePost,
    doArchiveSeries, doUnarchiveSeries, doDeleteSeries,
    handleAutoSpacePost,
  };
}
