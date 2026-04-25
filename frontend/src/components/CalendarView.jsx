import { useEffect, useMemo, useState } from "react";
import { Calendar, Views, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, parse, parseISO, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { PLATFORMS, getPlatformColor } from "./utils";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
});

const AVAILABLE_VIEWS = [Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA];

// WCAG relative luminance — lets us pick a text color (dark or light) that
// meets contrast against any platform brand fill, including the bright
// cyan TikTok and pale silver X colors that broke the prior all-white
// text scheme.
function _luminance(hex) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return 0.5;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function eventStyleGetter(event) {
  const color = getPlatformColor(event.platform);
  const text = _luminance(color) > 0.55 ? "#0a0b10" : "#ffffff";
  const isSeries = !!event._raw?.series_id;
  return {
    style: {
      backgroundColor: color,
      // Solid darker accent stripe on the left — second visual cue
      // beyond hue alone, helps deuteranopia/protanopia readers.
      borderLeft: `4px solid ${text === "#ffffff" ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.25)"}`,
      borderColor: color,
      color: text,
      fontSize: 12,
      fontWeight: 600,
      padding: "2px 6px",
      borderRadius: 4,
      ...(isSeries && {
        boxShadow: `inset 0 0 0 1.5px ${
          text === "#ffffff" ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)"
        }`,
      }),
    },
  };
}

function nearestEventDate(events) {
  if (events.length === 0) return new Date();
  const now = Date.now();
  // Prefer the next upcoming event; fall back to the most recent past one.
  const upcoming = events
    .filter((e) => e.start.getTime() >= now)
    .sort((a, b) => a.start - b.start);
  if (upcoming.length > 0) return upcoming[0].start;
  return events
    .slice()
    .sort((a, b) => b.start - a.start)[0].start;
}

export default function CalendarView({ posts, onSelectEvent }) {
  const events = useMemo(
    () =>
      (posts || [])
        .filter((p) => p.scheduled_at && p.status !== "archived")
        .map((p) => {
          const start = parseISO(p.scheduled_at);
          const end = new Date(start.getTime() + 30 * 60 * 1000);
          // Prefix the platform short-code so the event is identifiable
          // without relying on hue alone. Critical for colorblind users
          // and for the small Month-view tiles where the fill stripe is
          // narrow.
          const short = PLATFORMS[p.platform]?.short
            || (p.platform || "?").slice(0, 2).toUpperCase();
          return {
            id: p.id,
            title: `[${short}] ${p.title}`,
            start,
            end,
            platform: p.platform,
            _raw: p,
          };
        }),
    [posts]
  );

  const [view, setView] = useState(Views.MONTH);
  const [date, setDate] = useState(() => nearestEventDate(events));

  // If the calendar opens empty and events arrive later, re-anchor the date
  // so switching to Week/Day lands on something visible.
  useEffect(() => {
    if (events.length > 0) {
      setDate((d) => {
        const hasNearby = events.some(
          (e) => Math.abs(e.start.getTime() - d.getTime()) < 14 * 24 * 60 * 60 * 1000
        );
        return hasNearby ? d : nearestEventDate(events);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // When the user switches to Week/Day, make sure we're anchored somewhere
  // that has events — otherwise they see an empty grid.
  function handleViewChange(next) {
    setView(next);
    if (next === Views.DAY || next === Views.WEEK) {
      if (events.length === 0) return;
      const windowMs =
        next === Views.DAY ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      const hasNearby = events.some(
        (e) => Math.abs(e.start.getTime() - date.getTime()) < windowMs
      );
      if (!hasNearby) setDate(nearestEventDate(events));
    }
  }

  return (
    <div className="rbc-host rounded-lg border border-stone-200 bg-white p-3">
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        view={view}
        onView={handleViewChange}
        date={date}
        onNavigate={setDate}
        views={AVAILABLE_VIEWS}
        style={{ height: 640 }}
        eventPropGetter={eventStyleGetter}
        onSelectEvent={(e) => onSelectEvent?.(e._raw)}
        popup
        showMultiDayTimes
        scrollToTime={new Date(1970, 0, 1, 8, 0, 0)}
        length={30}
        messages={{
          month: "Month",
          week: "Week",
          day: "Day",
          agenda: "Agenda",
          today: "Today",
          previous: "Back",
          next: "Next",
          noEventsInRange: "No scheduled posts in this range.",
        }}
      />
    </div>
  );
}
