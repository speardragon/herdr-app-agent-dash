# Agent Dash

A window over the Herdr layout that shows what each coding agent did. A rail on the left
lists the agents (by status or by space, sub-agents nested under the agent that started
them). The rest is one agent's history through six lenses: overview, tool calls, links,
prompts, changes and sub-agents. Every tool call has a view made for that tool. The data
comes from the agents' own transcripts on disk, read incrementally while they work. A button
opens the same view as a web page served from this computer. The interface text is Korean.

![Agent Dash](preview.png)

## What you see

- **Window.** `mod.json` overlay `kind: "window"`, 86% of the layout's width and height,
  `background` color. A row: the rail, then a column of head, lens tabs and lens body.
- **Rail**, 264 px wide (60 px, icons only, when the window is narrower than 980 px),
  `chrome` background, 1 px `border` on the right.
  - Header, 44 px: a layers icon in `accent`, "에이전트", the count of agents, and
    "· 하위 n" when sub-agents are live.
  - A pill toggle, 34 px high, fully rounded, 1 px border: "상태별" (by status) and
    "스페이스별" (by space). The chosen half has the `raised` background.
  - "전체 현황" row, 38 px, with small count badges for blocked, working and done.
  - **By status:** group headers (a 6 px dot in the status color, the label, a count) in the
    order blocked, working, done, idle. Agent rows are 46 px: the program's icon at 22 px,
    the title at 12.5 px, a second line (what it reports doing, in `working`, or
    "space › tab" in `dim`), and on the right the status glyph and the time since the
    status changed.
  - **By space:** a 32 px row per space (an 18 px avatar: the space's logo, emoji, or its
    first letter on its color; the name; a chevron). Under it "에이전트 n" and the agents,
    each 32 px, hanging off a 1 px line that runs down from the avatar with a 9 px stub.
    The colors and logos are read from shared `space.colors` and `space.logos`, which the
    `ray-sidebar` mod writes; without them every space gets its first letter on `ansi6`.
  - Sub-agent rows are 28 px with tree lines (└ ├ │), a 15 px icon and a small mark:
    spinner, `!`, ring, a play triangle for a plain program, a check or ✕ for one that ended.
- **Head**, one agent: a 30 px program icon, the title at 16 px semibold, a line of
  program · space › tab · model · folder · branch at 11.5 px `dim`, a status pill with the
  time, and buttons "웹에서 열기", "엿보기", "터미널로" and, in an overlay, a close button.
  A sub-agent shows a chip "‹parent›의 하위 에이전트" instead of space › tab.
- **Lens tabs**, 36 px: icon, label, a count badge; a 2 px `accent` underline on the
  selected one. "하위 에이전트" appears only when the agent has sub-agents.
- **Lenses.**
  - 개요: four stat cards (tokens with a cache bar, context %, activity by tool kind,
    changed files), a "now" card with the running or last call and the last reply as
    Markdown, the sub-agents, the recent prompts, the changed files.
  - 도구 호출: left, a virtual list, newest first. A 46 px band per prompt (3 px `accent`
    bar, `#n` chip, the prompt's first line in bold, "호출 n", relative time), then 32 px
    call rows (status mark, tool icon, title, target in mono, a digest such as "+6 −2" or
    "18줄", the clock time). Right, the selected call's view.
  - 링크: a toggle "전체 / 내가 보낸 / 에이전트 답변", chips per domain, 52 px rows with a
    host tile and a small corner mark (speech bubble on `accent` for yours, a bot for the
    agent's). Right: title, URL, the sentence it was in, the URL taken apart, the text
    around it.
  - 프롬프트: 58 px rows (`#n`, first line, time, calls, duration). Right: the prompt, four
    stats, a bar by tool kind, the changed files, the final answer as Markdown.
  - 변경: 44 px file rows (A/M, name, folder, +/−). Right: a cumulative diff or the edits
    one by one, unified or side by side.
  - 하위 에이전트: left, the tree with each one's current step; right, the picked one's
    task, last reply, four stats and its steps, newest first.
- **Tool views.** Shell: the command highlighted and the output with ANSI colors. Edit,
  Write, apply_patch: diffs with word-level marks. Read: the file with the read range
  marked. Grep and Glob: matches by file. WebFetch and WebSearch. Task and Agent calls.
  MongoDB MCP: the query as shell syntax and the result as a table, documents or JSON.
  Jira, Notion and Slack MCP: white sheets in those sites' own light themes (issue page,
  work-item list, comment; page with properties and blocks, search, database rows; thread,
  channel, search). Any other MCP tool: arguments as a table and the result as a JSON tree.
  Every view ends with a foldable "원본 입력·출력".
- **전체 현황** is empty for now: only its name, centered.

## How it behaves

- **Opening.** `cmd-shift-a` runs `mod.open:agent-dash`. It opens on the agent whose
  terminal had the keyboard (`focused()`), or on 전체 현황 when that is not an agent, and
  takes the keyboard on its first tick after the first render.
- **Statuses.** `working`: a spinner, and the reported message in the rail. `blocked`: a
  red `!`; "응답 필요". `done`: a filled dot; "완료". `idle`: a ring; "대기". An agent sits
  in the group of its most urgent live sub-agent. A sub-agent's `error` counts as blocked
  and its `done` as idle; a plain program is "실행 중"; a finished one "끝남".
- **Keys.** `1`–`6` pick a lens, `0` 전체 현황, `[` `]` the previous or next agent in the
  rail's order, `j` `k` or the arrows move through the call list, `f` toggles following
  the newest call, `Esc` closes the window (on a window narrower than 860 px it first goes
  back from a detail to its list).
- **Clicks.** A rail row picks that agent; a plain program opens its parent's sub-agent
  lens instead. A space row folds it. A call row shows its view. A step in the sub-agent
  lens opens that call in the sub-agent's own lenses. A changed file opens the 변경 lens.
  Links open in the browser. Every clickable row lights up on hover.
- **Following.** With "따라가기" on, a new call is selected and the list stays at the top.
  Picking another call turns it off.
- **Live data.** Every 1.5 s the mod asks which agents are due: the selected one every
  1.5 s while working (5 s otherwise), its sub-agents every 2.5 s, the rest every 12–60 s.
  Each read continues from the last byte offset.
- **Sub-agents that exit.** They leave `terminals()`. The mod keeps the node for up to 20 s
  while `hc ls --all` and `hc get` answer, reads the transcript once more, then keeps it for
  24 hours (30 minutes in the rail). A sub-agent started with `--rm`, or removed with
  `hc rm`, is gone.
- **Mod commands** (`agent-dash.<command>`): a lens id, `all`, `scope:<address>`,
  `agent-next`, `agent-prev`, `call-next`, `call-prev`, `follow`, `web`, `group:status`,
  `group:space`, `select:<call id>`, `sub:<address>`, `ui:<key>=<value>`, `focus`.
- **Web.** "웹에서 열기" starts `bin/server.py` through `hc run --bg --no-parent --rm
  --name agent-dash-web`, waits for `/health`, and opens
  `http://127.0.0.1:<port>/#t=<token>&agent=…&lens=…&call=…`. The page keeps the token in
  `sessionStorage` and removes it from the address.

## Built from

- **`mod.json`:** `{ "place": "none", "title": "Agent Dash", "focusable": true, "overlay":
  { "kind": "window", "key": "agent-dash", "width": 0.86, "height": 0.86 } }`. No layout
  changes. `keys.json` binds `cmd-shift-a`.
- **`main.js`:** one `View`. State: scope, lens, selection per scope, kind filter, follow,
  detailOpen, a `ui` map. It builds the roster, drives the store, and hands each lens a
  context object.
- **`lib/`** (pure, shared with the web page): `session.js` reduces transcript events into
  a session (prompts, replies, calls, files, links, usage) one batch at a time;
  `tools.js` (kinds, titles, targets, digests, secret masking); `diff.js` (Myers diff, word
  marks); `highlight.js` (tokenizer); `tree.js` (agents and sub-agents as one tree);
  `links.js`; `mongo.js`; `jira.js`, `notion.js`, `slack.js` (MCP results into view models);
  `rich.js` (Markdown and Notion's tags into styled runs); `ansi.js`, `format.js`, `paths.js`.
- **`data/`:** `reader.js` runs `bin/transcript.py` and parses its NDJSON; `store.js` keeps
  a session per agent; `ended.js` finds finished sub-agents; `web.js` starts the server.
- **`bin/`** (Python 3, standard library): `transcript.py` (`sync`, `read`, `original`),
  `tx_claude.py` and `tx_codex.py` (one transcript line into compact events, large results
  trimmed, base64 dropped), `server.py` (the web server).
- **`ui/`:** `kit.js` (theme tokens, icons, glyphs, buttons), `rail.js`, `head.js`, one file
  per lens, `code.js` (code and diff boxes), `stage/` (one file per tool family).
- **`herdr` functions:** `agents`, `terminals`, `panes`, `machines`, `spaces`, `shared`,
  `focused`, `home`, `appHome`, `theme`, `settings`, `exec`, `readTextFile`, `run`,
  `notify`, `setAgentOrder`, `nextCommand`, `props`, `closeOverlay`.
  Commands: `agent.focus`, `terminal.peek`.
- **Programs it runs:** `python3`, `hc` (`ls --all`, `get`, `run`), `git` (`rev-parse`,
  `show HEAD:<file>`), `sleep` while waiting for the web server.
- **Files it reads outside its folder:** `~/.claude/projects`, `~/.claude/sessions`,
  `~/.claude/file-history`, `~/.codex/sessions`, and files the agents changed.
- **Art:** about a hundred line icons from Lucide as SVG in `icons/`, plus small marks for
  Jira issue types, Jira, Notion, Slack and MongoDB drawn for this mod.
- **Web page:** `web/` in the repo (plain JS and CSS, no framework), built by
  `node web/build.mjs` into one `web/index.html` that imports the mod's `lib/` from the
  server.

## Watch out

- **The render budget.** Mods run on QuickJS without a JIT, and a render that takes too long
  is dropped ("This view could not be re-rendered … interrupted"); the view then shows its
  last frame. Everything a render needs must already be computed:
  - reduce transcripts incrementally, not from scratch;
  - memoize per call (row text, parsed MCP views) and parse long documents in a spawned
    task, not in `render`;
  - tokenize only visible rows; a whole 250-line file in one render is already too much;
  - mask secrets once per document, not once per word;
  - cap what is drawn (400 calls in a fleet list, 150 steps, 600 characters per line).
- `FocusHandle.focus()` throws inside a render and stalls the view if called before the
  first one. Call it from a tick after the first render.
- Handlers are not allowed inside a `v_virtual_list` renderer; use `on_item_click`.
  `.hover(...)` is a style and is fine there.
- A box that scrolls only sideways (`overflow_x_scroll`) turns an up/down wheel into
  sideways movement, so the page drifts diagonally. Use `overflow_scroll` on a box whose
  height is its content's. `Scrollbar.horizontal(id).mode("always")` stalled the view.
- `line_height` takes a multiplier, not pixels. Numeric `font_weight` did not take; the
  named ones (`font_medium`, `font_semibold`, `font_bold`) do.
- `image()` reads from the app folder only: copy pictures into the mod's `.cache/`.
- `exec` output is cut at 8 MiB without an error and `readTextFile` stops at 1 MiB, so the
  Python helper pages its output and ends every reply with an `end` record.
- Hidden folders (`.cache`, `.web`) do not trigger a hot reload; anything else written
  into the mod folder does.
- `terminals()` lists live terminals only; finished ones need `hc ls --all` and `hc get`.
- A sub-agent often shares its parent's folder. Its transcript is matched by its start time
  and by its launch task appearing in the transcript's head, never by "the newest file".
- Codex publishes no session id: the transcript is the rollout written in the same folder
  since the process started, shown as "추정 연결".
- Limits and gaps: local agents only; Claude Code and Codex only; 전체 현황 is empty;
  Jira, Notion and Slack views draw people as initials (the MCP sends no pictures); the
  Slack look was not compared with the live site; clicks and keys were checked by hand,
  not by an automated test; tested on macOS only.

## Done when

- `herdr-app check mods/agent-dash` passes.
- `cmd-shift-a` on a Claude Code agent opens the window on that agent; `Esc` closes it.
- While an agent works, its new tool calls appear at the top of 도구 호출 within about two
  seconds, and the header's timer keeps moving (a stalled view shows no error).
- Opening an Edit call shows a diff; a Write of a few hundred lines opens without the
  "could not be re-rendered" banner; scrolling it up and down does not move it sideways.
- 변경 shows the same file's cumulative diff against the text from before the agent's
  first edit.
- A prompt that contains a URL lists that link under "내가 보낸"; a reply's link is under
  "에이전트 답변".
- `hc run --bg --name helper claude "<task>"` from an agent's terminal: `helper` appears
  under that agent in the rail, the 하위 에이전트 tab appears, and its steps fill in. After
  `hc kill helper` it stays, marked as ended, with the same steps.
- "상태별 / 스페이스별" switches the rail, and the choice is still there after reopening.
- "웹에서 열기" opens the browser on the same agent and lens within a few seconds; the
  same URL without the token answers 401; `hc ls` shows `agent-dash-web`.
- A command or output containing `password=…` or a `https://user:secret@host` URL shows
  `••••` in the list, the view and the raw section.
