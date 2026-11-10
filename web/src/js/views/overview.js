// Overview lens: the fleet at a glance (scope "all") or one agent's session.

function sparkline(agentId, width = 84, height = 22) {
  const buckets = 12;
  const now = Date.now();
  const counts = Array(buckets).fill(0);
  const errs = Array(buckets).fill(false);
  for (const c of DB.calls.filter((x) => x.agent === agentId)) {
    const age = (now - c.ts) / 60000;
    if (age < 0 || age >= 60) continue;
    const b = buckets - 1 - Math.floor(age / 5);
    counts[b]++;
    if (c.status === "error") errs[b] = true;
  }
  const max = Math.max(...counts, 1);
  const bw = width / buckets;
  const bars = counts
    .map((n, k) => {
      const h = n ? Math.max(3, (n / max) * (height - 2)) : 1.5;
      const color = errs[k] ? "var(--blocked)" : n ? "var(--accent)" : "#ffffff18";
      return `<rect x="${k * bw + 1}" y="${height - h}" width="${bw - 2}" height="${h}" rx="1.5" fill="${color}"/>`;
    })
    .join("");
  return raw(`<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="최근 1시간 도구 호출 ${sum(counts)}회">${bars}</svg>`);
}

function nowCell(a) {
  if (a.status === "offline") return html`<span class="dim">${a.offlineReason}</span>`;
  const c = currentCall(a.id);
  if (!c) return html`<span class="dim">—</span>`;
  return html`<span class="now-cell"><span style="color:${kindColor(c)};display:inline-flex">${toolIcon(c, 14)}</span><span class="tname">${toolTitle(c)}</span><span class="ttarget truncate">${toolTarget(c)}</span></span>`;
}

function statusPillFor(a) {
  const ago = a.status === "working" || a.status === "blocked" ? raw(`<span data-elapsed-ko="${a.sinceTs}">${fmtDurKo((Date.now() - a.sinceTs) / 1000)}</span>`) : shortAgo(a.sinceTs);
  const glyph = a.status === "working" ? spinner(12) : a.status === "blocked" ? icon("alert", 12) : a.status === "done" ? icon("check", 12) : "";
  const cls = a.status === "offline" || a.status === "ended" || a.status === "running" ? "unknown" : a.status;
  return html`<span class="pill ${cls}">${glyph} ${STATUS_LABEL[a.status]}${a.status === "offline" ? "" : html` · ${ago}`}</span>`;
}

function attentionCard(a) {
  const c = DB.calls.find((x) => x.agent === a.id && x.status === "pending");
  const ask = c?.name === "AskUserQuestion" ? c.input.questions[0] : null;
  return html`<div class="attn">
    ${logo(a.app, 34)}
    <div style="min-width:0">
      <div class="who"><span class="truncate">${a.title}</span><span class="dim" style="font-weight:400;font-size:var(--fs-sm)">${a.space} › ${a.tab}</span>
        <span class="pill blocked" style="margin-left:4px">${icon("alert", 12)}<span><span data-elapsed-ko="${a.sinceTs}">${fmtDurKo((Date.now() - a.sinceTs) / 1000)}</span>째 대기</span></span></div>
      <div class="why">${c?.permission ? c.permission.question : ask ? ask.question : "에이전트가 답을 기다려요"}</div>
      ${c ? html`<div class="what"><span class="chip mono">${toolIcon(c, 12)} ${toolTitle(c)}</span><span class="chip mono truncate">${toolTarget(c)}</span>${c.permission ? html`<span class="chip">${c.permission.impact}</span>` : ""}</div>` : ""}
    </div>
    <div class="acts">
      <button class="btn primary sm" data-action="open-call" data-agent="${a.id}" data-call="${c?.id || ""}">자세히 보기</button>
      <button class="btn sm" data-action="boundary" data-cmd="herdr-app do agent.focus --terminal ${a.id}">herdr에서 답하기 ${icon("arrow-up-right", 12)}</button>
    </div>
  </div>`;
}

function fleetOverview() {
  const agents = [...DB.agents].sort((x, y) => STATUS_RANK[y.status] - STATUS_RANK[x.status] || y.sinceTs - x.sinceTs);
  const blocked = agents.filter((a) => a.status === "blocked");
  const totals = DB.agents.map((a) => agentStats(a.id));
  return html`<div class="fleet">
    ${blocked.length ? html`<section aria-label="응답 필요"><h2 class="section-title" style="color:var(--blocked)">응답 필요 <small>${blocked.length}</small></h2><div class="col" style="gap:10px">${blocked.map(attentionCard)}</div></section>` : ""}
    <section aria-label="모든 에이전트">
      <h2 class="section-title">모든 에이전트 <small>도구 호출 ${sum(totals, (t) => t.calls)} · 바뀐 파일 ${sum(totals, (t) => t.files)} · 링크 ${sum(totals, (t) => t.links)}</small></h2>
      <div class="card" style="overflow-x:auto">
        <table class="ftable">
          <thead><tr><th>에이전트</th><th>상태</th><th>지금 하는 일</th><th>최근 1시간</th><th class="r">도구</th><th class="r">변경</th><th class="r">토큰</th></tr></thead>
          <tbody>${agents.map((a) => {
            const s = agentStats(a.id);
            const tok = a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite;
            return html`<tr tabindex="0" data-action="scope" data-scope="${a.id}" aria-label="${a.title} 열기">
              <td><div class="who">${logo(a.app, 28)}<div style="min-width:0"><div class="t truncate">${a.title}${a.unseen ? html` <span class="st dot" title="안 본 완료"></span>` : ""}</div><div class="s">${a.sub && agentById(a.parent) ? `↳ ${agentById(a.parent).title}의 하위 에이전트` : `${a.machine ? `${a.machine} · ` : ""}${a.space} › ${a.tab}`} · ${a.model}</div></div></div></td>
              <td>${statusPillFor(a)}</td>
              <td>${nowCell(a)}</td>
              <td>${a.status === "offline" ? "" : sparkline(a.id)}</td>
              <td class="r">${s.calls}${s.errors ? html` <span style="color:#ff8a80">· ${s.errors}✕</span>` : ""}</td>
              <td class="r">${s.files ? html`<span class="digest"><span class="a">+${s.add}</span> <span class="d">−${s.del}</span></span>` : html`<span class="dim">—</span>`}</td>
              <td class="r">${tok ? fmtK(tok) : "—"}</td>
            </tr>`;
          })}</tbody>
        </table>
      </div>
    </section>
  </div>`;
}

function tokenCard(a) {
  const t = a.tokens;
  const parts = [
    ["캐시 읽기", t.cacheRead, "var(--done)"],
    ["캐시 쓰기", t.cacheWrite, "#d9822b"],
    ["입력", t.input, "#57ab5a"],
    ["출력", t.output, "var(--working)"],
    ...(t.reasoning ? [["추론", t.reasoning, "var(--ansi13)"]] : []),
  ].filter(([, v]) => v > 0);
  const total = sum(parts, (p) => p[1]);
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  const hit = prompt ? Math.round((t.cacheRead / prompt) * 100) : 0;
  return html`<div class="card"><div class="card-h"><span class="grow">토큰 구성</span><span class="num" style="color:var(--foreground)">${fmtK(total)}</span></div>
    <div class="card-b">
      <div class="tokbar" role="img" aria-label="토큰 구성">${parts.map(([, v, c]) => raw(`<i style="flex:${v};background:${c}"></i>`))}</div>
      <div class="legend">${parts.map(([k, v, c]) => html`<div><i style="background:${c}"></i>${k}<span class="v">${fmtK(v)}</span><span class="p">${((v / total) * 100).toFixed(1)}%</span></div>`)}</div>
      <div class="kv" style="margin:14px 0 6px"><span>캐시 적중</span><b>${hit}%</b></div>
      <div class="meter"><i style="width:${hit}%"></i></div>
    </div></div>`;
}

function contextCard(a) {
  const pct = Math.round((a.context.used / a.context.limit) * 100);
  return html`<div class="card"><div class="card-b">
    <div class="kv"><span>컨텍스트</span><b>${fmtK(a.context.used)} <span class="dim" style="font-weight:400;font-size:var(--fs-sm)">/ ${fmtK(a.context.limit)}</span></b></div>
    <div class="meter ${pct > 70 ? "warn" : ""}"><i style="width:${pct}%"></i></div>
    <div class="dim" style="font-size:var(--fs-xs);margin-top:6px">마지막 요청의 프롬프트 토큰 · ${pct}%${pct > 70 ? " · 곧 자동 압축돼요" : ""}</div>
  </div></div>`;
}

function filesCard(a) {
  const files = filesOf(a.id);
  if (!files.length) return "";
  const blocks = (add, del) => {
    const total = add + del || 1;
    const nA = Math.round((add / total) * 5);
    const cells = Array.from({ length: 5 }, (_, k) => (k < nA ? "a" : k < nA + Math.round((del / total) * 5) ? "d" : ""));
    return raw(`<span class="blocks">${cells.map((c) => `<i class="${c}"></i>`).join("")}</span>`);
  };
  return html`<div class="card files-top"><div class="card-h"><span class="grow">바뀐 파일</span><button class="btn ghost sm" data-action="lens" data-lens="diffs">전부 보기 ${icon("arrow-right", 12)}</button></div>
    <div class="card-b" style="padding-top:6px">${files.slice(0, 6).map((f) => {
      const s = fileStats(f);
      return html`<button class="frow" data-action="open-file" data-agent="${a.id}" data-path="${f.path}">${fileIcon(f.path)}<span class="p truncate">${dirName(f.path) ? `${dirName(f.path)}/` : ""}<b>${baseName(f.path)}</b></span><span class="digest">${s.lock ? "lock" : raw(`<span class="a">+${s.add}</span> <span class="d">−${s.del}</span>`)}</span>${blocks(s.add, s.del)}</button>`;
    })}</div></div>`;
}

function nowCard(a) {
  if (a.status === "offline") {
    return html`<div class="card"><div class="empty"><div class="e-ico">${icon("server", 20)}</div><h3>home 머신에 닿지 않아요</h3><p>이 에이전트의 기록은 그 머신의 herdr-core에 있어요. 로그인하면 다시 보여요.</p><button class="btn sm" data-action="copy" data-copy="hc machine login home">${icon("copy", 12)} hc machine login home</button></div></div>`;
  }
  const c = currentCall(a.id);
  const lastReply = repliesOf(a.id).slice(-1)[0];
  const showReply = (a.status === "done" || a.status === "idle") && lastReply && (!c || lastReply.ts > c.ts);
  const label = a.status === "blocked" ? "응답을 기다리는 호출" : a.status === "working" ? "지금 하는 일" : showReply ? "마지막 답변" : "마지막 호출";
  return html`<div class="card now">
    <div class="now-h">${statusPillFor(a)}<span class="lbl">${label}</span><span class="grow"></span>
      ${c && !showReply ? html`<button class="btn sm" data-action="open-call" data-agent="${a.id}" data-call="${c.id}">도구 호출에서 열기 ${icon("arrow-right", 12)}</button>` : ""}
      ${showReply ? html`<button class="btn sm" data-action="lens" data-lens="prompts">프롬프트에서 보기 ${icon("arrow-right", 12)}</button>` : ""}
    </div>
    <div class="now-body">${showReply ? md(lastReply.text, { numbers: new Map() }) : c ? html`${permissionBanner(c)}${rendererFor(c)(c)}` : html`<div class="dim">아직 호출이 없어요.</div>`}</div>
  </div>`;
}

function turnsCard(a) {
  const prompts = promptsOf(a.id);
  if (!prompts.length) return "";
  return html`<div class="card"><div class="card-h"><span class="grow">턴</span><span class="dim" style="font-weight:400">프롬프트 하나에 이어진 도구 호출</span></div>
    <div class="card-b turns">${[...prompts].reverse().map((p) => {
      const calls = callsOf(a.id).filter((c) => c.turn === p.n);
      return html`<button class="turn" data-action="open-prompt" data-agent="${a.id}" data-prompt="${p.n}">
        <span class="n">#${p.n}</span>
        <span style="min-width:0"><div class="q truncate">${p.text.split("\n")[0]}</div>
          <div class="ticks" aria-label="도구 호출 ${calls.length}개">${calls.map((c) => raw(`<i class="${c.status === "error" ? "err" : ""}" style="background:${kindColor(c)}" title="${esc(toolTitle(c))}"></i>`))}</div></span>
        <span class="t">${relTime(p.ts)}</span>
      </button>`;
    })}</div></div>`;
}

function agentOverview(a) {
  const s = agentStats(a.id);
  const tok = a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite + (a.tokens.reasoning || 0);
  const firstPrompt = promptsOf(a.id)[0];
  const workSec = firstPrompt ? ((a.status === "working" || a.status === "blocked" ? Date.now() : a.sinceTs) - firstPrompt.ts) / 1000 : 0;
  return html`<div class="ov">
    <div class="ov-col">${nowCard(a)}${subsCard(a)}${turnsCard(a)}</div>
    <div class="ov-col">
      ${a.status === "offline" ? html`<div class="card"><div class="card-b dim" style="font-size:var(--fs-sm)">마지막으로 본 때: ${relTime(a.sinceTs)} · 기록은 연결되면 다시 읽어요.</div></div>` : html`<div class="stats">
        <div class="stat"><div class="k">토큰</div><div class="v">${fmtK(tok)}</div><div class="s">출력 ${fmtK(a.tokens.output)}</div></div>
        <div class="stat"><div class="k">작업 시간</div><div class="v">${fmtDurKo(workSec)}</div><div class="s">턴 ${s.prompts}회</div></div>
        <div class="stat"><div class="k">도구 호출</div><div class="v">${s.calls}</div><div class="s">${s.errors ? html`<span class="d">실패 ${s.errors}</span>` : "실패 없음"}</div></div>
        <div class="stat"><div class="k">바뀐 파일</div><div class="v">${s.files}</div><div class="s"><span class="a">+${s.add}</span> <span class="d">−${s.del}</span></div></div>
      </div>`}
      ${a.status === "offline" ? "" : html`${tokenCard(a)}${contextCard(a)}`}
      ${filesCard(a)}
    </div>
  </div>`;
}
