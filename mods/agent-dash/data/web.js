// "웹에서 열기": make sure bin/server.py runs, then hand the browser a link to the same agent,
// lens and call. The server runs as a herdr-core terminal (`agent-dash-web`), so `hc ls` shows it
// and `hc kill agent-dash-web` stops it; it also exits by itself after 30 idle minutes.

import { exec, appHome, readTextFile, writeTextFile } from "herdr";

const stateDir = () => `${appHome()}/mods/agent-dash/.web`;
const WEB_LENS = { overview: "overview", calls: "tools", links: "links", prompts: "prompts", changes: "diffs", subs: "subs" };
const START_TRIES = 24;

async function serverInfo() {
  try {
    const [port, token] = await Promise.all([readTextFile(`${stateDir()}/port`), readTextFile(`${stateDir()}/token`)]);
    return port && token ? { port: port.trim(), token: token.trim() } : null;
  } catch {
    return null;
  }
}

// The server file's modified time (seconds): a server started from an older copy is restarted.
async function currentRev() {
  try {
    const out = await exec("stat", ["-f", "%m", `${appHome()}/mods/agent-dash/bin/server.py`]);
    const rev = parseInt(String(out.stdout ?? "").trim(), 10);
    return Number.isFinite(rev) ? rev : null;
  } catch {
    return null;
  }
}

async function healthy(info, rev = null) {
  if (!info) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/health`);
    if (!response.ok) return false;
    const body = await response.json();
    return body?.app === "agent-dash" && (rev === null || body.rev === rev);
  } catch {
    return false;
  }
}

async function startServer() {
  const bin = `${appHome()}/mods/agent-dash/bin`;
  const viaCore = await exec("hc", ["run", "--bg", "--no-parent", "--rm", "--name", "agent-dash-web", "--cwd", bin, "--", "python3", "server.py"]).catch(() => null);
  // A failed run (another copy just started it and holds the name) only needs the wait that follows;
  // without herdr-core on PATH, run it detached instead.
  if (viaCore !== null) return;
  await exec("sh", ["-c", 'cd "$1" && nohup python3 server.py >/dev/null 2>&1 &', "sh", bin]);
}

/** What the web page needs to draw spaces as the app does: id, name, logo and color of each.
 *  The logos live in the app's shared state, which only the mod can read. */
export async function writeSpaces(list) {
  try {
    const path = `${stateDir()}/spaces.json`;
    const current = await readTextFile(path).catch(() => null);
    await writeTextFile(path, JSON.stringify(list), current ?? null);
  } catch {
    // the page then draws letters on neutral tiles
  }
}

/** The page's address for {scope, lens, call}, starting the server first when it isn't up. */
export async function webAddress(target) {
  let info = await serverInfo();
  const rev = await currentRev();
  if (!(await healthy(info, rev))) {
    // An older copy may still hold the port or the name: stop it before starting the new one.
    if (await healthy(info)) {
      await exec("hc", ["kill", "agent-dash-web"]).catch(() => null);
      await exec("sleep", ["0.5"]);
    }
    await startServer();
    for (let i = 0; i < START_TRIES; i++) {
      await exec("sleep", ["0.25"]);
      info = await serverInfo();
      if (await healthy(info)) break;
    }
  }
  if (!(await healthy(info))) throw new Error("웹 서버를 켜지 못했어요. python3가 있는지 확인해 주세요.");
  const parts = [`t=${info.token}`];
  if (target.scope && target.scope !== "all") parts.push(`agent=${encodeURIComponent(target.scope)}`);
  parts.push(`lens=${WEB_LENS[target.lens] ?? "overview"}`);
  if (target.call) parts.push(`call=${encodeURIComponent(target.call)}`);
  return `http://127.0.0.1:${info.port}/#${parts.join("&")}`;
}
