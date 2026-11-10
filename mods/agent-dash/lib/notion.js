// Notion MCP calls -> what the Notion-looking views draw: a page (breadcrumb, icon, title,
// properties, blocks), search results, database rows, or what a write sent. Pure.

import { blocks as parseBlocks } from "./rich.js";
import { masked } from "./tools.js";

// Secrets are masked once here, on the whole text, before it is split into blocks.
const blocks = (text, limit) => parseBlocks(masked(String(text ?? "")), limit);

const suffix = (name) => String(name ?? "").split("__").pop();
const TOOLS = {
  "notion-fetch": "fetch", "notion-search": "search", "notion-query-data-sources": "rows", "notion-update-page": "update",
  "notion-create-pages": "create",
};

export const notionTool = (name) => (/notion/i.test(name ?? "") ? TOOLS[suffix(name)] ?? null : null);

function tryJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const attr = (text, name) => new RegExp(`${name}="([^"]*)"`).exec(text)?.[1] ?? "";
const between = (text, tag) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? null;
const isEmoji = (s) => Boolean(s) && !/^https?:|^\//.test(s) && [...s].length <= 4;
const unescape = (s) => String(s ?? "").replace(/\\([\\`*_{}\[\]()#+\-.!~<>|])/g, "$1");

/** A property value as Notion shows it: {kind: text | check | date | url | tags | empty, ...}. */
export function propValue(value) {
  if (value === "__YES__" || value === true) return { kind: "check", on: true };
  if (value === "__NO__" || value === false) return { kind: "check", on: false };
  if (value == null || value === "") return { kind: "empty" };
  if (Array.isArray(value)) return value.length ? { kind: "tags", tags: value.map(String) } : { kind: "empty" };
  const s = String(value);
  if (/^\[.*\]$/.test(s)) {
    const list = tryJson(s);
    if (Array.isArray(list)) return list.length ? { kind: "tags", tags: list.map(String) } : { kind: "empty" };
  }
  if (/^\d{4}-\d\d-\d\d(T[\d:.]+Z?)?$/.test(s)) return { kind: "date", text: s.length > 10 ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s };
  if (/^https?:\/\//.test(s)) return { kind: "url", text: s };
  if (/^user:\/\//.test(s)) return { kind: "empty" };
  return { kind: "text", text: masked(s) };
}

const HIDDEN_PROPS = new Set(["url", "title"]);

function propsOf(object, titleKeys = []) {
  return Object.entries(object ?? {})
    .filter(([k]) => !HIDDEN_PROPS.has(k) && !titleKeys.includes(k) && !/^date:.*:(is_datetime)$/.test(k))
    .map(([name, v]) => ({ name: name.replace(/^date:(.*):start$/, "$1"), value: propValue(v) }))
    .filter((p) => p.value.kind !== "empty" || true)
    .slice(0, 24);
}

function crumbs(text) {
  const path = between(text, "ancestor-path") ?? "";
  const items = [];
  for (const m of path.matchAll(/<(parent|ancestor-(\d+))-(page|database|data-source|workspace|teamspace)\s+([^>]*?)\/?>/g)) {
    const title = attr(m[4], "title") || attr(m[4], "name");
    items.push({ order: m[2] ? Number(m[2]) : 1, title, kind: m[3] });
  }
  // The data source and its database are one step in Notion's own breadcrumb.
  return items.sort((a, b) => b.order - a.order).filter((c) => c.title).filter((c, i, list) => !(i > 0 && list[i - 1].title === c.title)).map((c) => c.title);
}

function pageFrom(data) {
  const text = String(data.text ?? "");
  const head = /<page\s+([^>]*)>/.exec(text)?.[1] ?? "";
  const icon = attr(head, "icon");
  const props = tryJson((between(text, "properties") ?? "").trim()) ?? {};
  const content = between(text, "content") ?? (/<content>([\s\S]*)$/.exec(text)?.[1] ?? "");
  const titleKey = Object.keys(props).find((k) => unescape(props[k]) === unescape(data.title) && k !== "url");
  return {
    kind: "page",
    title: unescape(data.title ?? props.title ?? ""),
    url: data.url ?? attr(head, "url") ?? null,
    icon: isEmoji(icon) ? icon : null,
    crumbs: crumbs(text),
    props: propsOf(props, titleKey ? [titleKey] : []),
    blocks: blocks(content),
    blank: /<blank-page>/.test(text),
    cut: !/<\/page>/.test(text) && Boolean(content),
  };
}

function databaseFrom(data) {
  const text = String(data.text ?? "");
  const columns = [];
  for (const m of text.matchAll(/^\s*"((?:[^"]|"")+)"\s+([A-Z]+)[^\n]*?(?:--\s*(.*))?$/gm)) {
    if (columns.length < 40 && !columns.some((c) => c.name === m[1])) columns.push({ name: m[1], type: m[2], note: (m[3] ?? "").slice(0, 80) });
  }
  const views = [...text.matchAll(/<view\s+([^>]*?)\/?>/g)].map((m) => attr(m[1], "name") || attr(m[1], "type")).filter(Boolean).slice(0, 8);
  return { kind: "database", title: unescape(data.title ?? ""), url: data.url ?? null, crumbs: crumbs(text), columns, views };
}

const titleOfProps = (props) => {
  const key = ["이름", "Name", "name", "title", "제목", "Title"].find((k) => typeof props?.[k] === "string") ?? Object.keys(props ?? {}).find((k) => typeof props[k] === "string");
  return { key, title: key ? unescape(props[key]) : "" };
};

/** {kind, ...} for a Notion call, or null when its result can't be read as Notion data. */
export function parseNotion(call) {
  const kind = notionTool(call.name);
  if (!kind) return null;
  const input = call.input ?? {};
  const data = tryJson(call.result?.text);
  if (kind === "update") {
    const edits = Array.isArray(input.content_updates) ? input.content_updates.slice(0, 12).map((u) => ({ from: blocks(u.old_str ?? "", 40), to: blocks(u.new_str ?? "", 80) })) : [];
    const title = titleOfProps(input.properties);
    return {
      kind, command: input.command ?? "", pageId: input.page_id ?? data?.page_id ?? "", icon: isEmoji(input.icon) ? input.icon : null,
      title: title.title, props: propsOf(input.properties, title.key ? [title.key] : []),
      blocks: typeof input.new_str === "string" ? blocks(input.new_str) : [], edits, pending: !call.result, failed: Boolean(call.result?.err),
    };
  }
  if (kind === "create") {
    const made = Array.isArray(data?.pages) ? data.pages : [];
    const pages = (Array.isArray(input.pages) ? input.pages : []).slice(0, 40).map((p, i) => {
      const title = titleOfProps(p.properties);
      return { title: title.title, url: made[i]?.url ?? null, icon: isEmoji(p.icon) ? p.icon : null, props: propsOf(p.properties, title.key ? [title.key] : []), blocks: typeof p.content === "string" ? blocks(p.content, 120) : [] };
    });
    return { kind, pages, pending: !call.result, failed: Boolean(call.result?.err) };
  }
  if (!call.result) return { kind, pending: true, query: input.query ?? "" };
  if (!data) return null;
  if (kind === "fetch") {
    if (typeof data.text !== "string") return null;
    return data.metadata?.type === "database" || /<database\s/.test(data.text.slice(0, 4000)) ? databaseFrom(data) : pageFrom(data);
  }
  if (kind === "search") {
    if (!Array.isArray(data.results)) return null;
    return { kind, query: input.query ?? "", results: data.results.slice(0, 50).map((r) => ({ title: unescape(r.title ?? ""), url: r.url ?? null, type: r.type ?? "page", highlight: masked(r.highlight ?? ""), time: r.timestamp ?? null, path: r.path ?? "" })) };
  }
  if (kind === "rows") {
    const rows = Array.isArray(data.results) ? data.results : null;
    if (!rows) return null;
    const columns = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r ?? {})))].filter((c) => c !== "url").slice(0, 14);
    return { kind, columns, total: rows.length, rows: rows.slice(0, 100).map((r) => ({ url: typeof r.url === "string" ? r.url : null, cells: columns.map((c) => propValue(r[c])) })), query: input.data?.query ?? "" };
  }
  return null;
}
