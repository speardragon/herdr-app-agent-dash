// Gmail MCP calls -> what the Gmail-looking views draw. Pure.

import { initials } from "./rich.js";
import { masked } from "./tools.js";

const suffix = (name) => String(name ?? "").split("__").pop();
const TOOLS = {
  search_threads: "list", list_drafts: "list", get_thread: "thread", get_message: "thread",
  create_draft: "draft", update_draft: "draft", list_labels: "labels",
};

export const gmailTool = (name) => (/gmail/i.test(name ?? "") ? TOOLS[suffix(name)] ?? null : null);

function tryJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const ENTITIES = { "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&amp;": "&" };
const plain = (text) => String(text ?? "").replace(/&#39;|&quot;|&lt;|&gt;|&nbsp;|&amp;/g, (m) => ENTITIES[m]);

const BODY_LIMIT = 6000;

/** A mail body as readable text: tracking links collapse to their label, layout tables and
 *  runs of blank lines go, and a long body is cut (the real mail is one click away). */
export function cleanBody(message) {
  let text = message.plaintextBody;
  if (text == null && message.htmlBody) {
    text = String(message.htmlBody).replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "");
  }
  if (text == null) return null;
  const lines = plain(text)
    .replace(/\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, (_m, label) => label.trim())
    .replace(/https?:\/\/\S{120,}/g, "(긴 링크)")
    .split("\n")
    .map((line) => line.replace(/^[|\s]+$/, "").replace(/^\|\s?/, "").replace(/\s?\|\s*$/, "").replace(/(\|\s*){2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return lines.length > BODY_LIMIT ? `${lines.slice(0, BODY_LIMIT)}\n\n… (이하 생략)` : lines;
}

const SYSTEM_LABEL = {
  INBOX: "받은편지함", SENT: "보낸편지함", DRAFT: "임시보관함", STARRED: "별표편지함", IMPORTANT: "중요", SPAM: "스팸", TRASH: "휴지통",
  CATEGORY_UPDATES: "업데이트", CATEGORY_PROMOTIONS: "프로모션", CATEGORY_SOCIAL: "소셜", CATEGORY_FORUMS: "포럼", CATEGORY_PERSONAL: "기본",
};
// Shown as chips on a row or a conversation: where the mail is, not its read state.
const CHIP_LABELS = ["INBOX", "SENT", "DRAFT", "CATEGORY_UPDATES", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];

function person(address, names) {
  const email = String(address ?? "").trim();
  const shown = names?.[email.toLowerCase()] ?? /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(email)?.[1]?.trim();
  const bare = /<([^>]+)>/.exec(email)?.[1] ?? email;
  const name = shown || bare.split("@")[0] || "(알 수 없음)";
  return { name, email: bare, initials: initials(name), unknown: !bare };
}

function messageOf(m) {
  const names = Object.fromEntries((m.addressDisplayNames ?? []).map((a) => [String(a.emailAddress ?? "").toLowerCase(), a.displayName]));
  const labels = Array.isArray(m.labelIds) ? m.labelIds : [];
  return {
    id: m.id ?? null,
    from: person(m.sender, names),
    to: (m.toRecipients ?? []).map((a) => person(a, names)),
    cc: (m.ccRecipients ?? []).map((a) => person(a, names)),
    subject: masked(plain(m.subject ?? "")),
    snippet: masked(plain(m.snippet ?? "")),
    date: m.date ?? null,
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    important: labels.includes("IMPORTANT"),
    labels: CHIP_LABELS.filter((id) => labels.includes(id)).map((id) => SYSTEM_LABEL[id]),
    body: m.plaintextBody != null || m.htmlBody != null ? masked(cleanBody(m) ?? "") : null,
    attachments: (m.attachments ?? []).map((a) => ({ name: a.filename ?? "첨부 파일", type: a.mimeType ?? "" })),
    url: m.viewUrl ?? null,
  };
}

function threadRow(t) {
  const messages = (t.messages ?? []).map(messageOf);
  const last = messages[messages.length - 1] ?? null;
  const senders = [...new Map(messages.map((m) => [m.from.email, m.from])).values()];
  return {
    id: t.id ?? null,
    count: t.messageCount ?? messages.length,
    senders,
    subject: messages.find((m) => m.subject)?.subject ?? "(제목 없음)",
    snippet: last?.snippet ?? "",
    date: last?.date ?? null,
    unread: messages.some((m) => m.unread),
    starred: messages.some((m) => m.starred),
    important: messages.some((m) => m.important),
    labels: [...new Set(messages.flatMap((m) => m.labels))].filter((l) => l !== "받은편지함"),
    attachments: messages.some((m) => m.attachments.length > 0),
    url: t.viewUrl ?? last?.url ?? null,
  };
}

const draftRow = (d) => threadRow({ id: d.threadId ?? d.id, messages: [{ ...d, sender: "", labelIds: ["DRAFT"], snippet: d.snippet ?? String(d.plaintextBody ?? "").slice(0, 160) }] });

/** {kind, ...} for a Gmail call, or null when its result can't be read as Gmail data. */
export function parseGmail(call) {
  const kind = gmailTool(call.name);
  if (!kind) return null;
  const input = call.input ?? {};
  const data = tryJson(call.result?.text);
  if (call.result && !data) return null;
  const pending = !call.result;
  if (kind === "list") {
    const drafts = suffix(call.name) === "list_drafts";
    const rows = drafts ? (data?.drafts ?? []).map(draftRow) : (data?.threads ?? []).map(threadRow);
    const total = Number(data?.resultCountEstimate);
    return { kind, query: input.query ?? "", drafts, rows, total: Number.isFinite(total) ? total : null, more: Boolean(data?.nextPageToken), pending };
  }
  if (kind === "thread") {
    const raw = Array.isArray(data?.messages) ? data.messages : data?.id && (data.sender || data.subject) ? [data] : [];
    if (!pending && !raw.length) return null;
    const messages = raw.map(messageOf);
    return { kind, subject: messages.find((m) => m.subject)?.subject ?? "(제목 없음)", labels: [...new Set(messages.flatMap((m) => m.labels))], messages, count: data?.messageCount ?? messages.length, url: data?.viewUrl ?? messages[0]?.url ?? null, pending };
  }
  if (kind === "draft") {
    const body = input.body ?? (input.htmlBody ? cleanBody({ htmlBody: input.htmlBody }) : "");
    return {
      kind, update: suffix(call.name) === "update_draft", reply: Boolean(input.replyToMessageId),
      to: (input.to ?? []).map((a) => person(a)), cc: (input.cc ?? []).map((a) => person(a)), bcc: (input.bcc ?? []).map((a) => person(a)),
      subject: masked(input.subject ?? ""), body: masked(String(body ?? "")), signature: Boolean(input.includeSignature), url: data?.viewUrl ?? null, pending,
    };
  }
  const labels = (data?.labels ?? []).map((l) => ({ name: SYSTEM_LABEL[l.labelId] ?? l.name ?? l.labelId, system: l.labelType === "LABEL_TYPE_SYSTEM" || Boolean(SYSTEM_LABEL[l.labelId]), unread: l.threadsUnread ?? l.messagesUnread ?? 0, total: l.threadsTotal ?? l.messagesTotal ?? 0 }));
  if (!pending && !labels.length) return null;
  return { kind, labels, pending };
}

const two = (n) => String(n).padStart(2, "0");
const clock = (d) => `${d.getHours() < 12 ? "오전" : "오후"} ${d.getHours() % 12 || 12}:${two(d.getMinutes())}`;

/** Gmail's short date in a list: the time today, "11월 10일" this year, else "2025. 3. 4.". */
export function listDate(iso, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return clock(d);
  return d.getFullYear() === today.getFullYear() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** The full date on an open message: "2026년 11월 11일 (수) 오전 9:37". */
export function fullDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]}) ${clock(d)}`;
}
