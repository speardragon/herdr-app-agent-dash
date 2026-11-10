// The tool-call lens: a filterable list (grouped by prompt) beside the selected call's view.

import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, h_resizable, resizable_panel } from "gpui-base";
import { alpha, button, empty, icon, kindColor, mongoLeaf, programIcon, scrollArea } from "./kit.js";
import { KINDS, isMongo, kindOf, toolDigest, toolTarget, toolTitle } from "../lib/tools.js";
import { clock, firstLine, fmtInt, relTime } from "../lib/format.js";

// A row's target and digest are worked out once per call (and again when its result arrives):
// counting the lines of a 48 KB output for every visible row on every frame stalls the view.
const ROW_CACHE = new WeakMap();
function rowText(call, rel) {
  const key = call.result ? 1 : 0;
  const hit = ROW_CACHE.get(call);
  if (hit && hit.key === key) return hit;
  const value = { key, target: toolTarget(call, rel), digest: toolDigest(call), title: toolTitle(call) };
  ROW_CACHE.set(call, value);
  return value;
}

const ROW_H = 32;
// A prompt's header: a tinted band with room above it, so each turn reads as its own group.
const TURN_H = 46;

function statusMark(status, t) {
  if (status === "running") return icon("spinner", 12, t.working).spin(900);
  if (status === "pending") return div().size(14).flex_none().rounded(4).bg(alpha(t.blocked, 0.18)).text_size(10).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "error") return icon("circle-x", 13, t.del);
  if (status === "interrupted") return icon("stop", 12, t.dim);
  if (status === "unknown") return icon("circle", 12, alpha(t.dim, 0.6));
  return icon("check", 13, alpha(t.dim, 0.8));
}

function digest(call, t, d) {
  if (!d) return div();
  if (d.add != null) {
    return h_flex().flex_none().gap(4).text_size(11).font_family(t.mono)
      .child(div().text_color(t.add).child(`+${fmtInt(d.add)}`)).child(div().text_color(t.del).child(`−${fmtInt(d.del)}`));
  }
  return div().flex_none().max_w(140).truncate().text_size(11).text_color(d.tone === "err" ? t.del : t.dim).child(d.text);
}

export function callRow(item, selected, t, rel) {
  const { call, agent, status } = item;
  const kind = kindOf(call);
  const mongo = isMongo(call);
  const color = kindColor(t, kind, mongo);
  const text = rowText(call, rel);
  return h_flex().id(item.key ?? `row-${call.id}`).w_full().h(ROW_H).flex_none().gap(8).items_center().pr(10).rounded(6)
    .when(selected, (e) => e.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .child(div().w(3).h(18).flex_none().rounded(2).bg(selected ? t.accent : alpha(t.accent, 0)))
    .child(div().w(14).flex_none().flex().justify_center().child(statusMark(status, t)))
    .when(Boolean(item.showAgent), (e) => e.child(programIcon(agent.program, 15, t)))
    .child(mongo ? mongoLeaf(13) : icon(KINDS[kind]?.icon ?? "bot", 13, color))
    .child(div().flex_none().max_w(160).truncate().text_size(12.5).font_weight(600).text_color(selected ? t.foreground : t.muted).child(text.title))
    .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(t.mono).text_color(t.dim).child(text.target))
    .child(digest(call, t, text.digest))
    .child(div().w(36).flex_none().text_right().text_size(10.5).text_color(alpha(t.dim, 0.8)).child(clock(call.ts)));
}

function turnRow(item, t) {
  const p = item.prompt;
  const quiet = !p || p.kind === "notice" || p.kind === "answer";
  const tone = quiet ? t.dim : t.accent;
  const label = p ? firstLine(p.display ?? p.text) || (p.images ? `이미지 ${p.images}개` : "") : "프롬프트 전";
  return v_flex().w_full().h(TURN_H).flex_none().justify_end().pb(4)
    .child(h_flex().w_full().h(32).flex_none().gap(8).items_center().pr(10).rounded(7).overflow_hidden()
      .bg(alpha(tone, quiet ? 0.05 : 0.09))
      .child(div().w(3).h_full().flex_none().bg(alpha(tone, quiet ? 0.4 : 0.85)))
      .child(div().flex_none().px(6).h(18).rounded(5).bg(alpha(tone, 0.16)).text_size(11).font_bold().text_color(tone).flex().items_center().child(`#${item.n}`))
      .child(icon(quiet ? "info" : "message", 12, tone))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_weight(quiet ? 400 : 600).text_color(quiet ? t.dim : t.foreground).child(label))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(`호출 ${item.count}`))
      .when(Boolean(p?.ts), (e) => e.child(div().flex_none().w(52).text_right().text_size(11).text_color(alpha(t.dim, 0.85)).child(relTime(p.ts)))));
}

function kindChips(counts, active, onKind, t) {
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const chipEl = (id, label, n, color) => {
    const on = id === active;
    return h_flex().id(`kind-${id}`).flex_none().h(24).px(8).gap(6).items_center().rounded(12).cursor_pointer()
      .bg(on ? alpha(color ?? t.accent, 0.16) : t.raised).text_size(11.5).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(on ? alpha(color ?? t.accent, 0.22) : t.hover))
      .on_click((_e, cx) => onKind(on && id !== "all" ? "all" : id, cx))
      .when(Boolean(color), (e) => e.child(div().size(7).rounded(4).bg(color)))
      .child(label).child(div().text_size(10.5).text_color(t.dim).child(fmtInt(n)));
  };
  return h_flex().flex_none().gap(6).items_center().flex_wrap()
    .child(chipEl("all", "전체", all, null))
    .children(Object.entries(KINDS).filter(([k]) => counts[k]).map(([k, v]) => chipEl(k, v.label, counts[k], t.kind[k])));
}

/** ctx: {items, selectedKey, counts, kind, follow, compact, detailOpen, rel, stage, onPick, onKind, onFollow, onBack, empty} */
export function callsLens(ctx, t) {
  const { items } = ctx;
  const sizes = items.map((it) => (it.type === "turn" ? TURN_H : ROW_H));
  const list = v_flex().size_full().min_h(0)
    .child(h_flex().flex_none().px(12).py(10).gap(8).items_center()
      .child(div().flex_1().min_w(0).child(kindChips(ctx.counts, ctx.kind, ctx.onKind, t)))
      .child(button("follow", ctx.follow ? "따라가는 중" : "따라가기", ctx.onFollow, t, { iconName: ctx.follow ? "zap" : "arrow-down", quiet: !ctx.follow, tip: "새 호출이 들어오면 자동으로 골라요 (f)" })))
    .child(items.length
      ? div().flex_1().min_h(0).relative().px(6)
        .child(v_virtual_list("call-list", items.length, sizes, (i) => items[i].key, (range) =>
          items.slice(range.start, range.end).map((it) => (it.type === "turn" ? turnRow(it, t) : callRow(it, it.key === ctx.selectedKey, t, ctx.rel))))
          .track_scroll(ctx.scrollHandle).on_item_click((key, cx) => ctx.onPick(key, cx)).size_full())
        .child(Scrollbar.vertical("call-list").absolute().inset_0())
      : empty(ctx.empty?.title ?? "도구 호출이 없어요", ctx.empty?.body ?? null, t, "terminal"));
  const detail = ctx.stage
    ? scrollArea("stage-scroll", v_flex().p(18).gap(12).child(ctx.compact ? button("stage-back", "목록", ctx.onBack, t, { iconName: "arrow-left", quiet: true }) : div()).child(ctx.stage))
    : empty("호출을 고르세요", "왼쪽 목록에서 고르면 도구마다 맞는 모양으로 보여요. j/k로 움직여요.", t, "terminal");
  if (ctx.compact) return ctx.detailOpen && ctx.stage ? v_flex().size_full().min_h(0).child(detail) : list;
  return h_resizable("calls-split").size_full()
    .child(resizable_panel().size(420).size_range(280, 720).child(div().size_full().border_r(1).border_color(t.border).child(list)))
    .child(resizable_panel().child(v_flex().size_full().min_w(0).child(detail)));
}
