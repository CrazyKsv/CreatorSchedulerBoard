// SchedulerAgent — Cmd+K overlay, Neon Studio.
// ─────────────────────────────────────────────────────────────
// Wired to the backend /api/v1/agent/chat endpoint, which runs
// Moonshot Kimi (kimi-k2) with a tool catalog: create_series,
// create_post, query_upcoming_posts, list_series. Tool execution
// happens server-side under the authenticated user, so the same
// invariants (15-min same-platform gap, future-only times,
// sequential integrity) apply to the agent as to a human user.
//
// Phases: "idle" → "thinking" → "done"
//   • idle:    suggestions + prompt input
//   • thinking: spinner trace while the backend talks to Kimi
//   • done:    final reply + action log (created series / posts /
//              query results), with a "Done" button that triggers
//              a parent refresh.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import { agentApi } from "../../api/client";

// ─── Tiny inline markdown renderer ─────────────────────────────
// Handles the cases LLM replies actually use: **bold**, *italic* or
// _italic_, `code`, blank lines, and `-`/`*`-prefixed bullet lists.
// Zero deps (Constitution Principle II — no new runtime deps for a
// 50-line problem).
function renderInline(line) {
  const out = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const end = line.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push(<strong key={out.length} style={{ fontStyle: "normal" }}>{line.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code
            key={out.length}
            className="font-mono px-1 py-0.5 rounded"
            style={{
              fontSize: "0.9em",
              background: "rgba(255,255,255,.06)",
              fontStyle: "normal",
            }}
          >
            {line.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }
    const c = line[i];
    if ((c === "*" || c === "_") && line[i + 1] !== c) {
      const end = line.indexOf(c, i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        out.push(<em key={out.length}>{line.slice(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }
    buf += line[i];
    i++;
  }
  flush();
  return out;
}

function MarkdownLite({ text }) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let bulletGroup = null;
  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+(.*)/);
    if (m) {
      if (!bulletGroup) {
        bulletGroup = [];
        blocks.push({ type: "ul", items: bulletGroup });
      }
      bulletGroup.push(m[1]);
    } else {
      bulletGroup = null;
      blocks.push({ type: "line", text: line });
    }
  }
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "ul") {
          return (
            <ul key={i} className="list-disc pl-5 my-1.5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (!b.text.trim()) return <div key={i} style={{ height: "0.5em" }} />;
        return <div key={i}>{renderInline(b.text)}</div>;
      })}
    </>
  );
}

// ─── Public API ──────────────────────────────────────────────
const SchedulerAgent = forwardRef(function SchedulerAgent(
  { onRefresh, onToast },
  ref
) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | thinking | done
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState([]); // [{role, content}]
  const [result, setResult] = useState(null); // { reply, actions, used_tools }
  const [error, setError] = useState(null);

  const lastFocusRef = useRef(null);
  const inputRef = useRef(null);
  const overlayRef = useRef(null);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen((v) => !v),
  }), []);

  useLayoutEffect(() => {
    if (!open) return;
    lastFocusRef.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = prev;
      lastFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setPhase("idle");
        setPrompt("");
        setResult(null);
        setError(null);
        setHistory([]);
      }, 180);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const runPrompt = useCallback(async (text) => {
    const message = (text ?? prompt).trim();
    if (!message) return;
    setPhase("thinking");
    setError(null);
    try {
      const data = await agentApi.chat(message, history);
      setResult(data);
      setHistory((h) => [
        ...h,
        { role: "user", content: message },
        { role: "assistant", content: data.reply || "" },
      ]);
      setPhase("done");
      // Refresh parent state if the agent took any mutating action.
      const mutated = (data.actions || []).some(
        (a) => a.type === "series_created" || a.type === "post_created"
      );
      if (mutated) {
        onRefresh?.();
        onToast?.({
          kind: "success",
          message: "Agent updated your schedule.",
        });
      }
    } catch (err) {
      setError(err.message || "Agent failed.");
      setPhase("done");
    }
  }, [prompt, history, onRefresh, onToast]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh] px-6"
      style={{ background: "rgba(5,5,10,.78)", backdropFilter: "blur(14px)" }}
      onClick={(e) => { if (e.target === overlayRef.current) setOpen(false); }}
      role="dialog"
      aria-modal="true"
      aria-label="Scheduler agent"
    >
      <div
        className="w-[720px] max-w-full ns-panel animate-ns-overlay-in relative overflow-hidden"
        style={{
          background: "rgba(21,23,35,.94)",
          boxShadow: "0 50px 100px rgba(0,0,0,.70), 0 0 0 1px rgba(255,94,181,.18), 0 0 80px rgba(94,234,212,.14)",
        }}
      >
        <div
          className="h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(94,234,212,.55), rgba(255,94,181,.55), transparent)" }}
        />

        <AgentHeader phase={phase} onClose={() => setOpen(false)} />

        <AgentPromptField
          value={prompt}
          onChange={setPrompt}
          inputRef={inputRef}
          onSubmit={() => runPrompt()}
          disabled={phase === "thinking"}
        />

        {phase === "idle" && (
          <AgentSuggestions
            onPick={(p) => {
              setPrompt(p);
              // Hand the prompt to the user — populate the input, focus it,
              // and place the caret at the end so they can edit before
              // they choose to submit. No auto-send.
              requestAnimationFrame(() => {
                const el = inputRef.current;
                if (el) {
                  el.focus();
                  const len = el.value.length;
                  el.setSelectionRange(len, len);
                }
              });
            }}
          />
        )}
        {phase === "thinking" && <AgentThinking prompt={prompt} />}
        {phase === "done" && (
          <AgentResult
            result={result}
            error={error}
            onAgain={() => { setPhase("idle"); setPrompt(""); setResult(null); setError(null); }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>,
    document.body
  );
});

export default SchedulerAgent;

// ─── Subcomponents ───────────────────────────────────────────
function AgentHeader({ phase, onClose }) {
  const map = {
    idle:     { label: "READY",    color: "#5eead4", caption: "CMD+K · TYPE TO BEGIN · ESC TO DISMISS" },
    thinking: { label: "THINKING…", color: "#ff5eb5", caption: "KIMI K2 · RUNNING TOOLS · DRAFTING REPLY" },
    done:     { label: "DONE",     color: "#5eead4", caption: "REVIEW BELOW · ASK AGAIN OR CLOSE" },
  };
  const s = map[phase];
  return (
    <div className="px-5 py-4 flex items-center gap-3.5 border-b border-line">
      <div className="relative w-[38px] h-[38px] flex-shrink-0">
        <div
          className="absolute -inset-1 rounded-xl blur-md opacity-50"
          style={{ background: "linear-gradient(135deg, #5eead4, #ff5eb5)" }}
        />
        <div
          className="relative w-[38px] h-[38px] rounded-[10px] flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #5eead4, #a594ff)" }}
        >
          <span
            className="ns-headline ns-headline-italic text-[18px]"
            style={{ color: "#0a0b10", letterSpacing: "-0.02em" }}
          >a</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="ns-headline text-[15px]" style={{ fontStyle: "normal" }}>Scheduler Agent</div>
          <div className="w-1 h-1 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
          <div className="font-mono text-[10px] tracking-wider-2" style={{ color: s.color }}>{s.label}</div>
        </div>
        <div className="font-mono text-[10px] text-ink-muted tracking-wider-2 mt-0.5">{s.caption}</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="font-mono text-[10px] px-2 py-1 border border-line-2 rounded text-ink-muted hover:text-ink"
      >esc</button>
    </div>
  );
}

function AgentPromptField({ value, onChange, inputRef, onSubmit, disabled }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="px-5 py-4 border-b border-line"
      style={{ background: "linear-gradient(180deg, rgba(28,31,45,.4), transparent)" }}
    >
      <div className="font-mono text-[9.5px] text-violet tracking-wider-3 mb-2">PROMPT</div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Describe a post, a series, a shift in your schedule…"
        className="w-full bg-transparent outline-none ns-headline text-[19px] leading-snug"
        style={{
          fontStyle: value ? "italic" : "normal",
          fontWeight: 500,
          color: value ? "#f1f2f7" : "#575a66",
          letterSpacing: "-0.01em",
        }}
      />
    </form>
  );
}

const ACTION_META = {
  tool_error:     { color: "#ff6a82", icon: "alert-triangle" },
  query:          { color: "#a594ff", icon: "calendar" },
  post_created:   { color: "#5eead4", icon: "zap" },
  series_created: { color: "#5eead4", icon: "git-branch" },
  default:        { color: "#5eead4", icon: "git-branch" },
};

const SUGGESTIONS = [
  {
    i: "git-branch",
    text: "Start a 4-stage Instagram series for our summer drop launching May 20 at 1pm",
    tag: "SERIES",
    c: "#5eead4",
  },
  {
    i: "calendar",
    text: "How many upcoming posts do I have this week?",
    tag: "QUERY",
    c: "#ff5eb5",
  },
  {
    i: "alert-triangle",
    text: "Find and auto-space every 15-minute conflict this week",
    tag: "FIX",
    c: "#ffb547",
  },
  {
    i: "copy",
    text: "Clone my latest Instagram series to X and YouTube with adapted copy",
    tag: "CLONE",
    c: "#a594ff",
  },
];

function AgentSuggestions({ onPick }) {
  return (
    <div className="px-5 pt-4 pb-5">
      <div className="font-mono text-[9.5px] text-ink-faint tracking-wider-3 mb-2">◇ TRY</div>
      <div className="flex flex-col gap-1">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(s.text)}
            className="flex items-center gap-3.5 px-3.5 py-3 rounded-[10px] text-left transition-all hover:bg-panel-2 border border-transparent hover:border-line"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: s.c + "22", border: `1px solid ${s.c}55` }}
            >
              <Icon name={s.i} size={14} color={s.c} />
            </div>
            <div className="ns-headline text-[14.5px] text-ink flex-1" style={{ fontWeight: 500, letterSpacing: "-0.005em", fontStyle: "normal" }}>
              {s.text}
            </div>
            <div className="font-mono text-[9px] px-2 py-0.5 rounded tracking-wider-2" style={{ background: s.c + "18", color: s.c }}>
              {s.tag}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// The /agent/chat call is atomic (no token streaming), so the UI shows
// a simulated-progress checklist with an elapsed-seconds counter so the
// user can see the agent is still working.
const THINKING_STEPS = [
  {
    key: "parse_intent",
    label: "Reading your request",
    detail: "Parsing intent, extracting platform + timing cues",
    icon: "search",
  },
  {
    key: "select_tools",
    label: "Selecting tools",
    detail: "Matching intent against create_series, create_post, query_upcoming_posts, list_series",
    icon: "zap",
  },
  {
    key: "execute_tools",
    label: "Running tools on your schedule",
    detail: "Validating 15-min platform gaps · future-only times · sequential integrity",
    icon: "git-branch",
  },
  {
    key: "draft_reply",
    label: "Drafting reply",
    detail: "Composing a summary of what was created or found",
    icon: "check",
  },
];

function AgentThinking({ prompt }) {
  const [active, setActive] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = Date.now();
    // 250 ms keeps the elapsed counter visibly alive at 1-decimal
    // precision without re-rendering the subtree 10× per second.
    const tick = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 100) / 10);
    }, 250);
    // Cap at the penultimate step so "Drafting reply" only lights when
    // the real call is mostly done.
    const timers = [
      setTimeout(() => setActive(1), 900),
      setTimeout(() => setActive(2), 2200),
      setTimeout(() => setActive(3), 4500),
    ];
    return () => {
      clearInterval(tick);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="px-5 py-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="ns-agent-pulse" />
        <div className="font-mono text-[11px] tracking-wider-3 text-magenta">KIMI K2 · LIVE</div>
        <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, rgba(255,94,181,.38), transparent)" }} />
        <div
          className="font-mono text-[11px] tabular-nums"
          style={{ color: "var(--ns-ink-muted)" }}
          title="Elapsed time since the agent started"
        >
          {elapsed.toFixed(1)}s
        </div>
      </div>

      <div
        className="ns-headline text-[15px] text-ink-2 leading-relaxed mb-4"
        style={{ fontStyle: "italic", fontWeight: 500 }}
      >
        Working on <span className="text-ink">&ldquo;{prompt}&rdquo;</span>
        <span className="text-magenta animate-ns-cursor ml-1" style={{ fontStyle: "normal" }}>▎</span>
      </div>

      <div className="flex flex-col gap-2">
        {THINKING_STEPS.map((s, i) => {
          const state = i < active ? "done" : i === active ? "active" : "pending";
          return (
            <div
              key={s.key}
              className={`ns-agent-step ${state === "active" ? "active" : state === "done" ? "done" : ""}`}
              style={{
                opacity: state === "pending" ? 0.5 : 1,
                animation: `ns-fadeslide .35s ease-out ${i * 0.08}s both`,
              }}
            >
              <div className="ns-agent-step-icon">
                {state === "done" ? (
                  <Icon name="check" size={11} />
                ) : state === "active" ? (
                  <span className="ns-agent-pulse" />
                ) : (
                  <Icon name={s.icon} size={11} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px]" style={{ fontWeight: 500, fontFamily: "inherit" }}>
                  {s.label}
                  {state === "active" && <span className="text-magenta animate-ns-cursor ml-1">▎</span>}
                </div>
                <div
                  className="text-[11.5px] truncate"
                  style={{ color: "var(--ns-ink-muted)", fontFamily: "inherit" }}
                >
                  {s.detail}
                </div>
              </div>
              <div
                className="font-mono text-[10.5px] tracking-wider-2 flex-shrink-0"
                style={{
                  color:
                    state === "done"
                      ? "#22c55e"
                      : state === "active"
                      ? "#5eead4"
                      : "var(--ns-ink-faint)",
                }}
              >
                {state === "done" ? "DONE" : state === "active" ? "RUNNING" : "QUEUED"}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="mt-4 font-mono text-[10.5px] tracking-wider-2"
        style={{ color: "var(--ns-ink-faint)" }}
      >
        ⟶ The agent is operating on your account — tool calls respect the same 15-minute platform
        gap &amp; future-only scheduling rules you&rsquo;d hit in the UI.
      </div>
    </div>
  );
}

function AgentResult({ result, error, onAgain, onClose }) {
  if (error) {
    return (
      <>
        <div className="px-5 py-4">
          <div
            className="rounded-lg p-3.5"
            style={{
              background: "linear-gradient(135deg, rgba(255,106,130,.12), transparent)",
              border: "1px solid rgba(255,106,130,.4)",
            }}
          >
            <div className="font-mono text-[10px] tracking-wider-3 text-danger mb-1.5">AGENT ERROR</div>
            <div className="text-[13px] text-ink-2 leading-snug">{error}</div>
          </div>
        </div>
        <Footer onAgain={onAgain} onClose={onClose} primaryLabel="Close" />
      </>
    );
  }
  const actions = result?.actions || [];
  return (
    <>
      <div className="px-5 py-4 max-h-[420px] overflow-auto">
        {result?.reply && (
          <div className="mb-4">
            <div className="font-mono text-[10.5px] text-cyan tracking-wider-3 mb-1.5">REPLY</div>
            <div
              className="ns-headline text-[15.5px] text-ink leading-relaxed"
              style={{ fontStyle: "italic", fontWeight: 500, letterSpacing: "-0.005em" }}
            >
              <MarkdownLite text={result.reply} />
            </div>
          </div>
        )}

        {actions.length > 0 && (
          <div>
            <div className="font-mono text-[10.5px] text-violet tracking-wider-3 mb-2">ACTIONS</div>
            <div className="flex flex-col gap-1.5">
              {actions.map((a, i) => {
                const meta = ACTION_META[a.type] || ACTION_META.default;
                const c = meta.color;
                const ic = meta.icon;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                    style={{
                      background: c + "10",
                      border: `1px solid ${c}55`,
                    }}
                  >
                    <Icon name={ic} size={15} color={c} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] text-ink leading-snug" style={{ fontWeight: 500 }}>
                        {a.summary}
                      </div>
                      {a.type === "series_created" && a.data?.stages && (
                        <div className="mt-2 flex flex-col gap-1">
                          {a.data.stages.map((st, j) => (
                            <div key={j} className="font-mono text-[12px] text-ink-muted">
                              {st.stage} · {st.scheduled_at} · {st.title}
                            </div>
                          ))}
                        </div>
                      )}
                      {a.type === "query" && a.data?.items?.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1">
                          {a.data.items.slice(0, 6).map((it) => (
                            <div key={it.id} className="font-mono text-[12px] text-ink-muted">
                              {it.scheduled_at} · {it.platform} · {it.title}
                            </div>
                          ))}
                          {a.data.items.length > 6 && (
                            <div className="font-mono text-[11px] text-ink-faint">
                              … and {a.data.items.length - 6} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {result?.used_tools?.length > 0 && (
          <div className="mt-4 font-mono text-[11.5px] text-ink-faint tracking-wider-2">
            tools · {result.used_tools.join(" → ")}
          </div>
        )}
      </div>
      <Footer onAgain={onAgain} onClose={onClose} primaryLabel="Done" />
    </>
  );
}

function Footer({ onAgain, onClose, primaryLabel }) {
  return (
    <div className="px-5 py-3.5 flex gap-2 border-t border-line">
      <button type="button" className="ns-btn-ghost" onClick={onAgain}>Ask again</button>
      <div className="flex-1" />
      <button
        type="button"
        className="ns-btn-primary"
        onClick={onClose}
      >
        {primaryLabel}
        <Icon name="arrow-right" size={12} color="#0a0b10" />
      </button>
    </div>
  );
}
