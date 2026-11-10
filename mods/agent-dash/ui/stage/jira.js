// Jira calls drawn like Jira (light theme): an issue page, a work-item list, a comment,
// the available transitions. Colors and sizes are Jira's own, read from the live site.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { memo } from "./common.js";
import { parseJira } from "../../lib/jira.js";
import { blocks, hueOf } from "../../lib/rich.js";
import { masked } from "../../lib/tools.js";
import { avatar, bold, brand, budget, openLink, richBody, sheet } from "./rich.js";

const ICONS = "mods/agent-dash/icons";
export const JIRA = {
  bg: "#FFFFFF", text: "#292A2E", dim: "#505258", subtle: "#6B6E76", link: "#1868DB", border: "#DDDEE1", headBg: "#F8F8F8", hover: "#F0F1F2",
  codeBg: "#F0F1F2", codeFg: "#292A2E", preBg: "#F8F8F8", preBorder: "#DDDEE1", quoteBar: "#DDDEE1", size: 14, h: [20, 16, 14], hWeight: 600, bold: 600,
  mono: "JetBrains Mono", tableRadius: 4, buttonRadius: 4, mentionBg: "#E9F2FE", mentionFg: "#1558BC",
  callout: { default: "#E9F2FE" },
};
const LOZENGE = {
  todo: { bg: "#F0F1F2", border: "#B7B9BE", fg: "#292A2E" },
  progress: { bg: "#CFE1FD", border: "#8FB8F6", fg: "#123263" },
  done: { bg: "#D3F1A7", border: "#B3DF72", fg: "#37471F" },
};
const PRIORITY = { Highest: "#C9372C", High: "#E2483D", Medium: "#E56910", Low: "#1868DB", Lowest: "#1558BC" };

const typeIcon = (type, size = 16) => image(`${ICONS}/jira-${type?.kind ?? "task"}.svg`).size(size).flex_none();

const lozenge = (status, button = false) => {
  const c = LOZENGE[status.cat] ?? LOZENGE.todo;
  return h_flex().flex_none().gap(4).items_center().h(button ? 32 : 20).px(button ? 12 : 5).rounded(button ? 6 : 3).bg(c.bg).border(1).border_color(c.border)
    .text_size(button ? 14 : 12).when(true, (w) => bold(w, button ? 500 : 600)).text_color(c.fg).child(masked(status.name)).when(button, (e) => e.child(div().text_size(10).child("▾")));
};

const who = (p, size = 24) => h_flex().gap(8).items_center().min_w(0).child(avatar(p, size, size / 2, hueOf(p.name))).child(div().truncate().text_size(14).text_color(JIRA.text).child(p.name));

function keyLink(key, url, ctx, id) {
  const el = div().id(id).flex_none().text_size(14).text_color(JIRA.link).underline().child(key);
  return url ? el.cursor_pointer().on_click((_e, cx) => ctx.openUrl(url, cx)) : el;
}

const siteOf = (issue) => (issue.url ? /^(https?:\/\/[^/]+)/.exec(issue.url)?.[1] ?? null : null);

function crumbs(issue, ctx, id) {
  const site = siteOf(issue);
  const sep = () => div().flex_none().text_color(JIRA.subtle).child("/");
  const items = [div().flex_none().text_color(JIRA.dim).child("스페이스")];
  if (issue.project) items.push(sep(), div().flex_none().text_color(JIRA.dim).child(masked(issue.project.name)));
  if (issue.parent) items.push(sep(), h_flex().flex_none().gap(5).items_center().child(typeIcon(issue.parent.type ?? { kind: "story" }, 14)).child(keyLink(issue.parent.key, site ? `${site}/browse/${issue.parent.key}` : null, ctx, `${id}-parent`).text_color(JIRA.dim)));
  items.push(sep(), h_flex().flex_none().gap(5).items_center().child(typeIcon(issue.type, 14)).child(div().text_color(JIRA.dim).child(issue.key)));
  return h_flex().w_full().gap(7).items_center().text_size(14).children(items);
}

function field(label, value) {
  return h_flex().w_full().min_h(40).items_center().gap(10).child(div().w(120).flex_none().text_size(14).when(true, (w) => bold(w, 500)).text_color(JIRA.text).child(label)).child(div().flex_1().min_w(0).child(value));
}

function details(issue, ctx, id) {
  const site = siteOf(issue);
  const rows = [];
  if (issue.assignee) rows.push(field("담당자", who(issue.assignee)));
  if (issue.reporter) rows.push(field("보고자", who(issue.reporter)));
  if (issue.parent) {
    rows.push(field("상위 항목", h_flex().gap(6).items_center().min_w(0).child(typeIcon(issue.parent.type ?? { kind: "story" }))
      .child(h_flex().id(`${id}-pf`).min_w(0).gap(5).items_center().h(22).px(6).rounded(3).border(1).border_color("#D8A0F7").bg("#F8EEFE").text_size(13).text_color("#48245D")
        .when(Boolean(site), (e) => e.cursor_pointer().on_click((_e, cx) => ctx.openUrl(`${site}/browse/${issue.parent.key}`, cx)))
        .child(div().flex_none().child(issue.parent.key)).child(div().truncate().child(masked(issue.parent.summary))))));
  }
  if (issue.due) rows.push(field("기한", h_flex().child(div().h(24).px(6).rounded(3).border(1).border_color(JIRA.border).text_size(14).text_color(JIRA.text).flex().items_center().child(issue.due))));
  if (issue.priority) rows.push(field("우선 순위", h_flex().gap(8).items_center().child(div().text_size(13).when(true, (w) => bold(w, 700)).text_color(PRIORITY[issue.priority] ?? JIRA.dim).child("=")).child(div().text_size(14).text_color(JIRA.text).child(masked(issue.priority)))));
  if (issue.labels.length) rows.push(field("레이블", h_flex().gap(6).flex_wrap().children(issue.labels.slice(0, 12).map((l) => div().px(5).h(20).rounded(3).bg("#F0F1F2").text_size(12).text_color(JIRA.text).flex().items_center().child(masked(l))))));
  if (issue.updated) rows.push(field("업데이트", div().text_size(14).text_color(JIRA.dim).child(String(issue.updated).slice(0, 16).replace("T", " "))));
  if (!rows.length) return null;
  return v_flex().w_full().rounded(8).border(1).border_color(JIRA.border)
    .child(div().px(16).pt(12).pb(4).text_size(15).when(true, (w) => bold(w, 600)).text_color(JIRA.text).child("세부 사항"))
    .child(v_flex().w_full().px(16).pb(8).children(rows));
}

const NOTICE = { create: "새 업무 항목을 만들었어요", edit: "업무 항목을 고쳤어요", transition: "상태를 바꿨어요" };

function comment(c, id, ctx, bud) {
  return h_flex().w_full().gap(10).items_start()
    .child(c.author ? avatar(c.author, 32, 16, hueOf(c.author.name)) : avatar({ initials: "?", unknown: true }, 32, 16, 0))
    .child(v_flex().flex_1().min_w(0).gap(4)
      .child(h_flex().gap(8).items_baseline()
        .child(div().text_size(14).when(true, (w) => bold(w, 600)).text_color(JIRA.text).child(masked(c.author?.name ?? "작성자 정보 없음")))
        .when(Boolean(c.created), (e) => e.child(div().text_size(12).text_color(JIRA.subtle).child(String(c.created).slice(0, 16).replace("T", " ")))))
      .child(richBody(c.blocks ?? [], id, JIRA, ctx, bud)));
}

function issueView(view, call, ctx) {
  const { issue } = view;
  const bud = budget();
  const id = `jira-${call.id}`;
  const desc = view.descBlocks;
  const notice = NOTICE[view.kind] ? `${NOTICE[view.kind]}${view.changed?.length ? ` · ${view.changed.join(", ")}` : ""}` : null;
  return sheet(JIRA, [
    h_flex().w_full().px(24).pt(16).gap(10).items_center().child(brand("brand-jira", 20)).child(div().flex_1().min_w(0).child(crumbs(issue, ctx, id))).child(openLink(`${id}-open`, "Jira에서 열기", issue.url, JIRA, ctx)),
    v_flex().w_full().px(24).pt(10).pb(22).gap(14)
      .when(Boolean(notice), (e) => e.child(h_flex().w_full().gap(8).items_center().px(12).py(8).rounded(6).bg(view.pending ? "#FFF5DB" : "#EFFFD6").text_size(13).text_color(JIRA.text)
        .child(div().child(view.pending ? "아직 결과가 오지 않았어요 · 보낸 내용이에요" : `✓ ${notice}`))))
      .child(div().w_full().text_size(22).when(true, (w) => bold(w, 650)).line_height(1.27).text_color(JIRA.text).child(masked(issue.summary || issue.key)))
      .when(Boolean(issue.status), (e) => e.child(h_flex().gap(8).child(lozenge(issue.status, true))))
      .child(details(issue, ctx, id) ?? div())
      .when(desc != null, (e) => e.child(v_flex().w_full().gap(8)
        .child(div().text_size(15).when(true, (w) => bold(w, 600)).text_color(JIRA.text).child("설명"))
        .child(desc?.length ? richBody(desc, `${id}-d`, JIRA, ctx, bud) : div().text_size(14).text_color(JIRA.subtle).child("설명 없음"))))
      .when(issue.comments.length > 0, (e) => e.child(v_flex().w_full().gap(14).pt(4)
        .child(div().text_size(15).when(true, (w) => bold(w, 600)).text_color(JIRA.text).child(`댓글 ${issue.comments.length}`))
        .children(issue.comments.map((c, i) => comment(c, `${id}-c${i}`, ctx, bud))))),
  ]);
}

function listView(view, call, ctx) {
  const id = `jiral-${call.id}`;
  const any = (pick) => view.issues.some(pick);
  const cols = { assignee: any((i) => i.assignee), status: any((i) => i.status), priority: any((i) => i.priority), due: any((i) => i.due) };
  const th = (label, w) => div().when(Boolean(w), (e) => e.w(w).flex_none()).when(!w, (e) => e.flex_1()).px(8).text_size(12).when(true, (w) => bold(w, 650)).text_color(JIRA.dim).child(label);
  const rows = view.issues.slice(0, 60).map((issue, i) => {
    const row = h_flex().id(`${id}-${i}`).w_full().h(44).items_center().border_t(1).border_color(JIRA.border).hover((s) => s.bg(JIRA.headBg))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center().px(8).child(typeIcon(issue.type)).child(div().flex_none().text_size(14).text_color(JIRA.link).underline().child(issue.key))
        .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(JIRA.text).child(issue.summary)))
      .when(cols.assignee, (e) => e.child(div().w(130).flex_none().px(8).child(issue.assignee ? who(issue.assignee) : div().text_size(14).text_color(JIRA.subtle).child("없음"))))
      .when(cols.status, (e) => e.child(div().w(104).flex_none().px(8).child(issue.status ? h_flex().child(lozenge(issue.status)) : div())))
      .when(cols.priority, (e) => e.child(div().w(84).flex_none().px(8).truncate().text_size(13).text_color(JIRA.text).child(issue.priority ?? "")))
      .when(cols.due, (e) => e.child(div().w(96).flex_none().px(8).text_size(13).text_color(JIRA.text).child(issue.due ?? "")));
    return issue.url ? row.cursor_pointer().on_click((_e, cx) => ctx.openUrl(issue.url, cx)) : row;
  });
  return sheet(JIRA, [
    v_flex().w_full().px(24).pt(18).pb(20).gap(14)
      .child(h_flex().w_full().gap(10).items_center().child(brand("brand-jira", 20)).child(div().flex_1().text_size(20).when(true, (w) => bold(w, 650)).text_color(JIRA.text).child("업무 항목 검색")))
      .when(Boolean(view.jql), (e) => e.child(h_flex().w_full().gap(8).items_start().px(10).py(7).rounded(4).border(1).border_color("#8C8F97")
        .child(div().flex_none().px(5).h(20).rounded(3).bg("#E9F2FE").text_size(12).when(true, (w) => bold(w, 600)).text_color("#1558BC").flex().items_center().child("JQL"))
        .child(div().flex_1().min_w(0).font_family(JIRA.mono).text_size(12.5).line_height(1.6).text_color(JIRA.text).child(masked(view.jql)))))
      .child(view.pending ? div().text_size(14).text_color(JIRA.subtle).child("검색 결과를 기다리고 있어요")
        : view.issues.length ? v_flex().w_full().rounded(8).border(1).border_color(JIRA.border).overflow_hidden()
          .child(h_flex().w_full().h(36).items_center().bg(JIRA.headBg).child(th("업무", 0)).when(cols.assignee, (e) => e.child(th("담당자", 130))).when(cols.status, (e) => e.child(th("상태", 104)))
            .when(cols.priority, (e) => e.child(th("우선 순위", 84))).when(cols.due, (e) => e.child(th("기한", 96))))
          .children(rows)
          .child(h_flex().w_full().h(36).items_center().justify_center().border_t(1).border_color(JIRA.border).text_size(13).text_color(JIRA.link).child(`${view.issues.length}개${view.issues.length > 60 ? " 중 60개" : ""}`))
        : div().py(18).text_size(14).text_color(JIRA.subtle).child("조건에 맞는 업무 항목이 없어요")),
  ]);
}

function commentView(view, call, ctx) {
  const id = `jirac-${call.id}`;
  return sheet(JIRA, [
    v_flex().w_full().px(24).pt(16).pb(20).gap(14)
      .child(h_flex().w_full().gap(8).items_center().child(brand("brand-jira", 20)).child(typeIcon({ kind: "task" }, 14)).child(div().text_size(14).text_color(JIRA.dim).child(view.key))
        .child(div().flex_1().text_size(14).when(true, (w) => bold(w, 600)).text_color(JIRA.text).child(view.pending ? "댓글을 보내는 중" : "댓글을 달았어요")))
      .child(comment(view.comment, id, ctx, budget())),
  ]);
}

function transitionsView(view, call) {
  return sheet(JIRA, [
    v_flex().w_full().px(24).pt(16).pb(20).gap(10)
      .child(h_flex().w_full().gap(8).items_center().child(brand("brand-jira", 20)).child(div().text_size(14).text_color(JIRA.dim).child(view.key)).child(div().text_size(14).when(true, (w) => bold(w, 600)).text_color(JIRA.text).child("바꿀 수 있는 상태")))
      .children(view.transitions.map((x) => h_flex().w_full().h(36).gap(10).items_center().px(8).rounded(4)
        .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(JIRA.text).child(masked(x.name))).child(div().text_size(12).text_color(JIRA.subtle).child("→")).child(lozenge(x.to)))),
  ]);
}

/** Everything parsed (Markdown included), ready to draw: done off the render pass, since
 *  parsing a long page takes longer than a frame may. Null when it isn't Jira data. */
export function prepareJira(call) {
  const view = parseJira(call);
  if (!view) return null;
  const withBlocks = (c) => ({ ...c, blocks: blocks(c.body, 80) });
  if (view.kind === "comment") return { ...view, comment: withBlocks(view.comment) };
  if (!view.issue) return view;
  return { ...view, descBlocks: view.issue.description != null ? blocks(view.issue.description) : null, issue: { ...view.issue, comments: view.issue.comments.map(withBlocks) } };
}

/** The Jira-looking view of a prepared call, or null (the generic view draws it). */
export function drawJira(view, call, ctx) {
  if (!view) return null;
  if (view.kind === "list") return listView(view, call, ctx);
  if (view.kind === "comment") return commentView(view, call, ctx);
  if (view.kind === "transitions") return view.transitions.length ? transitionsView(view, call) : null;
  return issueView(view, call, ctx);
}

export const renderJira = (call, ctx) => drawJira(memo(call, `jira:${Boolean(call.result)}`, () => prepareJira(call)), call, ctx);
