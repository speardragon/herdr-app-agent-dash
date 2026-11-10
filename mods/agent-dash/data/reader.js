// Runs bin/transcript.py and reads its NDJSON. The script does the heavy lifting
// (60 MB transcripts, base64 images); the mod only gets compact events.

import { exec, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";

const script = () => `${appHome()}/mods/agent-dash/bin/transcript.py`;
const TIMEOUT = 60000;
// Small reads keep each step of JSON parsing short on QuickJS; big sessions take a few rounds.
const BUDGET = "1500000";

function parseLines(stdout) {
  const events = [];
  let end = null;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.k === "end") end = event;
    else events.push(event);
  }
  return { events, end };
}

async function run(args) {
  const r = await exec("python3", [script(), ...args], { timeout: TIMEOUT });
  if (!r.stdout) throw new Error(r.stderr.trim() || `transcript.py가 ${r.code}로 끝났어요`);
  const parsed = parseLines(r.stdout);
  const failure = parsed.events.find((e) => e.k === "error");
  if (failure) throw new Error(failure.message);
  return parsed;
}

/** Locates the agent process's transcript and reads it from `offset`. */
export const syncTranscript = ({ provider, pid, cwd, file, offset, hints }) =>
  run(["sync", provider, String(pid), cwd ?? "", file ?? "-", String(offset ?? 0), BUDGET, ...(hints ? [JSON.stringify(hints)] : [])]);

/** Reads any transcript file (a sub-agent's) from `offset`. */
export const readTranscript = ({ provider, file, offset }) => run(["read", provider, file, String(offset ?? 0), BUDGET]);

/** The text of `path` before the session first changed it: {found, created, text}. */
export async function originalText(file, path) {
  const { events } = await run(["original", file, path]);
  return events[0] ?? { found: false };
}

/** The file as it is now (null when gone or larger than 1 MiB). */
export async function currentText(path) {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

const IMAGE_MAX = 12 * 1024 * 1024;

function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** image() reads from the app folder: copy a picture there (a hidden folder, so saving it
 *  doesn't reload the mod). Returns the app-relative path, or null when it's gone. */
export async function cachedImage(path) {
  const ext = (/\.(png|jpe?g|gif|webp|svg)$/i.exec(path)?.[1] ?? "png").toLowerCase();
  const rel = `mods/agent-dash/.cache/${hashOf(path)}.${ext}`;
  if (await fs.exists(`${appHome()}/${rel}`)) return rel;
  if (!(await fs.exists(path))) return null;
  const bytes = await fs.readFile(path);
  if (bytes.length > IMAGE_MAX) return null;
  await fs.mkdir(`${appHome()}/mods/agent-dash/.cache`, { recursive: true });
  await fs.writeFile(`${appHome()}/${rel}`, bytes);
  return rel;
}

/** The committed version, for Codex sessions that don't record originals. */
export async function headText(cwd, path) {
  try {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    if (top.code !== 0) return null;
    const root = top.stdout.trim();
    const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    const r = await exec("git", ["--no-optional-locks", "show", `HEAD:${rel}`], { cwd: root });
    return r.code === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}
