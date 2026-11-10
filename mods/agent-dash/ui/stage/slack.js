// Slack calls drawn like Slack (light theme): a thread, a channel's messages, search results,
// a sent message. The MCP gives no pictures, so people get initials.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { memo } from "./common.js";
import { parseSlack } from "../../lib/slack.js";
import { blocks, hueOf } from "../../lib/rich.js";
import { masked } from "../../lib/tools.js";
import { avatar, bold, brand, budget, openLink, richBody, sheet } from "./rich.js";

export const SLACK = {
  bg: "#FFFFFF", text: "#1D1C1D", dim: "#616061", link: "#1264A3", linkUnderline: false, border: "#DDDDDD", headBg: "#F8F8F8", hover: "#F8F8F8",
  codeBg: "#F4F4F4", codeFg: "#C01343", codeBorder: "#DDDDDD", preBg: "#F8F8F8", preBorder: "#DDDDDD", quoteBar: "#DDDDDD", quoteBarW: 4,
  size: 15, h: [18, 16, 15], hWeight: 700, bold: 700, mono: "JetBrains Mono", mentionBg: "#E8F5FA", mentionFg: "#1264A3", buttonRadius: 8, callout: { default: "#F8F8F8" },
};

function messageRow(m, id, ctx, bud, opts = {}) {
  const body = richBody(opts.parsed ?? blocks(m.text, 90), id, SLACK, ctx, bud, 4);
  return h_flex().w_full().gap(8).items_start().px(20).py(8)
    .child(avatar(m.author, 36, 8, hueOf(m.author.name)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(8).items_baseline().min_w(0)
        .child(div().flex_none().text_size(15).when(true, (w) => bold(w, 900)).text_color(SLACK.text).child(m.sent ? "보낸 메시지" : masked(m.author.name)))
        .when(Boolean(m.bot), (e) => e.child(div().flex_none().px(3).h(15).rounded(2).bg("#EBEBEB").text_size(10).when(true, (w) => bold(w, 700)).text_color(SLACK.dim).flex().items_center().child("앱")))
        .when(Boolean(m.time), (e) => e.child(div().flex_none().text_size(12).text_color(SLACK.dim).child(m.time ?? ""))))
      .child(body)
      .when(!m.text && !m.files, (e) => e.child(div().text_size(13).text_color(SLACK.dim).child("본문 글자가 없는 메시지예요 (버튼·카드만 있는 앱 메시지)")))
      .when(Boolean(m.around), (e) => e.child(div().text_size(12).text_color(SLACK.dim).child(`앞뒤 메시지 ${m.around}개는 '원본'에 있어요`)))
      .when(Boolean(m.cut), (e) => e.child(div().text_size(12).text_color(SLACK.dim).child("검색 결과라 여기까지만 왔어요")))
      .when(Boolean(m.files), (e) => e.child(div().text_size(13).text_color(SLACK.dim).child(`📎 ${masked(m.files ?? "")}`)))
      .when(Boolean(m.reactions?.length), (e) => e.child(h_flex().gap(4).pt(4).flex_wrap().children((m.reactions ?? []).map((r) =>
        h_flex().gap(4).items_center().h(24).px(7).rounded(12).bg("#EFEFEF").text_size(12).text_color(SLACK.text).child(r.name).child(String(r.count))))))
      .when(Boolean(m.replies) && !opts.thread, (e) => e.child(h_flex().gap(6).pt(4).text_size(13).when(true, (w) => bold(w, 700)).text_color(SLACK.link).child(`답글 ${m.replies}개`)))
      .when(Boolean(m.link), (e) => e.child(h_flex().pt(6).child(openLink(`${id}-open`, "Slack에서 열기", m.link, SLACK, ctx)))));
}

const header = (title, sub) => h_flex().w_full().h(50).px(20).gap(10).items_center().border_b(1).border_color(SLACK.border)
  .child(brand("brand-slack", 20)).child(div().flex_none().text_size(18).when(true, (w) => bold(w, 900)).text_color(SLACK.text).child(title))
  .when(Boolean(sub), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(13).text_color(SLACK.dim).child(sub ?? "")));

const empty = (text) => div().px(20).py(18).text_size(15).text_color(SLACK.dim).child(text);

const shownOf = (view) => view.messages.slice(0, view.kind === "search" ? 30 : 60);

/** Parsed off the render pass (see prepareJira): messages with their Markdown as blocks. */
export function prepareSlack(call) {
  const view = parseSlack(call);
  if (!view) return null;
  return { ...view, parsed: shownOf(view).map((m) => blocks(m.text, view.kind === "search" ? 16 : 90)) };
}

export const renderSlack = (call, ctx) => drawSlack(memo(call, `slack:${Boolean(call.result)}`, () => prepareSlack(call)), call, ctx);

/** The Slack-looking view of a prepared call, or null (the generic view draws it). */
export function drawSlack(view, call, ctx) {
  if (!view) return null;
  const search = view.kind === "search";
  const bud = budget(search ? 1500 : 2400, 220);
  const id = `slack-${call.id}`;
  const list = shownOf(view);
  const { parsed } = view;
  const row = (m, i, opts = {}) => messageRow(m, `${id}-${i}`, ctx, bud, { ...opts, parsed: parsed[i] });
  if (view.kind === "search") {
    return sheet(SLACK, [
      header("검색", null),
      h_flex().w_full().px(20).pt(12).child(h_flex().w_full().h(36).px(12).gap(8).items_center().rounded(8).border(1).border_color("#BBBABB")
        .child(div().text_size(13).text_color(SLACK.dim).child("🔍")).child(div().flex_1().min_w(0).truncate().text_size(15).text_color(SLACK.text).child(masked(view.query)))),
      view.pending ? empty("검색 결과를 기다리고 있어요") : div().px(20).pt(12).pb(4).text_size(13).when(true, (w) => bold(w, 700)).text_color(SLACK.dim).child(`메시지 ${view.messages.length}개`),
      v_flex().w_full().px(20).pb(18).gap(10).children(list.map((m, i) => v_flex().w_full().rounded(12).border(1).border_color(SLACK.border)
        .child(div().px(20).pt(10).text_size(13).when(true, (w) => bold(w, 700)).text_color(SLACK.dim).child(masked(m.channel ?? "")))
        .child(row(m, i)))),
    ]);
  }
  if (view.kind === "sent") {
    return sheet(SLACK, [
      header(view.failed ? "보내지 못했어요" : view.pending ? "보내는 중" : "메시지를 보냈어요", view.threadTs ? `${view.channel} · 스레드에 답글` : view.channel),
      v_flex().w_full().py(8).children(list.map((m, i) => row(m, i))),
    ]);
  }
  if (view.pending) return sheet(SLACK, [header(view.kind === "thread" ? "스레드" : "채널", null), empty("메시지를 기다리고 있어요")]);
  if (view.kind === "thread") {
    const [root, ...replies] = list;
    return sheet(SLACK, [
      header("스레드", view.channel || view.channelId),
      v_flex().w_full().py(8)
        .child(row(root, 0, { thread: true }))
        .when(replies.length > 0, (e) => e.child(h_flex().w_full().px(20).py(6).gap(10).items_center().child(div().flex_none().text_size(13).text_color(SLACK.dim).child(`답글 ${view.messages.length - 1}개`)).child(div().flex_1().h(1).bg(SLACK.border))))
        .children(replies.map((m, i) => row(m, i + 1, { thread: true }))),
    ]);
  }
  return sheet(SLACK, [
    header(view.channel || "채널", view.channelId && view.channel ? view.channelId : null),
    v_flex().w_full().py(8).children(list.map((m, i) => row(m, i))),
  ]);
}
