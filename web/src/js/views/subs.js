// 하위 에이전트: the terminals an agent started with `hc run`, as a tree (who started whom),
// and for the one picked: what it was asked, its steps (newest first) and what it reported.

const STEP_LIMIT = 150;

/** Tree rows for the scope: an agent's descendants, or (all) every agent that has some. */
function subRows() {
  if (STATE.scope !== "all") return subsOf(STATE.scope);
  return DB.roster.roots.filter((r) => DB.roster.kids[r]?.length).flatMap((r) => [{ node: DB.roster.nodes[r], lines: [], head: true }, ...subsOf(r)]);
}

function pickedSub() {
  const rows = subRows();
  const subs = rows.filter((r) => !r.head);
  if (!subs.length) return null;
  const id = uiGet(`sub:${STATE.scope}`, null);
  const hit = rows.find((r) => r.node.id === id);
  return (hit ?? subs.find((r) => r.node.status === "working") ?? subs.find((r) => r.node.isAgent && r.node.state === "live") ?? subs.find((r) => r.node.isAgent) ?? subs[0]).node;
}

function subStepLine(a) {
  if (!a.isAgent) return a.command;
  const calls = callsOf(a.id);
  if (!calls.length) return a.task ? a.task.split("\n")[0] : a.note ? "기록 없음" : a.loaded ? "아직 도구를 쓰지 않았어요" : "기록을 읽는 중…";
  const last = calls[calls.length - 1];
  return `${toolTitle(last)} ${toolTarget(last)}`.trim();
}

const subElapsed = (a) => (a.created ? fmtDurKo(((a.finished ?? Date.now()) - a.created) / 1000) : "");

function subTreeRow({ node: a, lines, head }, picked) {
  const calls = callsOf(a.id).length;
  return html`<button class="sub-row ${a.state === "ended" ? "ended" : ""} ${head ? "head" : ""}" role="option" aria-selected="${picked?.id === a.id}" data-action="pick-sub" data-sub="${a.id}">
    ${treeLines(lines)}${logo(a.app, head ? 24 : 22)}
    <span class="grow" style="min-width:0">
      <span class="t"><span class="truncate">${a.title}</span><span class="addr mono">${a.id}</span></span>
      <span class="s mono truncate ${a.status === "working" ? "working" : ""}">${subStepLine(a)}</span>
    </span>
    <span class="r">${statusGlyph(a, 13)}<span>${calls ? `호출 ${fmtInt(calls)}` : subElapsed(a)}</span></span>
  </button>`;
}

function subCrumbs(a) {
  const chain = parentsOf(a.id).reverse().map(agentById).filter(Boolean);
  return html`<nav class="sub-crumbs" aria-label="띄운 순서">${chain.map(
    (p) => html`<button data-action="${p.sub ? "pick-sub" : "scope"}" data-sub="${p.id}" data-scope="${p.id}">${logo(p.app, 15)}<span class="truncate">${p.title}</span></button>${icon("chevron-right", 12)}`,
  )}<b>${a.title}</b></nav>`;
}

function subSteps(a) {
  const all = callsOf(a.id);
  const calls = all.slice(-STEP_LIMIT).reverse();
  const prompts = promptsOf(a.id);
  const byTurn = groupBy(calls, (c) => c.turn);
  const turns = Object.keys(byTurn).map(Number).sort((x, y) => y - x);
  return html`<h2 class="section-title">단계 <small>${fmtInt(all.length)} · 최신이 위 · 누르면 그 호출을 열어요</small></h2>
    <div class="sub-steps">${turns.map((turn) => {
      const p = prompts.find((x) => x.n === turn);
      const label = p ? (p.display ?? p.text).split("\n").find((l) => l.trim()) || "" : "프롬프트 전";
      return html`<div class="sub-turn"><span class="n">#${turn}</span><span class="truncate grow">${label}</span>${p ? html`<span class="dim">${relTime(p.ts)}</span>` : ""}</div>
        ${byTurn[turn].map(
          (c) => html`<button class="item" data-action="open-call" data-agent="${a.id}" data-call="${c.id}">
            ${callStatusIcon(c)}<span style="color:${kindColor(c)};display:inline-flex">${toolIcon(c, 14)}</span>
            <span class="tname" style="color:${kindColor(c)}">${toolTitle(c)}</span><span class="ttarget truncate grow">${toolTarget(c)}</span>
            ${digestHTML(c)}<span class="tdur">${c.status === "running" ? "" : fmtDur(c.dur)}</span>
          </button>`,
        )}`;
    })}</div>
    ${all.length > calls.length ? html`<button class="more-row" data-action="open-lens" data-agent="${a.id}" data-lens="tools">이전 단계 ${fmtInt(all.length - calls.length)}개는 '자세히 보기'에서</button>` : ""}`;
}

function subDetail(a) {
  const time = a.state === "ended"
    ? `${subElapsed(a)} 동안 실행 · ${relTime(a.finished)} 끝남${a.exit ? ` · 종료 코드 ${a.exit}` : a.reason === "killed" ? " · 중지됨" : ""}`
    : `${subElapsed(a)} 전 시작`;
  const head = html`${subCrumbs(a)}
    <div class="sub-head">
      ${logo(a.app, 36)}
      <div class="grow" style="min-width:0">
        <div class="sub-title"><h2 class="truncate">${a.title}</h2><span class="chip mono">${a.id}</span>${a.inferred ? html`<span class="chip" title="시작 시각과 맡긴 일로 이 하위 에이전트의 기록을 골랐어요">추정 연결</span>` : ""}${statusPillFor(a)}</div>
        <div class="dim truncate" style="font-size:var(--fs-sm)">${[a.model, a.cwd, time].filter(Boolean).join(" · ")}</div>
      </div>
      ${a.isAgent && a.provider && !a.note ? html`<button class="btn" data-action="scope-a" data-scope="${a.id}" title="이 하위 에이전트의 도구 호출·프롬프트·변경을 렌즈로 봐요">${icon("arrow-right", 14)}<span>자세히 보기</span></button>` : ""}
    </div>`;
  if (!a.isAgent) {
    return html`${head}<div class="sub-box"><div class="k">실행한 명령</div><pre class="mono">${a.command}</pre></div>
      <p class="dim" style="font-size:var(--fs-sm)">에이전트가 아닌 프로그램이라 단계 기록은 없어요. 화면은 herdr에서 볼 수 있어요.</p>`;
  }
  const prompts = promptsOf(a.id);
  const task = a.task ?? (prompts.find((p) => LS.isHumanPrompt(p)) ?? prompts[0])?.text ?? null;
  const replies = repliesOf(a.id);
  const reply = replies[replies.length - 1];
  const s = agentStats(a.id);
  const tok = a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite;
  const taskBox = task ? html`<div class="sub-box"><div class="k">맡긴 일</div><div class="task">${task.length > 1500 ? `${task.slice(0, 1500)}…` : task}</div></div>` : "";
  if (!a.provider) return html`${head}${taskBox}<p class="dim" style="font-size:var(--fs-sm)">이 프로그램의 기록 형식은 읽지 못해요. Claude Code와 Codex의 단계만 보여요.</p>`;
  if (!a.loaded) return html`${head}${taskBox}<p class="dim" style="font-size:var(--fs-sm)">기록을 읽는 중이에요…</p>`;
  if (a.note) return html`${head}${taskBox}<p class="dim" style="font-size:var(--fs-sm)">이 하위 에이전트의 대화 기록 파일을 찾지 못했어요.</p>`;
  return html`${head}${taskBox}
    ${reply && a.status !== "working" ? html`<div class="sub-box"><div class="k">마지막 답변 · ${relTime(reply.ts)}</div><div class="reply">${md(reply.text.length > 1500 ? `${reply.text.slice(0, 1500)}…` : reply.text)}</div></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">도구 호출</div><div class="v">${s.calls}</div><div class="s">${s.errors ? html`<span class="d">실패 ${s.errors}</span>` : "실패 없음"}</div></div>
      <div class="stat"><div class="k">바뀐 파일</div><div class="v">${s.files}</div><div class="s"><span class="a">+${s.add}</span> <span class="d">−${s.del}</span></div></div>
      <div class="stat"><div class="k">토큰</div><div class="v">${fmtK(tok)}</div><div class="s">출력 ${fmtK(a.tokens.output)}</div></div>
    </div>
    ${s.calls ? subSteps(a) : html`<p class="dim" style="font-size:var(--fs-sm)">아직 도구를 쓰지 않았어요.</p>`}`;
}

function subsLens() {
  const rows = subRows();
  const subs = rows.filter((r) => !r.head);
  if (!subs.length) {
    return html`<div class="empty"><div class="e-ico">${icon("workflow", 20)}</div><h3>하위 에이전트가 없어요</h3><p>에이전트가 <span class="mono">hc run</span>으로 다른 에이전트나 프로그램을 띄우면, 누가 누구를 띄웠는지와 각자의 단계가 여기 나타나요.</p></div>`;
  }
  const picked = pickedSub();
  const live = subs.filter((r) => r.node.state === "live").length;
  return html`<div class="split ${STATE.mobileDetail ? "has-detail" : ""}">
    <div class="pane-list">
      <div class="list-tools"><div class="row" style="font-size:var(--fs-sm)">${icon("workflow", 14)}<b>하위 에이전트 ${subs.length}</b><span class="dim">실행 중 ${live} · 끝남 ${subs.length - live}</span></div></div>
      <div class="list-body sub-tree" role="listbox" aria-label="하위 에이전트" data-keep-scroll="subs-${esc(STATE.scope)}">${rows.map((r) => subTreeRow(r, picked))}</div>
    </div>
    <div class="pane-detail sub-detail" data-keep-scroll="sub-detail">
      <button class="btn ghost sm back-btn" data-action="mobile-back">${icon("arrow-left", 13)} 목록</button>
      ${subDetail(picked)}
    </div>
  </div>`;
}

/** The overview's block: this agent's sub-agents at a glance. */
function subsCard(a) {
  const rows = subsOf(a.id);
  if (!rows.length) return "";
  const shown = rows.slice(0, 8);
  return html`<div class="card"><div class="card-h"><span class="grow">하위 에이전트 <span class="dim" style="font-weight:400">${rows.length}</span></span><button class="btn ghost sm" data-action="lens" data-lens="subs">모두 보기 ${icon("arrow-right", 12)}</button></div>
    <div class="card-b sub-tree" style="padding:6px">${shown.map((r) => subTreeRow(r, null))}</div></div>`;
}
