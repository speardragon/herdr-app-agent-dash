// MongoDB MCP calls the way Compass shows them: the namespace bar, the query bar or the
// pipeline, documents with BSON-typed values (List / JSON / Table), explain as a tree.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { alpha, chip, icon, mongoLeaf, segmented } from "../kit.js";
import { codeView, tokenLine } from "../code.js";
import { tokenize } from "../../lib/highlight.js";
import { bsonText, bsonType, columnsOf, isContainer, readExplain, readResult, shellJS } from "../../lib/mongo.js";
import { mcpParts, mongoOp, serverLabel } from "../../lib/tools.js";
import { fmtInt } from "../../lib/format.js";
import { memo } from "./common.js";

const OP_COLOR = (t) => ({ read: t.ansi4, write: t.blocked, meta: t.dim });

function nsBar(call, t, count) {
  const p = mcpParts(call.name);
  const i = call.input ?? {};
  const op = mongoOp(p.tool);
  const crumbs = [serverLabel(p.server), i.database, i.collection].filter(Boolean);
  return h_flex().w_full().h(38).px(12).gap(8).items_center().rounded(9).bg(alpha(t.mongo, 0.06)).border(1).border_color(alpha(t.mongo, 0.25))
    .child(mongoLeaf(16))
    .children(crumbs.flatMap((c, k) => [
      ...(k ? [icon("chevron-right", 11, t.dim)] : []),
      div().text_size(12.5).font_weight(k === crumbs.length - 1 ? 600 : 400).text_color(k === crumbs.length - 1 ? t.foreground : t.muted).child(c),
    ]))
    .child(div().flex_1())
    .when(count != null, (e) => e.child(div().text_size(12).text_color(t.muted).child(count)))
    .child(div().px(7).h(20).rounded(5).bg(alpha(OP_COLOR(t)[op], 0.16)).text_size(10.5).font_bold().text_color(OP_COLOR(t)[op]).flex().items_center().child(op.toUpperCase()));
}

function shellLine(value, t) {
  const text = shellJS(value, 0, 9999);
  return tokenLine(tokenize(text, "mongo")[0] ?? [], t);
}

/** Compass's query bar: Filter / Project / Sort / Limit / Skip, only what was given. */
function queryBar(input, t) {
  const rows = [
    ["Filter", input.filter ?? input.query],
    ["Update", input.update],
    ["Project", input.projection],
    ["Sort", input.sort],
    ["Collation", input.collation],
  ].filter(([, v]) => v != null && !(typeof v === "object" && !Object.keys(v).length && v !== input.filter));
  const tail = [["Limit", input.limit], ["Skip", input.skip]].filter(([, v]) => v != null);
  if (!rows.length && !tail.length) return null;
  return v_flex().w_full().rounded(9).border(1).border_color(t.border).bg(t.background).overflow_hidden()
    .children(rows.map(([label, value], k) => h_flex().w_full().min_h(32).px(10).py(6).gap(10).items_start().when(k > 0, (e) => e.border_t(1).border_color(t.border))
      .child(div().w(64).flex_none().pt(1).text_size(11.5).font_semibold().text_color(label === "Filter" ? t.mongo : t.muted).child(label))
      .child(div().id(`q-${label}`).flex_1().min_w(0).overflow_scroll().font_family(t.mono).text_size(12.5).child(shellLine(value, t)))))
    .when(tail.length > 0, (e) => e.child(h_flex().w_full().px(10).h(30).gap(16).items_center().border_t(1).border_color(t.border)
      .children(tail.map(([label, value]) => h_flex().gap(8).items_center()
        .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(label))
        .child(div().font_family(t.mono).text_size(12.5).text_color(t.syn.num).child(String(value)))))));
}

function pipeline(stages, t) {
  return v_flex().w_full().gap(6).children((stages ?? []).map((stage, k) => {
    const [name] = Object.keys(stage ?? {});
    return h_flex().w_full().gap(10).items_start()
      .child(div().size(22).flex_none().rounded(11).bg(t.raised).flex().items_center().justify_center().text_size(10.5).text_color(t.muted).child(String(k + 1)))
      .child(v_flex().flex_1().min_w(0).rounded(9).border(1).border_color(t.border).bg(t.background)
        .child(div().px(10).h(28).flex().items_center().border_b(1).border_color(t.border).font_family(t.mono).text_size(12.5).font_semibold().text_color(t.syn.kw).child(name ?? "?"))
        .child(div().px(10).py(8).font_family(t.mono).text_size(12).child(codeLines(shellJS(stage?.[name], 0, 70), t))));
  }));
}

const codeLines = (text, t) => v_flex().children(tokenize(text, "mongo").map((line) => h_flex().min_h(18).child(tokenLine(line, t))));

// ---------- documents ----------

function valueColor(v, t) {
  switch (bsonType(v)) {
    case "ObjectId": return t.bson.oid;
    case "String": return t.bson.str;
    case "Int32": case "Int64": case "Double": case "Decimal128": case "Date": case "Timestamp": return t.bson.num;
    case "Boolean": return t.bson.bool;
    case "Null": return t.bson.nil;
    default: return t.muted;
  }
}

function fieldRows(obj, path, depth, ctx, t, budget = { left: 60 }) {
  const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj ?? {});
  const rows = entries.slice(0, Math.max(0, Math.min(80, budget.left))).flatMap(([key, value]) => {
    if (budget.left <= 0) return [];
    budget.left -= 1;
    const container = isContainer(value);
    const id = `${path}.${key}`;
    const open = container && ctx.ui(`f:${id}`, depth < 1 && JSON.stringify(value).length < 160);
    const row = h_flex().id(`fld-${id}`).w_full().min_h(22).gap(6).items_start().pl(depth * 16).font_family(t.mono).text_size(12.5)
      .when(container, (e) => e.cursor_pointer().rounded(4).hover((s) => s.bg(t.hover)).on_click((_e, cx) => ctx.setUi(`f:${id}`, !open, cx)))
      .child(div().w(12).flex_none().pt(3).child(container ? icon(open ? "chevron-down" : "chevron-right", 11, t.dim) : div()))
      .child(div().flex_none().font_semibold().text_color(Array.isArray(obj) ? t.dim : t.bson.key).child(key))
      .child(div().flex_none().text_color(t.bson.punct).child(":"))
      .child(div().flex_1().min_w(0).text_color(valueColor(value, t)).child(container ? bsonText(value) : bsonText(value).slice(0, 400)));
    return open ? [row, ...fieldRows(value, id, depth + 1, ctx, t, budget)] : [row];
  });
  if (depth === 0 && budget.left <= 0) rows.push(div().pl(18).text_size(11.5).text_color(t.dim).child("필드가 더 있어요 · JSON 보기에서 전체를 볼 수 있어요"));
  return rows;
}

function docCard(doc, k, callId, ctx, t) {
  return v_flex().w_full().px(12).py(10).rounded(9).border(1).border_color(t.border).bg(t.background)
    .children(fieldRows(doc, `${callId}.${k}`, 0, ctx, t));
}

function tableView(docs, t) {
  const cols = columnsOf(docs);
  const cell = (text, color, head = false) => div().w(160).flex_none().px(10).h(30).flex().items_center().border_r(1).border_color(t.border)
    .text_size(12).font_family(head ? undefined : t.mono).text_color(color).when(head, (e) => e.font_semibold()).child(div().truncate().child(text));
  return div().id("mongo-table").w_full().overflow_scroll().rounded(9).border(1).border_color(t.border).bg(t.background)
    .child(v_flex().children([
      h_flex().bg(t.raised).border_b(1).border_color(t.border).children(cols.map((c) => cell(c, t.muted, true))),
      ...docs.slice(0, 50).map((d, r) => h_flex().when(r > 0, (e) => e.border_t(1).border_color(t.border)).children(cols.map((c) => cell(c in d ? bsonText(d[c]) : "—", c in d ? valueColor(d[c], t) : t.dim)))),
    ]));
}

function docsSection(docs, call, ctx, t) {
  const view = ctx.ui("mongo:view", "list");
  const limit = ctx.ui(`docs:${call.id}`, 20);
  return v_flex().w_full().gap(10)
    .child(h_flex().w_full().gap(10).items_center()
      .child(div().flex_1().text_size(12).text_color(t.dim).child(`문서 ${fmtInt(docs.length)}개`))
      .child(segmented(`mview-${call.id}`, [{ id: "list", label: "List", icon: "list" }, { id: "json", label: "JSON", icon: "braces" }, { id: "table", label: "Table", icon: "table" }], view, (v, cx) => ctx.setUi("mongo:view", v, cx), t)))
    .child(view === "json" ? codeView(JSON.stringify(docs, null, 2), "json", t, { id: `docs-json-${call.id}` })
      : view === "table" ? tableView(docs, t)
        : v_flex().w_full().gap(8).children(docs.slice(0, limit).map((d, k) => docCard(d, k, call.id, ctx, t))))
    .when(view === "list" && docs.length > limit, (e) => e.child(h_flex().id(`more-docs-${call.id}`).h(30).justify_center().items_center().rounded(8).cursor_pointer()
      .bg(t.raised).hover((s) => s.bg(t.hover)).text_size(12).text_color(t.accent)
      .on_click((_e, cx) => ctx.setUi(`docs:${call.id}`, limit + 40, cx)).child(`${fmtInt(docs.length - limit)}개 더 보기`)));
}

// ---------- explain ----------

function stageTree(node, depth, t) {
  const bad = node.stage === "COLLSCAN";
  const row = h_flex().w_full().gap(8).items_center().pl(depth * 18).min_h(30)
    .child(div().px(8).h(22).rounded(6).bg(alpha(bad ? t.del : t.accent, 0.14)).text_size(11.5).font_bold().font_family(t.mono).text_color(bad ? t.del : t.accent).flex().items_center().child(node.stage))
    .when(Boolean(node.index), (e) => e.child(chip(`index ${node.index}`, t, t.ansi2)))
    .when(node.returned != null, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`반환 ${fmtInt(node.returned)}`)))
    .when(node.examined != null, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`검사 ${fmtInt(node.examined)}`)));
  return [row, ...node.kids.flatMap((k) => stageTree(k, depth + 1, t))];
}

function explainView(plan, t) {
  const s = plan.stats;
  return v_flex().w_full().gap(10)
    .when(plan.collscan, (e) => e.child(h_flex().gap(8).items_center().px(12).py(8).rounded(8).bg(alpha(t.del, 0.08)).border(1).border_color(alpha(t.del, 0.3))
      .child(icon("alert", 14, t.del)).child(div().text_size(12.5).text_color(t.foreground).child("인덱스 없이 컬렉션 전체를 훑었어요 (COLLSCAN)"))))
    .when(Boolean(s), (e) => e.child(h_flex().gap(10).children([
      ["반환", s.returned], ["문서 검사", s.docs], ["키 검사", s.keys], ["시간", s.ms != null ? `${s.ms}ms` : null],
    ].filter(([, v]) => v != null).map(([k, v]) => v_flex().flex_1().px(12).py(8).rounded(9).bg(t.raised)
      .child(div().text_size(11).text_color(t.dim).child(k)).child(div().text_size(16).font_semibold().text_color(t.foreground).child(typeof v === "number" ? fmtInt(v) : v))))))
    .child(v_flex().w_full().p(10).rounded(9).border(1).border_color(t.border).bg(t.background).children(stageTree(plan.tree, 0, t)));
}

export function renderMongo(call, ctx, t) {
  const p = mcpParts(call.name);
  const input = call.input ?? {};
  const text = call.result?.text ?? "";
  const res = memo(call, "mongo", () => readResult(text));
  const count = /(\d[\d,]*)\s+documents?/.exec(res.summary)?.[1] ?? null;
  const explain = p.tool === "explain" ? memo(call, "explain", () => readExplain(res.data ?? (res.docs.length === 1 ? res.docs[0] : null))) : null;
  const err = call.result?.err;
  return v_flex().w_full().gap(12)
    .child(nsBar(call, t, count ? `${count} documents` : null))
    .child(queryBar(input, t) ?? div())
    .when(Array.isArray(input.pipeline), (e) => e.child(pipeline(input.pipeline, t)))
    .when(Array.isArray(input.documents), (e) => e.child(div().text_size(12).text_color(t.dim).child(`넣을 문서 ${input.documents.length}개`)).child(v_flex().gap(8).children(input.documents.slice(0, 10).map((d, k) => docCard(d, `in${k}`, call.id, ctx, t)))))
    .when(Boolean(err), (e) => e.child(h_flex().gap(8).items_start().px(12).py(9).rounded(8).bg(alpha(t.del, 0.08)).border(1).border_color(alpha(t.del, 0.3))
      .child(icon("circle-x", 14, t.del)).child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(text.slice(0, 1500)))))
    .when(!err && Boolean(res.summary) && !explain && !res.docs.length && !count, (e) => e.child(div().text_size(12.5).text_color(t.muted).child(res.summary)))
    .when(!err && p.tool === "count" && Boolean(count ?? /\d+/.exec(res.summary)), (e) => e.child(div().text_size(34).font_semibold().text_color(t.foreground).child(count ?? /\d[\d,]*/.exec(res.summary)[0])))
    .when(Boolean(explain), (e) => e.child(explainView(explain, t)))
    .when(!err && !explain && res.docs.length > 0, (e) => e.child(docsSection(res.docs, call, ctx, t)))
    .when(!err && !explain && !res.docs.length && res.data !== undefined, (e) => e.child(codeView(JSON.stringify(res.data, null, 2), "json", t, { id: `mdata-${call.id}` })))
    .when(!err && res.rest.length > 0 && !res.docs.length, (e) => e.child(v_flex().gap(2).children(res.rest.slice(0, 60).map((l) => div().text_size(12).font_family(t.mono).text_color(t.muted).child(l)))))
    .when(!call.result, (e) => e.child(div().text_size(12).text_color(ctx.status === "pending" ? t.blocked : t.dim).child(ctx.status === "pending" ? "실행 승인을 기다리고 있어요" : "결과가 아직 없어요")));
}
