// 200px left sidebar with icon + label. Same active-state cyan glow as
// before. Wider than the original 56px rail because the dashboard had
// too much horizontal whitespace next to a tiny nav strip.

import { NavLink, useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/",         icon: "layout-grid", label: "Dashboard" },
  { to: "/calendar", icon: "calendar",    label: "Calendar"  },
  { to: "/list",     icon: "list",        label: "List"      },
  { to: "/track",    icon: "git-branch",  label: "Track"     },
];

export default function Sidebar({ onNewPost, onNewSeries }) {
  const { logout } = useAuth();
  const nav = useNavigate();

  async function handleLogout() {
    await logout();
    nav("/login");
  }

  return (
    <aside className="ns-sidebar">
      <div className="ns-sidebar-brand">
        <div className="ns-sidebar-logo" title="Creator Scheduler">cs</div>
        <div className="ns-sidebar-brand-text">
          <div className="ns-sidebar-brand-title">Creator</div>
          <div className="ns-sidebar-brand-sub">Scheduler</div>
        </div>
      </div>
      <nav className="ns-sidebar-nav">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            title={n.label}
            className={({ isActive }) =>
              "ns-sidebar-btn" + (isActive ? " active" : "")
            }
          >
            <Icon name={n.icon} size={16} />
            <span className="ns-sidebar-btn-label">{n.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className="ns-sidebar-btn"
          title="New post"
          onClick={onNewPost}
          style={{ borderColor: "rgba(94,234,212,.30)" }}
        >
          <Icon name="plus" size={16} />
          <span className="ns-sidebar-btn-label">New post</span>
        </button>
        <button
          type="button"
          className="ns-sidebar-btn ns-sidebar-btn-primary"
          title="New series"
          onClick={onNewSeries}
          style={{ marginTop: 4 }}
        >
          <Icon name="git-branch" size={16} />
          <span className="ns-sidebar-btn-label">New series</span>
        </button>
      </nav>
      <div className="ns-sidebar-spacer" />
      <button
        type="button"
        className="ns-sidebar-btn"
        title="Log out"
        onClick={handleLogout}
      >
        <Icon name="log-out" size={16} />
        <span className="ns-sidebar-btn-label">Log out</span>
      </button>
    </aside>
  );
}
