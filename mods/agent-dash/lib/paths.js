// File paths as the views show them: relative to the agent's folder, ~ for home.

export const baseName = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";

export function dirName(p) {
  const parts = String(p ?? "").split("/");
  parts.pop();
  return parts.join("/");
}

export function relPath(path, cwd, home) {
  const p = String(path ?? "");
  if (cwd && p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1);
  if (home && p === home) return "~";
  if (home && p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
  return p;
}

export function tildePath(path, home) {
  const p = String(path ?? "");
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

const LANGS = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", tsx: "js", mts: "js",
  json: "json", jsonl: "json", json5: "json",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  css: "css", scss: "css",
  md: "md", markdown: "md",
  swift: "swift",
  yml: "yaml", yaml: "yaml", toml: "yaml",
  py: "python", rs: "rust", go: "go", html: "html", xml: "html", svg: "html",
};

export function langOf(path) {
  const name = baseName(path).toLowerCase();
  if (name === "dockerfile" || name === "makefile") return "bash";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return LANGS[ext] ?? "text";
}

// The Editor component's language names (tree-sitter).
const EDITOR_LANGS = { js: "javascript", json: "json", bash: "bash", css: "css", md: "markdown", swift: "swift", yaml: "yaml", python: "python", rust: "rust", go: "go", html: "html" };
export const editorLang = (path) => EDITOR_LANGS[langOf(path)] ?? "text";
