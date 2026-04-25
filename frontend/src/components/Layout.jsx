// App shell — left sidebar + routed outlet. All shared schedule state
// (posts, series, PostForm / SeriesBuilder / Confirm / Toast modals,
// SchedulerAgent) lives here so every page reads from the same source
// and modals persist across navigation.
//
// Pages access state via:
//   const schedule = useOutletContext();

import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import PostForm from "./PostForm";
import SeriesBuilder from "./SeriesBuilder";
import ConfirmModal from "./ConfirmModal";
import Toast from "./Toast";
import SchedulerAgent from "./scheduler-agent/SchedulerAgent";
import useScheduleData from "../hooks/useScheduleData";

export default function Layout() {
  const schedule = useScheduleData();
  const agentRef = useRef(null);
  const nav = useNavigate();

  // ⌘K / Ctrl+K summons the SchedulerAgent from anywhere.
  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      agentRef.current?.open();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const outletContext = {
    ...schedule,
    openAgent: () => agentRef.current?.open(),
    navigate: nav,
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--ns-bg)" }}>
      <Sidebar
        onNewPost={schedule.openNewPost}
        onNewSeries={schedule.openNewSeries}
      />
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-[1280px] px-8 py-8">
          <Outlet context={outletContext} />
        </div>
      </main>

      <SchedulerAgent
        ref={agentRef}
        onRefresh={schedule.fetchAll}
        onToast={schedule.setToast}
      />

      {schedule.showPostForm && (
        <PostForm
          editing={schedule.editingPost}
          existingPosts={schedule.allFlatPosts}
          onSaved={schedule.handleSaved}
          onCancel={() => {
            schedule.setShowPostForm(false);
            schedule.setEditingPost(null);
          }}
          onToast={schedule.setToast}
          onConfirm={(spec) =>
            schedule.setConfirm({
              icon: "zap",
              tone: "warning",
              title: spec.title,
              body: spec.message,
              confirmLabel: spec.confirmLabel || "Confirm",
              onConfirm: async () => {
                schedule.setConfirm(null);
                await spec.onConfirm();
              },
            })
          }
        />
      )}
      {schedule.showSeriesBuilder && (
        <SeriesBuilder
          existingPosts={schedule.allFlatPosts}
          initial={schedule.cloneInitial}
          onSaved={schedule.handleSaved}
          onCancel={() => {
            schedule.setShowSeriesBuilder(false);
            schedule.setCloneInitial(null);
          }}
          onToast={schedule.setToast}
        />
      )}
      {schedule.confirm && (
        <ConfirmModal
          icon={schedule.confirm.icon || "alert-triangle"}
          tone={schedule.confirm.tone || "danger"}
          title={schedule.confirm.title}
          body={schedule.confirm.body}
          confirmLabel={schedule.confirm.confirmLabel}
          onCancel={() => schedule.setConfirm(null)}
          onConfirm={schedule.confirm.onConfirm}
        />
      )}
      {schedule.toast && (
        <Toast
          kind={schedule.toast.kind}
          message={schedule.toast.message}
          onClose={() => schedule.setToast(null)}
        />
      )}
    </div>
  );
}
