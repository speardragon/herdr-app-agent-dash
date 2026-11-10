// Notion calls drawn like Notion (light theme): a page with its breadcrumb, icon, title,
// properties and blocks; search results; database rows; and what a write sent.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { memo } from "./common.js";
import { parseNotion } from "../../lib/notion.js";
import { inline, hueOf } from "../../lib/rich.js";
import { masked } from "../../lib/tools.js";
import { bold, brand, budget, openLink, richBody, runsEl, sheet } from "./rich.js";

export const NOTION = {
  bg: "#FFFFFF", text: "#2C2C2B", dim: "#7D7A75", link: "#2C2C2B", border: "#E9E9E7", headBg: "#F7F6F3", hover: "#F1F1EF",
  codeBg: "#F4F3F2", codeFg: "#CF5148", preBg: "#F7F6F3", quoteBar: "#2C2C2B", quoteBarW: 3, size: 15, h: [26, 21, 18], hWeight: 600, bold: 600,
  mono: "JetBrains Mono", mentionFg: "#2C2C2B", calloutRadius: 10, buttonRadius: 6,
  callout: {
    default: "#F1F1EF", gray_bg: "#F1F1EF", brown_bg: "#F4EEEE", orange_bg: "#FBECDD", yellow_bg: "#FBF3DB", green_bg: "#EDF3EC",
    blue_bg: "#E7F3F8", purple_bg: "#F4F0F7", pink_bg: "#F9EEF3", red_bg: "#FDEBEC",
  },
};
// Notion's select colors: a tag gets one steadily from its text (the MCP doesn't say which).
const TAGS = [["#E3E2E0", "#32302C"], ["#EEE0DA", "#442A1E"], ["#FADEC9", "#49290E"], ["#FDECC8", "#402C1B"], ["#DBEDDB", "#1C3829"], ["#D3E5EF", "#183347"], ["#E8DEEE", "#412454"], ["#F5E0E9", "#4C2337"], ["#FFE2DD", "#5D1715"]];

const tag = (text) => {
  const [bg, fg] = TAGS[hueOf(text, TAGS.length)];
  return div().flex_none().max_w(220).truncate().px(6).h(20).rounded(3).bg(bg).text_size(13).text_color(fg).flex().items_center().child(masked(text));
};

const RUNS = new Map();
// Inline parsing once per distinct text (property values and search snippets repeat every frame).
function runsOf(text) {
  if (!RUNS.has(text)) {
    if (RUNS.size > 600) RUNS.clear();
    RUNS.set(text, inline(text));
  }
  return RUNS.get(text);
}

function valueEl(value, id, ctx, bud, size = 14) {
  if (value.kind === "check") {
    return div().size(16).flex_none().rounded(3).border(1.5).border_color(value.on ? "#2383E2" : "#C7C6C4").when(value.on, (e) => e.bg("#2383E2"))
      .flex().items_center().justify_center().text_size(10).text_color("#ffffff").child(value.on ? "✓" : "");
  }
  if (value.kind === "tags") return h_flex().gap(6).flex_wrap().children(value.tags.slice(0, 10).map(tag));
  if (value.kind === "empty") return div().text_size(size).text_color("#B4B3AF").child("비어 있음");
  if (value.kind === "url") {
    return div().id(id).min_w(0).truncate().text_size(size).text_color(NOTION.text).underline().cursor_pointer().on_click((_e, cx) => ctx.openUrl(value.text, cx)).child(masked(value.text));
  }
  return runsEl(runsOf(value.text.slice(0, 1200)), id, NOTION, ctx, bud, { size, lh: Math.round(size * 1.5) });
}

function propsEl(props, id, ctx, bud) {
  return v_flex().w_full().gap(2).children(props.map((p, i) => h_flex().w_full().min_h(32).gap(8).items_start().py(4)
    .child(div().w(150).flex_none().truncate().text_size(14).text_color(NOTION.dim).child(masked(p.name)))
    .child(div().flex_1().min_w(0).child(valueEl(p.value, `${id}-p${i}`, ctx, bud)))));
}

const topBar = (crumbs, url, id, ctx) => h_flex().w_full().h(44).px(14).gap(8).items_center()
  .child(brand("brand-notion", 18))
  .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(NOTION.text).child(masked(crumbs.join("  /  "))))
  .child(openLink(`${id}-open`, "Notion에서 열기", url, NOTION, ctx));

const title = (text, icon) => v_flex().w_full().gap(6)
  .when(Boolean(icon), (e) => e.child(div().text_size(44).line_height(1.18).child(icon)))
  .child(div().w_full().text_size(30).when(true, (w) => bold(w, 700)).line_height(1.27).text_color(NOTION.text).child(masked(text || "제목 없음")));

function pageView(view, call, ctx) {
  const bud = budget();
  const id = `notion-${call.id}`;
  return sheet(NOTION, [
    topBar([...view.crumbs, view.title], view.url, id, ctx),
    v_flex().w_full().px(40).pt(26).pb(34).gap(14)
      .child(title(view.title, view.icon))
      .when(view.props.length > 0, (e) => e.child(propsEl(view.props, id, ctx, bud)).child(div().w_full().h(1).bg(NOTION.border)))
      .child(view.blank ? div().text_size(15).text_color(NOTION.dim).child("빈 페이지예요")
        : richBody(view.blocks, `${id}-b`, NOTION, ctx, bud, 7))
      .when(view.cut, (e) => e.child(div().text_size(12).text_color(NOTION.dim).child("결과가 길어서 뒷부분은 기록에 남지 않았어요"))),
  ]);
}

function databaseView(view, call, ctx) {
  const id = `notiond-${call.id}`;
  return sheet(NOTION, [
    topBar([...view.crumbs, view.title], view.url, id, ctx),
    v_flex().w_full().px(40).pt(26).pb(30).gap(14)
      .child(title(view.title, null))
      .when(view.views.length > 0, (e) => e.child(h_flex().gap(14).flex_wrap().children(view.views.map((v, i) => div().pb(4).text_size(14).when(true, (w) => bold(w, i === 0 ? 600 : 400)).text_color(i === 0 ? NOTION.text : NOTION.dim).child(masked(v))))))
      .child(v_flex().w_full().border_t(1).border_color(NOTION.border).children(view.columns.map((c) => h_flex().w_full().h(34).gap(10).items_center().border_b(1).border_color(NOTION.border)
        .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(NOTION.text).child(masked(c.name)))
        .child(div().w(90).flex_none().text_size(12).text_color(NOTION.dim).child(c.type.toLowerCase()))))),
  ]);
}

function searchView(view, call, ctx) {
  const id = `notions-${call.id}`;
  const bud = budget(1800, 120);
  return sheet(NOTION, [
    h_flex().w_full().h(52).px(16).gap(10).items_center().border_b(1).border_color(NOTION.border)
      .child(brand("brand-notion", 18)).child(div().text_size(16).text_color(NOTION.dim).child("🔍"))
      .child(div().flex_1().min_w(0).truncate().text_size(17).text_color(NOTION.text).child(masked(view.query || "검색"))),
    view.pending ? div().p(18).text_size(14).text_color(NOTION.dim).child("검색 결과를 기다리고 있어요")
      : v_flex().w_full().p(6).children(view.results.length ? view.results.map((r, i) => {
        const row = h_flex().id(`${id}-${i}`).w_full().gap(10).items_start().px(10).py(8).rounded(6).hover((s) => s.bg(NOTION.hover))
          .child(div().w(20).flex_none().pt(1).text_size(15).child(r.type === "database" ? "🗂" : "📄"))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().truncate().text_size(14).when(true, (w) => bold(w, 500)).text_color(NOTION.text).child(masked(r.title || "제목 없음")))
            .when(Boolean(r.path), (e) => e.child(div().truncate().text_size(12).text_color(NOTION.dim).child(masked(r.path))))
            .when(Boolean(r.highlight), (e) => e.child(runsEl(runsOf(r.highlight.slice(0, 260)), `${id}-h${i}`, NOTION, ctx, bud, { size: 12.5, color: NOTION.dim, lh: 18 }))))
          .when(Boolean(r.time), (e) => e.child(div().flex_none().text_size(12).text_color(NOTION.dim).child(String(r.time).slice(0, 10))));
        return r.url ? row.cursor_pointer().on_click((_e, cx) => ctx.openUrl(r.url, cx)) : row;
      }) : [div().p(12).text_size(14).text_color(NOTION.dim).child("결과 없음")]),
  ]);
}

function rowsView(view, call, ctx) {
  const id = `notionr-${call.id}`;
  const bud = budget(1500, 400);
  const width = (i) => (i === 0 && view.columns.length > 3 ? 70 : 150);
  const cell = (child, i, head = false) => div().w(width(i)).flex_none().min_h(33).px(8).py(6).border_r(1).border_color(NOTION.border).overflow_hidden()
    .when(head, (e) => e.text_size(14).text_color(NOTION.dim)).child(child);
  const rows = view.rows.slice(0, 40);
  return sheet(NOTION, [
    h_flex().w_full().h(44).px(14).gap(8).items_center().child(brand("brand-notion", 18)).child(div().flex_1().text_size(14).when(true, (w) => bold(w, 600)).text_color(NOTION.text).child("표"))
      .child(div().text_size(12).text_color(NOTION.dim).child(`${view.total}개 행${view.total > rows.length ? ` 중 ${rows.length}개` : ""}`)),
    div().id(`${id}-x`).w_full().overflow_scroll().px(14).pb(16).child(v_flex().border_t(1).border_color(NOTION.border)
      .child(h_flex().items_stretch().border_b(1).border_color(NOTION.border).children(view.columns.map((c, i) => cell(div().truncate().child(masked(c)), i, true))))
      .children(rows.map((r, ri) => h_flex().items_stretch().border_b(1).border_color(NOTION.border)
        .children(r.cells.map((v, ci) => cell(v.kind === "empty" ? div() : v.kind === "text" && v.text.length < 60 && !/[*`\[<]/.test(v.text)
          ? div().truncate().text_size(14).text_color(NOTION.text).child(v.text) : valueEl(v, `${id}-${ri}-${ci}`, ctx, bud), ci)))))),
  ]);
}

const COMMAND = { replace_content: "페이지 내용을 새로 썼어요", update_content: "페이지 내용을 고쳤어요", update_properties: "속성을 바꿨어요", insert_content: "내용을 넣었어요", insert_content_after: "내용을 넣었어요" };

function noticeBar(text, tone = "#EDF3EC") {
  return h_flex().w_full().px(12).py(8).rounded(6).bg(tone).text_size(13).text_color(NOTION.text).child(text);
}

function updateView(view, call, ctx) {
  const bud = budget();
  const id = `notionu-${call.id}`;
  const state = view.failed ? "고치지 못했어요" : view.pending ? "아직 결과가 오지 않았어요 · 보낸 내용이에요" : `✓ ${COMMAND[view.command] ?? "페이지를 고쳤어요"}`;
  return sheet(NOTION, [
    topBar([view.title || `페이지 ${view.pageId.slice(0, 8)}`], null, id, ctx),
    v_flex().w_full().px(40).pt(18).pb(30).gap(14)
      .child(noticeBar(state, view.failed ? "#FDEBEC" : view.pending ? "#FBF3DB" : "#EDF3EC"))
      .when(Boolean(view.title || view.icon), (e) => e.child(title(view.title, view.icon)))
      .when(view.props.length > 0, (e) => e.child(propsEl(view.props, id, ctx, bud)))
      .when(view.blocks.length > 0, (e) => e.child(richBody(view.blocks, `${id}-b`, NOTION, ctx, bud, 7)))
      .children(view.edits.map((edit, i) => v_flex().w_full().gap(6)
        .child(div().text_size(12).text_color(NOTION.dim).child(`바꾼 곳 ${i + 1}`))
        .when(edit.from.length > 0, (e) => e.child(div().w_full().px(10).py(8).rounded(6).bg("#FDEBEC").opacity(0.85).child(richBody(edit.from, `${id}-f${i}`, NOTION, ctx, bud, 5))))
        .when(edit.to.length > 0, (e) => e.child(div().w_full().px(10).py(8).rounded(6).bg("#EDF3EC").child(richBody(edit.to, `${id}-t${i}`, NOTION, ctx, bud, 5)))))),
  ]);
}

function createView(view, call, ctx) {
  const bud = budget();
  const id = `notionc-${call.id}`;
  const state = view.failed ? "만들지 못했어요" : view.pending ? "아직 결과가 오지 않았어요 · 보낸 내용이에요" : `✓ 페이지 ${view.pages.length}개를 만들었어요`;
  return sheet(NOTION, [
    topBar(["새 페이지"], null, id, ctx),
    v_flex().w_full().px(40).pt(18).pb(30).gap(18)
      .child(noticeBar(state, view.failed ? "#FDEBEC" : view.pending ? "#FBF3DB" : "#EDF3EC"))
      .children(view.pages.slice(0, 12).map((p, i) => v_flex().w_full().gap(10).pt(i ? 16 : 0).when(i > 0, (e) => e.border_t(1).border_color(NOTION.border))
        .child(h_flex().w_full().gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(view.pages.length > 1 ? 18 : 28).when(true, (w) => bold(w, 700)).text_color(NOTION.text).child(`${p.icon ? `${p.icon} ` : ""}${masked(p.title || "제목 없음")}`))
          .child(openLink(`${id}-o${i}`, "열기", p.url, NOTION, ctx)))
        .when(p.props.length > 0, (e) => e.child(propsEl(p.props, `${id}-${i}`, ctx, bud)))
        .when(p.blocks.length > 0, (e) => e.child(richBody(p.blocks, `${id}-b${i}`, NOTION, ctx, bud, 7)))))
      .when(view.pages.length > 12, (e) => e.child(div().text_size(12).text_color(NOTION.dim).child(`나머지 ${view.pages.length - 12}개는 '원본'에서 볼 수 있어요`))),
  ]);
}

/** Parsed off the render pass (see prepareJira). */
export const prepareNotion = (call) => parseNotion(call);

export const renderNotion = (call, ctx) => drawNotion(memo(call, `notion:${Boolean(call.result)}`, () => prepareNotion(call)), call, ctx);

/** The Notion-looking view of a prepared call, or null (the generic view draws it). */
export function drawNotion(view, call, ctx) {
  if (!view) return null;
  // Nothing to draw yet for a read that hasn't answered (writes show what was sent).
  if (view.pending && view.kind !== "update" && view.kind !== "create" && view.kind !== "search") return null;
  if (view.kind === "page") return pageView(view, call, ctx);
  if (view.kind === "database") return databaseView(view, call, ctx);
  if (view.kind === "search") return searchView(view, call, ctx);
  if (view.kind === "rows") return rowsView(view, call, ctx);
  if (view.kind === "update") return updateView(view, call, ctx);
  if (view.kind === "create") return createView(view, call, ctx);
  return null;
}
