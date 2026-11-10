// Line diffs with word-level marks: from two texts (LCS), from Claude's structuredPatch
// hunks, or from a unified diff (Codex). Rows carry syntax tokens for the views.

import { tokenize } from "./highlight.js";

// Myers' O(ND) diff: fast when two texts are mostly alike, which is what an agent's edits are.
// Past MAX_D edits the texts are too different to align usefully; the middle becomes del+add.
const MAX_D = 2500;

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    trace.push(v.slice(max - d, max + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, d);
    }
  }
  return null;
}

function backtrack(trace, n, m, last) {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = last; d > 0; d--) {
    const v = trace[d];
    const at = (k) => v[k + d];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ t: "eq", a: --x, b: --y });
    if (down) ops.push({ t: "add", b: --y });
    else ops.push({ t: "del", a: --x });
  }
  while (x > 0 && y > 0) ops.push({ t: "eq", a: --x, b: --y });
  return ops.reverse();
}

/** Edit script between two arrays; common ends are matched first so big files stay cheap. */
export function lcsOps(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let post = 0;
  while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
  const midA = a.slice(pre, a.length - post);
  const midB = b.slice(pre, b.length - post);
  const ops = [];
  for (let k = 0; k < pre; k++) ops.push({ t: "eq", a: k, b: k });
  const mid = myers(midA, midB) ?? [...midA.map((_, k) => ({ t: "del", a: k })), ...midB.map((_, k) => ({ t: "add", b: k }))];
  for (const o of mid) ops.push(o.t === "eq" ? { t: "eq", a: o.a + pre, b: o.b + pre } : o.t === "del" ? { t: "del", a: o.a + pre } : { t: "add", b: o.b + pre });
  for (let k = 0; k < post; k++) ops.push({ t: "eq", a: a.length - post + k, b: b.length - post + k });
  return ops;
}

// Words in any script (한글 words stay whole), runs of spaces, or single punctuation marks.
const splitWords = (s) => s.match(/\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu) || [];

/** Character ranges that changed between two similar lines, or null when they barely match. */
export function wordMarks(aText, bText) {
  const a = splitWords(aText);
  const b = splitWords(bText);
  if (a.length + b.length > 6000) return null;
  const ops = lcsOps(a, b);
  const same = ops.filter((o) => o.t === "eq").reduce((acc, o) => acc + a[o.a].length, 0);
  if (same / Math.max(1, aText.length, bText.length) < 0.35) return null;
  const build = (side) => {
    const out = [];
    let pos = 0;
    for (const o of ops) {
      const tok = o.t === "add" ? b[o.b] : a[o.a];
      if (o.t === "eq") {
        pos += tok.length;
      } else if ((side === "a" && o.t === "del") || (side === "b" && o.t === "add")) {
        const last = out[out.length - 1];
        if (last && last[1] === pos) last[1] += tok.length;
        else out.push([pos, pos + tok.length]);
        pos += tok.length;
      }
    }
    const text = side === "a" ? aText : bText;
    return out.filter(([s, e]) => text.slice(s, e).trim());
  };
  return { a: build("a"), b: build("b") };
}

// Above this many rows, tokens and word marks are left to the view (visible rows only).
// Kept small: whole-file tokenizing happens inside a render, and even a 250-line file
// takes longer there than a frame is allowed (the view then stops updating).
export const EAGER_ROWS = 60;

// Pairs each run of deletions with the additions right after it, for word marks.
// Large diffs only note the counterpart line; the view marks it when the row is on screen.
function pairRuns(rows, textOf) {
  const lazy = rows.length > EAGER_ROWS;
  let k = 0;
  while (k < rows.length) {
    if (rows[k].t !== "del") {
      k++;
      continue;
    }
    const dels = [];
    while (k < rows.length && rows[k].t === "del") dels.push(k++);
    const adds = [];
    while (k < rows.length && rows[k].t === "add") adds.push(k++);
    for (let p = 0; p < Math.min(dels.length, adds.length); p++) {
      if (lazy) {
        rows[dels[p]] = { ...rows[dels[p]], pair: textOf(rows[adds[p]]), side: "a" };
        rows[adds[p]] = { ...rows[adds[p]], pair: textOf(rows[dels[p]]), side: "b" };
        continue;
      }
      const marks = wordMarks(textOf(rows[dels[p]]), textOf(rows[adds[p]]));
      if (marks) {
        rows[dels[p]] = { ...rows[dels[p]], marks: marks.a };
        rows[adds[p]] = { ...rows[adds[p]], marks: marks.b };
      }
    }
  }
  return rows;
}

const linesOf = (text) => (text === "" || text == null ? [] : String(text).split("\n"));

/** Whole before/after texts -> rows {t: eq|add|del, a, b, tok, marks}. Numbers are 1-based. */
export function diffRows(before, after, lang = "text", startA = 1, startB = 1) {
  const aL = linesOf(before);
  const bL = linesOf(after);
  const eager = aL.length + bL.length <= EAGER_ROWS;
  const aTok = eager ? tokenize(before ?? "", lang) : [];
  const bTok = eager ? tokenize(after ?? "", lang) : [];
  const rows = lcsOps(aL, bL).map((o) =>
    o.t === "eq" ? { t: "eq", a: o.a + startA, b: o.b + startB, text: bL[o.b], tok: bTok[o.b] }
      : o.t === "del" ? { t: "del", a: o.a + startA, b: null, text: aL[o.a], tok: aTok[o.a] }
        : { t: "add", a: null, b: o.b + startB, text: bL[o.b], tok: bTok[o.b] });
  return pairRuns(rows, (r) => r.text);
}

// Shared by patch and unified-diff readers: hunk line arrays (" x", "-x", "+x") -> rows.
function hunkRows(hunks, lang) {
  const rows = [];
  for (const h of hunks) {
    rows.push({ t: "hunk", text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.title ? ` ${h.title}` : ""}` });
    const oldText = h.lines.filter((l) => l[0] !== "+").map((l) => l.slice(1)).join("\n");
    const newText = h.lines.filter((l) => l[0] !== "-").map((l) => l.slice(1)).join("\n");
    const eager = h.lines.length <= EAGER_ROWS;
    const oldTok = eager ? tokenize(oldText, lang) : [];
    const newTok = eager ? tokenize(newText, lang) : [];
    let a = h.oldStart;
    let b = h.newStart;
    let ia = 0;
    let ib = 0;
    for (const line of h.lines) {
      const mark = line[0];
      const text = line.slice(1);
      if (mark === "-") rows.push({ t: "del", a: a++, b: null, text, tok: oldTok[ia++] });
      else if (mark === "+") rows.push({ t: "add", a: null, b: b++, text, tok: newTok[ib++] });
      else if (mark === "\\") rows.push({ t: "note", text: line });
      else {
        rows.push({ t: "eq", a: a++, b: b++, text, tok: newTok[ib++] });
        ia++;
      }
    }
  }
  return pairRuns(rows, (r) => r.text);
}

/** Claude's structuredPatch: [{oldStart, oldLines, newStart, newLines, lines}]. */
export const patchRows = (hunks, lang = "text") => hunkRows(Array.isArray(hunks) ? hunks : [], lang);

/** A unified diff body ("@@ -a,b +c,d @@" sections) -> hunks. */
export function parseUnified(text) {
  const hunks = [];
  let cur = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (m) {
      cur = { oldStart: +m[1], oldLines: m[2] == null ? 1 : +m[2], newStart: +m[3], newLines: m[4] == null ? 1 : +m[4], title: m[5], lines: [] };
      hunks.push(cur);
    } else if (cur && /^[ +\-\\]/.test(line)) {
      cur.lines.push(line);
    } else if (cur && line === "") {
      cur.lines.push(" ");
    }
  }
  // A trailing empty context line comes from the final newline, not the file.
  for (const h of hunks) if (h.lines.length && h.lines[h.lines.length - 1] === " ") h.lines.pop();
  return hunks;
}

export const unifiedRows = (text, lang = "text") => hunkRows(parseUnified(text), lang);

/** Codex's patch language ("*** Update File: x", "@@", "+", "-") -> [{op, path, hunks}]. */
export function patchFiles(patch) {
  const files = [];
  let cur = null;
  for (const line of String(patch ?? "").split("\n")) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (m) {
      cur = { op: m[1].toLowerCase(), path: m[2].trim(), lines: [] };
      files.push(cur);
    } else if (cur && !/^\*\*\* (Begin|End) Patch|^\*\*\* Move to:/.test(line)) {
      cur.lines.push(line);
    }
  }
  return files;
}

export function rowStats(rows) {
  let add = 0;
  let del = 0;
  for (const r of rows) {
    if (r.t === "add") add++;
    else if (r.t === "del") del++;
  }
  return { add, del };
}

export function textStats(before, after) {
  const ops = lcsOps(linesOf(before), linesOf(after));
  return { add: ops.filter((o) => o.t === "add").length, del: ops.filter((o) => o.t === "del").length };
}

/** Context around changes stays; long unchanged runs become one fold item. */
export function foldRows(rows, context = 3, open = new Set()) {
  const changed = rows.map((r) => r.t === "add" || r.t === "del");
  const near = rows.map((r, i) => {
    if (r.t === "hunk" || r.t === "note") return true;
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return false;
  });
  const items = [];
  let i = 0;
  let fold = 0;
  while (i < rows.length) {
    if (near[i]) {
      items.push(rows[i++]);
      continue;
    }
    const run = [];
    while (i < rows.length && !near[i]) run.push(rows[i++]);
    const key = `f${fold++}`;
    if (open.has(key) || run.length <= 2) items.push(...run);
    else items.push({ t: "fold", key, count: run.length, from: run[0].b ?? run[0].a });
  }
  return items;
}

/** Side-by-side pairs for a split view: [{l, r}] where each side is a row or null. */
export function splitPairs(rows) {
  const out = [];
  let k = 0;
  while (k < rows.length) {
    const r = rows[k];
    if (r.t !== "del" && r.t !== "add") {
      out.push(r.t === "eq" ? { l: r, r } : { full: r });
      k++;
      continue;
    }
    const dels = [];
    while (k < rows.length && rows[k].t === "del") dels.push(rows[k++]);
    const adds = [];
    while (k < rows.length && rows[k].t === "add") adds.push(rows[k++]);
    for (let p = 0; p < Math.max(dels.length, adds.length); p++) out.push({ l: dels[p] ?? null, r: adds[p] ?? null });
  }
  return out;
}
