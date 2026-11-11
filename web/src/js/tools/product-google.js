// Gmail, Google Calendar and Google Sheets calls drawn the way those sites look (light themes,
// Google's Material palette). Parsing is the mod's lib/ (gmail, gcal, gsheets); this file turns
// the parsed views into HTML, and css/sites-google.css holds the looks.
// A mail's HTML body is never put into the page: only its plain text is drawn.

const sx_GMAIL_MARK = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M2 17.800c0 .900.700 1.600 1.600 1.600H6V10L2 7z" fill="#4285F4"/><path d="M18 19.400h2.400c.900 0 1.600-.700 1.600-1.600V7l-4 3z" fill="#34A853"/><path d="M18 5.200V10l4-3V6.200c0-2-2.300-3.100-3.800-1.900z" fill="#FBBC04"/><path d="M6 10V5.200l6 4.500 6-4.500V10l-6 4.500z" fill="#EA4335"/><path d="M2 6.200V7l4 3V5.200l-.200-.900C4.300 3.100 2 4.200 2 6.200z" fill="#C5221F"/></svg>';
const sx_GCAL_MARK = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M17.300 6.700H6.700v10.600h10.600z" fill="#fff"/><path d="M17.300 22 22 17.300h-4.700z" fill="#EA4335"/><path d="M22 6.700h-4.700v10.600H22z" fill="#FBBC04"/><path d="M17.300 17.300H6.700V22h10.600z" fill="#34A853"/><path d="M2 17.300v3.100c0 .900.700 1.600 1.600 1.600h3.100v-4.700z" fill="#188038"/><path d="M22 6.700V3.600c0-.900-.700-1.600-1.600-1.600h-3.100v4.700z" fill="#1967D2"/><path d="M17.300 2H3.600C2.700 2 2 2.700 2 3.600v13.700h4.700V6.700h10.600z" fill="#4285F4"/><text x="12" y="15.300" text-anchor="middle" font-size="7.500" font-weight="700" fill="#4285F4" font-family="Arial">31</text></svg>';
const sx_GSHEETS_MARK = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M14.500 2H6.200C5.300 2 4.500 2.800 4.500 3.700v16.600c0 .900.800 1.700 1.700 1.700h11.600c.900 0 1.700-.800 1.700-1.700V7z" fill="#0F9D58"/><path d="M14.500 2v3.300c0 .900.800 1.700 1.700 1.700h3.300z" fill="#87CEAC"/><path d="M8 11v7h8v-7zm3.500 6h-2.500v-1.500h2.500zm0-2.500h-2.500V13h2.500zm3.500 2.500h-2.500v-1.500H15zm0-2.500h-2.500V13H15z" fill="#F1F1F1"/></svg>';

const sx_gTop = (mark, title, sub, url, label) => html`<div class="g-top">${raw(mark)}<span class="g-name">${title}</span><span class="g-sub truncate">${sub ?? ""}</span><span class="grow"></span>${sx_outLink(url, label)}</div>`;
const sx_gChip = (text) => html`<span class="g-chip">${text}</span>`;

// ---------- Gmail ----------

function sx_gmailRow(row) {
  const names = row.senders.length ? row.senders.slice(0, 3).map((p) => p.name).join(", ") : "임시보관";
  const href = sx_safeUrl(row.url);
  const inner = html`<span class="gm-star ${row.starred ? "on" : ""}">${row.starred ? "★" : "☆"}</span>
    <span class="gm-from truncate ${row.senders.length ? "" : "draft"}">${names}${row.count > 1 ? html` <i>${row.count}</i>` : ""}</span>
    <span class="gm-line">${row.labels.slice(0, 2).map(sx_gChip)}<b class="truncate">${row.subject}</b><span class="truncate">${row.snippet ? `- ${row.snippet}` : ""}</span></span>
    ${row.attachments ? html`<span class="gm-clip">📎</span>` : ""}<span class="gm-date">${LGM.listDate(row.date)}</span>`;
  return href
    ? html`<a class="gm-row ${row.unread ? "unread" : ""}" href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`
    : html`<div class="gm-row ${row.unread ? "unread" : ""}">${inner}</div>`;
}

function sx_gmailMessage(m) {
  const toLine = [...m.to, ...m.cc].slice(0, 4).map((p) => p.name).join(", ");
  return html`<div class="gm-msg">
    <div class="gm-mh">${sx_avatarEl(m.from, "gm")}<div class="gm-who"><div><b>${m.from.name}</b><span class="truncate">${m.from.email ? `<${m.from.email}>` : ""}</span><time>${LGM.fullDate(m.date)}</time></div>
      ${toLine ? html`<div class="gm-to truncate">${toLine}에게</div>` : ""}</div></div>
    <div class="gm-body">${m.body ? sx_rich(m.body, 160) : html`<p class="g-dim">${m.snippet || "본문 없이 불러왔어요"}</p>`}</div>
    ${m.attachments.length ? html`<div class="gm-atts">${m.attachments.slice(0, 12).map((a) => html`<span class="gm-att"><i>📎</i><span class="truncate">${a.name}</span></span>`)}</div>` : ""}
  </div>`;
}

const sx_gmailPeople = (label, people) => (people.length ? html`<div class="gm-field"><span>${label}</span>${people.map((p) => html`<span class="gm-pill">${sx_avatarEl(p, "xs")}${p.email || p.name}</span>`)}</div>` : "");

function sx_gmailView(view) {
  if (view.kind === "list") {
    const count = view.total != null && view.total > view.rows.length ? `${view.rows.length}개 표시 · 약 ${view.total}개` : `${view.rows.length}개${view.more ? " 이상" : ""}`;
    return html`<div class="site gmail">${sx_gTop(sx_GMAIL_MARK, view.drafts ? "임시보관함" : "Gmail", null, null, "")}
      <div class="gm-search"><span>🔍</span><span class="truncate ${view.query ? "" : "g-dim"}">${view.query || "메일 검색"}</span></div>
      ${view.pending ? html`<p class="g-dim g-pad">메일을 찾고 있어요</p>` : view.rows.length
        ? html`<div class="gm-list">${view.rows.slice(0, 100).map(sx_gmailRow)}<div class="gm-count">${count}</div></div>`
        : html`<p class="g-dim g-pad">일치하는 메일이 없어요</p>`}</div>`;
  }
  if (view.kind === "thread") {
    return html`<div class="site gmail">${sx_gTop(sx_GMAIL_MARK, "Gmail", view.count > 1 ? `메일 ${view.count}개` : null, view.url, "Gmail에서 열기")}
      ${view.pending ? html`<p class="g-dim g-pad">메일을 불러오고 있어요</p>` : html`<h1 class="gm-subject">${view.subject}${view.labels.map(sx_gChip)}</h1>${view.messages.slice(0, 50).map(sx_gmailMessage)}`}</div>`;
  }
  if (view.kind === "draft") {
    const title = view.pending ? "임시보관함에 저장하는 중" : view.update ? "임시보관 메일을 고쳤어요" : view.reply ? "답장을 임시보관함에 저장했어요" : "임시보관함에 저장했어요";
    return html`<div class="site gmail">${sx_gTop(sx_GMAIL_MARK, "Gmail", title, view.url, "Gmail에서 열기")}
      <div class="gm-compose"><div class="gm-ch">${view.reply ? "답장" : "새 메일"}</div>
        ${sx_gmailPeople("받는사람", view.to)}${sx_gmailPeople("참조", view.cc)}${sx_gmailPeople("숨은참조", view.bcc)}
        <div class="gm-field ${view.subject ? "" : "g-dim"}">${view.subject || "제목"}</div>
        <div class="gm-cbody">${view.body ? sx_rich(view.body, 160) : html`<p class="g-dim">(본문 없음)</p>`}</div>
        <div class="gm-cfoot"><span class="g-btn">보내기</span><span class="g-dim">${view.signature ? "서명 포함 · " : ""}아직 보내지 않았어요</span></div></div></div>`;
  }
  return html`<div class="site gmail">${sx_gTop(sx_GMAIL_MARK, "Gmail", `라벨 ${view.labels.length}개`, null, "")}
    <div class="gm-labels">${view.labels.slice(0, 80).map((l) => html`<div class="gm-label ${l.unread > 0 ? "unread" : ""}"><i>${l.system ? "▸" : "🏷"}</i><span class="truncate grow">${l.name}</span><span>${l.unread > 0 ? l.unread : ""}</span></div>`)}</div></div>`;
}

// ---------- Calendar ----------

const sx_GCAL_STATUS = { accepted: ["✓", "#188038"], declined: ["✕", "#C5221F"], tentative: ["?", "#5E5E5E"] };
const sx_GCAL_COLORS = ["#039BE5", "#33B679", "#8E24AA", "#F4511E", "#F6BF26", "#7986CB", "#D50000", "#616161"];

function sx_gcalEvent(e) {
  const href = sx_safeUrl(e.url);
  const inner = html`<i class="gc-dot" style="background:${e.color}"></i><span class="gc-time truncate">${LGC.timeRange(e.start, e.end)}</span><b class="truncate ${e.cancelled ? "gone" : ""}">${e.title}</b><span class="gc-loc truncate">${e.location ?? ""}</span>`;
  return href ? html`<a class="gc-ev" href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>` : html`<div class="gc-ev">${inner}</div>`;
}

function sx_gcalGuest(g) {
  const mark = sx_GCAL_STATUS[g.status];
  const note = [g.self ? "나" : null, g.optional ? "선택" : null].filter(Boolean).join(" · ");
  return html`<div class="gc-guest"><span class="gc-av">${sx_avatarEl(g, "")}${mark ? html`<i style="background:${mark[1]}">${mark[0]}</i>` : ""}</span><span class="truncate">${g.name}</span><small>${note}</small></div>`;
}

const sx_gcalLine = (mark, body) => html`<div class="gc-line"><span class="gc-mark">${mark}</span><div class="gc-val">${body}</div></div>`;

function sx_gcalView(view) {
  if (view.kind === "agenda") {
    const range = view.from ? `${LGC.dayLabel(view.from).long}${view.to ? ` ~ ${view.to.mo}월 ${view.to.d}일` : " 부터"}` : null;
    const sub = [view.calendar, view.query ? `검색: ${view.query}` : null, range].filter(Boolean).join(" · ");
    return html`<div class="site gcal">${sx_gTop(sx_GCAL_MARK, "일정", sub, null, "")}
      ${view.pending ? html`<p class="g-dim g-pad">일정을 불러오고 있어요</p>` : view.days.length
        ? html`<div class="gc-days">${view.days.map((day) => html`<div class="gc-day"><div class="gc-date"><b>${day.label.num}</b><span>${day.label.sub}</span></div><div class="gc-evs">${day.events.map(sx_gcalEvent)}</div></div>`)}</div>
          <div class="gc-count">일정 ${view.count}개${view.more ? " 이상" : ""}</div>`
        : html`<p class="g-dim g-pad">이 기간에 일정이 없어요</p>`}</div>`;
  }
  if (view.kind === "event") {
    const e = view.event;
    if (!e) return html`<div class="site gcal">${sx_gTop(sx_GCAL_MARK, "일정", view.notice, null, "")}<p class="g-dim g-pad">일정을 기다리고 있어요</p></div>`;
    const when = e.start ? `${LGC.dayLabel(e.start).long} · ${LGC.timeRange(e.start, e.end)}` : "";
    const places = [e.location, ...e.rooms.map((r) => r.name)].filter((v, i, all) => v && all.indexOf(v) === i);
    const meet = sx_safeUrl(e.meet);
    return html`<div class="site gcal">${sx_gTop(sx_GCAL_MARK, "일정", view.pending ? "보내는 중" : view.notice, e.url, "Calendar에서 열기")}
      <div class="gc-card">
        ${sx_gcalLine(html`<i class="gc-sq" style="background:${e.color}"></i>`, html`<h1 class="${view.deleted || e.cancelled ? "gone" : ""}">${e.title}</h1><p class="gc-when">${[when, e.recurring ? "반복 일정" : null, e.typeLabel].filter(Boolean).join(" · ")}</p>`)}
        ${meet ? sx_gcalLine("📹", html`<a class="g-btn" href="${meet}" target="_blank" rel="noopener noreferrer">Google Meet으로 참여</a><span class="g-dim gc-meet truncate">${meet.replace(/^https?:\/\//, "")}</span>`) : ""}
        ${places.length ? sx_gcalLine("📍", places.map((p) => html`<div>${p}</div>`)) : ""}
        ${e.guests.length ? sx_gcalLine("👥", html`<div>참석자 ${e.guests.length}명</div><p class="g-dim gc-tally">수락 ${e.guests.filter((g) => g.status === "accepted").length}명 · 응답 대기 ${e.guests.filter((g) => g.status === "needsAction").length}명</p>${e.guests.slice(0, 60).map(sx_gcalGuest)}`) : ""}
        ${e.description ? sx_gcalLine("≡", sx_rich(e.description, 80)) : ""}
        ${e.organizer ? sx_gcalLine("📅", e.organizer.self ? "내 캘린더" : `${e.organizer.name} (주최)`) : ""}
      </div></div>`;
  }
  if (view.kind === "calendars") {
    return html`<div class="site gcal">${sx_gTop(sx_GCAL_MARK, "캘린더", `내 캘린더 ${view.calendars.length}개`, null, "")}
      <div class="gc-cals">${view.calendars.map((c, i) => html`<div class="gc-cal"><i style="background:${sx_GCAL_COLORS[i % sx_GCAL_COLORS.length]}">✓</i><span class="truncate">${c.name}</span><small class="truncate">${c.description ?? ""}</small></div>`)}</div></div>`;
  }
  const sub = [view.minutes ? `${view.minutes}분` : null, view.guests.length ? `참석자 ${view.guests.length}명` : null].filter(Boolean).join(" · ");
  return html`<div class="site gcal">${sx_gTop(sx_GCAL_MARK, "추천 시간", sub, null, "")}
    <div class="gc-slots">${view.slots.map((s) => html`<div class="gc-slot"><i class="gc-dot" style="background:#039BE5"></i><b>${LGC.dayLabel(s.start).long}</b><span>${LGC.timeRange(s.start, s.end)}</span></div>`)}</div></div>`;
}

// ---------- Sheets ----------

function sx_gsheetsView(view) {
  if (view.kind === "grid") {
    const g = view.grid;
    const size = `${g.totalRows}행 × ${g.totalCols}열`;
    const cut = g.totalRows > g.rows.length || g.totalCols > g.cols.length;
    const note = view.pending ? "기다리는 중" : view.write ? `${view.notice}${view.cells != null ? ` · 셀 ${view.cells}개` : ""}` : size;
    return html`<div class="site gsheets">${sx_gTop(sx_GSHEETS_MARK, g.sheet || "스프레드시트", view.write ? view.notice : "값 읽기", view.url, "Sheets에서 열기")}
      <div class="gs-fx"><span class="gs-ref truncate">${g.cells || g.text || "A1"}</span><i>fx</i><span class="truncate">${note}</span></div>
      ${view.empty || !g.rows.length ? html`<p class="g-dim g-pad">${view.pending ? "값을 기다리고 있어요" : "이 범위는 비어 있어요"}</p>` : html`<div class="gs-wrap"><table class="gs-grid ${view.write ? "write" : ""}">
        <thead><tr><th class="gs-corner"></th>${g.cols.map((c) => html`<th>${c}</th>`)}</tr></thead>
        <tbody>${g.rows.map((r) => html`<tr><th>${r.n}</th>${r.cells.map((c) => html`<td class="${c.number ? "num" : ""} ${c.formula ? "fx" : ""} ${c.text === "" ? "" : "set"}" title="${c.text}">${c.text}</td>`)}</tr>`)}</tbody></table></div>`}
      <div class="gs-tabs"><span class="gs-plus">+</span><span class="gs-tab">${g.sheet || "시트1"}</span><span class="grow"></span><span class="g-dim">${cut ? `${size} 중 ${g.rows.length}행 × ${g.cols.length}열 표시` : size}</span></div></div>`;
  }
  if (view.kind === "book") {
    return html`<div class="site gsheets">${sx_gTop(sx_GSHEETS_MARK, view.title ?? "스프레드시트", `시트 ${view.sheets.length}개`, view.url, "Sheets에서 열기")}
      ${view.pending ? html`<p class="g-dim g-pad">스프레드시트를 불러오고 있어요</p>` : html`<div class="gs-tabs wrap">${view.sheets.map((s, i) => html`<span class="gs-tab ${i === 0 ? "" : "off"}" title="${s.rows && s.cols ? `${s.rows}행 × ${s.cols}열` : ""}">${s.title}</span>`)}</div>`}</div>`;
  }
  return html`<div class="site gsheets">${sx_gTop(sx_GSHEETS_MARK, "스프레드시트", view.pending ? "지우는 중" : "값을 지웠어요", view.url, "Sheets에서 열기")}
    <div class="gs-cleared">${view.ranges.map((r) => html`<span>${r}</span>`)}</div></div>`;
}
