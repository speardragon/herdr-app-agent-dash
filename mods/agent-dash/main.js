// Agent Dash: a control room for herdr's agents. Pick an agent on the left (or 전체 현황),
// then read what it did through five lenses: overview, tool calls, links, prompts, changes.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, h_resizable, resizable_panel, VirtualListScrollHandle } from "gpui-base";
import { agents, terminals, panes, machines, spaces, shared, home, run, notify, setAgentOrder, nextCommand, props, closeOverlay, focused } from "herdr";
import { SessionStore } from "./data/store.js";
import * as reader from "./data/reader.js";
import { webAddress, writeSpaces } from "./data/web.js";
import { tokens, empty } from "./ui/kit.js";
import { endedTerminals } from "./data/ended.js";
import { rail, railRows, spaceOrder } from "./ui/rail.js";
import { subsLens, subCount } from "./ui/subs.js";
import { ancestors, buildRoster, startedBy } from "./lib/tree.js";
import { agentHead, fleetHead, lensTabs, LENSES } from "./ui/head.js";
import { callsLens } from "./ui/calls.js";
import { callItems, findCall, neighbor, parseCallKey } from "./ui/model.js";
import { stageView } from "./ui/stage/index.js";
import { overviewLens } from "./ui/overview.js";
import { linksLens } from "./ui/links.js";
import { promptsLens } from "./ui/prompts.js";
import { changesLens } from "./ui/changes.js";
import { callStatus, isHumanPrompt } from "./lib/session.js";
import { relPath } from "./lib/paths.js";

const TICK_MS = 1500;
const ENDED_EVERY_MS = 8000;
// How long a vanished sub-agent is kept while hc is asked about it (gone for good if `--rm`).
const GHOST_MS = 20000;

const decodeValue = (v) => (v === "true" ? true : v === "false" ? false : v != null && /^\d+$/.test(v) ? Number(v) : v);
const RAIL_WIDE = 264;
const RAIL_NARROW = 60;

export default class AgentDash extends View {
  init(_props, cx) {
    this.store = new SessionStore();
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.size = { width: 1200, height: 800 };
    this.followed = {};
    this.cache = {};
    this.ended = {};
    this.endedAt = 0;
    // How the rail groups agents ("status" | "space") and which spaces are folded: kept across opens.
    this.railGroup = this.stored("rail.group", "status") === "space" ? "space" : "status";
    this.foldedSpaces = new Set(this.stored("rail.folded", []));
    // Follow the terminal that has focus in Herdr (an agent): on by default, a switch in the rail head.
    this.followFocus = this.stored("rail.followFocus", true) !== false;
    this.lastFocus = this.state?.scope ?? null;
    this.state = {
      // Opens on the agent it was called from (the terminal that had the keyboard).
      scope: this.callerScope(),
      lens: "overview",
      sel: {},
      kind: "all",
      follow: true,
      detailOpen: false,
      ui: {},
    };
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    this.tick(cx);
    cx.spawn(async (cx) => {
      for (;;) this.onCommand(await nextCommand(), cx);
    });
  }

  /** The agent in the pane the dashboard was opened from, or "all" when that isn't an agent. */
  callerScope() {
    try {
      const at = focused();
      const candidates = [at?.agent, at?.terminal, at?.shown].filter(Boolean);
      const nodes = this.roster().nodes;
      return candidates.find((a) => nodes[a]?.isAgent) ?? "all";
    } catch {
      return "all";
    }
  }

  stored(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  }

  setFollowFocus(on, cx) {
    this.followFocus = on;
    localStorage.setItem("rail.followFocus", JSON.stringify(on));
    this.lastFocus = null; // turning it on picks up the agent focused right now
    this.syncFocus(cx);
    cx.notify();
  }

  /** The agent in focus in Herdr changed: show that one, once per change (picking another
   *  agent here is left alone until Herdr's focus moves again). */
  syncFocus(cx) {
    if (!this.followFocus) return;
    const at = this.callerScope();
    if (at === "all" || at === this.lastFocus) return;
    this.lastFocus = at;
    if (at !== this.state.scope) this.pickScope(at, cx);
  }

  setRailGroup(group, cx) {
    this.railGroup = group;
    localStorage.setItem("rail.group", JSON.stringify(group));
    cx.notify();
  }

  toggleSpace(id, cx) {
    const next = new Set(this.foldedSpaces);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.foldedSpaces = next;
    localStorage.setItem("rail.folded", JSON.stringify([...next]));
    cx.notify();
  }

  /** Agent addresses in the order the rail lists them. */
  railOrder(roster) {
    return this.railGroup === "space" ? spaceOrder(roster, spaces()) : railRows(roster).filter((r) => r.node.isAgent).map((r) => r.node.address);
  }

  update(patch, cx) {
    this.state = { ...this.state, ...patch };
    cx.notify();
  }

  // ---------- data ----------

  /** Agents and their sub-agents (live from herdr, finished ones from `hc ls --all`). */
  roster() {
    return buildRoster(agents(), terminals(), [...Object.values(this.ended), ...this.justEnded()]);
  }

  /** Sub-agents that left terminals() a moment ago and that `hc ls --all` hasn't answered for
   *  yet: kept as finished, so whoever is reading one isn't thrown out when it exits. */
  justEnded() {
    const now = Date.now();
    const live = terminals();
    const here = new Set(live.map((t) => t.address));
    const seen = { ...(this.seenSubs ?? {}) };
    for (const t of live) if (t.parent) seen[t.address] = { term: t, gone: null };
    for (const [address, entry] of Object.entries(seen)) {
      if (here.has(address)) continue;
      if (this.ended[address] || (entry.gone && now - entry.gone > GHOST_MS)) delete seen[address];
      else if (!entry.gone) {
        seen[address] = { ...entry, gone: now };
        this.endedAt = 0;
      }
    }
    this.seenSubs = seen;
    return Object.values(seen).filter((e) => e.gone).map((e) => ({ ...e.term, state: "finished", status: null, report: null, foreground: null, finished_ms: e.gone }));
  }

  allTerms() {
    const ghosts = Object.fromEntries(this.justEnded().map((t) => [t.address, t]));
    return { ...ghosts, ...this.ended, ...Object.fromEntries(terminals().map((t) => [t.address, t])) };
  }

  refreshEnded(now, cx) {
    if (this.endedBusy || now - this.endedAt < ENDED_EVERY_MS) return;
    this.endedBusy = true;
    this.endedAt = now;
    cx.spawn(async (cx) => {
      try {
        const next = await endedTerminals(this.ended);
        if (next !== this.ended) {
          this.ended = next;
          cx.notify();
        }
      } finally {
        this.endedBusy = false;
      }
    });
  }

  tick(cx) {
    // Take the keyboard once it is open, so Esc and the other keys work without a click
    // (focusing can't happen during a render, nor before the first one: the ticks after it do it).
    if (this.drawn && (this.focusTries ?? 0) < 2) {
      this.focusTries = (this.focusTries ?? 0) + 1;
      try {
        this.handle.focus();
      } catch {
        // Not drawn yet: the next tick tries again.
      }
    }
    this.syncFocus(cx);
    const now = Date.now();
    this.refreshEnded(now, cx);
    const roster = this.roster();
    const terms = this.allTerms();
    const list = Object.values(roster.nodes).filter((n) => n.isAgent);
    this.store.prune(list.map((a) => a.address));
    const scope = this.state.scope;
    const fleet = scope === "all";
    for (const agent of list) {
      const selected = agent.address === scope;
      // The selected agent's sub-agents are read too: their steps show under it.
      const near = !selected && !fleet && ancestors(roster, agent.address).includes(scope);
      if (!this.store.due(agent, now, { selected, fleet, near })) continue;
      cx.spawn(async (cx) => this.store.sync(agent, terms[agent.address], cx));
    }
  }

  // ---------- selection ----------

  selFor(scope = this.state.scope) {
    return this.state.sel[scope] ?? {};
  }

  setSel(patch, cx, scope = this.state.scope) {
    this.update({ sel: { ...this.state.sel, [scope]: { ...this.selFor(scope), ...patch } } }, cx);
  }

  pickScope(scope, cx, lens = null) {
    const node = scope === "all" ? null : this.roster().nodes[scope];
    // A plain program (no transcript) has no lenses of its own: show it under its parent.
    if (node?.sub && !node.isAgent) return this.openSub(scope, cx);
    this.listShownFor = null;
    this.update({ scope, detailOpen: false, ...(lens ? { lens } : {}) }, cx);
    this.tick(cx);
  }

  /** The 하위 에이전트 lens of whoever started `address`, with it picked. */
  openSub(address, cx) {
    const roster = this.roster();
    const owner = ancestors(roster, address).find((a) => roster.nodes[a]?.isAgent) ?? "all";
    this.update({ scope: owner, lens: "subs", detailOpen: true, sel: { ...this.state.sel, [owner]: { ...this.selFor(owner), sub: address } } }, cx);
    this.tick(cx);
  }

  pickLens(lens, cx) {
    this.listShownFor = null;
    this.update({ lens, detailOpen: false }, cx);
  }

  pickCall(key, cx) {
    if (!key?.startsWith("call:")) return;
    const latest = this.lastItems?.find((it) => it.type === "call")?.key;
    this.update({ follow: key === latest ? this.state.follow : false, detailOpen: true }, cx);
    this.setSel({ call: key }, cx);
  }

  openFile(path, cx) {
    this.update({ lens: "changes", detailOpen: true }, cx);
    this.setSel({ file: path }, cx);
  }

  /** A value loaded once per key (file texts for diffs); returns its state while loading. */
  request(key, load, cx) {
    if (this.cache[key]) return this.cache[key];
    const keep = Object.entries(this.cache).slice(-30);
    this.cache = { ...Object.fromEntries(keep), [key]: { state: "loading" } };
    cx.spawn(async (cx) => {
      try {
        const value = await load(reader);
        this.cache = { ...this.cache, [key]: { state: "ready", value } };
      } catch (error) {
        this.cache = { ...this.cache, [key]: { state: "error", error: String(error?.message ?? error) } };
      }
      cx.notify();
    });
    return this.cache[key];
  }

  ui(key, fallback) {
    return key in this.state.ui ? this.state.ui[key] : fallback;
  }

  setUi(key, value, cx) {
    this.update({ ui: { ...this.state.ui, [key]: value } }, cx);
  }

  // ---------- commands (keys.json "<key>": "agent-dash.<command>") ----------

  onCommand(command, cx) {
    const [name, arg] = String(command ?? "").split(":");
    const lens = LENSES.find((l) => l.id === name);
    if (name === "focus") this.handle.focus();
    else if (lens) this.pickLens(lens.id, cx);
    else if (name === "all") this.pickScope("all", cx);
    else if (name === "scope" && arg) this.pickScope(arg, cx);
    else if (name === "agent-next" || name === "agent-prev") this.stepAgent(name === "agent-next" ? 1 : -1, cx);
    else if (name === "call-next" || name === "call-prev") this.stepCall(name === "call-next" ? 1 : -1, cx);
    else if (name === "follow") this.update({ follow: !this.state.follow }, cx);
    else if (name === "sub" && arg) this.openSub(arg, cx);
    else if (name === "group" && (arg === "status" || arg === "space")) this.setRailGroup(arg, cx);
    else if (name === "web") this.openWeb(cx);
    else if (name === "select" && arg) {
      const key = `call:${this.state.scope}:${arg}`;
      this.update({ lens: "calls", follow: false, detailOpen: true }, cx);
      this.setSel({ call: key }, cx);
      this.scrollTo = key;
    }
    else if (name === "ui" && arg) this.setUi(arg.split("=")[0], decodeValue(arg.split("=")[1]), cx);
    cx.notify();
  }

  /** The same agent, lens and call, in the browser. */
  openWeb(cx) {
    const call = this.state.lens === "calls" ? parseCallKey(this.selFor().call)?.id ?? null : null;
    const target = { scope: this.state.scope, lens: this.state.lens, call };
    cx.spawn(async (cx) => {
      try {
        const logos = shared("space.logos") ?? {};
        const colors = shared("space.colors") ?? {};
        const url = await webAddress(target); // starts the server, which makes its .web folder
        await writeSpaces(spaces().map((sp) => ({ id: sp.id, name: sp.name, logo: logos[sp.id] ?? null, color: colors[sp.id] ?? null })));
        cx.open_url(url);
      } catch (error) {
        notify({ title: "웹에서 열지 못했어요", body: String(error?.message ?? error), level: "error" });
      }
    });
  }

  // ---------- keys ----------

  onKey(e, cx) {
    const k = e.keystroke;
    const lens = LENSES.find((l) => l.key === k);
    if (lens) return this.pickLens(lens.id, cx);
    if (k === "0") return this.pickScope("all", cx);
    if (k === "[" || k === "]") return this.stepAgent(k === "]" ? 1 : -1, cx);
    if (k === "f") return this.update({ follow: !this.state.follow }, cx);
    // Esc closes the dashboard. Only on a narrow window, where a detail covers its list, does it
    // first go back to the list.
    if (k === "escape" && this.state.detailOpen && this.size.width < 860) return this.update({ detailOpen: false }, cx);
    if (k === "escape" && props()?.overlay) return closeOverlay(props().overlay);
    if (this.state.lens === "calls" && (k === "j" || k === "down" || k === "k" || k === "up")) this.stepCall(k === "j" || k === "down" ? 1 : -1, cx);
  }

  stepCall(step, cx) {
    const key = neighbor(this.lastItems ?? [], this.selFor().call, step);
    if (!key) return;
    this.update({ follow: false }, cx);
    this.setSel({ call: key }, cx);
    const ix = (this.lastItems ?? []).findIndex((it) => it.key === key);
    if (ix >= 0) this.scroll.scroll_to_item(ix, "center");
  }

  stepAgent(step, cx) {
    const order = ["all", ...this.railOrder(this.roster())];
    const ix = order.indexOf(this.state.scope);
    this.pickScope(order[(ix + step + order.length) % order.length], cx);
  }

  // ---------- render ----------

  stageCtx(agentAddr, session, agent, call, cx = null) {
    const cwd = this.terms?.[agentAddr]?.foreground?.cwd ?? session?.cwd ?? null;
    const homeDir = home();
    return {
      status: call && session ? callStatus(call, session, agent?.status) : "unknown",
      session,
      cwd,
      home: homeDir,
      rel: (p) => relPath(p, cwd, homeDir),
      ui: (key, fallback) => this.ui(key, fallback),
      setUi: (key, value, cx) => this.setUi(key, value, cx),
      started: call ? startedBy(this.lastRoster ?? this.roster(), agentAddr, call) : [],
      pickScope: (address, cx) => this.pickScope(address, cx),
      copy: (text, cx) => {
        cx.write_to_clipboard(text);
        notify({ title: "복사했어요", level: "success", timeout: 1600 });
      },
      openUrl: (url, cx) => cx.open_url(url),
      openFile: (path, cx) => this.openFile(path, cx),
      request: cx ? (key, load) => this.request(key, load, cx) : null,
    };
  }

  followNewest(items) {
    if (!this.state.follow || this.state.lens !== "calls") return;
    const newest = items.find((it) => it.type === "call");
    if (!newest || this.followed[this.state.scope] === newest.key) return;
    this.followed = { ...this.followed, [this.state.scope]: newest.key };
    this.state = { ...this.state, sel: { ...this.state.sel, [this.state.scope]: { ...this.selFor(), call: newest.key } } };
    // Newest is first: following means staying at the top, with its prompt's header in view.
    this.scrollTop = true;
  }

  // The list only changes when a session or an agent's status does; rebuild it then.
  callList(byAddr) {
    const scope = this.state.scope;
    const addrs = scope === "all" ? Object.keys(byAddr) : [scope];
    const sig = `${scope}|${this.state.kind}|${addrs.map((a) => `${a}:${this.store.get(a)?.rev ?? -1}:${byAddr[a]?.status}`).join(",")}`;
    if (this.listMemo?.sig !== sig) this.listMemo = { sig, value: callItems(scope, byAddr, this.store, this.state.kind) };
    return this.listMemo.value;
  }

  callsBody(byAddr, t, compact, cx) {
    const { items, counts } = this.callList(byAddr);
    this.followNewest(items);
    this.lastItems = items;
    const picked = findCall(items, this.selFor().call);
    const parsed = parseCallKey(picked?.key);
    const session = parsed ? this.store.get(parsed.agent) : null;
    const stage = picked ? stageView(picked.call, this.stageCtx(parsed.agent, session, byAddr[parsed.agent], picked.call, cx), t) : null;
    // Opening the lens (or following) brings the selected row on screen.
    if (this.scrollTop) {
      this.scroll.scroll_to_item(0, "top");
      this.scrollTop = false;
    }
    const target = this.scrollTo ?? (this.listShownFor !== this.state.scope && !this.state.follow ? picked?.key : null);
    if (target) {
      const ix = items.findIndex((it) => it.key === target);
      if (ix >= 0) this.scroll.scroll_to_item(ix, "center");
      this.scrollTo = null;
    }
    this.listShownFor = this.state.scope;
    const scopeSession = this.state.scope === "all" ? null : this.store.get(this.state.scope);
    const scopeCwd = this.terms?.[this.state.scope]?.foreground?.cwd ?? scopeSession?.cwd;
    return callsLens({
      items, counts, kind: this.state.kind, follow: this.state.follow, compact, detailOpen: this.state.detailOpen,
      selectedKey: picked?.key ?? null, stage, scrollHandle: this.scroll,
      rel: (p) => relPath(p, scopeCwd, home()),
      empty: scopeSession && !scopeSession.loaded ? { title: "기록을 읽는 중이에요", body: null } : null,
      onPick: (key, cx) => this.pickCall(key, cx),
      onKind: (kind, cx) => this.update({ kind }, cx),
      onFollow: (_e, cx) => this.update({ follow: !this.state.follow }, cx),
      onBack: (_e, cx) => this.update({ detailOpen: false }, cx),
    }, t);
  }

  lensCtx(byAddr, compact, cx) {
    const scope = this.state.scope;
    return {
      request: (key, load) => this.request(key, load, cx),
      roster: this.lastRoster,
      peek: (address) => run("terminal.peek", { terminal: address }),
      pickSub: (address, cx) => {
        this.update({ detailOpen: true }, cx);
        this.setSel({ sub: address }, cx);
      },
      openSub: (address, cx) => this.openSub(address, cx),
      scope, agent: byAddr[scope] ?? null, agents: byAddr, store: this.store, session: scope === "all" ? null : this.store.get(scope),
      terms: this.terms, home: home(), sel: this.selFor(), compact, detailOpen: this.state.detailOpen,
      setSel: (patch, cx) => this.setSel(patch, cx),
      onBack: (_e, cx) => this.update({ detailOpen: false }, cx),
      openDetail: (cx) => this.update({ detailOpen: true }, cx),
      ui: (key, fallback) => this.ui(key, fallback),
      setUi: (key, value, cx) => this.setUi(key, value, cx),
      stageCtx: (address, s, agent, call) => this.stageCtx(address, s, agent, call, cx),
      pickScope: (address, cx, lens) => this.pickScope(address, cx, lens),
      pickLens: (lens, cx) => this.pickLens(lens, cx),
      openCall: (address, callId, cx) => {
        // Show every kind, so the call is in the list, and bring it on screen.
        const key = `call:${address}:${callId}`;
        this.update({ scope: address, lens: "calls", follow: false, detailOpen: true, kind: "all" }, cx);
        this.setSel({ call: key }, cx, address);
        this.scrollTo = key;
      },
      openFile: (path, cx) => this.openFile(path, cx),
    };
  }

  lensBody(byAddr, t, compact, cx) {
    switch (this.state.lens) {
      case "calls": return this.callsBody(byAddr, t, compact, cx);
      case "links": return linksLens(this.lensCtx(byAddr, compact, cx), t);
      case "prompts": return promptsLens(this.lensCtx(byAddr, compact, cx), t);
      case "changes": return changesLens(this.lensCtx(byAddr, compact, cx), t);
      case "subs": return subsLens(this.lensCtx(byAddr, compact, cx), t);
      default: return overviewLens(this.lensCtx(byAddr, compact, cx), t);
    }
  }

  counts(byAddr) {
    const scope = this.state.scope;
    const sessions = scope === "all" ? Object.keys(byAddr).map((a) => this.store.get(a)) : [this.store.get(scope)];
    const ds = sessions.filter(Boolean).map((s) => [s, this.store.derived(s)]);
    const total = (pick) => ds.reduce((n, [s, d]) => n + pick(s, d), 0);
    return {
      calls: total((s, d) => d.calls.length),
      links: total((s, d) => d.links.length),
      prompts: total((s) => s.prompts.filter(isHumanPrompt).length),
      changes: total((s, d) => d.files.length),
      subs: subCount(this.lastRoster, scope),
    };
  }

  head(byAddr, list, t, compact) {
    const scope = this.state.scope;
    const agent = byAddr[scope];
    const overlay = props()?.overlay ?? null;
    const onClose = overlay ? () => closeOverlay(overlay) : null;
    const onWeb = (_e, cx) => this.openWeb(cx);
    if (!agent) return fleetHead(list, t, onClose, onWeb);
    return agentHead({
      onClose,
      onWeb,
      parent: agent.parent ? byAddr[agent.parent] : null,
      onParent: (_e, cx) => this.openSub(scope, cx),
      agent, terminal: this.terms[scope], session: this.store.get(scope), pane: agent.pane ? panes().find((p) => p.pane === agent.pane) : null, home: home(), compact,
      onFocus: () => run("agent.focus", { terminal: scope }),
      onPeek: () => run("terminal.peek", { terminal: scope }),
    }, t);
  }

  render(cx) {
    this.drawn = true;
    const t = tokens();
    const roster = this.roster();
    this.lastRoster = roster;
    this.terms = this.allTerms();
    // Lenses read agents (and sub-agents that are agents); plain programs only show in the tree.
    const list = Object.values(roster.nodes).filter((n) => n.isAgent);
    const byAddr = Object.fromEntries(list.map((a) => [a.address, a]));
    setAgentOrder(this.railOrder(roster).filter((a) => roster.nodes[a]?.state === "live"));
    if (this.state.scope !== "all" && !byAddr[this.state.scope]) this.state = { ...this.state, scope: "all" };
    const width = this.size.width;
    const compactRail = width < 980;
    const compact = width < 860;
    const railEl = rail({ group: this.railGroup, onGroup: (g, cx) => this.setRailGroup(g, cx), followFocus: this.followFocus, onFollowFocus: (on, cx) => this.setFollowFocus(on, cx), spaces: spaces(), colors: shared("space.colors") ?? {}, logos: shared("space.logos") ?? {},
      folded: (id) => this.foldedSpaces.has(id), onFold: (id, cx) => this.toggleSpace(id, cx), roster, terms: this.terms, scope: this.state.scope, compact: compactRail, width: compactRail ? RAIL_NARROW : null, machines: machines(), onPick: (a, cx) => this.pickScope(a, cx) }, t);
    const content = this.state.scope === "all"
      // 전체 현황 starts empty: only its name, until what it should show is decided.
      ? v_flex().flex_1().min_w(0).h_full().items_center().justify_center().child(div().text_size(22).font_semibold().text_color(t.muted).child("전체 현황"))
      : v_flex().flex_1().min_w(0).size_full()
        .child(this.head(byAddr, list, t, compact))
        .child(lensTabs(this.state.lens, this.counts(byAddr), (lens, cx) => this.pickLens(lens, cx), t, compact))
        .child(v_flex().flex_1().min_h(0).child(list.length ? this.lensBody(byAddr, t, compact, cx) : empty("에이전트가 없어요", "herdr에서 Claude Code나 Codex를 실행하면 여기 나타나요.", t, "bot")));
    // The rail's width can be dragged (its edge); a narrow window keeps the icon-only rail fixed.
    const split = compactRail
      ? [railEl, content]
      : [h_resizable("root-split").size_full()
        .child(resizable_panel().size(RAIL_WIDE).size_range(200, 440).child(railEl))
        .child(resizable_panel().child(content))];
    return h_flex().id("root").size_full().bg(t.background).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => {
        this.size = size;
        cx.notify();
      })
      .children(split);
  }
}
