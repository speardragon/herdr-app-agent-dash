// Agent-facing tools: sub-agents, todo lists (what changed this time), questions to the
// person (which answer they picked), plans, skills and waits.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { alpha, chip, icon } from "../kit.js";
import { fmtDur, fmtInt, fmtK } from "../../lib/format.js";

const md = (id, text, t, ctx) => div().w_full().text_size(13).text_color(t.foreground)
  .child(TextView.markdown(id, text ?? "").selectable(true).on_link_click((url, cx) => ctx.openUrl(url, cx)));

const box = (t) => v_flex().w_full().p(14).gap(10).rounded(10).border(1).border_color(t.border).bg(t.background);

export function renderAgent(call, ctx, t) {
  const input = call.input ?? {};
  const x = call.result?.extra ?? {};
  const open = ctx.ui(`agent-prompt:${call.id}`, false);
  const body = x.content || (x.status ? "" : call.result?.text) || "";
  const stats = [x.totalToolUseCount ? `${fmtInt(x.totalToolUseCount)}단계` : null, x.totalTokens ? `${fmtK(x.totalTokens)} 토큰` : null, x.totalDurationMs ? fmtDur(x.totalDurationMs / 1000) : null].filter(Boolean);
  return v_flex().w_full().gap(12)
    .child(h_flex().gap(6).flex_wrap().items_center()
      .when(Boolean(input.subagent_type), (e) => e.child(chip(input.subagent_type, t, t.accent)))
      .when(Boolean(x.resolvedModel ?? input.model), (e) => e.child(chip(x.resolvedModel ?? input.model, t)))
      .when(Boolean(x.isAsync || input.run_in_background), (e) => e.child(chip("백그라운드", t, t.ansi6)))
      .children(stats.map((s) => chip(s, t))))
    .child(box(t)
      .child(h_flex().id(`agent-prompt-${call.id}`).gap(6).items_center().px(6).py(3).mx(-6).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => ctx.setUi(`agent-prompt:${call.id}`, !open, cx))
        .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim)).child(div().text_size(11.5).font_semibold().text_color(t.dim).child("맡긴 일"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(open ? "" : String(input.prompt ?? "").split("\n")[0])))
      .when(open, (e) => e.child(md(`agent-p-${call.id}`, input.prompt, t, ctx))))
    .child(x.status === "async_launched" && !body
      ? h_flex().gap(8).items_center().text_size(12).text_color(t.dim).child(icon("hourglass", 13, t.dim)).child("백그라운드에서 실행 중이에요. 끝나면 결과가 대화에 들어와요.")
      : body ? box(t).child(div().text_size(11.5).font_semibold().text_color(t.dim).child("결과")).child(md(`agent-r-${call.id}`, body, t, ctx)) : div());
}

const TODO_GLYPH = { completed: ["circle-check", "ansi2"], in_progress: ["circle-half", "working"], pending: ["circle", "dim"] };

function todoRow(item, before, t) {
  const status = item.status ?? "pending";
  const [glyph, colorKey] = TODO_GLYPH[status] ?? TODO_GLYPH.pending;
  const changed = before && before !== status;
  return h_flex().w_full().gap(10).items_center().px(10).py(7).rounded(8)
    .when(changed || before === null, (e) => e.bg(alpha(t.accent, 0.06)))
    .child(icon(glyph, 14, t[colorKey] ?? t.dim))
    .child(div().flex_1().min_w(0).text_size(12.5).text_color(status === "completed" ? t.dim : t.foreground).when(status === "completed", (e) => e.line_through()).child(item.content ?? item.step ?? ""))
    .when(changed, (e) => e.child(chip(`${STATUS_WORD[before]} → ${STATUS_WORD[status]}`, t, t.accent)))
    .when(before === null, (e) => e.child(chip("새 항목", t, t.accent)));
}

const STATUS_WORD = { completed: "완료", in_progress: "진행", pending: "대기" };

/** TodoWrite (Claude) and update_plan (Codex): the list, with what this call changed. */
export function renderTodo(call, ctx, t) {
  const items = call.input?.todos ?? (call.input?.plan ?? []).map((p) => ({ content: p.step, status: p.status }));
  const old = call.result?.extra?.old ?? previousList(call, ctx);
  const prior = old ? new Map(old.map((o) => [o.content ?? o.step, o.status])) : null;
  const done = items.filter((i) => i.status === "completed").length;
  return v_flex().w_full().gap(10)
    .when(Boolean(call.input?.explanation), (e) => e.child(div().text_size(12.5).text_color(t.muted).child(call.input.explanation)))
    .child(h_flex().gap(10).items_center()
      .child(div().flex_1().h(6).rounded(3).bg(t.raised).child(div().h_full().rounded(3).bg(t.ansi2).w(`${items.length ? (done / items.length) * 100 : 0}%`)))
      .child(div().text_size(11.5).text_color(t.dim).child(`${done}/${items.length}`)))
    .child(v_flex().w_full().gap(2).children(items.map((item) => todoRow(item, prior ? prior.get(item.content) ?? null : undefined, t))));
}

function previousList(call, ctx) {
  const prev = [...(ctx.session?.calls ?? [])].reverse().find((c) => c.seq < call.seq && c.name === call.name);
  if (!prev) return null;
  return prev.input?.todos ?? (prev.input?.plan ?? []).map((p) => ({ content: p.step, status: p.status }));
}

// Codex asks with request_user_input; the answer arrives as the next prompt.
function codexAnswers(call, ctx) {
  const reply = (ctx.session?.prompts ?? []).find((p) => p.ts >= call.ts && p.answer);
  if (!reply) return {};
  try {
    const json = JSON.parse(reply.text.replace(/^<send_user_message_question_reply>\s*/, "").replace(/<\/send_user_message_question_reply>\s*$/, ""));
    return Object.fromEntries(json.map((a) => [a.question, a.answer]));
  } catch {
    return {};
  }
}

export function renderAsk(call, ctx, t) {
  const questions = (call.input?.questions ?? []).map((q) => ({
    header: q.header, text: q.question ?? q.title ?? "", multi: !!q.multiSelect,
    options: (q.options ?? []).map((o) => (typeof o === "string" ? { label: o } : o)),
  }));
  const answers = call.result?.extra?.answers ?? codexAnswers(call, ctx);
  return v_flex().w_full().gap(14).children(questions.map((q, qi) => {
    const answer = answers[q.text];
    const picked = new Set(String(answer ?? "").split(/,\s*/).filter(Boolean));
    const typed = answer && !q.options.some((o) => picked.has(o.label)) ? answer : null;
    return box(t)
      .child(h_flex().gap(8).items_center()
        .when(Boolean(q.header), (e) => e.child(chip(q.header, t, t.accent)))
        .when(q.multi, (e) => e.child(chip("여러 개 선택", t))))
      .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(q.text))
      .child(v_flex().gap(6).children(q.options.map((o, oi) => {
        const on = picked.has(o.label);
        return h_flex().w_full().gap(10).items_start().px(12).py(9).rounded(9).border(1)
          .border_color(on ? t.accent : t.border).bg(on ? alpha(t.accent, 0.1) : alpha(t.foreground, 0))
          .child(div().size(18).flex_none().rounded(q.multi ? 5 : 9).border(1.5).border_color(on ? t.accent : t.input).bg(on ? t.accent : alpha(t.accent, 0))
            .flex().items_center().justify_center().when(on, (e) => e.child(icon("check", 11, t.accent_foreground ?? t.background))))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_size(12.5).text_color(on ? t.foreground : t.muted).font_weight(on ? 600 : 500).child(`${oi + 1}. ${o.label}`))
            .when(Boolean(o.description), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(o.description)))
            .when(Boolean(o.preview), (e) => e.child(div().mt(6).p(8).rounded(6).bg(t.raised).font_family(t.mono).text_size(11).text_color(t.muted).child(o.preview))));
      })))
      .when(Boolean(typed), (e) => e.child(h_flex().gap(8).items_center().px(12).py(8).rounded(8).bg(alpha(t.accent, 0.08))
        .child(icon("message", 12, t.accent)).child(div().text_size(12.5).text_color(t.foreground).child(`직접 답함: ${typed}`))))
      .when(!answer && qi === 0, (e) => e.child(div().text_size(12).text_color(ctx.status === "pending" || ctx.status === "running" ? t.blocked : t.dim)
        .child(ctx.status === "pending" || ctx.status === "running" ? "답을 기다리고 있어요. 터미널에서 고르면 에이전트가 이어서 일해요." : "기록에 답이 없어요")));
  }));
}

export function renderPlan(call, ctx, t) {
  const approved = call.result && !call.result.err;
  return v_flex().w_full().gap(10)
    .child(h_flex().gap(6).child(chip(call.result ? (approved ? "계획 승인" : "계획 거절") : "검토 대기", t, call.result ? (approved ? t.ansi2 : t.del) : t.blocked)))
    .child(box(t).child(md(`plan-${call.id}`, call.input?.plan ?? "", t, ctx)));
}

export function renderSkill(call, ctx, t) {
  const x = call.result?.extra ?? {};
  return v_flex().w_full().gap(10)
    .child(h_flex().gap(10).items_center()
      .child(div().size(34).rounded(9).bg(alpha(t.ansi5, 0.15)).flex().items_center().justify_center().child(icon("sparkles", 16, t.ansi5)))
      .child(v_flex().gap(2)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(call.input?.skill ?? x.commandName ?? "skill"))
        .child(div().text_size(11.5).text_color(t.dim).child(x.success === false ? "불러오지 못했어요" : "스킬 지침을 불러왔어요"))))
    .when(Boolean(call.input?.args), (e) => e.child(box(t).child(div().text_size(11.5).text_color(t.dim).child("인자")).child(div().text_size(12.5).text_color(t.foreground).child(call.input.args))));
}

export function renderSleep(call, ctx, t) {
  const ms = call.input?.durationMs ?? call.input?.yield_time_ms ?? 0;
  return h_flex().gap(10).items_center()
    .child(icon("hourglass", 16, t.dim))
    .child(div().text_size(13).text_color(t.muted).child(ms ? `${fmtDur(ms / 1000)} 기다렸어요` : "기다렸어요"))
    .when(Boolean(call.result?.text), (e) => e.child(div().text_size(12).text_color(t.dim).child(call.result.text.slice(0, 300))));
}
