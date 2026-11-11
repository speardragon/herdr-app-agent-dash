// Texts arrive already masked (the parsers mask a whole document once): masking every word,
// every frame, costs more than a frame has.
// Draws lib/rich.js blocks in a product's own look. A `skin` carries that product's colors and
// sizes (fixed: they are the site's, not herdr's theme). Styled text wraps word by word, since
// one element has one style.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { words, runsText } from "../../lib/rich.js";
import { inkOn } from "../../lib/format.js";
import { masked } from "../../lib/tools.js";

const ICONS = "mods/agent-dash/icons";

/** Numeric font weights don't take here; the named ones do. */
export const bold = (el, weight) => (weight >= 700 ? el.font_bold() : weight >= 600 ? el.font_semibold() : weight >= 500 ? el.font_medium() : el);
export const brand = (name, size) => image(`${ICONS}/${name}.svg`).size(size).flex_none();

/** A drawing budget shared by one view: long pages stop with a note instead of stalling a frame. */
export const budget = (wordsLeft = 2600, blocksLeft = 170) => ({ words: wordsLeft, blocks: blocksLeft });

const isPlain = (runs) => runs.every((r) => !r.b && !r.i && !r.s && !r.u && !r.code && !r.href && !r.mention && !r.color);

function wordEl(run, key, skin, ctx) {
  const text = run.text.replace(/\n$/, "");
  let el = div().flex_none().child(text);
  if (run.b) el = bold(el, skin.bold ?? 600);
  if (run.i) el = el.italic();
  if (run.s) el = el.line_through();
  if (run.code) el = el.font_family(skin.mono).text_size(Math.round(skin.size * 0.86)).px(4).rounded(4).bg(skin.codeBg).text_color(skin.codeFg).when(Boolean(skin.codeBorder), (e) => e.border(1).border_color(skin.codeBorder));
  if (run.mention && skin.mentionBg) el = el.px(2).rounded(3).bg(skin.mentionBg).text_color(skin.mentionFg ?? skin.link);
  else if (run.mention) el = el.text_color(skin.mentionFg ?? skin.dim);
  if (run.href) {
    el = el.id(key).cursor_pointer().text_color(skin.link).when(skin.linkUnderline !== false, (e) => e.underline())
      .on_click((_e, cx) => ctx.openUrl(run.href, cx)).tooltip(run.href.slice(0, 120));
  } else if (run.u) el = el.underline();
  return el;
}

/** Runs as wrapping text. `opts`: {size, color, weight, lh}. */
export function runsEl(runs, id, skin, ctx, bud, opts = {}) {
  const size = opts.size ?? skin.size;
  const base = (el) => el.text_size(size).line_height((opts.lh ?? size * 1.6) / size).text_color(opts.color ?? skin.text).when(Boolean(opts.weight), (e) => e.when(true, (w) => bold(w, opts.weight)));
  if (isPlain(runs)) {
    const text = runsText(runs);
    bud.words -= Math.ceil(text.length / 40);
    return base(div().w_full().min_w(0)).child(text);
  }
  const parts = words(runs, Math.max(0, bud.words));
  bud.words -= parts.length;
  const kids = [];
  parts.forEach((run, i) => {
    if (run.text !== "\n") kids.push(wordEl(run, `${id}-${i}`, skin, ctx));
    if (run.text.endsWith("\n")) kids.push(div().w_full().h(0));
  });
  return base(h_flex().w_full().min_w(0).flex_wrap().items_baseline()).children(kids);
}

function tableEl(block, id, skin, ctx, bud) {
  const cols = Math.max(1, ...block.rows.map((r) => r.length));
  const rows = block.rows.slice(0, 40);
  return v_flex().w_full().rounded(skin.tableRadius ?? 0).border(1).border_color(skin.border).overflow_hidden().children(rows.map((row, r) =>
    h_flex().w_full().items_stretch().when(r > 0, (e) => e.border_t(1).border_color(skin.border)).when(block.header && r === 0, (e) => e.bg(skin.headBg))
      .children(Array.from({ length: cols }, (_x, c) => div().flex_1().min_w(0).px(9).py(6).when(c > 0, (e) => e.border_l(1).border_color(skin.border))
        .child(runsEl(row[c] ?? [], `${id}-${r}-${c}`, skin, ctx, bud, { size: skin.size - 1, weight: block.header && r === 0 ? skin.bold ?? 600 : undefined, lh: Math.round(skin.size * 1.45) }))))));
}

function listMark(block, skin) {
  if (block.todo) {
    return div().size(15).mt(Math.round(skin.size * 0.3)).flex_none().rounded(3).border(1.5).border_color(block.checked ? skin.link : skin.dim).when(block.checked, (e) => e.bg(skin.link))
      .flex().items_center().justify_center().text_size(10).text_color("#ffffff").child(block.checked ? "✓" : "");
  }
  return div().w(18).flex_none().text_size(skin.size).line_height(1.6).text_color(skin.text).child(block.ordered ? `${block.n ?? 1}.` : block.depth % 2 ? "◦" : "•");
}

function blockEl(block, id, skin, ctx, bud) {
  switch (block.t) {
    case "h": {
      const size = skin.h[block.level - 1] ?? skin.size;
      return div().w_full().pt(block.level === 1 ? 14 : 10).pb(2).child(runsEl(block.runs, id, skin, ctx, bud, { size, weight: skin.hWeight ?? 600, lh: Math.round(size * 1.3) }));
    }
    case "li":
      return h_flex().w_full().items_start().gap(6).pl(4 + block.depth * 20).child(listMark(block, skin))
        .child(div().flex_1().min_w(0).child(runsEl(block.runs, id, skin, ctx, bud, block.checked ? { color: skin.dim } : {})));
    case "code":
      return div().w_full().px(12).py(10).rounded(skin.codeRadius ?? 4).bg(skin.preBg ?? skin.codeBg).when(Boolean(skin.preBorder), (e) => e.border(1).border_color(skin.preBorder))
        .font_family(skin.mono).text_size(Math.round(skin.size * 0.86)).line_height(1.6).text_color(skin.preFg ?? skin.text)
        .child(block.text.split("\n").slice(0, 60).join("\n").slice(0, 4000));
    case "quote":
      return h_flex().w_full().items_stretch().gap(10).child(div().w(skin.quoteBarW ?? 3).flex_none().rounded(2).bg(skin.quoteBar ?? skin.border))
        .child(div().flex_1().min_w(0).child(runsEl(block.runs, id, skin, ctx, bud, { color: skin.quoteFg ?? skin.text })));
    case "hr":
      return div().w_full().h(1).my(6).bg(skin.border);
    case "table":
      return tableEl(block, id, skin, ctx, bud);
    case "callout":
      return h_flex().w_full().items_start().gap(10).p(14).rounded(skin.calloutRadius ?? 6).bg(skin.callout?.[block.color] ?? skin.callout?.default ?? skin.headBg)
        .when(Boolean(block.icon), (e) => e.child(div().flex_none().text_size(skin.size + 3).child(block.icon)))
        .child(v_flex().flex_1().min_w(0).gap(6).children(blocksEls(block.blocks, `${id}c`, skin, ctx, bud)));
    case "toggle":
      return h_flex().w_full().items_start().gap(6).child(div().w(14).flex_none().text_size(10).pt(5).text_color(skin.text).child("▶"))
        .child(div().flex_1().min_w(0).child(runsEl(block.runs, id, skin, ctx, bud)));
    case "embed": {
      const el = h_flex().id(id).w_full().gap(8).items_center().px(10).py(7).rounded(4).bg(skin.headBg).text_size(skin.size - 1).text_color(skin.dim).child(div().truncate().child(masked(block.label)));
      return block.href ? el.cursor_pointer().on_click((_e, cx) => ctx.openUrl(block.href, cx)) : el;
    }
    case "more":
      return div().w_full().pt(6).text_size(12).text_color(skin.dim).child("이어지는 내용은 원본에서 볼 수 있어요");
    default:
      return div().w_full().pl((block.depth ?? 0) * 20).child(runsEl(block.runs ?? [], id, skin, ctx, bud));
  }
}

/** Block elements, stopping (with a note) when the budget runs out. */
export function blocksEls(list, id, skin, ctx, bud) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (bud.blocks <= 0 || bud.words <= 0) {
      out.push(div().w_full().pt(6).text_size(12).text_color(skin.dim).child("너무 길어서 여기까지만 그렸어요 · 전체는 '원본'에서 볼 수 있어요"));
      break;
    }
    bud.blocks -= 1;
    out.push(blockEl(list[i], `${id}-${i}`, skin, ctx, bud));
  }
  return out;
}

export const richBody = (list, id, skin, ctx, bud, gap = 8) => v_flex().w_full().gap(gap).children(blocksEls(list, id, skin, ctx, bud));

const AVATAR = ["#1868DB", "#22A06B", "#8F7EE7", "#E56910", "#C9372C", "#2898BD", "#B38600", "#DA62AC"];

/** A person without a picture: their initials on a steady color. */
export function avatar(person, size, radius, hue) {
  const fill = person?.unknown ? "#8C8F97" : AVATAR[hue % AVATAR.length];
  return div().size(size).flex_none().rounded(radius).bg(fill).text_color(inkOn(fill, "#1F1F1F"))
    .text_size(Math.max(9, Math.round(size * 0.4))).when(true, (w) => bold(w, 600)).flex().items_center().justify_center().child(person?.initials ?? "?");
}

/** The white (site-colored) sheet a product view sits on, with a link out to the real page. */
export function sheet(skin, kids) {
  return v_flex().w_full().rounded(10).overflow_hidden().bg(skin.bg).border(1).border_color(skin.border).children(kids);
}

export function openLink(id, label, url, skin, ctx) {
  if (!url) return div();
  return h_flex().id(id).flex_none().gap(5).items_center().h(26).px(9).rounded(skin.buttonRadius ?? 6).border(1).border_color(skin.buttonBorder ?? skin.border).cursor_pointer()
    .text_size(12.5).text_color(skin.text).hover((s) => s.bg(skin.hover ?? skin.headBg)).on_click((_e, cx) => ctx.openUrl(url, cx)).child(`${label} ↗`);
}
