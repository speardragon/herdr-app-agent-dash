// Changes lens (diff-explorer): the files an agent changed, as a VS Code-like tree and a
// cumulative diff from before its first touch.

// Before/after texts load on demand from the server: the file as the agent first found it
// (Claude records it; else the last commit) and the file as it is now.
const FILE_TEXTS = new Map();

function fileTexts(f) {
  const key = `${f.key}@${f.last}`;
  const hit = FILE_TEXTS.get(key);
  if (hit) return hit;
  FILE_TEXTS.set(key, { state: "loading" });
  loadTexts(f)
    .then((value) => FILE_TEXTS.set(key, { state: "ready", ...value }))
    .catch((error) => FILE_TEXTS.set(key, { state: "error", error: String(error.message ?? error) }))
    .finally(renderAll);
  return FILE_TEXTS.get(key);
}

async function loadTexts(f) {
  const q = (path) => `agent=${encodeURIComponent(f.agent)}&path=${encodeURIComponent(path)}`;
  const now = await (await api(`/api/current?${q(f.abs)}`)).json();
  if (now.tooLarge) throw new Error("파일이 2MB가 넘어서 비교하지 않았어요");
  const after = now.missing ? "" : now.text;
  if (f.status === "A") return { before: "", after, source: "new" };
  const agent = agentById(f.agent);
  if (agent?.provider === "claude") {
    const original = await (await api(`/api/original?${q(f.abs)}`)).json();
    if (original.found) return { before: original.created ? "" : original.text, after, source: "original" };
  }
  const head = await (await api(`/api/head?${q(f.abs)}`)).json();
  if (!head.found) throw new Error("처음 내용을 찾지 못했어요 (기록에도, 마지막 커밋에도 없어요)");
  return { before: head.text, after, source: "head" };
}

function repoName(a) {
  return baseName(a.cwd);
}

function scopeFiles() {
  const list = STATE.scope === "all" ? DB.files : filesOf(STATE.scope);
  return list.map((f) => {
    const a = agentById(f.agent);
    const display = STATE.scope === "all" && !f.path.startsWith("~") ? `${repoName(a)}/${f.path}` : f.path;
    return { ...f, key: `${f.agent}:${f.path}`, display, touchedBy: f.calls };
  });
}

function selectedFile(list) {
  const key = STATE.sel.file[scopeKey()];
  return list.find((f) => f.key === key) || list[0] || null;
}

function gutterFor(f, t) {
  const rows = diffRows(t.before, t.after, "text");
  const marks = {};
  let pendingDel = false;
  for (const r of rows) {
    if (r.t === "del") pendingDel = true;
    else {
      if (r.t === "add") marks[r.b] = r.pair ? "g-mod" : "g-add";
      else if (pendingDel) marks[r.b] = "g-del";
      pendingDel = false;
    }
  }
  return (n) => marks[n] || "";
}

function treeView(list, sel) {
  const tree = buildTree(list, (f) => f.display);
  const rows = [];
  const walk = (node, depth) => {
    const dirs = [...node.dirs].sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      const closed = STATE.openFolds.has(`dx:${d.path}`);
      rows.push(
        html`<button class="tn dir" data-action="unfold" data-fold="dx:${d.path}" aria-expanded="${!closed}" style="padding-left:${6 + depth * 14}px">${guides(depth)}<span class="chev">${icon(closed ? "chevron-right" : "chevron-down", 12)}</span>${folderIcon(baseName(d.name))}<span class="nm">${d.name}</span></button>`,
      );
      if (!closed) walk(d, depth + 1);
    }
    for (const fnode of node.files) {
      const f = fnode.item;
      const s = fileStats(f);
      const t = FILE_TEXTS.get(`${f.key}@${f.last}`);
      const reverted = t?.state === "ready" && t.before === t.after;
      rows.push(
        html`<button class="tn st-${f.status} ${reverted ? "reverted" : ""}" role="option" aria-selected="${sel && f.key === sel.key}" data-action="select-file" data-key="${f.key}" style="padding-left:${6 + depth * 14 + 14}px" title="${f.display} · +${s.add} −${s.del}">${guides(depth)}${fileIcon(f.path)}<span class="nm">${fnode.name}</span><span class="gs ${reverted ? "R" : f.status}">${reverted ? "↺" : f.status}</span></button>`,
      );
    }
  };
  const guides = (depth) => raw(Array.from({ length: depth }, (_, k) => `<span class="guide" style="left:${13 + k * 14}px"></span>`).join(""));
  walk(tree, 0);
  return rows;
}

function diffBody(f) {
  const t = fileTexts(f);
  if (t.state === "loading") return html`<div class="empty"><div class="e-ico">${spinner(18)}</div><p>처음 내용과 지금 파일을 읽는 중…</p></div>`;
  if (t.state === "error") return html`<div class="empty"><div class="e-ico">${icon("info", 20)}</div><h3>비교할 수 없어요</h3><p>${t.error}. 위의 호출을 누르면 편집마다 바뀐 부분을 볼 수 있어요.</p></div>`;
  const view = STATE.diff.view;
  const lang = langOf(f.path);
  if (view === "file") {
    const text = f.status === "D" ? t.before : t.after;
    return codeView(text, { lang, wrap: STATE.diff.wrap, gutter: f.status === "D" ? () => "" : gutterFor(f, t), scrollKey: `dx-file-${f.key}` });
  }
  if (t.before === t.after) return html`<div class="empty"><h3>원래대로 돌아왔어요</h3><p>이 파일은 수정됐다가 처음 내용으로 되돌아갔어요.</p></div>`;
  return html`<div class="dim" style="padding:8px 14px;font-size:var(--fs-xs)">${icon("info", 12)} ${t.source === "head" ? "기준: 마지막 커밋(HEAD) → 지금 파일" : t.source === "new" ? "새로 만든 파일" : "기준: 에이전트가 처음 고치기 직전 → 지금 파일"}</div>
    ${renderDiff(t.before, t.after, { lang, mode: STATE.diff.mode, wrap: STATE.diff.wrap, foldKey: `f:${f.key}`, openFolds: STATE.openFolds })}`;
}

function fileHeader(f, idx, total) {
  const s = fileStats(f);
  const parts = f.display.split("/");
  const name = parts.pop();
  const totalLines = s.add + s.del || 1;
  const nA = Math.round((s.add / totalLines) * 5);
  const nD = Math.min(5 - nA, Math.round((s.del / totalLines) * 5));
  const blocks = raw(`<span class="blocks" aria-hidden="true">${Array.from({ length: 5 }, (_, k) => `<i class="${k < nA ? "a" : k < nA + nD ? "d" : ""}"></i>`).join("")}</span>`);
  return html`<div class="dv-head">
    <div class="crumbs truncate">${parts.map((p) => html`<span>${p}</span><span class="sep">›</span>`)}${fileIcon(f.path)} <b>${name}</b></div>
    ${f.status === "A" ? html`<span class="patch-op add">NEW</span>` : f.status === "D" ? html`<span class="patch-op del">DELETED</span>` : ""}
    <span class="grow"></span>
    ${s.lock ? html`<span class="chip">lockfile</span>` : html`${plusMinusHTML(s.add, s.del)}${blocks}`}
    <div class="row" style="gap:2px">
      <button class="btn ghost sm icon" data-action="file-step" data-step="-1" title="이전 파일 (p)" aria-label="이전 파일">${icon("chevron-left", 14)}</button>
      <span class="num dim" style="font-size:var(--fs-xs);min-width:30px;text-align:center">${idx + 1}/${total}</span>
      <button class="btn ghost sm icon" data-action="file-step" data-step="1" title="다음 파일 (n)" aria-label="다음 파일">${icon("chevron-right", 14)}</button>
    </div>
  </div>`;
}

function diffsLens() {
  const list = scopeFiles();
  const sel = selectedFile(list);
  if (!list.length) {
    const a = STATE.scope !== "all" ? agentById(STATE.scope) : null;
    return html`<div class="empty" style="flex:1"><div class="e-ico">${icon("diff", 20)}</div><h3>바뀐 파일이 없어요</h3><p>${a ? `${a.title}은(는) 이 세션에서 파일을 고치지 않았어요. 읽기와 조사만 했어요.` : "에이전트가 파일을 고치면 여기에 모여요."}</p></div>`;
  }
  const all = list.map(fileStats);
  const idx = list.findIndex((f) => f.key === sel.key);
  const touched = (sel.touchedBy || []).map(callById).filter(Boolean).slice(-12);
  const d = STATE.diff;
  return html`<div class="dx ${d.tree ? "" : "no-tree"}">
    <div class="tree-pane">
      <div class="tree-head"><span class="grow">EXPLORER · 바뀐 파일만</span><button class="btn ghost sm icon" data-action="collapse-tree" title="모두 접기" aria-label="폴더 모두 접기">${icon("fold", 13)}</button></div>
      <div class="tree" role="listbox" aria-label="바뀐 파일" data-keep-scroll="tree-${esc(scopeKey())}">${treeView(list, sel)}</div>
    </div>
    <div class="dv">
      <div class="dv-tools">
        <button class="btn ghost sm" data-action="diff-tree" aria-pressed="${d.tree}" title="탐색기 (t)">${icon("panel-left", 13)} 탐색기</button>
        <span style="font-size:var(--fs-sm)">파일 <b>${list.length}</b>개 ${plusMinusHTML(sum(all, (s) => s.add), sum(all, (s) => s.del))}</span>
        <span class="grow"></span>
        <div class="seg" role="group" aria-label="보기">
          <button data-action="diff-set" data-key="view" data-value="diff" aria-pressed="${d.view === "diff"}">${icon("diff", 12)} Diff</button>
          <button data-action="diff-set" data-key="view" data-value="file" aria-pressed="${d.view === "file"}">${icon("file", 12)} 파일</button>
        </div>
        <div class="seg" role="group" aria-label="diff 배치" ${d.view === "file" ? raw('style="opacity:.4;pointer-events:none"') : ""}>
          <button data-action="diff-set" data-key="mode" data-value="unified" aria-pressed="${d.mode === "unified"}">${icon("rows", 12)} 한 줄</button>
          <button data-action="diff-set" data-key="mode" data-value="split" aria-pressed="${d.mode === "split"}">${icon("columns", 12)} 나란히</button>
        </div>
        <button class="btn ghost sm" data-action="diff-set" data-key="wrap" data-value="${!d.wrap}" aria-pressed="${d.wrap}" title="줄바꿈 (w)">${icon("wrap", 13)} 줄바꿈</button>
      </div>
      ${fileHeader(sel, idx, list.length)}
      ${touched.length ? html`<div class="dv-tools touched">이 파일을 바꾼 호출 ${touched.map((c) => html`<button class="chip" data-action="open-call" data-agent="${c.agent}" data-call="${c.id}"><span style="color:${kindColor(c)};display:inline-flex">${toolIcon(c, 12)}</span>${toolTitle(c)} · ${hhmm(c.ts)}</button>`)}<span class="dim">· 기준점은 처음 건드리기 직전 내용</span></div>` : ""}
      <div class="dv-body" data-keep-scroll="dv-${esc(sel.key)}">${diffBody(sel)}</div>
    </div>
  </div>`;
}
