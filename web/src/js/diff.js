// Line diff (LCS), word-level marks inside paired lines, folded context, unified/split rendering.

// Edit scripts (Myers) and word marks are the mod's lib/diff.js.
const lcsOps = (a, b) => LD.lcsOps(a, b);
const wordMarks = (a, b) => LD.wordMarks(a, b);

// Rows for a whole before/after pair. Line numbers are 1-based and can start later (Edit snippets).
function diffRows(before, after, lang = "text", startA = 1, startB = 1) {
  const aL = before === "" ? [] : before.split("\n");
  const bL = after === "" ? [] : after.split("\n");
  const aTok = tokenize(before, lang);
  const bTok = tokenize(after, lang);
  const ops = lcsOps(aL, bL);
  const rows = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.t === "eq") {
      rows.push({ t: "eq", a: op.a + startA, b: op.b + startB, html: lineHTML(bTok[op.b] || []) });
      k++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (k < ops.length && ops[k].t === "del") dels.push(ops[k++]);
    while (k < ops.length && ops[k].t === "add") adds.push(ops[k++]);
    const pairs = Math.min(dels.length, adds.length);
    const marks = [];
    for (let p = 0; p < pairs; p++) marks.push(wordMarks(aL[dels[p].a], bL[adds[p].b]));
    dels.forEach((d, p) => rows.push({ t: "del", a: d.a + startA, b: null, html: lineHTML(aTok[d.a] || [], marks[p] && marks[p].a), pair: p < pairs }));
    adds.forEach((d, p) => rows.push({ t: "add", a: null, b: d.b + startB, html: lineHTML(bTok[d.b] || [], marks[p] && marks[p].b), pair: p < pairs }));
  }
  return rows;
}

function diffStats(before, after) {
  const rows = lcsOps(before ? before.split("\n") : [], after ? after.split("\n") : []);
  return { add: rows.filter((r) => r.t === "add").length, del: rows.filter((r) => r.t === "del").length };
}

// Visible rows near changes, folds elsewhere, hunk headers at each visible run.
function foldItems(rows, context = 3) {
  const changed = rows.map((r) => r.t !== "eq");
  const near = rows.map((_, i) => {
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return false;
  });
  const items = [];
  let i = 0;
  let foldNo = 0;
  while (i < rows.length) {
    if (near[i]) {
      const run = [];
      while (i < rows.length && near[i]) run.push(rows[i++]);
      const firstA = run.find((r) => r.a != null)?.a ?? 0;
      const firstB = run.find((r) => r.b != null)?.b ?? 0;
      const cntA = run.filter((r) => r.a != null).length;
      const cntB = run.filter((r) => r.b != null).length;
      items.push({ t: "hunk", text: `@@ -${firstA},${cntA} +${firstB},${cntB} @@` });
      items.push(...run);
    } else {
      const run = [];
      while (i < rows.length && !near[i]) run.push(rows[i++]);
      items.push({ t: "fold", rows: run, no: foldNo++ });
    }
  }
  return items;
}

function unifiedRow(r) {
  const mk = r.t === "add" ? "+" : r.t === "del" ? "−" : " ";
  return `<div class="dl ${r.t}"><span class="ln">${r.a ?? ""}</span><span class="ln">${r.b ?? ""}</span><span class="mk">${mk}</span><span class="tx">${r.html || " "}</span></div>`;
}

function foldRowHTML(item, key, label) {
  return `<div class="dl fold"><span class="ln"></span><span class="ln"></span><span class="mk"></span><span class="tx"><button data-action="unfold" data-fold="${esc(key)}">${icon("fold", 12).s} ${label}</button></span></div>`;
}

function renderUnified(items, opts) {
  const out = [];
  for (const it of items) {
    if (it.t === "hunk") {
      if (opts.hunks !== false) out.push(`<div class="dl hunk"><span class="ln"></span><span class="ln"></span><span class="mk"></span><span class="tx">${esc(it.text)}</span></div>`);
    } else if (it.t === "fold") {
      const key = `${opts.foldKey}:${it.no}`;
      if (opts.openFolds && opts.openFolds.has(key)) out.push(...it.rows.map(unifiedRow));
      else out.push(foldRowHTML(it, key, `${it.rows.length}줄 같음 · 펼치기`));
    } else out.push(unifiedRow(it));
  }
  return out.join("");
}

function splitCell(r, side) {
  if (!r) return `<div class="sd ${side} blank"><span class="ln"></span><span class="mk"></span><span class="tx"></span></div>`;
  const no = side === "left" ? r.a : r.b;
  const mk = r.t === "add" ? "+" : r.t === "del" ? "−" : "";
  return `<div class="sd ${side} ${r.t === "eq" ? "" : r.t}"><span class="ln">${no ?? ""}</span><span class="mk">${mk}</span><span class="tx">${r.html || " "}</span></div>`;
}

function renderSplit(items, opts) {
  const out = [];
  const flushBlock = (dels, adds) => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) out.push(splitCell(dels[i], "left") + splitCell(adds[i], "right"));
  };
  const emitRows = (rows) => {
    let dels = [];
    let adds = [];
    for (const r of rows) {
      if (r.t === "del") dels.push(r);
      else if (r.t === "add") adds.push(r);
      else {
        flushBlock(dels, adds);
        dels = [];
        adds = [];
        out.push(splitCell(r, "left") + splitCell(r, "right"));
      }
    }
    flushBlock(dels, adds);
  };
  let pending = [];
  for (const it of items) {
    if (it.t === "hunk" || it.t === "fold") {
      emitRows(pending);
      pending = [];
      if (it.t === "hunk") out.push(`<div class="sd hunk">${esc(it.text)}</div>`);
      else {
        const key = `${opts.foldKey}:${it.no}`;
        if (opts.openFolds && opts.openFolds.has(key)) emitRows(it.rows);
        else out.push(`<div class="sd fold"><button data-action="unfold" data-fold="${esc(key)}">${icon("fold", 12).s} ${it.rows.length}줄 같음 · 펼치기</button></div>`);
      }
    } else pending.push(it);
  }
  emitRows(pending);
  return out.join("");
}

function renderDiff(before, after, opts = {}) {
  const o = { lang: "text", mode: "unified", wrap: false, startA: 1, startB: 1, context: 3, foldKey: "d", ...opts };
  const numbered = diffRows(before, after, o.lang, o.startA, o.startB);
  const rows = o.numbers === false ? numbered.map((r) => ({ ...r, a: null, b: null })) : numbered;
  const items = o.fold === false ? rows : foldItems(rows, o.context);
  const body = o.mode === "split" ? renderSplit(items, o) : renderUnified(items, o);
  return raw(`<div class="diff ${o.mode === "split" ? "diff-split" : ""} ${o.wrap ? "wrap" : ""}"><div class="diff-in">${body}</div></div>`);
}

// A few changed lines for small cards.
function miniDiff(before, after, max = 6) {
  const ops = lcsOps(before.split("\n"), after.split("\n"));
  const a = before.split("\n");
  const b = after.split("\n");
  return ops
    .filter((o) => o.t !== "eq")
    .slice(0, max)
    .map((o) => (o.t === "add" ? { t: "a", text: b[o.b] } : { t: "d", text: a[o.a] }));
}
