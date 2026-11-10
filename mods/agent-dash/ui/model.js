// What each lens lists for the current scope (one agent or all), computed from the store.

import { countKinds, kindOf } from "../lib/tools.js";
import { callStatus } from "../lib/session.js";

export const callKey = (agent, call) => `call:${agent}:${call.id}`;

export function parseCallKey(key) {
  const m = /^call:(.+?):(.+)$/.exec(key ?? "");
  return m ? { agent: m[1], id: m[2] } : null;
}

/** Tool-call list items, newest first: each prompt's header above its calls (one agent),
 *  or the most recent calls of every agent (all). */
export function callItems(scope, agentsByAddr, store, kind) {
  const keep = (c) => kind === "all" || kindOf(c) === kind;
  if (scope !== "all") {
    const agent = agentsByAddr[scope];
    const session = store.get(scope);
    const d = store.derived(session);
    if (!agent || !d) return { items: [], counts: {} };
    const counts = d.kinds ?? countKinds(d.calls);
    const items = [];
    let turn = -1;
    const calls = kind === "all" ? d.calls : d.calls.filter(keep);
    const perTurn = {};
    for (const c of calls) perTurn[c.turn] = (perTurn[c.turn] ?? 0) + 1;
    // A turn's calls are contiguous, so walking backwards keeps each group whole.
    for (let i = calls.length - 1; i >= 0; i--) {
      const call = calls[i];
      if (call.turn !== turn) {
        turn = call.turn;
        const prompt = session.prompts[turn - 1] ?? null;
        items.push({ type: "turn", key: `turn:${turn}`, n: turn, prompt, count: perTurn[turn], first: items.length === 0 });
      }
      items.push({ type: "call", key: callKey(scope, call), call, agent, status: callStatus(call, session, agent.status) });
    }
    return { items, counts };
  }
  const all = [];
  const counts = {};
  for (const [address, agent] of Object.entries(agentsByAddr)) {
    const session = store.get(address);
    const d = store.derived(session);
    if (!d) continue;
    for (const [k, n] of Object.entries(d.kinds ?? countKinds(d.calls))) counts[k] = (counts[k] ?? 0) + n;
    for (const call of d.calls.slice(-200)) {
      if (keep(call)) all.push({ type: "call", key: callKey(address, call), call, agent, status: callStatus(call, session, agent.status), showAgent: true });
    }
  }
  all.sort((a, b) => (b.call.ts ?? 0) - (a.call.ts ?? 0));
  return { items: all.slice(0, 400), counts };
}


/** The selected call for a scope, falling back to the newest one. */
export function findCall(items, key) {
  const calls = items.filter((it) => it.type === "call");
  return calls.find((it) => it.key === key) ?? null;
}

export function neighbor(items, key, step) {
  const calls = items.filter((it) => it.type === "call");
  const ix = calls.findIndex((it) => it.key === key);
  if (ix < 0) return calls[step > 0 ? 0 : calls.length - 1]?.key ?? null;
  return calls[Math.max(0, Math.min(calls.length - 1, ix + step))]?.key ?? key;
}
