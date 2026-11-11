// 링크: every link in the conversation (outside code), newest first, told apart by who brought
// it: the ones you handed over in a prompt, and the ones an agent wrote in a reply. Each comes
// with the sentence it was in, the URL taken apart, and one click to open or copy.

import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, TextView, h_resizable, resizable_panel } from "gpui-base";
import { alpha, button, chip, empty, icon, programIcon, scrollArea, sectionTitle, segmented } from "./kit.js";
import { anatomy, domainOf } from "../lib/links.js";
import { relTime, when } from "../lib/format.js";

const ROW_H = 52;
const BADGE_COLOR = (t) => ({ pr: t.ansi5, issue: t.ansi2, commit: t.ansi4, adv: t.del, pkg: t.ansi1, doc: t.ansi6, local: t.ansi3, file: t.ansi3 });

// A tile per host so the same site always looks the same.
function hostTile(url, t, size = 28) {
  const host = domainOf(url) || "file";
  let h = 0;
  for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [t.ansi1, t.ansi2, t.ansi3, t.ansi4, t.ansi5, t.ansi6];
  const color = hues[h % hues.length];
  const glyph = host === "github.com" ? icon("github", Math.round(size * 0.55), t.foreground) : div().text_size(Math.round(size * 0.42)).font_bold().text_color(color).child(host.replace(/^www\./, "").slice(0, 1).toUpperCase());
  return div().size(size).flex_none().rounded(Math.round(size / 4)).bg(alpha(color, 0.14)).flex().items_center().justify_center().child(glyph);
}

function linkRow(item, selected, t) {
  const { link, agent } = item;
  const badgeColor = link.badge ? BADGE_COLOR(t)[link.badge.kind] ?? t.muted : null;
  return h_flex().id(item.key ?? `link-${link.url}`).w_full().h(ROW_H).flex_none().gap(10).items_center().px(16)
    .when(selected, (e) => e.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .child(div().relative().flex_none().child(hostTile(link.url, t))
      // Whose link it is, at a glance: yours (a speech mark) or the agent's.
      .child(div().absolute().right(-4).bottom(-4).size(14).rounded(7).bg(mine(link) ? t.accent : t.raised).border(1).border_color(t.background).flex().items_center().justify_center()
        .child(icon(mine(link) ? "message" : "bot", 8, mine(link) ? t.accent_foreground ?? t.background : t.dim))))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().min_w(0).truncate().text_size(12.5).font_weight(600).text_color(selected ? t.foreground : t.muted).child(link.title))
        .when(Boolean(link.badge), (e) => e.child(div().flex_none().px(5).h(16).rounded(4).bg(alpha(badgeColor, 0.14)).text_size(10).font_semibold().text_color(badgeColor).flex().items_center().child(link.badge.text))))
      .child(div().truncate().text_size(11).font_family(t.mono).text_color(t.dim).child(link.url.replace(/^https?:\/\//, ""))))
    .child(v_flex().flex_none().items_end().gap(3)
      .when(Boolean(item.showAgent), (e) => e.child(programIcon(agent.program, 14, t)))
      .child(div().text_size(10.5).text_color(t.dim).child(relTime(link.ts))));
}

const mine = (link) => link.from === "user";

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function anatomyView(url, t) {
  const a = anatomy(url);
  if (!a) return div();
  const part = (label, value, color) => v_flex().gap(3)
    .child(div().h(14).text_size(10.5).text_color(t.dim).child(label))
    .child(div().px(8).py(4).rounded(6).bg(alpha(color, 0.1)).font_family(t.mono).text_size(12).text_color(color).child(value));
  return v_flex().w_full().gap(10)
    .child(h_flex().gap(8).flex_wrap().items_end()
      .child(part("scheme", a.scheme, t.dim))
      .child(part("host", a.host + (a.port ? `:${a.port}` : ""), t.ansi4))
      .children(a.path.map((seg, i) => part(i ? "" : "path", `/${decodeSafe(seg)}`, t.ansi2)))
      .when(Boolean(a.hash), (e) => e.child(part("hash", `#${a.hash}`, t.ansi5))))
    .when(a.query.length > 0, (e) => e.child(v_flex().w_full().rounded(8).border(1).border_color(t.border).overflow_hidden().children(a.query.map((q, i) =>
      h_flex().w_full().px(10).py(5).gap(10).when(i > 0, (el) => el.border_t(1).border_color(t.border))
        .child(div().w(140).flex_none().font_family(t.mono).text_size(12).text_color(t.ansi3).child(q.k))
        .child(div().flex_1().min_w(0).font_family(t.mono).text_size(12).text_color(t.foreground).child(q.v))))));
}

function detail(item, ctx, t) {
  const { link, agent, session } = item;
  const source = mine(link) ? session?.prompts[link.prompt - 1] : session?.replies.find((r) => r.n === link.reply);
  const lines = String(source?.text ?? "").split("\n");
  const excerpt = lines.slice(Math.max(0, link.line - 3), link.line + 4).join("\n");
  return v_flex().w_full().gap(16)
    .child(h_flex().gap(12).items_center()
      .child(hostTile(link.url, t, 40))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child(link.title))
        .child(div().truncate().font_family(t.mono).text_size(11.5).text_color(t.dim).child(link.url)))
      .child(button("link-copy", "복사", (_e, cx) => ctx.copy(link.url, cx), t, { iconName: "copy" }))
      .child(button("link-open", "열기", (_e, cx) => (link.local ? ctx.openFile(link.url, cx) : cx.open_url(link.url)), t, { iconName: "external", primary: true })))
    .child(h_flex().gap(6).flex_wrap()
      .child(chip(agent.title, t))
      .child(mine(link) ? chip("내가 보낸 링크", t, t.accent) : chip("에이전트 답변", t))
      .child(chip(`${mine(link) ? `프롬프트 #${link.prompt}` : `답변 #${link.reply}`} · ${when(link.ts)}`, t))
      .when(Boolean(link.label), (e) => e.child(chip(`글자: ${link.label}`, t))))
    .child(v_flex().w_full()
      .child(sectionTitle("나온 문장", t))
      .child(h_flex().w_full().gap(10).items_start()
        .child(div().w(3).min_h(20).flex_none().rounded(2).bg(alpha(t.accent, 0.6)).self_stretch())
        .child(div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child(link.context || "—"))))
    .when(!link.local, (e) => e.child(v_flex().w_full().child(sectionTitle("주소 구조", t)).child(anatomyView(link.url, t))))
    .when(Boolean(excerpt.trim()), (e) => e.child(v_flex().w_full()
      .child(sectionTitle(mine(link) ? "프롬프트 앞뒤" : "답변 앞뒤", t))
      .child(div().w_full().p(14).rounded(10).border(1).border_color(t.border).bg(t.background).text_size(12.5)
        .child(TextView.markdown(`lk-${link.key}`, excerpt).selectable(true).on_link_click((url, cx) => cx.open_url(url))))));
}

function itemsFor(ctx) {
  const scopes = ctx.scope === "all" ? Object.keys(ctx.agents) : [ctx.scope];
  const items = [];
  for (const address of scopes) {
    const session = ctx.store.get(address);
    const d = ctx.store.derived(session);
    if (!d) continue;
    for (const link of d.links) items.push({ key: `${address}|${link.key}`, link, agent: ctx.agents[address], session, showAgent: ctx.scope === "all" });
  }
  return ctx.scope === "all" ? items.sort((a, b) => (b.link.ts ?? 0) - (a.link.ts ?? 0)) : items;
}

const domainKey = (link) => (link.local ? "파일" : domainOf(link.url));

function domainChips(items, active, ctx, t) {
  const counts = new Map();
  for (const it of items) counts.set(domainKey(it.link), (counts.get(domainKey(it.link)) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const pick = (id, cx) => ctx.setUi("links:domain", id === active ? null : id, cx);
  return h_flex().flex_none().px(12).pb(10).gap(6).flex_wrap()
    .children(top.map(([d, n]) => h_flex().id(`dom-${d}`).h(24).px(8).gap(6).items_center().rounded(12).cursor_pointer().max_w_full().min_w(0)
      .bg(d === active ? alpha(t.accent, 0.16) : t.raised).text_size(11.5).text_color(d === active ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => pick(d, cx))
      .child(div().min_w(0).truncate().child(d)).child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(n)))));
}

export function linksLens(ctx, t) {
  const all = itemsFor(ctx);
  if (!all.length) return empty("링크가 없어요", "프롬프트에 넣은 링크와 에이전트 답변에 나온 링크가 여기 모여요. 코드 블록 안의 주소는 빼요.", t, "link");
  const from = ctx.ui("links:from", "all");
  const sourced = from === "all" ? all : all.filter((it) => (from === "user") === mine(it.link));
  const domain = ctx.ui("links:domain", null);
  const items = domain ? sourced.filter((it) => domainKey(it.link) === domain) : sourced;
  const userCount = all.filter((it) => mine(it.link)).length;
  const sources = [{ id: "all", label: `전체 ${all.length}` }, { id: "user", label: `내가 보낸 ${userCount}`, icon: "message" }, { id: "agent", label: `에이전트 답변 ${all.length - userCount}`, icon: "bot" }];
  const selected = items.find((it) => it.key === ctx.sel.link) ?? items[0];
  const list = v_flex().size_full().min_h(0)
    .child(h_flex().flex_none().px(12).pt(10).pb(8).child(segmented("links-from", sources, from, (id, cx) => ctx.setUi("links:from", id, cx), t)))
    .child(domainChips(sourced, domain, ctx, t))
    .child(items.length ? div().flex_1().min_h(0).relative()
      .child(v_virtual_list("link-list", items.length, ROW_H, (i) => items[i].key, (range) =>
        items.slice(range.start, range.end).map((it) => linkRow(it, it.key === selected?.key, t)))
        .on_item_click((key, cx) => {
          ctx.setSel({ link: key }, cx);
          ctx.openDetail(cx);
        }).size_full())
      .child(Scrollbar.vertical("link-list").absolute().inset_0())
      : empty(from === "user" ? "내가 보낸 링크가 없어요" : "맞는 링크가 없어요", from === "user" ? "프롬프트에 주소를 넣으면 여기 따로 모여요." : null, t, "link"));
  const stage = selected ? ctx.stageCtx(selected.agent.address, selected.session, selected.agent, null) : null;
  const body = selected ? scrollArea("link-detail", v_flex().p(18).gap(12)
    .child(ctx.compact ? button("link-back", "목록", ctx.onBack, t, { iconName: "arrow-left", quiet: true }) : div())
    .child(detail(selected, { ...ctx, copy: stage.copy }, t))) : div();
  if (ctx.compact) return ctx.detailOpen ? body : list;
  return h_resizable("links-split").size_full()
    .child(resizable_panel().size(400).size_range(280, 640).child(div().size_full().border_r(1).border_color(t.border).child(list)))
    .child(resizable_panel().child(body));
}
