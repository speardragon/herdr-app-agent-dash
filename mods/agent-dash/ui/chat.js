// 전체 대화: everything said with one agent, in order, like a chat app: a line for each new day,
// the time beside each bubble, your messages on the right and the agent's on the left.
// The app draws every row it is given, so a window of turns is shown and the rest is a button away.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { button, icon, programIcon, scrollArea } from "./kit.js";
import { turnDetail } from "../lib/session.js";
import { budget } from "./stage/rich.js";
import { clock12, dayFull, dayOf, fmtInt } from "../lib/format.js";
import { BUBBLE_MAX, CHAT, agentAvatar, aiText, meAvatar, mineText, promptImages, thinking } from "./prompts.js";

const PAGE = 8;
const TIME_W = 56;
const TIME = "#8E8E93";
const MINE_LINES = 40;

const stamp = (ts, extra = null) => v_flex().w(TIME_W).flex_none().pb(2).text_size(10.5).text_color(TIME)
  .when(Boolean(extra), (e) => e.child(div().child(extra ?? "")))
  .child(div().child(clock12(ts)));

const dayLine = (ts) => h_flex().w_full().py(6).justify_center()
  .child(h_flex().h(24).px(12).gap(6).items_center().rounded(12).bg("#1C1C1E")
    .child(div().text_size(11.5).font_medium().text_color("#C7C7CC").child(dayFull(ts))));

// A notice or a tool answer put there on your behalf: a quiet line in the middle, as a chat's own messages are.
const noticeLine = (prompt) => h_flex().w_full().justify_center()
  .child(div().max_w(520).truncate().px(10).h(22).rounded(11).bg("#141416").text_size(11).text_color(TIME).flex().items_center()
    .child(`${clock12(prompt.ts)} · ${String(prompt.display || prompt.text || "").split("\n")[0].slice(0, 90)}`));

function mineRow(item, ctx, t) {
  const { prompt } = item;
  const text = prompt.kind === "prompt" || prompt.kind === "command" ? prompt.text : prompt.display || prompt.text;
  return h_flex().id(`chat-p-${prompt.n}`).w_full().gap(8).items_start().justify_end()
    .child(h_flex().flex_1().min_w(0).gap(6).items_end().justify_end()
      .child(stamp(prompt.ts, `#${prompt.n}`).items_end())
      .child(v_flex().min_w(0).gap(8).items_end()
        .when(prompt.images > 0, (e) => e.child(promptImages(item, ctx, t)))
        .when(Boolean(String(text ?? "").trim()) || !prompt.images, (e) => e.child(div().min_w(0).max_w(BUBBLE_MAX).px(14).py(10).rounded(16).bg(CHAT.mine).child(mineText(text, MINE_LINES))))))
    .child(meAvatar(ctx));
}

function theirsRow(item, turn, working, ctx, t) {
  const bubble = (child) => div().w_full().max_w(BUBBLE_MAX).px(14).py(10).rounded(16).bg(CHAT.theirs).text_color(CHAT.theirsText).child(child);
  // The time goes on the last bubble of a minute, as a chat groups messages sent together.
  const minute = (ts) => Math.floor((ts ?? 0) / 60000);
  const line = (body, ts, shown) => h_flex().w_full().gap(6).items_end().child(v_flex().flex_1().min_w(0).max_w(BUBBLE_MAX).gap(4).child(body))
    .child(shown && ts ? stamp(ts) : div().w(TIME_W).flex_none());
  const key = `${item.key}`;
  return h_flex().w_full().gap(8).items_start()
    .child(agentAvatar(item.agent, t))
    .child(v_flex().flex_1().min_w(0).gap(6)
      .children(turn.replies.map((r, i) => {
        const next = turn.replies[i + 1];
        const body = v_flex().w_full().gap(4)
          .when(r.thoughts.length > 0, (e) => e.child(thinking(`${key}-${r.n}`, r.thoughts, ctx, t)))
          .child(bubble(aiText(`r-${key}-${r.n}`, r.text, ctx, t, undefined, budget(1200, 80))));
        return line(body, r.ts, !next || minute(next.ts) !== minute(r.ts));
      }))
      .when(turn.trailing.length > 0, (e) => e.child(line(thinking(`${key}-end`, turn.trailing, ctx, t), null, false)))
      .when(working, (e) => e.child(line(bubble(div().text_size(13).text_color(CHAT.name).child("아직 답하는 중이에요…")), null, false))));
}

const moreButton = (id, label, on, t) => h_flex().w_full().py(4).justify_center().child(button(id, label, on, t, { iconName: "message" }));

export function chatView(chat, ctx, t) {
  const session = ctx.store.get(chat.address);
  const agent = ctx.agents[chat.address];
  const total = session.prompts.length;
  const from = Math.max(1, Math.min(chat.from ?? 1, total));
  const to = chat.to == null ? total : Math.min(chat.to, total);
  const jump = ctx.takeChatJump();
  const rows = [];
  let jumpAt = null;
  let day = null;
  if (from > 1) rows.push(moreButton("chat-older", `이전 대화 ${fmtInt(from - 1)}개 중 ${Math.min(PAGE, from - 1)}개 더 보기`, (_e, cx) => ctx.setUi("chat", { ...chat, from: Math.max(1, from - PAGE), to: chat.to }, cx), t));
  for (let n = from; n <= to; n++) {
    const prompt = session.prompts[n - 1];
    const item = { key: `${chat.address}|${n}`, prompt, agent, address: chat.address, session };
    if (prompt.ts && dayOf(prompt.ts) !== day) {
      day = dayOf(prompt.ts);
      rows.push(dayLine(prompt.ts));
    }
    if (prompt.kind === "notice" || prompt.kind === "answer") rows.push(noticeLine(prompt));
    else rows.push(mineRow(item, ctx, t));
    const turn = turnDetail(session, n);
    const working = agent.status === "working" && n === total;
    if (turn.replies.length || turn.trailing.length || working) rows.push(theirsRow(item, turn, working, ctx, t));
    if (n === jump) jumpAt = rows.length - 1;
  }
  if (to < total) rows.push(moreButton("chat-newer", `다음 대화 ${fmtInt(total - to)}개 중 ${Math.min(PAGE, total - to)}개 더 보기`, (_e, cx) => ctx.setUi("chat", { ...chat, to: to + PAGE >= total ? null : to + PAGE }, cx), t));
  // Asked to show a turn: bring its last row on screen (once, after layout).
  if (jump != null) ctx.chatScroll.scroll_to_item(jump === "first" ? 0 : jumpAt ?? rows.length - 1);
  // The jump buttons, floating at the bottom right. Where the view is scrolled isn't known here,
  // only which way it last moved: going up offers the first message (and the way back down),
  // going down offers the last one. A window that stops short of the end always offers the last.
  const dir = ctx.ui("chat:dir", null);
  const long = rows.length > 4 || from > 1 || to < total;
  const showFirst = long && dir === "up";
  const showLast = long && (dir !== null || to < total);
  const fab = (id, label, iconName, where) => h_flex().id(id).h(32).pl(10).pr(13).gap(6).items_center().rounded(16).bg("#2C2C2E").border(1).border_color("#48484A").cursor_pointer()
    .hover((s) => s.bg("#3A3A3C")).on_click((_e, cx) => ctx.jumpChat(where, cx))
    .child(icon(iconName, 13, "#F5F5F7")).child(div().text_size(12).font_medium().text_color("#F5F5F7").child(label));
  const head = h_flex().w_full().flex_none().h(44).px(14).gap(10).items_center().border_b(1).border_color(t.border)
    .child(button("chat-back", "프롬프트 목록", (_e, cx) => ctx.setUi("chat", null, cx), t, { iconName: "arrow-left", quiet: true }))
    .child(programIcon(agent.program, 16, t))
    .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(agent.title ?? agent.tab ?? "에이전트"))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`대화 ${fmtInt(total)}개 중 ${from}~${to}번째`));
  return v_flex().size_full().min_h(0).bg(CHAT.ground)
    .child(div().w_full().flex_none().bg(t.background).child(head))
    .child(v_flex().flex_1().min_h(0).relative()
      .on_scroll_wheel((e, cx) => {
        const y = e?.delta?.y ?? 0;
        if (Math.abs(y) > 2) ctx.onChatWheel(y > 0 ? "up" : "down", cx);
      })
      .child(scrollArea("chat-all", v_flex().px(16).py(14).gap(12).track_scroll(ctx.chatScroll).children(rows)))
      .when(showFirst || showLast, (e) => e.child(v_flex().absolute().right(22).bottom(18).gap(8).items_end()
        .when(showFirst, (x) => x.child(fab("chat-first", "첫 대화", "chevron-up", "first")))
        .when(showLast, (x) => x.child(fab("chat-last", "마지막 대화", "chevron-down", "last"))))));
}
