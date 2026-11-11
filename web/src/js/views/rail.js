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
  const place = a.machine ? `${a.machine} · ${a.space}` : `${a.space} › ${a.tab}`;
  const sub = a.summary && a.summary !== a.title ? a.summary : place;
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

// A space's mark as the app draws it: a picked image, a character, or its first letter on its color.
const SPACE_TINT = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function spaceMark(name) {
  const space = (LIVE.spaces ?? []).find((s) => s.name === name);
  if (space?.image) return html`<img class="sp-mark" src="${space.image}" alt="" />`;
  const tint = space?.color?.startsWith("#") ? space.color : SPACE_TINT[space?.color] ?? SPACE_TINT.ansi6;
  const letter = space?.text || [...String(name ?? "?")][0]?.toUpperCase() || "?";
  return html`<span class="sp-mark" style="${space?.text ? "" : `background:${tint}`}">${letter}</span>`;
}

function railGroups() {
  const agents = DB.roster.roots.map((id) => DB.roster.nodes[id]);
  if (STATE.railGroup === "space") {
    const bySpace = groupBy(agents, (a) => (a.machine ? `${a.machine} · ${a.space}` : a.space));
    // The app's own order first (empty spaces too), then spaces it doesn't list (other machines').
    const named = (LIVE.spaces ?? []).map((sp) => sp.name).filter(Boolean);
    const order = [...new Set([...named, ...Object.keys(bySpace)])];
    return order.map((space) => ({ key: space, label: space, cls: "", list: bySpace[space] ?? [], mark: spaceMark(space) }));
  }
  const order = ["blocked", "done", "working", "idle", "offline"];
  return order
    .map((s) => ({ key: s, label: STATUS_LABEL[s], cls: s, list: agents.filter((a) => groupStatus(a) === s).sort((x, y) => y.sinceTs - x.sinceTs) }))
    .filter((g) => g.list.length);
}

// By space, as in the app: the space (mark, name, fold), then its agents under a line, each
// with its sub-agents.
function spaceGroup(g) {
  const closed = Boolean(STATE.foldedSpaces?.[g.key]);
  const top = g.list.reduce((best, a) => (STATUS_RANK[groupStatus(a)] > STATUS_RANK[best] ? groupStatus(a) : best), "idle");
  return html`<div class="sp-group">
    <button class="sp-head" data-action="space-fold" data-space="${g.key}" aria-expanded="${!closed}">
      ${g.mark}<span class="grow truncate">${g.label}</span>
      ${closed && g.list.length ? html`<span class="sp-count">${["blocked", "working"].includes(top) ? statusGlyph({ status: top }, 13) : ""}${g.list.length}</span>` : ""}
      ${g.list.length ? icon(closed ? "chevron-right" : "chevron-down", 13) : ""}
    </button>
    ${closed || !g.list.length ? "" : html`<div class="sp-sub">
      <div class="sp-agents">${icon("bot", 14)}<span>에이전트</span><span class="sp-n">${g.list.length}</span></div>
      ${g.list.map((a) => html`<div class="sp-kid">${withSubs(a)}</div>`)}
    </div>`}
  </div>`;
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
      ${STATE.railGroup === "space" ? groups.map(spaceGroup) : groups.map(
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
