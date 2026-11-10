// ANSI SGR colors in command output -> styled runs per line.
// A run is {t, fg, bg, b, d, i, u}; fg/bg are 0..15 (theme ansi), "#rrggbb", or null.

const SGR = /\x1b\[([\d;:]*)m/g;
// Cursor moves, erase-line and other controls carry no text worth showing.
const OTHER_ESC = /\x1b\[[\d;?]*[A-Za-ln-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g;

const XTERM_LEVELS = [0, 95, 135, 175, 215, 255];
const hex2 = (n) => n.toString(16).padStart(2, "0");

function color256(n) {
  if (n < 16) return n;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
  }
  const k = n - 16;
  return `#${hex2(XTERM_LEVELS[Math.floor(k / 36)])}${hex2(XTERM_LEVELS[Math.floor(k / 6) % 6])}${hex2(XTERM_LEVELS[k % 6])}`;
}

const RESET = { fg: null, bg: null, b: false, d: false, i: false, u: false };

function apply(state, codes) {
  let s = { ...state };
  for (let k = 0; k < codes.length; k++) {
    const c = codes[k];
    if (c === 0) s = { ...RESET };
    else if (c === 1) s.b = true;
    else if (c === 2) s.d = true;
    else if (c === 3) s.i = true;
    else if (c === 4) s.u = true;
    else if (c === 22) s = { ...s, b: false, d: false };
    else if (c === 23) s.i = false;
    else if (c === 24) s.u = false;
    else if (c >= 30 && c <= 37) s.fg = c - 30;
    else if (c >= 90 && c <= 97) s.fg = c - 90 + 8;
    else if (c === 39) s.fg = null;
    else if (c >= 40 && c <= 47) s.bg = c - 40;
    else if (c >= 100 && c <= 107) s.bg = c - 100 + 8;
    else if (c === 49) s.bg = null;
    else if ((c === 38 || c === 48) && codes[k + 1] === 5) {
      s[c === 38 ? "fg" : "bg"] = color256(codes[k + 2] ?? 0);
      k += 2;
    } else if ((c === 38 || c === 48) && codes[k + 1] === 2) {
      s[c === 38 ? "fg" : "bg"] = `#${hex2(codes[k + 2] ?? 0)}${hex2(codes[k + 3] ?? 0)}${hex2(codes[k + 4] ?? 0)}`;
      k += 4;
    }
  }
  return s;
}

// "progress 10%\rprogress 100%" shows what the terminal finally showed.
const lastFrame = (line) => (line.includes("\r") ? line.split("\r").filter(Boolean).pop() ?? "" : line);

/** text -> lines of runs. Styles carry across lines like a terminal. */
export function ansiLines(text) {
  const clean = String(text ?? "").replace(OTHER_ESC, "");
  let state = { ...RESET };
  return clean.split("\n").map((raw) => {
    const line = lastFrame(raw);
    const runs = [];
    let last = 0;
    SGR.lastIndex = 0;
    let m;
    while ((m = SGR.exec(line))) {
      if (m.index > last) runs.push({ ...state, t: line.slice(last, m.index) });
      state = apply(state, (m[1] || "0").split(/[;:]/).map((x) => Number(x) || 0));
      last = SGR.lastIndex;
    }
    if (last < line.length) runs.push({ ...state, t: line.slice(last) });
    return runs;
  });
}

export const stripAnsi = (s) => String(s ?? "").replace(SGR, "").replace(OTHER_ESC, "");

export const hasAnsi = (s) => /\x1b\[/.test(String(s ?? ""));
