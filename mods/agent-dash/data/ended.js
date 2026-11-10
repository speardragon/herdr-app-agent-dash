// Finished sub-agents. terminals() only lists live ones, so the ones that already reported
// and exited come from `hc ls --all`; `hc get` adds what the tree needs (pid, times, argv).
// A finished terminal never changes, so each is fetched once.

import { exec } from "herdr";

const MAX_NEW = 12;

async function json(args) {
  try {
    const r = await exec("hc", [...args, "--json"], { timeout: 8000 });
    return r.code === 0 && r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    return null;
  }
}

/** known: {address: terminal}. Returns the next map (same object when nothing changed). */
export async function endedTerminals(known) {
  const listing = await json(["ls", "--all"]);
  if (!listing) return known;
  const finished = (listing.terminals ?? []).filter((t) => t.state === "finished" && t.parent && !t.address.includes("/"));
  const still = new Set(finished.map((t) => t.address));
  const fresh = finished.filter((t) => !known[t.address]).slice(-MAX_NEW);
  const gone = Object.keys(known).some((a) => !still.has(a));
  if (!fresh.length && !gone) return known;
  const details = await Promise.all(fresh.map((t) => json(["get", t.address])));
  const next = Object.fromEntries(Object.entries(known).filter(([a]) => still.has(a)));
  for (const d of details) if (d?.address && d.state === "finished") next[d.address] = d;
  return next;
}
