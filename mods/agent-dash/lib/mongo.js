// MongoDB MCP results, read the way Compass shows them: documents with BSON types,
// shell-style queries, and the explain plan as a stage tree.

const UNTRUSTED = /<untrusted-user-data-[\w-]+>([\s\S]*?)<\/untrusted-user-data-[\w-]+>/g;

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** {summary, docs, data, text}: the lead sentence, documents (if any), any other JSON. */
export function readResult(text) {
  const raw = String(text ?? "");
  const docs = [];
  let data;
  for (const m of raw.matchAll(UNTRUSTED)) {
    const parsed = tryJson(m[1].trim());
    if (Array.isArray(parsed)) docs.push(...parsed);
    else if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.documents)) docs.push(...parsed.documents);
      else data = parsed;
    }
  }
  // Newer servers answer with the structured result itself: {documents, queryResultsCount, ...}.
  const whole = raw.trim().startsWith("{") || raw.trim().startsWith("[") ? tryJson(raw.trim()) : undefined;
  let total = null;
  if (whole !== undefined && !docs.length) {
    if (Array.isArray(whole)) docs.push(...whole);
    else if (Array.isArray(whole?.documents)) {
      docs.push(...whole.documents);
      total = whole.queryResultsCount ?? whole.count ?? null;
    } else data = whole;
  }
  if (whole !== undefined) {
    const summary = total != null ? `${total} documents` : docs.length ? `${docs.length} documents` : "";
    return { summary, rest: [], docs, data, total };
  }
  const outside = raw.replace(UNTRUSTED, "").split("\n").map((l) => l.trim()).filter((l) => l && !/^The following section contains unverified user data/.test(l));
  return { summary: outside[0] ?? "", rest: outside.slice(1), docs, data, total };
}

export const isOid = (v) => v && typeof v === "object" && typeof v.$oid === "string";
const isDate = (v) => v && typeof v === "object" && "$date" in v;

export function bsonType(v) {
  if (v === null || v === undefined) return "Null";
  if (Array.isArray(v)) return "Array";
  if (typeof v === "string") return "String";
  if (typeof v === "boolean") return "Boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "Int32" : "Double";
  if (isOid(v)) return "ObjectId";
  if (isDate(v)) return "Date";
  if ("$numberLong" in v) return "Int64";
  if ("$numberDecimal" in v) return "Decimal128";
  if ("$numberDouble" in v) return "Double";
  if ("$numberInt" in v) return "Int32";
  if ("$binary" in v) return v.$binary?.subType === "04" ? "UUID" : "Binary";
  if ("$uuid" in v) return "UUID";
  if ("$timestamp" in v) return "Timestamp";
  if ("$regularExpression" in v) return "Regex";
  return "Object";
}

function dateText(v) {
  const d = v.$date;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "$numberLong" in d) return new Date(Number(d.$numberLong)).toISOString();
  return typeof d === "number" ? new Date(d).toISOString() : String(d);
}

/** Display text for a scalar BSON value, as Compass writes it. */
export function bsonText(v) {
  switch (bsonType(v)) {
    case "Null":
      return "null";
    case "String":
      return `"${v}"`;
    case "Boolean":
    case "Int32":
    case "Double":
      return String(v.$numberDouble ?? v.$numberInt ?? v);
    case "ObjectId":
      return `ObjectId('${v.$oid}')`;
    case "Date":
      return dateText(v).replace("T", " ").replace(/\.000Z$|Z$/, "");
    case "Int64":
      return String(v.$numberLong);
    case "Decimal128":
      return String(v.$numberDecimal);
    case "UUID":
      return `UUID('${v.$uuid ?? v.$binary?.base64}')`;
    case "Binary":
      return `Binary('${String(v.$binary?.base64 ?? "").slice(0, 24)}…')`;
    case "Timestamp":
      return `Timestamp(${v.$timestamp?.t}, ${v.$timestamp?.i})`;
    case "Regex":
      return `/${v.$regularExpression?.pattern}/${v.$regularExpression?.options ?? ""}`;
    case "Array":
      return `Array (${v.length})`;
    default:
      return `Object (${Object.keys(v).length})`;
  }
}

export const isContainer = (v) => {
  const t = bsonType(v);
  return t === "Array" || t === "Object";
};

/** A value in mongo shell syntax: unquoted keys, ObjectId(...), ISODate(...). */
export function shellJS(v, indent = 0, wide = 60) {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  const t = bsonType(v);
  if (t === "ObjectId") return `ObjectId("${v.$oid}")`;
  if (t === "Date") return `ISODate("${dateText(v)}")`;
  if (t === "Int64") return `NumberLong("${v.$numberLong}")`;
  if (t === "Decimal128") return `Decimal128("${v.$numberDecimal}")`;
  if (t === "Regex") return bsonText(v);
  if (t === "String") return JSON.stringify(v);
  if (t !== "Array" && t !== "Object") return bsonText(v);
  const keyText = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const parts = t === "Array" ? v.map((x) => shellJS(x, indent + 1, wide)) : Object.entries(v).map(([k, x]) => `${keyText(k)}: ${shellJS(x, indent + 1, wide)}`);
  if (!parts.length) return t === "Array" ? "[]" : "{}";
  const flat = t === "Array" ? `[${parts.join(", ")}]` : `{ ${parts.join(", ")} }`;
  if (flat.length <= wide && !flat.includes("\n")) return flat;
  return t === "Array" ? `[\n${parts.map((p) => inner + p).join(",\n")}\n${pad}]` : `{\n${parts.map((p) => inner + p).join(",\n")}\n${pad}}`;
}

/** Table columns for a set of documents: _id first, then by how often a key appears. */
export function columnsOf(docs, max = 12) {
  const counts = new Map();
  for (const d of docs) for (const k of Object.keys(d ?? {})) counts.set(k, (counts.get(k) ?? 0) + 1);
  const keys = [...counts.keys()].sort((a, b) => (a === "_id" ? -1 : b === "_id" ? 1 : counts.get(b) - counts.get(a)));
  return keys.slice(0, max);
}

// ---------- explain ----------

function stageNode(plan) {
  if (!plan || typeof plan !== "object") return null;
  const kids = [plan.inputStage, ...(plan.inputStages ?? [])].map(stageNode).filter(Boolean);
  return {
    stage: plan.stage ?? plan.planNodeType ?? "?",
    index: plan.indexName ?? null,
    keys: plan.keyPattern ?? null,
    filter: plan.filter ?? null,
    returned: plan.nReturned ?? null,
    examined: plan.docsExamined ?? plan.keysExamined ?? null,
    ms: plan.executionTimeMillisEstimate ?? null,
    kids,
  };
}

/** {tree, stats, collscan} from an explain result (queryPlanner / executionStats). */
export function readExplain(data) {
  if (!data || typeof data !== "object") return null;
  const root = data.explainResult ?? data.explain ?? data;
  const planner = root.queryPlanner ?? root.stages?.[0]?.$cursor?.queryPlanner ?? null;
  const exec = root.executionStats ?? root.stages?.[0]?.$cursor?.executionStats ?? null;
  const winning = exec?.executionStages ?? planner?.winningPlan?.queryPlan ?? planner?.winningPlan ?? null;
  if (!winning) return null;
  const tree = stageNode(winning);
  const flat = [];
  const walk = (n) => {
    flat.push(n.stage);
    n.kids.forEach(walk);
  };
  walk(tree);
  return {
    tree,
    collscan: flat.includes("COLLSCAN"),
    sortInMemory: flat.includes("SORT"),
    stats: exec ? { returned: exec.nReturned, docs: exec.totalDocsExamined, keys: exec.totalKeysExamined, ms: exec.executionTimeMillis } : null,
    namespace: planner?.namespace ?? null,
  };
}
