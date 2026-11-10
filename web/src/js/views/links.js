// Links lens: every link in the conversation, told apart by who brought it (yours, in a prompt;
// the agent's, in a reply), grouped by that prompt or reply, with the sentence it came from
// and the URL taken apart.

function scopeLinks() {
  const list = STATE.scope === "all" ? allLinks() : linksOf(STATE.scope);
  const q = STATE.linkQuery.trim().toLowerCase();
  const from = uiGet("links:from", "all");
  return list.filter((l) => (from === "all" || l.from === from) && (STATE.linkDomain === "all" || hostOf(l.url) === STATE.linkDomain) && (!q || `${l.title} ${l.url}`.toLowerCase().includes(q)));
}

function selectedLink(list) {
  const key = STATE.sel.link[scopeKey()];
  return list.find((l) => l.key === key) || list[0] || null;
}

function linkRow(l, selected) {
  return html`<button class="link-row" role="option" aria-selected="${selected}" data-action="select-link" data-key="${l.key}">
    <span class="n">[${l.n}]</span>${fav(l.url, 22)}
    <span style="min-width:0"><div class="ti truncate">${l.title}</div><div class="do"><span class="truncate">${hostOf(l.url)}</span>${l.badge ? html`<span class="lbadge ${l.badge.cls}">${l.badge.text}</span>` : ""}</div></span>
  </button>`;
}

function linkGroups(list, sel) {
  const byReply = groupBy(list, (l) => `${l.agent}:${l.from}:${l.srcN}`);
  const keys = Object.keys(byReply).sort((x, y) => byReply[y][0].replyTs - byReply[x][0].replyTs);
  let lastAgent = null;
  return keys.map((k) => {
    const items = byReply[k];
    const a = agentById(items[0].agent);
    const agentHead = STATE.scope === "all" && a.id !== lastAgent ? html`<div class="list-sep" style="color:var(--muted);font-weight:600">${logo(a.app, 14)} ${a.title}</div>` : "";
    lastAgent = a.id;
    const mine = items[0].from === "user";
    return html`${agentHead}<div class="list-sep link-src ${mine ? "mine" : ""}"><span>${icon(mine ? "message" : "bot", 12)} ${mine ? `내가 보낸 링크 · 프롬프트 #${items[0].srcN}` : `에이전트 답변 #${items[0].srcN}`} · ${relTime(items[0].replyTs)} · ${items.length}개</span></div>${items.map((l) => linkRow(l, sel && l.key === sel.key))}`;
  });
}

function urlAnatomy(url) {
  const u = parseUrl(url);
  if (!u) return html`<div class="anatomy">${url}</div>`;
  const params = [...u.searchParams.entries()];
  return html`<div class="anatomy"><span class="sch">${u.protocol}//</span><span class="hst">${u.host}</span><span class="pth">${decodeURIComponent(u.pathname)}</span>${u.search ? html`<span class="qry">${u.search}</span>` : ""}${u.hash ? html`<span class="frg">${decodeURIComponent(u.hash)}</span>` : ""}
    ${params.length ? html`<div class="qtable">${params.map(([k, v]) => html`<span class="k">${k}</span><span class="v">${v}</span>`)}</div>` : ""}
  </div>`;
}

function linkDetail(l, list) {
  if (!l) return html`<div class="empty"><div class="e-ico">${icon("link", 20)}</div><h3>링크를 고르세요</h3></div>`;
  const a = agentById(l.agent);
  const mine = l.from === "user";
  const reply = mine ? promptsOf(l.agent).find((p) => p.n === l.srcN) : DB.replies.find((r) => r.agent === l.agent && r.n === l.reply);
  const quote = (() => {
    const text = esc(l.context);
    const label = esc(l.label || l.url);
    const i = text.indexOf(label);
    if (i < 0) return raw(`${text}<sup>${l.n}</sup>`);
    return raw(`${text.slice(0, i)}<span class="hl">${label}</span><sup>${l.n}</sup>${text.slice(i + label.length)}`);
  })();
  const sameHost = list.filter((x) => hostOf(x.url) === hostOf(l.url) && x.key !== l.key);
  const siblings = (reply?.links ?? []).filter((x) => x.url !== l.url);
  const mdLink = `[${l.title}](${l.url})`;
  return html`<div class="link-detail">
    <div class="ld-head">${fav(l.url, 44)}<div style="min-width:0"><h2>${l.title}</h2><div class="host">${hostOf(l.url)}${l.badge ? html` · <span class="lbadge ${l.badge.cls}">${l.badge.text}</span>` : ""}</div></div></div>
    <div class="ld-actions">
      <a class="btn primary" href="${l.url}" target="_blank" rel="noopener noreferrer">${icon("external", 14)} 열기</a>
      <button class="btn" data-action="copy" data-copy="${l.url}">${icon("copy", 14)} URL 복사</button>
      <button class="btn" data-action="copy" data-copy="${mdLink}">${icon("copy", 14)} 마크다운으로 복사</button>
    </div>
    <div class="ld-label">${mine ? "프롬프트 속 문장" : "답변 속 문장"} <span class="chip ${mine ? "mine" : ""}">${mine ? "내가 보낸 링크" : "에이전트 답변"}</span></div>
    <div class="quote">${quote}</div>
    <div class="quote-meta">${logo(a.app, 14)} ${a.title} · ${mine ? `프롬프트 #${l.srcN}` : `답변 #${l.reply}`} · ${clock(l.replyTs)} (${relTime(l.replyTs)})
      <button class="btn ghost sm" data-action="open-prompt" data-agent="${l.agent}" data-prompt="${l.turn}">${mine ? "이 프롬프트 보기" : "이 답변의 프롬프트"} ${icon("arrow-right", 12)}</button></div>
    <div class="ld-label">주소 뜯어보기</div>
    ${urlAnatomy(l.url)}
    ${siblings.length ? html`<div class="ld-label">${mine ? "같은 프롬프트의 다른 링크" : "같은 답변의 다른 링크"}</div><div class="chips">${siblings.map((x) => html`<button class="chip" data-action="select-link" data-key="${l.agent}:${mine ? `p${l.srcN}` : l.reply}:${x.n}">${fav(x.url, 14)} [${x.n}] ${x.title}</button>`)}</div>` : ""}
    ${sameHost.length ? html`<div class="ld-label">${hostOf(l.url)}의 다른 링크 ${sameHost.length}개</div><div class="chips">${sameHost.map((x) => html`<button class="chip" data-action="select-link" data-key="${x.key}">${x.title}</button>`)}</div>` : ""}
  </div>`;
}

function linksLens() {
  const base = STATE.scope === "all" ? allLinks() : linksOf(STATE.scope);
  const list = scopeLinks();
  const sel = selectedLink(list);
  const domains = Object.entries(groupBy(base, (l) => hostOf(l.url)))
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, 6);
  const allMd = list.map((l) => `- [${l.title}](${l.url})`).join("\n");
  const from = uiGet("links:from", "all");
  const mineCount = base.filter((l) => l.from === "user").length;
  let body;
  if (!base.length) {
    body = html`<div class="empty"><div class="e-ico">${icon("link", 20)}</div><h3>링크가 없어요</h3><p>프롬프트에 넣은 링크와 에이전트 답변에 나온 링크가 여기 모여요. 코드 블록 안의 주소는 빼요.</p></div>`;
  } else if (!list.length) {
    body = html`<div class="empty"><h3>맞는 링크가 없어요</h3><button class="btn sm" data-action="clear-link-filters">필터 지우기</button></div>`;
  } else body = linkGroups(list, sel);
  return html`<div class="split ${STATE.mobileDetail ? "has-detail" : ""}">
    <div class="pane-list">
      <div class="list-tools">
        <div class="row">
          <label class="input grow">${icon("search", 14)}<input type="search" placeholder="제목 · 주소 검색" value="${STATE.linkQuery}" data-input="linkQuery" data-focus-key="q-links" aria-label="링크 검색"></label>
          <button class="btn sm" data-action="copy" data-copy="${allMd}" ${list.length ? "" : raw("disabled")} title="보이는 링크를 마크다운 목록으로">${icon("copy", 13)} 전부</button>
        </div>
        <div class="seg" role="group" aria-label="누구의 링크인지">${[["all", `전체 ${base.length}`], ["user", `내가 보낸 ${mineCount}`], ["agent", `에이전트 답변 ${base.length - mineCount}`]].map(
          ([id, label]) => html`<button data-action="ui-set" data-key="links:from" data-value="${id}" aria-pressed="${from === id}">${label}</button>`,
        )}</div>
        ${domains.length > 1 ? html`<div class="chips"><button class="chip" data-action="link-domain" data-domain="all" aria-pressed="${STATE.linkDomain === "all"}">전체 <span class="count">${base.length}</span></button>${domains.map(
          ([d, ls]) => html`<button class="chip" data-action="link-domain" data-domain="${d}" aria-pressed="${STATE.linkDomain === d}">${fav(`https://${d}`, 13)} ${d} <span class="count">${ls.length}</span></button>`,
        )}</div>` : ""}
      </div>
      <div class="list-body" role="listbox" aria-label="링크" data-keep-scroll="links-${esc(scopeKey())}">${body}</div>
    </div>
    <div class="pane-detail" data-keep-scroll="link-detail">
      <button class="btn ghost sm back-btn" style="margin:10px 0 0 12px" data-action="mobile-back">${icon("arrow-left", 13)} 목록</button>
      ${linkDetail(sel, base)}
    </div>
  </div>`;
}
