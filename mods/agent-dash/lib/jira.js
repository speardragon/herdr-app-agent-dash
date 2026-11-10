// Jira (Atlassian Rovo MCP) calls -> what the Jira-looking views draw. Pure.

import { initials } from "./rich.js";
import { masked } from "./tools.js";

const suffix = (name) => String(name ?? "").split("__").pop();
const TOOLS = {
  getJiraIssue: "issue", searchJiraIssuesUsingJql: "list", editJiraIssue: "edit", createJiraIssue: "create",
  transitionJiraIssue: "transition", addCommentToJiraIssue: "comment", getTransitionsForJiraIssue: "transitions",
};

export const jiraTool = (name) => (/atlassian|jira/i.test(name ?? "") ? TOOLS[suffix(name)] ?? null : null);

function tryJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Atlassian Document Format -> Markdown, for results that weren't asked for as Markdown.
function adf(node, ctx = { depth: 0 }) {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  const kids = (sep = "") => (node.content ?? []).map((c) => adf(c, ctx)).join(sep);
  switch (node.type) {
    case "doc": return kids("\n\n");
    case "paragraph": return kids();
    case "heading": return `${"#".repeat(node.attrs?.level ?? 2)} ${kids()}`;
    case "text": {
      let text = node.text ?? "";
      for (const mark of node.marks ?? []) {
        if (mark.type === "strong") text = `**${text}**`;
        else if (mark.type === "em") text = `*${text}*`;
        else if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "strike") text = `~~${text}~~`;
        else if (mark.type === "link") text = `[${text}](${mark.attrs?.href ?? ""})`;
      }
      return text;
    }
    case "hardBreak": return "\n";
    case "mention": return node.attrs?.text ?? "@사용자";
    case "emoji": return node.attrs?.text ?? node.attrs?.shortName ?? "";
    case "inlineCard": case "blockCard": return node.attrs?.url ?? "";
    case "rule": return "---";
    case "codeBlock": return `\`\`\`${node.attrs?.language ?? ""}\n${kids()}\n\`\`\``;
    case "blockquote": return kids("\n").split("\n").map((l) => `> ${l}`).join("\n");
    case "bulletList": case "orderedList":
      return (node.content ?? []).map((item, i) => `${"  ".repeat(ctx.depth)}${node.type === "orderedList" ? `${i + 1}.` : "-"} ${adf(item, { depth: ctx.depth + 1 }).trim()}`).join("\n");
    case "listItem": return (node.content ?? []).map((c) => adf(c, ctx)).join("\n");
    case "table": return (node.content ?? []).map((row, i) => {
      const cells = `| ${(row.content ?? []).map((c) => adf(c, ctx).replace(/\n+/g, " ")).join(" | ")} |`;
      return i === 0 ? `${cells}\n|${(row.content ?? []).map(() => " --- ").join("|")}|` : cells;
    }).join("\n");
    case "tableCell": case "tableHeader": case "panel": case "expand": return kids("\n");
    default: return kids();
  }
}

// Long texts are masked once here, so the views don't mask every word they draw.
const textOf = (value) => masked(typeof value === "string" ? value : value && typeof value === "object" ? adf(value) : "");

const person = (u) => (u?.displayName ? { name: u.displayName, initials: initials(u.displayName) } : null);

// Jira's status categories decide the lozenge color: new (gray), indeterminate (blue), done (green).
function status(s) {
  if (!s?.name) return null;
  const key = s.statusCategory?.key ?? "";
  return { name: s.name, cat: key === "done" ? "done" : key === "indeterminate" ? "progress" : "todo" };
}

function typeOf(it) {
  if (!it?.name) return null;
  const name = it.name;
  const kind = it.subtask || /sub-?task|하위/i.test(name) ? "subtask" : it.hierarchyLevel === 1 || /epic|에픽/i.test(name) ? "epic" : /bug|버그/i.test(name) ? "bug" : /story|스토리/i.test(name) ? "story" : "task";
  return { name, kind };
}

function issueOf(raw) {
  const f = raw?.fields ?? {};
  const comments = f.comment?.comments ?? [];
  return {
    key: raw.key ?? "",
    url: raw.webUrl ?? null,
    summary: masked(f.summary ?? ""),
    type: typeOf(f.issuetype),
    status: status(f.status),
    priority: f.priority?.name ?? null,
    assignee: person(f.assignee),
    reporter: person(f.reporter),
    parent: f.parent?.key ? { key: f.parent.key, summary: f.parent.fields?.summary ?? "", type: typeOf(f.parent.fields?.issuetype) } : null,
    project: f.project?.key ? { key: f.project.key, name: f.project.name ?? f.project.key } : raw.key ? { key: raw.key.split("-")[0], name: raw.key.split("-")[0] } : null,
    due: f.duedate ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
    labels: Array.isArray(f.labels) ? f.labels : [],
    description: "description" in f ? textOf(f.description) : null,
    comments: comments.slice(-20).map((c) => ({ author: person(c.author), body: textOf(c.body), created: c.created ?? null })),
  };
}

function issuesIn(data) {
  if (!data) return [];
  const list = Array.isArray(data.issues) ? data.issues : Array.isArray(data.issues?.nodes) ? data.issues.nodes : data.key && data.fields ? [data] : [];
  return list.filter((i) => i?.key).map(issueOf);
}

const FIELD_LABEL = { summary: "제목", description: "설명", assignee: "담당자", duedate: "기한", priority: "우선 순위", labels: "레이블", parent: "상위 항목", issuetype: "유형" };

/** {kind, issues, ...} for a Jira call, or null when its result can't be read as Jira data. */
export function parseJira(call) {
  const kind = jiraTool(call.name);
  if (!kind) return null;
  const input = call.input ?? {};
  const data = tryJson(call.result?.text);
  if (call.result && !data && kind !== "comment") return null;
  const issues = issuesIn(data);
  const key = input.issueIdOrKey ?? issues[0]?.key ?? "";
  if (kind === "list") return { kind, jql: input.jql ?? "", issues, total: data?.issues?.totalCount ?? data?.total ?? null, pending: !call.result };
  if (kind === "transitions") {
    return { kind, key, transitions: (data?.transitions ?? []).map((x) => ({ name: x.name, to: status(x.to) })).filter((x) => x.to), pending: !call.result };
  }
  if (kind === "comment") {
    const body = textOf(input.commentBody ?? data?.body ?? "");
    return { kind, key, comment: { author: person(data?.author), body, created: data?.created ?? null }, pending: !call.result };
  }
  if (kind === "issue" && issues.length > 1) return { kind: "list", jql: "", issues, total: null };
  // A write: the result is the issue as it is now; what was sent fills in what it leaves out.
  const sent = kind === "create"
    ? { summary: input.summary ?? "", description: textOf(input.description ?? ""), type: input.issueTypeName ? typeOf({ name: input.issueTypeName }) : null }
    : kind === "edit" ? { description: "description" in (input.fields ?? {}) ? textOf(input.fields.description) : null, summary: input.fields?.summary ?? null } : {};
  const base = issues[0] ?? { key, url: null, summary: "", type: null, status: null, priority: null, assignee: null, reporter: null, parent: input.parent ? { key: input.parent, summary: "", type: null } : null, project: input.projectKey ? { key: input.projectKey, name: input.projectKey } : null, due: null, created: null, updated: null, labels: [], description: null, comments: [] };
  const issue = {
    ...base,
    summary: base.summary || sent.summary || "",
    type: base.type ?? sent.type ?? null,
    description: base.description ?? sent.description ?? null,
  };
  const changed = kind === "edit" ? Object.keys(input.fields ?? {}).map((k) => FIELD_LABEL[k] ?? k) : [];
  return { kind, issue, changed, pending: !call.result };
}
