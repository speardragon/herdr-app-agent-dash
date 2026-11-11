// Agents and the terminals they started with `hc run` (sub-agents), as one tree.
// herdr's agents() only lists terminals that have a pane; a sub-agent is a core terminal
// whose `parent` is the terminal that started it, so the tree is built from both.

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const AGENT_PROGRAMS = /^(claude|codex|pi|gemini|opencode|amp|aider)$/;
const ENDED_SHOWN_MS = 24 * 3600 * 1000;

const baseName = (path) => String(path ?? "").split("/").pop();

// Tab names herdr gives itself: they say nothing, so the session's own title is the better name.
const DEFAULT_TAB = /^(\d+|main|claude code|codex|claude|shell|terminal)$/i;

/** What to call an agent: the tab name you gave it, else the title its session set. */
export function agentName(tabName, title) {
  const tab = String(tabName ?? "").trim();
  return tab && !DEFAULT_TAB.test(tab) ? tab : title || tab || "";
}

/** The task an agent was launched with (`hc run claude "<task>"`), or null. */
export function taskOf(term) {
  const argv = term?.argv ?? [];
  if (argv.length < 2 || !AGENT_PROGRAMS.test(baseName(argv[0]))) return null;
  const last = argv[argv.length - 1];
  return typeof last === "string" && !last.startsWith("-") && last.length > 12 && /\s/.test(last) ? last : null;
}

/** A sub-agent's status word. It reports to its parent, so its "done" is not news for you:
 *  working | blocked | idle | running (a plain program) | ended. */
export function subStatus(term) {
  if (term.state !== "live") return "ended";
  const word = typeof term.status === "string" ? term.status : term.status?.state ?? term.report?.state ?? null;
  if (!word) return "running";
  if (word === "error") return "blocked";
  return word === "done" ? "idle" : word;
}

// herdr's own marks for the agents it knows, for a finished terminal (hc doesn't name its program).
const KNOWN = { claude: "Claude Code", codex: "Codex" };
const knownProgram = (key) => (KNOWN[key] ? { key, name: KNOWN[key], icon: `icons/${key}.svg`, tint: false, agent: true } : null);

function subNode(term) {
  const program = term.program ?? knownProgram(baseName(term.argv?.[0])) ?? { key: baseName(term.argv?.[0]), name: baseName(term.argv?.[0]) || "프로그램", agent: AGENT_PROGRAMS.test(baseName(term.argv?.[0])) };
  const app = term.report?.app ?? term.status?.app ?? (program.agent || AGENT_PROGRAMS.test(baseName(term.argv?.[0])) ? baseName(term.argv?.[0]) : null);
  return {
    address: term.address,
    sub: true,
    state: term.state === "live" ? "live" : "ended",
    status: subStatus(term),
    app,
    program,
    title: term.name || term.template || term.title || program.name || term.address,
    name: term.name ?? null,
    task: taskOf(term),
    command: (term.argv ?? []).join(" "),
    parent: term.parent ?? null,
    created: term.created_ms ?? null,
    finished: term.finished_ms ?? null,
    exit: term.exit_code ?? null,
    reason: term.reason ?? null,
    pinned: false,
    isAgent: Boolean(app),
  };
}

/** {nodes, kids, roots}: every agent and sub-agent by address, each one's children, and the
 *  agents with no (known) parent. `ended` are finished terminals (hc ls --all + hc get). */
export function buildRoster(agentList, liveTerms, ended = [], now = Date.now()) {
  const terms = Object.fromEntries(liveTerms.map((x) => [x.address, x]));
  const listed = new Set(agentList.map((a) => a.address));
  const raw = {};
  for (const a of agentList) raw[a.address] = { ...a, title: agentName(a.tab_name, a.title), summary: a.title, sub: false, state: "live", parent: terms[a.address]?.parent ?? null, created: terms[a.address]?.created_ms ?? null, task: null, isAgent: true };
  for (const term of [...liveTerms, ...ended]) {
    if (listed.has(term.address) || !term.parent || raw[term.address]) continue;
    if (term.state !== "live" && now - (term.finished_ms ?? 0) > ENDED_SHOWN_MS) continue;
    raw[term.address] = subNode(term);
  }
  // A parent that is gone: an agent keeps its place as a root, anything else drops out.
  const known = (addr) => Boolean(addr && raw[addr]);
  const kept = Object.values(raw).filter((n) => !n.sub || known(n.parent) || (n.state === "live" && n.isAgent));
  const nodes = Object.fromEntries(kept.map((n) => [n.address, { ...n, parent: known(n.parent) && n.parent !== n.address ? n.parent : null }]));
  const kids = {};
  for (const n of Object.values(nodes)) if (n.parent) kids[n.parent] = [...(kids[n.parent] ?? []), n.address];
  const age = (addr) => (nodes[addr].state === "live" ? nodes[addr].created ?? 0 : (nodes[addr].finished ?? 0) + 1e15);
  for (const key of Object.keys(kids)) kids[key] = kids[key].sort((x, y) => age(x) - age(y));
  const roots = Object.values(nodes).filter((n) => !n.parent || !reaches(nodes, n.address)).map((n) => n.address);
  const inherit = (addr, from, depth, seen) => {
    if (seen.has(addr)) return;
    seen.add(addr);
    const n = nodes[addr];
    nodes[addr] = { ...n, depth, root: from.address, space_name: n.space_name ?? from.space_name ?? "", tab_name: n.tab_name ?? from.tab_name ?? "", space: n.space ?? from.space, tab: n.tab ?? from.tab };
    for (const kid of kids[addr] ?? []) inherit(kid, nodes[addr], depth + 1, seen);
  };
  const seen = new Set();
  for (const r of roots) inherit(r, nodes[r], 0, seen);
  return { nodes, kids, roots };
}

// False for a node caught in a parent cycle: it is shown as a root instead of vanishing.
function reaches(nodes, addr) {
  const seen = new Set();
  for (let at = addr; at; at = nodes[at]?.parent) {
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return true;
}

/** Every descendant of `addr`, depth first, with the tree lines drawn before each.
 *  `keep(node)` leaves a sub-agent (and what it started) out when false. */
export function descendants(roster, addr, keep = null, lead = [], seen = new Set()) {
  const list = (roster.kids[addr] ?? []).filter((k) => !seen.has(k) && (!keep || keep(roster.nodes[k])));
  return list.flatMap((k, i) => {
    seen.add(k);
    const last = i === list.length - 1;
    return [{ node: roster.nodes[k], lines: [...lead, last ? "└" : "├"] }, ...descendants(roster, k, keep, [...lead, last ? "" : "│"], seen)];
  });
}

/** The most urgent status of an agent and its live sub-agents (what its rail group is). */
export function urgentStatus(roster, addr) {
  const all = [roster.nodes[addr], ...descendants(roster, addr).map((d) => d.node)].filter((n) => n.state === "live");
  return all.reduce((best, n) => ((RANK[n.status] ?? 0) > (RANK[best] ?? 0) ? n.status : best), roster.nodes[addr].status);
}

/** Addresses from `addr` up to its root, nearest parent first. */
export function ancestors(roster, addr) {
  const out = [];
  for (let at = roster.nodes[addr]?.parent; at && !out.includes(at); at = roster.nodes[at]?.parent) out.push(at);
  return out;
}

/** Sub-agents of `parent` started while a shell call ran (`hc run ...` inside it). */
export function startedBy(roster, parent, call) {
  if (!call?.ts || !/\bhc\s+run\b/.test(JSON.stringify(call.input ?? ""))) return [];
  // A call that never got a result (interrupted) only claims what started right after it.
  const until = call.result?.ts ?? call.ts + 120000;
  return (roster.kids[parent] ?? []).map((k) => roster.nodes[k]).filter((n) => n.created && n.created >= call.ts - 1500 && n.created <= until + 1500);
}
