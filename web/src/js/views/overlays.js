// ⌘K palette, shortcut sheet, toasts and the hover tooltip.

function paletteItems(q) {
  const query = q.trim().toLowerCase();
  const hit = (text) => !query || text.toLowerCase().includes(query);
  const groups = [];
  const commands = [
    ...CONCEPTS.map((c) => ({ label: `시안 ${c.id} · ${c.name}`, sub: "시안 전환", icon: c.icon, run: () => setConcept(c.id) })),
    ...LENSES.map((l) => ({ label: `${l.label} 렌즈`, sub: STATE.scope === "all" ? "전체 현황" : agentById(STATE.scope).title, icon: l.icon, run: () => go({ concept: "A", lens: l.id }) })),
    { label: "전체 현황", sub: "모든 에이전트", icon: "grid", run: () => go({ concept: "A", scope: "all", lens: "overview" }) },
  ].filter((c) => hit(`${c.label} ${c.sub}`));
  const agents = DB.agents.filter((a) => hit(`${a.title} ${a.space} ${a.tab} ${a.id}`)).map((a) => ({ label: a.title, sub: `${STATUS_LABEL[a.status]} · ${a.space} › ${a.tab}`, logo: a.app, run: () => go({ concept: "A", scope: a.id, lens: "overview" }) }));
  const calls = query
    ? DB.calls
        .filter((c) => !c.parent && hit(`${toolTitle(c)} ${toolTarget(c)}`))
        .slice(0, 6)
        .map((c) => ({ label: `${toolTitle(c)} ${toolTarget(c)}`, sub: agentById(c.agent).title, call: c, run: () => openCall(c.agent, c.id) }))
    : [];
  const links = query
    ? allLinks()
        .filter((l) => hit(`${l.title} ${l.url}`))
        .slice(0, 5)
        .map((l) => ({ label: l.title, sub: l.url, fav: l.url, run: () => go({ concept: "A", scope: l.agent, lens: "links", select: ["link", l.key] }) }))
    : [];
  const prompts = query
    ? DB.prompts
        .filter((p) => hit(p.text))
        .slice(0, 5)
        .map((p) => ({ label: p.text.split("\n")[0], sub: `${agentById(p.agent).title} · #${p.n}`, icon: "message", run: () => openPrompt(p.agent, p.n) }))
    : [];
  const files = query
    ? DB.files
        .filter((f) => hit(f.path))
        .slice(0, 5)
        .map((f) => ({ label: f.path, sub: agentById(f.agent).title, file: f.path, run: () => openFile(f.agent, f.path) }))
    : [];
  if (agents.length) groups.push(["에이전트", agents]);
  if (calls.length) groups.push(["도구 호출", calls]);
  if (links.length) groups.push(["링크", links]);
  if (prompts.length) groups.push(["프롬프트", prompts]);
  if (files.length) groups.push(["파일", files]);
  if (commands.length) groups.push(["이동", commands]);
  return groups;
}

function markMatch(text, q) {
  const t = String(text);
  const i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return esc(t);
  return `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
}

function renderPalette() {
  const root = $("#overlay-root");
  if (!STATE.palette) {
    if (root.dataset.kind === "palette") {
      root.innerHTML = "";
      root.dataset.kind = "";
    }
    return;
  }
  const groups = paletteItems(STATE.palette.q);
  const flat = groups.flatMap(([, items]) => items);
  STATE.palette.flat = flat;
  const sel = clamp(STATE.palette.i, 0, Math.max(0, flat.length - 1));
  let n = -1;
  const body = groups.length
    ? groups
        .map(
          ([label, items]) =>
            `<div class="p-group">${esc(label)}</div>${items
              .map((it) => {
                n++;
                const lead = it.logo ? logo(it.logo, 20).s : it.fav ? fav(it.fav, 20).s : it.call ? `<span style="color:${kindColor(it.call)};display:inline-flex">${toolIcon(it.call, 16).s}</span>` : it.file ? fileIcon(it.file, 16).s : icon(it.icon || "arrow-right", 16).s;
                return `<button class="p-item" role="option" id="p-${n}" aria-selected="${n === sel}" data-action="palette-run" data-index="${n}">${lead}<span style="min-width:0;flex:1"><div class="truncate">${markMatch(it.label, STATE.palette.q)}</div><div class="p-sub truncate">${esc(it.sub || "")}</div></span></button>`;
              })
              .join("")}`,
        )
        .join("")
    : `<div class="empty" style="min-height:140px"><p>“${esc(STATE.palette.q)}”에 맞는 게 없어요</p></div>`;
  const keep = root.dataset.kind === "palette" ? $("#palette-input") : null;
  if (keep) {
    $(".p-body", root).innerHTML = body;
    $(`#p-${sel}`, root)?.scrollIntoView({ block: "nearest" });
    return;
  }
  root.dataset.kind = "palette";
  root.innerHTML = `<div class="scrim" data-action="palette-close-bg"><div class="palette" role="dialog" aria-modal="true" aria-label="모두 검색">
    <div class="p-input">${icon("search", 18).s}<input id="palette-input" placeholder="에이전트, 도구 호출, 링크, 프롬프트, 파일…" value="${esc(STATE.palette.q)}" role="combobox" aria-expanded="true" aria-controls="p-list" autocomplete="off"><span class="kbd">esc</span></div>
    <div class="p-body" id="p-list" role="listbox">${body}</div>
    <div class="p-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> 고르기</span><span><span class="kbd">↵</span> 열기</span><span><span class="kbd">esc</span> 닫기</span></div>
  </div></div>`;
  $("#palette-input").focus();
}

const SHORTCUTS = [
  [["⌘", "K"], "모두 검색"],
  [["1"], "개요"],
  [["2"], "도구 호출"],
  [["3"], "링크"],
  [["4"], "프롬프트"],
  [["5"], "변경"],
  [["j"], "목록에서 다음 (↓도 됨)"],
  [["k"], "목록에서 이전 (↑도 됨)"],
  [["["], "이전 에이전트"],
  [["]"], "다음 에이전트"],
  [["0"], "전체 현황"],
  [["f"], "새 호출 따라가기 켜고 끄기"],
  [["n"], "변경: 다음 파일"],
  [["p"], "변경: 이전 파일"],
  [["v"], "변경: Diff ↔ 파일"],
  [["s"], "변경: 한 줄 ↔ 나란히"],
  [["w"], "변경: 줄바꿈"],
  [["t"], "변경: 탐색기 접기"],
  [["⇧", "A–D"], "시안 전환"],
  [["esc"], "창 닫기"],
];

function renderHelp() {
  const root = $("#overlay-root");
  if (!STATE.help) {
    if (root.dataset.kind === "help") {
      root.innerHTML = "";
      root.dataset.kind = "";
    }
    return;
  }
  root.dataset.kind = "help";
  root.innerHTML = `<div class="scrim" data-action="help-close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1" id="help-sheet">
    <div class="row"><h2 id="help-title" class="grow" style="margin:0">단축키</h2><button class="btn ghost sm icon" data-action="help" aria-label="닫기">${icon("x", 14).s}</button></div>
    <div class="keys" style="margin-top:14px">${SHORTCUTS.map(([keys, label]) => `<span class="kk">${keys.map((k) => `<span class="kbd">${esc(k)}</span>`).join("")}</span><span>${esc(label)}</span>`).join("")}</div>
    <div class="note">이 시안은 목업 데이터예요. <b>herdr에서 열기</b>, <b>답하기</b> 같은 버튼은 실제 제품이 실행할 명령을 알려 주고 끝나요. 복사와 링크 열기는 진짜로 동작해요.</div>
  </div></div>`;
  $("#help-sheet").focus();
}

function toast({ title, body = "", kind = "", action = null, timeout = 5200 }) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const lead = kind === "blocked" ? `<span style="color:var(--blocked)">${icon("alert", 18).s}</span>` : kind === "done" ? `<span style="color:var(--done)">${icon("circle-check", 18).s}</span>` : `<span style="color:var(--accent)">${icon("info", 18).s}</span>`;
  el.innerHTML = `${lead}<div style="min-width:0;flex:1"><div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${body}</div>` : ""}${action ? `<div class="t-actions"><button class="btn sm">${esc(action.label)}</button></div>` : ""}</div><button class="btn ghost sm icon" aria-label="알림 닫기">${icon("x", 13).s}</button>`;
  const close = () => el.remove();
  el.querySelector('[aria-label="알림 닫기"]').addEventListener("click", close);
  if (action) {
    el.querySelector(".t-actions button").addEventListener("click", () => {
      action.run();
      close();
    });
  }
  let timer = setTimeout(close, timeout);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => {
    timer = setTimeout(close, 2500);
  });
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
}

function boundaryToast(cmd, note) {
  toast({ title: "실제 제품에서는 이 명령을 실행해요", body: `<code>${esc(cmd)}</code>${note ? `<div style="margin-top:6px">${esc(note)}</div>` : ""}` });
}

function showTip(target, x, y) {
  const tip = $("#tooltip");
  if (!target) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = target.dataset.tip;
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${clamp(x + 14, 8, window.innerWidth - w - 8)}px`;
  tip.style.top = `${y + h + 22 > window.innerHeight ? y - h - 12 : y + 16}px`;
}
