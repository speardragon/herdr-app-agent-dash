// The stage: one call, its header, an approval prompt when blocked, the tool's own renderer,
// and the raw input/result underneath.

function rendererFor(call) {
  if (isMongo(call)) return renderMongo;
  if (call.name.startsWith("mcp__")) return renderMcpGeneric;
  switch (call.name) {
    case "Bash":
    case "shell":
      return renderShell;
    case "Read":
      return renderRead;
    case "Edit":
    case "MultiEdit":
      return renderEdit;
    case "Write":
      return renderWrite;
    case "apply_patch":
      return renderPatch;
    case "Grep":
      return renderGrep;
    case "Glob":
      return renderGlob;
    case "WebFetch":
      return renderWebFetch;
    case "WebSearch":
      return renderWebSearch;
    case "Agent":
    case "Task":
      return renderAgent;
    case "TodoWrite":
    case "update_plan":
      return renderTodo;
    case "AskUserQuestion":
      return renderAsk;
    case "ExitPlanMode":
      return renderPlan;
    case "Skill":
      return renderSkill;
    default:
      return genericBody;
  }
}

// Any tool: its input as a table, its result as text (JSON spread out).
function genericBody(call) {
  const entries = Object.entries(call.input ?? {}).filter(([, v]) => v !== "" && v != null);
  const text = call.result?.text ?? "";
  let shown = text;
  try {
    if (/^\s*[[{]/.test(text)) shown = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    shown = text;
  }
  return html`${entries.length ? html`<div class="box"><table class="kvt">${entries.slice(0, 40).map(([k, v]) => html`<tr><th>${k}</th><td class="mono">${maskedText(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 3000)}</td></tr>`)}</table></div>` : ""}
    ${shown ? html`<div class="box" style="margin-top:10px">${codeView(maskedText(shown).slice(0, 200000), { lang: /^\s*[[{]/.test(shown) ? "json" : "text", scrollKey: `gen-${call.id}` })}</div>` : ""}`;
}

function toolUseId(call) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnopqrstuvwxyz";
  let h = hashStr(call.id);
  let s = "";
  for (let k = 0; k < 22; k++) {
    s += alphabet[h % alphabet.length];
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
  }
  return call.id || (agentById(call.agent)?.app === "codex" ? `call_${s.slice(0, 24)}` : `toolu_01${s}`);
}

function statusPill(call) {
  switch (call.status) {
    case "running":
      return html`<span class="pill working">${spinner(12)} 실행 중</span>`;
    case "pending":
      return html`<span class="pill blocked">${icon("alert", 12)} 승인 대기</span>`;
    case "error":
      return html`<span class="pill err">${icon("circle-x", 12)} 실패</span>`;
    case "interrupted":
      return html`<span class="pill unknown">중단됨</span>`;
    default:
      return html`<span class="pill ok">${icon("check", 12)} 완료</span>`;
  }
}

function permissionBanner(call) {
  if (call.status !== "pending" || !call.permission) return "";
  const p = call.permission;
  const a = agentById(call.agent);
  return html`<div class="perm" role="region" aria-label="승인 요청">
    <div class="perm-h">${icon("alert", 15)}<span>응답 필요 · <span data-elapsed-ko="${call.ts}">${fmtDurKo((Date.now() - call.ts) / 1000)}</span>째 기다리는 중</span></div>
    <div class="perm-q">${p.question}</div>
    <div class="perm-opts">${p.options.map(
      (o, k) => html`<button class="perm-opt" data-action="boundary" data-cmd="hc send ${a.id} '${k + 1}'" data-note="답은 에이전트 터미널로 보냅니다">
        <span class="kbd">${k + 1}</span>${o}
      </button>`,
    )}</div>
    <div class="perm-foot"><span class="grow" style="text-align:left">${icon("info", 12)} ${p.impact}</span>
      <button class="btn sm" data-action="boundary" data-cmd="herdr-app do agent.focus --terminal ${a.id}">herdr에서 열기 ${icon("arrow-up-right", 12)}</button>
    </div>
  </div>`;
}

function rawSection(call) {
  const cut = (s) => (s.length > 6000 ? `${s.slice(0, 6000)}\n… (${fmtInt(s.length - 6000)}자 더)` : s);
  const input = cut(maskedText(JSON.stringify(call.input || {}, null, 2)));
  const result = call.result ? cut(JSON.stringify(call.result, null, 2)) : "null";
  return html`<details class="raw" ${STATE.openFolds.has(`raw:${call.id}`) ? raw("open") : ""} data-raw="${call.id}">
    <summary>${icon("chevron-right", 12, "chev")} 원본 입력·결과 <span class="mono">${toolUseId(call)}</span></summary>
    <div class="raw-grid">
      <div><div class="raw-lbl">INPUT</div><pre>${raw(hl(input, "json").join("\n"))}</pre></div>
      <div><div class="raw-lbl">RESULT</div><pre>${raw(hl(result, "json").join("\n"))}</pre></div>
    </div>
  </details>`;
}

function stageMeta(call) {
  return html`<div class="stage-meta">${statusPill(call)}<span class="when num">${hhmmss(call.ts)}</span>${call.dur != null ? html`<span class="num">${fmtDur(call.dur)}</span>` : call.status === "running" ? html`<span class="num" data-elapsed="${call.ts}">${fmtDur((Date.now() - call.ts) / 1000)}</span>` : ""}</div>`;
}

function stageView(call, { compact = false } = {}) {
  if (!call) {
    return html`<div class="empty"><div class="e-ico">${icon("terminal", 20)}</div><h3>호출을 고르면 여기서 열려요</h3><p>도구마다 원래 화면으로 보여줘요: Bash는 터미널, Edit는 편집기, Mongo는 Compass.</p></div>`;
  }
  const parent = call.parent ? callById(call.parent) : null;
  const p = mcpParts(call.name);
  const ownHeader = !!p;
  let body;
  try {
    body = rendererFor(call)(call);
  } catch (error) {
    body = html`<div class="err-card">${icon("circle-x", 15)}<div><b>이 호출을 그리지 못했어요</b>${String(error?.message ?? error)}</div></div>${genericBody(call)}`;
  }
  return html`<div class="stage"><div class="stage-in">
    ${parent ? html`<div class="crumb-nav"><button data-action="select-call" data-call="${parent.id}">${icon("arrow-left", 12)} ${toolTitle(parent)} · ${parent.input.description}</button><span>안의 단계</span></div>` : ""}
    ${ownHeader ? "" : html`<div class="stage-head">
      <div class="kind-tile" style="--kc:${kindColor(call)}">${toolIcon(call, 17)}</div>
      <div style="min-width:0;flex:1">
        <div class="stage-title"><span>${toolTitle(call)}</span>${p ? html`<span class="chip mono">${p.server}</span>` : ""}</div>
        <div class="stage-sub truncate" title="${toolTarget(call)}">${toolTarget(call)}</div>
      </div>
      ${stageMeta(call)}
    </div>`}
    ${permissionBanner(call)}
    ${body}
    ${compact ? "" : rawSection(call)}
  </div></div>`;
}
