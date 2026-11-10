// Sessions for herdr's agents: which transcript each one writes, read incrementally.
// The view owns one store; every update replaces the session object it changes.

import { syncTranscript } from "./reader.js";
import { emptySession, applyBatch, visibleCalls, changedFiles, sessionLinks, turnsOf, usageTotals } from "../lib/session.js";
import { countKinds } from "../lib/tools.js";

const MAX_CHUNKS = 40;

export function providerOf(agent) {
  const app = `${agent?.app ?? ""} ${agent?.program?.key ?? ""}`.toLowerCase();
  if (app.includes("claude")) return "claude";
  if (app.includes("codex")) return "codex";
  return null;
}

const blank = (provider, note) => ({ ...emptySession(provider), loaded: true, note });

export class SessionStore {
  constructor() {
    this.sessions = {};
    this.busy = new Set();
    this.synced = {};
    this.memo = new WeakMap();
  }

  get(address) {
    return this.sessions[address] ?? null;
  }

  set(address, session) {
    this.sessions = { ...this.sessions, [address]: session };
  }

  /** Lists and stats computed once per session revision. */
  derived(session) {
    if (!session) return null;
    const hit = this.memo.get(session);
    if (hit) return hit;
    const calls = visibleCalls(session);
    const value = {
      calls,
      kinds: countKinds(calls),
      files: changedFiles(session),
      links: sessionLinks(session),
      turns: turnsOf(session),
      usage: usageTotals(session),
    };
    this.memo.set(session, value);
    return value;
  }

  /** How long to wait between reads of one agent. `near`: a sub-agent of the selected one. */
  interval(agent, { selected, fleet, near }) {
    // A finished sub-agent's transcript is complete: one read, then a rare look.
    if (agent.state === "ended") {
      // One more read after it exited picks up its last steps; then only a rare look.
      const final = this.get(agent.address)?.loaded && (this.synced[agent.address] ?? 0) > (agent.finished ?? 0) + 1000;
      return final ? 300000 : 2000;
    }
    if (selected) return agent.status === "working" ? 1500 : 5000;
    if (near) return agent.status === "working" ? 2500 : 15000;
    if (fleet) return agent.status === "working" ? 4000 : 20000;
    return agent.status === "working" ? 12000 : 60000;
  }

  due(agent, now, opts) {
    if (this.busy.has(agent.address)) return false;
    const last = this.synced[agent.address] ?? 0;
    return now - last >= this.interval(agent, opts);
  }

  /** Reads what the agent's transcript gained since last time; notifies after each chunk. */
  async sync(agent, terminal, cx) {
    const address = agent.address;
    if (this.busy.has(address)) return;
    this.busy.add(address);
    this.synced = { ...this.synced, [address]: Date.now() };
    try {
      await this.readAll(agent, terminal, cx);
    } catch (error) {
      const prev = this.get(address) ?? emptySession(providerOf(agent));
      this.set(address, { ...prev, loaded: true, error: String(error?.message ?? error) });
      cx.notify();
    } finally {
      this.busy.delete(address);
    }
  }

  async readAll(agent, terminal, cx) {
    const address = agent.address;
    const provider = providerOf(agent);
    if (!provider) return this.settle(address, blank(null, "unsupported"), cx);
    if (address.includes("/")) return this.settle(address, blank(provider, "remote"), cx);
    const pid = terminal?.foreground?.pid ?? (agent.sub ? terminal?.pid : null);
    const cwd = terminal?.foreground?.cwd ?? terminal?.cwd ?? null;
    if (!pid) return this.settle(address, blank(provider, "nopid"), cx);
    // A sub-agent is matched by when it started and what it was asked: it often shares its
    // parent's folder, and once it exits its process can't be asked any more.
    const hints = agent.sub && agent.created
      ? { since: agent.created, until: agent.finished ?? undefined, dead: agent.state === "ended" || undefined, task: agent.task?.slice(0, 200) ?? undefined }
      : null;
    for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
      const prev = this.get(address);
      const current = prev && prev.provider === provider && !prev.note ? prev : emptySession(provider);
      const { events, end } = await syncTranscript({ provider, pid, cwd, file: current.file, offset: current.offset, hints });
      if (!end) throw new Error("기록을 끝까지 읽지 못했어요");
      if (events[0]?.k === "missing") return this.settle(address, blank(provider, "missing"), cx);
      const fresh = events[0]?.k === "file";
      const base = fresh ? emptySession(provider, events[0]) : end.reset ? emptySession(provider, current) : current;
      const next = applyBatch({ ...base, error: null }, fresh ? events.slice(1) : events, end);
      if (next !== prev) this.set(address, next);
      if (events.length || fresh || !prev?.loaded) cx.notify();
      if (!end.more) return;
    }
  }

  settle(address, session, cx) {
    const prev = this.get(address);
    if (prev?.note === session.note && prev?.provider === session.provider) return;
    this.set(address, session);
    cx.notify();
  }

  /** Forget agents that are gone. */
  prune(addresses) {
    const keep = new Set(addresses);
    const kept = Object.fromEntries(Object.entries(this.sessions).filter(([a]) => keep.has(a)));
    if (Object.keys(kept).length !== Object.keys(this.sessions).length) this.sessions = kept;
  }
}
