"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { TRPCClientError } from "@trpc/client";
import { api } from "@/lib/api-client";
import { campusToday, weekDates, weekRange, shiftWeek, campusTime, campusDate, formatDate, minutesInDay, CAMPUS_ZONE } from "@/lib/timetable/dates";
import { layoutEvents } from "@/lib/timetable/layout";
import { loadAllPages } from "@/lib/timetable/load-pages";
import type { TimetableItem } from "@/server/services/timetable";

function failed(error: unknown) {
  if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") window.location.replace("/?session=expired");
}
function Icon({ name }: { name: string }) { return <Image src={`/images/timetable/${name}.svg`} width={16} height={16} alt="" />; }
function sourceLabel(kind: string) { return kind === "test" ? "Test data · unverified" : kind === "official" ? "Official source" : "Supplementary source"; }
function Capacity({ item }: { item: TimetableItem }) {
  const c = item.capacity;
  return <><dl className="detail-fields"><div><dt>Total capacity</dt><dd>{c?.total ?? "Unknown"}</dd></div><div><dt>Available places</dt><dd>{c?.available ?? "Unknown"}</dd></div></dl>
    {c && <p className="detail-hint">{c.source.name} · {sourceLabel(c.source.kind)}<br />Observed {formatDate(campusDate(c.observedAt), { day: "numeric", month: "short", year: "numeric" })}, {campusTime(c.observedAt)}</p>}
    {!c && <p className="detail-hint">No current capacity snapshot is available.</p>}</>;
}
function EntryDetail({ id, reload, close, restoreFocus }: { id: string; reload: number; close: () => void; restoreFocus: () => void }) {
  const [result, setState] = useState<{ item?: TimetableItem; error?: boolean; revision?: number }>({});
  const state = result.revision === reload ? result : {};
  useEffect(() => {
    let active = true;
    api.timetable.getEntry.query({ entryId: id }).then(item => { if (active) setState({ item, revision: reload }); }).catch(error => { failed(error); if (active) setState({ error: true, revision: reload }); });
    return () => { active = false; };
  }, [id, reload]);
  return <Dialog.Portal><Dialog.Overlay className="detail-overlay" /><Dialog.Content className="detail-drawer" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
    <Dialog.Title className="sr-only">Course details</Dialog.Title><Dialog.Description className="sr-only">Class time, location, capacity and data source.</Dialog.Description>
    <button className="detail-close" onClick={close} aria-label="Close course details">×</button>
    {!state.item && !state.error && <p role="status" className="p-6">Loading course details…</p>}
    {state.error && <p role="alert" className="p-6 pt-16">Unable to load this class. It may no longer be available to you. Close this panel and refresh your timetable.</p>}
    {state.item && <><header className="detail-heading"><span className="class-tag">{state.item.classType}</span><h2>{state.item.course.code}</h2><p>{state.item.course.name}</p></header>
      <section><h3>Class details</h3><dl className="detail-fields"><div><dt>Class type</dt><dd>{state.item.classType}</dd></div><div><dt>Date</dt><dd>{formatDate(campusDate(state.item.startAt), { weekday: "short", day: "numeric", month: "short" })}</dd></div><div><dt>Time</dt><dd>{campusTime(state.item.startAt)} – {campusTime(state.item.endAt)}{campusDate(state.item.endAt) !== campusDate(state.item.startAt) && <> ({campusDate(state.item.endAt)})</>}</dd></div><div><dt>Location</dt><dd>{state.item.location ?? "Not provided"}</dd></div></dl><p className="detail-hint">All times in {CAMPUS_ZONE}</p></section>
      <section><h3>Capacity</h3><Capacity item={state.item} /></section>
      <section><h3>Data source</h3><dl className="detail-fields"><div><dt>Source</dt><dd>{state.item.source.name}</dd></div><div><dt>Status</dt><dd>{sourceLabel(state.item.source.kind)}{state.item.source.kind !== "test" && ` · ${state.item.verificationStatus}`}</dd></div><div><dt>Source updated</dt><dd>{state.item.sourceUpdatedAt ? `${campusDate(state.item.sourceUpdatedAt)} ${campusTime(state.item.sourceUpdatedAt)}` : "Not provided"}</dd></div><div><dt>Last imported</dt><dd>{campusDate(state.item.syncedAt)} {campusTime(state.item.syncedAt)}</dd></div></dl>{state.item.sourceUpdateFailed && <p role="status" className="detail-hint">The latest source update failed. This is the last successfully imported record.</p>}</section>
      <section><h3>Supplementary information</h3><p className="detail-hint">No supplementary information has been added.</p></section></>}
  </Dialog.Content></Dialog.Portal>;
}
function Card({ item, select }: { item: TimetableItem; select: (button: HTMLButtonElement) => void }) {
  const palette = [...item.course.code].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return <button className={`course-card palette-${palette}`} onClick={event => select(event.currentTarget)} aria-label={`${item.course.code} ${item.classType}, ${campusTime(item.startAt)}, view details`}><span className="course-card-title">{item.course.code}<span>{item.classType}</span></span><span className="course-card-name">{item.course.name}</span><span className="course-card-time">{campusTime(item.startAt)} – {campusTime(item.endAt)}</span><span className="course-card-place"><Icon name="location" />{item.location ?? "Location pending"}</span></button>;
}
export function Timetable() {
  const [date, setDate] = useState(campusToday);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ items: TimetableItem[]; loading: boolean; error: boolean }>({ items: [], loading: true, error: false });
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function select(item: TimetableItem, button: HTMLButtonElement) { trigger.current = button; setSelected(item.id); }
  const days = weekDates(date), { from, to } = weekRange(date);
  useEffect(() => {
    const abort = new AbortController();
    loadAllPages(cursor => api.timetable.mine.query({ from, to, cursor, limit: 20 }, { signal: abort.signal })).then(items => { if (!abort.signal.aborted) { setState({ items, loading: false, error: false }); setSelected(current => items.some(i => i.id === current) ? current : null); } }).catch(error => { if (!abort.signal.aborted) { failed(error); setState({ items: [], loading: false, error: true }); setSelected(null); } });
    return () => abort.abort();
  }, [from, to, reload]); // The normalized range is stable across render.
  function refresh() { setSelected(null); setState({ items: [], loading: true, error: false }); setReload(n => n + 1); }
  function navigate(next: string) { setSelected(null); setState({ items: [], loading: true, error: false }); setDate(next); setReload(n => n + 1); }
  // Revocations and database edits become visible on focus, reconnection and every 30 seconds.
  useEffect(() => { const update = () => { setReload(n => n + 1); }; const timer = setInterval(update, 30000); window.addEventListener("focus", update); window.addEventListener("online", update); return () => { clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("online", update); }; }, []);
  const dayItems = (day: string) => state.items.filter(item => campusDate(item.startAt) <= day && (campusDate(item.endAt) > day || (campusDate(item.endAt) === day && minutesInDay(item.endAt) > 0)));
  const visibleDays = days.some((day, i) => i > 4 && dayItems(day).length) ? days : days.slice(0, 5);
  const earliest = state.items.some(i => campusDate(i.startAt) !== campusDate(i.endAt)) ? 0 : Math.min(8, ...state.items.map(i => Math.floor(minutesInDay(i.startAt) / 60)));
  const latest = Math.max(21, ...state.items.map(i => campusDate(i.startAt) !== campusDate(i.endAt) ? 24 : Math.ceil(minutesInDay(i.endAt) / 60)));
  const hours = Array.from({ length: latest - earliest }, (_, i) => earliest + i);
  return <main className="timetable-main"><header className="timetable-toolbar"><div className="flex items-center gap-3"><h1>My timetable</h1><span className="week-label">{formatDate(days[0], { day: "numeric", month: "short" })} – {formatDate(days[6], { day: "numeric", month: "short", year: "numeric" })}</span></div><div className="flex flex-wrap items-center gap-2"><button className="calendar-control" onClick={() => navigate(shiftWeek(date, -1))} aria-label="Previous week"><Icon name="previous" /></button><button className="calendar-control" onClick={() => navigate(shiftWeek(date, 1))} aria-label="Next week"><Icon name="next" /></button><button className="calendar-control px-3" onClick={() => navigate(campusToday())}>Today</button><label className="sr-only" htmlFor="week-date">Choose date</label><input id="week-date" aria-label="Choose date" type="date" value={date} onChange={e => { if (e.target.value) navigate(e.target.value); }} className="date-picker" /><button className="calendar-control px-3" onClick={refresh}>Refresh</button></div></header>
    <div className="timetable-meta"><span>{CAMPUS_ZONE}</span><span>{state.loading ? "Updating…" : state.error ? "Unavailable" : `${state.items.length} classes this week`}</span></div>
    {state.loading ? <div className="calendar-message" role="status"><div className="loading-bars" /><p>Loading your timetable…</p></div> : state.error ? <div className="calendar-message" role="alert"><h2>We couldn’t load your timetable</h2><p>Check your connection and try again.</p><button className="calendar-control px-4" onClick={refresh}>Try again</button></div> : !state.items.length ? <div className="calendar-message"><Icon name="calendar" /><h2>No classes this week</h2><p>Try another week to view your timetable.</p></div> : <>
      {state.items.some(i => i.source.kind === "test") && <p className="source-banner">Development test data · university verification pending</p>}
      {state.items.some(i => i.sourceUpdateFailed) && <p className="source-banner" role="status">Source update unavailable. Showing the last successful import.</p>}
      <div className="week-calendar" style={{ gridTemplateColumns: `60px repeat(${visibleDays.length}, minmax(120px, 1fr))` }}><div className="day-heading" />{visibleDays.map(day => <div className={`day-heading ${day === campusToday() ? "today" : ""}`} key={day}><span>{formatDate(day, { weekday: "short" })}</span><strong>{formatDate(day, { day: "numeric" })}</strong></div>)}
        <div className="time-axis">{hours.map(hour => <div key={hour}>{hour % 12 || 12}{hour < 12 ? "am" : "pm"}</div>)}</div>
        {visibleDays.map(day => <div className="day-column" key={day} style={{ height: hours.length * 60 }}><div className="hour-lines">{hours.map(h => <div key={h} />)}</div>{layoutEvents(dayItems(day).map(item => {
          const start = campusDate(item.startAt) < day ? earliest * 60 : minutesInDay(item.startAt);
          const end = campusDate(item.endAt) > day ? latest * 60 : minutesInDay(item.endAt);
          return { id: item.id, item, start, end: Math.max(start + 38, end) };
        })).map(({ item, start, end, column, columns }) => {
          return <div className="course-position" key={item.id} style={{ top: start - earliest * 60, minHeight: Math.max(38, end - start - 3), height: Math.max(38, end - start - 3), left: `${column / columns * 100}%`, width: `${100 / columns}%` }}><Card item={item} select={button => select(item, button)} /></div>;
        })}</div>)}
      </div><div className="mobile-agenda">{days.map(day => <section key={day}><h2>{formatDate(day, { weekday: "long", day: "numeric", month: "short" })}</h2>{dayItems(day).length ? dayItems(day).map(item => <Card key={item.id} item={item} select={button => select(item, button)} />) : <p>No classes</p>}</section>)}</div>
    </>}
    <Dialog.Root open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>{selected && <EntryDetail key={selected} id={selected} reload={reload} close={() => setSelected(null)} restoreFocus={() => trigger.current?.focus()} />}</Dialog.Root>
  </main>;
}
