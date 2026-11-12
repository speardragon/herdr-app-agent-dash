// Numbers, sizes, durations and times as people read them (Korean).

export const fmtInt = (n) => (n == null || Number.isNaN(n) ? "" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","));

export function fmtK(n) {
  if (n == null) return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function fmtBytes(n) {
  if (n == null) return "";
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(n >= 10 << 10 ? 0 : 1)} KB`;
  return `${n} B`;
}

// Seconds -> "0.4초", "12초", "3분 20초", "1시간 5분".
export function fmtDur(sec) {
  if (sec == null || Number.isNaN(sec)) return "";
  if (sec < 1) return `${sec.toFixed(1)}초`;
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) {
    const s = Math.round(sec - m * 60);
    return s ? `${m}분 ${s}초` : `${m}분`;
  }
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

// Short form for tight places: "12s", "3m", "1h 5m".
export function fmtDurShort(sec) {
  if (sec == null) return "";
  if (sec < 1) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function relTime(ms, now = Date.now()) {
  if (!ms) return "";
  const sec = Math.max(0, (now - ms) / 1000);
  if (sec < 10) return "방금";
  if (sec < 60) return `${Math.floor(sec)}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  if (sec < 172800) return "어제";
  return `${Math.floor(sec / 86400)}일 전`;
}

const pad = (n) => String(n).padStart(2, "0");

export function clock(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function clockSec(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// "오늘 14:03", "어제 09:12", "11월 7일 18:40".
export function when(ms, now = Date.now()) {
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return `오늘 ${clock(ms)}`;
  if (sameDay(d, new Date(now - 86400000))) return `어제 ${clock(ms)}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock(ms)}`;
}

export const plural = (n, word) => `${fmtInt(n)}${word}`;

/** The first line that isn't blank, without splitting the whole text (it may be megabytes). */
export function firstLine(text) {
  const s = String(text ?? "");
  let from = 0;
  while (from <= s.length) {
    const end = s.indexOf("\n", from);
    const line = end < 0 ? s.slice(from) : s.slice(from, end);
    if (line.trim()) return line;
    if (end < 0) break;
    from = end + 1;
  }
  return "";
}

export const clip = (text, n) => {
  const s = String(text ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export const sum = (list, pick = (x) => x) => list.reduce((acc, x) => acc + (pick(x) || 0), 0);

export const CUT = /^\[\[cut (\d+)\]\]$/;

const channel = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const h = String(hex ?? "").replace("#", "");
  const n = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}/i.test(n)) return 0;
  return 0.2126 * channel(parseInt(n.slice(0, 2), 16)) + 0.7152 * channel(parseInt(n.slice(2, 4), 16)) + 0.0722 * channel(parseInt(n.slice(4, 6), 16));
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

/** The text color to put on a filled box: white or the dark ink, whichever reads better
 *  (white on a yellow or mint box is under 2:1). */
export const inkOn = (fill, dark = "#21252b") => (contrast(fill, "#ffffff") >= contrast(fill, dark) ? "#ffffff" : dark);

// Hangul and other wide glyphs take about one em; Latin and digits about half.
const emOf = (ch) => (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : 0.56);

/** `text` as at most `lines` lines that fit `width` px at `size` px, the last one ending in "…"
 *  when more was left. The gpui kit has no line clamp, so the width is estimated from the
 *  glyphs; each line is then drawn on its own row with a single-line ellipsis as a safety net. */
export function clampLines(text, width, size, lines = 2) {
  const budget = Math.max(3, Math.floor(width / size));
  const source = String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  let more = false;
  for (let i = 0; i < source.length; i++) {
    let rest = source[i];
    while (rest) {
      if (out.length === lines) {
        more = true;
        break;
      }
      let used = 0;
      let cut = 0;
      for (const ch of rest) {
        used += emOf(ch);
        if (used > budget) break;
        cut += ch.length;
      }
      if (cut >= rest.length) {
        out.push(rest);
        rest = "";
      } else {
        // Break at the last space inside the line when there is one past its first third.
        const at = rest.lastIndexOf(" ", cut);
        const stop = at > cut / 3 ? at : cut;
        out.push(rest.slice(0, stop).trimEnd());
        rest = rest.slice(stop).trimStart();
      }
    }
    if (more) break;
  }
  const total = source.reduce((n, l) => n + l.length, 0);
  const shown = out.reduce((n, l) => n + l.length, 0);
  if (shown < total * 0.98 - 2) more = true;
  if (more && out.length) out[out.length - 1] = `${out[out.length - 1].replace(/[\s.,;:]+$/, "")}…`;
  return out;
}

// "오후 2:52", as a chat shows it.
export function clock12(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const h = d.getHours();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026년 11월 12일 목요일": the line a chat puts between two days. */
export function dayFull(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
}

/** A number that is the same for two times on the same day (local time). */
export function dayOf(ms) {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
