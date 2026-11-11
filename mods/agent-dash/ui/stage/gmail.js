// Gmail calls drawn like Gmail (light theme): the thread list, an open conversation, a
// compose window for a draft, the label list. Colors are Gmail's Material palette.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { memo } from "./common.js";
import { fullDate, listDate, parseGmail } from "../../lib/gmail.js";
import { blocks, hueOf } from "../../lib/rich.js";
import { avatar, bold, brand, budget, openLink, richBody, sheet } from "./rich.js";

export const GMAIL = {
  bg: "#FFFFFF", text: "#1F1F1F", dim: "#444746", subtle: "#5E5E5E", link: "#0B57D0", border: "#E1E3E1", headBg: "#F6F8FC", hover: "#F2F6FC",
  codeBg: "#F1F3F4", codeFg: "#1F1F1F", preBg: "#F8FAFD", preBorder: "#E1E3E1", quoteBar: "#C4C7C5", size: 14, h: [20, 16, 14], hWeight: 500, bold: 600,
  mono: "JetBrains Mono", tableRadius: 4, buttonRadius: 18, mentionBg: "#D3E3FD", mentionFg: "#041E49", callout: { default: "#F6F8FC" },
  read: "#F2F6FC", search: "#EAF1FB", chipBg: "#E7E8EB", accent: "#0B57D0", compose: "#C2E7FF", star: "#F4B400",
};
const LIST_ROWS = 40;

const top = (title, sub, url, ctx, id) => h_flex().w_full().px(20).pt(14).gap(10).items_center()
  .child(brand("brand-gmail", 22)).child(div().flex_none().text_size(18).text_color(GMAIL.dim).child(title))
  .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(GMAIL.subtle).child(sub ?? ""))
  .child(openLink(`${id}-open`, "Gmail에서 열기", url, GMAIL, ctx));

const chip = (text) => div().flex_none().px(6).h(18).rounded(4).bg(GMAIL.chipBg).text_size(11.5).text_color(GMAIL.dim).flex().items_center().child(text);

const searchBar = (query) => h_flex().w_full().h(44).px(16).gap(12).items_center().rounded(22).bg(GMAIL.search)
  .child(div().flex_none().text_size(15).text_color(GMAIL.dim).child("🔍"))
  .child(div().flex_1().min_w(0).truncate().text_size(15).text_color(query ? GMAIL.text : GMAIL.subtle).child(query || "메일 검색"));

function threadRow(row, i, id, ctx, now) {
  const names = row.senders.length ? row.senders.slice(0, 3).map((p) => p.name).join(", ") : "임시보관";
  const el = h_flex().id(`${id}-${i}`).w_full().h(40).px(16).gap(10).items_center().border_b(1).border_color("#EEF0F2").bg(row.unread ? GMAIL.bg : GMAIL.read)
    .hover((s) => s.bg("#E9EEF6"))
    .child(div().flex_none().w(16).text_size(14).text_color(row.starred ? GMAIL.star : "#C4C7C5").child(row.starred ? "★" : "☆"))
    .child(h_flex().w(170).flex_none().gap(5).items_center().min_w(0)
      .child(div().min_w(0).truncate().text_size(14).when(row.unread, (w) => bold(w, 700)).text_color(row.senders.length ? GMAIL.text : "#C5221F").child(names))
      .when(row.count > 1, (e) => e.child(div().flex_none().text_size(12).text_color(GMAIL.subtle).child(String(row.count)))))
    .children(row.labels.slice(0, 2).map(chip))
    .child(h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(div().flex_none().max_w(340).truncate().text_size(14).when(row.unread, (w) => bold(w, 700)).text_color(GMAIL.text).child(row.subject))
      .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(GMAIL.subtle).child(row.snippet ? `- ${row.snippet}` : "")))
    .when(row.attachments, (e) => e.child(div().flex_none().text_size(12).text_color(GMAIL.subtle).child("📎")))
    .child(div().flex_none().w(72).text_right().text_size(12).when(row.unread, (w) => bold(w, 700)).text_color(row.unread ? GMAIL.text : GMAIL.subtle).child(listDate(row.date, now)));
  return row.url ? el.cursor_pointer().on_click((_e, cx) => ctx.openUrl(row.url, cx)) : el;
}

function listView(view, call, ctx) {
  const id = `gml-${call.id}`;
  const now = Date.now();
  const shown = view.rows.slice(0, LIST_ROWS);
  const count = view.total != null && view.total > view.rows.length ? `${view.rows.length}개 표시 · 약 ${view.total}개` : `${view.rows.length}개${view.more ? " 이상" : ""}`;
  return sheet(GMAIL, [
    top(view.drafts ? "임시보관함" : "Gmail", null, null, ctx, id),
    div().w_full().px(20).pt(12).child(searchBar(view.query)),
    v_flex().w_full().px(8).pt(10).pb(12)
      .child(view.pending ? div().px(12).py(14).text_size(14).text_color(GMAIL.subtle).child("메일을 찾고 있어요")
        : shown.length ? v_flex().w_full().rounded(12).overflow_hidden().border(1).border_color("#EEF0F2")
          .children(shown.map((row, i) => threadRow(row, i, id, ctx, now)))
          .child(h_flex().w_full().h(34).px(16).items_center().justify_end().bg(GMAIL.bg).text_size(12).text_color(GMAIL.subtle).child(count))
        : div().px(12).py(18).text_size(14).text_color(GMAIL.subtle).child("일치하는 메일이 없어요")),
  ]);
}

function messageCard(m, i, id, ctx, bud) {
  const toLine = [...m.to, ...m.cc].slice(0, 4).map((p) => p.name).join(", ");
  return v_flex().w_full().px(20).py(16).gap(10).when(i > 0, (e) => e.border_t(1).border_color(GMAIL.border))
    .child(h_flex().w_full().gap(12).items_start()
      .child(avatar(m.from, 40, 20, hueOf(m.from.name)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().w_full().gap(6).items_center()
          .child(div().flex_none().max_w(260).truncate().text_size(14).when(true, (w) => bold(w, 700)).text_color(GMAIL.text).child(m.from.name))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(GMAIL.subtle).child(m.from.email ? `<${m.from.email}>` : ""))
          .child(div().flex_none().text_size(12).text_color(GMAIL.subtle).child(fullDate(m.date))))
        .when(Boolean(toLine), (e) => e.child(div().truncate().text_size(12).text_color(GMAIL.subtle).child(`${toLine}에게`)))))
    .child(div().w_full().pl(52).child(m.blocks?.length ? richBody(m.blocks, `${id}-b${i}`, GMAIL, ctx, bud) : div().text_size(14).text_color(GMAIL.subtle).child(m.snippet || "본문 없이 불러왔어요")))
    .when(m.attachments.length > 0, (e) => e.child(h_flex().w_full().pl(52).gap(8).flex_wrap().children(m.attachments.slice(0, 8).map((a) =>
      h_flex().flex_none().gap(6).items_center().h(32).px(10).rounded(8).border(1).border_color(GMAIL.border).text_size(12.5).text_color(GMAIL.text)
        .child(div().text_color("#C5221F").child("📎")).child(div().max_w(220).truncate().child(a.name))))));
}

function threadView(view, call, ctx) {
  const id = `gmt-${call.id}`;
  const bud = budget();
  return sheet(GMAIL, [
    top("Gmail", view.count > 1 ? `메일 ${view.count}개` : null, view.url, ctx, id),
    view.pending ? div().px(20).py(16).text_size(14).text_color(GMAIL.subtle).child("메일을 불러오고 있어요")
      : v_flex().w_full()
        .child(h_flex().w_full().px(20).pt(14).pb(4).gap(8).items_center().flex_wrap()
          .child(div().pl(52).text_size(22).line_height(1.3).text_color(GMAIL.text).child(view.subject)).children(view.labels.map(chip)))
        .children(view.messages.slice(0, 30).map((m, i) => messageCard(m, i, id, ctx, bud))),
  ]);
}

const fieldRow = (label, people) => h_flex().w_full().min_h(36).px(16).gap(8).items_center().flex_wrap().border_b(1).border_color("#EEF0F2")
  .child(div().flex_none().text_size(14).text_color(GMAIL.subtle).child(label))
  .children(people.map((p) => h_flex().flex_none().h(24).pl(3).pr(9).gap(6).items_center().rounded(12).border(1).border_color("#C4C7C5")
    .child(avatar(p, 18, 9, hueOf(p.name))).child(div().text_size(13).text_color(GMAIL.text).child(p.email || p.name))));

function draftView(view, call, ctx) {
  const id = `gmd-${call.id}`;
  const title = view.pending ? "임시보관함에 저장하는 중" : view.update ? "임시보관 메일을 고쳤어요" : view.reply ? "답장을 임시보관함에 저장했어요" : "임시보관함에 저장했어요";
  return sheet(GMAIL, [
    top("Gmail", title, view.url, ctx, id),
    div().w_full().px(20).pt(12).pb(18).child(
      v_flex().w_full().rounded(12).overflow_hidden().border(1).border_color(GMAIL.border)
        .child(h_flex().w_full().h(40).px(16).items_center().bg(GMAIL.read).text_size(14).when(true, (w) => bold(w, 500)).text_color("#041E49").child(view.reply ? "답장" : "새 메일"))
        .when(view.to.length > 0, (e) => e.child(fieldRow("받는사람", view.to)))
        .when(view.cc.length > 0, (e) => e.child(fieldRow("참조", view.cc)))
        .when(view.bcc.length > 0, (e) => e.child(fieldRow("숨은참조", view.bcc)))
        .child(h_flex().w_full().min_h(36).px(16).items_center().border_b(1).border_color("#EEF0F2").text_size(14).text_color(view.subject ? GMAIL.text : GMAIL.subtle).child(view.subject || "제목"))
        .child(div().w_full().px(16).py(12).min_h(90).child(view.blocks?.length ? richBody(view.blocks, `${id}-b`, GMAIL, ctx, budget()) : div().text_size(14).text_color(GMAIL.subtle).child("(본문 없음)")))
        .child(h_flex().w_full().h(52).px(16).gap(10).items_center()
          .child(div().flex_none().h(36).px(22).rounded(18).bg(GMAIL.accent).text_size(14).when(true, (w) => bold(w, 500)).text_color("#FFFFFF").flex().items_center().child("보내기"))
          .child(div().flex_1().text_size(12).text_color(GMAIL.subtle).child(view.signature ? "서명 포함 · 아직 보내지 않았어요" : "아직 보내지 않았어요")))),
  ]);
}

function labelsView(view, call, ctx) {
  const id = `gmb-${call.id}`;
  const row = (l) => h_flex().w_full().h(32).pl(16).pr(14).gap(10).items_center().rounded(16)
    .child(div().flex_none().text_size(13).text_color(GMAIL.dim).child(l.system ? "▸" : "🏷"))
    .child(div().flex_1().min_w(0).truncate().text_size(14).when(l.unread > 0, (w) => bold(w, 700)).text_color(GMAIL.text).child(l.name))
    .child(div().flex_none().text_size(12).when(l.unread > 0, (w) => bold(w, 700)).text_color(GMAIL.text).child(l.unread > 0 ? String(l.unread) : ""));
  return sheet(GMAIL, [
    top("Gmail", `라벨 ${view.labels.length}개`, null, ctx, id),
    v_flex().w_full().max_w(360).px(12).pt(10).pb(14).gap(1).child(view.pending ? div().px(8).text_size(14).text_color(GMAIL.subtle).child("라벨을 불러오고 있어요") : div())
      .children(view.labels.slice(0, 60).map(row)),
  ]);
}

/** Everything parsed, ready to draw (off the render pass). Null when it isn't Gmail data. */
export function prepareGmail(call) {
  const view = parseGmail(call);
  if (!view) return null;
  if (view.kind === "thread") return { ...view, messages: view.messages.map((m) => ({ ...m, blocks: m.body ? blocks(m.body, 120) : null })) };
  if (view.kind === "draft") return { ...view, blocks: view.body ? blocks(view.body, 120) : null };
  return view;
}

/** The Gmail-looking view of a prepared call, or null (the generic view draws it). */
export function drawGmail(view, call, ctx) {
  if (!view) return null;
  if (view.kind === "list") return listView(view, call, ctx);
  if (view.kind === "thread") return threadView(view, call, ctx);
  if (view.kind === "draft") return draftView(view, call, ctx);
  return labelsView(view, call, ctx);
}

export const renderGmail = (call, ctx) => drawGmail(memo(call, `gmail:${Boolean(call.result)}`, () => prepareGmail(call)), call, ctx);
