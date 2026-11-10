// Rich text for the Jira / Notion / Slack views: Markdown (plus the HTML-ish tags Notion's
// "enhanced Markdown" and Jira's Markdown use) -> blocks of styled runs. Pure; the mod and the
// web page each draw the result in the product's own look.
//
// run:   {text, b, i, s, u, code, href, mention, color}
// block: {t: "h", level, runs} | {t: "p", runs} | {t: "li", ordered, n, depth, runs, todo, checked}
//      | {t: "code", lang, text} | {t: "quote", runs} | {t: "hr"} | {t: "table", header, rows: [[runs]]}
//      | {t: "callout", icon, color, blocks} | {t: "toggle", runs} | {t: "embed", label, href}

const INLINE = [
  [/^\\([\\`*_{}\[\]()#+\-.!~<>|])/, (m) => ({ text: m[1] })],
  [/^`([^`\n]+)`/, (m) => ({ text: m[1], code: true })],
  [/^<code>([\s\S]*?)<\/code>/, (m) => ({ text: unescapeHtml(m[1]), code: true })],
  [/^\*\*([\s\S]+?)\*\*/, (m, st) => inline(m[1], { ...st, b: true })],
  [/^__([\s\S]+?)__/, (m, st) => inline(m[1], { ...st, b: true })],
  [/^<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/, (m, st) => inline(m[1], { ...st, b: true })],
  [/^<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/, (m, st) => inline(m[1], { ...st, i: true })],
  [/^<u>([\s\S]*?)<\/u>/, (m, st) => inline(m[1], { ...st, u: true })],
  [/^<(?:s|del|strike)>([\s\S]*?)<\/(?:s|del|strike)>/, (m, st) => inline(m[1], { ...st, s: true })],
  [/^~~([\s\S]+?)~~/, (m, st) => inline(m[1], { ...st, s: true })],
  [/^\*([^*\s][^*\n]*?)\*(?![\p{L}\p{N}])/u, (m, st) => inline(m[1], { ...st, i: true })],
  [/^_([^_\s][^_\n]*?)_(?![\p{L}\p{N}])/u, (m, st) => inline(m[1], { ...st, i: true })],
  [/^!?\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, (m, st) => inline(m[1] || m[2], { ...st, href: m[2] })],
  [/^<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/, (m, st) => inline(m[2] || m[1], { ...st, href: m[1] })],
  [/^<span\s+color="([^"]*)"[^>]*>([\s\S]*?)<\/span>/, (m, st) => inline(m[2], { ...st, color: m[1] })],
  [/^<span[^>]*>([\s\S]*?)<\/span>/, (m, st) => inline(m[1], st)],
  [/^<mention-(page|database|user|date|data-source)\s+([^>]*?)\/?>(?:([\s\S]*?)<\/mention-\1>)?/, (m, st) => mention(m[1], m[2], m[3], st)],
  [/^<date\s+([^>]*?)\/?>/, (m, st) => [{ ...st, text: attr(m[1], "start") + (attr(m[1], "end") ? ` → ${attr(m[1], "end")}` : ""), mention: "date" }]],
  [/^<br\s*\/?>/, () => ({ text: "\n" })],
  [/^<(https?:\/\/[^>|\s]+)>/, (m, st) => [{ ...st, text: m[1], href: m[1] }]],
  [/^https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/, (m, st) => [{ ...st, text: m[0], href: m[0] }]],
  // Only markup Notion/Jira are known to send is dropped; `<path>` or `Array<string>` is text.
  [/^<\/?(?:p|div|span|li|ul|ol|h[1-6]|td|th|tr|table|tbody|thead|summary|details|empty-block|columns?|unknown|page|database|content|callout|toggle|image|file|video|audio|pdf|synced_block\w*|table[-_]of[-_]contents|colgroup|col|link-preview|data-source|meeting-notes|notes|transcript|font|sup|sub|mark|kbd)(?:\s[^>]*)?\/?>/i, () => []],
];

const attr = (text, name) => new RegExp(`${name}="([^"]*)"`).exec(text)?.[1] ?? "";
const unescapeHtml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function mention(kind, attrs, inner, st) {
  const url = attr(attrs, "url");
  const label = (inner ?? "").trim() || attr(attrs, "title") || attr(attrs, "name") || attr(attrs, "start") || (kind === "user" ? "사용자" : "페이지");
  return [{ ...st, text: kind === "user" ? `@${label}` : label, mention: kind, href: url && !url.startsWith("user://") && !url.startsWith("collection://") ? url : st.href }];
}

// The same patterns, anchored at a position (sticky) so a long text is never re-sliced.
const STICKY = INLINE.map(([re, make]) => [new RegExp(re.source.replace(/^\^/, ""), `${re.flags.replace("y", "")}y`), make]);
const STARTS = /[\\`*_~<!\[h]/g;
const STYLE_KEYS = ["b", "i", "s", "u", "code", "href", "mention", "color"];

/** Inline Markdown/HTML -> runs. Adjacent runs with the same style are merged. */
export function inline(text, style = {}) {
  const out = [];
  const push = (raw) => {
    if (!raw.text) return;
    // Entities are decoded last, so an escaped "&lt;path&gt;" is never mistaken for a tag.
    const run = raw.text.includes("&") ? { ...raw, text: unescapeHtml(raw.text) } : raw;
    const last = out[out.length - 1];
    const same = last && STYLE_KEYS.every((k) => (last[k] ?? null) === (run[k] ?? null));
    if (same) out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push(run);
  };
  const src = String(text ?? "").slice(0, 20000);
  let pos = 0;
  let from = 0;
  const flush = (end) => {
    if (end > from) push({ ...style, text: src.slice(from, end) });
  };
  while (pos < src.length) {
    // Only these characters can start a styled span: jump to the next one.
    STARTS.lastIndex = pos;
    const found = STARTS.exec(src);
    if (!found) break;
    pos = found.index;
    const ch = src[pos];
    const before = pos > 0 ? src[pos - 1] : "";
    // _emphasis_ and bare links only begin at a word boundary (snake_case, "ahttp").
    const boundary = !before || !/[\p{L}\p{N}]/u.test(before);
    let hit = null;
    if (!((ch === "_" || ch === "h") && !boundary) && !(ch === "h" && !src.startsWith("http", pos))) {
      for (const [re, make] of STICKY) {
        re.lastIndex = pos;
        const m = re.exec(src);
        if (!m) continue;
        hit = { len: m[0].length, value: make(m, style) };
        break;
      }
    }
    if (!hit) {
      pos += 1;
      continue;
    }
    flush(pos);
    for (const run of [].concat(hit.value)) push({ ...style, ...run });
    pos += hit.len;
    from = pos;
  }
  flush(src.length);
  return out;
}

export const runsText = (runs) => runs.map((r) => r.text).join("");

const TAG_LINE = /^<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>\s*$/;
const SKIP_TAGS = new Set(["columns", "column", "colgroup", "col", "content", "page", "synced_block", "synced_block_reference", "ul", "ol", "tbody", "thead", "meeting-notes", "summary", "notes", "transcript"]);
const EMBEDS = { "table-of-contents": "목차", image: "이미지", video: "동영상", file: "파일", pdf: "PDF", audio: "오디오", unknown: "지원하지 않는 블록", "link-preview": "링크 미리보기", bookmark: "북마크", embed: "임베드", database: "데이터베이스", "data-source": "데이터 소스" };

function tableFromTags(lines, start) {
  const rows = [];
  let row = null;
  let cell = null;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "</table>") break;
    if (line.startsWith("<tr")) row = [];
    else if (line === "</tr>") {
      if (row) rows.push(row);
      row = null;
    } else if (line.startsWith("<td") || line.startsWith("<th")) {
      const one = /^<t[dh][^>]*>([\s\S]*)<\/t[dh]>$/.exec(line);
      if (one) row?.push(inline(one[1]));
      else cell = [];
    } else if (line === "</td>" || line === "</th>") {
      row?.push(inline((cell ?? []).join("\n")));
      cell = null;
    } else if (cell) cell.push(line);
  }
  return { block: { t: "table", header: /header-row="true"/.test(lines[start]), rows }, next: i + 1 };
}

function pipeTable(lines, start) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => inline(c.trim()));
  const rows = [cells(lines[start])];
  let i = start + 2;
  for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
  return { block: { t: "table", header: true, rows }, next: i };
}

// Nesting from indentation: one level is a tab, four spaces (Jira) or two (Notion, hand-written).
function depthOf(indent) {
  const width = indent.replace(/\t/g, "    ").length;
  return width >= 4 && width % 4 === 0 ? width / 4 : Math.ceil(width / 2);
}

/** Markdown (with Notion's block tags) -> blocks. `limit` caps the number of blocks. */
export function blocks(text, limit = 400) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length && out.length < limit) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      i++;
      continue;
    }
    const fence = /^(`{3,}|~{3,})\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      out.push({ t: "code", lang: fence[2] || "", text: body.join("\n") });
      i++;
      continue;
    }
    const tag = TAG_LINE.exec(line);
    if (tag) {
      const [, closing, name, attrs] = tag;
      if (name === "callout" && !closing) {
        const end = lines.findIndex((l, k) => k > i && l.trim() === "</callout>");
        const stop = end < 0 ? lines.length : end;
        out.push({ t: "callout", icon: attr(attrs, "icon"), color: attr(attrs, "color"), blocks: blocks(lines.slice(i + 1, stop).join("\n"), 60) });
        i = stop + 1;
        continue;
      }
      if (name === "table" && !closing) {
        const { block, next } = tableFromTags(lines, i);
        if (block.rows.length) out.push(block);
        i = next;
        continue;
      }
      if (EMBEDS[name] && !closing) {
        const href = attr(attrs, "url") || attr(attrs, "source") || attr(attrs, "src");
        out.push({ t: "embed", label: attr(attrs, "alt") && attr(attrs, "alt") !== "external_object_instance" ? attr(attrs, "alt") : EMBEDS[name], kind: name, href: /^https?:/.test(href) ? href : "" });
        i++;
        continue;
      }
      if (name === "empty-block" || SKIP_TAGS.has(name) || closing) {
        i++;
        continue;
      }
    }
    const paired = /^<(image|file|video|pdf|audio|page|database|toggle|details)([^>]*)>([\s\S]*?)<\/\1>$/.exec(line);
    if (paired) {
      const href = attr(paired[2], "url") || attr(paired[2], "source") || attr(paired[2], "src");
      if (paired[1] === "toggle" || paired[1] === "details") out.push({ t: "toggle", runs: inline(paired[3]) });
      else out.push({ t: "embed", kind: paired[1], label: paired[3].trim() || EMBEDS[paired[1]] || "페이지", href: /^https?:/.test(href) ? href : "" });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(raw) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const { block, next } = pipeTable(lines, i);
      out.push(block);
      i = next;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ t: "h", level: Math.min(3, heading[1].length), runs: inline(heading[2].replace(/\s+\{[^}]*\}\s*$/, "")) });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.startsWith("▶")) {
      out.push({ t: "toggle", runs: inline(line.replace(/^▶\s*/, "")) });
      i++;
      continue;
    }
    const item = /^(\s*)(?:([-*+•◦])|(\d+)[.)])\s+(.*)$/.exec(raw);
    if (item) {
      const todo = /^\[( |x|X)\]\s+(.*)$/.exec(item[4]);
      out.push({ t: "li", ordered: Boolean(item[3]), n: item[3] ? Number(item[3]) : null, depth: Math.min(5, depthOf(item[1]) + (item[2] === "◦" ? 1 : 0)), runs: inline(todo ? todo[2] : item[4]), todo: Boolean(todo), checked: todo ? todo[1] !== " " : false });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const body = [];
      for (; i < lines.length && lines[i].trim().startsWith(">"); i++) body.push(lines[i].trim().replace(/^>\s?/, ""));
      out.push({ t: "quote", runs: inline(body.join("\n")) });
      continue;
    }
    out.push({ t: "p", runs: inline(line), depth: Math.min(5, depthOf(/^\s*/.exec(raw)[0])) });
    i++;
  }
  if (i < lines.length) out.push({ t: "more" });
  return out;
}

/** Runs split so each piece can wrap on its own (a word, or a run of spaces kept with it). */
export function words(runs, max = 4000) {
  const out = [];
  for (const run of runs) {
    if (out.length >= max) break;
    if (run.code || !/\s/.test(run.text)) {
      out.push(run);
      continue;
    }
    for (const part of run.text.split(/(?<=\s)(?=\S)|(?<=\n)/)) if (part) out.push({ ...run, text: part });
  }
  return out;
}

/** Two letters to stand in for a person's picture. */
export function initials(name) {
  const clean = String(name ?? "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
  if (!clean) return "?";
  if (/[가-힣]/.test(clean)) return clean.replace(/\s/g, "").slice(-2);
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

/** A steady color index (0..n-1) for a name, for avatar tiles. */
export function hueOf(name, n = 8) {
  let h = 0;
  for (const ch of String(name ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % n;
}
