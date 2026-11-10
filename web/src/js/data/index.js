// The page's store, in the shape the views read: agents, calls, prompts, replies (with their
// links) and changed files. data/real.js rebuilds it whenever herdr or a transcript changes.

let DB = emptyStore();

function emptyStore() {
  return { roster: { nodes: {}, kids: {}, roots: [] }, agents: [], calls: [], prompts: [], replies: [], files: [], agentIndex: new Map(), callIndex: new Map(), callsByAgent: new Map(), byAgent: new Map() };
}

const agentById = (id) => DB.agentIndex.get(id) ?? null;
const callById = (id) => DB.callIndex.get(id) ?? null;
const callsOf = (id) => DB.callsByAgent.get(id) ?? [];
const childCalls = () => [];
const promptsOf = (id) => DB.byAgent.get(id)?.prompts ?? [];
const repliesOf = (id) => DB.byAgent.get(id)?.replies ?? [];
const filesOf = (id) => DB.byAgent.get(id)?.files ?? [];

// Every link of an agent, told apart by who brought it: `from` is "agent" (in a reply) or
// "user" (in a prompt); `src` and `srcN` name that reply or prompt.
const linksOf = (id) => [
  ...repliesOf(id).flatMap((r) => r.links.map((l) => ({ ...l, from: "agent", agent: r.agent, reply: r.n, srcN: r.n, turn: r.turn, replyTs: r.ts, key: `${r.agent}:${r.n}:${l.n}` }))),
  ...promptsOf(id).flatMap((p) => (p.links ?? []).map((l) => ({ ...l, from: "user", agent: p.agent, reply: null, srcN: p.n, turn: p.n, replyTs: p.ts, key: `${p.agent}:p${p.n}:${l.n}` }))),
];

const allLinks = () => DB.agents.flatMap((a) => linksOf(a.id));

const fileStats = (f) => ({ add: f.add ?? 0, del: f.del ?? 0, lock: false });

function agentStats(id) {
  const files = filesOf(id);
  const calls = callsOf(id);
  return {
    calls: calls.length,
    errors: calls.filter((c) => c.status === "error").length,
    links: linksOf(id).length,
    prompts: promptsOf(id).filter((p) => LS.isHumanPrompt(p)).length,
    files: files.length,
    add: sum(files, (f) => f.add),
    del: sum(files, (f) => f.del),
  };
}

// What the agent is doing now: a pending approval, a running call, else its last call.
function currentCall(id) {
  const calls = callsOf(id);
  return calls.find((c) => c.status === "pending") || [...calls].reverse().find((c) => c.status === "running") || calls[calls.length - 1] || null;
}

const STATUS_RANK = { blocked: 5, done: 4, working: 3, idle: 2, offline: 1, running: 1, ended: 0 };
const STATUS_LABEL = { blocked: "응답 필요", done: "완료", working: "작업 중", idle: "대기", offline: "연결 필요", running: "실행 중", ended: "끝남" };

// Sub-agents: terminals an agent started with `hc run` (the mod's lib/tree.js walks the tree).
const subsOf = (id) => LTR.descendants(DB.roster, id);
const parentsOf = (id) => LTR.ancestors(DB.roster, id);
