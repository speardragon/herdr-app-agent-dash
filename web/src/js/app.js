// State, navigation, rendering and input. Everything renders from STATE + DB.

const PREFS_KEY = "herdr-dash-prefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: STATE.theme, railGroup: STATE.railGroup, foldedSpaces: STATE.foldedSpaces, locale: UI.locale, concept: STATE.concept }));
  } catch {
    // Storage can be unavailable (private mode, file:// policies); prefs are a convenience only.
  }
}

const PREFS = loadPrefs();

const STATE = {
  concept: "A",
  scope: "all",
  lens: "overview",
  railGroup: PREFS.railGroup === "space" ? "space" : "status",
  railFolded: false,
  foldedSpaces: PREFS.foldedSpaces && typeof PREFS.foldedSpaces === "object" ? PREFS.foldedSpaces : {},
  theme: ["graphite", "ink", "moss"].includes(PREFS.theme) ? PREFS.theme : "graphite",
  sel: { call: {}, link: {}, prompt: {}, file: {} },
  kindFilter: "all",
  agentFilter: "all",
  query: "",
  linkQuery: "",
  linkDomain: "all",
  follow: true,
  unseenCalls: {},
  ui: {},
  openFolds: new Set(),
  diff: { view: "diff", mode: "unified", wrap: false, tree: true },
  live: !reducedMotion(),
  palette: null,
  help: false,
  mobileDetail: false,
  tl: { range: 60, kinds: new Set(Object.keys(KINDS)), sel: null },
  d: { agent: "t1h", focused: "t1h", tab: "tools", detail: null, follow: true },
};
UI.locale = PREFS.locale === "en" ? "en" : "ko";

const uiGet = (key, fallback) => (key in STATE.ui ? STATE.ui[key] : fallback);

function uiSet(key, value) {
  STATE.ui = { ...STATE.ui, [key]: value };
}

function toggleFold(key) {
  const next = new Set(STATE.openFolds);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  STATE.openFolds = next;
}

// ---------- Navigation ----------

function setScope(scope) {
  if (scope === STATE.scope) return;
  STATE.scope = scope;
  STATE.mobileDetail = false;
  STATE.kindFilter = "all";
  STATE.query = "";
  STATE.linkDomain = "all";
  STATE.linkQuery = "";
  // The agent on screen reads more often (data/real.js): fetch it now rather than on the next tick.
  if (scope !== "all") LIVE.synced[scope] = 0;
}

function setConcept(id) {
  STATE.concept = id;
  STATE.tl.sel = null;
  savePrefs();
  renderAll();
}

function go({ concept = STATE.concept, scope, lens, select }) {
  STATE.concept = concept;
  if (scope) setScope(scope);
  if (lens) STATE.lens = lens;
  if (select) {
    const [kind, id] = select;
    STATE.sel = { ...STATE.sel, [kind]: { ...STATE.sel[kind], [STATE.scope]: id } };
    STATE.mobileDetail = true;
  }
  STATE.palette = null;
  savePrefs();
  renderAll();
  if (select && select[0] === "call") resetStageScroll();
}

const openCall = (agent, call) => {
  const c = callById(call);
  if (c && kindOf(c) && STATE.kindFilter !== "all" && kindOf(c) !== STATE.kindFilter) STATE.kindFilter = "all";
  go({ concept: "A", scope: agent, lens: "tools", select: ["call", call] });
  $(`#row-${call}`)?.scrollIntoView({ block: "nearest" });
};
const openPrompt = (agent, n) => go({ concept: "A", scope: agent, lens: "prompts", select: ["prompt", `${agent}:${n}`] });
const openFile = (agent, path) => go({ concept: "A", scope: agent, lens: "diffs", select: ["file", `${agent}:${path}`] });

function resetStageScroll() {
  const stage = $("#stage");
  if (stage) stage.scrollTop = 0;
}

// Smart follow: jump to a new call only if you were on the newest one.
function onNewCall(call) {
  for (const key of ["all", call.agent]) {
    const list = (key === "all" ? DB.calls.filter((c) => !c.parent) : callsOf(key)).filter((c) => c.id !== call.id).sort((a, b) => b.ts - a.ts);
    const prevLatest = list[0]?.id;
    const current = STATE.sel.call[key] || prevLatest;
    if (STATE.follow && current === prevLatest) STATE.sel.call = { ...STATE.sel.call, [key]: call.id };
    else {
      STATE.sel.call = { ...STATE.sel.call, [key]: current };
      STATE.unseenCalls = { ...STATE.unseenCalls, [key]: (STATE.unseenCalls[key] || 0) + 1 };
    }
  }
}

// ---------- Rendering ----------
const conceptView = () => conceptA();

function renderAll() {
  document.body.dataset.theme = STATE.theme;
  const app = $("#app");
  if (!app.firstElementChild) app.innerHTML = '<div id="proto-slot"></div><div id="top-slot"></div><div id="concept-slot"></div>';
  mount($("#proto-slot"), connBar());
  mount($("#top-slot"), topBar());
  mount($("#concept-slot"), conceptView());
  renderPalette();
  renderHelp();
  hydrateImages();
}

function tickClocks() {
  const now = Date.now();
  for (const el of $$("[data-elapsed]")) el.textContent = fmtDur((now - Number(el.dataset.elapsed)) / 1000);
  for (const el of $$("[data-elapsed-ko]")) el.textContent = fmtDurKo((now - Number(el.dataset.elapsedKo)) / 1000);
  for (const el of $$("[data-ago]")) el.textContent = shortAgo(Number(el.dataset.ago), now);
  for (const el of $$("[data-rel]")) el.textContent = relTime(Number(el.dataset.rel), now);
}

// ---------- List navigation (j / k) ----------
function moveSelection(delta) {
  if (STATE.concept !== "A") return;
  const key = STATE.scope;
  if (STATE.lens === "tools") {
    const list = filteredCalls();
    const i = list.findIndex((c) => c.id === selectedCallId());
    const next = list[clamp(i + delta, 0, list.length - 1)];
    if (!next) return;
    STATE.sel.call = { ...STATE.sel.call, [key]: next.id };
    if (i + delta <= 0) STATE.unseenCalls = { ...STATE.unseenCalls, [key]: 0 };
    renderAll();
    resetStageScroll();
    $(`#row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  } else if (STATE.lens === "links") {
    const list = scopeLinks();
    const cur = selectedLink(list);
    const next = list[clamp(list.indexOf(cur) + delta, 0, list.length - 1)];
    if (next) STATE.sel.link = { ...STATE.sel.link, [key]: next.key };
    renderAll();
  } else if (STATE.lens === "prompts") {
    const list = scopePrompts();
    const cur = selectedPrompt(list);
    const next = list[clamp(list.indexOf(cur) + delta, 0, list.length - 1)];
    if (next) STATE.sel.prompt = { ...STATE.sel.prompt, [key]: promptKey(next) };
    renderAll();
  } else if (STATE.lens === "diffs") stepFile(delta);
}

function stepFile(delta) {
  const list = scopeFiles();
  if (!list.length) return;
  const cur = selectedFile(list);
  const next = list[(list.indexOf(cur) + delta + list.length) % list.length];
  STATE.sel.file = { ...STATE.sel.file, [STATE.scope]: next.key };
  renderAll();
}

function railOrder() {
  return railGroups().flatMap((g) => g.list.flatMap((a) => [a.id, ...LTR.descendants(DB.roster, a.id, (n) => inRail(n) && n.isAgent).map((r) => r.node.id)]));
}

// The 하위 에이전트 lens of whoever started `id`, with it picked.
function openSub(id) {
  const owner = parentsOf(id).find((p) => agentById(p)?.isAgent) ?? "all";
  setScope(owner);
  STATE.lens = "subs";
  uiSet(`sub:${owner}`, id);
  STATE.mobileDetail = true;
  renderAll();
}

// ---------- Clicks ----------
const ACTIONS = {
  concept: (el) => setConcept(el.dataset.concept),
  "pick-sub": (el) => {
    uiSet(`sub:${STATE.scope}`, el.dataset.sub);
    if (STATE.lens !== "subs") STATE.lens = "subs";
    STATE.mobileDetail = true;
    renderAll();
  },
  "open-sub": (el) => openSub(el.dataset.sub),
  scope: (el) => {
    // A plain program has no lenses of its own: show it under whoever started it.
    const target = agentById(el.dataset.scope);
    if (target?.sub && !target.isAgent) return openSub(target.id);
    setScope(el.dataset.scope);
    if (STATE.concept !== "A") STATE.concept = "A";
    if (el.closest(".ftable")) STATE.lens = "overview";
    renderAll();
  },
  "scope-a": (el) => go({ concept: "A", scope: el.dataset.scope, lens: "overview" }),
  lens: (el) => {
    STATE.lens = el.dataset.lens;
    STATE.mobileDetail = false;
    renderAll();
  },
  "space-fold": (el) => {
    const key = el.dataset.space;
    STATE.foldedSpaces = { ...STATE.foldedSpaces, [key]: !STATE.foldedSpaces[key] };
    savePrefs();
    renderAll();
  },
  "rail-group": (el) => {
    STATE.railGroup = el.dataset.value;
    savePrefs();
    renderAll();
  },
  "select-call": (el) => {
    const id = el.dataset.call;
    if (STATE.concept === "B") {
      STATE.tl.sel = id;
      renderAll();
      return;
    }
    if (STATE.concept === "D") {
      STATE.d = { ...STATE.d, detail: { kind: "call", id } };
      renderAll();
      return;
    }
    STATE.sel.call = { ...STATE.sel.call, [STATE.scope]: id };
    STATE.mobileDetail = true;
    if (filteredCalls()[0]?.id === id) STATE.unseenCalls = { ...STATE.unseenCalls, [STATE.scope]: 0 };
    renderAll();
    resetStageScroll();
  },
  "open-call": (el) => (el.dataset.call ? openCall(el.dataset.agent, el.dataset.call) : go({ concept: "A", scope: el.dataset.agent, lens: "tools" })),
  "open-prompt": (el) => openPrompt(el.dataset.agent, Number(el.dataset.prompt)),
  "open-file": (el) => openFile(el.dataset.agent, el.dataset.path),
  "open-lens": (el) => go({ concept: "A", scope: el.dataset.agent, lens: el.dataset.lens }),
  "select-link": (el) => {
    STATE.sel.link = { ...STATE.sel.link, [STATE.scope]: el.dataset.key };
    STATE.mobileDetail = true;
    renderAll();
  },
  "select-prompt": (el) => {
    STATE.sel.prompt = { ...STATE.sel.prompt, [STATE.scope]: el.dataset.key };
    STATE.mobileDetail = true;
    renderAll();
  },
  "select-file": (el) => {
    STATE.sel.file = { ...STATE.sel.file, [STATE.scope]: el.dataset.key };
    renderAll();
  },
  kind: (el) => {
    STATE.kindFilter = el.dataset.kind;
    renderAll();
  },
  "agent-filter": (el) => {
    STATE.agentFilter = el.dataset.agent;
    renderAll();
  },
  "clear-filters": () => {
    STATE.kindFilter = "all";
    STATE.agentFilter = "all";
    STATE.query = "";
    renderAll();
  },
  follow: () => {
    STATE.follow = !STATE.follow;
    renderAll();
  },
  "jump-latest": () => {
    const first = filteredCalls()[0];
    STATE.unseenCalls = { ...STATE.unseenCalls, [STATE.scope]: 0 };
    if (first) STATE.sel.call = { ...STATE.sel.call, [STATE.scope]: first.id };
    renderAll();
    const list = $(".list-body");
    if (list) list.scrollTop = 0;
  },
  "link-domain": (el) => {
    STATE.linkDomain = el.dataset.domain;
    renderAll();
  },
  "clear-link-filters": () => {
    STATE.linkDomain = "all";
    STATE.linkQuery = "";
    renderAll();
  },
  locale: (el) => {
    UI.locale = el.dataset.value;
    savePrefs();
    renderAll();
  },
  unfold: (el) => {
    toggleFold(el.dataset.fold);
    renderAll();
  },
  "ui-set": (el) => {
    uiSet(el.dataset.key, el.dataset.value);
    renderAll();
  },
  "ui-toggle": (el) => {
    uiSet(el.dataset.key, !uiGet(el.dataset.key, false));
    renderAll();
  },
  "diff-set": (el) => {
    const v = el.dataset.value;
    STATE.diff = { ...STATE.diff, [el.dataset.key]: v === "true" ? true : v === "false" ? false : v };
    renderAll();
  },
  "diff-tree": () => {
    STATE.diff = { ...STATE.diff, tree: !STATE.diff.tree };
    renderAll();
  },
  "collapse-tree": () => {
    const dirs = $$(".tree .tn.dir").map((n) => n.dataset.fold);
    const allClosed = dirs.every((d) => STATE.openFolds.has(d));
    const next = new Set(STATE.openFolds);
    dirs.forEach((d) => (allClosed ? next.delete(d) : next.add(d)));
    STATE.openFolds = next;
    renderAll();
  },
  "file-step": (el) => stepFile(Number(el.dataset.step)),
  copy: async (el) => {
    const ok = await copyText(el.dataset.copy);
    toast({ title: ok ? "복사했어요" : "복사하지 못했어요", body: ok ? `<code>${esc(el.dataset.copy.slice(0, 120))}${el.dataset.copy.length > 120 ? "…" : ""}</code>` : "브라우저가 클립보드 접근을 막았어요.", timeout: 2600 });
  },
  "more-calls": () => {
    const key = STATE.scope;
    STATE.listLimit = { ...(STATE.listLimit ?? {}), [key]: (STATE.listLimit?.[key] ?? LIST_PAGE) + LIST_PAGE };
    renderAll();
  },
  "focus-agent": (el) => {
    const id = el.dataset.agent;
    api(`/api/focus?agent=${encodeURIComponent(id)}`)
      .then(() => toast({ title: "herdr에서 열었어요", body: esc(agentById(id)?.title ?? id), timeout: 2600 }))
      .catch((error) => toast({ title: "herdr에서 열지 못했어요", body: esc(String(error.message ?? error)), kind: "blocked" }));
  },
  boundary: (el) => {
    if (el.getAttribute("aria-disabled") === "true") {
      toast({ title: "지금은 열 수 없어요", body: "home 머신에 연결되지 않았어요. <code>hc machine login home</code>" });
      return;
    }
    boundaryToast(el.dataset.cmd, el.dataset.note);
  },
  palette: () => {
    STATE.palette = STATE.palette ? null : { q: "", i: 0 };
    renderPalette();
  },
  "palette-run": (el) => runPaletteItem(Number(el.dataset.index)),
  help: () => {
    STATE.help = !STATE.help;
    renderHelp();
  },
  "live-toggle": () => {
    STATE.live = !STATE.live;
    if (STATE.live) {
      if (LIVE.step >= LIVE_SCRIPT.length) resetLive();
      else startLive();
    } else stopLive();
    renderAll();
  },
  "live-reset": () => {
    resetLive();
    renderAll();
    toast({ title: "처음 상태로 되돌렸어요", body: "3초마다 이벤트가 하나씩 들어와요: 출력, 끝난 호출, 새 호출, 상태 변화.", timeout: 3200 });
  },
  "fleet-status": (el) => {
    const first = DB.agents.find((a) => a.status === el.dataset.status);
    go({ concept: "A", scope: el.dataset.status === "blocked" && first ? first.id : "all", lens: "overview" });
  },
  "tl-range": (el) => {
    STATE.tl = { ...STATE.tl, range: Number(el.dataset.value) };
    renderAll();
  },
  "tl-kind": (el) => {
    const kinds = new Set(STATE.tl.kinds);
    if (kinds.has(el.dataset.kind)) kinds.delete(el.dataset.kind);
    else kinds.add(el.dataset.kind);
    STATE.tl = { ...STATE.tl, kinds };
    renderAll();
  },
  "tl-select": (el) => {
    STATE.tl = { ...STATE.tl, sel: STATE.tl.sel === el.dataset.call ? null : el.dataset.call };
    renderAll();
  },
  "tl-close": () => {
    STATE.tl = { ...STATE.tl, sel: null };
    renderAll();
  },
  "d-focus": (el) => {
    const id = el.dataset.agent;
    STATE.d = STATE.d.follow ? { ...STATE.d, focused: id, agent: id, detail: null } : { ...STATE.d, focused: id };
    renderAll();
  },
  "d-next": () => {
    const ids = DB.agents.filter((a) => !a.machine).map((a) => a.id);
    const next = ids[(ids.indexOf(STATE.d.agent) + 1) % ids.length];
    STATE.d = { ...STATE.d, agent: next, focused: STATE.d.follow ? next : STATE.d.focused, detail: null };
    renderAll();
  },
  "d-tab": (el) => {
    STATE.d = { ...STATE.d, tab: el.dataset.tab, detail: null };
    renderAll();
  },
  "d-follow": () => {
    STATE.d = { ...STATE.d, follow: !STATE.d.follow, agent: !STATE.d.follow ? STATE.d.focused : STATE.d.agent };
    renderAll();
  },
  "mod-open": (el) => {
    STATE.d = { ...STATE.d, detail: { kind: el.dataset.kind, id: el.dataset.id } };
    renderAll();
  },
  "mod-back": () => {
    STATE.d = { ...STATE.d, detail: null };
    renderAll();
  },
  "mobile-back": () => {
    STATE.mobileDetail = false;
    renderAll();
  },
};

function runPaletteItem(index) {
  const item = STATE.palette?.flat?.[index];
  STATE.palette = null;
  renderPalette();
  if (item) item.run();
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const act = el.dataset.action;
  if (act === "palette-close-bg" || act === "help-close-bg") {
    if (e.target !== el) return;
    STATE.palette = null;
    STATE.help = false;
    renderPalette();
    renderHelp();
    return;
  }
  const fn = ACTIONS[act];
  if (!fn) return;
  if (el.tagName === "A") return;
  e.preventDefault();
  fn(el, e);
});

document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.raw) return;
  const key = `raw:${d.dataset.raw}`;
  if (d.open !== STATE.openFolds.has(key)) toggleFold(key);
}, true);

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "palette-input") {
    STATE.palette = { ...STATE.palette, q: el.value, i: 0 };
    renderPalette();
    return;
  }
  const field = el.dataset.input;
  if (field === "query" || field === "linkQuery") {
    STATE[field] = el.value;
    renderAll();
  }
});

document.addEventListener("change", (e) => {
  if (e.target.dataset.input === "theme") {
    STATE.theme = e.target.value;
    savePrefs();
    renderAll();
  }
});

// Tooltips for timeline spans and markers.
document.addEventListener("mouseover", (e) => showTip(e.target.closest("[data-tip]"), e.clientX, e.clientY));
document.addEventListener("focusin", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return showTip(null);
  const r = t.getBoundingClientRect();
  showTip(t, r.left, r.bottom);
});

function trapFocus(e, root) {
  const nodes = $$('button, input, [href], [tabindex]:not([tabindex="-1"])', root).filter((n) => !n.disabled);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    STATE.palette = STATE.palette ? null : { q: "", i: 0 };
    renderPalette();
    return;
  }
  if (STATE.palette) {
    const n = STATE.palette.flat?.length || 0;
    if (e.key === "Escape") {
      STATE.palette = null;
      renderPalette();
      $(".search-btn")?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      STATE.palette = { ...STATE.palette, i: clamp(STATE.palette.i + (e.key === "ArrowDown" ? 1 : -1), 0, Math.max(0, n - 1)) };
      renderPalette();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runPaletteItem(clamp(STATE.palette.i, 0, n - 1));
    } else if (e.key === "Tab") trapFocus(e, $("#overlay-root"));
    return;
  }
  if (STATE.help) {
    if (e.key === "Escape" || e.key === "?") {
      STATE.help = false;
      renderHelp();
    } else if (e.key === "Tab") trapFocus(e, $("#overlay-root"));
    return;
  }
  const typing = e.target.closest("input, textarea, select");
  if (e.key === "Escape") {
    if (typing) {
      e.target.blur();
      return;
    }
    if (STATE.concept === "B" && STATE.tl.sel) ACTIONS["tl-close"]();
    else if (STATE.concept === "D" && STATE.d.detail) ACTIONS["mod-back"]();
    else if (STATE.mobileDetail) ACTIONS["mobile-back"]();
    return;
  }
  if (typing || mod || e.altKey) return;
  if (e.target.closest(".lens-tab") && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    const i = LENSES.findIndex((l) => l.id === STATE.lens);
    STATE.lens = LENSES[(i + (e.key === "ArrowRight" ? 1 : -1) + LENSES.length) % LENSES.length].id;
    renderAll();
    $(`#tab-${STATE.lens}`)?.focus();
    return;
  }
  const key = e.key;
  if (key === "?") {
    STATE.help = true;
    renderHelp();
  } else if (STATE.concept === "A" && /^[1-6]$/.test(key)) {
    STATE.lens = LENSES[Number(key) - 1].id;
    renderAll();
  } else if (STATE.concept === "A" && key === "0") go({ scope: "all", lens: STATE.lens });
  else if (key === "j" || key === "ArrowDown") {
    if (STATE.concept === "A" && !e.target.closest(".dv-body, .stage, .scroll, .tl-scroll")) {
      e.preventDefault();
      moveSelection(1);
    }
  } else if (key === "k" || key === "ArrowUp") {
    if (STATE.concept === "A" && !e.target.closest(".dv-body, .stage, .scroll, .tl-scroll")) {
      e.preventDefault();
      moveSelection(-1);
    }
  } else if (key === "]" || key === "[") {
    const ids = ["all", ...railOrder()];
    const i = ids.indexOf(STATE.scope);
    go({ concept: "A", scope: ids[(i + (key === "]" ? 1 : -1) + ids.length) % ids.length] });
  } else if (key === "f") ACTIONS.follow();
  else if (STATE.lens === "diffs" && STATE.concept === "A") {
    if (key === "n") stepFile(1);
    else if (key === "p") stepFile(-1);
    else if (key === "v") ACTIONS["diff-set"]({ dataset: { key: "view", value: STATE.diff.view === "diff" ? "file" : "diff" } });
    else if (key === "s") ACTIONS["diff-set"]({ dataset: { key: "mode", value: STATE.diff.mode === "split" ? "unified" : "split" } });
    else if (key === "w") ACTIONS["diff-set"]({ dataset: { key: "wrap", value: String(!STATE.diff.wrap) } });
    else if (key === "t") ACTIONS["diff-tree"]();
  }
});

// ---------- Start ----------
DB = buildStore();
rzInstall();
renderAll();
setInterval(tickClocks, 1000);
startLive();

// A handle for checking the page from a browser console (the page is a module).
window.agentDash = { state: () => STATE, db: () => DB, live: LIVE, go, renderAll, siteView, parsers: { LJ, LN, LSK } };
