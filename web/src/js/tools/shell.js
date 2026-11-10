// Bash and Codex shell, drawn as the terminal window they ran in.

// Secrets are masked by the mod's lib/tools.js (••••); here they become lock chips.
const unmaskHTML = (htmlStr) => htmlStr.replace(/••••/g, `<span class="secret" title="가려진 비밀값">${icon("lock", 11).s}••••</span>`);

// Real results -> what the terminal view reads: {stdout, stderr, exit, background, tests, readFile}.
function shellResult(call) {
  const x = call.result?.extra ?? {};
  const text = call.result?.text ?? "";
  const stdout = x.stdout ?? (x.stderr == null ? text : "");
  const exitText = /Exit code (\d+)/.exec(text);
  const exit = x.exit ?? (exitText ? Number(exitText[1]) : call.result ? (call.result.err ? 1 : 0) : null);
  const sed = /^\s*sed -n ['"]?(\d+),(\d+)p['"]?\s+(\S+)\s*$/.exec(shellText(call.input ?? {}));
  return {
    stdout: maskedText(stdout),
    stderr: maskedText(x.stderr ?? ""),
    exit,
    background: x.bg ?? null,
    tests: parseTests(stripAnsi(stdout)),
    readFile: sed && stdout && !call.result?.err ? { path: sed[3], from: Number(sed[1]), lang: langOf(sed[3]) } : null,
  };
}

// vitest ("Tests  9 passed (9)") and jest ("Tests: 1 failed, 9 passed, 10 total") summaries.
function parseTests(out) {
  const vitest = /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?/.exec(out);
  const jest = /Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(\d+) passed/.exec(out);
  const files = /Test (?:Files|Suites):?\s+(?:\d+ failed[,|] ?)?(\d+) (?:passed|total)/.exec(out);
  const duration = /(?:Duration|Time:)\s+([\d.]+\s?m?s)/.exec(out);
  if (vitest) return { failed: Number(vitest[1] ?? 0), passed: Number(vitest[2]), skipped: Number(vitest[3] ?? 0), files: Number(files?.[1] ?? 0), duration: duration?.[1] ?? "" };
  if (jest) return { failed: Number(jest[1] ?? 0), skipped: Number(jest[2] ?? 0), passed: Number(jest[3]), files: Number(files?.[1] ?? 0), duration: duration?.[1] ?? "" };
  return null;
}

function commandHTML(cmd) {
  const masked = maskSecrets(cmd);
  const lines = hl(masked.text, "bash");
  const body = lines.map((l, i) => `${i === 0 ? '<span class="ps1">$ </span>' : '<span class="ps1">  </span>'}${unmaskHTML(l)}`).join("\n");
  return { html: body, secrets: masked.count };
}

function outputHTML(call, text, isErr, foldKey) {
  const lines = text.replace(/\n$/, "").split("\n");
  const open = STATE.openFolds.has(foldKey);
  const render = (ls) => ls.map((l) => (isErr || /^(npm ERR!|error:|fatal:)/i.test(stripAnsi(l)) ? `<span class="term-err">${ansiToHtml(l) || " "}</span>` : ansiToHtml(l))).join("\n");
  if (lines.length <= 40 || open) return render(lines);
  const head = lines.slice(0, 14);
  const tail = lines.slice(-12);
  return `${render(head)}\n<button class="term-fold" data-action="unfold" data-fold="${esc(foldKey)}">${lines.length - 26}줄 더 보기</button>${render(tail)}`;
}

function shellDigest(call) {
  const r = shellResult(call);
  const out = r.stdout || "";
  if (r.tests) {
    const t = r.tests;
    const total = t.passed + t.failed + t.skipped;
    return html`<div class="digest-card">
      <div class="dstat ${t.failed ? "bad" : "ok"}"><b>${t.failed ? `${t.failed}개 실패` : "모두 통과"}</b>테스트 ${total}개 · 파일 ${t.files}개</div>
      <div class="testbar" role="img" aria-label="통과 ${t.passed}, 실패 ${t.failed}">
        <i class="p" style="flex:${t.passed}"></i>${t.failed ? raw(`<i class="f" style="flex:${t.failed}"></i>`) : ""}${t.skipped ? raw(`<i class="s" style="flex:${t.skipped}"></i>`) : ""}
      </div>
      <div class="dstat"><b>${t.duration}</b>걸린 시간</div>
    </div>`;
  }
  if (r.audit) {
    const c = r.audit.counts;
    return html`<div class="sev">
        <div class="crit"><div class="k">critical</div><div class="v">${c.critical}</div></div>
        <div class="high"><div class="k">high</div><div class="v">${c.high}</div></div>
        <div class="mod"><div class="k">moderate</div><div class="v">${c.moderate}</div></div>
        <div class="low"><div class="k">low</div><div class="v">${c.low}</div></div>
      </div>
      <div class="box" style="margin-bottom:12px;overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>패키지</th><th>심각도</th><th>내용</th><th>영향 범위</th><th>고친 버전</th><th>경로</th></tr></thead>
          <tbody>${r.audit.rows.map(
            (row) => html`<tr>
              <td class="mono"><b>${row.pkg}</b></td>
              <td><span class="sevp ${row.sev}">${row.sev}</span></td>
              <td><div>${row.title}</div><a class="mono dim" href="https://github.com/advisories/${row.id}" target="_blank" rel="noopener" style="font-size:11.5px">${row.id}</a></td>
              <td class="mono dim">${row.range}</td>
              <td class="mono"><span class="ver-new">${row.fix}</span></td>
              <td class="dim">${row.via}</td>
            </tr>`,
          )}</tbody>
        </table>
      </div>`;
  }
  if (/^Check passed:/m.test(out)) {
    const path = out.match(/^Check passed: (.*)$/m)[1];
    return html`<div class="digest-card"><span style="color:#7fcf86">${icon("circle-check", 20)}</span><div class="dstat ok"><b>herdr-app check 통과</b><span class="mono">${shortPath(path)}</span></div></div>`;
  }
  if (r.background) {
    const url = (out.match(/https?:\/\/localhost:\d+\/?/) || [])[0];
    return html`<div class="digest-card"><span class="pill working">${spinner(12)} 백그라운드 실행 중</span><div class="dstat"><b class="mono">${r.background}</b>셸 ID · BashOutput으로 읽음</div>${url ? html`<a class="btn sm" href="${url}" target="_blank" rel="noopener">${icon("external", 13)} ${url}</a>` : ""}</div>`;
  }
  return "";
}

function renderShellRead(call) {
  const r = shellResult(call);
  const cmd = shellText(call.input);
  const lines = hl(r.stdout, r.readFile.lang);
  return html`<div class="editor">
    <div class="ed-tabs"><div class="ed-tab on">${fileIcon(r.readFile.path)} ${baseName(r.readFile.path)}</div><div class="ed-right"><span class="chip mono">${icon("terminal", 12)} 셸로 읽음</span></div></div>
    <div class="ed-sub"><span class="path">${r.readFile.path}</span><span class="grow"></span><span class="mono">${cmd}</span></div>
    <div class="code" data-keep-scroll="code-${call.id}"><div class="code-in">${lines.map((l, i) => raw(`<div class="cl in-range"><span class="ln">${r.readFile.from + i}</span><span class="gm"></span><span class="tx">${l || " "}</span></div>`))}</div></div>
  </div>`;
}

function renderShell(call) {
  if (call.name === "exec") return renderExecScript(call);
  const i = call.input;
  const r = shellResult(call);
  if (r.readFile) return renderShellRead(call);
  const cmd = shellText(i);
  const { html: cmdHtml, secrets } = commandHTML(cmd);
  const running = call.status === "running";
  const cwd = i.workdir || i.cwd || agentById(call.agent)?.cwd;
  const title = i.description || (call.name === "Bash" ? cmd.split(" ")[0] : `codex · ${cmd.split(" ")[0]}`);
  const exitChip =
    r.exit == null
      ? ""
      : html`<span class="chip mono ${r.exit === 0 ? "exit-ok" : "exit-bad"}">exit ${r.exit}</span>`;
  const outText = r.stdout || "";
  const errText = r.stderr || "";
  const outLines = outText ? outText.replace(/\n$/, "").split("\n").length : 0;
  const errLines = errText ? errText.split("\n").length : 0;
  return html`${shellDigest(call)}
  <div class="term">
    <div class="term-bar">
      <div class="lights" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="term-title truncate">${title}</div>
      <div class="term-chips">
        ${cwd ? html`<span class="chip mono cwd" title="${cwd}">${icon("folder", 11)} ${baseName(cwd)}</span>` : ""}
        ${i.run_in_background ? html`<span class="chip mono">background</span>` : ""}
        ${i.timeout ? html`<span class="chip mono">timeout ${Math.round(i.timeout / 1000)}s</span>` : ""}
        ${i.dangerouslyDisableSandbox ? html`<span class="chip warn">${icon("alert", 11)} 샌드박스 해제</span>` : ""}
        ${secrets ? html`<span class="chip warn">${icon("lock", 11)} 비밀값 ${secrets}개 가림</span>` : ""}
        ${exitChip}
      </div>
    </div>
    <div class="term-body" data-keep-scroll="term-${call.id}">
      <div class="term-cmd">${raw(cmdHtml)}</div>${outText || errText || running
        ? raw(
            `<div class="term-out">${outText ? outputHTML(call, outText, false, `out:${call.id}`) : ""}${errText ? `${outText ? "\n" : ""}${outputHTML(call, errText, true, `err:${call.id}`)}` : ""}${running ? '<span class="term-cursor" aria-hidden="true"></span>' : ""}</div>`,
          )
        : html`<div class="term-out dim">(출력 없음)</div>`}
    </div>
    <div class="term-foot">
      <span>출력 <b>${outLines}</b>줄</span>
      ${errLines ? html`<span style="color:#ff8a80">stderr <b>${errLines}</b>줄</span>` : ""}
      ${running ? html`<span class="pulse" style="color:var(--working)">실행 중 · <b data-elapsed="${call.ts}">${fmtDur((Date.now() - call.ts) / 1000)}</b></span>` : html`<span>걸린 시간 <b>${fmtDur(call.dur)}</b></span>`}
      <span class="grow"></span>
      <button class="btn ghost sm" data-action="copy" data-copy="${maskSecrets(cmd).text.replace(/\u0001\d+\u0001/g, "****")}">${icon("copy", 12)} 명령 복사${secrets ? " (비밀값 제외)" : ""}</button>
    </div>
  </div>`;
}

// Codex's exec tool: JavaScript that calls the real tools (each also listed on its own).
function renderExecScript(call) {
  const text = call.result?.text ?? "";
  return html`<div class="dim" style="margin-bottom:8px;font-size:var(--fs-sm)">Codex가 도구를 부르는 스크립트예요. 실행한 명령은 각각 따로 기록돼요.</div>
    <div class="box">${codeView(call.input?.code ?? "", { lang: "js", scrollKey: `exec-${call.id}` })}</div>
    ${text ? html`<div class="term" style="margin-top:10px"><div class="term-body"><div class="term-out">${raw(outputHTML(call, maskedText(text), false, `out:${call.id}`))}</div></div></div>` : ""}`;
}
