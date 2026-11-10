// Any other MCP tool: inputs as key/value, result as a summary (Jira, Notion, Markdown) or raw JSON.

const JIRA_TYPE = {
  Epic: ["#904ee2", '<path d="M13 3 6 14h5l-1 7 7-11h-5z" fill="#fff"/>'],
  Story: ["#63ba3c", '<path d="M8 5h8v14l-4-3-4 3z" fill="#fff"/>'],
  Task: ["#4bade8", '<path d="m7.5 12.5 3 3 6-6.5" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'],
  Bug: ["#e5493a", '<circle cx="12" cy="12" r="4.2" fill="#fff"/>'],
};

const jiraTypeIcon = (type, size = 16) => {
  const [bg, glyph] = JIRA_TYPE[type] || JIRA_TYPE.Task;
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-label="${esc(type)}"><rect width="24" height="24" rx="5" fill="${bg}"/>${glyph}</svg>`);
};

const PRIORITY = {
  Highest: ["#ff5630", "m6 11 6-6 6 6M6 18l6-6 6 6"],
  High: ["#ff7452", "m6 15 6-6 6 6"],
  Medium: ["#ffab00", "M6 10h12M6 15h12"],
  Low: ["#4c9aff", "m6 9 6 6 6-6"],
};

const priorityIcon = (p) => {
  const [c, d] = PRIORITY[p] || PRIORITY.Medium;
  return raw(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-label="우선순위 ${esc(p)}"><path d="${d}"/></svg>`);
};

function avatar(name, size = 18) {
  if (!name) return raw(`<span class="av" style="width:${size}px;height:${size}px;background:#ffffff18;color:var(--dim)">?</span>`);
  return raw(`<span class="av" style="width:${size}px;height:${size}px;background:hsl(${hashStr(name) % 360} 60% 72%)">${esc(name.slice(0, 1).toUpperCase())}</span>`);
}

const jiraStatus = (status, cat) => html`<span class="jst ${cat}">${status.toUpperCase()}</span>`;

function jiraCards(issues) {
  return html`<div class="jcards">${issues.map(
    (x) => html`<div class="jcard">
      ${jiraTypeIcon(x.type)}
      <div style="min-width:0">
        <div><span class="key">${x.key}</span><span class="sm">${x.summary}</span></div>
        <div class="meta">${priorityIcon(x.priority)} ${x.priority} · ${avatar(x.assignee, 16)} ${x.assignee || "담당자 없음"}${x.updated ? ` · 업데이트 ${relTime(atOffset(x.updated))}` : ""}</div>
      </div>
      ${jiraStatus(x.status, x.cat)}
    </div>`,
  )}</div>`;
}

function jiraIssue(x) {
  const pct = Math.round((x.children.done / x.children.total) * 100);
  return html`<div class="jira-issue">
    <div class="ji-h">
      <div class="ji-crumbs">${jiraTypeIcon(x.type, 14)} <span class="mono">${x.key}</span> · ${x.type}</div>
      <h3>${x.summary}</h3>
    </div>
    <div class="ji-grid">
      <div class="ji-main">
        <div class="lbl" style="margin-bottom:6px">설명</div>
        ${md(x.description)}
        <div class="lbl" style="margin:16px 0 6px">하위 이슈 ${x.children.done}/${x.children.total} 완료</div>
        <div class="meter"><i style="width:${pct}%;background:#63ba3c"></i></div>
      </div>
      <div class="ji-side">
        <span class="k">상태</span><span>${jiraStatus(x.status, x.cat)}</span>
        <span class="k">우선순위</span><span class="row" style="gap:5px">${priorityIcon(x.priority)} ${x.priority}</span>
        <span class="k">담당</span><span class="row" style="gap:6px">${avatar(x.assignee)} ${x.assignee}</span>
        <span class="k">보고</span><span class="row" style="gap:6px">${avatar(x.reporter)} ${x.reporter}</span>
        <span class="k">스프린트</span><span>${x.sprint}</span>
        <span class="k">기한</span><span class="num">${x.due}</span>
        <span class="k">레이블</span><span class="chips">${x.labels.map((l) => html`<span class="chip">${l}</span>`)}</span>
      </div>
    </div>
  </div>`;
}

function linkCards(results) {
  return html`<div class="jcards">${results.map(
    (x) => html`<div class="jcard" style="grid-template-columns:24px minmax(0,1fr) auto">
      ${fav(x.url, 22)}
      <div style="min-width:0"><a class="sm" href="${x.url}" target="_blank" rel="noopener noreferrer" style="color:var(--foreground)">${x.title}</a><div class="meta"><span class="truncate">${hostOf(x.url)}</span>${x.edited ? html` · 수정 ${relTime(atOffset(x.edited))}` : ""}</div></div>
      <span class="chip">${x.type || "page"}</span>
    </div>`,
  )}</div>`;
}

// Collapsible JSON tree; first level open.
function jsonTree(value, key, path, depth) {
  const isObj = value && typeof value === "object";
  const k = key != null ? `<span class="jt-k">${esc(JSON.stringify(key))}</span><span class="jt-meta">: </span>` : "";
  if (!isObj) {
    const cls = typeof value === "string" ? "tk-str" : typeof value === "number" ? "tk-num" : "tk-kw";
    return `<div class="jt-row"><span style="width:14px"></span>${k}<span class="${cls}">${esc(JSON.stringify(value))}</span></div>`;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const foldKey = `j:${path}`;
  const open = depth < 1 ? !STATE.openFolds.has(foldKey) : STATE.openFolds.has(foldKey);
  const meta = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return `<div class="jt-row"><button data-action="unfold" data-fold="${esc(foldKey)}" aria-expanded="${open}">${icon(open ? "chevron-down" : "chevron-right", 12).s}</button>${k}<span class="jt-meta">${meta}</span></div>${open ? `<div class="jt-kids">${entries.map(([ck, cv]) => jsonTree(cv, Array.isArray(value) ? null : ck, `${path}.${ck}`, depth + 1)).join("")}</div>` : ""}`;
}

function mcpSummary(r) {
  if (r.issues) return html`<div class="row" style="padding:10px 12px 0;gap:6px"><span class="tag"><i>isLast</i>${String(r.isLast)}</span><span class="tag"><i>total</i>${r.total}</span></div>${jiraCards(r.issues)}`;
  if (r.issue) return html`<div style="padding:10px">${jiraIssue(r.issue)}</div>`;
  if (r.results) return linkCards(r.results);
  if (r.markdown) return html`<div style="padding:14px 18px">${md(r.markdown)}</div>`;
  return null;
}

const MCP_MEMO = new WeakMap();

// Jira issue JSON (REST or Rovo) -> the card shapes above.
function jiraFlat(n) {
  const f = n.fields ?? {};
  return {
    key: n.key,
    summary: f.summary ?? "",
    type: f.issuetype?.name ?? "Task",
    priority: f.priority?.name ?? "",
    assignee: f.assignee?.displayName ?? "",
    reporter: f.reporter?.displayName ?? "",
    status: f.status?.name ?? "",
    cat: f.status?.statusCategory?.key ?? "",
    updated: f.updated ? (Date.parse(f.updated) - T0) / 1000 : 0,
  };
}

// Atlassian document format -> plain text paragraphs.
function adfText(node) {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(adfText).join(node.type === "doc" ? "\n\n" : "");
  return node.type === "paragraph" || node.type === "heading" ? inner : inner;
}

function jiraFull(n) {
  const f = n.fields ?? {};
  const subs = f.subtasks ?? [];
  return {
    ...jiraFlat(n),
    description: typeof f.description === "string" ? f.description : adfText(f.description),
    children: { done: subs.filter((x) => x.fields?.status?.statusCategory?.key === "done").length, total: subs.length || 1 },
    sprint: (f.sprint?.name ?? (Array.isArray(f.customfield_10020) ? f.customfield_10020.at(-1)?.name : "")) || "—",
    due: f.duedate ?? "—",
    labels: f.labels ?? [],
  };
}

// A real MCP result: JSON (with Jira as cards), or text shown as Markdown.
function mcpResult(call) {
  if (MCP_MEMO.has(call)) return MCP_MEMO.get(call);
  const text = call.result?.text ?? "";
  let data;
  try {
    data = /^\s*[[{]/.test(text) ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  let value;
  if (data === undefined) value = { payload: { text: maskedText(text) }, summary: text ? { markdown: maskedText(text) } : {} };
  else {
    const issues = Array.isArray(data?.issues) ? data.issues : Array.isArray(data?.issues?.nodes) ? data.issues.nodes : null;
    const summary = issues
      ? { issues: issues.map(jiraFlat), total: data.total ?? data.issues?.totalCount ?? issues.length, isLast: data.isLast ?? !data.issues?.pageInfo?.hasNextPage }
      : data?.key && data?.fields ? { issue: jiraFull(data) } : {};
    value = { payload: data, summary };
  }
  MCP_MEMO.set(call, value);
  return value;
}

function renderMcpGeneric(call) {
  const p = mcpParts(call.name);
  const i = call.input || {};
  const view = uiGet(`${call.id}:mcpview`, "summary");
  // Jira, Notion and Slack calls are drawn the way those sites look.
  const site = view === "raw" || call.result?.err ? null : siteView(call);
  if (site) {
    return html`<div class="mcp-h">
        <div class="kind-tile" style="--kc:var(--k-mcp)">${icon("plug", 17)}</div>
        <div style="min-width:0"><div class="mono" style="font-weight:600;font-size:var(--fs-md)">${p.tool}</div><div class="dim" style="font-size:var(--fs-xs)">${p.server} · MCP</div></div>
        ${stageMeta(call)}
      </div>
      <div class="res-bar"><span class="lbl">사이트에서 보이는 모양</span><span class="grow"></span>
        <div class="seg" role="group" aria-label="결과 보기">
          <button data-action="ui-set" data-key="${call.id}:mcpview" data-value="summary" aria-pressed="true">사이트 모양</button>
          <button data-action="ui-set" data-key="${call.id}:mcpview" data-value="raw" aria-pressed="false">원본</button>
        </div>
      </div>
      ${site}`;
  }
  const known = LJ.jiraTool(call.name) || LN.notionTool(call.name) || LSK.slackTool(call.name);
  const res = mcpResult(call);
  const payload = res.payload;
  const bytes = (call.result?.text ?? "").length;
  const summary = mcpSummary(res.summary);
  const showSummary = summary && view === "summary";
  const inputRows = Object.entries(i).map(([k, v]) => {
    const value = typeof v === "string" ? maskedText(v) : maskedText(JSON.stringify(v));
    return html`<div class="k">${k}</div><div class="v">${value}</div>`;
  });
  return html`<div class="mcp-h">
      <div class="kind-tile" style="--kc:var(--k-mcp)">${icon("plug", 17)}</div>
      <div style="min-width:0"><div class="mono" style="font-weight:600;font-size:var(--fs-md)">${p.tool}</div><div class="dim" style="font-size:var(--fs-xs)">${p.server} · MCP</div></div>
      ${stageMeta(call)}
    </div>
    <div class="lbl" style="margin-bottom:6px">입력</div>
    ${inputRows.length ? html`<div class="kvt">${inputRows}</div>` : html`<div class="dim">(입력 없음)</div>`}
    <div class="res-bar"><span class="lbl">결과</span><span class="meta">JSON · ${fmtBytes(bytes || JSON.stringify(payload).length)}</span>
      ${summary || known
        ? html`<div class="seg" role="group" aria-label="결과 보기">
            <button data-action="ui-set" data-key="${call.id}:mcpview" data-value="summary" aria-pressed="${view === "summary"}">${known ? "사이트 모양" : "요약"}</button>
            <button data-action="ui-set" data-key="${call.id}:mcpview" data-value="raw" aria-pressed="${view === "raw"}">원본</button>
          </div>`
        : ""}
    </div>
    ${call.result?.err ? html`<div class="err-card">${icon("circle-x", 15)}<div><b>도구가 오류를 돌려줬어요</b></div></div>` : ""}
    ${!call.result ? html`<div class="dim">${call.status === "pending" ? "실행 승인을 기다리고 있어요" : "결과가 아직 없어요"}</div>` : html`<div class="box">${showSummary ? summary : raw(`<div class="jt">${jsonTree(payload, null, call.id, 0)}</div>`)}</div>`}`;
}
