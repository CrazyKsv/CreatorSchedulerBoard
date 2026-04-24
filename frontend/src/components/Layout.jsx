import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="layout">
      <nav className="nav">
        <Link to="/" className="nav-brand">Creator Scheduler</Link>
        <div className="nav-links">
          <Link to="/">Posts</Link>
          <Link to="/calendar">Calendar</Link>
          <Link to="/posts/new">New Post</Link>
          {user && (
            <button type="button" className="btn-link" onClick={handleLogout}>
              Log out
            </button>
          )}
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
