// 변경: the files an agent changed. 누적 compares the file before the agent first touched it
// with the file now; 편집별 lists each edit in order.

import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, h_resizable, resizable_panel } from "gpui-base";
import { alpha, chip, empty, icon, programIcon, scrollArea, segmented } from "./kit.js";
import { diffView, splitView } from "./code.js";
import { diffRows, foldRows, patchRows, rowStats, splitPairs, unifiedRows } from "../lib/diff.js";
import { clockSec, fmtInt, relTime } from "../lib/format.js";
import { baseName, dirName, langOf, relPath } from "../lib/paths.js";
import { memo } from "./stage/common.js";

const ROW_H = 44;
const STATUS_COLOR = (t, s) => (s === "A" ? t.add : s === "D" ? t.del : t.blocked);

function itemsFor(ctx) {
  const scopes = ctx.scope === "all" ? Object.keys(ctx.agents) : [ctx.scope];
  const items = [];
  for (const address of scopes) {
    const session = ctx.store.get(address);
    const d = ctx.store.derived(session);
    if (!d) continue;
    const cwd = ctx.terms?.[address]?.foreground?.cwd ?? session.cwd;
    for (const f of d.files) items.push({ key: `${address}|${f.path}`, file: f, address, session, agent: ctx.agents[address], rel: relPath(f.path, cwd, ctx.home), showAgent: ctx.scope === "all" });
  }
  return ctx.scope === "all" ? items.sort((a, b) => b.file.last - a.file.last) : items;
}

function fileRow(item, selected, t) {
  const { file } = item;
  return h_flex().id(item.key ?? `file-${file.path}`).w_full().h(ROW_H).flex_none().gap(10).items_center().px(10).rounded(8)
    .when(selected, (e) => e.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .child(div().w(16).flex_none().text_size(11.5).font_bold().text_color(STATUS_COLOR(t, file.status)).child(file.status))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_size(12.5).font_weight(600).text_color(selected ? t.foreground : t.muted).child(baseName(file.path)))
      .child(div().truncate().text_size(10.5).font_family(t.mono).text_color(t.dim).child(dirName(item.rel) || ".")))
    .child(v_flex().flex_none().items_end().gap(2)
      .child(h_flex().gap(5).font_family(t.mono).text_size(11)
        .child(div().text_color(t.add).child(`+${fmtInt(file.add)}`)).child(div().text_color(t.del).child(`−${fmtInt(file.del)}`)))
      .child(h_flex().gap(5).items_center()
        .when(Boolean(item.showAgent), (e) => e.child(programIcon(item.agent.program, 12, t)))
        .child(div().text_size(10.5).text_color(t.dim).child(`${file.edits}번 · ${relTime(file.last)}`))));
}

/** Text before and now, loaded once per change of the file (see main.js request). */
function cumulative(item, ctx, t) {
  const { file, session, address } = item;
  const key = `cum:${address}:${file.path}:${file.last}`;
  const result = ctx.request(key, async (reader) => {
    const now = file.status === "D" ? "" : await reader.currentText(file.path);
    let before = null;
    let source = "original";
    if (file.status === "A") before = "";
    else if (session.provider === "claude" && session.file) {
      const original = await reader.originalText(session.file, file.path);
      if (original.found) before = original.text;
    }
    if (before == null) {
      before = await reader.headText(ctx.terms?.[address]?.foreground?.cwd ?? session.cwd ?? dirName(file.path), file.path);
      source = "head";
    }
    if (now == null) throw new Error("지금 파일을 읽지 못했어요 (지워졌거나 1MB가 넘어요)");
    if (before == null) throw new Error("처음 내용을 찾지 못했어요");
    return { before, after: now, source };
  });
  if (!result || result.state === "loading") return h_flex().gap(8).items_center().p(14).text_size(12).text_color(t.dim).child(icon("spinner", 12, t.dim).spin(900)).child("처음 내용과 지금 파일을 읽는 중…");
  if (result.state === "error") return div().p(14).text_size(12).text_color(t.del).child(result.error);
  const { before, after, source } = result.value;
  const rows = memo(result.value, "rows", () => diffRows(before, after, langOf(file.path)));
  const stats = memo(rows, "stats", () => rowStats(rows));
  if (!stats.add && !stats.del) return div().p(14).text_size(12.5).text_color(t.dim).child("처음 내용과 같아요. 바뀌었다가 되돌아갔어요.");
  const items = memo(rows, "fold", () => foldRows(rows, 3));
  const mode = ctx.ui("diff:mode", "unified");
  const lang = langOf(file.path);
  return v_flex().w_full().gap(8)
    .child(h_flex().gap(8).items_center().text_size(11.5).text_color(t.dim)
      .child(icon("info", 12, t.dim))
      .child(div().child(source === "head" ? "기준: 마지막 커밋(HEAD) → 지금 파일" : "기준: 에이전트가 처음 고치기 직전 → 지금 파일")))
    .child(mode === "split" ? splitView(splitPairs(items), t, { id: `cum-split-${file.path}`, lang }) : diffView(items, t, { id: `cum-${file.path}`, lang }));
}

function perEdit(item, ctx, t) {
  const { file, session } = item;
  const lang = langOf(file.path);
  const all = file.calls.map((id) => session.calls[session.callIx[id]]).filter(Boolean);
  const limit = ctx.ui(`edits:${item.key}`, 6);
  const calls = all.slice(-limit);
  const skipped = all.length - calls.length;
  return v_flex().w_full().gap(14)
    .when(skipped > 0, (e) => e.child(h_flex().id(`more-edits-${item.key}`).h(30).justify_center().items_center().rounded(8).cursor_pointer()
      .bg(t.raised).hover((s) => s.bg(t.hover)).text_size(12).text_color(t.accent)
      .on_click((_e, cx) => ctx.setUi(`edits:${item.key}`, limit + 10, cx)).child(`이전 편집 ${fmtInt(skipped)}개 더 보기`)))
    .children(calls.map((call, k) => {
    const i = skipped + k;
    let rows;
    if (call.name === "apply_patch") rows = unifiedRows(call.input?.changes?.[file.path]?.diff ?? "", lang);
    else if (Array.isArray(call.result?.extra?.patch) && call.result.extra.patch.length) rows = patchRows(call.result.extra.patch, lang);
    else if (call.name === "Write") rows = diffRows("", call.input?.content ?? "", lang);
    else rows = diffRows(call.input?.old_string ?? "", call.input?.new_string ?? "", lang);
    const st = rowStats(rows);
    return v_flex().w_full().gap(6)
      .child(h_flex().id(`edit-${call.id}`).gap(8).items_center().px(6).py(3).ml(-6).rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => ctx.openCall(item.address, call.id, cx))
        .child(div().px(5).h(16).rounded(4).bg(t.raised).text_size(10.5).font_semibold().text_color(t.muted).flex().items_center().child(`${i + 1}`))
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(call.name))
        .child(div().text_size(11).text_color(t.dim).child(`${clockSec(call.ts)} · 턴 #${call.turn}`))
        .child(div().flex_1())
        .child(div().font_family(t.mono).text_size(11).text_color(t.add).child(`+${st.add}`))
        .child(div().font_family(t.mono).text_size(11).text_color(t.del).child(`−${st.del}`))
        .child(icon("chevron-right", 12, t.dim)))
      .child(diffView(foldRows(rows), t, { id: `pe-${call.id}`, lang }));
  }));
}

function detail(item, ctx, t) {
  const view = ctx.ui("changes:view", "cumulative");
  const { file } = item;
  return v_flex().w_full().gap(14)
    .child(h_flex().w_full().gap(10).items_center()
      .child(div().px(6).h(20).rounded(5).bg(alpha(STATUS_COLOR(t, file.status), 0.16)).text_size(11).font_bold().text_color(STATUS_COLOR(t, file.status)).flex().items_center().child(file.status))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(14).font_semibold().text_color(t.foreground).child(baseName(file.path)))
        .child(div().truncate().font_family(t.mono).text_size(11).text_color(t.dim).child(item.rel)))
      .child(h_flex().gap(5).font_family(t.mono).text_size(12)
        .child(div().text_color(t.add).child(`+${fmtInt(file.add)}`)).child(div().text_color(t.del).child(`−${fmtInt(file.del)}`))))
    .child(h_flex().w_full().gap(8).items_center().flex_wrap()
      .child(segmented("changes-view", [{ id: "cumulative", label: "누적", icon: "layers" }, { id: "edits", label: `편집별 ${file.edits}`, icon: "list" }], view, (v, cx) => ctx.setUi("changes:view", v, cx), t))
      .when(view === "cumulative", (e) => e.child(segmented("changes-mode", [{ id: "unified", label: "한 줄", icon: "rows" }, { id: "split", label: "나란히", icon: "columns" }], ctx.ui("diff:mode", "unified"), (v, cx) => ctx.setUi("diff:mode", v, cx), t)))
      .child(div().flex_1())
      .when(item.showAgent, (e) => e.child(chip(item.agent.title, t))))
    .child(view === "edits" ? perEdit(item, ctx, t) : cumulative(item, ctx, t));
}

export function changesLens(ctx, t) {
  const items = itemsFor(ctx);
  if (!items.length) return empty("바뀐 파일이 없어요", "에이전트가 Edit·Write·apply_patch로 파일을 고치면 여기 모여요.", t, "diff");
  const selected = items.find((it) => it.key === ctx.sel.file) ?? items.find((it) => it.file.path === ctx.sel.file) ?? items[0];
  const list = div().size_full().min_h(0).relative().px(6).pt(6)
    .child(v_virtual_list("file-list", items.length, ROW_H, (i) => items[i].key, (range) =>
      items.slice(range.start, range.end).map((it) => fileRow(it, it.key === selected.key, t)))
      .on_item_click((key, cx) => {
        ctx.setSel({ file: key }, cx);
        ctx.openDetail(cx);
      }).size_full())
    .child(Scrollbar.vertical("file-list").absolute().inset_0());
  const body = scrollArea("change-detail", v_flex().p(18).gap(12).child(detail(selected, ctx, t)));
  if (ctx.compact) return ctx.detailOpen ? body : list;
  return h_resizable("changes-split").size_full()
    .child(resizable_panel().size(340).size_range(240, 560).child(div().size_full().border_r(1).border_color(t.border).child(list)))
    .child(resizable_panel().child(body));
}
