// Slack MCP calls -> messages the Slack-looking views draw. The MCP answers in text
// ("concise" or "detailed"); this reads both. Pure.

import { initials } from "./rich.js";
import { masked } from "./tools.js";

const suffix = (name) => String(name ?? "").split("__").pop();
const TOOLS = {
  slack_read_thread: "thread", slack_read_channel: "channel", slack_search_public: "search", slack_search_public_and_private: "search",
  slack_send_message: "sent", slack_send_message_draft: "sent", slack_schedule_message: "sent",
};

export const slackTool = (name) => (/slack/i.test(name ?? "") ? TOOLS[suffix(name)] ?? null : null);

const EMOJI = {
  wave: "👋", white_check_mark: "✅", heavy_check_mark: "✔️", link: "🔗", rocket: "🚀", pray: "🙏", "+1": "👍", thumbsup: "👍", eyes: "👀", tada: "🎉",
  "man-bowing": "🙇‍♂️", bow: "🙇", fire: "🔥", warning: "⚠️", x: "❌", heart: "❤️", smile: "😄", joy: "😂", thinking_face: "🤔", point_right: "👉",
  bulb: "💡", memo: "📝", pushpin: "📌", calendar: "📅", bell: "🔔", "100": "💯", ok_hand: "👌", clap: "👏", raised_hands: "🙌", sob: "😭", bug: "🐛",
  hourglass_flowing_sand: "⏳", rotating_light: "🚨", star: "⭐", zap: "⚡", lock: "🔒", mag: "🔍", speech_balloon: "💬", checkered_flag: "🏁",
};

/** Slack mrkdwn -> the Markdown lib/rich.js reads (mentions and links become runs there). */
export function mrkdwn(text) {
  return String(text ?? "")
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, (_m, name) => `<mention-user name="${name.replace(/"/g, "")}"/>`)
    .replace(/<@([A-Z0-9]+)>/g, (_m, id) => `<mention-user name="${id}"/>`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_m, name) => `<mention-page title="#${name.replace(/"/g, "")}"/>`)
    .replace(/<!(channel|here|everyone)>/g, (_m, who) => `<mention-user name="${who}"/>`)
    .replace(/<!subteam\^[A-Z0-9]+\|?([^>]*)>/g, (_m, name) => `<mention-user name="${(name || "그룹").replace(/^@/, "").replace(/"/g, "")}"/>`)
    .replace(/<(https?:\/\/[^|>\s]+)\|([^>]*)>/g, (_m, url, label) => `[${label.replace(/[\[\]]/g, "")}](${url.replace(/[()\s]/g, encodeURIComponent)})`)
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_m, url) => `[${url}](${url.replace(/[()\s]/g, encodeURIComponent)})`)
    .replace(/(^|[^A-Za-z0-9*\\])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![A-Za-z0-9*])/gm, "$1**$2**")
    .replace(/(^|[^A-Za-z0-9~])~([^~\s](?:[^~\n]*[^~\s])?)~(?![A-Za-z0-9~])/gm, "$1~~$2~~")
    .replace(/:([a-z0-9_+\-]+):/g, (m, name) => EMOJI[name] ?? m);
}

const who = (name) => {
  const clean = String(name ?? "").replace(/\u200b/g, "").trim();
  return { name: clean || "알 수 없음", initials: initials(clean || "?"), unknown: !clean };
};

// Masked once here, so the views don't mask every word they draw.
const message = (author, text, extra = {}) => ({ author: who(author), text: masked(mrkdwn(String(text ?? "").trim())), ...extra });

function resultText(call) {
  const raw = String(call.result?.text ?? "");
  try {
    const data = JSON.parse(raw);
    const body = data.messages ?? data.results ?? data.message ?? null;
    return { text: typeof body === "string" ? body : raw, data };
  } catch {
    return { text: raw, data: null };
  }
}

// "=== Message from NAME (ID) at TIME ===" blocks, as read_channel/read_thread write them in detail.
function detailed(text) {
  const out = [];
  const parts = text.split(/^=== Message from /m).slice(1);
  for (const part of parts) {
    const head = /^(.*?)\s*(?:\(([A-Z0-9]+)\))?\s+at\s+(.+?)\s*===\s*\n?/.exec(part);
    if (!head) continue;
    let body = part.slice(head[0].length);
    const meta = {};
    body = body.replace(/^Message TS:\s*(\S+)\s*$/m, (_m, ts) => ((meta.ts = ts), ""));
    body = body.replace(/^Thread:\s*(\d+)\s+repl(?:y|ies)[^\n]*$/m, (_m, n) => ((meta.replies = Number(n)), ""));
    body = body.replace(/^Reactions:\s*(.+)$/m, (_m, list) => ((meta.reactions = list.split(/,\s*/).map((r) => /^(.+?)\s*\((\d+)\)$/.exec(r)).filter(Boolean).map((r) => ({ name: EMOJI[r[1]] ?? `:${r[1]}:`, count: Number(r[2]) }))), ""));
    body = body.replace(/^Files?:\s*(.+)$/m, (_m, files) => ((meta.files = files), ""));
    out.push(message(head[1], body, { time: head[3], bot: /^B/.test(head[2] ?? ""), ...meta }));
  }
  return out;
}

// A thread read in detail: "=== THREAD PARENT MESSAGE ===" then "--- Reply N of M ---" blocks,
// each with From / Time / Message TS lines before its text.
function detailedThread(text) {
  const out = [];
  for (const part of text.split(/^(?:=== THREAD PARENT MESSAGE ===|--- Reply \d+ of \d+ ---)\s*$/m).slice(1)) {
    const meta = {};
    let body = part.replace(/^=== THREAD REPLIES[^\n]*$/m, "");
    const from = /^From:\s*(.*?)\s*(?:\(([A-Z0-9]+)\))?\s*$/m.exec(body);
    body = body.replace(/^From:[^\n]*\n?/m, "");
    body = body.replace(/^Time:\s*(.+)$\n?/m, (_m, time) => ((meta.time = time.trim()), ""));
    body = body.replace(/^Message TS:\s*(\S+)\s*$\n?/m, (_m, ts) => ((meta.ts = ts), ""));
    body = body.replace(/^Reactions:\s*(.+)$/m, (_m, list) => ((meta.reactions = list.split(/,\s*/).map((r) => /^(.+?)\s*\((\d+)\)$/.exec(r)).filter(Boolean).map((r) => ({ name: EMOJI[r[1]] ?? `:${r[1]}:`, count: Number(r[2]) }))), ""));
    body = body.replace(/^Files?:\s*(.+)$/m, (_m, files) => ((meta.files = files), ""));
    if (!from) continue;
    out.push(message(from[1], body, { bot: /^B/.test(from[2] ?? ""), ...meta }));
  }
  return out;
}

// Concise thread: "THREAD: <root> [Author]" then "> Name: reply" lines.
function conciseThread(text) {
  const lines = text.replace(/^THREAD:\s*/, "").split("\n");
  const first = lines.findIndex((l) => /^> [^:\n]{1,60}: /.test(l));
  const rootLines = first < 0 ? lines : lines.slice(0, first);
  let root = rootLines.join("\n").trim();
  let author = "";
  const tail = /\s\[([^\[\]\n]{1,60})\]\s*$/.exec(root);
  if (tail) {
    author = tail[1];
    root = root.slice(0, tail.index);
  }
  const out = [message(author, root, { root: true })];
  let current = null;
  for (const line of first < 0 ? [] : lines.slice(first)) {
    const start = /^> ([^:\n]{1,60}): ([\s\S]*)$/.exec(line);
    if (start) {
      if (current) out.push(message(current.author, current.lines.join("\n")));
      current = { author: start[1], lines: [start[2]] };
    } else if (current) current.lines.push(line);
  }
  if (current) out.push(message(current.author, current.lines.join("\n")));
  return out;
}

function searchResults(text) {
  const query = /^# Search Results for:\s*(.*)$/m.exec(text)?.[1] ?? "";
  const out = [];
  if (/^### Result \d+ of \d+/m.test(text)) {
    for (const part of text.split(/^### Result \d+ of \d+\s*$/m).slice(1)) {
      const get = (label) => new RegExp(`^${label}:\\s*(.*)$`, "m").exec(part)?.[1]?.trim() ?? "";
      const whole = (part.split(/^Text:\s*$/m)[1] ?? part.split(/^Text:/m)[1] ?? "").replace(/\n---\s*$/, "").replace(/\n---\n[\s\S]*$/, "");
      // "Context before/after" lists other people's messages around the hit: not its own text.
      const at = whole.search(/^Context (?:before|after):/m);
      const body = at < 0 ? whole : whole.slice(0, at);
      const around = at < 0 ? 0 : (whole.slice(at).match(/^- /gm) ?? []).length;
      const from = get("From");
      out.push(message(from.replace(/\s*\(ID:[^)]*\)\s*(\[BOT\])?\s*$/, ""), body, {
        channel: get("Channel").replace(/\s*\(ID:[^)]*\)\s*$/, ""), time: get("Time"), bot: /\[BOT\]/.test(from),
        replies: Number(get("Reply count")) || 0, around, link: /\((https?:[^)]+)\)/.exec(get("Permalink"))?.[1] ?? null,
      }));
    }
    return { query, messages: out };
  }
  const body = text.slice(text.search(/^1\. /m));
  for (const part of body.split(/^(?=\d+\. [#@\w])/m)) {
    const m = /^\d+\. (\S+) - ([^:\n]*): ([\s\S]*)$/.exec(part.trim());
    if (!m) continue;
    const time = /\s(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?(?: [A-Z]{2,4})?)\s*$/.exec(m[3]);
    out.push(message(m[2], time ? m[3].slice(0, time.index) : m[3], { channel: m[1], time: time?.[1] ?? null, cut: /\.\.\.\s*$/.test(time ? m[3].slice(0, time.index) : m[3]) }));
  }
  return { query, messages: out };
}

/** {kind, messages, ...} for a Slack call, or null when its result isn't in a format read here. */
export function parseSlack(call) {
  const kind = slackTool(call.name);
  if (!kind) return null;
  const input = call.input ?? {};
  if (kind === "sent") {
    const { data, text } = resultText(call);
    const link = data?.message_link ?? (/^https?:\/\/\S+$/.test(text.trim()) ? text.trim() : null);
    return { kind, channel: input.channel_id ?? "", messages: [message("", input.message ?? input.text ?? "", { sent: true, link })], threadTs: input.thread_ts ?? null, pending: !call.result, failed: Boolean(call.result?.err) };
  }
  if (!call.result) return { kind, messages: [], pending: true, query: input.query ?? "", channel: "" };
  const { text } = resultText(call);
  if (kind === "search") {
    const found = searchResults(text);
    return found.messages.length || /Search Results/.test(text) ? { kind, query: found.query || input.query || "", messages: found.messages } : null;
  }
  const channel = /^Channel:\s*(#?\S+)/m.exec(text)?.[1] ?? "";
  const messages = /^=== THREAD PARENT MESSAGE ===/m.test(text) ? detailedThread(text)
    : /^=== Message from /m.test(text) ? detailed(text) : /^THREAD:/.test(text.trim()) ? conciseThread(text.trim()) : [];
  if (!messages.length) return null;
  return { kind, channel, channelId: input.channel_id ?? "", messages: kind === "thread" && messages[0] ? [{ ...messages[0], root: true }, ...messages.slice(1)] : messages };
}
