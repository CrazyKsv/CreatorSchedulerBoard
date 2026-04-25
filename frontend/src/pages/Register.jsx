import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await register({ email, password, full_name: fullName || undefined });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: "var(--ns-bg)" }}
    >
      <div
        className="ns-panel w-full max-w-[420px]"
        style={{
          padding: "28px 28px 22px",
          boxShadow:
            "0 50px 100px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04)",
        }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div
            className="ns-sidebar-logo"
            style={{ width: 38, height: 38, fontSize: 14 }}
          >
            cs
          </div>
          <div className="flex flex-col leading-tight">
            <span
              className="ns-headline"
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--ns-ink)",
                letterSpacing: "-0.01em",
              }}
            >
              Creator Scheduler
            </span>
            <span
              className="ns-eyebrow"
              style={{ marginTop: 2 }}
            >
              Create an account
            </span>
          </div>
        </div>

        <h1
          className="ns-headline ns-headline-italic"
          style={{
            margin: "0 0 4px",
            fontSize: 28,
            fontWeight: 600,
            color: "var(--ns-ink)",
            letterSpacing: "-0.01em",
          }}
        >
          Start shipping.
        </h1>
        <p
          className="text-[13px] mb-5"
          style={{ color: "var(--ns-ink-muted)" }}
        >
          Plan posts and content series across your channels.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="ns-banner ns-banner-danger" role="alert">
              <span className="flex-1">{error}</span>
            </div>
          )}

          <label className="block">
            <span className="ns-eyebrow block mb-1.5">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="ns-input"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="ns-eyebrow block mb-1.5">
              Full name <span style={{ opacity: 0.6 }}>(optional)</span>
            </span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              className="ns-input"
              placeholder="Alice Creator"
            />
          </label>

          <label className="block">
            <span className="ns-eyebrow block mb-1.5">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="ns-input"
              placeholder="At least 6 characters"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="ns-btn-primary w-full justify-center"
            style={{
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "wait" : "pointer",
              marginTop: 4,
            }}
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p
          className="text-[13px] mt-4 text-center"
          style={{ color: "var(--ns-ink-muted)" }}
        >
          Already have an account?{" "}
          <Link
            to="/login"
            style={{
              color: "var(--ns-cyan, #5eead4)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
