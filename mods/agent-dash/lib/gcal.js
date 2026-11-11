// Google Calendar MCP calls -> what the Calendar-looking views draw. Pure.

import { initials } from "./rich.js";
import { masked } from "./tools.js";

const suffix = (name) => String(name ?? "").split("__").pop();
const TOOLS = {
  list_events: "agenda", search_events: "agenda", get_event: "event", create_event: "event", update_event: "event",
  delete_event: "event", respond_to_event: "event", list_calendars: "calendars", suggest_time: "slots",
};

export const gcalTool = (name) => (/calendar/i.test(name ?? "") ? TOOLS[suffix(name)] ?? null : null);

function tryJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Times are read from the text as the calendar wrote it (its own zone), so a 11:00 meeting in
// Seoul reads 11:00 wherever this runs.
function moment(at) {
  const text = at?.dateTime ?? at?.date ?? (typeof at === "string" ? at : null);
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text);
  if (!m) return null;
  const allDay = m[4] == null;
  return { day: `${m[1]}-${m[2]}-${m[3]}`, y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: allDay ? 0 : Number(m[4]), mi: allDay ? 0 : Number(m[5]), allDay };
}

const WEEK = "일월화수목금토";
const weekdayOf = (t) => new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay();
const clock = (t) => `${t.h < 12 ? "오전" : "오후"} ${t.h % 12 || 12}${t.mi ? `:${String(t.mi).padStart(2, "0")}` : ""}${t.mi ? "" : "시"}`;

/** "오전 11시 ~ 오후 12시", "종일", or with the end date when it ends on another day. */
export function timeRange(start, end) {
  if (!start) return "";
  if (start.allDay) return "종일";
  if (!end) return clock(start);
  return end.day === start.day ? `${clock(start)} ~ ${clock(end)}` : `${clock(start)} ~ ${end.mo}월 ${end.d}일 ${clock(end)}`;
}

export const dayLabel = (t) => ({ num: String(t.d), sub: `${t.mo}월, ${WEEK[weekdayOf(t)]}`, long: `${t.y}년 ${t.mo}월 ${t.d}일 (${WEEK[weekdayOf(t)]}요일)` });

// Calendar's event colours by kind (the default calendar colour, and the grey of an absence).
const TYPE = {
  DEFAULT: { color: "#039BE5", label: null },
  OUT_OF_OFFICE: { color: "#8E24AA", label: "부재중" },
  FOCUS_TIME: { color: "#3F51B5", label: "방해 금지 시간" },
  WORKING_LOCATION: { color: "#7986CB", label: "근무 위치" },
  BIRTHDAY: { color: "#33B679", label: "생일" },
  FROM_GMAIL: { color: "#F4511E", label: "Gmail 일정" },
};
const RESPONSE = { accepted: "수락", declined: "거절", tentative: "미정", needsAction: "응답 대기" };

function guest(a) {
  const name = a.displayName || String(a.email ?? "").split("@")[0] || "(알 수 없음)";
  return { name: masked(name), email: a.email ?? "", initials: initials(name), status: a.responseStatus ?? "needsAction", statusLabel: RESPONSE[a.responseStatus] ?? RESPONSE.needsAction, optional: Boolean(a.optionalAttendee), room: Boolean(a.resource), self: Boolean(a.self) };
}

const stripHtml = (text) => String(text ?? "").replace(/<br\s*\/?>|<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

function eventOf(e) {
  const type = TYPE[e.eventType] ?? TYPE.DEFAULT;
  const all = (e.attendees ?? []).map(guest);
  const organizer = e.organizer ? { name: masked(e.organizer.displayName || String(e.organizer.email ?? "").split("@")[0]), self: Boolean(e.organizer.self) } : null;
  return {
    id: e.id ?? null,
    title: masked(e.summary || "(제목 없음)"),
    start: moment(e.start),
    end: moment(e.end),
    color: type.color,
    typeLabel: type.label,
    location: e.location ? masked(e.location) : null,
    meet: e.conferenceUrl ?? e.conferenceData?.videoEntryPoint?.uri ?? null,
    url: e.htmlLink ?? null,
    guests: all.filter((g) => !g.room),
    rooms: all.filter((g) => g.room),
    organizer,
    description: e.description ? masked(stripHtml(e.description)) : null,
    recurring: Boolean(e.recurringEventId || e.recurrence?.length),
    cancelled: e.status === "cancelled",
  };
}

const NOTICE = { create_event: "일정을 만들었어요", update_event: "일정을 고쳤어요", delete_event: "일정을 지웠어요", respond_to_event: "초대에 답했어요" };

/** {kind, ...} for a Calendar call, or null when its result can't be read as Calendar data. */
export function parseGcal(call) {
  const kind = gcalTool(call.name);
  if (!kind) return null;
  const input = call.input ?? {};
  const data = tryJson(call.result?.text);
  if (call.result && !data) return null;
  const pending = !call.result;
  if (kind === "agenda") {
    const events = (data?.events ?? []).map(eventOf).filter((e) => e.start);
    const days = [];
    for (const e of events) {
      const last = days[days.length - 1];
      if (last && last.day === e.start.day) last.events.push(e);
      else days.push({ day: e.start.day, label: dayLabel(e.start), events: [e] });
    }
    return { kind, calendar: data?.summary ? masked(data.summary) : null, query: input.fullText ?? input.query ?? "", from: moment(input.startTime), to: moment(input.endTime), days, count: events.length, more: Boolean(data?.nextPageToken), pending };
  }
  if (kind === "event") {
    const tool = suffix(call.name);
    // A write that hasn't answered yet (or answered without the event) is drawn from what was sent.
    const sent = { summary: input.summary, start: input.startTime ? { dateTime: input.startTime } : null, end: input.endTime ? { dateTime: input.endTime } : null, location: input.location, description: input.description, attendees: input.attendees ?? (input.attendeeEmails ?? []).map((email) => ({ email })), id: input.eventId };
    const source = data?.start ? data : sent.start ? sent : null;
    if (!source) return pending ? { kind, event: null, notice: NOTICE[tool] ?? null, pending } : null;
    return { kind, event: eventOf(source), notice: NOTICE[tool] ?? null, deleted: tool === "delete_event", pending };
  }
  if (kind === "calendars") {
    const calendars = (data?.calendars ?? []).map((c) => ({ name: masked(c.summary ?? c.id ?? ""), description: c.description ? masked(c.description) : null, primary: Boolean(c.primary) }));
    if (!pending && !calendars.length) return null;
    return { kind, calendars, pending };
  }
  const slots = (data?.timeSlots ?? []).map((s) => ({ start: moment(s.start ?? s.startTime), end: moment(s.end ?? s.endTime), minutes: s.durationMinutes ?? null })).filter((s) => s.start);
  if (!pending && !slots.length) return null;
  return { kind, slots, guests: (input.attendeeEmails ?? []).map((email) => guest({ email })), minutes: input.durationMinutes ?? null, pending };
}
