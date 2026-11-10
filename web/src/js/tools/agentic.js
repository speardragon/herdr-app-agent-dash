// Agent (sub-agent), TodoWrite / update_plan, AskUserQuestion, ExitPlanMode, Skill.

function renderAgent(call) {
  const i = call.input;
  const x = call.result?.extra ?? {};
  const r = {
    toolUses: x.totalToolUseCount,
    tokens: x.totalTokens,
    report: x.content || (x.status ? "" : call.result?.text ?? "") || (x.status === "async_launched" ? "백그라운드에서 실행 중이에요. 끝나면 결과가 대화에 들어와요." : ""),
  };
  const steps = childCalls(call.id);
  const open = uiGet(`${call.id}:prompt`, false);
  return html`<div class="sub">
    <div class="sub-h">
      <div class="sub-av">${icon("users", 18)}</div>
      <div style="min-width:0">
        <h3>${i.description}</h3>
        <div class="row" style="margin-top:5px"><span class="chip mono">${i.subagent_type}</span>${i.model ? html`<span class="chip mono">${i.model}</span>` : ""}<span class="chip">별도 컨텍스트</span></div>
      </div>
      <div class="sub-stats">
        <div class="dstat"><b>${steps.length || r.toolUses || 0}</b>단계</div>
        <div class="dstat"><b>${r.tokens ? fmtK(r.tokens) : "–"}</b>토큰</div>
        <div class="dstat"><b>${call.status === "running" ? "…" : fmtDur(call.dur)}</b>걸린 시간</div>
      </div>
    </div>
    <div class="sub-prompt ${open ? "open" : ""}"><div class="lbl" style="margin-bottom:4px">맡긴 일</div>${md(i.prompt)}</div>
    <button class="sub-more" data-action="ui-toggle" data-key="${call.id}:prompt">${open ? "접기" : "전부 보기"}</button>
    <div class="steps">
      <div class="lbl" style="padding:6px 8px 4px">서브에이전트가 한 일 · 눌러서 열기</div>
      ${steps.length
        ? steps.map(
            (s) => html`<button class="step" data-action="select-call" data-call="${s.id}" style="--kc:${kindColor(s)}">
              <span class="rail-line" aria-hidden="true"></span>
              <span style="color:${kindColor(s)};display:inline-flex">${toolIcon(s, 14)}</span>
              <b>${toolTitle(s)}</b>
              <span class="mono muted truncate" style="font-size:12px">${toolTarget(s)}</span>
              <span class="row" style="gap:8px">${digestHTML(s)}<span class="dim num" style="font-size:11.5px">${fmtDur(s.dur)}</span></span>
            </button>`,
          )
        : html`<div class="dim" style="padding:6px 8px">첫 단계를 기다리는 중…</div>`}
    </div>
    ${r.report ? html`<div class="report"><div class="lbl" style="margin-bottom:6px">돌려준 보고</div>${md(r.report)}</div>` : ""}
  </div>`;
}

const TODO_GLYPH = { completed: "●", in_progress: "◐", pending: "○" };

function todoIcon(status) {
  if (status === "completed") return raw(`<span style="color:var(--accent);display:inline-flex">${icon("circle-check", 16).s}</span>`);
  if (status === "in_progress") return raw(`<span style="color:var(--working);display:inline-flex">${icon("circle-half", 16).s}</span>`);
  return raw(`<span style="color:var(--dim);display:inline-flex">${icon("circle", 16).s}</span>`);
}

function renderTodo(call) {
  const isPlan = call.name === "update_plan";
  const items = isPlan ? call.input.plan.map((p) => ({ content: p.step, status: p.status })) : call.input.todos;
  const old = call.result?.extra?.old ?? previousItems(call) ?? [];
  const done = items.filter((t) => t.status === "completed").length;
  const doing = items.filter((t) => t.status === "in_progress").length;
  const owner = agentById(call.agent)?.app === "codex" ? "@codex" : "@claude";
  return html`${isPlan && call.input.explanation ? html`<div class="br-prompt" style="margin:0 0 14px">${icon("info", 14)}<div>${call.input.explanation}</div></div>` : ""}
  <div class="todo-prog">
    <b style="font-size:var(--fs-md)">${isPlan ? "계획" : "할 일"}</b>
    <div class="todo-bar" role="img" aria-label="${items.length}개 중 ${done}개 완료">
      <i class="c" style="width:${(done / items.length) * 100}%"></i><i class="p" style="width:${(doing / items.length) * 100}%"></i>
    </div>
    <span class="num muted">${done}/${items.length}</span>
  </div>
  <div class="box" style="padding:6px">${items.map((t, k) => {
    const prev = old.find((o) => o.content === t.content);
    const changed = prev && prev.status !== t.status;
    const fresh = old.length && !prev;
    return html`<div class="todo-item ${t.status} ${changed || fresh ? "changed" : ""}">
      <span class="ic">${todoIcon(t.status)}</span>
      <span class="no">#${k + 1}</span>
      <span class="tx">${t.content}${t.status === "in_progress" && t.activeForm ? html`<span class="af">${t.activeForm}…</span>` : ""}</span>
      <span class="row" style="gap:6px;justify-content:flex-end">
        ${changed ? html`<span class="trans" title="이번 호출에서 바뀜">${TODO_GLYPH[prev.status]} → ${TODO_GLYPH[t.status]}</span>` : ""}
        ${fresh ? html`<span class="trans new">새 항목</span>` : ""}
        ${t.blockedBy ? html`<span class="blockedby">#${t.blockedBy} 기다림</span>` : ""}
        ${t.status === "in_progress" ? html`<span class="owner">${owner}</span>` : ""}
      </span>
    </div>`;
  })}</div>
  ${old.length ? html`<div class="dim" style="font-size:var(--fs-xs);margin-top:8px">왼쪽 선은 이번 호출에서 바뀐 항목이에요. 이전 상태: ${old.map((o) => TODO_GLYPH[o.status]).join(" ")}</div>` : ""}`;
}

function renderAsk(call) {
  // Codex asks with request_user_input ({title, options: [text]}); its answer comes back as a prompt.
  const qs = (call.input.questions || []).map((q) => ({
    header: q.header ?? "질문",
    question: q.question ?? q.title ?? "",
    multiSelect: !!q.multiSelect,
    options: (q.options ?? []).map((o) => (typeof o === "string" ? { label: o } : o)),
  }));
  const answers = call.result?.extra?.answers ?? codexAnswers(call);
  const pending = call.status === "pending" || call.status === "running";
  return html`${qs.map((q) => {
    const ans = answers[q.header] ?? answers[q.question];
    const picked = ans ? (q.multiSelect ? ans.split(", ") : [ans]) : [];
    const typed = ans && !q.options.some((o) => picked.includes(o.label));
    const previewOpt = q.options.find((o) => o.preview && picked.includes(o.label)) || q.options.find((o) => o.preview);
    return html`<div class="ask">
      <div class="row"><span class="ask-head">${q.header}</span>${q.multiSelect ? html`<span class="chip">여러 개 선택</span>` : ""}${pending ? html`<span class="pill blocked">대답 기다리는 중</span>` : ""}</div>
      <div class="ask-q">${q.question}</div>
      <div class="ask-body ${previewOpt ? "with-preview" : ""}">
        <div>${q.options.map((o, k) => {
          const on = picked.includes(o.label);
          return html`<div class="opt ${on ? "on" : ""} ${q.multiSelect ? "multi" : ""}">
            <span class="rd" aria-hidden="true"></span>
            <div><div class="lb">${o.label}</div>${o.description ? html`<div class="ds">${o.description}</div>` : ""}</div>
            ${on ? html`<span class="picked">${icon("check", 12)} 선택</span>` : html`<span class="kbd">${k + 1}</span>`}
          </div>`;
        })}</div>
        ${previewOpt ? html`<div><div class="lbl" style="margin-bottom:6px">미리보기 · ${previewOpt.label}</div><div class="ask-preview">${previewOpt.preview}</div></div>` : ""}
      </div>
      ${typed ? html`<div class="ask-typed">${icon("pen", 13)} 직접 입력한 답: <b style="color:var(--foreground)">${ans}</b></div>` : ""}
      ${call.result?.extra?.annotations?.[q.question]?.notes ? html`<div class="ask-typed">${icon("message", 13)} 메모: ${call.result.extra.annotations[q.question].notes}</div>` : ""}
    </div>`;
  })}
  ${pending ? html`<div class="perm-foot">${icon("info", 13)} 답은 에이전트의 터미널에서 해요. <button class="btn sm" data-action="boundary" data-cmd="herdr-app do agent.focus --terminal ${call.agent}">herdr에서 열기 ${icon("arrow-up-right", 12)}</button></div>` : ""}`;
}

function renderPlan(call) {
  const r = { approved: !!call.result && !call.result.err, feedback: call.result?.err ? call.result.text : "" };
  const status = call.status === "pending" ? html`<span class="pill blocked">승인 기다리는 중</span>` : r.approved ? html`<span class="pill ok">${icon("check", 12)} 승인됨</span>` : html`<span class="pill err">거절됨</span>`;
  return html`<div class="plan">
    <div class="plan-h">${icon("map", 15)} <b style="color:var(--foreground)">계획 모드 종료 요청</b> ${status}
      ${r.mode ? html`<span class="chip">${r.mode === "auto" ? "자동 수락으로 진행" : "편집마다 확인"}</span>` : ""}
      <span class="grow"></span>
      <button class="btn ghost sm" data-action="copy" data-copy="${call.input.plan}">${icon("copy", 12)} 계획 복사</button>
    </div>
    <div class="plan-b">${md(call.input.plan)}</div>
    ${r.feedback ? html`<div class="ask-typed" style="margin:0 16px 16px">${icon("message", 13)} 피드백: ${r.feedback}</div>` : ""}
  </div>`;
}

function renderSkill(call) {
  const i = call.input;
  const x = call.result?.extra ?? {};
  const r = { source: x.commandName ? `/${x.commandName}` : "", description: x.success === false ? "스킬을 불러오지 못했어요" : "스킬 지침을 불러왔어요", routed: null, allowedTools: [] };
  return html`<div class="skill">
    <div class="skill-ic">${icon("sparkles", 26)}</div>
    <div style="min-width:0">
      <div class="row"><h3>${i.skill}</h3>${r.routed ? html`<span class="chip">${icon("arrow-right", 11)} ${r.routed}로 넘김</span>` : ""}</div>
      <div class="dim" style="font-size:var(--fs-xs);margin-top:2px">${r.source}</div>
      <div class="desc">${r.description}</div>
      ${i.args ? html`<div class="args"><span class="dim">args </span>${i.args}</div>` : ""}
      ${r.allowedTools?.length ? html`<div class="chips" style="margin-top:10px">${r.allowedTools.map((t) => html`<span class="chip mono">${t}</span>`)}</div>` : ""}
    </div>
  </div>`;
}

// The list the previous TodoWrite/update_plan call left, for "what changed this time".
function previousItems(call) {
  const prev = [...callsOf(call.agent)].reverse().find((c) => c.name === call.name && c.ts < call.ts);
  if (!prev) return null;
  return prev.name === "update_plan" ? (prev.input.plan ?? []).map((p) => ({ content: p.step, status: p.status })) : prev.input.todos ?? [];
}

function codexAnswers(call) {
  const reply = promptsOf(call.agent).find((p) => p.ts >= call.ts && p.kind === "answer");
  if (!reply) return {};
  try {
    const list = JSON.parse(reply.text.replace(/^<send_user_message_question_reply>\s*/, "").replace(/<\/send_user_message_question_reply>\s*$/, ""));
    return Object.fromEntries(list.map((a) => [a.question, a.answer]));
  } catch {
    return {};
  }
}
