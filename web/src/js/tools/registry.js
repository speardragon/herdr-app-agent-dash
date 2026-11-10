// Which tool is which comes from the mod's lib/tools.js (kind, title, target, digest, masking);
// colors and icons are this page's.

const KINDS = {
  explore: { label: "탐색", color: "var(--k-explore)", icon: "search" },
  edit: { label: "편집", color: "var(--k-edit)", icon: "pen" },
  shell: { label: "셸", color: "var(--k-shell)", icon: "terminal" },
  web: { label: "웹", color: "var(--k-web)", icon: "globe" },
  mcp: { label: "MCP", color: "var(--k-mcp)", icon: "plug" },
  agent: { label: "에이전트", color: "var(--k-agent)", icon: "users" },
};

const mcpParts = (name) => LT.mcpParts(name);
const isMongo = (call) => LT.isMongo(call);
const kindOf = (call) => LT.kindOf(call);
const kindColor = (call) => (isMongo(call) ? "var(--k-mongo)" : KINDS[kindOf(call)]?.color ?? "var(--muted)");

const TOOL_ICONS = {
  Bash: "terminal", shell: "terminal", exec_command: "terminal", exec: "terminal", BashOutput: "terminal",
  Read: "file-text", Edit: "pen", MultiEdit: "pen", Write: "file-plus", apply_patch: "diff", view_image: "image",
  Grep: "search", Glob: "folder-search", ToolSearch: "search", WebFetch: "globe", WebSearch: "search", web_search: "search",
  Agent: "users", Task: "users", TodoWrite: "list-checks", update_plan: "list-checks", AskUserQuestion: "help",
  request_user_input_async: "help", ExitPlanMode: "map", Skill: "sparkles", sleep: "clock", wait: "clock",
};

function toolIcon(call, size = 15) {
  if (isMongo(call)) return raw(`<span class="ico" style="width:${size}px;height:${size}px;display:inline-block">${LOGOS.mongo()}</span>`);
  return icon(TOOL_ICONS[call.name] || (call.name.startsWith("mcp__") ? "plug" : "bot"), size);
}

const toolTitle = (call) => LT.toolTitle(call);

const relPath = (p, agent) => LP.relPath(p, agentById(agent)?.cwdAbs, LIVE.home);

// Secrets never reach a list row, header or search result; the terminal shows them as chips.
const maskedText = (text) => LT.masked(text);
const maskSecrets = (text) => LT.maskSecrets(text);

const shellText = (input) => {
  const command = input?.command ?? input?.cmd ?? "";
  if (!Array.isArray(command)) return command;
  return command[0]?.endsWith("sh") && (command[1] === "-lc" || command[1] === "-c") ? command[2] ?? "" : command.join(" ");
};

const toolTarget = (call) => LT.toolTarget(call, (p) => relPath(p, call.agent));

// Right side of a list row: how it ended.
function toolDigest(call) {
  if (call.status === "pending") return { text: "승인 대기", cls: "err" };
  if (call.status === "running") return { text: "실행 중", cls: "" };
  const d = LT.toolDigest(call);
  if (!d) return null;
  if (d.add != null) return { html: `<span class="a">+${fmtInt(d.add)}</span> <span class="d">−${fmtInt(d.del)}</span>` };
  return { text: d.text, cls: d.tone === "err" ? "err" : "" };
}

function digestHTML(call) {
  const d = toolDigest(call);
  if (!d || (!d.text && !d.html)) return "";
  return raw(`<span class="digest ${d.cls || ""}">${d.html || esc(d.text)}</span>`);
}

function callStatusIcon(call, size = 14) {
  if (call.status === "running") return spinner(size);
  if (call.status === "pending") return raw('<span class="st blocked" aria-label="승인 대기"></span>');
  if (call.status === "error") return raw(`<span style="color:#ff8a80;display:inline-flex" aria-label="실패">${icon("circle-x", size).s}</span>`);
  if (call.status === "interrupted") return raw(`<span style="color:var(--dim);display:inline-flex" aria-label="중단">${icon("stop", size).s}</span>`);
  if (call.status === "unknown") return raw(`<span style="color:var(--dim);opacity:.5;display:inline-flex" aria-label="결과 없음">${icon("circle", size).s}</span>`);
  return raw(`<span style="color:var(--dim);display:inline-flex" aria-label="완료">${icon("check", size).s}</span>`);
}

const patchFiles = (patch) => LD.patchFiles(patch);
