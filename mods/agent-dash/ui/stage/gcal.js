// Google Calendar calls drawn like Calendar (light theme): the Schedule view for a list of
// events, the event card for one, the calendar list, suggested times.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { memo } from "./common.js";
import { dayLabel, parseGcal, timeRange } from "../../lib/gcal.js";
import { blocks, hueOf } from "../../lib/rich.js";
import { avatar, bold, brand, budget, openLink, richBody, sheet } from "./rich.js";

export const GCAL = {
  bg: "#FFFFFF", text: "#1F1F1F", dim: "#444746", subtle: "#5E5E5E", link: "#0B57D0", border: "#DADCE0", headBg: "#F8FAFD", hover: "#F1F3F4",
  codeBg: "#F1F3F4", codeFg: "#1F1F1F", preBg: "#F8FAFD", preBorder: "#DADCE0", quoteBar: "#C4C7C5", size: 14, h: [18, 16, 14], hWeight: 500, bold: 600,
  mono: "JetBrains Mono", tableRadius: 4, buttonRadius: 18, mentionBg: "#D3E3FD", mentionFg: "#041E49", callout: { default: "#F8FAFD" },
  accent: "#0B57D0",
};
const STATUS_MARK = { accepted: ["✓", "#188038"], declined: ["✕", "#C5221F"], tentative: ["?", "#5E5E5E"], needsAction: ["", "#5E5E5E"] };
const CALENDAR_COLORS = ["#039BE5", "#33B679", "#8E24AA", "#F4511E", "#F6BF26", "#7986CB", "#D50000", "#616161"];

const top = (title, sub, url, ctx, id) => h_flex().w_full().px(20).pt(14).gap(10).items_center()
  .child(brand("brand-gcal", 22)).child(div().flex_none().text_size(18).text_color(GCAL.dim).child(title))
  .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(GCAL.subtle).child(sub ?? ""))
  .child(openLink(`${id}-open`, "Calendar에서 열기", url, GCAL, ctx));

function eventRow(e, id, ctx) {
  const el = h_flex().id(id).flex_1().min_w(0).h(32).px(10).gap(12).items_center().rounded(16).hover((s) => s.bg(GCAL.hover))
    .child(div().size(10).flex_none().rounded(5).bg(e.color))
    .child(div().w(168).flex_none().truncate().text_size(14).text_color(GCAL.text).child(timeRange(e.start, e.end)))
    .child(div().flex_1().min_w(0).truncate().text_size(14).when(true, (w) => bold(w, 500)).text_color(GCAL.text).when(e.cancelled, (x) => x.line_through()).child(e.title))
    .when(Boolean(e.location), (x) => x.child(div().flex_none().max_w(220).truncate().text_size(12).text_color(GCAL.subtle).child(e.location ?? "")));
  return e.url ? el.cursor_pointer().on_click((_e, cx) => ctx.openUrl(e.url, cx)) : el;
}

function agendaView(view, call, ctx) {
  const id = `gca-${call.id}`;
  const range = view.from ? `${dayLabel(view.from).long}${view.to ? ` ~ ${view.to.mo}월 ${view.to.d}일` : " 부터"}` : null;
  const sub = [view.calendar, view.query ? `검색: ${view.query}` : null, range].filter(Boolean).join(" · ");
  let n = 0;
  const days = view.days.slice(0, 31).map((day, di) => h_flex().w_full().py(6).items_start().when(di > 0, (e) => e.border_t(1).border_color(GCAL.border))
    .child(h_flex().w(118).flex_none().h(32).pl(8).gap(8).items_center()
      .child(div().w(30).flex_none().text_right().text_size(20).text_color(GCAL.text).child(day.label.num))
      .child(div().flex_none().text_size(11).text_color(GCAL.subtle).child(day.label.sub)))
    .child(v_flex().flex_1().min_w(0).children(day.events.slice(0, 20).map((e) => eventRow(e, `${id}-${n++}`, ctx)))));
  return sheet(GCAL, [
    top("일정", sub, null, ctx, id),
    v_flex().w_full().px(12).pt(10).pb(14)
      .child(view.pending ? div().px(8).py(12).text_size(14).text_color(GCAL.subtle).child("일정을 불러오고 있어요")
        : days.length ? v_flex().w_full().children(days).child(div().w_full().pt(8).pr(8).text_right().text_size(12).text_color(GCAL.subtle).child(`일정 ${view.count}개${view.more ? " 이상" : ""}`))
        : div().px(8).py(18).text_size(14).text_color(GCAL.subtle).child("이 기간에 일정이 없어요")),
  ]);
}

const line = (mark, child) => h_flex().w_full().gap(16).items_start().child(div().w(20).flex_none().pt(1).text_size(15).text_color(GCAL.dim).text_center().child(mark)).child(div().flex_1().min_w(0).child(child));

function guestRow(g) {
  const [mark, color] = STATUS_MARK[g.status] ?? STATUS_MARK.needsAction;
  return h_flex().w_full().h(30).gap(10).items_center()
    .child(div().relative().flex_none().child(avatar(g, 24, 12, hueOf(g.name)))
      .when(Boolean(mark), (e) => e.child(div().absolute().right(-4).bottom(-3).size(13).rounded(7).bg(color).border(1).border_color("#FFFFFF").text_size(8).text_color("#FFFFFF").flex().items_center().justify_center().child(mark))))
    .child(div().min_w(0).truncate().text_size(14).text_color(GCAL.text).child(g.name))
    .child(div().flex_none().text_size(12).text_color(GCAL.subtle).child([g.self ? "나" : null, g.optional ? "선택" : null].filter(Boolean).join(" · ")));
}

function eventView(view, call, ctx) {
  const id = `gce-${call.id}`;
  const e = view.event;
  if (!e) return sheet(GCAL, [top("일정", view.notice, null, ctx, id), div().px(20).py(16).text_size(14).text_color(GCAL.subtle).child("일정을 기다리고 있어요")]);
  const when = e.start ? `${dayLabel(e.start).long} · ${timeRange(e.start, e.end)}` : "";
  const answered = e.guests.filter((g) => g.status === "accepted").length;
  return sheet(GCAL, [
    top("일정", view.pending ? "보내는 중" : view.notice, e.url, ctx, id),
    v_flex().w_full().px(20).pt(14).pb(20).gap(14)
      .child(line(div().size(14).mt(6).rounded(4).bg(e.color), v_flex().w_full().gap(2)
        .child(div().text_size(22).line_height(1.3).text_color(GCAL.text).when(view.deleted || e.cancelled, (x) => x.line_through()).child(e.title))
        .child(div().text_size(14).text_color(GCAL.dim).child([when, e.recurring ? "반복 일정" : null, e.typeLabel].filter(Boolean).join(" · ")))))
      .when(Boolean(e.meet), (x) => x.child(line("📹", h_flex().gap(10).items_center()
        .child(div().id(`${id}-meet`).flex_none().h(36).px(22).rounded(18).bg(GCAL.accent).text_size(14).when(true, (w) => bold(w, 500)).text_color("#FFFFFF").flex().items_center().cursor_pointer()
          .on_click((_e, cx) => ctx.openUrl(e.meet, cx)).child("Google Meet으로 참여"))
        .child(div().min_w(0).truncate().text_size(12).text_color(GCAL.subtle).child(String(e.meet).replace(/^https?:\/\//, ""))))))
      .when(Boolean(e.location) || e.rooms.length > 0, (x) => x.child(line("📍", v_flex().gap(2)
        .children([e.location, ...e.rooms.map((r) => r.name)].filter((v, i, all) => v && all.indexOf(v) === i).map((v) => div().text_size(14).text_color(GCAL.text).child(v))))))
      .when(e.guests.length > 0, (x) => x.child(line("👥", v_flex().w_full().gap(2)
        .child(div().text_size(14).text_color(GCAL.text).child(`참석자 ${e.guests.length}명`))
        .child(div().pb(4).text_size(12).text_color(GCAL.subtle).child(`수락 ${answered}명 · 응답 대기 ${e.guests.filter((g) => g.status === "needsAction").length}명`))
        .children(e.guests.slice(0, 24).map(guestRow))
        .when(e.guests.length > 24, (y) => y.child(div().text_size(12).text_color(GCAL.subtle).child(`외 ${e.guests.length - 24}명`))))))
      .when(Boolean(view.descBlocks?.length), (x) => x.child(line("≡", richBody(view.descBlocks, `${id}-d`, GCAL, ctx, budget()))))
      .when(Boolean(e.organizer), (x) => x.child(line("📅", div().text_size(14).text_color(GCAL.text).child(e.organizer?.self ? "내 캘린더" : `${e.organizer?.name ?? ""} (주최)`)))),
  ]);
}

function calendarsView(view, call, ctx) {
  const id = `gcl-${call.id}`;
  return sheet(GCAL, [
    top("캘린더", `내 캘린더 ${view.calendars.length}개`, null, ctx, id),
    v_flex().w_full().px(20).pt(10).pb(16).gap(2).children(view.calendars.slice(0, 60).map((c, i) => h_flex().w_full().min_h(32).gap(12).items_center()
      .child(div().size(18).flex_none().rounded(3).bg(CALENDAR_COLORS[i % CALENDAR_COLORS.length]).text_size(11).text_color("#FFFFFF").flex().items_center().justify_center().child("✓"))
      .child(div().flex_none().max_w(320).truncate().text_size(14).text_color(GCAL.text).child(c.name))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(GCAL.subtle).child(c.description ?? "")))),
  ]);
}

function slotsView(view, call, ctx) {
  const id = `gcs-${call.id}`;
  const sub = [view.minutes ? `${view.minutes}분` : null, view.guests.length ? `참석자 ${view.guests.length}명` : null].filter(Boolean).join(" · ");
  return sheet(GCAL, [
    top("추천 시간", sub, null, ctx, id),
    v_flex().w_full().px(20).pt(10).pb(16).gap(6).children(view.slots.slice(0, 30).map((s) => h_flex().w_full().h(40).px(14).gap(12).items_center().rounded(8).border(1).border_color(GCAL.border)
      .child(div().size(10).flex_none().rounded(5).bg("#039BE5"))
      .child(div().flex_none().text_size(14).when(true, (w) => bold(w, 500)).text_color(GCAL.text).child(dayLabel(s.start).long))
      .child(div().flex_1().text_size(14).text_color(GCAL.dim).child(timeRange(s.start, s.end))))),
  ]);
}

/** Everything parsed, ready to draw (off the render pass). Null when it isn't Calendar data. */
export function prepareGcal(call) {
  const view = parseGcal(call);
  if (!view) return null;
  return view.kind === "event" && view.event?.description ? { ...view, descBlocks: blocks(view.event.description, 60) } : view;
}

/** The Calendar-looking view of a prepared call, or null (the generic view draws it). */
export function drawGcal(view, call, ctx) {
  if (!view) return null;
  if (view.kind === "agenda") return agendaView(view, call, ctx);
  if (view.kind === "event") return eventView(view, call, ctx);
  if (view.kind === "calendars") return calendarsView(view, call, ctx);
  return slotsView(view, call, ctx);
}

export const renderGcal = (call, ctx) => drawGcal(memo(call, `gcal:${Boolean(call.result)}`, () => prepareGcal(call)), call, ctx);
