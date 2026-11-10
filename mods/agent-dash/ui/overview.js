// 개요: one agent's tokens, context, activity and what it is doing now; or, for all
// agents, who needs you and a table of everyone.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { alpha, card, empty, icon, kindColor, mongoLeaf, pill, programIcon, scrollArea, sectionTitle, stackBar, statusColor, statusGlyph, subGlyph, STATUS_LABEL, STATUS_RANK } from "./kit.js";
import { KINDS, isMongo, kindOf, toolTarget, toolTitle } from "../lib/tools.js";
import { callStatus, isHumanPrompt } from "../lib/session.js";
import { clip, firstLine, fmtDur, fmtInt, fmtK, relTime, sum } from "../lib/format.js";
import { relPath } from "../lib/paths.js";
import { subsCard } from "./subs.js";

const stat = (label, value, sub, t, extra = null) =>
  card(t).flex_1().min_w(170).p(14).gap(6)
    .child(div().text_size(11.5).text_color(t.dim).child(label))
    .child(div().text_size(22).font_semibold().text_color(t.foreground).child(value))
    .when(Boolean(sub), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(sub)))
    .when(Boolean(extra), (e) => e.child(extra));

function windowOf(session, ctx) {
  if (session.win) return session.win;
  if (/\[1m\]|1m/i.test(session.model ?? "") || ctx > 200000) return 1000000;
  return 200000;
}

function tokenCard(session, usage, t) {
  const total = usage.in + usage.out + usage.cr + usage.cw;
  const parts = [
    { value: usage.cr, color: t.ansi4, label: "캐시 읽기" },
    { value: usage.cw, color: t.ansi6, label: "캐시 쓰기" },
    { value: usage.in, color: t.ansi3, label: "입력" },
    { value: usage.out, color: t.ansi5, label: "출력" },
  ];
  const hit = usage.cr + usage.in + usage.cw ? Math.round((usage.cr / (usage.cr + usage.in + usage.cw)) * 100) : 0;
  return stat("토큰", fmtK(total), `캐시 적중 ${hit}%`, t, v_flex().gap(6).mt(2)
    .child(stackBar(parts, t, 6))
    .child(h_flex().gap(10).flex_wrap().children(parts.filter((p) => p.value).map((p) => h_flex().gap(4).items_center()
      .child(div().size(7).rounded(2).bg(p.color)).child(div().text_size(10.5).text_color(t.dim).child(`${p.label} ${fmtK(p.value)}`))))));
}

function contextCard(session, t) {
  const ctx = session.ctx ?? 0;
  const win = windowOf(session, ctx);
  const ratio = Math.min(1, ctx / win);
  const color = ratio > 0.85 ? t.del : ratio > 0.6 ? t.blocked : t.ansi2;
  return stat("컨텍스트", `${Math.round(ratio * 100)}%`, `${fmtK(ctx)} / ${fmtK(win)}${session.compacts.length ? ` · 압축 ${session.compacts.length}번` : ""}`, t,
    div().w_full().h(6).mt(2).rounded(3).bg(t.raised).child(div().h_full().rounded(3).bg(color).w(`${Math.max(2, ratio * 100)}%`)));
}

function activityCard(session, d, t) {
  const active = sum(Object.values(session.turnDur));
  const prompts = session.prompts.filter(isHumanPrompt).length;
  return stat("활동", `${fmtInt(d.calls.length)}번`, `프롬프트 ${prompts}개${active ? ` · 일한 시간 ${fmtDur(active / 1000)}` : ""}`, t, kindBar(d.calls, t));
}

function kindBar(calls, t) {
  const counts = {};
  for (const c of calls) counts[kindOf(c)] = (counts[kindOf(c)] ?? 0) + 1;
  const parts = Object.keys(KINDS).map((k) => ({ value: counts[k] ?? 0, color: t.kind[k], label: KINDS[k].label }));
  return v_flex().gap(6).mt(2).child(stackBar(parts, t, 6))
    .child(h_flex().gap(10).flex_wrap().children(parts.filter((p) => p.value).map((p) => h_flex().gap(4).items_center()
      .child(div().size(7).rounded(2).bg(p.color)).child(div().text_size(10.5).text_color(t.dim).child(`${p.label} ${p.value}`)))));
}

function filesCard(d, t) {
  const add = sum(d.files, (f) => f.add);
  const del = sum(d.files, (f) => f.del);
  return stat("변경", `${d.files.length}개 파일`, null, t, h_flex().gap(8).font_family(t.mono).text_size(12)
    .child(div().text_color(t.add).child(`+${fmtInt(add)}`)).child(div().text_color(t.del).child(`−${fmtInt(del)}`)));
}

function callLine(call, address, status, ctx, t, rel) {
  const kind = kindOf(call);
  const mongo = isMongo(call);
  return h_flex().id(`now-${call.id}`).w_full().gap(10).items_center().px(12).py(10).rounded(9).cursor_pointer().bg(t.raised).hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => ctx.openCall(address, call.id, cx))
    .child(mongo ? mongoLeaf(15) : icon(KINDS[kind]?.icon ?? "bot", 15, kindColor(t, kind)))
    .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child(toolTitle(call)))
    .child(div().flex_1().min_w(0).truncate().font_family(t.mono).text_size(12).text_color(t.muted).child(toolTarget(call, rel)))
    .when(status === "running", (e) => e.child(icon("spinner", 12, t.working).spin(900)).child(div().text_size(11.5).text_color(t.working).child(fmtDur((Date.now() - call.ts) / 1000))))
    .when(status === "pending", (e) => e.child(pill("승인 대기", t.blocked, t)))
    .child(icon("chevron-right", 13, t.dim));
}

function nowCard(ctx, d, t) {
  const { agent, session, scope } = ctx;
  const term = ctx.terms?.[scope];
  const open = [...d.calls].reverse().find((c) => !c.result);
  const status = open ? callStatus(open, session, agent.status) : null;
  const last = d.calls[d.calls.length - 1];
  const reply = session.replies[session.replies.length - 1];
  const rel = (p) => relPath(p, term?.foreground?.cwd ?? session.cwd, ctx.home);
  const title = agent.status === "blocked" ? (agent.sub ? "답을 기다려요" : "당신의 답을 기다려요") : agent.status === "working" ? "지금 하는 일" : "마지막으로 한 일";
  return card(t).p(16).gap(10)
    .child(h_flex().gap(8).items_center()
      .child(agent.sub ? subGlyph(agent, t) : statusGlyph(agent.status, t, true))
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(term?.report?.msg) && agent.status === "working", (e) => e.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.working).child(term.report.msg))))
    .when(Boolean(open && (status === "running" || status === "pending")), (e) => e.child(callLine(open, scope, status, ctx, t, rel)))
    .when(!(open && (status === "running" || status === "pending")) && Boolean(last), (e) => e.child(callLine(last, scope, "ok", ctx, t, rel)))
    .when(Boolean(reply) && agent.status !== "working", (e) => e.child(v_flex().gap(6).p(12).rounded(9).border(1).border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(`마지막 답변 · ${relTime(reply.ts)}`))
      .child(div().text_size(12.5).max_h(180).overflow_hidden().child(TextView.markdown(`reply-${reply.n}`, clip(reply.text, 1200))))));
}

function turnsCard(ctx, d, t) {
  const turns = d.turns.filter((x) => isHumanPrompt(x.prompt)).slice(-6).reverse();
  if (!turns.length) return null;
  return v_flex().w_full()
    .child(sectionTitle("최근 프롬프트", t))
    .child(v_flex().gap(2).children(turns.map((turn) => h_flex().id(`turn-${turn.prompt.n}`).w_full().gap(10).items_center().px(10).py(8).rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        ctx.setSel({ prompt: turn.prompt.n }, cx);
        ctx.pickLens("prompts", cx);
      })
      .child(div().px(5).h(16).rounded(4).bg(t.raised).text_size(10.5).font_semibold().text_color(t.muted).flex().items_center().child(`#${turn.prompt.n}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(firstLine(turn.prompt.display ?? turn.prompt.text) || "이미지"))
      .child(div().text_size(11).text_color(t.dim).child(`호출 ${turn.calls}`))
      .child(div().w(64).text_right().text_size(11).text_color(t.dim).child(relTime(turn.start))))));
}

function topFiles(ctx, d, t) {
  if (!d.files.length) return null;
  const rel = (p) => relPath(p, ctx.terms?.[ctx.scope]?.foreground?.cwd ?? ctx.session.cwd, ctx.home);
  return v_flex().w_full()
    .child(sectionTitle("바뀐 파일", t))
    .child(v_flex().gap(2).children(d.files.slice(0, 6).map((f) => h_flex().id(`of-${f.path}`).w_full().gap(10).items_center().px(10).py(7).rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => ctx.openFile(f.path, cx))
      .child(div().w(14).text_size(11).font_semibold().text_color(f.status === "A" ? t.add : t.blocked).child(f.status))
      .child(div().flex_1().min_w(0).truncate().font_family(t.mono).text_size(12).text_color(t.foreground).child(rel(f.path)))
      .child(div().font_family(t.mono).text_size(11).text_color(t.add).child(`+${f.add}`))
      .child(div().font_family(t.mono).text_size(11).text_color(t.del).child(`−${f.del}`)))));
}

function agentOverview(ctx, t) {
  const { session } = ctx;
  if (!session || (!session.loaded && !session.calls.length)) return empty("기록을 읽는 중이에요", null, t, "hourglass");
  if (session.note) return empty("기록을 볼 수 없어요", null, t, "info");
  const d = ctx.store.derived(session);
  return scrollArea("overview-scroll", v_flex().p(18).gap(16)
    .child(h_flex().w_full().gap(12).flex_wrap().items_stretch()
      .child(tokenCard(session, d.usage, t))
      .child(contextCard(session, t))
      .child(activityCard(session, d, t))
      .child(filesCard(d, t)))
    .child(nowCard(ctx, d, t))
    .child(subsCard(ctx, t) ?? div())
    .child(turnsCard(ctx, d, t) ?? div())
    .child(topFiles(ctx, d, t) ?? div()));
}

// ---------- all agents ----------

function attention(ctx, list, t) {
  const blocked = list.filter((a) => a.status === "blocked");
  if (!blocked.length) return null;
  return v_flex().w_full().p(14).gap(8).rounded(10).bg(alpha(t.blocked, 0.07)).border(1).border_color(alpha(t.blocked, 0.3))
    .child(h_flex().gap(8).items_center().child(icon("alert", 14, t.blocked)).child(div().text_size(13).font_semibold().text_color(t.foreground).child(`${blocked.length}개 에이전트가 답을 기다려요`)))
    .children(blocked.map((a) => {
      const s = ctx.store.get(a.address);
      const open = s ? [...s.calls].reverse().find((c) => !c.result) : null;
      return h_flex().id(`att-${a.address}`).w_full().gap(10).items_center().px(10).py(8).rounded(8).cursor_pointer().bg(t.background).hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => ctx.pickScope(a.address, cx))
        .child(programIcon(a.program, 18, t))
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(a.title))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(open ? `${toolTitle(open)} ${toolTarget(open)}` : `${a.space_name} › ${a.tab_name}`))
        .child(icon("chevron-right", 13, t.dim));
    }));
}

function fleetRow(a, ctx, t) {
  const s = ctx.store.get(a.address);
  const d = ctx.store.derived(s);
  const term = ctx.terms?.[a.address];
  const last = d?.calls[d.calls.length - 1];
  const usage = d?.usage;
  const activity = a.status === "working" && term?.report?.msg ? term.report.msg : last ? `${toolTitle(last)} ${toolTarget(last)}` : s?.note ? "기록 없음" : "—";
  const cell = (w, child) => div().w(w).flex_none().child(child);
  return h_flex().id(`fl-${a.address}`).w_full().h(48).px(12).gap(12).items_center().border_t(1).border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover))
    .on_click((_e, cx) => ctx.pickScope(a.address, cx))
    .child(programIcon(a.program, 22, t))
    .child(v_flex().w(220).flex_none().min_w(0).gap(1)
      .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(a.title))
      .child(div().truncate().text_size(11).text_color(t.dim).child(a.sub ? `↳ ${ctx.agents[a.parent]?.title ?? a.parent}의 하위 에이전트` : `${a.space_name} › ${a.tab_name}`)))
    .child(cell(96, pill(STATUS_LABEL[a.status] ?? a.status, statusColor(a.status, t), t)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(t.mono).text_color(a.status === "working" ? t.working : t.muted).child(activity))
    .child(cell(70, div().text_right().text_size(12).text_color(t.muted).child(d ? fmtInt(d.calls.length) : "")))
    .child(cell(70, div().text_right().text_size(12).text_color(t.muted).child(usage ? fmtK(usage.in + usage.out + usage.cr + usage.cw) : "")))
    .child(cell(70, div().text_right().text_size(12).text_color(t.muted).child(d ? String(d.files.length) : "")))
    .child(cell(70, div().text_right().text_size(11).text_color(t.dim).child(relTime(term?.status_ms))));
}

function fleetOverview(ctx, t) {
  const list = Object.values(ctx.agents).sort((x, y) => (STATUS_RANK[y.status] ?? 0) - (STATUS_RANK[x.status] ?? 0));
  const head = (w, text, right = true) => div().w(w).flex_none().when(right, (e) => e.text_right()).text_size(11).text_color(t.dim).child(text);
  return scrollArea("fleet-scroll", v_flex().p(18).gap(16)
    .child(attention(ctx, list, t) ?? div())
    .child(card(t).overflow_hidden()
      .child(h_flex().w_full().h(34).px(12).gap(12).items_center()
        .child(div().w(22).flex_none()).child(head(220, "에이전트", false)).child(head(96, "상태", false))
        .child(div().flex_1().text_size(11).text_color(t.dim).child("지금 / 마지막 호출"))
        .child(head(70, "호출")).child(head(70, "토큰")).child(head(70, "파일")).child(head(70, "변화")))
      .children(list.map((a) => fleetRow(a, ctx, t)))));
}

export function overviewLens(ctx, t) {
  return ctx.scope === "all" ? fleetOverview(ctx, t) : agentOverview(ctx, t);
}
