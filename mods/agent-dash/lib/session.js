// One agent's session, built from the reader's events. Every batch returns a new object;
// nothing a view holds is changed underneath it.
//
// Mods run on QuickJS (no JIT), so anything a render needs (links, changed files, token
// totals, per-turn counts) is accumulated here, a batch at a time, instead of being
// recomputed from every call on every frame.

import { editStats } from "./tools.js";
import { extractLinks } from "./links.js";

export function emptySession(provider, found = {}) {
  return {
    provider,
    file: found.path ?? found.file ?? null,
    session: found.session ?? null,
    inferred: !!found.inferred,
    offset: 0,
    size: 0,
    loaded: false,
    note: null,
    error: null,
    model: null,
    title: null,
    customTitle: null,
    cwd: null,
    version: null,
    prompts: [],
    replies: [],
    thoughts: [],
    lastTs: null,
    calls: [],
    callIx: {},
    usageByMsg: {},
    usage: { in: 0, out: 0, cr: 0, cw: 0, rs: 0 },
    ctx: null,
    win: null,
    turnDur: {},
    turnCalls: {},
    interrupts: [],
    compacts: [],
    links: [],
    files: {},
    wrappers: 0,
    rev: 0,
  };
}

const inner = (text, tag) => (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)(?:</${tag}>|$)`).exec(text)?.[1] ?? "").trim();

/** What a user-side message is: typed by the person, or put there by a tool on their behalf.
 *  {kind: prompt | command | paste | shell | answer | notice, display: text for lists}. */
export function classifyPrompt(text, command = false) {
  const s = String(text ?? "").trim();
  if (command) return { kind: "command", display: s };
  if (s.startsWith("<send_user_message_question_reply>")) return { kind: "answer", display: "질문에 답함" };
  if (s.startsWith("<task-notification>")) return { kind: "notice", display: inner(s, "summary") || `백그라운드 작업 ${inner(s, "status") || "알림"}` };
  if (s.startsWith("<hc>")) return { kind: "notice", display: inner(s, "hc") };
  // A message through hc: a sub-agent's report (`<hc from="t7 review">`), or the task a parent sent.
  const viaHc = /^<hc\s+from="([^"]*)"[^>]*>([\s\S]*?)(?:<\/hc>|$)/.exec(s);
  if (viaHc) return { kind: "notice", display: `${viaHc[1]} → ${viaHc[2].trim()}`, from: viaHc[1] };
  if (s.startsWith("<pasted_content")) return { kind: "paste", display: inner(s, "pasted_content") };
  if (s.startsWith("<bash-input>")) return { kind: "shell", display: `! ${inner(s, "bash-input")}` };
  return { kind: "prompt", display: s };
}

/** Prompts the person wrote (not notices or answers to the agent's questions). */
export const isHumanPrompt = (p) => p.kind !== "notice" && p.kind !== "answer";
const EDITORS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"]);

function addUsage(total, u, sign) {
  return { in: total.in + sign * (u.in ?? 0), out: total.out + sign * (u.out ?? 0), cr: total.cr + sign * (u.cr ?? 0), cw: total.cw + sign * (u.cw ?? 0), rs: total.rs };
}

function touchFile(files, path, call, stats, status) {
  const prev = files[path] ?? { path, status, add: 0, del: 0, edits: 0, first: call.ts, last: call.ts, calls: [] };
  files[path] = {
    ...prev,
    status: prev.status === "A" ? "A" : status,
    add: prev.add + stats.add,
    del: prev.del + stats.del,
    edits: prev.edits + 1,
    last: call.ts,
    calls: prev.calls.concat(call.id),
  };
}

// A finished edit-like call updates the changed-files table.
function recordEdit(files, call) {
  if (!EDITORS.has(call.name) || !call.result || call.result.err) return;
  if (call.name === "apply_patch") {
    for (const [path, change] of Object.entries(call.input?.changes ?? {})) {
      const lines = String(change.diff ?? "").split("\n");
      const stats = { add: lines.filter((l) => l[0] === "+").length, del: lines.filter((l) => l[0] === "-").length };
      touchFile(files, path, call, stats, change.type === "add" ? "A" : change.type === "delete" ? "D" : "M");
    }
    return;
  }
  const path = call.input?.file_path ?? call.input?.notebook_path;
  if (!path) return;
  const created = call.name === "Write" && call.result.extra?.type === "create";
  touchFile(files, path, call, editStats(call), created ? "A" : "M");
}

// The events whose time says when the agent last did something (a thought's length is measured from it).
const CLOCKED = new Set(["prompt", "reply", "call", "result", "think"]);

function applyOne(acc, e) {
  const turn = acc.prompts.length;
  switch (e.k) {
    case "prompt":
      const kind = classifyPrompt(e.text, !!e.command);
      acc.prompts.push({ n: acc.prompts.length + 1, id: e.id, ts: e.ts, text: e.text ?? "", images: e.images ?? 0, at: e.at ?? null, command: !!e.command, kind: kind.kind, display: kind.display, answer: kind.kind === "answer" });
      // Links the person handed over (not notices or tool answers put there on their behalf).
      if (kind.kind !== "notice" && kind.kind !== "answer" && /https?:\/\/|\]\(/.test(e.text ?? "")) {
        const n = acc.prompts.length;
        for (const link of extractLinks({ text: e.text ?? "" })) acc.links.push({ ...link, from: "user", prompt: n, reply: null, turn: n, ts: e.ts, key: `p${n}:${link.url}` });
      }
      break;
    case "reply": {
      const reply = { n: acc.replies.length + 1, turn, id: e.id, ts: e.ts, text: e.text ?? "", phase: e.phase ?? null };
      acc.replies.push(reply);
      for (const link of extractLinks(reply)) acc.links.push({ ...link, from: "agent", reply: reply.n, turn, ts: reply.ts, key: `${reply.n}:${link.url}` });
      break;
    }
    case "think": {
      // How long it thought: the time since whatever happened just before (a result, a prompt).
      const before = acc.scalars.lastTs;
      const dur = before && e.ts && e.ts > before && e.ts - before < 30 * 60 * 1000 ? e.ts - before : null;
      acc.thoughts.push({ n: acc.thoughts.length + 1, turn, ts: e.ts, text: e.text ?? "", dur, before: acc.replies.length + 1 });
      break;
    }
    case "call":
      if (acc.callIx[e.id] == null) {
        acc.callIx[e.id] = acc.calls.length;
        acc.calls.push({ id: e.id, seq: acc.calls.length, turn, ts: e.ts, name: e.name, input: e.input ?? {}, side: !!e.side, wrapper: !!e.wrapper, result: null });
        acc.turnCalls[turn] = (acc.turnCalls[turn] ?? 0) + 1;
        if (e.wrapper) acc.scalars.wrappers += 1;
      }
      break;
    case "result": {
      const ix = acc.callIx[e.id];
      if (ix == null) break;
      const call = { ...acc.calls[ix], result: { ts: e.ts, text: e.text ?? "", err: !!e.err, images: e.images ?? 0, extra: e.extra ?? null } };
      acc.calls[ix] = call;
      recordEdit(acc.files, call);
      break;
    }
    case "usage": {
      const prev = acc.usageByMsg[e.id];
      const next = { in: e.in ?? 0, out: e.out ?? 0, cr: e.cr ?? 0, cw: e.cw ?? 0, side: !!e.side };
      if (prev) acc.scalars.usage = addUsage(acc.scalars.usage, prev, -1);
      acc.scalars.usage = addUsage(acc.scalars.usage, next, 1);
      acc.usageByMsg[e.id] = next;
      if (!e.side) acc.scalars.ctx = next.in + next.cr + next.cw;
      if (e.model) acc.scalars.model = e.model;
      break;
    }
    case "total":
      acc.scalars.usage = { in: e.in ?? 0, out: e.out ?? 0, cr: e.cr ?? 0, cw: e.cw ?? 0, rs: e.rs ?? 0 };
      if (e.ctx != null) acc.scalars.ctx = e.ctx;
      if (e.win != null) acc.scalars.win = e.win;
      break;
    case "turnstart":
      if (e.win != null) acc.scalars.win = e.win;
      break;
    case "turn":
      acc.turnDur[turn] = (acc.turnDur[turn] ?? 0) + (e.dur ?? 0);
      break;
    case "interrupt":
      acc.interrupts.push(e.ts);
      break;
    case "compact":
      acc.compacts.push(e.ts);
      break;
    case "model":
      acc.scalars.model = e.model;
      break;
    case "meta":
      acc.scalars.cwd = e.cwd ?? acc.scalars.cwd;
      acc.scalars.version = e.version ?? acc.scalars.version;
      break;
    case "title":
      if (e.kind === "custom-title") acc.scalars.customTitle = e.text;
      else acc.scalars.title = e.text;
      break;
    default:
      break;
  }
}

/** Applies one read's events (`end` excluded) and its end record. */
export function applyBatch(state, events, end) {
  const acc = {
    prompts: state.prompts.slice(),
    replies: state.replies.slice(),
    thoughts: (state.thoughts ?? []).slice(),
    calls: state.calls.slice(),
    callIx: { ...state.callIx },
    usageByMsg: { ...state.usageByMsg },
    turnDur: { ...state.turnDur },
    turnCalls: { ...state.turnCalls },
    interrupts: state.interrupts.slice(),
    compacts: state.compacts.slice(),
    links: state.links.slice(),
    files: { ...state.files },
    scalars: {
      model: state.model, title: state.title, customTitle: state.customTitle, cwd: state.cwd, version: state.version,
      usage: state.usage, ctx: state.ctx, win: state.win, wrappers: state.wrappers, lastTs: state.lastTs ?? null,
    },
  };
  for (const e of events) {
    applyOne(acc, e);
    if (e.ts && CLOCKED.has(e.k)) acc.scalars.lastTs = e.ts;
  }
  const { scalars, ...lists } = acc;
  return {
    ...state,
    ...lists,
    ...scalars,
    offset: end?.offset ?? state.offset,
    size: end?.size ?? state.size,
    loaded: state.loaded || !end?.more,
    rev: state.rev + (events.length ? 1 : 0),
  };
}

// ---------- reading a session (cheap; the store caches per revision) ----------

export const usageTotals = (s) => s.usage;

const lastOpenMemo = new WeakMap();

// The newest call still without a result (usually within the last few calls).
function lastOpenId(s) {
  if (lastOpenMemo.has(s)) return lastOpenMemo.get(s);
  let id = null;
  for (let i = s.calls.length - 1; i >= 0; i--) {
    if (!s.calls[i].result) {
      id = s.calls[i].id;
      break;
    }
  }
  lastOpenMemo.set(s, id);
  return id;
}

/** Status of one call given the agent's live status. */
export function callStatus(call, s, agentStatus) {
  if (call.result) return call.result.err ? "error" : "ok";
  if (s.interrupts.some((ts) => ts >= call.ts)) return "interrupted";
  if (agentStatus === "blocked" && call.id === lastOpenId(s)) return "pending";
  if (agentStatus === "working" && call.turn === s.prompts.length) return "running";
  return "unknown";
}

/** Calls worth listing: Codex's exec wrappers only while nothing finer reports for them. */
export function visibleCalls(s) {
  if (!s.wrappers) return s.calls;
  const out = [];
  for (let i = 0; i < s.calls.length; i++) {
    const c = s.calls[i];
    if (!c.wrapper || !c.result) {
      out.push(c);
      continue;
    }
    let inner = false;
    for (let j = i + 1; j < s.calls.length && !inner; j++) {
      const o = s.calls[j];
      if (o.ts > c.result.ts) break;
      if (!o.wrapper) inner = true;
    }
    if (!inner) out.push(c);
  }
  return out;
}

/** Files the agent changed, newest first. */
export const changedFiles = (s) => Object.values(s.files).sort((a, b) => b.last - a.last);

/** Links from every reply, newest first. */
export const sessionLinks = (s) => s.links.slice().reverse();

/** One entry per prompt: {prompt, calls (count), start, dur}. Cheap: counts are kept per turn. */
export function turnsOf(s) {
  return s.prompts.map((prompt, i) => {
    const next = s.prompts[i + 1];
    return { prompt, calls: s.turnCalls[prompt.n] ?? 0, start: prompt.ts, next: next?.ts ?? null, dur: s.turnDur[prompt.n] ?? null };
  });
}

/** The calls and replies of one turn, for the prompt view (one pass). */
export function turnDetail(s, n) {
  const calls = [];
  for (const c of s.calls) if (c.turn === n) calls.push(c);
  // Each answer carries what the agent thought on the way to it; thoughts after the last answer trail.
  const thoughts = (s.thoughts ?? []).filter((x) => x.turn === n);
  const replies = s.replies.filter((r) => r.turn === n).map((r) => ({ ...r, thoughts: thoughts.filter((x) => x.before === r.n) }));
  const trailing = thoughts.filter((x) => !replies.some((r) => r.n === x.before));
  const files = new Map();
  for (const c of calls) {
    const path = c.input?.file_path;
    if (path && EDITORS.has(c.name) && c.result && !c.result.err) {
      const st = editStats(c);
      const prev = files.get(path) ?? { path, add: 0, del: 0 };
      files.set(path, { path, add: prev.add + st.add, del: prev.del + st.del });
    }
    for (const [path] of Object.entries(c.name === "apply_patch" ? c.input?.changes ?? {} : {})) files.set(path, files.get(path) ?? { path, add: 0, del: 0 });
  }
  const end = Math.max(s.prompts[n - 1]?.ts ?? 0, calls.length ? calls[calls.length - 1].result?.ts ?? calls[calls.length - 1].ts : 0, replies.length ? replies[replies.length - 1].ts : 0);
  return { calls, replies, trailing, files: [...files.values()], end };
}
