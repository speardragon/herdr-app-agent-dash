// Small helpers shared by every view. One classic script: names here are global.

const T0 = Date.now();
const atOffset = (sec) => T0 + sec * 1000;

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
const raw = (s) => new Raw(String(s));

// Booleans print as "true"/"false" so aria-* attributes carry their state.
function renderValue(v) {
  if (v == null) return "";
  if (typeof v === "boolean") return String(v);
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}

// Tagged template: interpolations are escaped unless wrapped in raw().
function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Raw(out);
}

const cx = (...parts) => parts.filter(Boolean).join(" ");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sum = (list, f = (x) => x) => list.reduce((acc, x) => acc + f(x), 0);
const uniq = (list) => [...new Set(list)];
const groupBy = (list, keyOf) =>
  list.reduce((acc, item) => {
    const k = keyOf(item);
    return { ...acc, [k]: [...(acc[k] || []), item] };
  }, {});

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- Numbers ----------
const fmtInt = (n) => Number(n).toLocaleString("en-US");

function fmtK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}

function fmtBytes(b) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${b} B`;
}

function fmtDur(sec) {
  if (sec == null) return "";
  if (sec < 1) return `${Math.max(1, Math.round(sec * 1000))}ms`;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function fmtDurKo(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${String(r).padStart(2, "0")}초`;
  return `${r}초`;
}

// ---------- Time ----------
const UI = { locale: "ko" };

function relTime(ts, now = Date.now()) {
  const d = Math.max(0, Math.round((now - ts) / 1000));
  const ko = UI.locale === "ko";
  if (d < 45) return ko ? "방금 전" : "just now";
  const m = Math.round(d / 60);
  if (m < 60) return ko ? `${m}분 전` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return ko ? `${h}시간 전` : `${h}h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return ko ? "어제" : "yesterday";
  if (days < 7) return ko ? `${days}일 전` : `${days}d ago`;
  return dateLabel(ts);
}

function shortAgo(ts, now = Date.now()) {
  const d = Math.max(0, Math.round((now - ts) / 1000));
  if (d < 60) return "<1m";
  const m = Math.round(d / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function clock(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (UI.locale === "ko") return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${mm}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function hhmmss(ts) {
  const d = new Date(ts);
  return `${hhmm(ts)}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateLabel(ts) {
  const d = new Date(ts);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  if (UI.locale === "ko") return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

function dayLabel(ts) {
  const today = dayKey(Date.now());
  const yest = dayKey(Date.now() - 86400000);
  const k = dayKey(ts);
  if (k === today) return UI.locale === "ko" ? "오늘" : "Today";
  if (k === yest) return UI.locale === "ko" ? "어제" : "Yesterday";
  return dateLabel(ts);
}

// ---------- Paths & URLs ----------
const baseName = (p) => p.split("/").filter(Boolean).pop() || p;
const dirName = (p) => p.split("/").slice(0, -1).join("/");
const extOf = (p) => {
  const b = baseName(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
};

const LANG_BY_EXT = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "tsx",
  json: "json",
  md: "md",
  css: "css",
  scss: "css",
  sh: "bash",
  swift: "swift",
  yml: "yaml",
  yaml: "yaml",
};
const langOf = (p) => LANG_BY_EXT[extOf(p)] || "text";

function shortPath(p) {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function parseUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

const hostOf = (u) => (parseUrl(u)?.hostname || u).replace(/^www\./, "");

// ---------- DOM ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Re-renders a region, keeping scroll positions and the focused control.
function mount(el, content) {
  if (!el) return;
  const scrolls = $$("[data-keep-scroll]", el).map((n) => [n.dataset.keepScroll, n.scrollTop, n.scrollLeft]);
  const own = el.hasAttribute("data-keep-scroll") ? [el.scrollTop, el.scrollLeft] : null;
  const active = document.activeElement;
  const focusKey = active && el.contains(active) ? active.dataset.focusKey : null;
  const selStart = active && "selectionStart" in active ? active.selectionStart : null;
  el.innerHTML = renderValue(content);
  for (const [key, top, left] of scrolls) {
    const n = el.querySelector(`[data-keep-scroll="${key}"]`);
    if (n) {
      n.scrollTop = top;
      n.scrollLeft = left;
    }
  }
  if (own) {
    el.scrollTop = own[0];
    el.scrollLeft = own[1];
  }
  if (focusKey) {
    const n = el.querySelector(`[data-focus-key="${focusKey}"]`);
    if (n) {
      n.focus({ preventScroll: true });
      if (selStart != null && "setSelectionRange" in n) n.setSelectionRange(selStart, selStart);
    }
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
