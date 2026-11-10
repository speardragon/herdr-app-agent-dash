// Small pieces several tool views share.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { masked } from "../../lib/tools.js";

export function kvTable(entries, t) {
  return v_flex().w_full().rounded(8).border(1).border_color(t.border).overflow_hidden().children(entries.slice(0, 40).map(([k, v], i) =>
    h_flex().w_full().px(10).py(6).gap(12).items_start().when(i > 0, (e) => e.border_t(1).border_color(t.border))
      .child(div().w(120).flex_none().text_size(11.5).text_color(t.dim).font_family(t.mono).child(k))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).font_family(t.mono)
        .child(masked(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 2000)))));
}


const MEMO = new WeakMap();

/** fn() once per (object, key): rows for a call are built on the first frame that shows it. */
export function memo(owner, key, fn) {
  let byKey = MEMO.get(owner);
  if (!byKey) {
    byKey = new Map();
    MEMO.set(owner, byKey);
  }
  if (!byKey.has(key)) byKey.set(key, fn());
  return byKey.get(key);
}
