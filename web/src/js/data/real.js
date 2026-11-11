// Live data from bin/server.py: herdr's agents, and each one's transcript read incrementally
// and reduced with the mod's lib/session.js (the same events the herdr mod reads).

const LIVE = {
  token: takeToken(),
  agents: [],
  spaces: [],
  spacesAt: 0,
  lastFocus: null,
  me: null,
  sessions: {},
  synced: {},
  busy: new Set(),
  home: "",
  error: null,
  agentsAt: 0,
  ticking: false,
  held: false,
  pending: false,
  link: null,
};

// The mod opens this page with #t=<token>&agent=…&lens=…&call=…; keep the token, drop it from the URL.
function takeToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("t");
  try {
    if (token) sessionStorage.setItem("agent-dash-token", token);
    return token || sessionStorage.getItem("agent-dash-token");
  } catch {
    return token;
  }
}

function deepLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const link = { agent: params.get("agent"), lens: params.get("lens"), call: params.get("call") };
  if (params.has("t")) history.replaceState(null, "", location.pathname + location.search);
  return link;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path) {
  const response = await fetch(path, { headers: { "X-Agent-Dash-Token": LIVE.token ?? "" }, cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, response.status === 401 ? "토큰이 맞지 않아요" : `서버 응답 ${response.status}`);
  return response;
}

function parseEvents(text) {
  const events = [];
  let end = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.k === "end") end = event;
      else events.push(event);
    } catch {
      // A cut line: the next read starts from the last complete one.
    }
  }
  return { events, end };
}

// Spaces with their logos (the mod writes them when it opens this page); read now and then.
async function loadSpaces() {
  if (Date.now() - LIVE.spacesAt < 30000) return false;
  LIVE.spacesAt = Date.now();
  // Your own picture for the chat view, asked once.
  // (An older server answers with an error instead: ask again later, after it has been restarted.)
  if (LIVE.me === null) LIVE.me = await api("/api/me").then((r) => r.json()).then((body) => ("avatar" in body ? body : null)).catch(() => null);
  try {
    const body = await (await api("/api/spaces")).json();
    const next = body.spaces ?? [];
    const changed = JSON.stringify(next) !== JSON.stringify(LIVE.spaces);
    LIVE.spaces = next;
    return changed;
  } catch {
    return false;
  }
}

// Herdr's focus drives the page: when the agent in focus there changes, show that one. The first
// reading only records it, so a link that opened a specific agent keeps it.
async function followFocus() {
  if (!STATE.followFocus) {
    LIVE.lastFocus = null;
    return false;
  }
  const at = (await (await api("/api/focus-state")).json()).agent;
  if (!at || at === LIVE.lastFocus) return false;
  const first = LIVE.lastFocus === null;
  LIVE.lastFocus = at;
  if (first || at === STATE.scope || !LIVE.agents.some((a) => a.address === at && a.provider)) return false;
  go({ concept: "A", scope: at });
  return true;
}

async function loadAgents() {
  const spacesChanged = await loadSpaces();
  const body = await (await api("/api/agents")).json();
  const before = new Map(LIVE.agents.map((a) => [a.address, a.status]));
  LIVE.agents = body.agents ?? [];
  LIVE.home = body.home ?? LIVE.home;
  for (const a of LIVE.agents) {
    const was = before.get(a.address);
    if (was && was !== a.status) notifyStatus(a);
  }
  return spacesChanged || LIVE.agents.some((a) => before.get(a.address) !== a.status) || before.size !== LIVE.agents.length;
}

// Same cadence as the herdr mod: the agent on screen often, the rest gently.
function readEvery(a) {
  const selected = STATE.scope === a.address;
  const fleet = STATE.scope === "all";
  // A finished sub-agent's transcript is complete; the selected agent's sub-agents are read too.
  if (a.state === "ended") return LIVE.sessions[a.address]?.loaded && (LIVE.synced[a.address] ?? 0) > (a.finished_ms ?? 0) + 1000 ? 300000 : 2000;
  if (!selected && !fleet && parentsOf(a.address).includes(STATE.scope)) return a.status === "working" ? 2500 : 15000;
  if (selected) return a.status === "working" ? 1500 : 5000;
  if (fleet) return a.status === "working" ? 4000 : 20000;
  return a.status === "working" ? 12000 : 60000;
}

async function syncAgent(a) {
  LIVE.busy.add(a.address);
  LIVE.synced[a.address] = Date.now();
  let changed = false;
  try {
    for (let chunk = 0; chunk < 40; chunk++) {
      const prev = LIVE.sessions[a.address];
      const current = prev && prev.provider === a.provider && !prev.note ? prev : LS.emptySession(a.provider);
      const query = `agent=${encodeURIComponent(a.address)}&file=${encodeURIComponent(current.file ?? "-")}&offset=${current.offset}`;
      const { events, end } = parseEvents(await (await api(`/api/session?${query}`)).text());
      if (!end) break;
      if (events[0]?.k === "missing") {
        if (prev?.note !== "missing") changed = true;
        LIVE.sessions = { ...LIVE.sessions, [a.address]: { ...LS.emptySession(a.provider), loaded: true, note: "missing" } };
        break;
      }
      const fresh = events[0]?.k === "file";
      const base = fresh ? LS.emptySession(a.provider, events[0]) : end.reset ? LS.emptySession(a.provider, current) : current;
      const next = LS.applyBatch(base, fresh ? events.slice(1) : events, end);
      if (events.length || fresh || !prev?.loaded) {
        LIVE.sessions = { ...LIVE.sessions, [a.address]: next };
        if (prev?.loaded && next.calls.length > prev.calls.length) onNewCall({ id: next.calls[next.calls.length - 1].id, agent: a.address });
        changed = true;
      }
      if (!end.more) break;
    }
  } finally {
    LIVE.busy.delete(a.address);
  }
  return changed;
}

async function tick() {
  if (LIVE.ticking || !LIVE.token) return;
  LIVE.ticking = true;
  let changed = false;
  try {
    if (Date.now() - LIVE.agentsAt > 2500) {
      changed = (await loadAgents()) || changed;
      LIVE.agentsAt = Date.now();
    }
    changed = (await followFocus().catch(() => false)) || changed;
    const due = LIVE.agents.filter((a) => a.provider && !LIVE.busy.has(a.address) && Date.now() - (LIVE.synced[a.address] ?? 0) >= readEvery(a));
    const results = await Promise.all(due.map((a) => syncAgent(a).catch(() => false)));
    changed = results.some(Boolean) || changed;
    if (LIVE.error) changed = true;
    LIVE.error = null;
  } catch (error) {
    changed = changed || String(LIVE.error) !== String(error);
    LIVE.error = error;
  } finally {
    LIVE.ticking = false;
  }
  if (changed) refresh();
  applyDeepLink();
}

function refresh() {
  DB = buildStore();
  if (LIVE.held) LIVE.pending = true;
  else renderAll();
}

// A re-render under a pressed pointer would swallow the click: wait for release.
document.addEventListener("pointerdown", () => {
  LIVE.held = true;
});
const releasePointer = () => {
  LIVE.held = false;
  if (LIVE.pending) {
    LIVE.pending = false;
    setTimeout(renderAll, 0);
  }
};
document.addEventListener("pointerup", releasePointer);
document.addEventListener("pointercancel", releasePointer);

function applyDeepLink() {
  const link = LIVE.link;
  if (!link || !link.agent || !agentById(link.agent)) return;
  if (link.call && !callById(link.call) && !LIVE.sessions[link.agent]?.loaded) return;
  LIVE.link = null;
  go({ scope: link.agent, lens: link.lens || (link.call ? "tools" : "overview"), select: link.call && callById(link.call) ? ["call", link.call] : null });
}

const lookingAt = (id) => document.visibilityState === "visible" && STATE.scope === id;

function notifyStatus(a) {
  if (lookingAt(a.address) || a.sub) return;
  const title = a.title || a.address;
  if (a.status === "blocked") {
    toast({ title: `응답 필요 · ${title}`, body: esc(a.msg || "에이전트가 답을 기다려요"), kind: "blocked", action: { label: "보기", run: () => go({ scope: a.address, lens: "overview" }) }, timeout: 8000 });
  } else if (a.status === "done") {
    toast({ title: `완료 · ${title}`, body: "보고 있지 않을 때 끝났어요.", kind: "done", action: { label: "열기", run: () => go({ scope: a.address, lens: "overview" }) } });
  }
}

// ---------- the views' shapes ----------

const PART_MEMO = new WeakMap();

function windowOf(s) {
  if (s?.win) return s.win;
  if (/\[1m\]|1m/i.test(s?.model ?? "") || (s?.ctx ?? 0) > 200000) return 1000000;
  return 200000;
}

const BADGE_CLS = { pr: "pr", issue: "issue", adv: "adv", pkg: "pkg" };

function sessionPart(a, s) {
  const hit = PART_MEMO.get(s);
  if (hit && hit.status === a.status) return hit.value;
  const ms = (ts) => (ts - T0) / 1000;
  const calls = LS.visibleCalls(s).map((c) => {
    const end = c.result?.ts ?? null;
    const dur = c.result?.extra?.ms != null ? c.result.extra.ms / 1000 : end && c.ts ? Math.max(0, (end - c.ts) / 1000) : null;
    return { ...c, agent: a.address, status: LS.callStatus(c, s, a.status), dur, endTs: end, t: ms(c.ts) };
  });
  const linksByReply = groupBy(s.links.filter((l) => l.from !== "user"), (l) => l.reply);
  const linksByPrompt = groupBy(s.links.filter((l) => l.from === "user"), (l) => l.prompt);
  const value = {
    calls,
    // Links the person handed over in a prompt (the agent's are on its replies, below).
    prompts: s.prompts.map((p) => ({
      ...p, agent: a.address, t: ms(p.ts),
      links: (linksByPrompt[p.n] ?? []).map((l, k) => ({ url: l.url, label: l.label, title: l.title, context: l.context, local: l.local, n: k + 1, badge: l.badge ? { cls: BADGE_CLS[l.badge.kind] ?? "", text: l.badge.text } : null })),
    })),
    replies: s.replies.map((r) => ({
      ...r,
      agent: a.address,
      t: ms(r.ts),
      links: (linksByReply[r.n] ?? []).map((l, k) => ({ url: l.url, label: l.label, title: l.title, context: l.context, local: l.local, n: k + 1, badge: l.badge ? { cls: BADGE_CLS[l.badge.kind] ?? "", text: l.badge.text } : null })),
    })),
    files: LS.changedFiles(s).map((f) => ({ ...f, agent: a.address, abs: f.path, path: LP.relPath(f.path, a.cwd, LIVE.home), key: `${a.address}:${f.path}` })),
  };
  PART_MEMO.set(s, { status: a.status, value });
  return value;
}

function adaptAgent(a, s) {
  const u = s?.usage ?? { in: 0, out: 0, cr: 0, cw: 0 };
  return {
    id: a.address,
    title: (a.sub ? a.name || a.title : LTR.agentName(a.tab, a.title)) || s?.customTitle || s?.title || (a.provider === "codex" ? "Codex" : a.provider === "claude" ? "Claude Code" : a.program || a.address),
    summary: a.sub ? "" : a.title || "",
    app: a.provider === "codex" ? "codex" : a.provider === "claude" ? "claude" : a.app || "program",
    address: a.address,
    parent: a.parent ?? null,
    sub: !!a.sub,
    state: a.state ?? "live",
    isAgent: !!a.app,
    task: a.task ?? null,
    command: a.command ?? "",
    created: a.created_ms ?? null,
    finished: a.finished_ms ?? null,
    exit: a.exit_code ?? null,
    reason: a.reason ?? null,
    provider: a.provider,
    model: s?.model ?? "",
    space: a.space ?? "",
    tab: a.tab ?? "",
    machine: a.machine ?? null,
    cwd: LP.tildePath(a.cwd ?? s?.cwd ?? "", LIVE.home),
    cwdAbs: a.cwd ?? s?.cwd ?? null,
    branch: a.branch ?? null,
    status: a.status ?? "idle",
    sinceTs: a.status_ms ?? Date.now(),
    unseen: a.status === "done" && !a.sub,
    msg: a.msg ?? null,
    tokens: { input: u.in, output: u.out, cacheRead: u.cr, cacheWrite: u.cw },
    context: { used: s?.ctx ?? 0, limit: windowOf(s) },
    inferred: !!s?.inferred,
    note: s?.note ?? null,
    loaded: !!s?.loaded,
    compacts: s?.compacts?.length ?? 0,
  };
}

function buildRoster(agents) {
  const nodes = Object.fromEntries(agents.map((a) => [a.id, a]));
  const kids = {};
  for (const a of agents) {
    if (!a.parent || !nodes[a.parent] || a.parent === a.id) continue;
    kids[a.parent] = [...(kids[a.parent] ?? []), a.id];
  }
  const age = (id) => (nodes[id].state === "live" ? nodes[id].created ?? 0 : (nodes[id].finished ?? 0) + 1e15);
  for (const k of Object.keys(kids)) kids[k] = kids[k].sort((x, y) => age(x) - age(y));
  const roots = agents.filter((a) => !a.parent || !nodes[a.parent] || a.parent === a.id).map((a) => a.id);
  return { nodes, kids, roots };
}

function buildStore() {
  const store = emptyStore();
  store.roster = buildRoster(LIVE.agents.map((a) => adaptAgent(a, LIVE.sessions[a.address])));
  for (const a of LIVE.agents) {
    const s = LIVE.sessions[a.address];
    const agent = store.roster.nodes[a.address];
    store.agents.push(agent);
    store.agentIndex.set(agent.id, agent);
    const part = s ? sessionPart(a, s) : { calls: [], prompts: [], replies: [], files: [] };
    store.byAgent.set(agent.id, part);
    store.callsByAgent.set(agent.id, part.calls);
    for (const c of part.calls) store.callIndex.set(c.id, c);
    store.calls.push(...part.calls);
    store.prompts.push(...part.prompts);
    store.replies.push(...part.replies);
    store.files.push(...part.files);
  }
  return store;
}

function startLive() {
  LIVE.link = deepLink();
  tick();
  setInterval(tick, 1500);
}
