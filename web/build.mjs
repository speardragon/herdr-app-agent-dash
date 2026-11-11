// Builds the web page Agent Dash serves (bin/server.py) into the mod folder:
// ~/.config/herdr-app/mods/agent-dash/web/index.html.
// One module script: the page's files share one scope (as the prototype's classic scripts did),
// and the mod's lib/ comes in through lib-bridge.js imports, served by the same server.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.AGENT_DASH_WEB_OUT ?? join(homedir(), ".config/herdr-app/mods/agent-dash/web/index.html");

const CSS = [
  "src/css/tokens.css",
  "src/css/base.css",
  "src/css/shell.css",
  "src/css/lenses.css",
  "src/css/code.css",
  "src/css/tools.css",
  "src/css/mongo.css",
  "src/css/web.css",
  "src/css/sites.css",
  "src/css/sites-google.css",
];

const JS = [
  "src/js/lib-bridge.js",
  "src/js/util.js",
  "src/js/icons.js",
  "src/js/highlight.js",
  "src/js/diff.js",
  "src/js/data/index.js",
  "src/js/data/real.js",
  "src/js/tools/registry.js",
  "src/js/tools/shell.js",
  "src/js/tools/files.js",
  "src/js/tools/search.js",
  "src/js/tools/web.js",
  "src/js/tools/agentic.js",
  "src/js/tools/mongo.js",
  "src/js/tools/product.js",
  "src/js/tools/product-google.js",
  "src/js/tools/mcp.js",
  "src/js/tools/stage.js",
  "src/js/views/rail.js",
  "src/js/views/overview.js",
  "src/js/views/tools-lens.js",
  "src/js/views/links.js",
  "src/js/views/prompts.js",
  "src/js/views/diffs.js",
  "src/js/views/subs.js",
  "src/js/views/concept-a.js",
  "src/js/views/overlays.js",
  "src/js/resize.js",
  "src/js/app.js",
];

function read(path) {
  const full = join(root, path);
  if (!existsSync(full)) throw new Error(`build: missing ${path}`);
  return readFileSync(full, "utf8");
}

function build() {
  const css = CSS.map(read).join("\n");
  const js = JS.map((p) => `/* ---- ${p} ---- */\n${read(p)}`).join("\n");
  const html = read("src/template.html")
    .replace("/*__FAVICON_64__*/", () => readFileSync(join(root, "src/assets/favicon-64.png")).toString("base64"))
    .replace("/*__FAVICON_32__*/", () => readFileSync(join(root, "src/assets/favicon-32.png")).toString("base64"))
    .replace("/*__CSS__*/", () => css)
    .replace("/*__JS__*/", () => js);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist/.bundle-check.mjs"), js.replace(/^import \* as (\w+) from "\/lib\/(\w+)\.js";$/gm, (_, ns, mod) => `import * as ${ns} from "${join(homedir(), ".config/herdr-app/mods/agent-dash/lib", `${mod}.js`)}";`));
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  process.stdout.write(`built ${OUT} (${kb} KB, ${JS.length} scripts)\n`);
}

try {
  build();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
