// WebFetch and WebSearch, drawn as a browser window.

function addressBar(url, running, right) {
  const u = parseUrl(url);
  const secure = u?.protocol === "https:";
  const host = u ? u.hostname : url;
  const rest = u ? `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}` : "";
  return html`<div class="br-bar">
    <div class="br-nav" aria-hidden="true">${icon("chevron-left", 16)}${icon("chevron-right", 16)}${icon("rotate", 14)}</div>
    <div class="addr" title="${url}">
      <span class="${secure ? "lock" : ""}" style="${secure ? "" : "color:var(--working)"}">${icon(secure ? "lock" : "alert", 13)}</span>
      <span class="host">${host}</span><span class="rest">${rest}</span>
    </div>
    ${right}
  </div>
  ${running ? raw('<div class="loadbar"></div>') : ""}`;
}

// Real WebFetch results -> {code, codeText, bytes, result, redirect}.
function fetchResult(call) {
  const x = call.result?.extra ?? {};
  const text = x.result ?? call.result?.text ?? "";
  const to = /Redirect URL:\s*(\S+)/i.exec(text)?.[1];
  const from = /Original URL:\s*(\S+)/i.exec(text)?.[1] ?? call.input?.url;
  return { code: x.code, codeText: x.codeText, bytes: x.bytes, result: to ? "" : text, redirect: to ? { from, to } : null };
}

// Claude nests {content: [{title, url}]}; Codex gives {title, url, snippet} directly.
function searchResult(call) {
  const results = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.url === "string" && v.title) results.push({ title: v.title, url: v.url, snippet: v.snippet ?? "" });
    else Object.values(v).forEach(walk);
  };
  const raw = call.result?.extra?.results;
  walk(raw);
  const summary = (Array.isArray(raw) ? raw.find((r) => typeof r === "string") : null) ?? (results.length ? "" : call.result?.text ?? "");
  return { results, summary };
}

function renderWebFetch(call) {
  const i = call.input;
  const r = fetchResult(call);
  const running = call.status === "running";
  const cls = r.code ? `s${String(r.code)[0]}` : "";
  const right = html`${r.code ? html`<span class="http ${cls}">${r.code} ${r.codeText || ""}</span>` : ""}<span class="dim" style="font-size:var(--fs-xs);white-space:nowrap">${r.bytes ? fmtBytes(r.bytes) : ""} · ${fmtDur(call.dur)}</span>`;
  const redirect = r.redirect
    ? html`<div class="redirect">${icon("arrow-up-right", 14)}<span>다른 호스트로 이동해서 따라가지 않았어요: <b class="mono">${hostOf(r.redirect.from)}</b> → <b class="mono">${hostOf(r.redirect.to)}</b>. 같은 주소로 다시 가져와야 해요.</span>
        ${(() => {
          const next = DB.calls.find((c) => c.agent === call.agent && c.name === "WebFetch" && c.input.url === r.redirect.to);
          return next ? html`<button class="btn sm" data-action="select-call" data-call="${next.id}">다음 호출 보기 ${icon("arrow-right", 12)}</button>` : "";
        })()}</div>`
    : "";
  return html`<div class="browser">
    <div class="br-tabs"><div class="br-tab">${fav(i.url, 14)}<span class="truncate">${r.title || hostOf(i.url)}</span></div></div>
    ${addressBar(i.url, running, right)}
    ${redirect}
    ${i.prompt ? html`<div class="br-prompt">${icon("message", 14)}<div><div class="lbl" style="margin-bottom:2px">이 페이지에 물은 것</div>${i.prompt}</div></div>` : ""}
    <div class="br-body">${r.result ? md(r.result) : running ? html`<div class="dim">페이지를 읽는 중…</div>` : r.redirect ? "" : html`<div class="dim">(본문 없음)</div>`}</div>
  </div>`;
}

function renderWebSearch(call) {
  const i = call.input;
  const r = searchResult(call);
  const filters = [
    ...(i.allowed_domains || []).map((d) => html`<span class="tag"><i>허용</i>${d}</span>`),
    ...(i.blocked_domains || []).map((d) => html`<span class="tag"><i>제외</i>${d}</span>`),
  ];
  return html`<div class="browser">
    <div class="br-tabs"><div class="br-tab">${icon("search", 13)}<span class="truncate">${i.query}</span></div></div>
    <div class="br-bar">
      <div class="addr" style="border-radius:10px">${icon("search", 14)}<span class="host" style="font-weight:500">${i.query}</span></div>
      <span class="dim" style="font-size:var(--fs-xs);white-space:nowrap">결과 ${(r.results || []).length}개 · ${fmtDur(call.dur)}</span>
    </div>
    ${filters.length ? html`<div class="tags" style="padding:0 18px">${filters}</div>` : ""}
    <div class="sr">${(r.results || []).map((res) => {
      const u = parseUrl(res.url);
      return html`<div class="sr-item">${fav(res.url, 24)}<div style="min-width:0">
        <div class="sr-url truncate"><span class="d">${u ? u.hostname.replace(/^www\./, "") : ""}</span><span>${u ? u.pathname.replace(/\/$/, "") : ""}</span></div>
        <a class="sr-title" href="${res.url}" target="_blank" rel="noopener noreferrer">${res.title}</a>
        ${res.snippet ? html`<div class="sr-snip">${res.snippet}</div>` : ""}
      </div></div>`;
    })}</div>
    ${r.summary ? html`<div class="br-body" style="border-top:1px solid var(--border)"><div class="lbl" style="margin-bottom:6px">모델이 정리한 답</div>${md(r.summary)}</div>` : ""}
  </div>`;
}
