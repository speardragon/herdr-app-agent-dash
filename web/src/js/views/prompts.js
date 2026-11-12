// Prompts lens: what you asked, by day (prompt-history), and what each prompt set off.

function scopePrompts() {
  const list = STATE.scope === "all" ? DB.prompts : promptsOf(STATE.scope);
  return [...list].sort((a, b) => b.ts - a.ts);
}

const promptKey = (p) => `${p.agent}:${p.n}`;

function selectedPrompt(list) {
  const key = STATE.sel.prompt[scopeKey()];
  return list.find((p) => promptKey(p) === key) || list[0] || null;
}

function oneLine(text) {
  return raw(
    text
      .split("\n")
      .filter((l, i, arr) => l.trim() || i < arr.length - 1)
      .map((l) => esc(l.trim()))
      .join('<span class="nl">↵</span>'),
  );
}

// The prompt's own text for the list: two lines at most (CSS cuts with …), blank lines dropped.
function promptLabel(p) {
  return (p.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n") || (p.images ? `이미지 ${p.images}개` : "");
}

function promptRow(p, selected) {
  const a = agentById(p.agent);
  return html`<button class="prompt-row" role="option" aria-selected="${selected}" data-action="select-prompt" data-key="${promptKey(p)}">
    <span class="n">${p.n}</span>
    <span class="row" style="min-width:0;gap:7px">${STATE.scope === "all" ? logo(a.app, 15) : ""}<span class="clamp2">${promptLabel(p)}</span></span>
    <span class="rt" data-rel="${p.ts}">${relTime(p.ts)}</span>
  </button>`;
}

// What the agent thought before an answer: a "생각함 · 5초" line that opens into the thoughts.
// Which ones are open is kept here, so a redraw (new events arrive) leaves them as they were.
const THINK_OPEN = new Set();
document.addEventListener("toggle", (e) => {
  const key = e.target?.dataset?.think;
  if (!key) return;
  if (e.target.open) THINK_OPEN.add(key);
  else THINK_OPEN.delete(key);
}, true);

function thinkingHTML(key, thoughts) {
  if (!thoughts?.length) return "";
  const ms = thoughts.reduce((sum, x) => sum + (x.dur ?? 0), 0);
  return html`<details class="cthink" data-think="${key}" ${THINK_OPEN.has(key) ? "open" : ""}>
    <summary><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.2c3.3 0 6 2.2 6 5s-2.7 5-6 5c-.6 0-1.200-.1-1.700-.2L3 13.600l.7-2.500C2.600 10.200 2 8.800 2 7.200c0-2.800 2.700-5 6-5Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      <b>생각함</b>${ms >= 500 ? html`<span class="secs">· ${LF.fmtDur(ms / 1000)}</span>` : ""}<span class="chev" aria-hidden="true"></span></summary>
    <div class="cthink-body">${thoughts.map((x) => md(x.text, { numbers: new Map() }))}</div>
  </details>`;
}

function turnSummary(p) {
  const calls = callsOf(p.agent).filter((c) => c.turn === p.n);
  const next = promptsOf(p.agent).find((x) => x.n === p.n + 1);
  // Every answer of the turn, in order: an agent that thinks between steps answers several times.
  const replies = repliesOf(p.agent).filter((r) => r.turn === p.n).sort((x, y) => x.ts - y.ts);
  const reply = replies[replies.length - 1] ?? null;
  const end = reply ? reply.ts : next ? next.ts : Date.now();
  const files = uniq(calls.filter((c) => kindOf(c) === "edit").flatMap((c) => (c.name === "apply_patch" ? patchFiles(c.input.patch).map((f) => f.path) : [c.input.file_path])));
  const running = calls.some((c) => c.status === "running" || c.status === "pending");
  return { calls, reply, replies, files, secs: (end - p.ts) / 1000, running };
}

function promptDetail(p) {
  if (!p) return html`<div class="empty"><div class="e-ico">${icon("message", 20)}</div><h3>보낸 프롬프트가 없어요</h3></div>`;
  const a = agentById(p.agent);
  const t = turnSummary(p);
  const textHTML = raw(esc(p.text) + (p.images ? Array.from({ length: p.images }, (_, k) => ` <span class="att">${icon("image", 13).s} [Image #${k + 1}]</span>`).join("") : ""));
  const me = /^data:image\/(png|jpeg|webp|gif);base64,/.test(LIVE.me?.avatar ?? "") ? raw(`<img class="cav" src="${LIVE.me.avatar}" alt="나">`) : raw('<span class="cav me">나</span>');
  // Laid out like a chat in KakaoTalk's high-contrast look: what the prompt did first, then your
  // message (yellow, right) and the agent's answer (dark, left), both nearly full width.
  return html`<div class="prompt-detail">
    <div class="pd-head">
      <span class="no">#${p.n}</span><span>${clock(p.ts)} · <span data-rel="${p.ts}">${relTime(p.ts)}</span></span>
      ${STATE.scope === "all" ? html`<span class="chip">${logo(a.app, 13)} ${a.title}</span>` : ""}
      <span class="grow"></span>
      <button class="btn sm" data-action="chat-open" data-agent="${p.agent}" data-prompt="${p.n}" title="이 에이전트와 나눈 대화를 이어서 봐요">${icon("message", 13)} 전체 대화</button>
      <button class="btn sm" data-action="copy" data-copy="${p.text}">${icon("copy", 13)} 복사</button>
      ${t.calls.length ? html`<button class="btn sm primary" data-action="open-call" data-agent="${p.agent}" data-call="${[...t.calls].sort((x, y) => x.ts - y.ts)[0].id}" title="이 프롬프트가 부른 도구 호출로 이동">${icon("terminal", 13)} 이 턴의 호출 ${t.calls.length}개</button>` : ""}
    </div>
    <div class="ld-label" style="margin-top:14px">이 프롬프트가 한 일</div>
    <div class="after">
      <div class="stat"><div class="k">걸린 시간</div><div class="v">${t.running ? html`<span class="pulse" style="color:var(--working)">진행 중</span>` : fmtDurKo(t.secs)}</div></div>
      <div class="stat"><div class="k">도구 호출</div><div class="v">${t.calls.length}</div></div>
      <div class="stat"><div class="k">바뀐 파일</div><div class="v">${t.files.length}</div></div>
      <div class="stat"><div class="k">답변 속 링크</div><div class="v">${t.replies.reduce((n, r) => n + r.links.length, 0)}</div></div>
    </div>
    <div class="chat">
      <div class="lights chat-lights" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="cmsg me"><div class="cbody">
        ${p.images && p.at != null ? html`<div class="pd-imgs ${p.images > 1 ? "many" : ""}" style="--cols:${Math.min(p.images, 3)}">${Array.from({ length: Math.min(p.images, 8) }, (_x, k) => promptImage(p.agent, p.at, k))}</div>` : ""}
        <div class="cbubble pd-text">${textHTML}</div></div>${me}</div>
      <div class="cmsg ai"><span class="cav ai">${logo(a.app, 22)}</span><div class="cbody">
        ${t.replies.map((r) => html`${thinkingHTML(`${p.agent}|${r.n}`, r.thoughts)}<div class="cbubble reply">${md(r.text, { numbers: new Map() })}</div><div class="ctime">${clock(r.ts)}</div>`)}
        ${thinkingHTML(`${p.agent}|end${p.n}`, p.trailing)}
        ${t.running ? html`<div class="cbubble reply dim">아직 답하는 중이에요…</div>` : t.replies.length ? "" : html`<div class="cbubble reply dim">답변이 없어요.</div>`}</div></div>
    </div>
  </div>`;
}

// 전체 대화: everything said with one agent, in order, like a chat app: a line for each new day,
// the time beside each bubble. A window of turns is drawn; the rest is a button away.
const CHAT_PAGE = 30;

function chatWindow(agent, n) {
  const total = promptsOf(agent).length;
  const from = Math.max(1, Math.min(n - 1, total - CHAT_PAGE + 1));
  return { agent, from, to: from + CHAT_PAGE - 1 >= total ? null : from + CHAT_PAGE - 1 };
}

const chatDay = (ts) => new Date(ts).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
const sameMinute = (a, b) => Math.floor(a / 60000) === Math.floor(b / 60000);

function chatTurn(p, a, me, last) {
  const quiet = p.kind === "notice" || p.kind === "answer";
  const replies = repliesOf(p.agent).filter((r) => r.turn === p.n).sort((x, y) => x.ts - y.ts);
  const working = last && a.status === "working";
  const mine = quiet
    ? html`<div class="chat-note" id="chat-p-${p.n}">${clock(p.ts)} · ${(p.display || p.text || "").split("\n")[0].slice(0, 90)}</div>`
    : html`<div class="cmsg me" id="chat-p-${p.n}"><div class="cline"><span class="cstamp"><span>#${p.n}</span><span>${clock(p.ts)}</span></span><div class="cbody">
        ${p.images && p.at != null ? html`<div class="pd-imgs ${p.images > 1 ? "many" : ""}" style="--cols:${Math.min(p.images, 3)}">${Array.from({ length: Math.min(p.images, 8) }, (_x, k) => promptImage(p.agent, p.at, k))}</div>` : ""}
        ${p.text.trim() || !p.images ? html`<div class="cbubble pd-text">${p.text}</div>` : ""}</div></div>${me}</div>`;
  const theirs = replies.length || p.trailing?.length || working
    ? html`<div class="cmsg ai"><span class="cav ai">${logo(a.app, 22)}</span><div class="cbody">
        ${replies.map((r, i) => html`${thinkingHTML(`${p.agent}|${r.n}`, r.thoughts)}<div class="cline"><div class="cbubble reply">${md(r.text, { numbers: new Map() })}</div>
          <span class="cstamp">${!replies[i + 1] || !sameMinute(replies[i + 1].ts, r.ts) ? clock(r.ts) : ""}</span></div>`)}
        ${thinkingHTML(`${p.agent}|end${p.n}`, p.trailing)}
        ${working ? html`<div class="cline"><div class="cbubble reply dim">아직 답하는 중이에요…</div><span class="cstamp"></span></div>` : ""}</div></div>`
    : "";
  return html`${mine}${theirs}`;
}

function chatAll(win) {
  const a = agentById(win.agent);
  const all = [...promptsOf(win.agent)].sort((x, y) => x.n - y.n);
  const total = all.length;
  const from = Math.max(1, Math.min(win.from, total));
  const to = win.to == null ? total : Math.min(win.to, total);
  const me = /^data:image\/(png|jpeg|webp|gif);base64,/.test(LIVE.me?.avatar ?? "") ? raw(`<img class="cav" src="${LIVE.me.avatar}" alt="나">`) : raw('<span class="cav me">나</span>');
  let day = null;
  const rows = all.filter((p) => p.n >= from && p.n <= to).map((p) => {
    const key = dayKey(p.ts);
    const line = key !== day ? html`<div class="chat-day"><span>${chatDay(p.ts)}</span></div>` : "";
    day = key;
    return html`${line}${chatTurn(p, a, me, p.n === total)}`;
  });
  return html`<div class="chat-all">
    <div class="chat-all-head">
      <button class="btn ghost sm" data-action="chat-close">${icon("arrow-left", 13)} 프롬프트 목록</button>
      ${logo(a.app, 16)}<b class="grow">${a.title}</b>
      <span class="dim">대화 ${total}개 중 ${from}~${to}번째</span>
    </div>
    <div class="chat-all-body" data-keep-scroll="chat-all-${esc(win.agent)}"><div class="chat">
      ${from > 1 ? html`<button class="btn sm chat-more" data-action="chat-more" data-dir="older">이전 대화 ${from - 1}개 중 ${Math.min(CHAT_PAGE, from - 1)}개 더 보기</button>` : ""}
      ${rows}
      ${to < total ? html`<button class="btn sm chat-more" data-action="chat-more" data-dir="newer">다음 대화 ${total - to}개 중 ${Math.min(CHAT_PAGE, total - to)}개 더 보기</button>` : ""}
    </div></div>
    <div class="chat-fabs">
      <button class="chat-fab" data-action="chat-jump" data-where="first" data-rest="${from > 1}" hidden>${icon("chevron-up", 14)} 첫 대화</button>
      <button class="chat-fab" data-action="chat-jump" data-where="last" data-rest="${to < total}" hidden>${icon("chevron-down", 14)} 마지막 대화</button>
    </div>
  </div>`;
}

// The jump buttons show when there is somewhere to go: "첫 대화" once you have scrolled up and are
// away from the start, "마지막 대화" whenever the latest message is not on screen (as a chat app's
// arrow does). Either also shows when the window of turns stops short of that end.
const CHAT_FAR = 600;
let chatLastTop = 0;
let chatGoingUp = false;

function chatFabSync() {
  const body = document.querySelector(".chat-all-body");
  if (!body) return;
  const top = body.scrollTop;
  const below = body.scrollHeight - body.clientHeight - top;
  if (Math.abs(top - chatLastTop) > 4) chatGoingUp = top < chatLastTop;
  chatLastTop = top;
  const [first, last] = document.querySelectorAll(".chat-fab");
  if (!first || !last) return;
  first.hidden = !(chatGoingUp && (top > CHAT_FAR || first.dataset.rest === "true"));
  last.hidden = !(below > CHAT_FAR || last.dataset.rest === "true");
}

document.addEventListener("scroll", (e) => {
  if (e.target?.classList?.contains("chat-all-body")) chatFabSync();
}, true);

function promptsLens() {
  if (STATE.chat && agentById(STATE.chat.agent) && promptsOf(STATE.chat.agent).length) return chatAll(STATE.chat);
  const list = scopePrompts();
  const sel = selectedPrompt(list);
  const byDay = groupBy(list, (p) => dayKey(p.ts));
  const body = list.length
    ? Object.values(byDay).map((ps) => html`<div class="list-sep"><span>${dayLabel(ps[0].ts)}</span></div>${ps.map((p) => promptRow(p, sel && promptKey(p) === promptKey(sel)))}`)
    : html`<div class="empty"><div class="e-ico">${icon("message", 20)}</div><h3>프롬프트가 없어요</h3></div>`;
  return html`<div class="split ${STATE.mobileDetail ? "has-detail" : ""}">
    <div class="pane-list">
      <div class="list-tools"><div class="row">
        <span class="grow" style="font-size:var(--fs-sm);color:var(--muted)">보낸 프롬프트 <b style="color:var(--foreground)">${list.length}</b>개 · 슬래시 명령 제외</span>
        <div class="seg" role="group" aria-label="시간 표기">
          <button data-action="locale" data-value="ko" aria-pressed="${UI.locale === "ko"}">한국어</button>
          <button data-action="locale" data-value="en" aria-pressed="${UI.locale === "en"}">EN</button>
        </div>
      </div></div>
      <div class="list-body" role="listbox" aria-label="프롬프트" data-keep-scroll="prompts-${esc(scopeKey())}">${body}</div>
    </div>
    <div class="pane-detail" data-keep-scroll="prompt-detail">
      <button class="btn ghost sm back-btn" style="margin:10px 0 0 12px" data-action="mobile-back">${icon("arrow-left", 13)} 목록</button>
      ${promptDetail(sel)}
    </div>
  </div>`;
}
