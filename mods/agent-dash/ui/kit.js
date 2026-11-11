// Shared look: theme tokens (herdr's names plus derived roles), icons, status glyphs,
// chips, buttons and scroll areas. Every view draws with these.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { theme, settings } from "herdr";

const ICONS = "mods/agent-dash/icons";

/** "#rgb" | "#rrggbb" | "#rrggbbaa" + opacity 0..1 -> "#rrggbbaa". */
export function alpha(color, a) {
  let hex = String(color ?? "#000000").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const base = hex.slice(0, 6);
  const prior = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  const value = Math.round(Math.max(0, Math.min(1, a * prior)) * 255);
  return `#${base}${value.toString(16).padStart(2, "0")}`;
}

/** Theme colors by herdr's names, plus the roles this mod adds. Recomputed per render. */
export function tokens() {
  const t = theme();
  const s = settings();
  const dark = s.dark !== false;
  return {
    ...t,
    dark,
    mono: s.font_family ?? "JetBrains Mono",
    kind: { explore: t.ansi4, edit: t.ansi5, shell: t.ansi2, web: t.ansi6, mcp: "#e2a5c6", agent: t.ansi7 },
    mongo: "#00ed64",
    add: dark ? "#57ab5a" : "#2da44e",
    del: dark ? "#e5534b" : "#cf222e",
    bson: dark
      ? { oid: "#ff6f44", str: "#35de7b", num: "#2dc4ff", bool: "#ff7dc3", nil: "#889397", key: t.foreground, punct: t.dim }
      : { oid: "#c4410e", str: "#00684a", num: "#016bf8", bool: "#c4006e", nil: "#5c6c75", key: t.foreground, punct: t.dim },
    syn: {
      kw: t.ansi5, str: t.ansi2, num: t.ansi3, fn: t.ansi4, type: t.ansi6, com: t.ansi8, prop: t.ansi1, key: t.ansi12,
      tag: t.ansi1, attr: t.ansi3, op: t.ansi6, pun: t.dim, var: t.ansi14, flag: t.ansi12, cmd: t.foreground,
      head: t.ansi4, bold: t.foreground, code: t.ansi11, link: t.ansi12, dim: t.dim, esc: t.ansi11, quant: t.ansi3,
      group: t.ansi13, class: t.ansi6, anchor: t.ansi1,
    },
  };
}

export const kindColor = (t, kind, mongo = false) => (mongo ? t.mongo : t.kind[kind] ?? t.muted);

export const icon = (name, size, color) => {
  const el = svg(`${ICONS}/${name}.svg`).size(size).flex_none();
  return color ? el.text_color(color) : el;
};

export const mongoLeaf = (size) => image(`${ICONS}/mongo-leaf.svg`).size(size).flex_none();

/** A program's mark from herdr's table (Claude, Codex, ...). */
export function programIcon(program, size, t) {
  if (program?.icon) {
    const glyph = program.tint ? svg(program.icon).size(Math.round(size * 0.72)).text_color(program.color ?? t.foreground) : image(program.icon).size(size);
    if (!program.tint) return glyph.flex_none();
    return div().size(size).flex_none().rounded(Math.round(size / 4)).bg(program.tile ?? t.raised).flex().items_center().justify_center().child(glyph);
  }
  const letter = String(program?.name ?? "?").slice(0, 1).toUpperCase();
  return div().size(size).flex_none().rounded(Math.round(size / 4)).bg(t.raised).text_color(t.muted).text_size(Math.round(size * 0.5)).font_semibold().flex().items_center().justify_center().child(letter);
}

/** herdr's status vocabulary: spinner, "Needs you" badge, dot, ring. */
export function statusGlyph(status, t, compact = false) {
  if (status === "working") return icon("spinner", 12, t.working).mx(1).spin(900);
  if (status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(alpha(t.blocked, 0.16)).text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(alpha(t.blocked, 0.16)).text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("응답 필요");
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  if (status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
  return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.dim);
}

export const STATUS_LABEL = { blocked: "응답 필요", done: "완료", working: "작업 중", idle: "대기", running: "실행 중", ended: "끝남" };

/** A sub-agent's mark: herdr's glyphs, plus a plain program running and one that exited. */
export function subGlyph(node, t) {
  if (node.status === "ended") return node.exit ? icon("circle-x", 12, alpha(t.del, 0.8)) : icon("check", 12, alpha(t.dim, 0.9));
  if (node.status === "running") return icon("play", 10, alpha(t.dim, 0.9)).mx(1);
  return statusGlyph(node.status, t, true);
}

/** Tree lines in front of a nested row (└ ├ │ or a gap), as the stock agents list draws them. */
export const treeLines = (lines, t, height) =>
  lines.map((l) => div().self_start().mt(-4).w(9).h(Math.round(height / 2) + 4).mr(4).flex_none()
    .when(Boolean(l), (e) => e.border_l(1.5).border_color(t.input))
    .when(l === "│" || l === "├", (e) => e.h(height + 4))
    .when(l === "└" || l === "├", (e) => e.border_b(1.5).rounded_bl(6)));

export const statusColor = (status, t) => (status === "idle" || status === "ended" || status === "running" ? t.dim : t[status] ?? t.dim);
export const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export const pill = (text, color, t) =>
  div().flex_none().px(7).h(20).rounded(6).bg(alpha(color, 0.14)).text_color(color).text_size(11).font_semibold().flex().items_center().whitespace_nowrap().child(text);

export const chip = (text, t, color = null) =>
  div().flex_none().px(6).h(18).rounded(5).border(1).border_color(t.border).text_size(10.5).text_color(color ?? t.muted).flex().items_center().whitespace_nowrap().child(text);

export const kbd = (text, t) =>
  div().flex_none().min_w(18).h(18).px(4).rounded(4).border(1).border_color(t.input).bg(t.raised).text_size(10.5).text_color(t.muted).font_family(tokensMono()).flex().items_center().justify_center().child(text);

const tokensMono = () => settings().font_family ?? "JetBrains Mono";

/** A small action button. `on` gets (event, cx). */
export function button(id, label, on, t, { iconName = null, primary = false, quiet = false, tip = null } = {}) {
  let el = h_flex().id(id).flex_none().h(26).px(label ? 9 : 6).gap(6).items_center().rounded(7).cursor_pointer().text_size(12)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .bg(primary ? t.solid : quiet ? alpha(t.foreground, 0) : t.raised)
    .hover((s) => s.bg(primary ? alpha(t.solid, 0.85) : t.hover))
    .on_click((e, cx) => on(e, cx));
  if (!quiet) el = el.border(1).border_color(primary ? t.solid : t.border);
  if (iconName) el = el.child(icon(iconName, 13, primary ? t.solid_foreground : t.muted));
  if (label) el = el.child(label);
  return tip ? el.tooltip(tip) : el;
}

/** Segmented control: [{id, label}] with one selected. */
export function segmented(id, options, selected, on, t) {
  return h_flex().flex_none().h(24).p(2).gap(2).rounded(7).bg(t.raised).children(
    options.map((o) =>
      h_flex().id(`${id}-${o.id}`).h_full().px(8).gap(5).items_center().rounded(5).cursor_pointer().text_size(11.5)
        .text_color(o.id === selected ? t.foreground : t.muted)
        .when(o.id === selected, (e) => e.bg(t.selected))
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => on(o.id, cx))
        .when(Boolean(o.icon), (e) => e.child(icon(o.icon, 12, o.color === "mine" ? t.working : o.id === selected ? t.foreground : t.dim)))
        .child(o.label)),
  );
}

export const sectionTitle = (text, t, right = null) =>
  h_flex().w_full().items_center().gap(8).mb(8)
    .child(div().text_size(11).font_semibold().text_color(t.dim).child(text))
    .child(div().flex_1().h(1).bg(t.border))
    .when(Boolean(right), (e) => e.child(right));

export const card = (t) => v_flex().rounded(10).border(1).border_color(t.border).bg(t.surface ?? t.background);

export const empty = (title, body, t, iconName = "info") =>
  v_flex().size_full().items_center().justify_center().gap(8).p(24)
    .child(icon(iconName, 22, t.dim))
    .child(div().text_size(13).font_semibold().text_color(t.muted).child(title))
    .when(Boolean(body), (e) => e.child(div().max_w(360).text_size(12).text_color(t.dim).text_center().child(body)));

/** A vertical scroll region filling its parent; `inner` is the scrolled column. */
export const scrollArea = (id, inner) =>
  div().flex_1().min_h(0).relative()
    .child(inner.id(id).absolute().inset_0().overflow_y_scroll())
    .child(Scrollbar.vertical(id).absolute().inset_0());

/** A region that scrolls sideways, with its bar shown. It owns both axes on purpose: an area
 *  that only scrolls sideways turns an up/down wheel into sideways movement, so the page
 *  drifts diagonally while it scrolls. Its height is its content's, so up/down passes through. */
export const xScroll = (id, inner, pad = 10) =>
  div().relative().w_full()
    .child(div().id(id).w_full().overflow_scroll().pb(pad).child(inner))
    .child(Scrollbar.horizontal(id).absolute().inset_0());

export const mono = (t, size = 12) => div().font_family(t.mono).text_size(size);

export const divider = (t) => div().w_full().h(1).flex_none().bg(t.border);

/** A thin horizontal bar of colored parts: [{value, color}]. */
export function stackBar(parts, t, height = 6) {
  const total = parts.reduce((n, p) => n + (p.value || 0), 0) || 1;
  return h_flex().w_full().h(height).rounded(height / 2).overflow_hidden().bg(t.raised).children(
    parts.filter((p) => p.value > 0).map((p) => div().h_full().flex_basis(`${(p.value / total) * 100}%`).flex_none().bg(p.color)),
  );
}
