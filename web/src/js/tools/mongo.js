// MongoDB MCP calls, the way Compass shows them: namespace, query bar, documents
// (List / JSON / Table), pipelines, write diffs, schema, indexes and explain plans.

// ---------- BSON values from Extended JSON ----------
const isEjson = (v) => v && typeof v === "object" && !Array.isArray(v) && ("$oid" in v || "$date" in v || "$numberLong" in v || "$numberDecimal" in v);

function bsonType(v) {
  if (v === null) return "Null";
  if (Array.isArray(v)) return "Array";
  if (typeof v === "string") return "String";
  if (typeof v === "boolean") return "Boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "Int32" : "Double";
  if (v.$oid) return "ObjectId";
  if (v.$date) return "Date";
  if (v.$numberLong) return "Int64";
  if (v.$numberDecimal) return "Decimal128";
  return "Object";
}

const isoPlus = (d) => d.replace(/Z$/, "+00:00");

function bsonText(v) {
  switch (bsonType(v)) {
    case "Null":
      return { cls: "bv-null", text: "null" };
    case "String":
      return { cls: "bv-str", text: JSON.stringify(v) };
    case "Boolean":
      return { cls: "bv-bool", text: String(v) };
    case "Int32":
    case "Double":
      return { cls: "bv-num", text: String(v) };
    case "ObjectId":
      return { cls: "bv-oid", text: `ObjectId('${v.$oid}')` };
    case "Date":
      return { cls: "bv-date", text: isoPlus(v.$date) };
    case "Int64":
      return { cls: "bv-wrap", text: `Long('${v.$numberLong}')` };
    case "Decimal128":
      return { cls: "bv-wrap", text: `Decimal128('${v.$numberDecimal}')` };
    default:
      return null;
  }
}

const valueSpan = (v) => {
  const t = bsonText(v);
  return t ? `<span class="${t.cls}">${esc(t.text)}</span>` : "";
};

// mongosh-style text for queries and pipeline stages.
function shellJS(v, indent = 0) {
  const pad = "  ".repeat(indent);
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
  if (v === null) return "null";
  if (typeof v === "string") return `'${v.replace(/'/g, "\\'")}'`;
  if (typeof v !== "object") return String(v);
  if (v.$oid) return `ObjectId('${v.$oid}')`;
  if (v.$date) return `ISODate('${v.$date}')`;
  if (v.$numberLong) return `Long('${v.$numberLong}')`;
  if (v.$numberDecimal) return `Decimal128('${v.$numberDecimal}')`;
  const entries = Array.isArray(v) ? v.map((x) => shellJS(x, indent + 1)) : Object.entries(v).map(([k, x]) => `${key(k)}: ${shellJS(x, indent + 1)}`);
  const open = Array.isArray(v) ? "[" : "{";
  const close = Array.isArray(v) ? "]" : "}";
  if (!entries.length) return `${open}${close}`;
  const inline = `${open} ${entries.join(", ")} ${close}`;
  if (inline.length <= 72 && !inline.includes("\n")) return inline;
  return `${open}\n${entries.map((e) => `${pad}  ${e}`).join(",\n")}\n${pad}${close}`;
}

const queryHTML = (v) => hlInline(shellJS(v), "mongo");

// ---------- Document card (List view) ----------
function fieldRows(obj, prefix, depth, extraCls = () => "") {
  const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
  return entries
    .map(([k, v]) => {
      const path = `${prefix}.${k}`;
      const nested = v && typeof v === "object" && !isEjson(v);
      const cls = extraCls(k);
      if (!nested) return `<div class="f ${cls}"><span class="tg"></span><span class="fk">${esc(k)}</span><span class="colon">:</span>${valueSpan(v)}</div>`;
      const open = STATE.openFolds.has(path);
      const count = Array.isArray(v) ? v.length : Object.keys(v).length;
      const label = `${Array.isArray(v) ? "Array" : "Object"} (${count})`;
      return `<div class="f ${cls}"><button class="tg" data-action="unfold" data-fold="${esc(path)}" aria-expanded="${open}" aria-label="${esc(k)} 펼치기">${icon(open ? "chevron-down" : "chevron-right", 12).s}</button><span class="fk">${esc(k)}</span><span class="colon">:</span><span class="ty">${label}</span></div>${open ? `<div class="kids">${fieldRows(v, path, depth + 1)}</div>` : ""}`;
    })
    .join("");
}

function docCard(doc, key, cls = "", header = "") {
  return `<div class="doc ${cls}">${header}<div class="doc-acts"><button class="btn sm icon" data-action="copy" data-copy="${esc(JSON.stringify(doc, null, 2))}" title="문서 복사(EJSON)" aria-label="문서 복사">${icon("copy", 13).s}</button></div>${fieldRows(doc, key, 0)}</div>`;
}

// ---------- Table view ----------
function tableView(docs, key) {
  const cols = [];
  for (const d of docs) for (const [k, v] of Object.entries(d)) if (!cols.some((c) => c.k === k)) cols.push({ k, t: bsonType(v) });
  const cell = (v) => {
    if (v === undefined) return '<span class="bv-null">—</span>';
    if (v && typeof v === "object" && !isEjson(v)) {
      const n = Array.isArray(v) ? v.length : Object.keys(v).length;
      return `<span class="nest">${Array.isArray(v) ? "[ ]" : "{ }"} ${n} ${Array.isArray(v) ? "elements" : "fields"}</span>`;
    }
    return valueSpan(v);
  };
  return raw(`<div class="cp-table-wrap" data-keep-scroll="table-${esc(key)}"><table class="cp-table"><thead><tr><th>#</th>${cols.map((c) => `<th>${esc(c.k)}<small>${c.t}</small></th>`).join("")}</tr></thead><tbody>${docs
    .map((d, i) => `<tr><td class="rn">${i + 1}</td>${cols.map((c) => `<td>${cell(d[c.k])}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`);
}

function jsonView(docs) {
  return raw(`<div class="box"><pre class="code" style="padding:12px 16px;max-height:560px;white-space:pre">${hl(JSON.stringify(docs, null, 2), "json").join("\n")}</pre></div>`);
}

function docsSection(call, docs, { title = "Documents", total = null, cls = "", header = null } = {}) {
  const view = uiGet(`${call.id}:docview`, "list");
  const range = docs.length ? `1 – ${docs.length} of ${fmtInt(total ?? docs.length)}` : "0";
  const body =
    view === "json"
      ? jsonView(docs)
      : view === "table"
        ? tableView(docs, call.id)
        : raw(`<div class="docs">${docs.map((d, i) => docCard(d, `${call.id}:${i}`, cls, header ? header(d, i) : "")).join("")}</div>`);
  return html`<div class="cp-bar">
      <h4>${title}</h4><span class="rng">${range}</span><span class="grow"></span>
      <button class="btn ghost sm" data-action="copy" data-copy="${JSON.stringify(docs, null, 2)}">${icon("copy", 13)} 전부 복사</button>
      <div class="seg" role="group" aria-label="문서 보기">
        <button data-action="ui-set" data-key="${call.id}:docview" data-value="list" aria-pressed="${view === "list"}">${icon("list", 12)} List</button>
        <button data-action="ui-set" data-key="${call.id}:docview" data-value="json" aria-pressed="${view === "json"}">${icon("braces", 12)} JSON</button>
        <button data-action="ui-set" data-key="${call.id}:docview" data-value="table" aria-pressed="${view === "table"}">${icon("table", 12)} Table</button>
      </div>
    </div>
    ${body}`;
}

// ---------- Write diffs ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function diffEntries(before, after) {
  const keys = Array.isArray(after) || Array.isArray(before) ? [...Array(Math.max((before || []).length, (after || []).length)).keys()].map(String) : uniq([...Object.keys(after || {}), ...Object.keys(before || {})]);
  return keys.map((k) => {
    const hasA = before && k in before;
    const hasB = after && k in after;
    const a = hasA ? before[k] : undefined;
    const b = hasB ? after[k] : undefined;
    if (!hasB) return { k, t: "del", v: a };
    if (!hasA) return { k, t: "add", v: b };
    const nested = a && b && typeof a === "object" && typeof b === "object" && !isEjson(a) && !isEjson(b);
    if (nested) {
      const kids = diffEntries(a, b);
      return { k, t: kids.some((x) => x.t !== "same") ? "obj" : "same", v: b, kids, isArr: Array.isArray(b) };
    }
    return same(a, b) ? { k, t: "same", v: b } : { k, t: "mod", a, b };
  });
}

function countChanges(entries) {
  return entries.reduce(
    (acc, e) => {
      if (e.t === "mod") acc.m++;
      if (e.t === "add") acc.a++;
      if (e.t === "del") acc.d++;
      if (e.t === "obj") {
        const c = countChanges(e.kids);
        acc.m += c.m;
        acc.a += c.a;
        acc.d += c.d;
      }
      return acc;
    },
    { m: 0, a: 0, d: 0 },
  );
}

function diffRowsHTML(entries, prefix) {
  return entries
    .map((e) => {
      const path = `${prefix}.${e.k}`;
      const head = `<span class="tg"></span><span class="fk">${esc(e.k)}</span><span class="colon">:</span>`;
      const short = (v) => (v && typeof v === "object" && !isEjson(v) ? `<span class="ty">${Array.isArray(v) ? `Array (${v.length})` : `Object (${Object.keys(v).length})`}</span>` : valueSpan(v));
      if (e.t === "mod") return `<div class="f">${head}<span class="v-old">${esc(bsonText(e.a)?.text ?? "")}</span><span class="v-new">${esc(bsonText(e.b)?.text ?? "")}</span></div>`;
      if (e.t === "add") return `<div class="f f-add">${head}${short(e.v)}</div>`;
      if (e.t === "del") return `<div class="f f-del">${head}${short(e.v)}</div>`;
      if (e.t === "obj") {
        const closed = STATE.openFolds.has(`x:${path}`);
        return `<div class="f"><button class="tg" data-action="unfold" data-fold="x:${esc(path)}" aria-expanded="${!closed}">${icon(closed ? "chevron-right" : "chevron-down", 12).s}</button><span class="fk">${esc(e.k)}</span><span class="colon">:</span><span class="ty">${e.isArr ? "Array" : "Object"}</span></div>${closed ? "" : `<div class="kids">${diffRowsHTML(e.kids, path)}</div>`}`;
      }
      if (e.v && typeof e.v === "object" && !isEjson(e.v)) return fieldRows({ [e.k]: e.v }, prefix, 0);
      return `<div class="f">${head}${valueSpan(e.v)}</div>`;
    })
    .join("");
}

// ---------- Pieces ----------
function cpHeader(call, ns) {
  const p = mcpParts(call.name);
  const op = LT.mongoOp(p.tool);
  const a = agentById(call.agent);
  return html`<div class="cp-head">
    <div class="leaf">${raw(`<span style="width:20px;height:20px;display:block">${LOGOS.mongo()}</span>`)}</div>
    <div style="min-width:0">
      <div class="cp-crumbs">${ns.map((part, k) => html`${k ? html`<span class="sep">›</span>` : ""}${k === ns.length - 1 ? html`<b>${part}</b>` : html`<span>${part}</span>`}`)}</div>
      <div class="cp-badges">
        <span class="opb ${op}">${op.toUpperCase()}</span>
        <span class="opname">${p.tool}</span>
        <span class="chip">${logo(a?.app || "claude", 14)} ${a?.app === "codex" ? "Codex" : "Claude Code"}</span>
      </div>
    </div>
    ${stageMeta(call)}
  </div>`;
}

function queryBar(rows) {
  return html`<div class="cp-query">${rows.map(([label, value, opts]) =>
    opts
      ? html`<span></span><div class="qopts">${opts.map(([k, v]) => html`<span class="qopt">${k} <code>${v}</code></span>`)}</div>`
      : html`<span class="ql">${label}</span><div class="qfield">${value}</div>`,
  )}</div>`;
}

function findOpts(i) {
  const opts = [];
  if (i.projection) opts.push(["Project", queryHTML(i.projection)]);
  if (i.sort) opts.push(["Sort", queryHTML(i.sort)]);
  if (i.limit != null) opts.push(["Limit", raw(`<span class="tk-num">${i.limit}</span>`)]);
  if (i.skip != null) opts.push(["Skip", raw(`<span class="tk-num">${i.skip}</span>`)]);
  return opts;
}

function pipelineHTML(pipeline) {
  return html`<div class="cp-bar"><h4>Pipeline</h4><span class="rng">${pipeline.length} stages</span></div>
    <div class="pipe">${pipeline.map((stage, k) => {
      const [op, body] = Object.entries(stage)[0];
      return html`${k ? html`<div class="pjoin">${icon("chevron-down", 12)}</div>` : ""}<div class="pstage">
        <div class="pstage-h">Stage ${k + 1} <code>${op}</code></div>
        <div class="pstage-b">${queryHTML(body)}</div>
      </div>`;
    })}</div>`;
}

function statCards(cards) {
  return html`<div class="cp-stats">${cards.map(([k, v, cls]) => html`<div class="cp-stat ${cls || ""}"><div class="k">${k}</div><div class="v">${fmtInt(v)}</div></div>`)}</div>`;
}

// ---------- Per tool (real MCP results, read with the mod's lib/mongo.js) ----------

const MONGO_MEMO = new WeakMap();

function mongoResult(call) {
  if (!MONGO_MEMO.has(call)) MONGO_MEMO.set(call, LM.readResult(call.result?.text ?? ""));
  return MONGO_MEMO.get(call);
}

function mongoError(call) {
  if (!call.result?.err) return "";
  const text = maskedText(call.result.text ?? "");
  const colon = text.indexOf(":");
  return html`<div class="err-card">${icon("circle-x", 15)}<div><b>${colon > 0 ? text.slice(0, colon) : "실패"}</b>${colon > 0 ? text.slice(colon) : text}</div></div>`;
}

function mongoPending(call) {
  if (call.result) return "";
  return html`<div class="xwarn">${icon("info", 16)}<div>${call.status === "pending" ? "실행 승인을 기다리고 있어요." : "아직 결과가 없어요."}</div></div>`;
}

const countIn = (text, re) => {
  const m = re.exec(text ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

// The explain tree, flattened top (output) to bottom (reads) for the stage list.
function explainStages(node, out = []) {
  if (!node) return out;
  out.push({ stage: node.stage, note: node.index ? `index ${node.index}` : "", ms: node.ms ?? "–", nReturned: node.returned ?? 0, docsExamined: node.examined, filter: node.filter ? LM.shellJS(node.filter, 0, 9999) : null });
  for (const kid of node.kids) explainStages(kid, out);
  return out;
}

const MONGO_RENDER = {
  find(call) {
    const i = call.input;
    const r = mongoResult(call);
    return html`${queryBar([["Filter", queryHTML(i.filter || {})], ...(findOpts(i).length ? [[null, null, findOpts(i)]] : [])])}${mongoError(call) || mongoPending(call) || docsSection(call, r.docs, { total: r.total ?? r.docs.length })}`;
  },
  aggregate(call) {
    const r = mongoResult(call);
    return html`${pipelineHTML(call.input.pipeline || [])}${mongoError(call) || mongoPending(call) || docsSection(call, r.docs, { title: "Results", total: r.total ?? r.docs.length })}`;
  },
  count(call) {
    const r = mongoResult(call);
    const n = r.data?.count ?? countIn(r.summary, /(\d[\d,]*)/);
    return html`${queryBar([["Filter", queryHTML(call.input.query || call.input.filter || {})]])}${mongoError(call) || mongoPending(call) || html`<div class="cnt-big"><b>${n == null ? "?" : fmtInt(n)}</b><span>documents · <span class="mono">${call.input.collection}</span></span></div>`}`;
  },
  explain(call) {
    const r = mongoResult(call);
    const plan = LM.readExplain(r.data ?? (r.docs.length === 1 ? r.docs[0] : null));
    const m = call.input.method?.[0]?.arguments ?? call.input;
    const bar = queryBar([["Filter", queryHTML(m.filter || {})], ...(m.sort ? [[null, null, [["Sort", queryHTML(m.sort)]]]] : [])]);
    if (mongoError(call) || !call.result) return html`${bar}${mongoError(call) || mongoPending(call)}`;
    if (!plan) return html`${bar}${genericBody(call)}`;
    const stages = explainStages(plan.tree);
    const st = plan.stats ?? {};
    const ratio = st.returned ? Math.round((st.docs ?? 0) / st.returned) : 0;
    return html`${bar}
      ${plan.stats ? html`<div class="xsum">
        <div class="cp-stat"><div class="k">실행 시간</div><div class="v">${st.ms ?? "–"}<small style="font-size:13px"> ms</small></div></div>
        <div class="cp-stat"><div class="k">반환한 문서</div><div class="v">${fmtInt(st.returned ?? 0)}</div></div>
        <div class="cp-stat"><div class="k">검사한 문서</div><div class="v" style="${plan.collscan ? "color:var(--working)" : ""}">${fmtInt(st.docs ?? 0)}</div></div>
        <div class="cp-stat"><div class="k">검사한 인덱스 키</div><div class="v">${fmtInt(st.keys ?? 0)}</div></div>
      </div>` : ""}
      ${plan.collscan ? html`<div class="xwarn">${icon("alert", 16)}<div><b>인덱스 없이 컬렉션 전체를 훑었어요.</b>${ratio ? ` 문서 ${ratio}개를 봐야 1개를 돌려줘요.` : ""}</div></div>` : ""}
      <div class="cp-bar"><h4>Explain Plan</h4><span class="rng">위에서 아래로: 결과를 내는 단계 ← 데이터를 읽는 단계</span></div>
      <div class="xtree">${stages.map(
        (s, k) => html`${k ? raw('<div class="xedge"></div>') : ""}<div class="xnode ${s.stage === "COLLSCAN" || s.stage === "SORT" ? "bad" : ""}">
          <div class="xnode-h"><b>${s.stage}</b><span class="dim" style="font-size:var(--fs-xs)">${s.note}</span><span class="t">${s.ms} ms</span></div>
          <div class="xm"><span>반환 <b>${fmtInt(s.nReturned)}</b></span>${s.docsExamined != null ? html`<span>검사 <b>${fmtInt(s.docsExamined)}</b></span>` : ""}</div>
          ${s.filter ? html`<div class="mono dim" style="font-size:12px;margin-top:6px;white-space:normal">filter ${s.filter}</div>` : ""}
        </div>`,
      )}</div>`;
  },
  "insert-many"(call) {
    const docs = call.input.documents || [];
    const n = countIn(call.result?.text, /Inserted\D{0,20}(\d[\d,]*)/i) ?? docs.length;
    return html`${mongoError(call) || mongoPending(call) || statCards([["INSERTED", n, "ins"]])}${docsSection(call, docs, { title: "Inserted", cls: "inserted", header: () => `<div class="doc-h"><span class="chg ins">INSERTED</span></div>` })}`;
  },
  "update-many"(call) {
    const i = call.input;
    const text = call.result?.text ?? "";
    const q = queryBar([
      ["Filter", queryHTML(i.filter || {})],
      ["Update", queryHTML(i.update || {})],
    ]);
    if (mongoError(call) || !call.result) return html`${q}${mongoError(call) || mongoPending(call)}`;
    return html`${statCards([
      ["MATCHED", countIn(text, /Matched (\d[\d,]*)/i) ?? 0],
      ["MODIFIED", countIn(text, /Modified (\d[\d,]*)/i) ?? 0],
      ["UPSERTED", countIn(text, /Upserted\D{0,20}(\d[\d,]*)/i) ?? 0],
    ])}${q}
      <div class="xwarn">${icon("info", 16)}<div>대화 기록에는 바뀌기 전 문서가 남지 않아서, 문서별 비교 없이 개수만 보여줘요.</div></div>`;
  },
  "delete-many"(call) {
    const n = countIn(call.result?.text, /Deleted (\d[\d,]*)/i) ?? countIn(call.result?.text, /(\d[\d,]*) documents?/i) ?? 0;
    return html`${mongoError(call) || mongoPending(call) || statCards([["DELETED", n, "del"]])}${queryBar([["Filter", queryHTML(call.input.filter || {})]])}`;
  },
  "list-databases"(call) {
    const r = mongoResult(call);
    const dbs = (r.docs.length ? r.docs : r.data?.databases ?? []).map((d) => ({ name: d.name, size: Number(d.sizeOnDisk?.$numberLong ?? d.sizeOnDisk ?? d.size ?? 0) }));
    if (!dbs.length) return mongoError(call) || genericBody(call);
    const max = Math.max(...dbs.map((d) => d.size), 1);
    return html`<div class="cp-bar"><h4>Databases</h4><span class="rng">${dbs.length}개</span></div>
      <div class="box">${dbs.map(
        (d) => html`<div class="dbrow"><span style="color:var(--k-mongo)">${icon("database", 16)}</span><span class="nm">${d.name}</span><div class="meter"><i style="width:${(d.size / max) * 100}%;background:var(--k-mongo)"></i></div><span class="sz">${d.size ? fmtBytes(d.size) : ""}</span></div>`,
      )}</div>`;
  },
  "list-collections"(call) {
    const r = mongoResult(call);
    const cols = (r.docs.length ? r.docs : r.data?.collections ?? []).map((c) => (typeof c === "string" ? c : c.name)).filter(Boolean);
    if (!cols.length) return mongoError(call) || genericBody(call);
    return html`<div class="cp-bar"><h4>Collections</h4><span class="rng">${cols.length}개 · <span class="mono">${call.input.database}</span></span></div>
      <div class="box">${cols.map((c) => html`<div class="dbrow" style="grid-template-columns:22px minmax(0,1fr)"><span class="dim">${icon("folder", 15)}</span><span class="nm">${c}</span></div>`)}</div>`;
  },
};

function renderMongo(call) {
  const p = mcpParts(call.name);
  const i = call.input || {};
  const ns = [p.server, i.database, i.collection].filter(Boolean);
  const body = MONGO_RENDER[p.tool] ? MONGO_RENDER[p.tool](call) : html`${mongoError(call)}${genericBody(call)}`;
  return html`<div class="cp">${cpHeader(call, ns)}${body}</div>`;
}
