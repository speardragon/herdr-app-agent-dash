// Workspace head (which agent, where, what it's doing) and the lens tabs.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { alpha, button, chip, icon, pill, programIcon, statusColor, STATUS_LABEL } from "./kit.js";
import { fmtDur, fmtInt } from "../lib/format.js";
import { tildePath } from "../lib/paths.js";

export const LENSES = [
  { id: "overview", label: "개요", icon: "activity", key: "1" },
  { id: "calls", label: "도구 호출", icon: "terminal", key: "2" },
  { id: "links", label: "링크", icon: "link", key: "3" },
  { id: "prompts", label: "프롬프트", icon: "message", key: "4" },
  { id: "changes", label: "변경", icon: "diff", key: "5" },
  // Shown when the scope has sub-agents (terminals started with `hc run`).
  { id: "subs", label: "하위 에이전트", icon: "workflow", key: "6", optional: true },
];

const NOTES = {
  remote: "다른 머신의 에이전트예요. 원격 기록 읽기는 아직 지원하지 않아요.",
  unsupported: "이 에이전트의 기록 형식은 아직 읽지 못해요. Claude Code와 Codex를 지원해요.",
  missing: "이 에이전트의 대화 기록 파일을 찾지 못했어요.",
  nopid: "에이전트 프로세스를 찾지 못했어요.",
};

function statusPill(agent, terminal, t) {
  const color = statusColor(agent.status, t);
  const since = terminal?.status_ms ? fmtDur((Date.now() - terminal.status_ms) / 1000) : "";
  const text = `${STATUS_LABEL[agent.status] ?? agent.status}${since ? ` · ${since}` : ""}`;
  return pill(text, color, t);
}

/** opts: {agent, terminal, session, pane, home, compact, onFocus, onPeek, parent, onParent} */
export function agentHead(opts, t) {
  const { agent, terminal, session, pane, home } = opts;
  const where = `${agent.space_name} › ${agent.tab_name}`;
  const live = agent.state !== "ended";
  const cwd = terminal?.foreground?.cwd ?? pane?.cwd ?? session?.cwd;
  const meta = [session?.model, cwd ? tildePath(cwd, home) : null, pane?.branch ? `⎇ ${pane.branch}` : null].filter(Boolean);
  const note = session?.note ? NOTES[session.note] : session?.error ? `기록을 읽지 못했어요: ${session.error}` : null;
  return v_flex().flex_none().px(18).pt(14).pb(10).gap(8)
    .child(h_flex().gap(12).items_center()
      .child(programIcon(agent.program, 30, t))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(8).items_center().min_w(0)
          .child(div().truncate().text_size(16).font_semibold().text_color(t.foreground).child(agent.title || agent.program?.name || agent.address))
          .when(Boolean(agent.sub), (e) => e.child(chip(agent.address, t, t.dim)))
          .when(Boolean(session?.inferred), (e) => e.child(chip("추정 연결", t, t.dim).tooltip(agent.sub ? "시작 시각과 맡긴 일로 이 하위 에이전트의 기록을 골랐어요." : "Codex는 세션 id를 알려 주지 않아서, 같은 폴더에서 이 프로세스 이후에 쓰인 기록을 골랐어요."))))
        .child(h_flex().gap(6).items_center().min_w(0).text_size(11.5).text_color(t.dim)
          .child(div().flex_none().child(agent.program?.name ?? ""))
          .child(div().flex_none().child("·"))
          .when(Boolean(opts.parent), (e) => e.child(h_flex().id("head-parent").flex_none().gap(4).items_center().px(5).h(18).rounded(5).cursor_pointer().bg(alpha(t.accent, 0.1)).text_color(t.accent).hover((s) => s.bg(alpha(t.accent, 0.18)))
            .on_click((ev, cx) => opts.onParent(ev, cx)).tooltip("이 에이전트를 띄운 에이전트로 가요")
            .child(icon("corner", 10, t.accent)).child(div().max_w(200).truncate().child(`${opts.parent?.title ?? ""}의 하위 에이전트`))))
          .when(!opts.parent, (e) => e.child(div().flex_none().child(where)))
          .children(meta.flatMap((m) => [div().flex_none().child("·"), div().truncate().child(m)]))))
      .child(statusPill(agent, terminal, t))
      .child(button("head-web", opts.compact ? "" : "웹에서 열기", opts.onWeb, t, { iconName: "globe", tip: "같은 화면을 브라우저로 열어요" }))
      .when(!opts.compact && live, (e) => e
        .child(button("head-peek", "엿보기", opts.onPeek, t, { iconName: "eye", tip: "터미널을 탭 위에 잠깐 띄워요" }))
        .child(button("head-focus", "터미널로", opts.onFocus, t, { iconName: "arrow-up-right", tip: "herdr에서 이 에이전트로 이동해요" })))
      .when(Boolean(opts.onClose), (e) => e.child(closeButton(opts.onClose, t))))
    .when(Boolean(note), (e) => e.child(h_flex().gap(8).items_center().px(10).py(7).rounded(8).bg(alpha(t.blocked, 0.08)).border(1).border_color(alpha(t.blocked, 0.25))
      .child(icon("info", 13, t.blocked)).child(div().text_size(12).text_color(t.muted).child(note))));
}

const closeButton = (onClose, t) => button("head-close", "", onClose, t, { iconName: "x", quiet: true, tip: "닫기 (Esc)" });

export function fleetHead(list, t, onClose = null, onWeb = null) {
  const count = (s) => list.filter((a) => a.status === s).length;
  return v_flex().flex_none().px(18).pt(14).pb(10).gap(3)
    .child(h_flex().gap(10).items_center()
      .child(div().size(30).rounded(8).bg(t.raised).flex().items_center().justify_center().child(icon("grid", 16, t.accent)))
      .child(v_flex().gap(2)
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child("전체 현황"))
        .child(div().text_size(11.5).text_color(t.dim).child(`에이전트 ${fmtInt(list.length)} · 응답 필요 ${count("blocked")} · 작업 중 ${count("working")} · 완료 ${count("done")}`)))
      .child(div().flex_1())
      .when(Boolean(onWeb), (e) => e.child(button("fleet-web", "웹에서 열기", onWeb, t, { iconName: "globe", tip: "같은 화면을 브라우저로 열어요" })))
      .when(Boolean(onClose), (e) => e.child(closeButton(onClose, t))));
}

/** Tabs with counts; `counts` maps lens id -> number or null. */
export function lensTabs(selected, counts, onPick, t, compact = false) {
  return h_flex().flex_none().h(36).px(12).gap(2).items_end().border_b(1).border_color(t.border).children(
    LENSES.filter((l) => !l.optional || counts[l.id] > 0 || l.id === selected).map((l) => {
      const on = l.id === selected;
      const n = counts[l.id];
      return v_flex().id(`lens-${l.id}`).h_full().cursor_pointer().on_click((_e, cx) => onPick(l.id, cx))
        .child(h_flex().flex_1().px(compact ? 8 : 10).gap(6).items_center()
          .child(icon(l.icon, 13, on ? t.accent : t.dim))
          .when(!compact || on, (e) => e.child(div().text_size(12.5).font_weight(on ? 600 : 500).text_color(on ? t.foreground : t.muted).child(l.label)))
          .when(n != null && n > 0, (e) => e.child(div().px(5).h(16).rounded(4).bg(on ? alpha(t.accent, 0.16) : t.raised).text_size(10.5).text_color(on ? t.accent : t.dim).flex().items_center().child(fmtInt(n)))))
        .child(div().h(2).mx(6).rounded(1).bg(on ? t.accent : alpha(t.accent, 0)))
        .hover((s) => s.bg(alpha(t.foreground, 0.03)))
        .tooltip(`${l.label} (${l.key})`);
    }),
  );
}
