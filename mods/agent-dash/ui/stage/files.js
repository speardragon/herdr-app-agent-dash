// File tools: Read (range on a minimap of the whole file), Edit/MultiEdit (diff with
// word-level marks), Write (new file or patch), Codex patches and image views.

import { div, image } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { alpha, button, chip, icon, segmented } from "../kit.js";
import { codeView, diffView, splitView } from "../code.js";
import { diffRows, foldRows, patchFiles, patchRows, rowStats, splitPairs, unifiedRows } from "../../lib/diff.js";
import { fmtBytes, fmtInt } from "../../lib/format.js";
import { baseName, langOf } from "../../lib/paths.js";
import { memo } from "./common.js";

const statText = (s, t) => h_flex().gap(6).text_size(12).font_family(t.mono)
  .child(div().text_color(t.add).child(`+${fmtInt(s.add)}`))
  .child(div().text_color(t.del).child(`−${fmtInt(s.del)}`));

function pathBar(path, ctx, t, right = []) {
  return h_flex().w_full().gap(8).items_center()
    .child(icon("file-text", 13, t.muted))
    .child(div().flex_1().min_w(0).truncate().font_family(t.mono).text_size(12).text_color(t.foreground).child(ctx.rel(path)))
    .children(right);
}

/** Where this read sits in the file, and what earlier reads covered. */
function rangeBar(call, ctx, t) {
  const f = call.result?.extra?.file;
  if (!f?.totalLines) return null;
  const total = f.totalLines;
  const from = f.startLine ?? 1;
  const to = from + (f.numLines ?? 0) - 1;
  const earlier = (ctx.session?.calls ?? []).filter((c) => c.name === "Read" && c.seq < call.seq && c.result?.extra?.file?.filePath === f.filePath)
    .map((c) => c.result.extra.file).filter((x) => x.numLines);
  const seg = (a, b, color) => div().absolute().top(0).bottom(0).left(`${((a - 1) / total) * 100}%`).w(`${Math.max(0.6, ((b - a + 1) / total) * 100)}%`).bg(color).rounded(2);
  const whole = from <= 1 && to >= total;
  return v_flex().w_full().gap(5)
    .child(div().w_full().h(8).rounded(4).bg(t.raised).relative()
      .children(earlier.map((x) => seg(x.startLine ?? 1, (x.startLine ?? 1) + x.numLines - 1, alpha(t.accent, 0.22))))
      .child(seg(from, Math.max(from, to), t.accent)))
    .child(h_flex().gap(8).text_size(11).text_color(t.dim)
      .child(div().child(whole ? `전체 ${fmtInt(total)}줄을 읽었어요` : `${fmtInt(total)}줄 중 ${fmtInt(from)}–${fmtInt(to)}줄`))
      .when(earlier.length > 0, (e) => e.child(div().child(`· 이전에 ${earlier.length}번 읽음`))));
}

export function renderRead(call, ctx, t) {
  const x = call.result?.extra ?? {};
  const path = call.input?.file_path ?? x.file?.filePath ?? "";
  if (x.type === "image") return imageBlock(path, x, ctx, t);
  if (!x.file) return v_flex().gap(10).child(pathBar(path, ctx, t)).child(resultNote(call, ctx, t));
  const lang = langOf(path);
  const isDoc = lang === "md";
  const view = ctx.ui(`read:${call.id}`, isDoc ? "doc" : "code");
  return v_flex().w_full().gap(10)
    .child(pathBar(path, ctx, t, [isDoc ? segmented(`read-${call.id}`, [{ id: "doc", label: "문서" }, { id: "code", label: "원문" }], view, (v, cx) => ctx.setUi(`read:${call.id}`, v, cx), t) : null].filter(Boolean)))
    .child(rangeBar(call, ctx, t) ?? div())
    .child(view === "doc"
      ? div().w_full().p(14).rounded(8).border(1).border_color(t.border).bg(t.background).text_size(13).child(TextView.markdown(`md-${call.id}`, x.file.content ?? "").selectable(true))
      : codeView(x.file.content ?? "", lang, t, { id: `read-${call.id}`, start: x.file.startLine ?? 1 }));
}

function imageBlock(path, x, ctx, t) {
  const dims = x.dims ? `${x.dims.originalWidth ?? x.dims.width ?? "?"}×${x.dims.originalHeight ?? x.dims.height ?? "?"}` : null;
  const copy = ctx.request ? ctx.request(`img:${path}`, (reader) => reader.cachedImage(path)) : null;
  const frame = div().w_full().min_h(80).p(12).rounded(8).border(1).border_color(t.border).bg(t.raised).flex().items_center().justify_center();
  let body;
  if (!copy || copy.state === "loading") body = frame.child(icon("spinner", 14, t.dim).spin(900));
  else if (copy.state === "error" || !copy.value) body = frame.child(h_flex().gap(8).items_center().text_size(12).text_color(t.dim).child(icon("image", 14, t.dim)).child(copy.state === "error" ? `이미지를 열지 못했어요: ${copy.error}` : "이미지 파일이 지금은 없어요 (임시 파일이었을 수 있어요)"));
  else body = frame.child(image(copy.value).max_w_full().max_h(460));
  return v_flex().w_full().gap(10)
    .child(pathBar(path, ctx, t, [chip([x.media, dims, x.size ? fmtBytes(x.size) : null].filter(Boolean).join(" · ") || "이미지", t)]))
    .child(body);
}

export function renderImageView(call, ctx, t) {
  return imageBlock(call.input?.path ?? "", {}, ctx, t);
}

function resultNote(call, ctx, t) {
  if (!call.result) return div().text_size(12).text_color(t.dim).child(ctx.status === "pending" ? "승인을 기다리고 있어요" : "결과가 아직 없어요");
  const text = call.result.text || "";
  return div().text_size(12).text_color(call.result.err ? t.del : t.muted).child(text.slice(0, 1200));
}

function diffBlock(rows, ctx, t, key, lang) {
  const mode = ctx.ui("diff:mode", "unified");
  const items = memo(rows, "fold", () => foldRows(rows, 3, new Set()));
  return mode === "split" ? splitView(splitPairs(items), t, { id: `split-${key}`, lang }) : diffView(items, t, { id: `diff-${key}`, lang });
}

const modeSwitch = (ctx, t, key) => segmented(`mode-${key}`, [{ id: "unified", label: "한 줄", icon: "rows" }, { id: "split", label: "나란히", icon: "columns" }], ctx.ui("diff:mode", "unified"), (v, cx) => ctx.setUi("diff:mode", v, cx), t);

export function renderEdit(call, ctx, t) {
  const input = call.input ?? {};
  const path = input.file_path ?? "";
  const lang = langOf(path);
  const patch = call.result?.extra?.patch;
  const rows = memo(call, "rows", () => (Array.isArray(patch) && patch.length
    ? patchRows(patch, lang)
    : (input.edits ?? [input]).flatMap((e, i) => [...(i ? [{ t: "hunk", text: `편집 ${i + 1}` }] : []), ...diffRows(e.old_string ?? "", e.new_string ?? "", lang)])));
  const stats = rowStats(rows);
  const flags = [
    input.replace_all ? chip("모두 바꾸기", t) : null,
    call.result?.extra?.userModified ? chip("사용자가 고침", t, t.blocked) : null,
    (input.edits?.length ?? 0) > 1 ? chip(`편집 ${input.edits.length}개`, t) : null,
  ].filter(Boolean);
  return v_flex().w_full().gap(10)
    .child(pathBar(path, ctx, t, [...flags, statText(stats, t), modeSwitch(ctx, t, call.id), button(`open-file-${call.id}`, "누적 변경", (_e, cx) => ctx.openFile(path, cx), t, { iconName: "diff", tip: "이 파일의 처음부터 지금까지 변경을 봐요" })]))
    .when(call.result?.err === true, (e) => e.child(resultNote(call, ctx, t)))
    .child(diffBlock(rows, ctx, t, call.id, lang));
}

export function renderWrite(call, ctx, t) {
  const input = call.input ?? {};
  const path = input.file_path ?? "";
  const lang = langOf(path);
  const patch = call.result?.extra?.patch;
  const created = call.result?.extra?.type === "create" || !Array.isArray(patch) || !patch.length;
  const rows = memo(call, "rows", () => (created ? diffRows("", input.content ?? "", lang) : patchRows(patch, lang)));
  return v_flex().w_full().gap(10)
    .child(pathBar(path, ctx, t, [chip(created ? "새 파일" : "덮어씀", t, created ? t.add : t.blocked), statText(rowStats(rows), t)]))
    .when(call.result?.err === true, (e) => e.child(resultNote(call, ctx, t)))
    .child(created ? diffView(rows, t, { id: `write-${call.id}`, lang }) : diffBlock(rows, ctx, t, call.id, lang));
}

const OP = { add: ["A", "새 파일"], update: ["M", "수정"], delete: ["D", "삭제"] };

export function renderPatch(call, ctx, t) {
  const changes = call.input?.changes;
  const files = memo(call, "files", () => (changes
    ? Object.entries(changes).map(([path, c]) => ({ path, op: c.type ?? "update", rows: unifiedRows(c.diff ?? "", langOf(path)) }))
    : patchFiles(call.input?.patch ?? "").map((f) => ({ path: f.path, op: f.op, rows: codexHunks(f.lines) }))));
  return v_flex().w_full().gap(14)
    .when(call.result?.err === true, (e) => e.child(resultNote(call, ctx, t)))
    .children(files.map((f, i) => {
      const [letter, label] = OP[f.op] ?? ["M", f.op];
      const color = letter === "A" ? t.add : letter === "D" ? t.del : t.blocked;
      return v_flex().w_full().gap(8)
        .child(pathBar(f.path, ctx, t, [chip(`${letter} · ${label}`, t, color), statText(rowStats(f.rows), t)]))
        .child(f.rows.length ? diffView(foldRows(f.rows), t, { id: `patch-${call.id}-${i}`, lang: langOf(f.path) }) : div().text_size(12).text_color(t.dim).child(`${baseName(f.path)}: 줄 변경이 없어요`));
    }));
}

// Codex's own patch language has "@@ context" headers without line numbers.
function codexHunks(lines) {
  const rows = [];
  for (const line of lines) {
    if (line.startsWith("@@")) rows.push({ t: "hunk", text: line });
    else if (line[0] === "+") rows.push({ t: "add", a: null, b: null, text: line.slice(1) });
    else if (line[0] === "-") rows.push({ t: "del", a: null, b: null, text: line.slice(1) });
    else if (line.trim()) rows.push({ t: "eq", a: null, b: null, text: line.slice(1) });
  }
  return rows;
}
