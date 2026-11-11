// Any other MCP tool: the server and tool, the arguments as a table, and the result as
// a JSON tree when it is JSON, as Markdown otherwise. Jira issues get a card.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { alpha, chip, icon, segmented } from "../kit.js";
import { codeView } from "../code.js";
import { kvTable, memo } from "./common.js";
import { masked } from "../../lib/tools.js";
import { jiraTool } from "../../lib/jira.js";
import { notionTool } from "../../lib/notion.js";
import { slackTool } from "../../lib/slack.js";
import { drawJira, prepareJira } from "./jira.js";
import { drawNotion, prepareNotion } from "./notion.js";
import { drawSlack, prepareSlack } from "./slack.js";
import { gmailTool } from "../../lib/gmail.js";
import { gcalTool } from "../../lib/gcal.js";
import { gsheetsTool } from "../../lib/gsheets.js";
import { drawGmail, prepareGmail } from "./gmail.js";
import { drawGcal, prepareGcal } from "./gcal.js";
import { drawGsheets, prepareGsheets } from "./gsheets.js";

const PRODUCTS = [[prepareJira, drawJira], [prepareNotion, drawNotion], [prepareSlack, drawSlack], [prepareGmail, drawGmail], [prepareGcal, drawGcal], [prepareGsheets, drawGsheets]];

function prepareProduct(call) {
  for (const [prepare, draw] of PRODUCTS) {
    try {
      const view = prepare(call);
      if (view) return { view, draw };
    } catch {
      // Not readable as this product's data: try the next, then the generic view.
    }
  }
  return null;
}

// Jira, Notion and Slack calls are drawn the way those sites look; anything they can't read
// (an error, an unknown format) falls through to the generic view.
// Parsing runs outside the render pass (ctx.request): a long page's Markdown takes longer
// than a frame is allowed, and a view that can't finish its frame stops updating.
function productView(call, ctx, t) {
  const key = `product:${call.id}:${Boolean(call.result)}`;
  const state = ctx.request ? ctx.request(key, async () => prepareProduct(call)) : { state: "ready", value: memo(call, key, () => prepareProduct(call)) };
  if (state.state === "loading") return div().w_full().py(18).text_size(12).text_color(t.dim).child("사이트 모양으로 그리는 중이에요…");
  if (state.state !== "ready" || !state.value) return null;
  try {
    return state.value.draw(state.value.view, call, ctx);
  } catch {
    return null;
  }
}

function tryJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const JSON_COLOR = (v, t) => (typeof v === "string" ? t.syn.str : typeof v === "number" ? t.syn.num : typeof v === "boolean" || v === null ? t.syn.kw : t.muted);

// `budget.left` caps the rows of one tree: a 9,000-row spreadsheet dump stays readable and cheap.
function jsonTree(value, path, depth, ctx, t, budget = { left: 220 }) {
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value ?? {});
  const rows = entries.slice(0, Math.max(0, Math.min(120, budget.left))).flatMap(([key, v]) => {
    if (budget.left <= 0) return [];
    budget.left -= 1;
    const container = v && typeof v === "object";
    const id = `${path}.${key}`;
    const open = container && ctx.ui(`j:${id}`, depth < 1);
    const summary = container ? (Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`) : typeof v === "string" ? `"${v}"` : String(v);
    const row = h_flex().id(`j-${id}`).w_full().min_h(21).gap(6).items_start().pl(depth * 16).font_family(t.mono).text_size(12)
      .when(container, (e) => e.cursor_pointer().rounded(4).hover((s) => s.bg(t.hover)).on_click((_e, cx) => ctx.setUi(`j:${id}`, !open, cx)))
      .child(div().w(12).flex_none().pt(3).child(container ? icon(open ? "chevron-down" : "chevron-right", 11, t.dim) : div()))
      .child(div().flex_none().text_color(t.syn.key).child(key))
      .child(div().flex_none().text_color(t.dim).child(":"))
      .child(div().flex_1().min_w(0).text_color(JSON_COLOR(v, t)).child(masked(summary).slice(0, 600)));
    return open ? [row, ...jsonTree(v, id, depth + 1, ctx, t, budget)] : [row];
  });
  if (depth === 0 && budget.left <= 0) rows.push(div().pt(6).text_size(11.5).text_color(t.dim).child("더 있는 항목은 원본에서 보세요"));
  return rows;
}

function jiraCard(issue, t) {
  const f = issue.fields ?? {};
  return v_flex().w_full().p(14).gap(8).rounded(10).border(1).border_color(t.border).bg(t.background)
    .child(h_flex().gap(8).items_center()
      .child(div().text_size(12).font_semibold().text_color(t.accent).child(issue.key))
      .when(Boolean(f.issuetype?.name), (e) => e.child(chip(f.issuetype.name, t)))
      .when(Boolean(f.status?.name), (e) => e.child(chip(f.status.name, t, t.ansi4)))
      .when(Boolean(f.priority?.name), (e) => e.child(chip(f.priority.name, t))))
    .child(div().text_size(14).font_semibold().text_color(t.foreground).child(f.summary ?? ""))
    .child(h_flex().gap(12).text_size(11.5).text_color(t.dim)
      .when(Boolean(f.assignee?.displayName), (e) => e.child(div().child(`담당 ${f.assignee.displayName}`)))
      .when(Boolean(f.reporter?.displayName), (e) => e.child(div().child(`보고 ${f.reporter.displayName}`))));
}

export function renderMcp(call, ctx, t) {
  const entries = Object.entries(call.input ?? {}).filter(([, v]) => v !== "" && v != null);
  const text = call.result?.text ?? "";
  const data = memo(call, "json", () => tryJson(text));
  const shown = memo(call, "masked", () => masked(data !== undefined ? JSON.stringify(data, null, 2) : text));
  const view = ctx.ui(`mcp:${call.id}`, "pretty");
  const known = jiraTool(call.name) || notionTool(call.name) || slackTool(call.name) || gmailTool(call.name) || gcalTool(call.name) || gsheetsTool(call.name);
  const product = !known || view === "raw" || call.result?.err ? null : productView(call, ctx, t);
  if (product) {
    return v_flex().w_full().gap(10)
      .child(h_flex().w_full().items_center().gap(8)
        .child(div().flex_1().text_size(11.5).text_color(t.dim).child("사이트에서 보이는 모양으로 그렸어요"))
        .child(segmented(`mcpv-${call.id}`, [{ id: "pretty", label: "사이트 모양" }, { id: "raw", label: "원본" }], view, (v, cx) => ctx.setUi(`mcp:${call.id}`, v, cx), t)))
      .child(product);
  }
  // Jira: an issue, a search (issues[] or Rovo's issues.nodes[]).
  const issues = data && (Array.isArray(data.issues) ? data.issues : Array.isArray(data.issues?.nodes) ? data.issues.nodes : data.key && data.fields ? [data] : null);
  let body;
  if (!text) body = div().text_size(12).text_color(t.dim).child(call.result ? "결과가 비어 있어요" : ctx.status === "pending" ? "실행 승인을 기다리고 있어요" : "결과가 아직 없어요");
  else if (view === "raw") body = codeView(shown, data !== undefined ? "json" : "text", t, { id: `mcp-raw-${call.id}` });
  else if (issues?.length) body = v_flex().w_full().gap(8).children(issues.slice(0, 30).map((i) => jiraCard(i, t)));
  else if (data !== undefined) body = v_flex().w_full().p(10).rounded(9).border(1).border_color(t.border).bg(t.background).children(jsonTree(data, call.id, 0, ctx, t));
  else body = div().w_full().p(14).rounded(10).border(1).border_color(t.border).bg(t.background).text_size(13)
    .child(TextView.markdown(`mcp-${call.id}`, shown).selectable(true).on_link_click((url, cx) => ctx.openUrl(url, cx)));
  return v_flex().w_full().gap(12)
    .when(entries.length > 0, (e) => e.child(kvTable(entries, t)))
    .child(h_flex().w_full().items_center().gap(8)
      .child(div().flex_1().text_size(11.5).font_semibold().text_color(t.dim).child("결과"))
      .when(Boolean(text), (e) => e.child(segmented(`mcpv-${call.id}`, [{ id: "pretty", label: "요약" }, { id: "raw", label: "원본" }], view, (v, cx) => ctx.setUi(`mcp:${call.id}`, v, cx), t))))
    .when(Boolean(call.result?.err), (e) => e.child(div().px(10).py(6).rounded(7).bg(alpha(t.del, 0.08)).text_size(12).text_color(t.del).child("도구가 오류를 돌려줬어요")))
    .child(body);
}
