// Search tools: Grep (the regex as a capsule, matches grouped by file with the hits marked),
// Glob (files as a folder tree), ToolSearch (which deferred tools it loaded).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { alpha, chip, icon } from "../kit.js";
import { LINE_H, tokenLine } from "../code.js";
import { markRuns, tokenize } from "../../lib/highlight.js";
import { fmtInt } from "../../lib/format.js";
import { baseName, dirName, langOf } from "../../lib/paths.js";

function capsule(text, lang, t, label) {
  return h_flex().gap(8).items_center().min_w(0)
    .child(div().flex_none().text_size(11).text_color(t.dim).child(label))
    .child(h_flex().min_w(0).px(10).h(28).items_center().rounded(7).bg(t.background).border(1).border_color(t.input).font_family(t.mono).text_size(12.5)
      .when(lang === "regex", (e) => e.child(div().text_color(t.dim).child("/")))
      .child(tokenLine(tokenize(text, lang)[0] ?? [], t))
      .when(lang === "regex", (e) => e.child(div().text_color(t.dim).child("/"))));
}

function matchRanges(text, re) {
  if (!re) return null;
  const out = [];
  re.lastIndex = 0;
  let m;
  let guard = 0;
  while ((m = re.exec(text)) && guard++ < 50) {
    if (!m[0].length) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out.length ? out : null;
}

function safeRegex(pattern, flags) {
  try {
    return new RegExp(pattern, `g${flags}`);
  } catch {
    return null;
  }
}

// "path:12:text" (match) or "path-12-text" (context) -> {path, line, text, ctx}.
function parseContent(content) {
  const out = [];
  for (const raw of String(content ?? "").split("\n")) {
    const m = /^(.+?)([:-])(\d+)\2(.*)$/.exec(raw);
    if (m) out.push({ path: m[1], ctx: m[2] === "-", line: +m[3], text: m[4] });
    else if (raw === "--") out.push({ gap: true });
    else if (raw.trim()) out.push({ path: null, text: raw });
  }
  return out;
}

// At most `max` rows across groups: a long grep is read from the top, not drawn whole.
function capRows(groups, max) {
  const out = [];
  let left = max;
  for (const g of groups) {
    if (left <= 0) break;
    out.push({ ...g, rows: g.rows.slice(0, left) });
    left -= g.rows.length;
  }
  return out;
}

function fileHead(path, count, ctx, t) {
  return h_flex().w_full().gap(8).items_center().px(10).h(28).bg(alpha(t.foreground, 0.03)).border_b(1).border_color(t.border)
    .child(icon("file-text", 12, t.muted))
    .child(div().flex_none().text_size(12).text_color(t.foreground).child(baseName(path)))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dirName(ctx.rel(path))))
    .when(count != null, (e) => e.child(chip(`${count}`, t)));
}

export function renderGrep(call, ctx, t) {
  const input = call.input ?? {};
  const x = call.result?.extra ?? {};
  const flags = [input["-i"] ? "i" : "", input.multiline ? "s" : ""].join("");
  const re = safeRegex(input.pattern ?? "", flags);
  const opts = [input["-i"] && "대소문자 무시", input.multiline && "여러 줄", input.glob && `glob ${input.glob}`, input.type && `type ${input.type}`, input.output_mode && input.output_mode, input.head_limit && `상위 ${input.head_limit}`].filter(Boolean);
  const top = v_flex().gap(8)
    .child(capsule(input.pattern ?? "", "regex", t, "패턴"))
    .child(h_flex().gap(6).flex_wrap().items_center()
      .when(Boolean(input.path), (e) => e.child(chip(`in ${ctx.rel(input.path)}`, t)))
      .children(opts.map((o) => chip(o, t))));
  if (x.mode === "content" || (x.content && !x.filenames?.length)) {
    const rows = parseContent(x.content);
    const groups = [];
    for (const r of rows) {
      if (r.gap) continue;
      const g = groups[groups.length - 1];
      if (g && g.path === r.path) g.rows.push(r);
      else groups.push({ path: r.path, rows: [r] });
    }
    return v_flex().w_full().gap(12).child(top)
      .child(div().text_size(11.5).text_color(t.dim).child(`${fmtInt(rows.filter((r) => !r.ctx && !r.gap).length)}곳 · 파일 ${groups.length}개`))
      .children(capRows(groups, 160).map((g) => v_flex().w_full().rounded(8).border(1).border_color(t.border).overflow_hidden().bg(t.background)
        .child(g.path ? fileHead(g.path, g.rows.filter((r) => !r.ctx).length, ctx, t) : div())
        .child(v_flex().py(4).font_family(t.mono).text_size(12).children(g.rows.map((r) => {
          const tokens = tokenize(r.text, langOf(g.path ?? ""))[0] ?? [];
          const marks = r.ctx ? null : matchRanges(r.text, re);
          return h_flex().h(LINE_H).items_center().when(!r.ctx, (e) => e.bg(alpha(t.ansi3, 0.05)))
            .child(div().w(46).flex_none().pr(10).text_right().text_color(r.ctx ? alpha(t.dim, 0.6) : t.ansi3).child(r.line ? String(r.line) : ""))
            .child(tokenLine(marks ? markRuns(tokens, marks) : tokens, t, alpha(t.ansi3, 0.35)).when(Boolean(r.ctx), (e) => e.opacity(0.6)));
        })))));
  }
  const files = x.filenames ?? [];
  return v_flex().w_full().gap(12).child(top)
    .child(div().text_size(11.5).text_color(t.dim).child(x.mode === "count" ? "파일별 개수" : `파일 ${fmtInt(x.numFiles ?? files.length)}개`))
    .child(fileList(files, ctx, t))
    .when(!files.length && Boolean(call.result?.text), (e) => e.child(div().text_size(12).text_color(t.muted).child(call.result.text.slice(0, 2000))));
}

function fileList(files, ctx, t) {
  return v_flex().w_full().rounded(8).border(1).border_color(t.border).bg(t.background).py(4).children(files.slice(0, 200).map((f) =>
    h_flex().h(24).px(10).gap(8).items_center()
      .child(icon("file", 12, t.dim))
      .child(div().flex_none().text_size(12).text_color(t.foreground).child(baseName(f)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dirName(ctx.rel(f))))));
}

export function renderGlob(call, ctx, t) {
  const input = call.input ?? {};
  const x = call.result?.extra ?? {};
  const files = x.filenames ?? String(call.result?.text ?? "").split("\n").filter((l) => l.startsWith("/"));
  return v_flex().w_full().gap(12)
    .child(capsule(input.pattern ?? "", "glob", t, "패턴"))
    .child(h_flex().gap(6).items_center()
      .when(Boolean(input.path), (e) => e.child(chip(`in ${ctx.rel(input.path)}`, t)))
      .child(chip(`${fmtInt(x.numFiles ?? files.length)}개 파일`, t))
      .when(Boolean(x.truncated), (e) => e.child(chip("잘림", t, t.blocked))))
    .child(fileList(files, ctx, t));
}

export function renderToolSearch(call, ctx, t) {
  const x = call.result?.extra ?? {};
  const matches = x.matches ?? [];
  return v_flex().w_full().gap(10)
    .child(capsule(call.input?.query ?? "", "text", t, "검색"))
    .child(h_flex().gap(6).flex_wrap().children(matches.map((m) => chip(typeof m === "string" ? m : m.name ?? JSON.stringify(m), t, t.accent))))
    .when(!matches.length, (e) => e.child(div().text_size(12).text_color(t.dim).child(call.result?.text?.slice(0, 600) ?? "")));
}
