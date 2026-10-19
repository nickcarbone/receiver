// Probes every built-in https stream in docs/mobile.html.
// A station only counts as failing after three attempts, because big CDNs
// (SRG SSR, Skyrock) occasionally return a one-off 404 or timeout from a
// single node. Writes stream-report.md and exits 1 if anything is down.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] || "docs/mobile.html";
const html = readFileSync(file, "utf8");
const rows = [...html.matchAll(/\{id:"([^"]+)", n:"([^"]+)".*?url:"([^"]+)"/g)]
  .map(m => ({ id: m[1], name: m[2], url: m[3] }))
  .filter(s => s.url.startsWith("https://"));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probeOnce(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": "Receiver stream check (github.com/nickcarbone/receiver)" } });
    const type = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) return `HTTP ${r.status}`;
    const reader = r.body.getReader();
    let bytes = 0, head = "";
    while (bytes < 8192) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (head.length < 64) head += new TextDecoder().decode(value.slice(0, 64));
    }
    ctl.abort();
    if (/mpegurl/.test(type) || /\.m3u8/i.test(url)) return head.includes("#EXTM3U") ? null : "playlist without #EXTM3U";
    if (!/^audio\/|application\/ogg|octet-stream/.test(type)) return `unexpected content-type "${type}"`;
    if (bytes < 2048) return `only ${bytes} bytes`;
    return null;
  } catch (e) {
    return e.name === "AbortError" ? "timed out" : (e.cause?.code || e.message);
  } finally { clearTimeout(timer); }
}

async function probe(s) {
  let err;
  for (let i = 0; i < 3; i++) {
    err = await probeOnce(s.url);
    if (!err) return { ...s, ok: true };
    await sleep(3000 * (i + 1));
  }
  return { ...s, ok: false, err };
}

const results = [];
for (let i = 0; i < rows.length; i += 10) {
  results.push(...await Promise.all(rows.slice(i, i + 10).map(probe)));
}
const bad = results.filter(r => !r.ok);
const report = [
  `Checked ${results.length} https streams on ${new Date().toISOString().slice(0, 10)}. ${bad.length} failing after three attempts each.`,
  "",
  ...(bad.length ? ["| Station | id | Problem | URL |", "|---|---|---|---|",
    ...bad.map(b => `| ${b.name} | \`${b.id}\` | ${b.err} | ${b.url} |`)] : ["All streams returned audio."]),
].join("\n");
writeFileSync("stream-report.md", report + "\n");
console.log(report);
process.exit(bad.length ? 1 : 0);
