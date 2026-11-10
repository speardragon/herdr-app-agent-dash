// Prompts lens: what you asked, by day (prompt-history), and what each prompt set off.

function scopePrompts() {
  const list = STATE.scope === "all" ? DB.prompts : promptsOf(STATE.scope);
  return [...list].sort((a, b) => b.ts - a.ts);
}

const promptKey = (p) => `${p.agent}:${p.n}`;

function selectedPrompt(list) {
  const key = STATE.sel.prompt[scopeKey()];
  return list.find((p) => promptKey(p) === key) || list[0] || null;
}

function oneLine(text) {
  return raw(
    text
      .split("\n")
      .filter((l, i, arr) => l.trim() || i < arr.length - 1)
      .map((l) => esc(l.trim()))
      .join('<span class="nl">↵</span>'),
  );
}

function promptRow(p, selected) {
  const a = agentById(p.agent);
  return html`<button class="prompt-row" role="option" aria-selected="${selected}" data-action="select-prompt" data-key="${promptKey(p)}">
    <span class="n">${p.n}</span>
    <span class="row" style="min-width:0;gap:7px">${STATE.scope === "all" ? logo(a.app, 15) : ""}<span class="truncate">${oneLine(p.text)}</span></span>
    <span class="rt" data-rel="${p.ts}">${relTime(p.ts)}</span>
  </button>`;
}

function turnSummary(p) {
  const calls = callsOf(p.agent).filter((c) => c.turn === p.n);
  const next = promptsOf(p.agent).find((x) => x.n === p.n + 1);
  const reply = repliesOf(p.agent).find((r) => r.turn === p.n);
  const end = reply ? reply.ts : next ? next.ts : Date.now();
  const files = uniq(calls.filter((c) => kindOf(c) === "edit").flatMap((c) => (c.name === "apply_patch" ? patchFiles(c.input.patch).map((f) => f.path) : [c.input.file_path])));
  const running = !reply && calls.some((c) => c.status === "running" || c.status === "pending");
  return { calls, reply, files, secs: (end - p.ts) / 1000, running };
}

function promptDetail(p) {
  if (!p) return html`<div class="empty"><div class="e-ico">${icon("message", 20)}</div><h3>보낸 프롬프트가 없어요</h3></div>`;
  const a = agentById(p.agent);
  const t = turnSummary(p);
  const textHTML = raw(esc(p.text) + (p.images ? Array.from({ length: p.images }, (_, k) => ` <span class="att">${icon("image", 13).s} [Image #${k + 1}]</span>`).join("") : ""));
  return html`<div class="prompt-detail">
    <div class="pd-head">
      <span class="no">#${p.n}</span><span>${clock(p.ts)} · <span data-rel="${p.ts}">${relTime(p.ts)}</span></span>
      ${STATE.scope === "all" ? html`<span class="chip">${logo(a.app, 13)} ${a.title}</span>` : ""}
      <span class="grow"></span>
      <button class="btn sm" data-action="copy" data-copy="${p.text}">${icon("copy", 13)} 복사</button>
    </div>
    <div class="pd-text">${textHTML}</div>
    <div class="ld-label">이 프롬프트가 한 일</div>
    <div class="after">
      <div class="stat"><div class="k">걸린 시간</div><div class="v">${t.running ? html`<span class="pulse" style="color:var(--working)">진행 중</span>` : fmtDurKo(t.secs)}</div></div>
      <div class="stat"><div class="k">도구 호출</div><div class="v">${t.calls.length}</div></div>
      <div class="stat"><div class="k">바뀐 파일</div><div class="v">${t.files.length}</div></div>
      <div class="stat"><div class="k">답변 속 링크</div><div class="v">${t.reply ? t.reply.links.length : 0}</div></div>
    </div>
    ${t.calls.length ? html`<div class="strip">${[...t.calls].sort((x, y) => x.ts - y.ts).map(
      (c) => html`<button data-action="open-call" data-agent="${c.agent}" data-call="${c.id}" title="${toolTarget(c)}"><span style="color:${kindColor(c)};display:inline-flex">${toolIcon(c, 13)}</span><b>${toolTitle(c)}</b><span class="truncate mono" style="font-size:11px">${toolTarget(c)}</span></button>`,
    )}</div>` : ""}
    ${t.reply ? html`<div class="ld-label">답변 · ${clock(t.reply.ts)}</div><div class="reply">${md(t.reply.text, { numbers: new Map() })}</div>` : html`<div class="ld-label">답변</div><div class="reply dim">${t.running ? "아직 답하는 중이에요." : "답변이 없어요."}</div>`}
  </div>`;
}

function promptsLens() {
  const list = scopePrompts();
  const sel = selectedPrompt(list);
  const byDay = groupBy(list, (p) => dayKey(p.ts));
  const body = list.length
    ? Object.values(byDay).map((ps) => html`<div class="list-sep"><span>${dayLabel(ps[0].ts)}</span></div>${ps.map((p) => promptRow(p, sel && promptKey(p) === promptKey(sel)))}`)
    : html`<div class="empty"><div class="e-ico">${icon("message", 20)}</div><h3>프롬프트가 없어요</h3></div>`;
  return html`<div class="split ${STATE.mobileDetail ? "has-detail" : ""}">
    <div class="pane-list">
      <div class="list-tools"><div class="row">
        <span class="grow" style="font-size:var(--fs-sm);color:var(--muted)">보낸 프롬프트 <b style="color:var(--foreground)">${list.length}</b>개 · 슬래시 명령 제외</span>
        <div class="seg" role="group" aria-label="시간 표기">
          <button data-action="locale" data-value="ko" aria-pressed="${UI.locale === "ko"}">한국어</button>
          <button data-action="locale" data-value="en" aria-pressed="${UI.locale === "en"}">EN</button>
        </div>
      </div></div>
      <div class="list-body" role="listbox" aria-label="프롬프트" data-keep-scroll="prompts-${esc(scopeKey())}">${body}</div>
    </div>
    <div class="pane-detail" data-keep-scroll="prompt-detail">
      <button class="btn ghost sm back-btn" style="margin:10px 0 0 12px" data-action="mobile-back">${icon("arrow-left", 13)} 목록</button>
      ${promptDetail(sel)}
    </div>
  </div>`;
}
