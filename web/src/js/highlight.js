// Syntax highlighting, ANSI colours and a compact Markdown renderer.
// Tokens keep multi-line comments and strings right, then split per line.

// The lexer is the mod's (lib/highlight.js): same {c, t} tokens, one implementation.
const tokenize = (code, lang) => LH.tokenize(code, lang);

const tokSpan = (c, text) => (c ? `<span class="tk-${c}">${esc(text)}</span>` : esc(text));

// marks: sorted, non-overlapping [start, end) character ranges to wrap in <mark>.
function lineHTML(tokens, marks = null) {
  if (!marks || !marks.length) return tokens.map((t) => tokSpan(t.c, t.t)).join("");
  let out = "";
  let pos = 0;
  for (const tok of tokens) {
    const start = pos;
    const end = pos + tok.t.length;
    const cuts = [start, end];
    for (const [ms, me] of marks) {
      if (ms > start && ms < end) cuts.push(ms);
      if (me > start && me < end) cuts.push(me);
    }
    const sorted = uniq(cuts).sort((a, b) => a - b);
    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k];
      const b = sorted[k + 1];
      const piece = tok.t.slice(a - start, b - start);
      const marked = marks.some(([ms, me]) => a >= ms && b <= me);
      const span = tokSpan(tok.c, piece);
      out += marked ? `<mark>${span}</mark>` : span;
    }
    pos = end;
  }
  return out;
}

const hl = (code, lang) => tokenize(code, lang).map((line) => lineHTML(line));
const hlInline = (code, lang) => raw(hl(code, lang).join("\n"));

// ---------- ANSI SGR -> spans ----------
function ansiToHtml(text) {
  const state = { b: false, d: false, fg: null, bg: null };
  let out = "";
  const re = /\x1b\[([\d;]*)m/g;
  let last = 0;
  const open = () => {
    const cls = [state.b && "a-b", state.d && "a-d", state.fg && `a-${state.fg}`, state.bg && `a-${state.bg}`].filter(Boolean);
    return cls.length ? `<span class="${cls.join(" ")}">` : "<span>";
  };
  const emit = (s) => {
    if (s) out += `${open()}${esc(s)}</span>`;
  };
  let m;
  while ((m = re.exec(text))) {
    emit(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = (m[1] || "0").split(";").map(Number);
    for (const c of codes) {
      if (c === 0) Object.assign(state, { b: false, d: false, fg: null, bg: null });
      else if (c === 1) state.b = true;
      else if (c === 2) state.d = true;
      else if (c === 22) Object.assign(state, { b: false, d: false });
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) state.fg = c;
      else if (c === 39) state.fg = null;
      else if (c >= 40 && c <= 47) state.bg = c;
      else if (c === 49) state.bg = null;
    }
  }
  emit(text.slice(last));
  return out;
}

const stripAnsi = (s) => s.replace(/\x1b\[[\d;]*m/g, "");

// ---------- Markdown ----------
const URL_RE = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/g;

function mdInline(src, ctx = {}) {
  // Protect inline code first.
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  const linkTag = (label, url) => {
    let sup = "";
    if (ctx.numbers) {
      if (!ctx.numbers.has(url)) ctx.numbers.set(url, ctx.numbers.size + 1);
      sup = `<sup>${ctx.numbers.get(url)}</sup>`;
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>${sup}`;
  };
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => linkTag(label, url));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (m, pre, url) => (m.includes("href=") ? m : `${pre}${linkTag(url, url)}`));
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

// -> [{html, from, to}] with 1-based source line numbers, so callers can mark a read range.
function mdBlocks(text, ctx = {}) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  const push = (htmlStr, from, to) => blocks.push({ html: htmlStr, from: from + 1, to: to + 1 });
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const start = i;
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      const lang = fence[1] === "sh" ? "bash" : fence[1] || "text";
      push(`<pre><code>${hl(body.join("\n"), lang).join("\n")}</code></pre>`, start, i - 1);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      push(`<h${h[1].length}>${mdInline(h[2], ctx)}</h${h[1].length}>`, i, i);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      push("<hr>", i, i);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const start = i;
      const body = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      push(`<blockquote>${mdInline(body.join(" "), ctx)}</blockquote>`, start, i - 1);
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const start = i;
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      const th = head.map((c) => `<th>${mdInline(c, ctx)}</th>`).join("");
      const tb = rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c, ctx)}</td>`).join("")}</tr>`).join("");
      push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`, start, i - 1);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const start = i;
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      const lis = items
        .map((it) => {
          const task = it.match(/^\[( |x)\]\s+(.*)$/i);
          if (task) {
            const on = task[1].toLowerCase() === "x";
            return `<li class="task${on ? " on" : ""}"><span class="cbx">${on ? icon("check", 11).s : ""}</span><span class="tlbl">${mdInline(task[2], ctx)}</span></li>`;
          }
          return `<li>${mdInline(it, ctx)}</li>`;
        })
        .join("");
      push(ordered ? `<ol>${lis}</ol>` : `<ul>${lis}</ul>`, start, i - 1);
      continue;
    }
    const start = i;
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s+|\s*\|)/.test(lines[i])
    )
      para.push(lines[i++]);
    if (!para.length) {
      push(`<p>${mdInline(lines[i], ctx)}</p>`, i, i);
      i++;
      continue;
    }
    push(`<p>${mdInline(para.join(" "), ctx)}</p>`, start, i - 1);
  }
  return blocks;
}

const md = (text, ctx = {}) => raw(`<div class="md">${mdBlocks(text, ctx).map((b) => b.html).join("")}</div>`);
