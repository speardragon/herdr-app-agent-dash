// Code and diff rows: syntax colors per token, word-level marks inside changed lines,
// line numbers, folds. Long views virtualize inside a fixed-height box, and their tokens
// and word marks are computed only for the rows on screen.

import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { alpha, icon, xScroll } from "./kit.js";
import { lineTokens, markRuns, tokenDoc } from "../lib/highlight.js";
import { wordMarks } from "../lib/diff.js";
import { CUT, fmtInt } from "../lib/format.js";

export const LINE_H = 19;
const VIRTUAL_FROM = 60;
const MAX_H = 560;
const CHAR_W = 7.4;

// Programming fonts join "==", "=>", "!=" into one glyph and gpui has no switch for it;
// a zero-width non-joiner between operator characters keeps each one as typed.
const OPERATOR_PAIR = /([=!<>&|:+\-*/~^%.?#])(?=[=!<>&|:+\-*/~^%.?#])/g;
export const tabs = (s) => s.replace(/\t/g, "    ").replace(OPERATOR_PAIR, "$1\u200C");

// Past this many characters a line is cut: minified JSON or a log line can be 100 KB long,
// and every colored run is an element.
const LINE_CHARS = 600;

// Adjacent tokens of one color become one text run: fewer elements per line.
function runs(tokens, t) {
  const out = [];
  let used = 0;
  let total = 0;
  for (const tok of tokens ?? []) total += tok.t.length;
  for (const tok of tokens ?? []) {
    if (used >= LINE_CHARS) break;
    const text = tok.t.length > LINE_CHARS - used ? tok.t.slice(0, LINE_CHARS - used) : tok.t;
    used += text.length;
    const color = tok.c ? t.syn[tok.c] ?? t.foreground : t.foreground;
    const last = out[out.length - 1];
    if (last && last.color === color && !!last.m === !!tok.m) last.t += text;
    else out.push({ t: text, color, m: tok.m, c: tok.c });
  }
  if (total > used) out.push({ t: `  … ${fmtInt(total - used)}자 더`, color: t.dim, c: "dim" });
  return out;
}

/** One line of tokens; `markBg` colors marked runs (word-level changes). */
export function tokenLine(tokens, t, markBg = null) {
  const parts = runs(tokens, t);
  if (!parts.length) return div().child(" ");
  return h_flex().flex_none().children(parts.map((p) => {
    let el = div().flex_none().whitespace_nowrap().text_color(p.color).child(tabs(p.t));
    if (p.c === "com") el = el.italic();
    if (p.c === "cmd" || p.c === "head" || p.c === "bold") el = el.font_semibold();
    if (p.m && markBg) el = el.bg(markBg).rounded(2);
    return el;
  }));
}

const numCell = (n, width, t, color = null) =>
  div().w(width).flex_none().pr(10).text_right().text_color(color ?? alpha(t.dim, 0.7)).child(n == null ? "" : String(n));

const digitsWidth = (max) => Math.max(2, String(max).length) * 7.5 + 12;

/** A box that scrolls its rows; small sets render directly, large ones virtualize. */
export function rowsBox(id, count, render, t, opts = {}) {
  const height = Math.min(MAX_H, count * LINE_H + 12);
  const base = div().w_full().rounded(8).border(1).border_color(t.border).bg(t.background).font_family(t.mono).text_size(opts.size ?? 12).overflow_hidden();
  if (count < VIRTUAL_FROM) {
    return base.child(xScroll(`${id}-x`, v_flex().min_w_full().pt(6).children(Array.from({ length: count }, (_, i) => render(i)))));
  }
  const width = Math.max(600, opts.width ?? 1200);
  return base.h(height).relative()
    // Both axes here too (see xScroll): the list scrolls itself up and down, this only sideways.
    .child(div().id(`${id}-x`).size_full().overflow_scroll()
      .child(div().h_full().min_w(width).w_full().child(v_virtual_list(id, count, LINE_H, (i) => String(i), (range) =>
        Array.from({ length: range.end - range.start }, (_, k) => render(range.start + k))).size_full().py(6))))
    .child(Scrollbar.vertical(id).absolute().inset_0())
    .child(Scrollbar.horizontal(`${id}-x`).absolute().inset_0());
}

function cutRow(count, numW, t) {
  return h_flex().h(LINE_H).flex_none().w_full().items_center().bg(alpha(t.foreground, 0.03))
    .child(div().w(numW + 3).flex_none())
    .child(icon("fold", 11, t.dim)).child(div().pl(6).text_color(t.dim).text_size(11).child(`${fmtInt(count)}자 생략됨 (기록이 너무 길어요)`));
}

/** Plain code with line numbers. opts: {start, from, to (highlighted range), id}. */
export function codeView(text, lang, t, opts = {}) {
  const doc = tokenDoc(String(text ?? ""), lang);
  const start = opts.start ?? 1;
  const numW = digitsWidth(start + doc.count);
  const render = (i) => {
    const n = start + i;
    const cut = CUT.exec(doc.lines[i] ?? "");
    if (cut) return cutRow(+cut[1], numW, t);
    const inRange = opts.from != null && n >= opts.from && n <= opts.to;
    return h_flex().h(LINE_H).flex_none().w_full().items_center()
      .when(inRange, (e) => e.bg(alpha(t.accent, 0.07)))
      .child(div().w(3).h_full().flex_none().when(inRange, (e) => e.bg(alpha(t.accent, 0.6))))
      .child(numCell(n, numW, t, inRange ? t.muted : null))
      .child(tokenLine(doc.tokens(i), t));
  };
  return rowsBox(opts.id ?? "code", doc.count, render, t, { width: doc.widest * CHAR_W + numW + 40 });
}

const SIGN = { add: "+", del: "−", eq: " " };
const MARK_CACHE = new Map();

// Word marks for a row whose counterpart was noted but not compared yet (large diffs).
function marksOf(row) {
  if (row.marks) return row.marks;
  if (row.pair == null) return null;
  const a = row.side === "a" ? row.text : row.pair;
  const b = row.side === "a" ? row.pair : row.text;
  const key = `${a}\u0000${b}`;
  let hit = MARK_CACHE.get(key);
  if (hit === undefined) {
    hit = wordMarks(a ?? "", b ?? "");
    if (MARK_CACHE.size > 2000) MARK_CACHE.delete(MARK_CACHE.keys().next().value);
    MARK_CACHE.set(key, hit);
  }
  return hit ? (row.side === "a" ? hit.a : hit.b) : null;
}

const LEAD = 90;

// Drops the first `from` characters of a token line, keeping colors.
function sliceTokens(tokens, from) {
  const out = [];
  let pos = 0;
  for (const tok of tokens) {
    const end = pos + tok.t.length;
    if (end > from) out.push({ ...tok, t: pos >= from ? tok.t : tok.t.slice(from - pos) });
    pos = end;
  }
  return out;
}

function rowTokens(row, lang) {
  const tokens = row.tok ?? lineTokens(lang, row.text ?? "");
  const marks = marksOf(row);
  if (!marks || !marks.length) return tokens;
  const marked = markRuns(tokens, marks);
  const first = marks[0][0];
  if (first <= LEAD) return marked;
  // The change sits far right on a long line: show it, with "…" for what was skipped.
  return [{ c: "dim", t: "…" }, ...sliceTokens(marked, first - 30)];
}

function widestOf(items, pick) {
  let w = 20;
  for (let i = 0; i < items.length && i < 5000; i++) w = Math.max(w, pick(items[i]));
  return w;
}

function maxLineNo(items) {
  let n = 1;
  for (const r of items) n = Math.max(n, r.a ?? 0, r.b ?? 0, r.l?.a ?? 0, r.r?.b ?? 0, r.full?.a ?? 0);
  return n;
}

/** Unified diff rows ({t, a, b, text, tok?, marks?}); opts: {id, lang}. */
export function diffView(items, t, opts = {}) {
  const numW = digitsWidth(maxLineNo(items));
  const lang = opts.lang ?? "text";
  const render = (i) => diffRow(items[i], numW, t, lang);
  return rowsBox(opts.id ?? "diff", items.length, render, t, { width: widestOf(items, (r) => (r.text ?? "").length) * CHAR_W + numW * 2 + 60 });
}

function diffRow(r, numW, t, lang) {
  if (r.t === "hunk") {
    return h_flex().h(LINE_H).flex_none().w_full().items_center().bg(alpha(t.accent, 0.08)).text_color(alpha(t.accent, 0.9))
      .child(div().w(numW * 2 + 22).flex_none()).child(div().whitespace_nowrap().child(r.text));
  }
  if (r.t === "fold") {
    return h_flex().h(LINE_H).flex_none().w_full().items_center().bg(alpha(t.foreground, 0.025)).text_color(t.dim)
      .child(div().w(numW * 2 + 6).flex_none()).child(icon("fold", 11, t.dim)).child(div().pl(6).child(`변경 없는 ${fmtInt(r.count)}줄`));
  }
  if (r.t === "note") return h_flex().h(LINE_H).flex_none().w_full().items_center().text_color(t.dim).child(div().w(numW * 2 + 22).flex_none()).child(r.text);
  const color = r.t === "add" ? t.add : r.t === "del" ? t.del : null;
  return h_flex().h(LINE_H).flex_none().w_full().items_center()
    .when(Boolean(color), (e) => e.bg(alpha(color, 0.12)))
    .child(div().w(3).h_full().flex_none().when(Boolean(color), (e) => e.bg(alpha(color, 0.75))))
    .child(numCell(r.a, numW, t)).child(numCell(r.b, numW, t))
    .child(div().w(14).flex_none().text_color(color ?? t.dim).child(SIGN[r.t] ?? " "))
    .child(tokenLine(rowTokens(r, lang), t, color ? alpha(color, 0.38) : null));
}

/** Side-by-side pairs ({l, r} | {full}); opts: {id, lang}. */
export function splitView(pairs, t, opts = {}) {
  const numW = digitsWidth(maxLineNo(pairs));
  const lang = opts.lang ?? "text";
  const side = (row, which) => {
    if (!row) return div().flex_1().min_w(0).h_full().bg(alpha(t.foreground, 0.025));
    const n = which === "l" ? row.a : row.b;
    const color = row.t === "add" ? t.add : row.t === "del" ? t.del : null;
    return h_flex().flex_1().min_w(0).h_full().items_center().overflow_hidden()
      .when(Boolean(color), (e) => e.bg(alpha(color, 0.12)))
      .child(numCell(n, numW, t))
      .child(tokenLine(rowTokens(row, lang), t, color ? alpha(color, 0.38) : null));
  };
  const render = (i) => {
    const p = pairs[i];
    if (p.full) return diffRow(p.full, numW, t, lang);
    return h_flex().h(LINE_H).flex_none().w_full()
      .child(side(p.l, "l")).child(div().w(1).h_full().bg(t.border)).child(side(p.r, "r"));
  };
  return rowsBox(opts.id ?? "split", pairs.length, render, t, {});
}
