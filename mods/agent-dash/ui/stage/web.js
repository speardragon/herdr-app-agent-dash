// Web tools drawn as a browser: the address bar with the status, what the agent asked
// of the page, and the answer; searches as a results page.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { alpha, button, chip, icon } from "../kit.js";
import { domainOf, parseUrl } from "../../lib/links.js";
import { fmtBytes, fmtDur } from "../../lib/format.js";

function addressBar(url, ctx, t, right = []) {
  const u = parseUrl(url);
  const secure = u?.scheme === "https";
  return h_flex().w_full().h(34).px(10).gap(8).items_center().rounded(9).bg(t.background).border(1).border_color(t.input)
    .child(icon(secure ? "lock" : "globe", 12, secure ? t.ansi2 : t.dim))
    .child(h_flex().flex_1().min_w(0).items_center().font_family(t.mono).text_size(12)
      .child(div().flex_none().text_color(t.foreground).font_semibold().child(u?.host ?? url))
      .child(div().min_w(0).truncate().text_color(t.dim).child(u ? `${u.path}${u.query}` : "")))
    .children(right)
    .child(button(`open-${url}`, "", (_e, cx) => ctx.openUrl(url, cx), t, { iconName: "external", quiet: true, tip: "브라우저에서 열기" }));
}

function statusChip(code, text, t) {
  const color = code >= 400 ? t.del : code >= 300 ? t.blocked : t.ansi2;
  return chip(`${code}${text ? ` ${text}` : ""}`, t, color);
}

const REDIRECT = /redirect(?:ed|s)? to[:\s]+(https?:\/\/\S+)/i;

export function renderWebFetch(call, ctx, t) {
  const input = call.input ?? {};
  const x = call.result?.extra ?? {};
  const answer = x.result ?? call.result?.text ?? "";
  const redirect = REDIRECT.exec(answer)?.[1] ?? null;
  return v_flex().w_full().gap(12)
    .child(addressBar(input.url ?? "", ctx, t, [
      x.code ? statusChip(x.code, x.codeText, t) : null,
      x.bytes ? chip(fmtBytes(x.bytes), t) : null,
      x.ms ? chip(fmtDur(x.ms / 1000), t) : null,
    ].filter(Boolean)))
    .when(Boolean(redirect), (e) => e.child(h_flex().gap(8).items_center().px(10).py(7).rounded(8).bg(alpha(t.blocked, 0.08))
      .child(icon("corner", 13, t.blocked)).child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`다른 주소로 넘어갔어요: ${redirect}`))))
    .when(Boolean(input.prompt), (e) => e.child(h_flex().gap(10).items_start()
      .child(div().size(22).flex_none().rounded(11).bg(alpha(t.accent, 0.16)).flex().items_center().justify_center().child(icon("message", 11, t.accent)))
      .child(div().flex_1().min_w(0).px(12).py(8).rounded(10).bg(t.raised).text_size(12.5).text_color(t.foreground).child(input.prompt))))
    .when(Boolean(answer), (e) => e.child(div().w_full().p(14).rounded(10).border(1).border_color(t.border).bg(t.background).text_size(13)
      .child(TextView.markdown(`fetch-${call.id}`, answer).selectable(true).on_link_click((url, cx) => ctx.openUrl(url, cx)))));
}

// Claude's results nest {content: [{title, url}]}; Codex gives {title, url, snippet} directly.
function flattenResults(results) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.url === "string" && v.title) out.push(v);
    else Object.values(v).forEach(walk);
  };
  walk(results);
  return out;
}

export function renderWebSearch(call, ctx, t) {
  const query = call.input?.query ?? "";
  const results = flattenResults(call.result?.extra?.results);
  const summary = (call.result?.extra?.results ?? []).find?.((r) => typeof r === "string") ?? "";
  return v_flex().w_full().gap(12)
    .child(h_flex().w_full().h(36).px(12).gap(10).items_center().rounded(18).bg(t.background).border(1).border_color(t.input)
      .child(icon("search", 14, t.accent)).child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(query))
      .when(results.length > 0, (e) => e.child(chip(`${results.length}개`, t))))
    .children(results.slice(0, 20).map((r, i) => v_flex().id(`sr-${call.id}-${i}`).w_full().gap(3).px(12).py(9).rounded(9).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => ctx.openUrl(r.url, cx))
      .child(h_flex().gap(6).items_center()
        .child(div().size(16).rounded(4).bg(t.raised).flex().items_center().justify_center().text_size(9).font_semibold().text_color(t.muted).child(domainOf(r.url).slice(0, 1).toUpperCase()))
        .child(div().truncate().text_size(11).text_color(t.dim).child(domainOf(r.url))))
      .child(div().text_size(13).font_semibold().text_color(t.accent).child(r.title))
      .when(Boolean(r.snippet), (e) => e.child(div().text_size(12).text_color(t.muted).child(r.snippet)))))
    .when(!results.length && Boolean(summary || call.result?.text), (e) => e.child(div().text_size(12.5).child(TextView.markdown(`ws-${call.id}`, summary || call.result.text).selectable(true))));
}
