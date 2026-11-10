// Left rail: every agent, grouped by what needs you (herdr's agents mod order) or by space.

function statusGlyph(a, size = 14) {
  switch (a.status) {
    case "working":
      return spinner(size);
    case "blocked":
      return raw('<span class="st blocked" aria-label="응답 필요"></span>');
    case "done":
      return raw('<span class="st dot" aria-label="완료"></span>');
    case "offline":
      return raw('<span class="st unknown" aria-label="연결 필요"></span>');
    case "ended":
      return raw(`<span class="sub-mark ${a.exit ? "bad" : ""}" aria-label="끝남">${icon(a.exit ? "circle-x" : "check", size - 2).s}</span>`);
    case "running":
      return raw(`<span class="sub-mark" aria-label="실행 중">${icon("play", size - 4).s}</span>`);
    default:
      return raw('<span class="st ring" aria-label="대기"></span>');
  }
}

function agentRow(a) {
  const current = STATE.scope === a.id;
  const sub = a.machine ? `${a.machine} · ${a.space}` : `${a.space} › ${a.tab}`;
  return html`<button class="agent-item ${a.status} ${a.status === "offline" ? "offline" : ""}" data-action="scope" data-scope="${a.id}" aria-current="${current}" title="${a.title} · ${STATUS_LABEL[a.status]}">
    ${logo(a.app, 26)}
    ${a.unseen ? raw('<span class="unseen" aria-label="안 본 완료"></span>') : ""}
    <span class="grow"><div class="t truncate">${a.title}</div><div class="s truncate">${sub}</div></span>
    <span class="r">${statusGlyph(a)}<span data-ago="${a.sinceTs}">${shortAgo(a.sinceTs)}</span></span>
  </button>`;
}

// A sub-agent under whoever started it: tree lines, a small mark, its name and how it is doing.
const ENDED_IN_RAIL_MS = 30 * 60 * 1000;
const inRail = (n) => n.state === "live" || Date.now() - (n.finished ?? 0) < ENDED_IN_RAIL_MS;

function treeLines(lines) {
  return lines.map((l) => raw(`<i class="tl ${l === "└" ? "end" : l === "├" ? "mid" : l === "│" ? "bar" : ""}"></i>`));
}

function subRow({ node: a, lines }) {
  const current = STATE.scope === a.id || (STATE.lens === "subs" && pickedSub()?.id === a.id);
  return html`<button class="agent-sub ${a.state === "ended" ? "ended" : ""}" data-action="scope" data-scope="${a.id}" aria-current="${current}" title="${a.title} · ${STATUS_LABEL[a.status] ?? a.status}">
    ${treeLines(lines)}${logo(a.app, 18)}<span class="t truncate grow">${a.title}</span>${statusGlyph(a, 13)}
  </button>`;
}

const withSubs = (a) => html`${agentRow(a)}${LTR.descendants(DB.roster, a.id, inRail).map(subRow)}`;
// An agent sits in the group of its most urgent live sub-agent.
const groupStatus = (a) => {
  const s = LTR.urgentStatus(DB.roster, a.id);
  return STATUS_RANK[s] > STATUS_RANK[a.status] && ["blocked", "working"].includes(s) ? s : a.status;
};

function railGroups() {
  const agents = DB.roster.roots.map((id) => DB.roster.nodes[id]);
  if (STATE.railGroup === "space") {
    const bySpace = groupBy(agents, (a) => (a.machine ? `${a.machine} · ${a.space}` : a.space));
    return Object.entries(bySpace).map(([space, list]) => ({ key: space, label: space, cls: "", list }));
  }
  const order = ["blocked", "done", "working", "idle", "offline"];
  return order
    .map((s) => ({ key: s, label: STATUS_LABEL[s], cls: s, list: agents.filter((a) => groupStatus(a) === s).sort((x, y) => y.sinceTs - x.sinceTs) }))
    .filter((g) => g.list.length);
}

function railView() {
  const groups = railGroups();
  const machines = groupBy(DB.agents.filter((a) => !a.sub), (a) => a.machine || "");
  const subs = DB.agents.filter((a) => a.sub && a.state === "live").length;
  return html`<div class="rail-head">
      <span class="rail-title grow">에이전트<b>${DB.roster.roots.length}</b>${subs ? html`<small class="dim"> · 하위 ${subs}</small>` : ""}</span>
      <div class="seg" role="group" aria-label="묶는 방식">
        <button data-action="rail-group" data-value="status" aria-pressed="${STATE.railGroup === "status"}" title="급한 순서">${icon("clock", 12)}</button>
        <button data-action="rail-group" data-value="space" aria-pressed="${STATE.railGroup === "space"}" title="스페이스별">${icon("layers", 12)}</button>
      </div>
    </div>
    <nav class="rail-body" aria-label="에이전트" data-keep-scroll="rail">
      <button class="rail-all" data-action="scope" data-scope="all" aria-current="${STATE.scope === "all"}">
        <span class="tile">${icon("grid", 14)}</span><span>전체 현황</span>
      </button>
      ${groups.map(
        (g) => html`<div class="rail-group ${g.cls}"><span>${g.label}</span><span class="n">${g.list.length}</span></div>${g.list.map(withSubs)}`,
      )}
    </nav>
    <div class="rail-foot">
      ${Object.entries(machines).map(([m, list]) => {
        const off = list.every((a) => a.status === "offline");
        return html`<div class="machine ${off ? "off" : ""}">${icon(m ? "server" : "monitor", 14)}<span class="grow">${m || "This computer"}</span>${off ? html`<em>로그인 필요</em>` : html`<span>${list.length}</span>`}</div>`;
      })}
    </div>`;
}
