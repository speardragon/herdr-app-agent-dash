// Which tool is which: kind (color, filter group), one-line target, result digest,
// and secret masking. Covers Claude Code tools, Codex items and MCP servers.

import { fmtBytes, fmtInt, fmtK, firstLine, sum } from "./format.js";
import { baseName } from "./paths.js";
import { stripAnsi } from "./ansi.js";

export const KINDS = {
  explore: { label: "탐색", icon: "search" },
  edit: { label: "편집", icon: "pen" },
  shell: { label: "셸", icon: "terminal" },
  web: { label: "웹", icon: "globe" },
  mcp: { label: "MCP", icon: "plug" },
  agent: { label: "에이전트", icon: "bot" },
};

const KIND_OF = {
  Read: "explore", Grep: "explore", Glob: "explore", LS: "explore", LSP: "explore", ToolSearch: "explore", NotebookRead: "explore", view_image: "explore",
  Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit", apply_patch: "edit",
  Bash: "shell", BashOutput: "shell", KillShell: "shell", Monitor: "shell", exec_command: "shell", shell: "shell", exec: "shell", local_shell: "shell", write_stdin: "shell",
  WebFetch: "web", WebSearch: "web", web_search: "web",
};

export const MONGO_TOOLS = new Set(["find", "aggregate", "count", "explain", "export", "insert-many", "insert-one", "update-many", "update-one", "delete-many", "delete-one", "list-databases", "list-collections", "collection-schema", "collection-indexes", "collection-storage-size", "db-stats", "create-index", "drop-collection", "rename-collection", "create-collection", "drop-database"]);
const MONGO_WRITE = /^(insert|update|delete|create|drop|rename)/;
const MONGO_META = /^(list-|collection-|db-stats)/;

export function mcpParts(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(name ?? ""));
  return m ? { server: m[1], tool: m[2] } : null;
}

export function isMongo(call) {
  const p = mcpParts(call.name);
  return !!p && /mongo/i.test(p.server) && MONGO_TOOLS.has(p.tool);
}

export const mongoOp = (tool) => (MONGO_WRITE.test(tool) ? "write" : MONGO_META.test(tool) ? "meta" : "read");

/** {kind: count} for a list of calls. */
export function countKinds(calls) {
  const counts = {};
  for (const c of calls) {
    const k = kindOf(c);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export function kindOf(call) {
  if (String(call.name).startsWith("mcp__")) return "mcp";
  return KIND_OF[call.name] ?? "agent";
}

/** Short server label: "plugin_aidt-workflow_edu-mongodb" -> "edu-mongodb". */
export const serverLabel = (server) => String(server ?? "").replace(/^plugin_[^_]+_/, "").replace(/^claude_ai_/, "");

export function toolTitle(call) {
  const p = mcpParts(call.name);
  if (p) return p.tool;
  if (call.name === "exec_command") return "shell";
  if (call.name === "request_user_input_async" || call.name === "request_user_input") return "질문";
  return call.name;
}

// ---------- secrets ----------

const SECRET_PATTERNS = [
  /(https?:\/\/[^:\s'"/@]+:)([^@\s'"/]+)(@)/g,
  /(mongodb(?:\+srv)?:\/\/[^:\s'"/]+:)([^@\s'"]+)(@)/g,
  /(postgres(?:ql)?:\/\/[^:\s'"/]+:)([^@\s'"]+)(@)/g,
  /(redis:\/\/[^:\s'"/]*:)([^@\s'"]+)(@)/g,
  /((?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key)\s*[=:]\s*["']?)(?!••••)([^\s'"&,}@]{4,})()/gi,
  /(Authorization:\s*(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]{8,})()/gi,
  /()((?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})()/g,
];

/** Replaces secrets with "••••"; {text, count} so views can say how many were hidden. */
export function maskSecrets(text) {
  let count = 0;
  let out = String(text ?? "");
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, pre, _secret, post) => {
      count++;
      return `${pre}••••${post}`;
    });
  }
  return { text: out, count };
}

export const masked = (text) => maskSecrets(text).text;

// ---------- one-line target ----------

const shellOf = (input) => (Array.isArray(input?.command) ? input.command.join(" ") : input?.command ?? input?.cmd ?? "");

function codexExecTarget(code) {
  const m = /cmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(code ?? "") || /tools\.(\w+)/.exec(code ?? "");
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : firstLine(code);
}

export function toolTarget(call, rel = (p) => p) {
  const i = call.input ?? {};
  const p = mcpParts(call.name);
  if (p) {
    if (i.collection) return `${i.database ?? ""}.${i.collection}`;
    if (i.database) return i.database;
    for (const key of ["issueIdOrKey", "jql", "query", "cql", "url", "id", "page_id", "pageId", "path", "name", "title"]) {
      if (typeof i[key] === "string" && i[key]) return firstLine(i[key]);
    }
    return serverLabel(p.server);
  }
  switch (call.name) {
    case "Bash":
    case "exec_command":
    case "shell": {
      const cmd = firstLine(shellOf(i));
      return masked(cmd.length > 140 && i.description ? i.description : cmd);
    }
    case "exec":
      return masked(codexExecTarget(i.code));
    case "Read":
      return `${rel(i.file_path ?? "")}${i.offset ? `:${i.offset}${i.limit ? `–${i.offset + i.limit - 1}` : ""}` : ""}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return rel(i.file_path ?? i.notebook_path ?? "");
    case "apply_patch":
      return Object.keys(i.changes ?? {}).map((f) => baseName(f)).join(", ") || firstLine(i.patch ?? "");
    case "Grep":
      return `${i.pattern ?? ""}${i.path ? `  in ${baseName(i.path)}` : ""}`;
    case "Glob":
      return i.pattern ?? "";
    case "WebFetch":
      return String(i.url ?? "").replace(/^https?:\/\//, "");
    case "WebSearch":
    case "web_search":
      return i.query ?? "";
    case "Agent":
    case "Task":
      return i.description ?? i.subagent_type ?? "";
    case "TodoWrite":
      return (i.todos?.find((t) => t.status === "in_progress") ?? i.todos?.[0])?.content ?? "";
    case "update_plan":
      return (i.plan?.find((t) => t.status === "in_progress") ?? i.plan?.[0])?.step ?? "";
    case "AskUserQuestion":
      return i.questions?.[0]?.question ?? "";
    case "request_user_input_async":
    case "request_user_input":
      return i.questions?.[0]?.title ?? i.questions?.[0]?.question ?? "";
    case "ExitPlanMode":
      return (/^#+\s+(.*)$/m.exec(i.plan ?? "") ?? [])[1] ?? "계획";
    case "Skill":
      return i.skill ?? i.command ?? "";
    case "ToolSearch":
      return i.query ?? "";
    case "view_image":
      return rel(i.path ?? "");
    case "sleep":
      return `${Math.round((i.durationMs ?? 0) / 1000)}초`;
    default: {
      const first = Object.values(i).find((v) => typeof v === "string");
      return first ? masked(firstLine(first)) : "";
    }
  }
}

// ---------- digest: how it ended, for the right side of a row ----------

function mongoDigest(tool, text) {
  const m = /resulted in (\d+) documents?/.exec(text) || /Found (\d+) documents?/i.exec(text);
  if (m) return { text: `${fmtInt(+m[1])} docs` };
  const count = /(?:count|Count)[^\d]{0,30}(\d+)/.exec(text);
  if (tool === "count" && count) return { text: fmtInt(+count[1]) };
  const n = /(?:Modified|Updated|Deleted|Inserted)\s+(\d+)/i.exec(text) || /(\d+)\s+documents?\s+(?:modified|updated|deleted|inserted)/i.exec(text);
  if (n) return { text: `${n[1]} ${tool.split("-")[0]}`, tone: tool.startsWith("delete") ? "err" : "" };
  return null;
}

export function toolDigest(call) {
  const r = call.result;
  if (!r) return null;
  if (r.err) return { text: "오류", tone: "err" };
  const x = r.extra ?? {};
  const p = mcpParts(call.name);
  if (p && isMongo(call)) return mongoDigest(p.tool, r.text ?? "");
  if (p) return r.text ? { text: fmtBytes(r.text.length) } : null;
  switch (call.name) {
    case "Bash": {
      if (x.bg) return { text: "백그라운드" };
      const out = stripAnsi(x.stdout ?? r.text ?? "");
      const n = out.split("\n").filter((l) => l.trim()).length;
      return n ? { text: `${fmtInt(n)}줄` } : null;
    }
    case "exec_command":
      if (x.exit) return { text: `exit ${x.exit}`, tone: "err" };
      return r.text ? { text: `${fmtInt(stripAnsi(r.text).split("\n").filter((l) => l.trim()).length)}줄` } : null;
    case "Read":
      if (x.type === "image") return { text: x.dims ? `${x.dims.originalWidth ?? x.dims.width}×${x.dims.originalHeight ?? x.dims.height}` : "이미지" };
      return x.file ? { text: `${fmtInt(x.file.numLines)}/${fmtInt(x.file.totalLines)}` } : null;
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "apply_patch":
    case "NotebookEdit":
      return editDigest(call);
    case "Grep":
      return x.numFiles != null ? { text: x.mode === "content" ? `${fmtInt(x.numLines ?? 0)}줄` : `${fmtInt(x.numFiles)}개 파일` } : null;
    case "Glob":
      return x.numFiles != null ? { text: `${fmtInt(x.numFiles)}개 파일` } : null;
    case "WebFetch":
      return x.code ? { text: `${x.code} · ${fmtBytes(x.bytes)}`, tone: x.code >= 400 ? "err" : "" } : null;
    case "WebSearch":
    case "web_search": {
      const n = x.results?.length ?? 0;
      return n ? { text: `${n}개 결과` } : null;
    }
    case "Agent":
    case "Task":
      return x.totalToolUseCount ? { text: `${x.totalToolUseCount}단계 · ${fmtK(x.totalTokens)}` } : x.status ? { text: x.status === "async_launched" ? "백그라운드" : x.status } : null;
    case "TodoWrite": {
      const todos = call.input?.todos ?? [];
      return { text: `${todos.filter((t) => t.status === "completed").length}/${todos.length}` };
    }
    case "update_plan": {
      const plan = call.input?.plan ?? [];
      return { text: `${plan.filter((t) => t.status === "completed").length}/${plan.length}` };
    }
    case "AskUserQuestion": {
      const answer = Object.values(x.answers ?? {})[0];
      return answer ? { text: String(answer) } : null;
    }
    default:
      return null;
  }
}

/** +added −removed for an edit-like call, from its patch or its strings. */
export function editStats(call) {
  const x = call.result?.extra ?? {};
  if (Array.isArray(x.patch)) {
    const lines = x.patch.flatMap((h) => h.lines ?? []);
    return { add: lines.filter((l) => l[0] === "+").length, del: lines.filter((l) => l[0] === "-").length };
  }
  if (call.name === "Write") return { add: String(call.input?.content ?? "").split("\n").length, del: 0 };
  if (call.name === "apply_patch") {
    const diffs = Object.values(call.input?.changes ?? {}).map((c) => c.diff ?? "");
    const text = diffs.join("\n") || call.input?.patch || "";
    const lines = text.split("\n");
    return { add: lines.filter((l) => l[0] === "+" && !l.startsWith("+++")).length, del: lines.filter((l) => l[0] === "-" && !l.startsWith("---")).length };
  }
  const edits = call.input?.edits ?? [call.input ?? {}];
  const count = (s) => (s ? String(s).split("\n").length : 0);
  return { add: sum(edits, (e) => count(e.new_string)), del: sum(edits, (e) => count(e.old_string)) };
}

function editDigest(call) {
  const s = editStats(call);
  return { add: s.add, del: s.del };
}
