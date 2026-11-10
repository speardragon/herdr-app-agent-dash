// The detail of one tool call: a common header, then the tool's own view, then the raw
// input/output on demand. Each tool family has its renderer module.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { alpha, chip, icon, kindColor, mongoLeaf, pill, segmented } from "../kit.js";
import { codeView } from "../code.js";
import { KINDS, isMongo, kindOf, masked, mcpParts, serverLabel, toolTarget, toolTitle } from "../../lib/tools.js";
import { clockSec, fmtDur } from "../../lib/format.js";
import { renderShell } from "./shell.js";
import { renderEdit, renderRead, renderWrite, renderPatch, renderImageView } from "./files.js";
import { renderGrep, renderGlob, renderToolSearch } from "./search.js";
import { renderWebFetch, renderWebSearch } from "./web.js";
import { renderAgent, renderTodo, renderAsk, renderPlan, renderSkill, renderSleep } from "./agentic.js";
import { renderMongo } from "./mongo.js";
import { renderMcp } from "./mcp.js";
import { kvTable, memo } from "./common.js";

const RENDERERS = {
  Bash: renderShell, exec_command: renderShell, shell: renderShell, exec: renderShell, BashOutput: renderShell,
  Read: renderRead, Edit: renderEdit, MultiEdit: renderEdit, Write: renderWrite, apply_patch: renderPatch, view_image: renderImageView,
  Grep: renderGrep, Glob: renderGlob, ToolSearch: renderToolSearch,
  WebFetch: renderWebFetch, WebSearch: renderWebSearch, web_search: renderWebSearch,
  Agent: renderAgent, Task: renderAgent, TodoWrite: renderTodo, update_plan: renderTodo,
  AskUserQuestion: renderAsk, request_user_input_async: renderAsk, request_user_input: renderAsk,
  ExitPlanMode: renderPlan, Skill: renderSkill, sleep: renderSleep, wait: renderSleep,
};

function rendererFor(call) {
  if (isMongo(call)) return renderMongo;
  if (mcpParts(call.name)) return renderMcp;
  return RENDERERS[call.name] ?? null;
}

const STATUS = {
  ok: { label: "완료", color: (t) => t.ansi2 },
  error: { label: "실패", color: (t) => t.del },
  running: { label: "실행 중", color: (t) => t.working },
  pending: { label: "승인 대기", color: (t) => t.blocked },
  interrupted: { label: "중단됨", color: (t) => t.dim },
  unknown: { label: "결과 없음", color: (t) => t.dim },
};

export function callDuration(call) {
  if (call.result?.extra?.ms) return call.result.extra.ms / 1000;
  if (call.result?.ts && call.ts) return Math.max(0, (call.result.ts - call.ts) / 1000);
  return null;
}

function header(call, ctx, t) {
  const kind = kindOf(call);
  const mongo = isMongo(call);
  const color = kindColor(t, kind, mongo);
  const st = STATUS[ctx.status] ?? STATUS.unknown;
  const dur = callDuration(call);
  const parts = mcpParts(call.name);
  const glyph = mongo ? mongoLeaf(16) : icon(KINDS[kind]?.icon ?? "bot", 15, color);
  return h_flex().w_full().gap(12).items_center()
    .child(div().size(32).flex_none().rounded(8).bg(alpha(color, 0.14)).flex().items_center().justify_center().child(glyph))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(8).items_center().min_w(0)
        .when(Boolean(parts), (e) => e.child(div().flex_none().text_size(12).text_color(t.dim).child(`${serverLabel(parts.server)} ›`)))
        .child(div().flex_none().text_size(14).font_semibold().text_color(t.foreground).child(toolTitle(call)))
        .when(call.side, (e) => e.child(chip("서브에이전트", t)))
        .when(ctx.status === "running", (e) => e.child(icon("spinner", 12, t.working).spin(900))))
      .child(div().truncate().font_family(t.mono).text_size(11.5).text_color(t.dim).child(toolTarget(call, ctx.rel) || " ")))
    .child(v_flex().flex_none().items_end().gap(4)
      .child(pill(st.label, st.color(t), t))
      .child(div().text_size(10.5).text_color(t.dim).child([clockSec(call.ts), dur != null ? fmtDur(dur) : null].filter(Boolean).join(" · "))));
}

// JSON results often arrive minified on one line; spread them out to read and to draw cheaply.
function pretty(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return text ?? "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return text;
  }
}

function rawSection(call, ctx, t) {
  const open = ctx.ui(`raw:${call.id}`, false);
  const input = open ? memo(call, "raw-in", () => masked(JSON.stringify(call.input ?? {}, null, 2))) : "";
  const output = open ? memo(call, "raw-out", () => masked(pretty(call.result?.text) || (call.result?.extra ? JSON.stringify(call.result.extra, null, 2) : ""))) : "";
  return v_flex().w_full().gap(8)
    .child(h_flex().id(`raw-toggle-${call.id}`).gap(6).items_center().cursor_pointer().text_size(11.5).text_color(t.dim).hover((s) => s.text_color(t.muted))
      .on_click((_e, cx) => ctx.setUi(`raw:${call.id}`, !open, cx))
      .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim)).child("원본 입력·출력"))
    .when(open, (e) => e
      .child(div().text_size(11).text_color(t.dim).child("입력 (비밀값은 가림)"))
      .child(codeView(input, "json", t, { id: `raw-in-${call.id}` }))
      .when(Boolean(output), (el) => el.child(div().text_size(11).text_color(t.dim).child("출력")).child(codeView(output, output.trim().startsWith("{") ? "json" : "text", t, { id: `raw-out-${call.id}` }))));
}

/** Generic body: input fields as a table, the result as text. */
export function renderGeneric(call, ctx, t) {
  const entries = Object.entries(call.input ?? {}).filter(([, v]) => v !== "" && v != null);
  const text = memo(call, "gen-text", () => masked(pretty(call.result?.text ?? "")));
  return v_flex().w_full().gap(12)
    .when(entries.length > 0, (e) => e.child(kvTable(entries, t)))
    .when(Boolean(text), (e) => e.child(codeView(text, text.trim().startsWith("{") || text.trim().startsWith("[") ? "json" : "text", t, { id: `gen-${call.id}` })));
}

// Sub-agents this call started (`hc run` inside a shell command): jump to each.
function startedRow(ctx, t) {
  return h_flex().w_full().gap(8).items_center().flex_wrap().px(10).py(8).rounded(8).bg(alpha(t.accent, 0.07))
    .child(icon("workflow", 13, t.accent))
    .child(div().flex_none().text_size(12).text_color(t.muted).child("이 호출이 띄운 하위 에이전트"))
    .children(ctx.started.map((n) => h_flex().id(`started-${n.address}`).flex_none().gap(6).items_center().h(24).px(8).rounded(6).cursor_pointer().bg(t.raised).border(1).border_color(t.border)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => ctx.pickScope(n.address, cx))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(n.title))
      .child(div().text_size(10.5).font_family(t.mono).text_color(t.dim).child(n.address))
      .child(icon("chevron-right", 11, t.dim))));
}

/** ctx: {status, rel, home, cwd, ui(key, def), setUi(key, value, cx), open(path), copy(text, cx), session, started, pickScope} */
export function stageView(call, ctx, t) {
  const render = rendererFor(call) ?? renderGeneric;
  let body;
  try {
    body = render(call, ctx, t);
  } catch (error) {
    body = v_flex().gap(8)
      .child(div().text_size(12).text_color(t.del).child(`이 호출을 그리지 못했어요: ${String(error?.message ?? error)}`))
      .child(renderGeneric(call, ctx, t));
  }
  return v_flex().w_full().gap(16)
    .child(header(call, ctx, t))
    .when(Boolean(ctx.started?.length), (e) => e.child(startedRow(ctx, t)))
    .child(body)
    .child(rawSection(call, ctx, t));
}

export { segmented };
