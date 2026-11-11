// Read / Edit / MultiEdit / Write / apply_patch, drawn as an editor.

function rangeMinimap(call, range, total) {
  const prev = callsOf(call.agent)
    .filter((c) => c.name === "Read" && c.input.file_path === call.input.file_path && c.ts < call.ts)
    .map(readResult)
    .filter((r) => r?.kind === "text")
    .map((r) => r.range);
  const seg = ([a, b], cls) => `<i class="${cls}" style="left:${((a - 1) / total) * 100}%;width:max(3px, ${((b - a + 1) / total) * 100}%)"></i>`;
  return html`<div class="minimap" role="img" aria-label="전체 ${total}줄 중 ${range[0]}–${range[1]}번째 줄">${raw(prev.map((p) => seg(p, "prev")).join("") + seg(range, ""))}</div>
    <div class="minimap-lbl"><span>1</span><span>${prev.length ? `이 파일을 ${prev.length + 1}번째 읽음 · 흐린 칸은 이전에 읽은 곳` : `${range[0]}–${range[1]}번째 줄`}</span><span>${fmtInt(total)}</span></div>`;
}

// A Read result in the shape this view draws: the window of lines it returned, or an image.
function readResult(call) {
  const x = call.result?.extra ?? {};
  if (x.type === "image") {
    return { kind: "image", format: x.media ?? "image", width: x.dims?.originalWidth ?? x.dims?.width ?? "?", height: x.dims?.originalHeight ?? x.dims?.height ?? "?", bytes: x.size ?? 0 };
  }
  const f = x.file;
  if (!f) return null;
  const from = f.startLine ?? 1;
  const n = f.numLines ?? (f.content ?? "").split("\n").length;
  return { kind: "text", startLine: from, numLines: n, totalLines: f.totalLines ?? n, window: { text: f.content ?? "", from }, range: [from, from + Math.max(0, n - 1)] };
}

function mdWithRange(text, from, range) {
  const blocks = mdBlocks(text);
  const out = [];
  let inRun = [];
  const flush = () => {
    if (inRun.length) out.push(`<div class="md-range">${inRun.join("")}</div>`);
    inRun = [];
  };
  for (const b of blocks) {
    const a = from + b.from - 1;
    const z = from + b.to - 1;
    if (z >= range[0] && a <= range[1]) inRun.push(b.html);
    else {
      flush();
      out.push(`<div class="md-out">${b.html}</div>`);
    }
  }
  flush();
  return raw(`<div class="md" style="padding:14px 18px 18px">${out.join("")}</div>`);
}

function codeView(text, { from = 1, range = null, lang = "text", gutter = null, wrap = false, scrollKey = "" } = {}) {
  const lines = hl(text, lang);
  const rows = lines.map((l, idx) => {
    const n = from + idx;
    const inR = !range || (n >= range[0] && n <= range[1]);
    const g = gutter ? gutter(n) : "";
    return `<div class="cl ${range ? (inR ? "in-range" : "out-range") : ""} ${g}"><span class="ln">${n}</span><span class="gm"></span><span class="tx">${l || " "}</span></div>`;
  });
  return raw(`<div class="code ${wrap ? "wrap" : ""}" ${scrollKey ? `data-keep-scroll="${scrollKey}"` : ""}><div class="code-in">${rows.join("")}</div></div>`);
}

function renderImageRead(call) {
  const r = readResult(call);
  const path = relPath(call.input.file_path, call.agent);
  const actual = uiGet(`${call.id}:zoom`, "fit") === "actual";
  return html`<div class="editor">
    <div class="ed-tabs"><div class="ed-tab on">${fileIcon(path)} ${baseName(path)}</div><div class="ed-right">${r.format} · ${r.width}×${r.height} · ${fmtBytes(r.bytes)}</div></div>
    <div class="ed-sub"><span class="path truncate">${path}</span><span class="grow"></span>
      <div class="seg" role="group" aria-label="이미지 크기">
        <button data-action="ui-set" data-key="${call.id}:zoom" data-value="fit" aria-pressed="${!actual}">창에 맞춤</button>
        <button data-action="ui-set" data-key="${call.id}:zoom" data-value="actual" aria-pressed="${actual}">원본 비율</button>
      </div>
    </div>
    <div class="img-view ${actual ? "actual" : ""}" style="${actual ? "overflow:auto;place-items:start" : ""}">${apiImage(call.agent, call.input.file_path)}</div>
    <div class="ed-sub" style="border-top:1px solid var(--border);border-bottom:0">${icon("info", 12)} 기록에는 형식·크기만 남아서, 지금 디스크에 있는 파일을 보여줘요.</div>
  </div>`;
}

function renderRead(call) {
  const i = call.input;
  const r = readResult(call);
  if (!r) return resultNote(call);
  if (r.kind === "image") return renderImageRead(call);
  const path = relPath(i.file_path, call.agent);
  const range = r.range || [r.startLine, r.startLine + r.numLines - 1];
  const lang = r.lang || langOf(i.file_path);
  const isMd = lang === "md";
  const view = uiGet(`${call.id}:view`, isMd ? "rendered" : "code");
  const wrap = uiGet(`${call.id}:wrap`, false);
  return html`<div class="editor">
    <div class="ed-tabs">
      <div class="ed-tab on">${fileIcon(path)} ${baseName(path)}</div>
      <div class="ed-right">읽음 · <b style="color:var(--foreground)">${range[0]}–${range[1]}</b>번째 줄 / 전체 ${fmtInt(r.totalLines)}줄</div>
    </div>
    ${rangeMinimap(call, range, r.totalLines)}
    <div class="ed-sub"><span class="path truncate">${path}</span><span class="grow"></span>
      ${isMd
        ? html`<div class="seg" role="group" aria-label="보기">
            <button data-action="ui-set" data-key="${call.id}:view" data-value="rendered" aria-pressed="${view === "rendered"}">문서</button>
            <button data-action="ui-set" data-key="${call.id}:view" data-value="code" aria-pressed="${view === "code"}">원문</button>
          </div>`
        : ""}
      <button class="btn ghost sm" data-action="ui-toggle" data-key="${call.id}:wrap" aria-pressed="${wrap}">${icon("wrap", 13)} 줄바꿈</button>
    </div>
    <div class="ed-body">${isMd && view === "rendered"
      ? mdWithRange(r.window.text, r.window.from, range)
      : codeView(r.window.text, { from: r.window.from, range, lang, wrap, scrollKey: `read-${call.id}` })}</div>
  </div>`;
}

function editToolbar(call, path, plusMinus) {
  const mode = uiGet(`${call.id}:mode`, "unified");
  const wrap = uiGet(`${call.id}:wrap`, false);
  const file = DB.files.find((f) => f.agent === call.agent && f.abs === call.input.file_path);
  return html`<div class="ed-sub">
    <span class="path truncate">${path}</span>
    ${call.input.replace_all ? html`<span class="chip">모두 바꾸기</span>` : ""}
    ${call.result?.extra?.userModified ? html`<span class="chip warn">사용자가 고쳐서 승인</span>` : ""}
    <span class="grow"></span>
    ${plusMinus}
    <div class="seg" role="group" aria-label="diff 보기">
      <button data-action="ui-set" data-key="${call.id}:mode" data-value="unified" aria-pressed="${mode === "unified"}">${icon("rows", 12)} 한 줄</button>
      <button data-action="ui-set" data-key="${call.id}:mode" data-value="split" aria-pressed="${mode === "split"}">${icon("columns", 12)} 나란히</button>
    </div>
    <button class="btn ghost sm" data-action="ui-toggle" data-key="${call.id}:wrap" aria-pressed="${wrap}">${icon("wrap", 13)} 줄바꿈</button>
    ${file ? html`<button class="btn sm" data-action="open-file" data-agent="${call.agent}" data-path="${file.path}">누적 변경 ${icon("arrow-right", 12)}</button>` : ""}
  </div>`;
}

const plusMinusHTML = (add, del) => html`<span class="plus-minus"><span class="a">+${add}</span> <span class="d">−${del}</span></span>`;

function renderEdit(call) {
  const i = call.input;
  const r = call.result || {};
  const path = relPath(i.file_path, call.agent);
  const lang = langOf(i.file_path);
  const edits = editHunks(call);
  const ats = edits.map((e) => e.at);
  const stats = edits.map((e) => diffStats(e.old_string, e.new_string));
  const { add, del } = LT.editStats(call);
  const mode = uiGet(`${call.id}:mode`, "unified");
  const wrap = uiGet(`${call.id}:wrap`, false);
  const bodies = edits.map((e, k) => {
    const at = ats[k] || 1;
    const label = edits.length > 1 ? html`<div class="ed-sub" style="background:#ffffff04">편집 ${k + 1}/${edits.length} · ${at}번째 줄 ${plusMinusHTML(stats[k].add, stats[k].del)}</div>` : "";
    return html`${label}${renderDiff(e.old_string, e.new_string, { lang, mode, wrap, startA: at, startB: e.bt ?? at, foldKey: `${call.id}:${k}`, openFolds: STATE.openFolds })}`;
  });
  return html`<div class="editor">
    <div class="ed-tabs">
      <div class="ed-tab on">${fileIcon(path)} ${baseName(path)} <span class="dirty" title="수정됨"></span></div>
      <div class="ed-right"><span class="chip mono">${lang}</span>${edits.length > 1 ? html`<span class="chip">편집 ${edits.length}건</span>` : html`<span>${ats[0]}번째 줄에서 수정</span>`}</div>
    </div>
    ${editToolbar(call, path, plusMinusHTML(add, del))}
    ${call.result?.err ? resultNote(call) : ""}
    <div class="ed-body">${bodies}</div>
  </div>`;
}

function renderWrite(call) {
  const i = call.input;
  const path = relPath(i.file_path, call.agent);
  const lang = langOf(i.file_path);
  const lines = i.content.split("\n");
  const wrap = uiGet(`${call.id}:wrap`, false);
  const file = DB.files.find((f) => f.agent === call.agent && f.abs === i.file_path);
  if (call.result?.extra?.type === "update" && call.result.extra.patch?.length) return renderEdit(call);
  return html`<div class="editor">
    <div class="ed-tabs">
      <div class="ed-tab on">${fileIcon(path)} ${baseName(path)}</div>
      <div class="ed-right"><span class="patch-op add">NEW</span><span class="chip mono">${lang}</span><span>${lines.length}줄 · ${fmtBytes(new Blob([i.content]).size)}</span></div>
    </div>
    <div class="ed-sub"><span class="path truncate">${path}</span><span class="grow"></span>${plusMinusHTML(lines.length, 0)}
      <button class="btn ghost sm" data-action="ui-toggle" data-key="${call.id}:wrap" aria-pressed="${wrap}">${icon("wrap", 13)} 줄바꿈</button>
      ${file ? html`<button class="btn sm" data-action="open-file" data-agent="${call.agent}" data-path="${file.path}">누적 변경 ${icon("arrow-right", 12)}</button>` : ""}
    </div>
    <div class="ed-body">${codeView(i.content, { lang, wrap, gutter: () => "g-add", scrollKey: `write-${call.id}` })}</div>
  </div>`;
}

// Codex patch: one editor block per file, hunks without line numbers (the patch has none).
function renderPatch(call) {
  if (call.input?.changes) return renderFileChanges(call);
  const files = patchFiles(call.input.patch ?? "");
  const mode = uiGet(`${call.id}:mode`, "unified");
  const wrap = uiGet(`${call.id}:wrap`, false);
  const blocks = files.map((f, fi) => {
    const lang = langOf(f.path);
    const add = f.lines.filter((l) => l[0] === "+").length;
    const del = f.lines.filter((l) => l[0] === "-").length;
    const op = { add: ["add", "ADD"], update: ["upd", "UPDATE"], delete: ["del", "DELETE"] }[f.op];
    let body;
    if (f.op === "add") {
      body = codeView(f.lines.map((l) => l.slice(1)).join("\n"), { lang, wrap, gutter: () => "g-add" });
    } else {
      const hunks = [];
      let cur = null;
      for (const l of f.lines) {
        if (l.startsWith("@@")) {
          cur = { head: l.replace(/^@@\s?/, ""), a: [], b: [] };
          hunks.push(cur);
          continue;
        }
        if (!cur) {
          cur = { head: "", a: [], b: [] };
          hunks.push(cur);
        }
        const text = l.slice(1);
        if (l[0] !== "+") cur.a.push(text);
        if (l[0] !== "-") cur.b.push(text);
      }
      body = hunks.map(
        (h, hi) =>
          html`${h.head ? html`<div class="ed-sub mono" style="font-size:12px;background:color-mix(in srgb, var(--accent) 6%, transparent);color:var(--accent)">@@ ${h.head}</div>` : hi ? html`<div class="ed-sub" style="padding:2px 14px">⋯</div>` : ""}${renderDiff(h.a.join("\n"), h.b.join("\n"), { lang, mode, wrap, fold: false, numbers: false, foldKey: `${call.id}:${fi}:${hi}` })}`,
      );
    }
    const file = DB.files.find((x) => x.agent === call.agent && x.path === f.path);
    return html`<div class="editor patch-file">
      <div class="ed-tabs"><div class="ed-tab on">${fileIcon(f.path)} ${f.path}</div>
        <div class="ed-right"><span class="patch-op ${op[0]}">${op[1]}</span>${plusMinusHTML(add, del)}
          ${file ? html`<button class="btn ghost sm" data-action="open-file" data-agent="${call.agent}" data-path="${file.path}">누적 ${icon("arrow-right", 12)}</button>` : ""}</div></div>
      <div class="ed-body">${body}</div>
    </div>`;
  });
  return html`<div class="row" style="margin-bottom:10px;justify-content:space-between">
      <span class="dim" style="font-size:var(--fs-xs)">Codex patch · 파일 ${files.length}개 · 줄 번호 없이 문맥으로 적용</span>
      <div class="row">
        <div class="seg" role="group" aria-label="diff 보기">
          <button data-action="ui-set" data-key="${call.id}:mode" data-value="unified" aria-pressed="${mode === "unified"}">${icon("rows", 12)} 한 줄</button>
          <button data-action="ui-set" data-key="${call.id}:mode" data-value="split" aria-pressed="${mode === "split"}">${icon("columns", 12)} 나란히</button>
        </div>
        <button class="btn ghost sm" data-action="ui-toggle" data-key="${call.id}:wrap" aria-pressed="${wrap}">${icon("wrap", 13)} 줄바꿈</button>
      </div>
    </div>${blocks}`;
}

// The edits of an Edit/MultiEdit call: the recorded hunks when the result has them (real line
// numbers), else the strings it asked to replace.
function editHunks(call) {
  const patch = call.result?.extra?.patch;
  if (Array.isArray(patch) && patch.length) {
    return patch.map((h) => ({
      old_string: h.lines.filter((l) => l[0] !== "+").map((l) => l.slice(1)).join("\n"),
      new_string: h.lines.filter((l) => l[0] !== "-").map((l) => l.slice(1)).join("\n"),
      at: h.oldStart,
      bt: h.newStart,
    }));
  }
  const i = call.input ?? {};
  return (i.edits ?? [{ old_string: i.old_string, new_string: i.new_string }]).map((e) => ({ old_string: e.old_string ?? "", new_string: e.new_string ?? "", at: 1, bt: 1 }));
}

// When a call has no result yet, or failed: say so plainly.
function resultNote(call) {
  if (!call.result) return html`<div class="err-card" style="border-color:var(--border)">${icon("hourglass", 15)}<div>${call.status === "pending" ? "승인을 기다리고 있어요" : "결과가 아직 없어요"}</div></div>`;
  if (!call.result.err) return "";
  return html`<div class="err-card">${icon("circle-x", 15)}<div><b>실패</b>${maskedText(call.result.text ?? "").slice(0, 1500)}</div></div>`;
}

// Codex FileChange: one editor block per file, unified hunks with real line numbers.
function renderFileChanges(call) {
  const mode = uiGet(`${call.id}:mode`, "unified");
  const wrap = uiGet(`${call.id}:wrap`, false);
  const blocks = Object.entries(call.input.changes).map(([path, change], fi) => {
    const lang = langOf(path);
    const hunks = LD.parseUnified(change.diff ?? "");
    const lines = hunks.flatMap((h) => h.lines);
    const add = lines.filter((l) => l[0] === "+").length;
    const del = lines.filter((l) => l[0] === "-").length;
    const op = { add: ["add", "ADD"], update: ["upd", "UPDATE"], delete: ["del", "DELETE"] }[change.type] ?? ["upd", "UPDATE"];
    const body = change.type === "add"
      ? codeView(lines.map((l) => l.slice(1)).join("\n"), { lang, wrap, gutter: () => "g-add" })
      : hunks.map((h, hi) => renderDiff(
        h.lines.filter((l) => l[0] !== "+").map((l) => l.slice(1)).join("\n"),
        h.lines.filter((l) => l[0] !== "-").map((l) => l.slice(1)).join("\n"),
        { lang, mode, wrap, startA: h.oldStart, startB: h.newStart, foldKey: `${call.id}:${fi}:${hi}`, openFolds: STATE.openFolds },
      ));
    const file = DB.files.find((x) => x.agent === call.agent && x.abs === path);
    const shown = relPath(path, call.agent);
    return html`<div class="editor patch-file">
      <div class="ed-tabs"><div class="ed-tab on">${fileIcon(shown)} ${shown}</div>
        <div class="ed-right"><span class="patch-op ${op[0]}">${op[1]}</span>${plusMinusHTML(add, del)}
          ${file ? html`<button class="btn ghost sm" data-action="open-file" data-agent="${call.agent}" data-path="${file.path}">누적 ${icon("arrow-right", 12)}</button>` : ""}</div></div>
      <div class="ed-body">${body}</div>
    </div>`;
  });
  return html`<div class="row" style="margin-bottom:10px;justify-content:space-between">
      <span class="dim" style="font-size:var(--fs-xs)">Codex 파일 변경 · ${Object.keys(call.input.changes).length}개</span>
      <div class="row">
        <div class="seg" role="group" aria-label="diff 보기">
          <button data-action="ui-set" data-key="${call.id}:mode" data-value="unified" aria-pressed="${mode === "unified"}">${icon("rows", 12)} 한 줄</button>
          <button data-action="ui-set" data-key="${call.id}:mode" data-value="split" aria-pressed="${mode === "split"}">${icon("columns", 12)} 나란히</button>
        </div>
        <button class="btn ghost sm" data-action="ui-toggle" data-key="${call.id}:wrap" aria-pressed="${wrap}">${icon("wrap", 13)} 줄바꿈</button>
      </div>
    </div>${call.result?.err ? resultNote(call) : ""}${blocks}`;
}

// Images are served by the server with the page's token, so they load through fetch.
const API_IMAGES = new Map();

function apiImage(agent, path) {
  const key = `${agent}|${path}`;
  const url = API_IMAGES.get(key);
  if (url) return raw(`<img class="img-real" src="${esc(url)}" alt="${esc(baseName(path))}">`);
  return raw(`<img class="img-real" data-api-image="${esc(key)}" alt="${esc(baseName(path))}">`);
}

// A picture attached to a prompt: read out of the session's transcript by the server.
function promptImage(agent, at, index) {
  const key = `${agent}|${at}|${index}`;
  const url = API_IMAGES.get(`p:${key}`);
  const alt = `첨부한 이미지 ${index + 1}`;
  if (url) return raw(`<img class="img-real pd-img" src="${esc(url)}" alt="${alt}">`);
  return raw(`<img class="img-real pd-img" data-api-pimg="${esc(key)}" alt="${alt}">`);
}

function hydratePromptImages() {
  for (const img of document.querySelectorAll("img[data-api-pimg]")) {
    const key = img.dataset.apiPimg;
    img.removeAttribute("data-api-pimg");
    const [agent, at, index] = key.split("|");
    api(`/api/prompt-image?agent=${encodeURIComponent(agent)}&at=${encodeURIComponent(at)}&i=${encodeURIComponent(index)}`)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        API_IMAGES.set(`p:${key}`, url);
        img.src = url;
      })
      .catch(() => {
        img.replaceWith(Object.assign(document.createElement("div"), { className: "dim", textContent: "이 이미지는 기록에서 찾을 수 없어요" }));
      });
  }
}

function hydrateImages() {
  hydratePromptImages();
  for (const img of document.querySelectorAll("img[data-api-image]")) {
    const key = img.dataset.apiImage;
    img.removeAttribute("data-api-image");
    const [agent, ...rest] = key.split("|");
    const path = rest.join("|");
    api(`/api/image?agent=${encodeURIComponent(agent)}&path=${encodeURIComponent(path)}`)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        API_IMAGES.set(key, url);
        img.src = url;
      })
      .catch(() => {
        img.replaceWith(Object.assign(document.createElement("div"), { className: "dim", textContent: "이미지 파일이 지금은 없어요 (임시 파일이었을 수 있어요)" }));
      });
  }
}
