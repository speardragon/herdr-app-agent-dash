// Prototype strip, product top bar and concept A (control room: rail | head + lens).

const LENSES = [
  { id: "overview", label: "개요", icon: "activity" },
  { id: "tools", label: "도구 호출", icon: "terminal" },
  { id: "links", label: "링크", icon: "link" },
  { id: "prompts", label: "프롬프트", icon: "message" },
  { id: "diffs", label: "변경", icon: "diff" },
  // Shown when the scope has sub-agents (terminals started with `hc run`).
  { id: "subs", label: "하위 에이전트", icon: "workflow", optional: true },
];

// One line about the connection: live, or what to do when the server or token is gone.
function connBar() {
  const e = LIVE.error;
  if (!LIVE.token) return html`<div class="conn err"><i></i>토큰이 없어요. herdr의 Agent Dash에서 <b>웹에서 열기</b>로 다시 열어 주세요.</div>`;
  if (e?.status === 401) return html`<div class="conn err"><i></i>서버가 다시 시작돼서 토큰이 바뀌었어요. herdr에서 <b>웹에서 열기</b>를 다시 눌러 주세요.</div>`;
  if (e) return html`<div class="conn err"><i></i>서버에 닿지 않아요 (${String(e.message ?? e)}). herdr에서 <b>웹에서 열기</b>를 누르면 다시 켜져요.</div>`;
  const working = DB.agents.filter((a) => a.status === "working").length;
  return html`<div class="conn"><i></i>herdr-core 실시간 · 에이전트 ${DB.agents.length} · 작업 중 ${working}<span class="grow"></span><button class="btn ghost sm" data-action="help">${icon("keyboard", 13)} 단축키</button></div>`;
}

function fleetChips() {
  const count = (s) => DB.agents.filter((a) => a.status === s).length;
  const chip = (s, glyph) =>
    count(s)
      ? html`<button class="fleet-chip ${s === "blocked" ? "alert" : ""}" data-action="fleet-status" data-status="${s}" title="${STATUS_LABEL[s]} 에이전트 보기">${glyph}<b>${count(s)}</b> ${STATUS_LABEL[s]}</button>`
      : "";
  return html`<div class="fleet-chips">${chip("blocked", raw('<span class="st blocked"></span>'))}${chip("working", spinner(13))}${chip("done", raw('<span class="st dot"></span>'))}${chip("idle", raw('<span class="st ring"></span>'))}</div>`;
}

function topBar() {
  return html`<header class="topbar">
    <div class="brand"><span class="brand-mark">${brandMark(17)}</span>Herdr <small>에이전트 대시보드</small></div>
    ${fleetChips()}
    <span class="grow"></span>
    <button class="search-btn" data-action="palette" aria-label="모두 검색 (⌘K)">${icon("search", 14)}<span class="grow">에이전트·호출·링크·파일 검색</span><span class="kbd">⌘K</span></button>
    <label class="sr-only" for="theme-sel">테마</label>
    <select class="select" id="theme-sel" data-input="theme" title="herdr 테마">
      ${["graphite", "ink", "moss"].map((t) => html`<option value="${t}" ${STATE.theme === t ? raw("selected") : ""}>${t}</option>`)}
    </select>
    <span class="source" title="bin/server.py가 hc와 대화 기록을 읽어요">${raw('<i class="pulse"></i>')} 127.0.0.1 · 로컬</span>
  </header>`;
}

function wsHead() {
  // 전체 현황 starts empty: only its name, until what it should show is decided.
  if (STATE.scope === "all") return "";
  if (STATE.scope === "all") {
    const blocked = DB.agents.filter((a) => a.status === "blocked").length;
    return html`<div class="ident">
        <div class="ident-main">
          <div class="ident-title"><h1>전체 현황</h1>${blocked ? html`<span class="pill blocked">${icon("alert", 12)} ${blocked}개가 기다려요</span>` : ""}</div>
          <div class="ident-meta"><span class="m">${icon("monitor", 13)} This computer · ${DB.agents.filter((a) => !a.machine).length}</span><span class="m dim">렌즈를 바꿔도 범위는 모든 에이전트예요</span></div>
        </div>
      </div>
      ${lensTabs()}`;
  }
  const a = agentById(STATE.scope);
  return html`<div class="ident">
      ${logo(a.app, 40)}
      <div class="ident-main">
        <div class="ident-title"><h1 class="truncate">${a.title}</h1>${statusPillFor(a)}</div>
        <div class="ident-meta">
          ${a.sub && agentById(a.parent)
            ? html`<button class="chip sub-of" data-action="open-sub" data-sub="${a.id}" title="이 에이전트를 띄운 에이전트로 가요">${icon("workflow", 12)} ${agentById(a.parent).title}의 하위 에이전트</button>`
            : html`<span class="m">${icon(a.machine ? "server" : "monitor", 13)} ${a.machine || "This computer"} · ${a.space} › ${a.tab}</span>`}
          ${a.branch ? html`<span class="m">${icon("branch", 13)} ${a.branch}</span>` : ""}
          <span class="m">${icon("folder", 13)} <span class="mono" style="font-size:12.5px">${a.cwd}</span></span>
          <span class="m">${a.model ? html`<span class="chip mono">${a.model}</span>` : ""}<span class="chip mono" title="hc 터미널 주소">${a.id}</span>${a.inferred ? html`<span class="chip" title="Codex는 세션 id를 알려 주지 않아서, 같은 폴더에서 이 프로세스 이후에 쓰인 기록을 골랐어요">추정 연결</span>` : ""}</span>
        </div>
      </div>
      <div class="ident-actions">
        ${a.state === "ended" ? "" : html`<button class="btn" data-action="focus-agent" data-agent="${a.id}" title="herdr 창에서 이 에이전트로 이동해요">${icon("arrow-up-right", 14)}<span>herdr에서 열기</span></button>`}
      </div>
    </div>
    ${lensTabs()}`;
}

function lensCounts() {
  if (STATE.scope === "all") {
    const files = DB.files.map(fileStats);
    return {
      tools: DB.calls.filter((c) => !c.parent).length,
      links: allLinks().length,
      prompts: DB.prompts.length,
      diffs: DB.files.length,
      add: sum(files, (s) => s.add),
      del: sum(files, (s) => s.del),
      subs: DB.agents.filter((a) => a.parent && agentById(a.parent)).length,
    };
  }
  const s = agentStats(STATE.scope);
  return { tools: s.calls, links: s.links, prompts: s.prompts, diffs: s.files, add: s.add, del: s.del, subs: subsOf(STATE.scope).length };
}

function lensTabs() {
  const c = lensCounts();
  return html`<div class="lens-tabs" role="tablist" aria-label="렌즈">${LENSES.map((l, k) => {
    if (l.optional && !c[l.id] && STATE.lens !== l.id) return "";
    const count = l.id === "overview" ? "" : l.id === "diffs" ? (c.diffs ? raw(`${c.diffs} <span class="a">+${c.add}</span> <span class="d">−${c.del}</span>`) : "0") : c[l.id];
    return html`<button class="lens-tab" role="tab" aria-selected="${STATE.lens === l.id}" data-action="lens" data-lens="${l.id}" id="tab-${l.id}">
      ${icon(l.icon, 14)} ${l.label} ${count !== "" ? html`<span class="count">${count}</span>` : ""}<span class="kbd">${k + 1}</span>
    </button>`;
  })}</div>`;
}

function lensBody() {
  if (STATE.scope === "all") return html`<div class="fleet-empty"><h1>전체 현황</h1></div>`;
  const a = STATE.scope === "all" ? null : agentById(STATE.scope);
  switch (STATE.lens) {
    case "tools":
      return toolsLens();
    case "links":
      return linksLens();
    case "prompts":
      return promptsLens();
    case "diffs":
      return diffsLens();
    case "subs":
      return subsLens();
    default:
      return html`<div class="scroll" data-keep-scroll="ov-${esc(scopeKey())}">${a ? agentOverview(a) : fleetOverview()}</div>`;
  }
}

function conceptA() {
  return html`<main class="concept concept-a ${STATE.railFolded ? "rail-folded" : ""}">
    <aside class="rail" id="rail" aria-label="에이전트 목록">${railView()}</aside>
    <section class="ws">
      <div class="ws-head" id="ws-head">${wsHead()}</div>
      <div class="lens" id="lens" role="tabpanel" aria-labelledby="tab-${STATE.lens}">${lensBody()}</div>
    </section>
  </main>`;
}
