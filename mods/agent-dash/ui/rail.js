// The left rail: every herdr agent grouped by what it needs from you, the sub-agents each
// one started (`hc run`) nested under it, plus "전체 현황".

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { alpha, icon, programIcon, statusGlyph, subGlyph, treeLines, STATUS_LABEL, STATUS_RANK, scrollArea } from "./kit.js";
import { fmtDurShort, inkOn } from "../lib/format.js";
import { descendants, urgentStatus } from "../lib/tree.js";

const GROUPS = ["blocked", "working", "done", "idle"];
// A finished sub-agent stays in the rail for a while; the 하위 에이전트 lens keeps all of them.
const ENDED_IN_RAIL_MS = 30 * 60 * 1000;
const SUB_H = 28;

const inRail = (now) => (node) => node.state === "live" || now - (node.finished ?? 0) < ENDED_IN_RAIL_MS;

/** Rail rows in order: per status group (an agent sits in its most urgent sub-agent's group),
 *  each agent followed by its sub-agents. [{node, lines, group}] */
export function railRows(roster, now = Date.now()) {
  const roots = roster.roots.map((addr) => ({ node: roster.nodes[addr], group: urgentStatus(roster, addr) }));
  return GROUPS.flatMap((status) => roots.filter((r) => (GROUPS.includes(r.group) ? r.group : "idle") === status)
    .sort((x, y) => Number(y.node.pinned) - Number(x.node.pinned))
    .flatMap((r) => [{ node: r.node, lines: [], group: status }, ...descendants(roster, r.node.address, inRail(now)).map((d) => ({ ...d, group: status }))]));
}

// The selected row is marked by position too (a bar on its left edge), not by its background alone.
const selBar = (t) => div().absolute().left(0).top(7).bottom(7).w(2).rounded(1).bg(t.accent);

function activity(agent, terminal) {
  const msg = terminal?.report?.msg;
  if (agent.status === "working" && msg) return msg;
  return agent.summary && agent.summary !== agent.title ? agent.summary : `${agent.space_name} › ${agent.tab_name}`;
}

function since(terminal, now) {
  const ms = terminal?.status_ms;
  return ms ? fmtDurShort((now - ms) / 1000) : "";
}

function agentRow(agent, terminal, selected, compact, t, now, onPick) {
  const sub = activity(agent, terminal);
  const row = h_flex().id(`rail-${agent.address}`).w_full().flex_none().gap(9).items_center().cursor_pointer()
    .px(compact ? 0 : 16).h(compact ? 40 : 46)
    .when(compact, (e) => e.justify_center())
    .relative().when(selected, (e) => e.bg(t.selected).child(selBar(t)))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((_e, cx) => onPick(agent.address, cx))
    .child(div().relative().flex_none().child(programIcon(agent.program, compact ? 24 : 22, t))
      .when(compact, (e) => e.child(div().absolute().right(-3).bottom(-3).p(1).rounded(6).bg(t.chrome).child(statusGlyph(agent.status, t, true)))));
  if (compact) return row.tooltip(`${agent.title} · ${STATUS_LABEL[agent.status] ?? agent.status}`);
  return row
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().truncate().text_size(12.5).text_color(selected ? t.foreground : t.muted).font_weight(selected ? 600 : 500).child(agent.title || agent.program?.name || agent.address))
      .child(h_flex().gap(5).items_center().min_w(0)
        .when(agent.status === "working" && Boolean(terminal?.report?.msg), (e) => e.child(icon("activity", 10, t.working)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(agent.status === "working" && terminal?.report?.msg ? alpha(t.working, 0.9) : t.dim).child(sub))))
    .child(v_flex().flex_none().items_end().gap(3)
      .child(statusGlyph(agent.status, t, true))
      .child(div().text_size(10).text_color(t.dim).child(since(terminal, now))));
}

// A sub-agent: tree lines, a small mark, its name and how it is doing.
function subRow(row, selected, compact, t, onPick) {
  const { node } = row;
  const ended = node.state === "ended";
  const el = h_flex().id(`rail-${node.address}`).w_full().flex_none().items_center().pl(8).cursor_pointer().h(SUB_H)
    .relative().when(selected, (e) => e.bg(t.selected).child(selBar(t)))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((_e, cx) => onPick(node.address, cx));
  if (compact) {
    return el.justify_center().gap(3)
      .child(div().w(2).h(14).rounded(1).bg(t.input))
      .child(div().when(ended, (e) => e.opacity(0.5)).child(programIcon(node.program, 16, t)))
      .tooltip(`${node.title} · ${STATUS_LABEL[node.status] ?? node.status}`);
  }
  return el.pl(19).pr(8)
    .children(treeLines(row.lines, t, SUB_H))
    .child(div().mr(7).when(ended, (e) => e.opacity(0.5)).child(programIcon(node.program, 15, t)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).font_weight(selected ? 600 : 400).text_color(selected ? t.foreground : ended ? t.dim : t.muted).child(node.title))
    .child(div().flex_none().ml(6).child(subGlyph(node, t)));
}

// ---------- by space (the ray-theme sidebar's layout) ----------
// A space (its avatar and name, a chevron that folds it), then its agents hanging off one line
// that runs down from the avatar, each sub-agent under its agent.

const SPACE_H = 32;
const HEAD_H = 28;
const AGENT_H = 32;
const TICK = 9;
const AVATAR_X = 17;
const SPACE_MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

function spaceAvatar(space, opts, t, size = 18) {
  const logo = opts.logos?.[space.id];
  const radius = Math.round(size * 0.28);
  if (logo?.image) return image(logo.image).size(size).flex_none().rounded(radius);
  const box = h_flex().size(size).flex_none().rounded(radius).items_center().justify_center();
  if (logo?.emoji) return box.text_size(Math.round(size * 0.83)).child(div().child(logo.emoji));
  const color = opts.colors?.[space.id] ?? "ansi6";
  const fill = color.startsWith("#") ? color : SPACE_MARK[color] ?? t[color] ?? t.accent;
  return box.bg(fill).text_size(Math.round(size * 0.67)).font_bold().text_color(inkOn(fill, t.accent_foreground ?? "#21252b")).child([...(space.name ?? "?")][0]?.toUpperCase() ?? "?");
}

// The strip left of a row that carries the line: `through` runs it past the row, `tick` adds the stub.
function gutter(t, h, { through, tick }) {
  const mid = Math.floor(h / 2);
  const color = t.input ?? t.border;
  return div().relative().w(AVATAR_X + TICK + 4).h(h).flex_none()
    .child(div().absolute().left(AVATAR_X).top(0).w(1).h(through ? h : mid).bg(color))
    .when(tick, (e) => e.child(div().absolute().left(AVATAR_X).top(mid).w(TICK).h(1).bg(color)));
}

// Herdr's focus drives which agent is shown: on = the dashboard follows it.
function followToggle(on, onToggle, t) {
  return h_flex().id("follow-focus").h(24).px(7).gap(5).items_center().rounded(12).cursor_pointer().text_size(11.5)
    .bg(on ? alpha(t.accent, 0.16) : t.raised).text_color(on ? t.accent : t.dim)
    .hover((s) => s.bg(on ? alpha(t.accent, 0.24) : t.hover))
    .tooltip(on ? "Herdr에서 포커스한 에이전트를 따라가요 (끄려면 클릭)" : "Herdr 포커스를 따라가지 않아요 (켜려면 클릭)")
    .on_click((_e, cx) => onToggle(!on, cx))
    .child(icon("link", 12, on ? t.accent : t.dim)).child("포커스");
}

function spaceRow(space, mine, open, first, opts, t) {
  const top = mine.reduce((m, r) => ((STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[m] ?? 0) ? r.status : m), null);
  return h_flex().id(`rail-space-${space.id}`).w_full().h(SPACE_H).flex_none().px(16).gap(9).items_center().cursor_pointer()
    .when(!first, (e) => e.mt(8))
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => opts.onFold(space.id, cx))
    .child(spaceAvatar(space, opts, t))
    .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.foreground).child(space.name ?? ""))
    .when(mine.length > 0, (e) => e.child(h_flex().flex_none().h(22).px(3).gap(4).items_center().text_size(12).text_color(t.dim)
      .when(!open && Boolean(top) && top !== "idle", (x) => x.child(statusGlyph(top, t, true)))
      .when(!open, (x) => x.child(String(mine.length)))
      .child(icon(open ? "chevron-down" : "chevron-right", 13, t.dim))));
}

const agentsHead = (count, t) => h_flex().w_full().h(HEAD_H).flex_none().items_center()
  .child(gutter(t, HEAD_H, { through: true, tick: true }))
  .child(h_flex().gap(6).items_center().text_size(12.5).text_color(t.muted)
    .child(icon("bot", 14, t.dim)).child(div().child("에이전트"))
    .child(div().px(6).h(18).flex().items_center().rounded(9).bg(t.raised).text_size(11.5).text_color(t.muted).child(String(count))));

function spaceAgentRow(agent, terminal, selected, last, t, now, onPick) {
  const idle = agent.status === "idle" && !selected;
  return h_flex().w_full().h(AGENT_H).flex_none().items_center().pl(8)
    .child(gutter(t, AGENT_H, { through: !last, tick: true }))
    .child(h_flex().id(`rail-${agent.address}`).flex_1().min_w(0).h(AGENT_H - 1).px(7).gap(8).rounded(7).items_center().cursor_pointer()
      .relative().when(selected, (e) => e.bg(t.selected).child(selBar(t)))
      .hover((s) => s.bg(selected ? t.selected : t.hover))
      .on_click((_e, cx) => onPick(agent.address, cx))
      .child(programIcon(agent.program, 16, t))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(idle ? t.muted : t.foreground).child(agent.title || agent.program?.name || agent.address))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(since(terminal, now)))
      .child(statusGlyph(agent.status, t, true)));
}

function spaceSubRow(row, selected, through, t, onPick) {
  const { node } = row;
  const ended = node.state === "ended";
  return h_flex().w_full().h(SUB_H).flex_none().items_center().pl(8)
    .child(gutter(t, SUB_H, { through, tick: false }))
    .child(h_flex().id(`rail-${node.address}`).flex_1().min_w(0).h(SUB_H - 1).pl(14).pr(7).rounded(7).items_center().cursor_pointer()
      .relative().when(selected, (e) => e.bg(t.selected).child(selBar(t)))
      .hover((s) => s.bg(selected ? t.selected : t.hover))
      .on_click((_e, cx) => onPick(node.address, cx))
      .children(treeLines(row.lines, t, SUB_H))
      .child(div().mr(8).when(ended, (e) => e.opacity(0.5)).child(programIcon(node.program, 14, t)))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(selected ? t.foreground : ended ? t.dim : t.muted).child(node.title))
      .child(div().flex_none().ml(6).child(subGlyph(node, t))));
}

/** Rows grouped by space: [{space, roots: [node]}], spaces in herdr's order; agents whose
 *  space isn't listed (another machine's) come last under their space's name. */
export function spaceGroups(roster, spaces) {
  const roots = roster.roots.map((a) => roster.nodes[a]);
  const known = new Set(spaces.map((s) => s.id));
  const groups = spaces.map((space) => ({ space, roots: roots.filter((n) => n.space === space.id) }));
  const rest = roots.filter((n) => !known.has(n.space));
  const extra = [...new Set(rest.map((n) => n.space_name || "기타"))].map((name) => ({ space: { id: `other:${name}`, name }, roots: rest.filter((n) => (n.space_name || "기타") === name) }));
  const rank = (n) => (n.pinned ? 100 : 0) + (STATUS_RANK[urgentStatus(roster, n.address)] ?? 0);
  return [...groups, ...extra].map((g) => ({ ...g, roots: [...g.roots].sort((x, y) => rank(y) - rank(x)) }));
}

/** Addresses in the order the by-space rail shows them (for ] and [). */
export function spaceOrder(roster, spaces, now = Date.now()) {
  return spaceGroups(roster, spaces).flatMap((g) => g.roots.flatMap((n) => [n.address, ...descendants(roster, n.address, inRail(now)).filter((d) => d.node.isAgent).map((d) => d.node.address)]));
}

function spaceItems(opts, t, now) {
  const { roster, terms, scope, onPick } = opts;
  const groups = spaceGroups(roster, opts.spaces ?? []).filter((g) => g.roots.length || !String(g.space.id).startsWith("other:"));
  return groups.flatMap((g, i) => {
    const open = !opts.folded(g.space.id);
    const head = spaceRow(g.space, g.roots, open, i === 0, opts, t);
    if (!g.roots.length || !open) return [head];
    return [head, agentsHead(g.roots.length, t), ...g.roots.flatMap((agent, n) => {
      const last = n === g.roots.length - 1;
      const subs = descendants(roster, agent.address, inRail(now));
      return [spaceAgentRow(agent, terms[agent.address], scope === agent.address, last, t, now, onPick),
        ...subs.map((s) => spaceSubRow(s, scope === s.node.address, !last, t, onPick))];
    })];
  });
}

// The pill at the top: how the list is grouped.
function groupTabs(group, onGroup, t) {
  const tab = (id, label, mark) => {
    const on = id === group;
    return h_flex().id(`rail-group-${id}`).flex_1().min_w(0).h_full().px(8).gap(7).rounded(15).items_center().justify_center().text_size(12.5).cursor_pointer()
      .when(on, (e) => e.bg(t.raised).text_color(t.foreground))
      .when(!on, (e) => e.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => onGroup(id, cx))
      .child(icon(mark, 13, on ? t.foreground : t.dim)).child(div().truncate().child(label));
  };
  return h_flex().flex_none().mx(12).mt(2).mb(8).p(2).h(34).rounded(17).border(1).border_color(t.border)
    .child(tab("status", "상태별", "clock")).child(tab("space", "스페이스별", "layers"));
}

function groupHeader(status, count, t) {
  const color = status === "idle" ? t.dim : t[status] ?? t.dim;
  return h_flex().w_full().flex_none().h(26).px(16).mt(6).gap(6).items_center()
    .child(div().size(6).rounded(3).bg(color))
    .child(div().text_size(11).font_semibold().text_color(t.dim).child(STATUS_LABEL[status] ?? status))
    .child(div().text_size(11).text_color(t.dim).child(String(count)));
}

function fleetRow(selected, counts, compact, t, onPick) {
  const row = h_flex().id("rail-all").w_full().flex_none().gap(9).items_center().cursor_pointer()
    .px(compact ? 0 : 16).h(compact ? 40 : 38)
    .when(compact, (e) => e.justify_center())
    .relative().when(selected, (e) => e.bg(t.selected).child(selBar(t)))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((_e, cx) => onPick("all", cx))
    .child(div().size(compact ? 24 : 22).flex_none().rounded(6).bg(t.raised).flex().items_center().justify_center().child(icon("grid", 13, selected ? t.foreground : t.muted)));
  if (compact) return row.tooltip("전체 현황");
  return row
    .child(div().flex_1().text_size(12.5).font_weight(600).text_color(selected ? t.foreground : t.muted).child("전체 현황"))
    .children(["blocked", "working", "done"].filter((s) => counts[s]).map((s) =>
      div().px(5).h(16).rounded(4).bg(alpha(t[s], 0.16)).text_size(10.5).font_semibold().text_color(t[s]).flex().items_center().child(String(counts[s]))));
}

/** opts: {roster, terms, scope, compact, width, onPick, machines} */
export function rail(opts, t) {
  const { roster, terms, scope, compact, onPick } = opts;
  const now = Date.now();
  const rows = railRows(roster, now);
  const live = Object.values(roster.nodes).filter((n) => n.state === "live");
  const counts = Object.fromEntries(GROUPS.map((s) => [s, live.filter((n) => n.status === s).length]));
  const bySpace = opts.group === "space" && !compact;
  const items = [fleetRow(scope === "all", counts, compact, t, onPick), ...(bySpace ? [div().h(6).flex_none(), ...spaceItems(opts, t, now)] : [])];
  for (const status of bySpace ? [] : GROUPS) {
    const group = rows.filter((r) => r.group === status);
    if (!group.length) continue;
    if (!compact) items.push(groupHeader(status, group.filter((r) => !r.lines.length).length, t));
    else items.push(div().w_full().h(1).my(4).bg(t.border));
    for (const r of group) {
      items.push(r.lines.length
        ? subRow(r, scope === r.node.address, compact, t, onPick)
        : agentRow(r.node, terms[r.node.address], scope === r.node.address, compact, t, now, onPick));
    }
  }
  const offline = (opts.machines ?? []).filter((m) => m.name && m.layout === "unavailable");
  const subs = Object.values(roster.nodes).filter((n) => n.sub && n.state === "live").length;
  return v_flex().when(Boolean(opts.width), (e) => e.h_full().flex_none().w(opts.width)).when(!opts.width, (e) => e.size_full()).bg(t.chrome).border_r(1).border_color(t.border)
    .child(h_flex().h(44).flex_none().px(compact ? 0 : 14).gap(8).items_center().when(compact, (e) => e.justify_center())
      .child(icon("layers", 15, t.accent))
      .when(!compact, (e) => e.child(div().text_size(13).font_semibold().text_color(t.foreground).child("에이전트")).child(div().text_size(12).text_color(t.dim).child(String(roster.roots.length)))
        .when(subs > 0, (x) => x.child(div().text_size(11).text_color(t.dim).child(`· 하위 ${subs}`)))
        .child(div().flex_1())
        .when(Boolean(opts.onFollowFocus), (x) => x.child(followToggle(Boolean(opts.followFocus), opts.onFollowFocus, t)))))
    .when(!compact && Boolean(opts.onGroup), (e) => e.child(groupTabs(opts.group ?? "status", opts.onGroup, t)))
    .child(scrollArea("rail-scroll", v_flex().pb(10).children(items)))
    .when(offline.length > 0 && !compact, (e) => e.child(v_flex().flex_none().p(10).gap(4).border_t(1).border_color(t.border).children(offline.map((m) =>
      h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(icon("server", 12, t.dim)).child(div().truncate().child(`${m.name} · 연결 필요`))))));
}
