// Jira, Notion and Slack calls drawn the way those sites look (their light themes, with the
// colors and sizes read from the live pages). Parsing is the mod's lib/ (jira, notion, slack,
// sx_rich); this file turns the parsed views into HTML. css/sites.css holds the looks.

const SITE_MEMO = new WeakMap();

function sitePrepared(call) {
  const key = Boolean(call.result);
  const hit = SITE_MEMO.get(call);
  if (hit && hit.key === key) return hit.value;
  let value = null;
  try {
    const jira = LJ.parseJira(call);
    const notion = jira ? null : LN.parseNotion(call);
    const slack = jira || notion ? null : LSK.parseSlack(call);
    value = jira ? { site: "jira", view: jira } : notion ? { site: "notion", view: notion } : slack ? { site: "slack", view: slack } : null;
  } catch {
    value = null;
  }
  SITE_MEMO.set(call, { key, value });
  return value;
}

// ---------- sx_rich text ----------

const sx_safeUrl = (url) => (/^https?:\/\//i.test(url ?? "") ? url : "");

function sx_runsHTML(runs) {
  return runs.map((r) => {
    let out = esc(r.text).replace(/\n/g, "<br>");
    if (r.code) out = `<code>${out}</code>`;
    if (r.b) out = `<b>${out}</b>`;
    if (r.i) out = `<i>${out}</i>`;
    if (r.s) out = `<s>${out}</s>`;
    if (r.u) out = `<u>${out}</u>`;
    if (r.mention) out = `<span class="mention ${esc(r.mention)}">${out}</span>`;
    const href = sx_safeUrl(r.href);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${out}</a>` : out;
  }).join("");
}

function sx_blocksHTML(list) {
  const out = [];
  for (const b of list) {
    switch (b.t) {
      case "h": out.push(`<h${b.level + 1} class="bh${b.level}">${sx_runsHTML(b.runs)}</h${b.level + 1}>`); break;
      case "li": {
        const mark = b.todo ? `<span class="todo ${b.checked ? "on" : ""}">${b.checked ? "✓" : ""}</span>` : `<span class="mk">${b.ordered ? `${b.n ?? 1}.` : b.depth % 2 ? "◦" : "•"}</span>`;
        out.push(`<div class="bli ${b.checked ? "done" : ""}" style="padding-left:${4 + b.depth * 22}px">${mark}<div>${sx_runsHTML(b.runs)}</div></div>`);
        break;
      }
      case "code": out.push(`<pre class="bcode">${esc(b.text)}</pre>`); break;
      case "quote": out.push(`<blockquote>${sx_runsHTML(b.runs)}</blockquote>`); break;
      case "hr": out.push("<hr>"); break;
      case "table":
        out.push(`<div class="btable-wrap"><table class="btable ${b.header ? "head" : ""}">${b.rows.map((row) => `<tr>${row.map((c) => `<td>${sx_runsHTML(c)}</td>`).join("")}</tr>`).join("")}</table></div>`);
        break;
      case "callout": out.push(`<div class="bcallout ${esc(b.color || "default")}">${b.icon ? `<span class="ci">${esc(b.icon)}</span>` : ""}<div class="rich">${sx_blocksHTML(b.blocks)}</div></div>`); break;
      case "toggle": out.push(`<div class="btoggle"><span>▶</span><div>${sx_runsHTML(b.runs)}</div></div>`); break;
      case "embed": {
        const href = sx_safeUrl(b.href);
        out.push(href ? `<a class="bembed" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(b.label)}</a>` : `<div class="bembed">${esc(b.label)}</div>`);
        break;
      }
      case "more": out.push('<p class="bmore">이어지는 내용은 원본에서 볼 수 있어요</p>'); break;
      default: out.push(`<p style="${b.depth ? `padding-left:${b.depth * 22}px` : ""}">${sx_runsHTML(b.runs ?? [])}</p>`);
    }
  }
  return out.join("");
}

const sx_rich = (text, limit) => raw(`<div class="rich">${sx_blocksHTML(LR.blocks(text, limit))}</div>`);
const sx_richBlocks = (list) => raw(`<div class="rich">${sx_blocksHTML(list)}</div>`);
const sx_AVATAR_COLORS = ["#1868DB", "#22A06B", "#8F7EE7", "#E56910", "#C9372C", "#2898BD", "#B38600", "#DA62AC"];
const sx_avatarEl = (person, cls = "") => raw(`<span class="av ${cls}" style="background:${person?.unknown || !person ? "#8C8F97" : sx_AVATAR_COLORS[LR.hueOf(person.name)]}">${esc(person?.initials ?? "?")}</span>`);
const sx_outLink = (url, label) => (sx_safeUrl(url) ? html`<a class="open" href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : "");

// ---------- Jira ----------

const sx_JIRA_MARK = '<svg viewBox="0 0 24 24" width="22" height="22"><rect width="24" height="24" rx="6" fill="#1868DB"/><path d="M9.2 15.6H7.9c-1.9 0-3.2-1.2-3.2-2.9h6.7c.4 0 .6.2.6.6v6.7c-1.7 0-2.8-1.400-2.800-3.200zm3.300-3.400h-1.300c-1.900 0-3.200-1.200-3.200-2.900h6.700c.4 0 .6.2.6.6v6.700c-1.700 0-2.800-1.400-2.800-3.200zm3.300-3.300h-1.300c-1.900 0-3.200-1.200-3.200-2.900h6.700c.4 0 .6.2.6.6v6.700c-1.700 0-2.800-1.400-2.800-3.200z" fill="#fff"/></svg>';
const sx_JIRA_TYPES = {
  task: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="1.750" y="1.750" width="12.500" height="12.500" rx="2.500" fill="none" stroke="#1868DB" stroke-width="1.500"/><path d="M4.800 8.200l2.200 2.200 4.200-4.600" fill="none" stroke="#1868DB" stroke-width="1.500" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  story: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M4.250 2.250h7.500v11.500L8 10.900l-3.750 2.850z" fill="none" stroke="#4C9C2E" stroke-width="1.500" stroke-linejoin="round"/></svg>',
  epic: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="1.500" y="1.500" width="13" height="13" rx="3" fill="#964AC0"/><path d="M8.900 3.600L5.200 8.600h2.500l-.6 3.800 3.700-5H8.300z" fill="#fff"/></svg>',
  bug: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="1.500" y="1.500" width="13" height="13" rx="3" fill="#E2483D"/><circle cx="8" cy="8" r="2.600" fill="#fff"/></svg>',
  subtask: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="2" width="6.500" height="6.500" rx="1.500" fill="none" stroke="#1868DB" stroke-width="1.500"/><rect x="7.500" y="7.500" width="6.500" height="6.500" rx="1.500" fill="#fff" stroke="#1868DB" stroke-width="1.500"/></svg>',
};
const sx_jiraType = (type) => raw(`<span class="jt-ico" title="${esc(type?.name ?? "")}">${sx_JIRA_TYPES[type?.kind] ?? sx_JIRA_TYPES.task}</span>`);
const sx_lozenge = (status, button = false) => html`<span class="loz ${status.cat} ${button ? "btn" : ""}">${status.name}${button ? raw(' <i>▾</i>') : ""}</span>`;
const sx_jiraWho = (p) => html`<span class="who">${sx_avatarEl(p, "round")}<span class="truncate">${p.name}</span></span>`;
const sx_jiraSite = (issue) => (issue.url ? /^(https?:\/\/[^/]+)/.exec(issue.url)?.[1] ?? null : null);
const sx_JIRA_NOTICE = { create: "새 업무 항목을 만들었어요", edit: "업무 항목을 고쳤어요", transition: "상태를 바꿨어요" };

function sx_jiraComment(c) {
  return html`<div class="jcomment">${sx_avatarEl(c.author, "round lg")}<div class="grow" style="min-width:0">
    <div class="jc-h"><b>${c.author?.name ?? "작성자 정보 없음"}</b>${c.created ? html`<span>${String(c.created).slice(0, 16).replace("T", " ")}</span>` : ""}</div>${sx_rich(c.body, 80)}</div></div>`;
}

function sx_jiraIssue(view) {
  const { issue } = view;
  const site = sx_jiraSite(issue);
  const browse = (key) => (site ? `${site}/browse/${key}` : "");
  const field = (label, value) => html`<div class="jf"><div class="k">${label}</div><div class="v">${value}</div></div>`;
  const fields = [
    issue.assignee ? field("담당자", sx_jiraWho(issue.assignee)) : "",
    issue.reporter ? field("보고자", sx_jiraWho(issue.reporter)) : "",
    issue.parent ? field("상위 항목", html`${sx_jiraType(issue.parent.type ?? { kind: "story" })}<a class="jparent" href="${browse(issue.parent.key)}" target="_blank" rel="noopener noreferrer"><b>${issue.parent.key}</b> <span class="truncate">${issue.parent.summary}</span></a>`) : "",
    issue.due ? field("기한", html`<span class="jdate">${issue.due}</span>`) : "",
    issue.priority ? field("우선 순위", html`<span class="jprio ${issue.priority}">=</span> ${issue.priority}`) : "",
    issue.labels.length ? field("레이블", issue.labels.slice(0, 12).map((l) => html`<span class="jlabel">${l}</span>`)) : "",
    issue.updated ? field("업데이트", html`<span class="jdim">${String(issue.updated).slice(0, 16).replace("T", " ")}</span>`) : "",
  ].filter(Boolean);
  const notice = sx_JIRA_NOTICE[view.kind] ? `${sx_JIRA_NOTICE[view.kind]}${view.changed?.length ? ` · ${view.changed.join(", ")}` : ""}` : null;
  return html`<div class="site jira">
    <div class="site-top">${raw(sx_JIRA_MARK)}
      <nav class="jcrumbs"><span>스페이스</span>${issue.project ? html`<i>/</i><span>${issue.project.name}</span>` : ""}
        ${issue.parent ? html`<i>/</i>${sx_jiraType(issue.parent.type ?? { kind: "story" })}<a href="${browse(issue.parent.key)}" target="_blank" rel="noopener noreferrer">${issue.parent.key}</a>` : ""}
        <i>/</i>${sx_jiraType(issue.type)}<span>${issue.key}</span></nav>
      <span class="grow"></span>${sx_outLink(issue.url, "Jira에서 열기")}</div>
    <div class="jissue">
      <div class="jmain">
        ${notice ? html`<div class="jnotice ${view.pending ? "wait" : ""}">${view.pending ? "아직 결과가 오지 않았어요 · 보낸 내용이에요" : `✓ ${notice}`}</div>` : ""}
        <h1>${issue.summary || issue.key}</h1>
        ${issue.description != null ? html`<h3 class="jsec">설명</h3>${issue.description.trim() ? sx_rich(issue.description) : html`<p class="jdim">설명 없음</p>`}` : ""}
        ${issue.comments.length ? html`<h3 class="jsec">댓글 ${issue.comments.length}</h3>${issue.comments.map(sx_jiraComment)}` : ""}
      </div>
      <aside class="jside">
        ${issue.status ? html`<div>${sx_lozenge(issue.status, true)}</div>` : ""}
        ${fields.length ? html`<div class="jpanel"><h4>세부 사항</h4>${fields}</div>` : ""}
      </aside>
    </div>
  </div>`;
}

function sx_jiraList(view) {
  const any = (pick) => view.issues.some(pick);
  const cols = { assignee: any((i) => i.assignee), status: any((i) => i.status), priority: any((i) => i.priority), due: any((i) => i.due) };
  const rows = view.issues.slice(0, 100);
  return html`<div class="site jira">
    <div class="jlist">
      <div class="jl-h">${raw(sx_JIRA_MARK)}<h1>업무 항목 검색</h1></div>
      ${view.jql ? html`<div class="jql"><span>JQL</span><code>${maskedText(view.jql)}</code></div>` : ""}
      ${view.pending ? html`<p class="jdim">검색 결과를 기다리고 있어요</p>` : !rows.length ? html`<p class="jdim">조건에 맞는 업무 항목이 없어요</p>` : html`<div class="jtable-wrap"><table class="jtable">
        <thead><tr><th>업무</th>${cols.assignee ? html`<th>담당자</th>` : ""}${cols.status ? html`<th>상태</th>` : ""}${cols.priority ? html`<th>우선 순위</th>` : ""}${cols.due ? html`<th>기한</th>` : ""}</tr></thead>
        <tbody>${rows.map((i) => html`<tr>
          <td><span class="jwork">${sx_jiraType(i.type)}<a href="${sx_safeUrl(i.url)}" target="_blank" rel="noopener noreferrer">${i.key}</a><span class="truncate">${i.summary}</span></span></td>
          ${cols.assignee ? html`<td>${i.assignee ? sx_jiraWho(i.assignee) : html`<span class="jdim">없음</span>`}</td>` : ""}
          ${cols.status ? html`<td>${i.status ? sx_lozenge(i.status) : ""}</td>` : ""}
          ${cols.priority ? html`<td>${i.priority ?? ""}</td>` : ""}
          ${cols.due ? html`<td>${i.due ?? ""}</td>` : ""}
        </tr>`)}</tbody></table><div class="jfoot">${view.issues.length}개${view.issues.length > rows.length ? ` 중 ${rows.length}개` : ""}</div></div>`}
    </div>
  </div>`;
}

function sx_jiraView(view) {
  if (view.kind === "list") return sx_jiraList(view);
  if (view.kind === "comment") {
    return html`<div class="site jira"><div class="site-top">${raw(sx_JIRA_MARK)}<nav class="jcrumbs">${sx_jiraType({ kind: "task" })}<span>${view.key}</span></nav><b style="margin-left:8px">${view.pending ? "댓글을 보내는 중" : "댓글을 달았어요"}</b></div>
      <div class="jpad">${sx_jiraComment(view.comment)}</div></div>`;
  }
  if (view.kind === "transitions") {
    if (!view.transitions.length) return null;
    return html`<div class="site jira"><div class="site-top">${raw(sx_JIRA_MARK)}<nav class="jcrumbs"><span>${view.key}</span></nav><b style="margin-left:8px">바꿀 수 있는 상태</b></div>
      <div class="jpad">${view.transitions.map((x) => html`<div class="jtrans"><span class="grow">${x.name}</span><span class="jdim">→</span>${sx_lozenge(x.to)}</div>`)}</div></div>`;
  }
  return sx_jiraIssue(view);
}

// ---------- Notion ----------

const sx_NOTION_MARK = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2.500" y="2.500" width="19" height="19" rx="4" fill="#fff" stroke="#2C2C2B" stroke-width="1.600"/><path d="M8.300 17V7.200h1.500l4.400 6.700V7.200h1.500V17h-1.500l-4.400-6.700V17z" fill="#2C2C2B"/></svg>';
const sx_NOTION_TAGS = [["#E3E2E0", "#32302C"], ["#EEE0DA", "#442A1E"], ["#FADEC9", "#49290E"], ["#FDECC8", "#402C1B"], ["#DBEDDB", "#1C3829"], ["#D3E5EF", "#183347"], ["#E8DEEE", "#412454"], ["#F5E0E9", "#4C2337"], ["#FFE2DD", "#5D1715"]];

function sx_notionValue(v) {
  if (v.kind === "check") return raw(`<span class="ncheck ${v.on ? "on" : ""}">${v.on ? "✓" : ""}</span>`);
  if (v.kind === "tags") return v.tags.slice(0, 10).map((tag) => { const [bg, fg] = sx_NOTION_TAGS[LR.hueOf(tag, sx_NOTION_TAGS.length)]; return html`<span class="ntag" style="background:${bg};color:${fg}">${tag}</span>`; });
  if (v.kind === "empty") return html`<span class="nempty">비어 있음</span>`;
  if (v.kind === "url") return html`<a href="${sx_safeUrl(v.text)}" target="_blank" rel="noopener noreferrer">${v.text}</a>`;
  return raw(sx_runsHTML(LR.inline(v.text.slice(0, 1200))));
}

const sx_notionProps = (props) => (props.length ? html`<div class="nprops">${props.map((p) => html`<div class="k truncate">${p.name}</div><div class="v">${sx_notionValue(p.value)}</div>`)}</div>` : "");
const sx_notionTop = (crumbs, url) => html`<div class="site-top">${raw(sx_NOTION_MARK)}<span class="ncrumbs truncate">${crumbs.map((c, i) => html`${i ? raw("<i>/</i>") : ""}<span>${c}</span>`)}</span><span class="grow"></span>${sx_outLink(url, "Notion에서 열기")}</div>`;
const sx_notionTitle = (title, icon) => html`${icon ? html`<div class="nicon">${icon}</div>` : ""}<h1>${title || "제목 없음"}</h1>`;
const sx_NOTION_COMMAND = { replace_content: "페이지 내용을 새로 썼어요", update_content: "페이지 내용을 고쳤어요", update_properties: "속성을 바꿨어요", insert_content: "내용을 넣었어요", insert_content_after: "내용을 넣었어요" };

function sx_notionView(view) {
  if (view.pending && !["update", "create", "search"].includes(view.kind)) return null;
  if (view.kind === "page") {
    return html`<div class="site notion">${sx_notionTop([...view.crumbs, view.title], view.url)}
      <div class="npage">${sx_notionTitle(view.title, view.icon)}${sx_notionProps(view.props)}${view.props.length ? raw("<hr>") : ""}
        ${view.blank ? html`<p class="ndim">빈 페이지예요</p>` : sx_richBlocks(view.blocks)}
        ${view.cut ? html`<p class="ndim">결과가 길어서 뒷부분은 기록에 남지 않았어요</p>` : ""}</div></div>`;
  }
  if (view.kind === "database") {
    return html`<div class="site notion">${sx_notionTop([...view.crumbs, view.title], view.url)}
      <div class="npage">${sx_notionTitle(view.title, null)}
        ${view.views.length ? html`<div class="nviews">${view.views.map((v, i) => html`<span class="${i === 0 ? "on" : ""}">${v}</span>`)}</div>` : ""}
        <div class="ncols">${view.columns.map((c) => html`<div><span class="grow truncate">${c.name}</span><span class="ndim">${c.type.toLowerCase()}</span></div>`)}</div></div></div>`;
  }
  if (view.kind === "search") {
    return html`<div class="site notion"><div class="nsearch-h">${raw(sx_NOTION_MARK)}<span>🔍</span><b class="truncate">${view.query || "검색"}</b></div>
      ${view.pending ? html`<p class="ndim" style="padding:18px">검색 결과를 기다리고 있어요</p>` : html`<div class="nresults">${view.results.length ? view.results.map((r) => html`<a class="nres" href="${sx_safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">
        <span class="ri">${r.type === "database" ? "🗂" : "📄"}</span>
        <span class="grow" style="min-width:0"><span class="t truncate">${r.title || "제목 없음"}</span>${r.path ? html`<span class="p truncate">${r.path}</span>` : ""}${r.highlight ? html`<span class="h">${raw(sx_runsHTML(LR.inline(r.highlight.slice(0, 260))))}</span>` : ""}</span>
        ${r.time ? html`<span class="d">${String(r.time).slice(0, 10)}</span>` : ""}</a>`) : html`<p class="ndim" style="padding:12px">결과 없음</p>`}</div>`}</div>`;
  }
  if (view.kind === "rows") {
    const rows = view.rows.slice(0, 100);
    return html`<div class="site notion"><div class="site-top">${raw(sx_NOTION_MARK)}<b>표</b><span class="grow"></span><span class="ndim">${view.total}개 행${view.total > rows.length ? ` 중 ${rows.length}개` : ""}</span></div>
      <div class="ntable-wrap"><table class="ntable"><thead><tr>${view.columns.map((c) => html`<th>${c}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr>${r.cells.map((v) => html`<td>${v.kind === "empty" ? "" : sx_notionValue(v)}</td>`)}</tr>`)}</tbody></table></div></div>`;
  }
  const state = (done) => (view.failed ? "실패했어요" : view.pending ? "아직 결과가 오지 않았어요 · 보낸 내용이에요" : `✓ ${done}`);
  const tone = view.failed ? "bad" : view.pending ? "wait" : "";
  if (view.kind === "update") {
    return html`<div class="site notion">${sx_notionTop([view.title || `페이지 ${view.pageId.slice(0, 8)}`], null)}
      <div class="npage"><div class="nnotice ${tone}">${state(sx_NOTION_COMMAND[view.command] ?? "페이지를 고쳤어요")}</div>
        ${view.title || view.icon ? sx_notionTitle(view.title, view.icon) : ""}${sx_notionProps(view.props)}${view.blocks.length ? sx_richBlocks(view.blocks) : ""}
        ${view.edits.map((e, i) => html`<div class="nedit"><div class="ndim">바꾼 곳 ${i + 1}</div>${e.from.length ? html`<div class="was">${sx_richBlocks(e.from)}</div>` : ""}${e.to.length ? html`<div class="now">${sx_richBlocks(e.to)}</div>` : ""}</div>`)}</div></div>`;
  }
  if (view.kind === "create") {
    return html`<div class="site notion">${sx_notionTop(["새 페이지"], null)}
      <div class="npage"><div class="nnotice ${tone}">${state(`페이지 ${view.pages.length}개를 만들었어요`)}</div>
        ${view.pages.slice(0, 40).map((p) => html`<section class="nmade"><div class="nmade-h"><h2 class="${view.pages.length > 1 ? "" : "big"}">${p.icon ? `${p.icon} ` : ""}${p.title || "제목 없음"}</h2>${sx_outLink(p.url, "열기")}</div>${sx_notionProps(p.props)}${p.blocks.length ? sx_richBlocks(p.blocks) : ""}</section>`)}</div></div>`;
  }
  return null;
}

// ---------- Slack ----------

const sx_SLACK_MARK = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="13" width="7.500" height="3.400" rx="1.700" fill="#E01E5A"/><rect x="7.600" y="13" width="3.400" height="9" rx="1.700" fill="#E01E5A"/><rect x="7.600" y="2" width="3.400" height="7.500" rx="1.700" fill="#36C5F0"/><rect x="2" y="7.600" width="9" height="3.400" rx="1.700" fill="#36C5F0"/><rect x="14.500" y="7.600" width="7.500" height="3.400" rx="1.700" fill="#2EB67D"/><rect x="13" y="2" width="3.400" height="9" rx="1.700" fill="#2EB67D"/><rect x="13" y="14.500" width="3.400" height="7.500" rx="1.700" fill="#ECB22E"/><rect x="13" y="13" width="9" height="3.400" rx="1.700" fill="#ECB22E"/></svg>';

function sx_slackMessage(m, thread = false) {
  return html`<div class="smsg">${sx_avatarEl(m.author, "sq")}<div class="grow" style="min-width:0">
    <div class="sm-h"><b>${m.sent ? "보낸 메시지" : m.author.name}</b>${m.bot ? html`<span class="app">앱</span>` : ""}${m.time ? html`<span class="ts">${m.time}</span>` : ""}</div>
    ${sx_rich(m.text, 120)}
    ${!m.text && !m.files ? html`<div class="sdim">본문 글자가 없는 메시지예요 (버튼·카드만 있는 앱 메시지)</div>` : ""}
    ${m.around ? html`<div class="sdim">앞뒤 메시지 ${m.around}개는 '원본'에 있어요</div>` : ""}
    ${m.cut ? html`<div class="sdim">검색 결과라 여기까지만 왔어요</div>` : ""}
    ${m.files ? html`<div class="sdim">📎 ${m.files}</div>` : ""}
    ${m.reactions?.length ? html`<div class="sreact">${m.reactions.map((r) => html`<span>${r.name} ${r.count}</span>`)}</div>` : ""}
    ${m.replies && !thread ? html`<div class="sreplies">답글 ${m.replies}개</div>` : ""}
    ${m.link ? html`<div style="margin-top:6px">${sx_outLink(m.link, "Slack에서 열기")}</div>` : ""}
  </div></div>`;
}

function sx_slackView(view) {
  const head = (title, sub) => html`<div class="shead">${raw(sx_SLACK_MARK)}<b>${title}</b>${sub ? html`<span class="truncate">${sub}</span>` : ""}</div>`;
  const list = view.messages.slice(0, 100);
  if (view.kind === "search") {
    return html`<div class="site slack">${head("검색", null)}<div class="sbox"><span>🔍</span><span class="truncate">${view.query}</span></div>
      ${view.pending ? html`<p class="sdim" style="padding:14px 20px">검색 결과를 기다리고 있어요</p>` : html`<div class="scount">메시지 ${view.messages.length}개</div>
      <div class="scards">${list.map((m) => html`<div class="scard"><div class="sch">${m.channel ?? ""}</div>${sx_slackMessage(m)}</div>`)}</div>`}</div>`;
  }
  if (view.kind === "sent") {
    return html`<div class="site slack">${head(view.failed ? "보내지 못했어요" : view.pending ? "보내는 중" : "메시지를 보냈어요", view.threadTs ? `${view.channel} · 스레드에 답글` : view.channel)}<div class="slist">${list.map((m) => sx_slackMessage(m))}</div></div>`;
  }
  if (view.pending) return html`<div class="site slack">${head(view.kind === "thread" ? "스레드" : "채널", null)}<p class="sdim" style="padding:14px 20px">메시지를 기다리고 있어요</p></div>`;
  if (view.kind === "thread") {
    const [root, ...replies] = list;
    return html`<div class="site slack">${head("스레드", view.channel || view.channelId)}<div class="slist">${sx_slackMessage(root, true)}
      ${replies.length ? html`<div class="sdivider"><span>답글 ${view.messages.length - 1}개</span><i></i></div>` : ""}${replies.map((m) => sx_slackMessage(m, true))}</div></div>`;
  }
  return html`<div class="site slack">${head(view.channel || "채널", view.channelId && view.channel ? view.channelId : null)}<div class="slist">${list.map((m) => sx_slackMessage(m))}</div></div>`;
}

/** The site-looking view of a Jira / Notion / Slack call, or null (the generic view draws it). */
function siteView(call, strict = false) {
  const prepared = sitePrepared(call);
  if (!prepared) return null;
  if (strict) return prepared.site === "jira" ? sx_jiraView(prepared.view) : prepared.site === "notion" ? sx_notionView(prepared.view) : sx_slackView(prepared.view);
  try {
    return prepared.site === "jira" ? sx_jiraView(prepared.view) : prepared.site === "notion" ? sx_notionView(prepared.view) : sx_slackView(prepared.view);
  } catch {
    return null;
  }
}
