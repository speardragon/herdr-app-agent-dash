// Google Sheets MCP calls -> what the Sheets-looking views draw. Pure.

import { masked } from "./tools.js";

const suffix = (name) => String(name ?? "").split("__").pop();
const TOOLS = { get_values: "grid", update_values: "grid", append_values: "grid", update_formulas: "grid", get_spreadsheet: "book", batch_clear_values: "cleared" };

export const gsheetsTool = (name) => (/sheets/i.test(name ?? "") ? TOOLS[suffix(name)] ?? null : null);

function tryJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const MAX_ROWS = 120;
const MAX_COLS = 26;

/** "A" -> 0, "AB" -> 27. */
const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** 0 -> "A", 27 -> "AB". */
export function colName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "'1-7'!B3:E60" -> {sheet: "1-7", col: 1, row: 3, text}; a bare "Sheet1" starts at A1. */
export function parseRange(range) {
  const text = String(range ?? "").trim();
  const bang = text.lastIndexOf("!");
  const sheetPart = bang >= 0 ? text.slice(0, bang) : /^[A-Za-z]{1,3}\d*(:[A-Za-z]{1,3}\d*)?$/.test(text) ? "" : text;
  const cells = bang >= 0 ? text.slice(bang + 1) : sheetPart ? "" : text;
  const sheet = sheetPart.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
  const m = /^([A-Za-z]{1,3})(\d+)?/.exec(cells);
  return { sheet, col: m ? colIndex(m[1]) : 0, row: m?.[2] ? Number(m[2]) : 1, cells, text };
}

const cellText = (v) => (v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));

function gridOf(values, range) {
  const at = parseRange(range);
  const all = Array.isArray(values) ? values.filter(Array.isArray) : [];
  const width = Math.min(MAX_COLS, all.reduce((w, r) => Math.max(w, r.length), 0));
  const rows = all.slice(0, MAX_ROWS).map((r, i) => ({
    n: at.row + i,
    cells: Array.from({ length: width }, (_x, c) => {
      const raw = r[c];
      const text = masked(cellText(raw));
      return { text, number: typeof raw === "number" || (typeof raw === "string" && /^-?[\d,]+(\.\d+)?%?$/.test(raw.trim()) && raw.trim() !== ""), formula: typeof raw === "string" && raw.startsWith("=") };
    }),
  }));
  return { ...at, cols: Array.from({ length: width }, (_x, c) => colName(at.col + c)), rows, totalRows: all.length, totalCols: all.reduce((w, r) => Math.max(w, r.length), 0) };
}

const NOTICE = { update_values: "값을 썼어요", append_values: "행을 덧붙였어요", update_formulas: "수식을 넣었어요" };

/** {kind, ...} for a Sheets call, or null when its result can't be read as Sheets data. */
export function parseGsheets(call) {
  const kind = gsheetsTool(call.name);
  if (!kind) return null;
  const input = call.input ?? {};
  const data = tryJson(call.result?.text);
  if (call.result && !data) return null;
  const pending = !call.result;
  const id = input.spreadsheetId ?? data?.spreadsheetId ?? null;
  const url = id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
  if (kind === "grid") {
    const tool = suffix(call.name);
    const write = tool !== "get_values";
    // A read's values are in the result; a write's are what was sent (the result only counts cells).
    const values = write ? input.values ?? input.formulas : data?.values;
    const range = (write ? data?.updatedRange ?? data?.updates?.updatedRange ?? input.range : data?.range ?? input.range) ?? "";
    if (!pending && !write && !Array.isArray(values)) return { kind, grid: gridOf([], range), empty: true, write, notice: null, url, pending };
    const cells = data?.updatedCells ?? data?.updates?.updatedCells ?? null;
    return { kind, grid: gridOf(values ?? [], range), empty: false, write, notice: write ? NOTICE[tool] ?? "값을 썼어요" : null, cells, url, pending };
  }
  if (kind === "book") {
    const sheets = (data?.sheets ?? []).map((s) => ({ title: masked(s.properties?.title ?? ""), rows: s.properties?.gridProperties?.rowCount ?? null, cols: s.properties?.gridProperties?.columnCount ?? null })).filter((s) => s.title);
    if (!pending && !sheets.length && !data?.properties?.title) return null;
    return { kind, title: data?.properties?.title ? masked(data.properties.title) : null, sheets, url: data?.spreadsheetUrl ?? url, pending };
  }
  const ranges = (data?.clearedRanges ?? input.ranges ?? []).map((r) => parseRange(r).text);
  return { kind, ranges, url, pending };
}
