// 프롬프트: what you asked, newest first; for each one, what followed (calls, time, files)
// and the answer it ended with.

import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, TextView, h_resizable, resizable_panel } from "gpui-base";
import { alpha, button, card, chip, empty, icon, programIcon, scrollArea, sectionTitle, stackBar } from "./kit.js";
import { turnDetail } from "../lib/session.js";
import { KINDS, countKinds } from "../lib/tools.js";
import { firstLine, fmtDur, fmtInt, relTime, when } from "../lib/format.js";
import { relPath } from "../lib/paths.js";

const ROW_H = 58;
const KIND_LABEL = { notice: "알림", answer: "답변", paste: "붙여넣음", shell: "셸", command: "명령" };

function promptRow(item, selected, t) {
  const { prompt, turn, agent } = item;
  const label = firstLine(prompt.display ?? prompt.text) || (prompt.images ? `이미지 ${prompt.images}개` : "");
  const quiet = prompt.kind === "notice" || prompt.kind === "answer";
  return h_flex().id(item.key ?? `prompt-${prompt.n}`).w_full().h(ROW_H).flex_none().gap(10).items_center().px(16)
    .when(selected, (e) => e.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .child(v_flex().w(34).flex_none().items_center().gap(4)
      .child(div().px(5).h(16).rounded(4).bg(selected ? alpha(t.accent, 0.16) : t.raised).text_size(10.5).font_semibold().text_color(selected ? t.accent : t.muted).flex().items_center().child(`#${prompt.n}`))
      .when(Boolean(item.showAgent), (e) => e.child(programIcon(agent.program, 14, t))))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(Boolean(KIND_LABEL[prompt.kind]), (e) => e.child(div().flex_none().px(5).h(16).rounded(4).bg(t.raised).text_size(10).text_color(t.dim).flex().items_center().child(KIND_LABEL[prompt.kind] ?? "")))
        .child(div().min_w(0).truncate().text_size(12.5).font_weight(quiet ? 400 : 600).when(prompt.kind === "command" || prompt.kind === "shell", (e) => e.font_family(t.mono)).text_color(quiet ? t.dim : selected ? t.foreground : t.muted).child(label)))
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

function detail(item, ctx, t) {
  const { prompt, session, address } = item;
  const turn = turnDetail(session, prompt.n);
  const dur = session.turnDur[prompt.n] ? session.turnDur[prompt.n] / 1000 : turn.end && prompt.ts ? (turn.end - prompt.ts) / 1000 : null;
  const finalReply = turn.replies[turn.replies.length - 1];
  const notes = turn.replies.slice(0, -1);
  const openNotes = ctx.ui(`notes:${item.key}`, false);
  const cwd = ctx.terms?.[address]?.foreground?.cwd ?? session.cwd;
  const stat = (label, value) => v_flex().flex_1().min_w(110).px(12).py(9).rounded(9).bg(t.raised)
    .child(div().text_size(11).text_color(t.dim).child(label)).child(div().text_size(15).font_semibold().text_color(t.foreground).child(value));
  return v_flex().w_full().gap(16)
    .child(h_flex().gap(10).items_center()
      .child(div().px(7).h(22).rounded(6).bg(alpha(t.accent, 0.16)).text_size(12).font_semibold().text_color(t.accent).flex().items_center().child(`#${prompt.n}`))
      .child(div().flex_1().text_size(12).text_color(t.dim).child(`${when(prompt.ts)} · ${relTime(prompt.ts)}`))
      .child(button("prompt-copy", "복사", (_e, cx) => ctx.stageCtx(address, session, item.agent, null).copy(prompt.text, cx), t, { iconName: "copy" }))
      .when(turn.calls.length > 0, (e) => e.child(button("prompt-calls", "이 턴의 호출", (_e, cx) => ctx.openCall(address, turn.calls[0].id, cx), t, { iconName: "terminal" }))))
    .child(card(t).p(16).gap(8)
      .when(prompt.images > 0, (e) => e.child(h_flex().gap(6).child(chip(`이미지 ${prompt.images}개 첨부`, t, t.ansi6))))
      .child(md(`p-${item.key}`, prompt.kind === "prompt" || prompt.kind === "command" ? prompt.text : prompt.display || prompt.text, t)))
    .child(h_flex().w_full().gap(10).flex_wrap()
      .child(stat("호출", fmtInt(turn.calls.length)))
      .child(stat("걸린 시간", dur ? fmtDur(dur) : "—"))
      .child(stat("바뀐 파일", fmtInt(turn.files.length)))
      .child(stat("답변", fmtInt(turn.replies.length))))
    .when(turn.calls.length > 0, (e) => e.child(kindBar(turn.calls, t)))
    .when(turn.files.length > 0, (e) => e.child(v_flex().w_full().child(sectionTitle("이 턴에 바뀐 파일", t)).children(turn.files.map((f) =>
      h_flex().id(`tf-${f.path}`).w_full().gap(10).items_center().px(10).py(6).rounded(8).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => ctx.openFile(f.path, cx))
        .child(icon("file-text", 12, t.muted))
        .child(div().flex_1().min_w(0).truncate().font_family(t.mono).text_size(12).text_color(t.foreground).child(relPath(f.path, cwd, ctx.home)))
        .child(div().font_family(t.mono).text_size(11).text_color(t.add).child(`+${f.add}`))
        .child(div().font_family(t.mono).text_size(11).text_color(t.del).child(`−${f.del}`))))))
    .when(notes.length > 0, (e) => e.child(v_flex().w_full().gap(8)
      .child(h_flex().id(`notes-${item.key}`).gap(6).items_center().px(6).py(3).ml(-6).rounded(6).cursor_pointer().text_size(11.5).text_color(t.dim)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => ctx.setUi(`notes:${item.key}`, !openNotes, cx))
        .child(icon(openNotes ? "chevron-down" : "chevron-right", 12, t.dim)).child(`중간 설명 ${notes.length}개`))
      .when(openNotes, (el) => el.children(notes.map((r) => div().w_full().pl(12).border_l(2).border_color(t.border).child(md(`n-${item.key}-${r.n}`, r.text, t, 12.5)))))))
    .child(v_flex().w_full()
      .child(sectionTitle("답변", t))
      .child(finalReply ? card(t).p(16).child(md(`r-${item.key}`, finalReply.text, t)) : div().text_size(12).text_color(t.dim).child(item.agent.status === "working" ? "아직 답하는 중이에요" : "답변이 없어요")));
}

export function promptsLens(ctx, t) {
  const items = itemsFor(ctx);
  if (!items.length) return empty("프롬프트가 없어요", null, t, "message");
  const selected = items.find((it) => it.key === ctx.sel.prompt) ?? items.find((it) => it.key === `${ctx.scope}|${ctx.sel.prompt}`) ?? items[0];
  const list = div().size_full().min_h(0).relative().pt(6)
    .child(v_virtual_list("prompt-list", items.length, ROW_H, (i) => items[i].key, (range) =>
      items.slice(range.start, range.end).map((it) => promptRow(it, it.key === selected.key, t)))
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
