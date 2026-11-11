// Shell calls drawn as the terminal they ran in: the command (secrets as lock chips),
// colored output with stderr marked, exit code, background and timeout chips.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { alpha, button, chip, icon } from "../kit.js";
import { LINE_H, codeView, rowsBox, tabs, tokenLine } from "../code.js";
import { ansiLines, stripAnsi } from "../../lib/ansi.js";
import { tokenize } from "../../lib/highlight.js";
import { maskSecrets, masked } from "../../lib/tools.js";
import { CUT, fmtInt } from "../../lib/format.js";
import { tildePath } from "../../lib/paths.js";

const FOLD_AT = 80;
const ERR_LINE = /^(npm ERR!|error[:\[]|fatal:|Error:|FAIL\b|✗|×)/i;

function ansiColor(value, t) {
  if (value == null) return null;
  return typeof value === "number" ? t[`ansi${value}`] : value;
}

function outputLine(runs, t, stderr) {
  const plain = runs.map((r) => r.t).join("");
  const cut = CUT.exec(plain);
  if (cut) return h_flex().h(LINE_H).flex_none().items_center().gap(6).text_color(t.dim).child(icon("fold", 11, t.dim)).child(`${fmtInt(+cut[1])}자 생략됨`);
  const bad = stderr || ERR_LINE.test(plain.trim());
  return h_flex().h(LINE_H).flex_none().w_full().items_center()
    .when(bad, (e) => e.bg(alpha(t.del, 0.07)))
    .child(div().w(3).h_full().flex_none().when(bad, (e) => e.bg(alpha(t.del, 0.6))))
    .child(div().w(8).flex_none())
    .children(runs.length ? runs.map((r) => {
      let el = div().flex_none().whitespace_nowrap().child(tabs(r.t));
      const fg = ansiColor(r.fg, t);
      el = el.text_color(fg ?? (bad ? alpha(t.del, 0.95) : t.foreground));
      if (r.bg != null) el = el.bg(ansiColor(r.bg, t));
      if (r.b) el = el.font_semibold();
      if (r.d) el = el.opacity(0.6);
      if (r.i) el = el.italic();
      if (r.u) el = el.underline();
      return el;
    }) : [div().child(" ")]);
}

/** Output lines with folding for long logs; `key` names the fold toggle. */
// Each line is parsed when it is drawn; styles reset per line, which is what tools do anyway.
const ANSI_CACHE = new Map();
// Output is masked too: `git remote -v`, `claude mcp add` and env dumps print credentials.
function ansiLine(raw) {
  let hit = ANSI_CACHE.get(raw);
  if (!hit) {
    hit = ansiLines(maskSecrets(raw).text)[0] ?? [];
    if (ANSI_CACHE.size > 3000) ANSI_CACHE.delete(ANSI_CACHE.keys().next().value);
    ANSI_CACHE.set(raw, hit);
  }
  return hit;
}

export function outputBlock(text, ctx, t, key, stderr = false) {
  const lines = String(text ?? "").replace(/\n$/, "").split("\n");
  const open = ctx.ui(key, false);
  const long = lines.length > FOLD_AT && !open;
  // Folded output stays under the virtualizing threshold, so its toggle can take clicks.
  const shown = long ? [...lines.slice(0, 25), null, ...lines.slice(-25)] : lines;
  let widest = 20;
  for (let i = 0; i < lines.length && i < 3000; i++) widest = Math.max(widest, lines[i].length);
  const render = (i) => {
    const raw = shown[i];
    if (raw != null) return outputLine(ansiLine(raw), t, stderr);
    return h_flex().id(`${key}-more`).h(LINE_H).flex_none().w_full().items_center().justify_center().gap(6).cursor_pointer()
      .bg(alpha(t.foreground, 0.04)).text_color(t.accent).text_size(11.5)
      .hover((s) => s.bg(alpha(t.foreground, 0.09)))
      .on_click((_e, cx) => ctx.setUi(key, true, cx))
      .child(icon("fold", 11, t.accent)).child(`${fmtInt(lines.length - 50)}줄 더 보기`);
  };
  return rowsBox(key, shown.length, render, t, { width: widest * 7.4 + 60 });
}

// Commands are read whole: their tokens wrap (paths and pipes break between tokens).
function wrapLine(tokens, t) {
  const color = (c) => (c ? t.syn[c] ?? t.foreground : t.foreground);
  return h_flex().flex_1().min_w(0).flex_wrap().children((tokens ?? []).flatMap((tok) =>
    tok.t.split(/(?<= )/).map((piece) => {
      let el = div().flex_none().whitespace_nowrap().text_color(color(tok.c)).child(tabs(piece));
      if (tok.c === "cmd") el = el.font_semibold();
      return el;
    })));
}

// A command shows three lines at most until it is opened: its first three lines, a very long
// line cut short (it would wrap into many).
const COMMAND_LINES = 3;
const LINE_CHARS = 160;

function commandHead(text) {
  const all = text.split("\n");
  const head = all.slice(0, COMMAND_LINES).map((l) => (l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}…` : l));
  // Wrapped lines count too: stop once about three rows of text are used.
  const kept = [];
  let rows = 0;
  for (const line of head) {
    if (rows >= COMMAND_LINES) break;
    kept.push(line);
    rows += Math.max(1, Math.ceil(line.length / 80));
  }
  return { text: kept.join("\n"), cut: kept.length < all.length || kept.some((l, i) => l !== all[i]), hidden: all.length - kept.length };
}

function commandLines(command, t, ctx, key) {
  const { text, count } = maskSecrets(command);
  const open = ctx.ui(key, false);
  const head = commandHead(text);
  const lines = tokenize(open || !head.cut ? text : head.text, "bash");
  const shown = lines;
  const toggle = (label, mark) => h_flex().id(`${key}-more`).mt(4).gap(6).items_center().px(8).py(4).rounded(6).cursor_pointer().text_size(11.5).text_color(t.accent)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => ctx.setUi(key, !open, cx))
    .child(icon(mark, 11, t.accent)).child(label);
  return {
    count,
    el: v_flex().w_full().font_family(t.mono).text_size(12.5)
      .children(shown.map((tokens, i) =>
        h_flex().w_full().min_h(LINE_H).items_start()
          .child(div().w(18).flex_none().text_color(i === 0 ? t.ansi13 : alpha(t.dim, 0.5)).font_semibold().child(i === 0 ? "$" : "›"))
          .child(wrapLine(tokens, t))))
      .when(head.cut, (e) => e.child(open ? toggle("접기", "chevron-up") : toggle(head.hidden > 0 ? `전체 명령 보기 (${fmtInt(head.hidden)}줄 더)` : "전체 명령 보기", "fold"))),
  };
}

function exitCode(call) {
  const x = call.result?.extra ?? {};
  if (x.exit != null) return x.exit;
  const m = /Exit code (\d+)/.exec(call.result?.text ?? "");
  return m ? +m[1] : call.result?.err ? 1 : call.result ? 0 : null;
}

const BOX_BORDER = "#B4B7BE";
const sectionLabel = (text, color) => div().text_size(10.5).font_semibold().text_color(color).child(text);

/** Bash (Claude), exec_command (Codex), and Codex's JavaScript exec wrapper. */
export function renderShell(call, ctx, t) {
  if (call.name === "exec") return renderExecWrapper(call, ctx, t);
  const input = call.input ?? {};
  const command = Array.isArray(input.command) ? input.command.join(" ") : input.command ?? input.cmd ?? "";
  const x = call.result?.extra ?? {};
  const code = exitCode(call);
  const cwd = input.cwd ?? input.workdir ?? ctx.cwd;
  const cmd = commandLines(command, t, ctx, `cmd:${call.id}`);
  const stdout = x.stdout ?? (x.stderr == null ? call.result?.text : "") ?? "";
  const stderr = x.stderr ?? "";
  const chips = [
    input.run_in_background || x.bg ? chip(`백그라운드${x.bg ? ` · ${x.bg}` : ""}`, t, t.ansi6) : null,
    input.timeout ? chip(`timeout ${Math.round(input.timeout / 1000)}s`, t) : null,
    input.dangerouslyDisableSandbox ? chip("샌드박스 해제", t, t.blocked) : null,
    cmd.count ? h_flex().gap(4).items_center().child(icon("lock", 10, t.ansi3)).child(chip(`비밀값 ${cmd.count}개 가림`, t, t.ansi3)) : null,
    x.interrupted ? chip("중단됨", t, t.dim) : null,
  ].filter(Boolean);
  return v_flex().w_full().rounded(10).border(1).border_color(t.border).bg(t.background).overflow_hidden()
    .child(h_flex().h(40).px(12).gap(10).items_center().bg(alpha(t.foreground, 0.03)).border_b(1).border_color(t.border)
      // The traffic lights, with what the command is for (the model's own `description` of the
      // call; calls without one, like Codex's, show the folder) right beside them.
      .child(h_flex().gap(6).items_center().flex_none().children(["#FF5F57", "#FEBC2E", "#28C840"].map((color) => div().size(11).flex_none().rounded(6).bg(color))))
      .child(input.description
        ? div().flex_1().min_w(0).truncate().text_size(14.5).font_semibold().text_color("#FFFFFF").child(masked(String(input.description)))
        : div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).font_family(t.mono).child(cwd ? tildePath(cwd, ctx.home) : "셸"))
      .when(Boolean(input.description) && Boolean(cwd), (e) => e.child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.dim).font_family(t.mono).child(tildePath(cwd, ctx.home))))
      .children(chips)
      .child(button(`copy-cmd-${call.id}`, "", (_e, cx) => ctx.copy(maskSecrets(command).text, cx), t, { iconName: "copy", quiet: true, tip: "명령 복사 (비밀값 제외)" })))
    // 입력 and 출력 are two boxes, each with its own 1px light-gray border.
    .child(v_flex().w_full().p(10).gap(10)
      // 입력: tinted.
      .child(h_flex().w_full().rounded(8).border(1).border_color(BOX_BORDER).overflow_hidden().bg(alpha(t.accent, 0.07))
        .child(v_flex().flex_1().min_w(0).px(12).py(10).gap(6)
          .child(sectionLabel("입력", t.accent))
          .child(cmd.el)))
      // 출력: on a darker ground, labelled with its own exit status.
      .child(v_flex().w_full().px(12).py(10).gap(6).rounded(8).border(1).border_color(BOX_BORDER).bg(alpha(t.chrome ?? t.background, 0.9))
        .child(h_flex().gap(8).items_center().child(sectionLabel("출력", t.muted))
          .when(code != null, (e) => e.child(chip(`exit ${code}`, t, code === 0 ? t.ansi2 : t.del))))
        .when(Boolean(stdout.trim()), (e) => e.child(outputBlock(stdout, ctx, t, `out:${call.id}`)))
        .when(Boolean(stderr.trim()), (e) => e.child(v_flex().gap(4)
          .child(div().text_size(11).text_color(alpha(t.del, 0.9)).child("stderr"))
          .child(outputBlock(stderr, ctx, t, `err:${call.id}`, true))))
        .when(!stdout.trim() && !stderr.trim() && Boolean(call.result), (e) => e.child(div().text_size(12).text_color(t.dim).child(x.noOutput ? "출력이 없는 명령이에요" : "출력 없음")))
        .when(!call.result && ctx.status === "running", (e) => e.child(h_flex().gap(6).items_center().text_size(12).text_color(t.working)
          .child(icon("spinner", 12, t.working).spin(900)).child("실행 중…")))));
}

function renderExecWrapper(call, ctx, t) {
  const text = call.result?.text ?? "";
  return v_flex().w_full().gap(10)
    .child(div().text_size(12).text_color(t.dim).child("Codex가 도구를 부르는 스크립트예요. 실행한 명령은 각각 따로 기록돼요."))
    .child(codeView(call.input?.code ?? "", "js", t, { id: `exec-${call.id}` }))
    .when(Boolean(text), (e) => e.child(outputBlock(stripAnsi(text), ctx, t, `out:${call.id}`)));
}
