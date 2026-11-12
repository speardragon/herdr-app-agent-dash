// Tools lens: calls (newest first, grouped by the prompt that caused them) beside the stage.

const scopeKey = () => STATE.scope;

function scopeCalls() {
  const list = STATE.scope === "all" ? DB.calls.filter((c) => !c.parent) : callsOf(STATE.scope);
  return [...list].sort((a, b) => b.ts - a.ts);
}

function filteredCalls() {
  const q = STATE.query.trim().toLowerCase();
  return scopeCalls().filter((c) => {
    if (STATE.kindFilter !== "all" && kindOf(c) !== STATE.kindFilter) return false;
    if (STATE.scope === "all" && STATE.agentFilter !== "all" && c.agent !== STATE.agentFilter) return false;
    if (!q) return true;
    return `${toolTitle(c)} ${toolTarget(c)} ${c.name}`.toLowerCase().includes(q);
  });
}

function selectedCallId() {
  const id = STATE.sel.call[scopeKey()];
  const list = filteredCalls();
  if (id && (list.some((c) => c.id === id) || callById(id)?.parent)) return id;
  return list[0]?.id || null;
}

function callRow(c, selected) {
  const a = agentById(c.agent);
  return html`<button class="item" role="option" aria-selected="${selected}" data-action="select-call" data-call="${c.id}" id="row-${c.id}">
    ${callStatusIcon(c)}
    ${STATE.scope === "all" ? html`<span title="${a.title}">${logo(a.app, 16)}</span>` : ""}
    <span style="color:${kindColor(c)};display:inline-flex">${toolIcon(c, 14)}</span>
    <span class="tname" style="color:${kindColor(c)}">${toolTitle(c)}</span>
    <span class="ttarget truncate grow">${toolTarget(c)}</span>
    ${digestHTML(c)}
    <span class="tdur">${c.status === "running" ? raw(`<span data-elapsed="${c.ts}">${fmtDur((Date.now() - c.ts) / 1000)}</span>`) : c.status === "pending" ? "" : fmtDur(c.dur)}</span>
  </button>`;
}

function kindChips(calls) {
  const counts = groupBy(calls, kindOf);
  const chip = (k, label, n) =>
    html`<button class="chip" data-action="kind" data-kind="${k}" aria-pressed="${STATE.kindFilter === k}">${k !== "all" ? raw(`<i style="width:7px;height:7px;border-radius:2px;background:${KINDS[k].color}"></i>`) : ""}${label} <span class="count">${n}</span></button>`;
  return html`<div class="chips">${chip("all", "전체", calls.length)}${Object.keys(KINDS)
    .filter((k) => counts[k])
    .map((k) => chip(k, KINDS[k].label, counts[k].length))}</div>`;
}

const LIST_PAGE = 400;

function callListView() {
  const all = scopeCalls();
  const matched = filteredCalls();
  // Thousands of rows re-render on every live update; draw the newest page, more on request.
  const limit = STATE.listLimit?.[scopeKey()] ?? LIST_PAGE;
  const list = matched.slice(0, limit);
  const more = matched.length - list.length;
  const sel = selectedCallId();
  const unseen = STATE.unseenCalls[scopeKey()] || 0;
  let body;
  if (!all.length) {
    body = html`<div class="empty"><div class="e-ico">${icon("terminal", 20)}</div><h3>도구 호출이 없어요</h3><p>${STATE.scope !== "all" && agentById(STATE.scope)?.status === "offline" ? "이 에이전트의 머신에 닿지 않아서 기록을 못 읽었어요." : "에이전트가 도구를 쓰면 여기에 쌓여요."}</p></div>`;
  } else if (!list.length) {
    body = html`<div class="empty"><div class="e-ico">${icon("search", 20)}</div><h3>맞는 호출이 없어요</h3><p>검색어나 종류 필터를 바꿔 보세요.</p><button class="btn sm" data-action="clear-filters">필터 지우기</button></div>`;
  } else if (STATE.scope === "all") {
    body = list.map((c) => callRow(c, c.id === sel));
  } else {
    const prompts = promptsOf(STATE.scope);
    const byTurn = groupBy(list, (c) => c.turn);
    body = Object.keys(byTurn)
      .map(Number)
      .sort((x, y) => y - x)
      .map((turn) => {
        const p = prompts.find((x) => x.n === turn);
        const quiet = !p || p.kind === "notice" || p.kind === "answer";
        const label = p ? (p.display ?? p.text).trim() || (p.images ? `이미지 ${p.images}개` : "") : "프롬프트 전";
        // The list reads from the bottom up: a turn's calls, then the prompt that caused them.
        // Each turn is one group; its prompt band is pinned to the bottom of the list while the
        // group's calls are on screen, and sits under them once they have scrolled past.
        return html`<div class="tgroup">${byTurn[turn].map((c) => callRow(c, c.id === sel))}<div class="list-sep ${quiet ? "quiet" : ""}">
          <span class="turn-n">#${turn}</span>${icon(quiet ? "info" : "message", 12)}
          ${p ? html`<button class="q" data-action="open-prompt" data-agent="${STATE.scope}" data-prompt="${turn}" title="이 프롬프트 보기">${label}</button>` : html`<span class="q">${label}</span>`}
          <span class="meta">호출 ${byTurn[turn].length}${p ? ` · ${relTime(p.ts)}` : ""}</span>
        </div></div>`;
      });
  }
  return html`<div class="list-tools">
      <div class="row">
        <label class="input grow">${icon("search", 14)}<input type="search" placeholder="도구 · 대상 검색" value="${STATE.query}" data-input="query" data-focus-key="q-tools" aria-label="도구 호출 검색"></label>
        <button class="btn sm" data-action="follow" aria-pressed="${STATE.follow}" title="새 호출을 따라가기 (f)">${STATE.follow ? raw('<span class="st" style="width:10px"><i style="width:7px;height:7px;border-radius:50%;background:#7fcf86;display:block"></i></span>') : icon("circle", 10)} 따라가기</button>
      </div>
      ${kindChips(all)}
      ${STATE.scope === "all"
        ? html`<div class="chips">${[{ id: "all", title: "모든 에이전트" }, ...DB.agents.filter((a) => callsOf(a.id).length)].map(
            (a) => html`<button class="chip" data-action="agent-filter" data-agent="${a.id}" aria-pressed="${STATE.agentFilter === a.id}">${a.id === "all" ? "" : logo(a.app, 13)} ${a.id === "all" ? a.title : a.title.length > 10 ? `${a.title.slice(0, 10)}…` : a.title}</button>`,
          )}</div>`
        : ""}
    </div>
    <div class="list-body" role="listbox" aria-label="도구 호출" data-keep-scroll="calls-${esc(scopeKey())}" tabindex="-1">
      ${unseen ? html`<button class="new-calls" data-action="jump-latest">${icon("chevron-up", 13)} 새 호출 ${unseen}개</button>` : ""}
      ${body}
      ${more > 0 ? html`<button class="more-row" data-action="more-calls">이전 호출 ${fmtInt(more)}개 더 보기</button>` : ""}
    </div>`;
}

function toolsLens() {
  const sel = selectedCallId();
  return html`<div class="split ${STATE.mobileDetail ? "has-detail" : ""}">
    <div class="pane-list" id="call-list">${callListView()}</div>
    <div class="pane-detail" id="stage" data-keep-scroll="stage">
      <button class="btn ghost sm back-btn" style="margin:10px 0 0 12px" data-action="mobile-back">${icon("arrow-left", 13)} 목록</button>
      ${stageView(sel ? callById(sel) : null)}
    </div>
  </div>`;
}
