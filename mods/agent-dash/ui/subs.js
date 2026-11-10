// 하위 에이전트: the terminals an agent started with `hc run`, as a tree (who started whom),
// and for the one picked: what it was asked, its steps (newest first) and what it reported.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView, h_resizable, resizable_panel } from "gpui-base";
import { alpha, button, card, chip, empty, icon, pill, programIcon, scrollArea, sectionTitle, statusColor, subGlyph, treeLines, STATUS_LABEL } from "./kit.js";
import { callRow } from "./calls.js";
import { callStatus, isHumanPrompt } from "../lib/session.js";
import { toolTarget, toolTitle } from "../lib/tools.js";
import { clip, firstLine, fmtDur, fmtInt, fmtK, relTime } from "../lib/format.js";
import { relPath, tildePath } from "../lib/paths.js";
import { ancestors, descendants } from "../lib/tree.js";

const ROW_H = 50;
const STEP_LIMIT = 150;
const NOTES = {
  unsupported: "이 프로그램의 기록 형식은 읽지 못해요. Claude Code와 Codex의 단계만 보여요.",
  missing: "이 하위 에이전트의 대화 기록 파일을 찾지 못했어요.",
  nopid: "프로세스를 찾지 못했어요.",
  remote: "다른 머신에서 도는 하위 에이전트예요. 원격 기록 읽기는 아직 지원하지 않아요.",
};

/** Tree rows for a scope: an agent's descendants, or (all) every agent that has some. */
export function subRows(roster, scope) {
  if (scope !== "all") return descendants(roster, scope);
  return roster.roots.filter((r) => roster.kids[r]?.length).flatMap((r) => [{ node: roster.nodes[r], lines: [], head: true }, ...descendants(roster, r)]);
}

export const subCount = (roster, scope) => subRows(roster, scope).filter((r) => !r.head).length;

/** What a sub-agent is doing now, in a line. */
function stepLine(node, session, d, rel) {
  if (!node.isAgent) return node.command;
  if (!d?.calls.length) return node.task ? firstLine(node.task) : session?.note ? "기록 없음" : session?.loaded ? "아직 도구를 쓰지 않았어요" : "기록을 읽는 중…";
  const last = d.calls[d.calls.length - 1];
  return `${toolTitle(last)} ${toolTarget(last, rel)}`.trim();
}

const elapsed = (node, now) => {
  if (!node.created) return "";
  return fmtDur(((node.finished ?? now) - node.created) / 1000);
};

function treeRow(row, selected, ctx, t, now) {
  const { node } = row;
  const session = ctx.store.get(node.address);
  const d = ctx.store.derived(session);
  const ended = node.state === "ended";
  const working = node.status === "working";
  const term = ctx.terms?.[node.address];
  const rel = (p) => relPath(p, term?.foreground?.cwd ?? term?.cwd ?? session?.cwd, ctx.home);
  return h_flex().id(`sub-${node.address}`).w_full().h(ROW_H).flex_none().items_center().pl(8).pr(10).rounded(8).cursor_pointer()
    .when(selected, (e) => e.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((_e, cx) => ctx.pickSub(node.address, cx))
    .children(treeLines(row.lines, t, ROW_H))
    .child(div().mr(9).when(ended, (e) => e.opacity(0.55)).child(programIcon(node.program, row.head ? 22 : 20, t)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().min_w(0).truncate().text_size(12.5).font_weight(selected || row.head ? 600 : 500).text_color(ended ? t.dim : selected ? t.foreground : t.muted).child(node.title))
        .child(div().flex_none().text_size(10.5).font_family(t.mono).text_color(alpha(t.dim, 0.8)).child(node.address)))
      .child(div().truncate().text_size(11).when(Boolean(node.isAgent ? d?.calls.length : true), (e) => e.font_family(t.mono)).text_color(working ? alpha(t.working, 0.9) : t.dim).child(stepLine(node, session, d, rel))))
    .child(v_flex().flex_none().items_end().gap(3).ml(8)
      .child(subGlyph(node, t))
      .child(div().text_size(10).text_color(t.dim).child(d?.calls.length ? `호출 ${fmtInt(d.calls.length)}` : elapsed(node, now))));
}

function treePane(rows, picked, ctx, t) {
  const now = Date.now();
  const live = rows.filter((r) => !r.head && r.node.state === "live").length;
  const total = rows.filter((r) => !r.head).length;
  return v_flex().size_full().min_h(0)
    .child(h_flex().flex_none().h(40).px(14).gap(8).items_center()
      .child(icon("workflow", 13, t.dim))
      .child(div().text_size(12).font_semibold().text_color(t.muted).child(`하위 에이전트 ${total}`))
      .child(div().text_size(11.5).text_color(t.dim).child(`실행 중 ${live} · 끝남 ${total - live}`)))
    .child(scrollArea("subs-tree", v_flex().px(6).pb(10).gap(2).children(rows.map((r) => treeRow(r, r.node.address === picked, ctx, t, now)))));
}

// ---------- detail ----------

function crumbs(node, ctx, t) {
  const chain = ancestors(ctx.roster, node.address).reverse().map((a) => ctx.roster.nodes[a]);
  return h_flex().gap(4).items_center().flex_wrap().text_size(11.5)
    .children(chain.flatMap((n) => [
      h_flex().id(`crumb-${n.address}`).gap(5).items_center().px(5).h(20).rounded(5).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => (n.sub ? ctx.pickSub(n.address, cx) : ctx.pickScope(n.address, cx)))
        .child(programIcon(n.program, 13, t)).child(div().max_w(180).truncate().child(n.title)),
      icon("chevron-right", 11, t.dim),
    ]))
    .child(div().px(5).text_color(t.foreground).font_semibold().child(node.title));
}

function headCard(node, session, ctx, t) {
  const term = ctx.terms?.[node.address];
  const cwd = term?.foreground?.cwd ?? term?.cwd ?? session?.cwd;
  const now = Date.now();
  const time = node.state === "ended"
    ? `${elapsed(node, now)} 동안 실행 · ${relTime(node.finished)} 끝남${node.exit ? ` · 종료 코드 ${node.exit}` : node.reason === "killed" ? " · 중지됨" : ""}`
    : `${elapsed(node, now)} 전 시작`;
  const meta = [node.program?.name, session?.model, cwd ? tildePath(cwd, ctx.home) : null, time].filter(Boolean);
  const canRead = node.isAgent && session && !session.note;
  return v_flex().gap(10)
    .child(crumbs(node, ctx, t))
    .child(h_flex().gap(12).items_center()
      .child(programIcon(node.program, 30, t))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(8).items_center().min_w(0)
          .child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(node.title))
          .child(chip(node.address, t, t.dim))
          .when(Boolean(session?.inferred), (e) => e.child(chip("추정 연결", t, t.dim).tooltip("시작 시각과 맡긴 일로 이 하위 에이전트의 기록을 골랐어요."))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(meta.join(" · "))))
      .child(pill(STATUS_LABEL[node.status] ?? node.status, statusColor(node.status, t), t))
      .when(Boolean(canRead), (e) => e.child(button("sub-open", "자세히 보기", (_e, cx) => ctx.pickScope(node.address, cx), t, { iconName: "arrow-right", tip: "이 하위 에이전트의 도구 호출·프롬프트·변경을 렌즈로 봐요" })))
      .when(node.state === "live", (e) => e.child(button("sub-peek", "엿보기", () => ctx.peek(node.address), t, { iconName: "eye", tip: "터미널을 탭 위에 잠깐 띄워요" }))));
}

const textBox = (title, body, t) =>
  v_flex().w_full().gap(6).p(12).rounded(9).border(1).border_color(t.border)
    .child(div().text_size(11).text_color(t.dim).child(title))
    .child(body);

function statsRow(session, d, t) {
  const u = d.usage;
  const dur = Object.values(session.turnDur ?? {}).reduce((a, b) => a + (b || 0), 0);
  const cell = (label, value) => v_flex().flex_1().min_w(90).gap(2).px(12).py(9).rounded(9).bg(t.raised)
    .child(div().text_size(10.5).text_color(t.dim).child(label)).child(div().text_size(14).font_semibold().text_color(t.foreground).child(value));
  return h_flex().w_full().gap(8).flex_wrap()
    .child(cell("도구 호출", fmtInt(d.calls.length)))
    .child(cell("바뀐 파일", fmtInt(d.files.length)))
    .child(cell("토큰", fmtK(u.in + u.out + u.cr + u.cw)))
    .child(cell("일한 시간", dur ? fmtDur(dur / 1000) : "—"));
}

function steps(node, session, d, ctx, t) {
  const term = ctx.terms?.[node.address];
  const rel = (p) => relPath(p, term?.foreground?.cwd ?? term?.cwd ?? session.cwd, ctx.home);
  const calls = d.calls.slice(-STEP_LIMIT).reverse();
  const rows = [];
  let turn = -1;
  for (const call of calls) {
    if (call.turn !== turn) {
      turn = call.turn;
      const p = session.prompts[turn - 1];
      const label = p ? firstLine(p.display ?? p.text) : "프롬프트 전";
      rows.push(h_flex().w_full().h(26).flex_none().mt(rows.length ? 8 : 0).gap(7).items_center().px(8).rounded(6).bg(alpha(t.accent, 0.07))
        .child(div().flex_none().text_size(10.5).font_bold().text_color(t.accent).child(`#${turn}`))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(label))
        .when(Boolean(p?.ts), (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(relTime(p.ts)))));
    }
    rows.push(div().id(`step-${node.address}-${call.id}`).w_full().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => ctx.openCall(node.address, call.id, cx))
      .child(callRow({ call, agent: node, status: callStatus(call, session, node.status === "ended" ? "idle" : node.status) }, false, t, rel)));
  }
  const hidden = d.calls.length - calls.length;
  return v_flex().w_full()
    .child(sectionTitle(`단계 ${fmtInt(d.calls.length)}`, t, div().text_size(11).text_color(t.dim).child("최신이 위 · 누르면 그 호출을 열어요")))
    .child(v_flex().w_full().gap(1).children(rows))
    .when(hidden > 0, (e) => e.child(h_flex().id("steps-more").mt(8).h(30).justify_center().items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted).bg(t.raised).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => ctx.pickScope(node.address, cx, "calls")).child(`이전 단계 ${fmtInt(hidden)}개는 '자세히 보기'에서`)));
}

function detail(node, ctx, t) {
  const session = ctx.store.get(node.address);
  const d = ctx.store.derived(session);
  const col = v_flex().p(18).gap(14)
    .child(ctx.compact ? button("sub-back", "목록", ctx.onBack, t, { iconName: "arrow-left", quiet: true }) : div())
    .child(headCard(node, session, ctx, t));
  if (!node.isAgent) {
    return scrollArea("sub-detail", col
      .child(textBox("실행한 명령", div().font_family(t.mono).text_size(12).text_color(t.foreground).whitespace_normal().child(clip(node.command, 1200)), t))
      .child(div().text_size(12).text_color(t.dim).child("에이전트가 아닌 프로그램이라 단계 기록은 없어요. 화면은 '엿보기'로 볼 수 있어요.")));
  }
  const firstPrompt = session?.prompts.find(isHumanPrompt) ?? session?.prompts[0];
  const task = node.task ?? firstPrompt?.text ?? null;
  const reply = session?.replies?.[session.replies.length - 1];
  const withTask = col.when(Boolean(task), (e) => e.child(textBox("맡긴 일", div().text_size(12.5).text_color(t.foreground).whitespace_normal().child(clip(task ?? "", 1500)), t)));
  if (!session || (!session.loaded && !session.calls.length)) return scrollArea("sub-detail", withTask.child(div().text_size(12).text_color(t.dim).child("기록을 읽는 중이에요…")));
  if (session.note || session.error) return scrollArea("sub-detail", withTask.child(div().text_size(12).text_color(t.dim).child(NOTES[session.note] ?? `기록을 읽지 못했어요: ${session.error}`)));
  return scrollArea("sub-detail", withTask
    .when(Boolean(reply) && node.status !== "working", (e) => e.child(textBox(`마지막 답변 · ${relTime(reply.ts)}`, div().text_size(12.5).max_h(220).overflow_hidden().child(TextView.markdown(`sub-reply-${node.address}-${reply.n}`, clip(reply.text, 1500))), t)))
    .child(statsRow(session, d, t))
    .child(d.calls.length ? steps(node, session, d, ctx, t) : div().text_size(12).text_color(t.dim).child("아직 도구를 쓰지 않았어요.")));
}

/** ctx: {roster, scope, store, terms, home, sel, compact, detailOpen, pickSub, pickScope, openCall, peek, onBack} */
export function subsLens(ctx, t) {
  const rows = subRows(ctx.roster, ctx.scope);
  const subs = rows.filter((r) => !r.head);
  if (!subs.length) {
    return empty("하위 에이전트가 없어요", "에이전트가 hc run으로 다른 에이전트나 프로그램을 띄우면, 누가 누구를 띄웠는지와 각자의 단계가 여기 나타나요.", t, "workflow");
  }
  const picked = rows.find((r) => r.node.address === ctx.sel.sub)?.node ?? (subs.find((r) => r.node.status === "working") ?? subs.find((r) => r.node.isAgent && r.node.state === "live") ?? subs.find((r) => r.node.isAgent) ?? subs[0]).node;
  const tree = treePane(rows, picked.address, ctx, t);
  const body = detail(picked, ctx, t);
  if (ctx.compact) return ctx.detailOpen ? v_flex().size_full().min_h(0).child(body) : tree;
  return h_resizable("subs-split").size_full()
    .child(resizable_panel().size(360).size_range(260, 620).child(div().size_full().border_r(1).border_color(t.border).child(tree)))
    .child(resizable_panel().child(v_flex().size_full().min_w(0).child(body)));
}

/** The overview's block: this agent's sub-agents at a glance. */
export function subsCard(ctx, t) {
  const rows = descendants(ctx.roster, ctx.scope);
  if (!rows.length) return null;
  const now = Date.now();
  const shown = rows.slice(0, 8);
  return v_flex().w_full()
    .child(sectionTitle(`하위 에이전트 ${rows.length}`, t))
    .child(card(t).p(6).gap(2).children(shown.map((r) => treeRow(r, false, { ...ctx, pickSub: (address, cx) => ctx.openSub(address, cx) }, t, now)))
      .when(rows.length > shown.length, (e) => e.child(h_flex().id("subs-all").h(30).justify_center().items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => ctx.pickLens("subs", cx)).child(`${rows.length - shown.length}개 더 보기`))));
}
