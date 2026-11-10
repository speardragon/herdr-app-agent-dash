// "웹에서 열기": make sure bin/server.py runs, then hand the browser a link to the same agent,
// lens and call. The server runs as a herdr-core terminal (`agent-dash-web`), so `hc ls` shows it
// and `hc kill agent-dash-web` stops it; it also exits by itself after 30 idle minutes.

import { exec, appHome, readTextFile } from "herdr";

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

async function healthy(info) {
  if (!info) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/health`);
    if (!response.ok) return false;
    const body = await response.json();
    return body?.app === "agent-dash";
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

/** The page's address for {scope, lens, call}, starting the server first when it isn't up. */
export async function webAddress(target) {
  let info = await serverInfo();
  if (!(await healthy(info))) {
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
