// Grep and Glob: a search field, its options as tags, results grouped by file.

// Paths -> nested folders; single-child folders merge ("src/hooks"), like VS Code's compact folders.
function buildTree(items, pathOf) {
  const root = { name: "", path: "", dirs: new Map(), files: [] };
  for (const item of items) {
    const parts = pathOf(item).split("/").filter(Boolean);
    let node = root;
    parts.slice(0, -1).forEach((part, idx) => {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: parts.slice(0, idx + 1).join("/"), dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    });
    node.files.push({ name: parts[parts.length - 1], item });
  }
  const compact = (node) => {
    const dirs = [...node.dirs.values()].map(compact);
    let out = { ...node, dirs };
    while (out.dirs.length === 1 && out.files.length === 0 && out.name) {
      const only = out.dirs[0];
      out = { ...only, name: `${out.name}/${only.name}` };
    }
    return out;
  };
  const top = compact(root);
  return { ...top, dirs: top.dirs.map((d) => d) };
}

function patternRegex(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function matchRanges(text, re) {
  if (!re) return [];
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (!m[0].length) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

function searchCapsule(patternHTML, right, iconName = "search") {
  return html`<div class="search-cap">${icon(iconName, 16)}<div class="pat">${patternHTML}</div><div class="res">${right}</div></div>`;
}

// Real Grep results -> {mode, files: [{path, count, matches: [{line, text, ctx, gap}]}]}.
function grepResult(call) {
  const i = call.input ?? {};
  const x = call.result?.extra ?? {};
  const mode = x.mode ?? i.output_mode ?? "files_with_matches";
  const rel = (p) => relPath(p, call.agent);
  if (mode === "files_with_matches") return { mode, files: (x.filenames ?? []).map((p) => ({ path: rel(p), count: 0, matches: [] })) };
  const byPath = new Map();
  const fileOf = (p) => {
    if (!byPath.has(p)) byPath.set(p, { path: rel(p), count: 0, matches: [] });
    return byPath.get(p);
  };
  for (const raw of String(x.content ?? call.result?.text ?? "").split("\n")) {
    if (!raw) continue;
    if (mode === "count") {
      const m = /^(.*):(\d+)$/.exec(raw);
      if (m) fileOf(m[1]).count = Number(m[2]);
      continue;
    }
    if (raw === "--") {
      const last = [...byPath.values()].pop();
      if (last) last.matches.push({ gap: true });
      continue;
    }
    // "path:12:text" is a match, "path-12-text" context; a single-file search has no path.
    const m = /^(.+?)([:-])(\d+)\2(.*)$/.exec(raw) ?? /^()(?:)(\d+)[:-](.*)$/.exec(raw);
    if (!m) continue;
    const path = m[1] || i.path || "";
    const match = m.length === 5 ? { line: Number(m[3]), text: m[4], ctx: m[2] === "-" } : { line: Number(m[2]), text: m[3], ctx: false };
    const f = fileOf(path);
    f.matches.push(match);
    if (!match.ctx) f.count += 1;
  }
  return { mode, files: [...byPath.values()].slice(0, 60).map((f) => ({ ...f, matches: f.matches.slice(0, 80) })) };
}

function renderGrep(call) {
  const i = call.input;
  const r = grepResult(call);
  const re = patternRegex(i.pattern, i["-i"] ? "gi" : "g");
  const files = r.files || [];
  const hits = sum(files, (f) => f.matches.filter((m) => !m.ctx && !m.gap).length);
  const tagKeys = ["path", "glob", "type", "output_mode", "-i", "-n", "-C", "-A", "-B", "multiline", "head_limit"];
  const tags = tagKeys
    .filter((k) => i[k] !== undefined && i[k] !== false)
    .map((k) => html`<span class="tag"><i>${k}</i>${i[k] === true ? "" : k === "path" ? shortPath(i[k]) : String(i[k])}</span>`);
  const mode = r.mode || i.output_mode || "files_with_matches";
  let body;
  if (mode === "count") {
    const max = Math.max(...files.map((f) => f.count), 1);
    body = html`<div class="box" style="padding:8px 0">${files.map(
      (f) => html`<div class="countbar"><span class="mono truncate">${fileIcon(f.path)} ${f.path}</span><span class="bar" style="width:${(f.count / max) * 100}%"></span><span class="num dim">${f.count}</span></div>`,
    )}</div>`;
  } else if (mode === "files_with_matches") {
    body = html`<div class="box gtree">${files.map((f) => html`<div class="gn">${fileIcon(f.path)}<span>${baseName(f.path)}</span><span class="dim mono" style="font-size:12px">${dirName(f.path)}</span></div>`)}</div>`;
  } else {
    body = html`<div class="box">${files.map((f) => {
      const lang = langOf(f.path);
      const n = f.matches.filter((m) => !m.ctx && !m.gap).length;
      return html`<div class="mfile">
        <div class="mfile-h">${fileIcon(f.path)}<b>${baseName(f.path)}</b><span class="dir truncate">${dirName(f.path)}</span><span class="cnt">${n}</span></div>
        <div style="padding:4px 0 6px">${f.matches.map((m) => {
          if (m.gap) return raw(`<div class="mgap">⋯</div>`);
          const toks = tokenize(m.text, lang)[0] || [];
          const marks = m.ctx ? null : matchRanges(m.text, re);
          return raw(`<div class="mline ${m.ctx ? "ctx" : "match"}"><span class="ln">${m.line}</span><span class="tx">${lineHTML(toks, marks)}</span></div>`);
        })}</div>
      </div>`;
    })}</div>`;
  }
  return html`${searchCapsule(hlInline(i.pattern, "regex"), `${hits}개 일치 · 파일 ${files.length}개`)}
    <div class="tags">${tags}<span class="tag"><i>정규식</i>${i["-i"] ? "대소문자 무시" : "대소문자 구분"}</span></div>
    ${body}`;
}

function treeRows(node, depth, rowFor, dirRow) {
  const out = [];
  const dirs = [...node.dirs].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    out.push(dirRow(d, depth));
    out.push(...treeRows(d, depth + 1, rowFor, dirRow));
  }
  for (const f of node.files) out.push(rowFor(f, depth));
  return out;
}

function renderGlob(call) {
  const i = call.input;
  const x = call.result?.extra ?? {};
  const r = { files: (x.filenames ?? []).map((p) => relPath(p, call.agent)), truncated: !!x.truncated };
  const tree = buildTree(r.files, (p) => p);
  const indent = (d) => `padding-left:${8 + d * 16}px`;
  const rows = treeRows(
    tree,
    0,
    (f, d) => raw(`<div class="gn" style="${indent(d)}">${fileIcon(f.name).s}<span>${esc(f.name)}</span></div>`),
    (dir, d) => raw(`<div class="gn dir" style="${indent(d)}">${folderIcon(baseName(dir.name)).s}<span class="nm">${esc(dir.name)}</span></div>`),
  );
  return html`${searchCapsule(hlInline(i.pattern, "glob"), `파일 ${r.files.length}개`, "folder-search")}
    <div class="tags">${i.path ? html`<span class="tag"><i>path</i>${shortPath(i.path)}</span>` : ""}<span class="tag"><i>정렬</i>수정 시각 (최근 먼저)</span>${r.truncated ? html`<span class="tag" style="color:var(--working)">100개에서 잘림</span>` : ""}</div>
    <div class="box gtree">${rows}</div>`;
}
