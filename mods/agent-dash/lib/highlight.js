// A small lexer per language: tokens keep multi-line strings and comments right,
// then split into lines of {c: class, t: text}. Views color classes from the theme.

const KW_JS =
  "const|let|var|function|return|if|else|for|while|do|of|in|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|type|interface|as|switch|case|break|continue|this|null|undefined|true|false|void|delete|yield|static|get|set|readonly|enum|implements|private|public|protected|declare|keyof|satisfies";
const KW_SWIFT =
  "let|var|func|struct|class|enum|case|switch|if|else|guard|return|import|private|fileprivate|public|internal|static|some|any|in|for|while|repeat|true|false|nil|self|Self|init|deinit|extension|protocol|where|throws|rethrows|try|await|async|defer|inout|mutating|override|final|weak|lazy|do|catch|break|continue|default|typealias";
const KW_PY = "def|class|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|None|True|False|async|await|global|nonlocal";
const KW_RS = "fn|let|mut|const|static|struct|enum|impl|trait|pub|use|mod|crate|self|Self|super|match|if|else|for|while|loop|in|return|break|continue|as|ref|move|async|await|where|type|unsafe|dyn|true|false|Some|None|Ok|Err";
const KW_GO = "func|package|import|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|break|continue|select|nil|true|false";

const R = (src) => new RegExp(src, "y");

const C_LIKE = (kw) => [
  ["com", R(String.raw`\/\/[^\n]*`)],
  ["com", R(String.raw`\/\*[\s\S]*?\*\/`)],
  ["str", R(String.raw`"(?:\\.|[^"\\\n])*"`)],
  ["str", R(String.raw`'(?:\\.|[^'\\\n])*'`)],
  ["num", R(String.raw`\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b`)],
  ["kw", R(String.raw`\b(?:${kw})\b`)],
  ["type", R(String.raw`\b[A-Z][A-Za-z0-9_]*\b`)],
  ["fn", R(String.raw`[a-zA-Z_][\w]*(?=\s*[(<])`)],
  ["", R(String.raw`[a-zA-Z_][\w]*`)],
  ["pun", R(String.raw`[{}()[\];,.:=<>+\-*/%!&|^~?]`)],
];

const RULES = {
  js: [
    ["com", R(String.raw`\/\/[^\n]*`)],
    ["com", R(String.raw`\/\*[\s\S]*?\*\/`)],
    ["str", R(String.raw`\`(?:\\[\s\S]|\$\{[^}]*\}|[^\\\`])*\``)],
    ["str", R(String.raw`"(?:\\.|[^"\\\n])*"`)],
    ["str", R(String.raw`'(?:\\.|[^'\\\n])*'`)],
    ["tag", R(String.raw`(?<=[\s(={>]|^)<\/?[A-Za-z][\w.-]*`)],
    ["num", R(String.raw`\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b`)],
    ["kw", R(String.raw`\b(?:${KW_JS})\b`)],
    ["type", R(String.raw`\b[A-Z][A-Za-z0-9_]*\b`)],
    ["fn", R(String.raw`[a-zA-Z_$][\w$]*(?=\s*\()`)],
    ["prop", R(String.raw`(?<=\.)[a-zA-Z_$][\w$]*`)],
    ["key", R(String.raw`[a-zA-Z_$][\w$]*(?=\??\s*:(?!:))`)],
    ["", R(String.raw`[a-zA-Z_$][\w$]*`)],
    ["op", R(String.raw`=>|\?\?|\?\.|&&|\|\||\.\.\.`)],
    ["pun", R(String.raw`[{}()[\];,.=<>+\-*/%!&|^~?:]`)],
  ],
  json: [
    ["key", R(String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`)],
    ["str", R(String.raw`"(?:\\.|[^"\\])*"`)],
    ["num", R(String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`)],
    ["kw", R(String.raw`\b(?:true|false|null)\b`)],
    ["pun", R(String.raw`[{}[\],:]`)],
  ],
  bash: [
    ["com", R(String.raw`(?<=^|\s)#[^\n]*`)],
    ["str", R(String.raw`"(?:\\.|[^"\\])*"`)],
    ["str", R(String.raw`'[^']*'`)],
    ["var", R(String.raw`\$\{[^}]+\}|\$\([^)]*\)|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@#?*!$]`)],
    ["var", R(String.raw`(?<=(?:^|\n|[|;&(])\s*)[A-Za-z_][A-Za-z0-9_]*=(?=\S)`)],
    ["cmd", R(String.raw`(?<=(?:^|\n|[|;&(]|&&|\|\|)\s*)[A-Za-z_.~\/][\w.~\/+-]*`)],
    ["flag", R(String.raw`(?<=\s)--?[A-Za-z0-9][\w-]*`)],
    ["op", R(String.raw`&&|\|\||2>&1|&>|>>|<<-?|[|;&<>]`)],
    ["", R(String.raw`[^\s|;&<>()"'$#]+`)],
  ],
  css: [
    ["com", R(String.raw`\/\*[\s\S]*?\*\/`)],
    ["kw", R(String.raw`@[a-z-]+`)],
    ["var", R(String.raw`--[\w-]+`)],
    ["prop", R(String.raw`[a-z-]+(?=\s*:[^:])`)],
    ["str", R(String.raw`"[^"\n]*"|'[^'\n]*'`)],
    ["num", R(String.raw`#[0-9a-fA-F]{3,8}\b`)],
    ["num", R(String.raw`-?\d*\.?\d+(?:px|em|rem|%|s|ms|vh|vw|fr|deg)?`)],
    ["fn", R(String.raw`[a-z-]+(?=\()`)],
    ["type", R(String.raw`[.#][A-Za-z_][\w-]*`)],
    ["pun", R(String.raw`[{}();:,]`)],
  ],
  md: [
    ["head", R(String.raw`(?<=^|\n)#{1,6} [^\n]*`)],
    ["dim", R(String.raw`(?<=^|\n)\`\`\`[^\n]*`)],
    ["kw", R(String.raw`(?<=^|\n)\s*(?:[-*+]|\d+\.)(?= )`)],
    ["bold", R(String.raw`\*\*[^*\n]+\*\*`)],
    ["code", R(String.raw`\`[^\`\n]+\``)],
    ["link", R(String.raw`\[[^\]\n]+\]\([^)\n]+\)`)],
    ["pun", R(String.raw`\|`)],
  ],
  mongo: [
    ["kw", R(String.raw`\$[a-zA-Z]+`)],
    ["fn", R(String.raw`\b(?:ObjectId|ISODate|NumberLong|Long|Decimal128|NumberDecimal|Timestamp|new Date)(?=\()`)],
    ["key", R(String.raw`(?:[A-Za-z_][\w.]*|'[^'\n]*'|"[^"\n]*")(?=\s*:)`)],
    ["str", R(String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"`)],
    ["num", R(String.raw`-?\b\d+(?:\.\d+)?\b`)],
    ["kw", R(String.raw`\b(?:true|false|null)\b`)],
    ["pun", R(String.raw`[{}[\],:()]`)],
  ],
  regex: [
    ["esc", R(String.raw`\\[\s\S]`)],
    ["class", R(String.raw`\[(?:\\.|[^\]\\])*\]`)],
    ["quant", R(String.raw`[*+?]\??|\{\d+(?:,\d*)?\}`)],
    ["group", R(String.raw`\(\?(?:<?[=!]|:|<[a-zA-Z]+>)|[()]`)],
    ["anchor", R(String.raw`[\^$|]`)],
  ],
  glob: [
    ["quant", R(String.raw`\*\*|\*|\?`)],
    ["group", R(String.raw`\{[^}]*\}`)],
    ["class", R(String.raw`\[[^\]]*\]`)],
    ["pun", R(String.raw`\/`)],
  ],
  yaml: [
    ["com", R(String.raw`#[^\n]*`)],
    ["key", R(String.raw`(?<=^|\n)\s*[\w.-]+(?=\s*[:=])`)],
    ["str", R(String.raw`"[^"\n]*"|'[^'\n]*'`)],
    ["num", R(String.raw`\b\d+(?:\.\d+)?\b`)],
    ["kw", R(String.raw`\b(?:true|false|null|yes|no)\b`)],
  ],
  python: [
    ["com", R(String.raw`#[^\n]*`)],
    ["str", R(String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''`)],
    ["str", R(String.raw`[rbfu]?"(?:\\.|[^"\\\n])*"|[rbfu]?'(?:\\.|[^'\\\n])*'`)],
    ["num", R(String.raw`\b\d[\d_]*(?:\.\d+)?\b`)],
    ["kw", R(String.raw`\b(?:${KW_PY})\b`)],
    ["type", R(String.raw`\b[A-Z][A-Za-z0-9_]*\b`)],
    ["fn", R(String.raw`[a-zA-Z_]\w*(?=\s*\()`)],
    ["", R(String.raw`[a-zA-Z_]\w*`)],
    ["pun", R(String.raw`[{}()[\];,.:=<>+\-*/%!&|^~@]`)],
  ],
  html: [
    ["com", R(String.raw`<!--[\s\S]*?-->`)],
    ["tag", R(String.raw`<\/?[A-Za-z][\w:-]*|\/?>`)],
    ["attr", R(String.raw`[A-Za-z_:][\w:.-]*(?==)`)],
    ["str", R(String.raw`"[^"]*"|'[^']*'`)],
  ],
};
RULES.swift = C_LIKE(KW_SWIFT);
RULES.rust = C_LIKE(KW_RS);
RULES.go = C_LIKE(KW_GO);

function lexAll(code, rules) {
  const out = [];
  let plain = "";
  let i = 0;
  outer: while (i < code.length) {
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) {
        if (plain) out.push({ c: "", t: plain });
        plain = "";
        out.push({ c: cls, t: m[0] });
        i += m[0].length;
        continue outer;
      }
    }
    plain += code[i++];
  }
  if (plain) out.push({ c: "", t: plain });
  return out;
}

// Very long inputs skip lexing: a 2 MB lockfile isn't worth a frame.
const LEX_LIMIT = 300000;

/** code -> array of lines, each an array of {c, t}. */
export function tokenize(code, lang) {
  const text = String(code ?? "");
  const rules = text.length <= LEX_LIMIT ? RULES[lang] : null;
  const tokens = rules ? lexAll(text, rules) : [{ c: "", t: text }];
  const lines = [[]];
  for (const tok of tokens) {
    const parts = tok.t.split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ c: tok.c, t: part });
    });
  }
  return lines;
}

/** Splits a line's tokens at mark boundaries: [{c, t, m}] where m = inside a changed range. */
export function markRuns(tokens, marks) {
  if (!marks || !marks.length) return tokens;
  const out = [];
  let pos = 0;
  for (const tok of tokens) {
    const start = pos;
    const end = pos + tok.t.length;
    const cuts = new Set([start, end]);
    for (const [ms, me] of marks) {
      if (ms > start && ms < end) cuts.add(ms);
      if (me > start && me < end) cuts.add(me);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k];
      const b = sorted[k + 1];
      const inside = marks.some(([ms, me]) => a >= ms && b <= me);
      out.push({ c: tok.c, t: tok.t.slice(a - start, b - start), m: inside });
    }
    pos = end;
  }
  return out;
}

// ---------- caches: the same text is drawn on every frame ----------

const LINE_CACHE = new Map();
const LINE_CACHE_MAX = 4000;

/** Tokens of one line on its own (no multi-line context), cached. */
export function lineTokens(lang, text) {
  const key = `${lang}\u0000${text}`;
  let hit = LINE_CACHE.get(key);
  if (!hit) {
    hit = tokenize(text, lang)[0] ?? [];
    if (LINE_CACHE.size >= LINE_CACHE_MAX) LINE_CACHE.delete(LINE_CACHE.keys().next().value);
    LINE_CACHE.set(key, hit);
  }
  return hit;
}

const DOC_CACHE = new Map();
const SMALL_DOC = 8000;

/** A text split into lines whose tokens come on demand: whole-text lexing when small
 *  (multi-line strings and comments stay right), line by line when large. */
export function tokenDoc(text, lang) {
  const key = `${lang}\u0000${text}`;
  const hit = DOC_CACHE.get(key);
  if (hit) return hit;
  const source = String(text ?? "");
  const lines = source.split("\n");
  const whole = source.length <= SMALL_DOC ? tokenize(source, lang) : null;
  let widest = 0;
  for (let i = 0; i < lines.length && i < 5000; i++) if (lines[i].length > widest) widest = lines[i].length;
  const doc = { lines, widest, count: lines.length, tokens: (i) => (whole ? whole[i] ?? [] : lineTokens(lang, lines[i] ?? "")) };
  if (DOC_CACHE.size >= 24) DOC_CACHE.delete(DOC_CACHE.keys().next().value);
  DOC_CACHE.set(key, doc);
  return doc;
}
