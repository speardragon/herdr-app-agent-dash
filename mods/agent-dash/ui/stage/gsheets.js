// Google Sheets calls drawn like Sheets (light theme): the grid with its column letters and
// row numbers, the formula bar holding the range, the sheet tabs at the bottom.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { xScroll } from "../kit.js";
import { memo } from "./common.js";
import { parseGsheets } from "../../lib/gsheets.js";
import { bold, brand, openLink, sheet } from "./rich.js";

export const GSHEETS = {
  bg: "#FFFFFF", text: "#1F1F1F", dim: "#444746", subtle: "#5E5E5E", link: "#0B57D0", border: "#DADCE0", headBg: "#F8F9FA", hover: "#F1F3F4",
  buttonRadius: 18, grid: "#E1E1E1", head: "#F8F9FA", headText: "#5F6368", green: "#188038", tabBg: "#E6F4EA", bar: "#F9FBFD",
};
// The app draws every cell as an element: a frame's budget allows a few hundred, so a big
// range shows its first rows and columns and says how much there is.
const ROWS = 40;
const COLS = 10;
const CELL_W = 118;
const NUM_W = 46;
const ROW_H = 22;

const top = (title, sub, url, ctx, id) => h_flex().w_full().px(20).pt(14).gap(10).items_center()
  .child(brand("brand-gsheets", 22)).child(div().flex_none().max_w(420).truncate().text_size(18).text_color(GSHEETS.dim).child(title))
  .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(GSHEETS.subtle).child(sub ?? ""))
  .child(openLink(`${id}-open`, "Sheets에서 열기", url, GSHEETS, ctx));

const formulaBar = (range, note) => h_flex().w_full().h(30).items_center().border_t(1).border_b(1).border_color(GSHEETS.border).bg(GSHEETS.bg)
  .child(div().w(132).flex_none().px(10).truncate().text_size(13).text_color(GSHEETS.text).child(range || "A1"))
  .child(div().w(1).h(18).flex_none().bg(GSHEETS.border))
  .child(div().flex_none().px(10).text_size(13).italic().text_color(GSHEETS.subtle).child("fx"))
  .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(GSHEETS.dim).child(note ?? ""));

const headCell = (text, w) => div().w(w).h(ROW_H).flex_none().border_r(1).border_b(1).border_color("#C4C7C5").bg(GSHEETS.head).text_size(11).text_color(GSHEETS.headText).flex().items_center().justify_center().child(text);

function cell(c, write) {
  return div().w(CELL_W).h(ROW_H).flex_none().px(4).border_r(1).border_b(1).border_color(GSHEETS.grid).when(write && c.text !== "", (e) => e.bg("#F0F8F2"))
    .text_size(13).text_color(c.formula ? GSHEETS.green : GSHEETS.text).truncate().when(c.number, (e) => e.text_right()).flex().items_center().when(c.number, (e) => e.justify_end())
    .child(c.text);
}

function gridView(view, call, ctx) {
  const id = `gsg-${call.id}`;
  const g = view.grid;
  const cols = g.cols.slice(0, COLS);
  const rows = g.rows.slice(0, ROWS);
  const size = `${g.totalRows}행 × ${g.totalCols}열`;
  const cut = g.totalRows > rows.length || g.totalCols > cols.length;
  const note = view.pending ? "기다리는 중" : view.write ? `${view.notice}${view.cells != null ? ` · 셀 ${view.cells}개` : ""}` : size;
  const table = v_flex().flex_none()
    .child(h_flex().flex_none().child(headCell("", NUM_W)).children(cols.map((c) => headCell(c, CELL_W))))
    .children(rows.map((r) => h_flex().flex_none().child(headCell(String(r.n), NUM_W)).children(r.cells.slice(0, COLS).map((c) => cell(c, view.write)))));
  return sheet(GSHEETS, [
    top(g.sheet || "스프레드시트", view.write ? view.notice : "값 읽기", view.url, ctx, id),
    div().w_full().pt(12).child(formulaBar(g.cells || g.text, note)),
    view.empty || !rows.length ? div().w_full().px(20).py(18).text_size(14).text_color(GSHEETS.subtle).child(view.pending ? "값을 기다리고 있어요" : "이 범위는 비어 있어요")
      : div().w_full().child(xScroll(`${id}-x`, table, 12)),
    h_flex().w_full().h(36).px(12).gap(10).items_center().border_t(1).border_color(GSHEETS.border).bg(GSHEETS.bar)
      .child(div().flex_none().text_size(16).text_color(GSHEETS.dim).child("+"))
      .child(div().flex_none().h(36).px(14).bg(GSHEETS.tabBg).border_b(2).border_color(GSHEETS.green).text_size(14).when(true, (w) => bold(w, 500)).text_color(GSHEETS.green).flex().items_center().child(g.sheet || "시트1"))
      .child(div().flex_1().text_right().text_size(12).text_color(GSHEETS.subtle).child(cut ? `${size} 중 ${rows.length}행 × ${cols.length}열 표시` : size)),
  ]);
}

function bookView(view, call, ctx) {
  const id = `gsb-${call.id}`;
  return sheet(GSHEETS, [
    top(view.title ?? "스프레드시트", `시트 ${view.sheets.length}개`, view.url, ctx, id),
    v_flex().w_full().px(20).pt(12).pb(16).gap(4)
      .child(view.pending ? div().text_size(14).text_color(GSHEETS.subtle).child("스프레드시트를 불러오고 있어요") : div())
      .children(view.sheets.slice(0, 60).map((s, i) => h_flex().w_full().h(34).px(12).gap(10).items_center().rounded(4).when(i === 0, (e) => e.bg(GSHEETS.tabBg))
        .child(div().w(3).h(18).flex_none().rounded(2).bg(i === 0 ? GSHEETS.green : "#C4C7C5"))
        .child(div().flex_1().min_w(0).truncate().text_size(14).when(i === 0, (w) => bold(w, 500)).text_color(i === 0 ? GSHEETS.green : GSHEETS.text).child(s.title))
        .child(div().flex_none().text_size(12).text_color(GSHEETS.subtle).child(s.rows && s.cols ? `${s.rows}행 × ${s.cols}열` : "")))),
  ]);
}

function clearedView(view, call, ctx) {
  const id = `gsc-${call.id}`;
  return sheet(GSHEETS, [
    top("스프레드시트", view.pending ? "지우는 중" : "값을 지웠어요", view.url, ctx, id),
    v_flex().w_full().px(20).pt(12).pb(16).gap(6).children(view.ranges.slice(0, 40).map((r) =>
      h_flex().w_full().h(30).px(10).items_center().rounded(4).border(1).border_color(GSHEETS.border).text_size(13).text_color(GSHEETS.text).child(r))),
  ]);
}

export const prepareGsheets = (call) => parseGsheets(call);

/** The Sheets-looking view of a prepared call, or null (the generic view draws it). */
export function drawGsheets(view, call, ctx) {
  if (!view) return null;
  if (view.kind === "grid") return gridView(view, call, ctx);
  if (view.kind === "book") return bookView(view, call, ctx);
  return clearedView(view, call, ctx);
}

export const renderGsheets = (call, ctx) => drawGsheets(memo(call, `gsheets:${Boolean(call.result)}`, () => prepareGsheets(call)), call, ctx);
