// Links an agent mentioned in its replies (link-list rules): per reply, outside code,
// deduped, with the sentence they appeared in and a badge for well-known kinds.

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()\]`*]+[^\s<>()\].,;:!?'"`*_~])/g;
const LOCAL_RE = /\[([^\]\n]+)\]\((\/[^)\s]+|~\/[^)\s]+)\)/g;

function blankCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

export function plainLine(line) {
  return String(line ?? "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function parseUrl(url) {
  const m = /^(https?):\/\/([^/?#:]+)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!m) return null;
  return { scheme: m[1], host: m[2].toLowerCase(), port: m[3] ?? "", path: m[4] || "/", query: m[5] ?? "", hash: m[6] ?? "" };
}

const hostOf = (u) => u.host.replace(/^www\./, "");
const segs = (u) => u.path.split("/").filter(Boolean);
const queryParam = (u, key) => {
  const m = new RegExp(`[?&]${key}=([^&#]*)`).exec(u.query);
  return m ? decodeURIComponent(m[1]) : null;
};

export function titleFromUrl(url) {
  const u = parseUrl(url);
  if (!u) return url;
  const host = hostOf(u);
  const parts = segs(u);
  if (host === "github.com" && parts[0] === "advisories") return parts[1];
  if (host === "github.com" && parts.length >= 2) return parts.slice(0, 2).join("/") + (parts[2] === "pull" || parts[2] === "issues" ? ` #${parts[3]}` : "");
  if (host === "npmjs.com" && parts[0] === "package") return parts.slice(1, 3).join("/");
  if (/atlassian\.net$/.test(host) && parts[0] === "browse") return parts[1];
  if (host === "localhost" || host === "127.0.0.1") return `${host}:${u.port}`;
  return host + (parts.length ? `/${parts.slice(0, 2).join("/")}` : "");
}

/** {kind, text} for links worth flagging: PRs, issues, advisories, packages, tickets. */
export function linkBadge(url) {
  const u = parseUrl(url);
  if (!u) return null;
  const host = hostOf(u);
  const parts = segs(u);
  if (host === "github.com" && parts[2] === "pull") return { kind: "pr", text: `PR #${parts[3]}` };
  if (host === "github.com" && parts[2] === "issues") return { kind: "issue", text: `#${parts[3]}` };
  if (host === "github.com" && parts[2] === "commit") return { kind: "commit", text: (parts[3] ?? "").slice(0, 7) };
  if (host === "github.com" && parts[0] === "advisories") return { kind: "adv", text: "보안 권고" };
  if (host === "npmjs.com" && parts[0] === "package") return { kind: "pkg", text: "npm" };
  if (/atlassian\.net$/.test(host)) {
    const key = parts[0] === "browse" ? parts[1] : queryParam(u, "selectedIssue");
    return key ? { kind: "issue", text: key } : { kind: "doc", text: "Atlassian" };
  }
  if (/notion\.(so|site)$/.test(host)) return { kind: "doc", text: "Notion" };
  if (/slack\.com$/.test(host)) return { kind: "doc", text: "Slack" };
  if (host === "localhost" || host === "127.0.0.1") return { kind: "local", text: "로컬" };
  if (/claude\.ai$/.test(host) && parts[0] === "artifact") return { kind: "doc", text: "Artifact" };
  return null;
}

/** Links in one reply: [{url, label, title, context, line, badge, local}]. */
export function extractLinks(reply) {
  const original = String(reply.text ?? "");
  const text = blankCode(original);
  const lines = original.split("\n");
  const seen = new Map();
  const add = (url, label, index, local = false) => {
    if (seen.has(url)) return;
    const line = text.slice(0, index).split("\n").length - 1;
    seen.set(url, {
      url,
      label: label && label !== url ? label : null,
      title: label && label !== url ? label : local ? url.split("/").pop() : titleFromUrl(url),
      context: plainLine(lines[line] ?? ""),
      line,
      badge: local ? { kind: "file", text: "파일" } : linkBadge(url),
      local,
    });
  };
  for (const m of text.matchAll(LINK_RE)) add(m[2] || m[3], m[1], m.index);
  for (const m of text.matchAll(LOCAL_RE)) add(m[2], m[1], m.index, true);
  return [...seen.values()].sort((a, b) => a.line - b.line);
}

export function domainOf(url) {
  const u = parseUrl(url);
  return u ? hostOf(u) : "";
}

/** The URL split for display: scheme, host, port, path segments, query pairs, hash. */
export function anatomy(url) {
  const u = parseUrl(url);
  if (!u) return null;
  const query = u.query.slice(1).split("&").filter(Boolean).map((pair) => {
    const [k, v = ""] = pair.split("=");
    let value = v;
    try {
      value = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      value = v;
    }
    return { k, v: value };
  });
  return { scheme: u.scheme, host: u.host, port: u.port, path: segs(u), query, hash: u.hash.slice(1) };
}
