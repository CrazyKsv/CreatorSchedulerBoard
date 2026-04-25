import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

const OPTIONS = [
  {
    value: "all",
    label: "All content",
    icon: "layout-dashboard",
    hint: "Posts and series",
  },
  {
    value: "posts",
    label: "Posts",
    icon: "list",
    hint: "Standalone posts only",
  },
  {
    value: "series",
    label: "Series",
    icon: "git-branch",
    hint: "4-stage series only",
  },
];

export default function ContentFilter({
  value,
  onChange,
  counts = { all: 0, posts: 0, series: 0 },
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = OPTIONS.find((o) => o.value === value) || OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title="Filter content type"
      >
        <Icon name={selected.icon} size={13} />
        <span>{selected.label}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div
          className="menu fade-in"
          style={{ right: 0, top: "calc(100% + 4px)", minWidth: 220 }}
        >
          <div className="menu-hint">Show</div>
          {OPTIONS.map((opt) => {
            const active = value === opt.value;
            const count = counts[opt.value] ?? 0;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={
                  active
                    ? { background: "#F5F5F4", fontWeight: 500 }
                    : undefined
                }
              >
                <Icon name={opt.icon} size={14} />
                <span className="flex-1 text-left">{opt.label}</span>
                <span className="font-mono text-[10.5px] text-stone-500">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
