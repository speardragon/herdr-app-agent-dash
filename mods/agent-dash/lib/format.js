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
