// 프롬프트: what you asked, newest first; for each one, what followed (calls, time, files)
// and the answer it ended with.

import { div, image } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, TextView, h_resizable, resizable_panel } from "gpui-base";
import { alpha, button, card, chip, empty, icon, programIcon, scrollArea, sectionTitle, stackBar } from "./kit.js";
import { turnDetail } from "../lib/session.js";
import { blocks } from "../lib/rich.js";
import { budget, richBody } from "./stage/rich.js";
import { KINDS, countKinds } from "../lib/tools.js";
import { chatView } from "./chat.js";
import { clampLines, firstLine, fmtDur, fmtInt, inkOn, relTime, when } from "../lib/format.js";
import { relPath } from "../lib/paths.js";

const ROW_H = 74; // two lines of the prompt, then its time and counts
const ROW_EXTRA = 112; // what in a row is not the prompt text: padding, number column, gaps, kind chip
const KIND_LABEL = { notice: "알림", answer: "답변", paste: "붙여넣음", shell: "셸", command: "명령" };

function promptRow(item, selected, t, listWidth) {
  const { prompt, turn, agent } = item;
  const label = (prompt.display ?? prompt.text) || (prompt.images ? `이미지 ${prompt.images}개` : "");
  // Two lines at most, cut with … (drawn one row each, so a wrong estimate still ends in …).
  const lines = clampLines(label, Math.max(90, listWidth - ROW_EXTRA), 12.5, 2);
  const quiet = prompt.kind === "notice" || prompt.kind === "answer";
  return h_flex().id(item.key ?? `prompt-${prompt.n}`).w_full().h(ROW_H).flex_none().gap(10).items_center().px(16)
    .when(selected, (e) => e.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .child(v_flex().w(34).flex_none().items_center().gap(4)
      .child(div().px(5).h(16).rounded(4).bg(selected ? alpha(t.accent, 0.16) : t.raised).text_size(10.5).font_semibold().text_color(selected ? t.accent : t.muted).flex().items_center().child(`#${prompt.n}`))
      .when(Boolean(item.showAgent), (e) => e.child(programIcon(agent.program, 14, t))))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(h_flex().gap(6).items_start().min_w(0)
        .when(Boolean(KIND_LABEL[prompt.kind]), (e) => e.child(div().flex_none().mt(1).px(5).h(16).rounded(4).bg(t.raised).text_size(10).text_color(t.dim).flex().items_center().child(KIND_LABEL[prompt.kind] ?? "")))
        .child(v_flex().flex_1().min_w(0).children(lines.map((line) => div().w_full().truncate().text_size(12.5).line_height(1.3).font_weight(quiet ? 400 : 600).when(prompt.kind === "command" || prompt.kind === "shell", (e) => e.font_family(t.mono)).text_color(quiet ? t.dim : selected ? t.foreground : t.muted).child(line)))))
      .child(h_flex().gap(8).text_size(11).text_color(t.dim)
        .child(div().child(when(prompt.ts)))
        .when(turn.calls > 0, (e) => e.child(div().child(`호출 ${fmtInt(turn.calls)}`)))
        .when(Boolean(turn.dur), (e) => e.child(div().child(fmtDur(turn.dur / 1000))))
        .when(prompt.images > 0, (e) => e.child(div().child(`이미지 ${prompt.images}`)))));
}

function itemsFor(ctx) {
  const scopes = ctx.scope === "all" ? Object.keys(ctx.agents) : [ctx.scope];
  const items = [];
  for (const address of scopes) {
    const session = ctx.store.get(address);
    const d = ctx.store.derived(session);
    if (!d) continue;
    for (const turn of d.turns) items.push({ key: `${address}|${turn.prompt.n}`, prompt: turn.prompt, turn, agent: ctx.agents[address], address, session, showAgent: ctx.scope === "all" });
  }
  return items.sort((a, b) => (b.prompt.ts ?? 0) - (a.prompt.ts ?? 0)).slice(0, 600);
}

function kindBar(calls, t) {
  const counts = countKinds(calls);
  const parts = Object.keys(KINDS).map((k) => ({ value: counts[k] ?? 0, color: t.kind[k], label: KINDS[k].label }));
  return v_flex().gap(6).child(stackBar(parts, t, 6))
    .child(h_flex().gap(10).flex_wrap().children(parts.filter((p) => p.value).map((p) => h_flex().gap(4).items_center()
      .child(div().size(7).rounded(2).bg(p.color)).child(div().text_size(10.5).text_color(t.dim).child(`${p.label} ${p.value}`)))));
}

const md = (id, text, t, size = 13) => div().w_full().text_size(size).text_color(t.foreground)
  .child(TextView.markdown(id, text ?? "").selectable(true).on_link_click((url, cx) => cx.open_url(url)));

// The pictures attached to a prompt (read out of the transcript on demand, a few hundred KB each),
// laid out as a masonry: each picture goes under the shortest column so far, at its own proportions.
const GRID_W = 560;
const GRID_GAP = 8;

function tile(slot, w, maxH, t) {
  if (slot.state === "loading") return div().w(w).h(Math.round(w * 0.7)).rounded(8).bg(t.raised).flex().items_center().justify_center().child(icon("spinner", 14, t.dim).spin(900));
  if (!slot.value) return div().w(w).h(70).px(10).rounded(8).bg(t.raised).flex().items_center().justify_center().text_size(11.5).text_color(t.dim).text_center().child(slot.state === "error" ? "이미지를 열지 못했어요" : "기록에서 찾을 수 없어요");
  const { path, w: iw, h: ih } = slot.value;
  // A size worked out from the picture's own: never a box it is squeezed into (an image given
  // both a max width and a max height is stretched).
  const scale = iw > 0 && ih > 0 ? Math.min(1, w / iw, maxH / ih) : 0;
  const frame = div().rounded(8).border(1).border_color(t.border).overflow_hidden();
  return scale > 0 ? frame.child(image(path).w(Math.round(iw * scale)).h(Math.round(ih * scale))) : frame.child(image(path).max_w(w).max_h(maxH));
}

export function promptImages(item, ctx, t) {
  const { prompt, session } = item;
  if (prompt.at == null || !session.file || !ctx.request) return h_flex().gap(6).child(chip(`이미지 ${prompt.images}개 첨부`, t, t.ansi6));
  const n = Math.min(prompt.images, 8);
  const slots = Array.from({ length: n }, (_x, i) => ctx.request(`pimg:${session.file}|${prompt.at}|${i}`, (reader) => reader.promptImage({ file: session.file, at: prompt.at, index: i })));
  // One picture is shown larger; several share up to three columns.
  const cols = Math.min(n, 3);
  const colW = n === 1 ? 400 : Math.floor((GRID_W - GRID_GAP * (cols - 1)) / cols);
  const maxH = n === 1 ? 280 : 320;
  const heights = Array(cols).fill(0);
  const columns = Array.from({ length: cols }, () => []);
  slots.forEach((slot) => {
    // Pictures that are still loading are placed round-robin; the layout settles once all are in.
    const ready = slots.every((s) => s.state !== "loading");
    const iw = slot.value?.w, ih = slot.value?.h;
    const height = ready && iw > 0 && ih > 0 ? Math.round(Math.min(ih, ih * colW / iw, maxH)) : Math.round(colW * 0.7);
    const at = ready ? heights.indexOf(Math.min(...heights)) : columns.reduce((best, c, i) => (c.length < columns[best].length ? i : best), 0);
    columns[at].push(tile(slot, colW, maxH, t));
    heights[at] += height + GRID_GAP;
  });
  return v_flex().w_full().gap(8)
    .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim).child(icon("image", 12, t.dim)).child(`첨부한 이미지 ${prompt.images}개`))
    .child(h_flex().gap(GRID_GAP).items_start().children(columns.map((col) => v_flex().w(colW).flex_none().gap(GRID_GAP).children(col))));
}

// The conversation is drawn like a chat in KakaoTalk's high-contrast look: a black ground, your
// message in the yellow bubble on the right, the agent's in a dark one on the left. Bubbles run
// nearly the full width (only the far side is kept clear), so long text stays readable.
export const CHAT = { ground: "#000000", mine: "#FEE500", mineText: "#000000", theirs: "#1C1C1E", theirsText: "#F5F5F7", name: "#B0B0B5" };
export const AVATAR = 36;
export const FAR_GAP = 44;
export const BUBBLE_MAX = 720; // a bubble never runs wider than this, however wide the window is
const MINE_LINES = 220;

// The agent's text in its dark bubble. Inline code is drawn Notion-style: its own colored text on
// a faint chip. The coral (#FFA198) reads at about 8.6:1 on the bubble (7:1 on the chip).
const CHAT_SKIN = (t) => ({
  bg: CHAT.theirs, text: CHAT.theirsText, dim: CHAT.name, subtle: CHAT.name, link: "#8AB4F8", border: "#3A3A3C", headBg: "#2C2C2E", hover: "#2C2C2E",
  codeBg: "#2E2E2D", codeFg: "#FFA198", preBg: "#0E0E10", preBorder: "#3A3A3C", preFg: "#F5F5F7", quoteBar: "#6E6E73", size: 14, h: [20, 17, 15], hWeight: 600, bold: 600,
  mono: t.mono, tableRadius: 6, buttonRadius: 6, mentionBg: "#2C2C2E", mentionFg: "#8AB4F8", callout: { default: "#2C2C2E" },
});

// Parsed off the render pass (a long answer's Markdown takes longer than a frame may); plain text meanwhile.
export function aiText(id, text, ctx, t, skin = CHAT_SKIN(t), room = budget(4000, 260)) {
  const parsed = ctx.request ? ctx.request(`chat:${id}:${String(text ?? "").length}`, async () => blocks(text ?? "", 260)) : null;
  if (!parsed || parsed.state !== "ready") return div().w_full().text_size(skin.size).font_medium().line_height(1.6).text_color(skin.text).child(String(text ?? "").slice(0, 3000));
  const open = { ...ctx, openUrl: (url, cx) => cx.open_url(url) };
  return div().w_full().font_medium().child(richBody(parsed.value, id, skin, open, room, 8));
}

// What the agent thought before an answer: a "생각함 · 5초" line above the bubble that opens into
// the thoughts, dimmer than an answer and set off by a bar on the left. Closed until asked for.
const THINK = { label: "#A8A8AE", text: "#B4B4BA", bar: "#48484A" };
const THINK_SKIN = (t) => ({ ...CHAT_SKIN(t), bg: CHAT.ground, text: THINK.text, size: 13, codeFg: "#E8A9A2" });

export function thinking(id, thoughts, ctx, t) {
  if (!thoughts.length) return null;
  const key = `think:${id}`;
  const open = Boolean(ctx.ui(key, false));
  const ms = thoughts.reduce((sum, x) => sum + (x.dur ?? 0), 0);
  const head = h_flex().id(`th-${id}`).flex_none().gap(6).items_center().pl(2).py(2).rounded(6).cursor_pointer()
    .on_click((_e, cx) => ctx.setUi(key, !open, cx))
    .child(icon("message", 13, THINK.label))
    .child(div().text_size(12.5).font_medium().text_color(THINK.label).child("생각함"))
    .when(ms >= 500, (e) => e.child(div().text_size(12.5).text_color("#8E8E93").child(`· ${fmtDur(ms / 1000)}`)))
    .child(icon(open ? "chevron-up" : "chevron-down", 12, THINK.label));
  if (!open) return h_flex().w_full().child(head);
  return v_flex().w_full().max_w(BUBBLE_MAX).gap(6).child(h_flex().w_full().child(head))
    .child(h_flex().w_full().items_stretch().gap(10).pl(3)
      .child(div().w(2).flex_none().rounded(1).bg(THINK.bar))
      .child(v_flex().flex_1().min_w(0).gap(8).py(2)
        .children(thoughts.map((x) => aiText(`${id}-${x.n}`, x.text, ctx, t, THINK_SKIN(t))))));
}

export function meAvatar(ctx) {
  const pic = ctx.request ? ctx.request("me-avatar", (reader) => reader.meAvatar()) : null;
  // "나" on blue is always underneath; the picture covers it once it has loaded.
  const round = div().relative().size(AVATAR).flex_none().rounded(14).overflow_hidden().bg("#5B8DEF")
    .flex().items_center().justify_center().text_size(13).font_bold().text_color(inkOn("#5B8DEF")).child("나");
  return pic?.state === "ready" && pic.value ? round.child(div().absolute().inset_0().child(image(pic.value).size(AVATAR))) : round;
}

export const agentAvatar = (agent, t) => div().size(AVATAR).flex_none().rounded(14).bg(t.raised).flex().items_center().justify_center().child(programIcon(agent.program, 22, t));

// Your words as you typed them (not Markdown: black on yellow has to stay black).
export function mineText(text, most = MINE_LINES) {
  const lines = String(text ?? "").split("\n");
  const shown = lines.slice(0, most);
  return v_flex().min_w(0).text_size(13.5).font_medium().line_height(1.55).text_color(CHAT.mineText)
    .children(shown.map((line) => (line.trim() ? div().child(line) : div().h(8))))
    .when(lines.length > shown.length, (e) => e.child(div().pt(4).text_size(12).child(`… ${fmtInt(lines.length - shown.length)}줄 더 (복사로 전체를 가져갈 수 있어요)`)));
}

function detail(item, ctx, t) {
  const { prompt, session, address } = item;
  const turn = turnDetail(session, prompt.n);
  const dur = session.turnDur[prompt.n] ? session.turnDur[prompt.n] / 1000 : turn.end && prompt.ts ? (turn.end - prompt.ts) / 1000 : null;
  const cwd = ctx.terms?.[address]?.foreground?.cwd ?? session.cwd;
  const stat = (label, value) => v_flex().flex_1().min_w(110).px(12).py(9).rounded(9).bg(t.raised)
    .child(div().text_size(11).text_color(t.dim).child(label)).child(div().text_size(15).font_semibold().text_color(t.foreground).child(value));
  // No names: the avatar sits level with the top of its bubble.
  const theirs = (child) => h_flex().w_full().gap(8).items_start()
    .child(agentAvatar(item.agent, t))
    .child(v_flex().flex_1().min_w(0).gap(8).child(child))
    .child(div().w(FAR_GAP).flex_none());
  const bubble = (child) => div().w_full().max_w(BUBBLE_MAX).px(14).py(11).rounded(16).bg(CHAT.theirs).text_color(CHAT.theirsText).child(child);
  return v_flex().w_full().gap(16)
    .child(h_flex().gap(10).items_center()
      .child(div().px(7).h(22).rounded(6).bg(alpha(t.accent, 0.16)).text_size(12).font_semibold().text_color(t.accent).flex().items_center().child(`#${prompt.n}`))
      .child(div().flex_1().text_size(12).text_color(t.dim).child(`${when(prompt.ts)} · ${relTime(prompt.ts)}`))
      .child(button("prompt-chat", "전체 대화", (_e, cx) => ctx.openChat(address, prompt.n, cx), t, { iconName: "message", tip: "이 에이전트와 나눈 대화를 처음부터 이어서 봐요" }))
      .child(button("prompt-copy", "복사", (_e, cx) => ctx.stageCtx(address, session, item.agent, null).copy(prompt.text, cx), t, { iconName: "copy" }))
      .when(turn.calls.length > 0, (e) => e.child(button("prompt-calls", `이 턴의 호출 ${turn.calls.length}개`, (_e, cx) => ctx.openCall(address, turn.calls[0].id, cx), t, { iconName: "terminal", primary: true }))))
    // 이 프롬프트가 한 일: first, before the conversation.
    .child(v_flex().w_full().gap(10)
      .child(sectionTitle("이 프롬프트가 한 일", t))
      .child(h_flex().w_full().gap(10).flex_wrap()
        .child(stat("호출", fmtInt(turn.calls.length)))
        .child(stat("걸린 시간", dur ? fmtDur(dur) : "—"))
        .child(stat("바뀐 파일", fmtInt(turn.files.length)))
        .child(stat("답변", fmtInt(turn.replies.length))))
      .when(turn.calls.length > 0, (e) => e.child(kindBar(turn.calls, t)))
      .when(turn.files.length > 0, (e) => e.child(v_flex().w_full().children(turn.files.map((f) =>
        h_flex().id(`tf-${f.path}`).w_full().gap(10).items_center().px(10).py(6).rounded(8).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => ctx.openFile(f.path, cx))
          .child(icon("file-text", 12, t.muted))
          .child(div().flex_1().min_w(0).truncate().font_family(t.mono).text_size(12).text_color(t.foreground).child(relPath(f.path, cwd, ctx.home)))
          .child(div().font_family(t.mono).text_size(11).text_color(t.add).child(`+${f.add}`))
          .child(div().font_family(t.mono).text_size(11).text_color(t.del).child(`−${f.del}`)))))))
    // The conversation.
    .child(v_flex().w_full().p(14).gap(14).rounded(14).bg(CHAT.ground)
      // The window's traffic lights, as on a real app.
      .child(h_flex().gap(7).items_center().pb(2)
        .children(["#FF5F57", "#FEBC2E", "#28C840"].map((color) => div().size(12).flex_none().rounded(6).bg(color))))
      // Mine: on the right, with my picture.
      .child(h_flex().w_full().gap(8).items_start().justify_end()
        .child(div().w(FAR_GAP).flex_none())
        .child(v_flex().min_w(0).gap(8).items_end()
          .when(prompt.images > 0, (e) => e.child(promptImages(item, ctx, t)))
          .child(div().min_w(0).max_w(BUBBLE_MAX).px(14).py(11).rounded(16).bg(CHAT.mine).child(mineText(prompt.kind === "prompt" || prompt.kind === "command" ? prompt.text : prompt.display || prompt.text))))
        .child(meAvatar(ctx)))
      // Every answer of the turn, in order (an agent that thinks between steps answers several
      // times): one bubble each, under one avatar.
      .child(theirs(v_flex().w_full().gap(8)
        .children(turn.replies.map((r) => v_flex().w_full().gap(3)
          .when(r.thoughts.length > 0, (e) => e.child(thinking(`${item.key}-${r.n}`, r.thoughts, ctx, t)))
          .child(bubble(aiText(`r-${item.key}-${r.n}`, r.text, ctx, t)))
          .when(Boolean(r.ts), (e) => e.child(div().pl(6).text_size(11).text_color("#8E8E93").child(when(r.ts))))))
        .when(turn.trailing.length > 0, (e) => e.child(thinking(`${item.key}-end`, turn.trailing, ctx, t)))
        .when(item.agent.status === "working" && session.prompts.length === prompt.n, (e) => e.child(bubble(div().text_size(13).text_color(CHAT.name).child("아직 답하는 중이에요…"))))
        .when(!turn.replies.length && !(item.agent.status === "working" && session.prompts.length === prompt.n), (e) => e.child(bubble(div().text_size(13).text_color(CHAT.name).child("답변이 없어요")))))));
}

export function promptsLens(ctx, t) {
  const items = itemsFor(ctx);
  if (!items.length) return empty("프롬프트가 없어요", null, t, "message");
  const chat = ctx.ui("chat", null);
  if (chat && ctx.store.get(chat.address) && ctx.agents[chat.address]) return chatView(chat, ctx, t);
  const selected = items.find((it) => it.key === ctx.sel.prompt) ?? items.find((it) => it.key === `${ctx.scope}|${ctx.sel.prompt}`) ?? items[0];
  const listWidth = ctx.ui("w:prompts", 400);
  const list = div().size_full().min_h(0).relative().pt(6)
    // The list's width sets how many characters a prompt line gets.
    .on_size_change((size, cx) => {
      const w = Math.round(size.width);
      if (Math.abs(listWidth - w) > 6) ctx.setUi("w:prompts", w, cx);
    })
    .child(v_virtual_list("prompt-list", items.length, ROW_H, (i) => items[i].key, (range) =>
      items.slice(range.start, range.end).map((it) => promptRow(it, it.key === selected.key, t, listWidth)))
      .on_item_click((key, cx) => {
        ctx.setSel({ prompt: key }, cx);
        ctx.openDetail(cx);
      }).size_full())
    .child(Scrollbar.vertical("prompt-list").absolute().inset_0());
  const body = scrollArea("prompt-detail", v_flex().p(18).gap(12)
    .child(ctx.compact ? button("prompt-back", "목록", ctx.onBack, t, { iconName: "arrow-left", quiet: true }) : div())
    .child(detail(selected, ctx, t)));
  if (ctx.compact) return ctx.detailOpen ? body : list;
  return h_resizable("prompts-split").size_full()
    .child(resizable_panel().size(400).size_range(280, 640).child(div().size_full().border_r(1).border_color(t.border).child(list)))
    .child(resizable_panel().child(body));
}
