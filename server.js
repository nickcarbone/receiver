#!/usr/bin/env node
/**
 * Receiver — local radio server
 * Node 18+. No dependencies.
 *
 *   node server.js          → http://localhost:7799
 *
 * What it does that a browser cannot:
 *   1. Reads ICY metadata (the inline "Artist - Title" field in the stream).
 *   2. Serves audio same-origin, so the Web Audio analyser returns real data.
 *   3. Sidesteps CORS and lets an https page play an http-only stream.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 7799;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "docs");
const DATA = path.join(ROOT, "data");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

fs.mkdirSync(DATA, { recursive: true });

/* ---------------- storage ---------------- */
const file = n => path.join(DATA, n);
const load = (n, fb) => { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return fb; } };
const save = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));

let stations = load("stations.json", [
  { id:"monocle",  name:"Monocle 24",    cat:"Talk",   city:"London",   url:"https://playerservices.streamtheworld.com/api/livestream-redirect/MONOCLE_24AAC.aac" },
  { id:"riviera",  name:"Riviera Radio", cat:"Top 40", city:"Monaco",   url:"https://media-ssl.musicradio.com/RivieraRadio" },
  { id:"kerrang",  name:"Kerrang!",      cat:"Rock",   city:"London",   url:"https://stream-al.hellorayo.co.uk/kerrang.aac?direct=true" },
]);
let history = load("history.json", []);

/* ---------------- http helpers ---------------- */
function request(url, opts = {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, {
      method: opts.method || "GET",
      headers: { "User-Agent": UA, "Accept": "*/*", ...(opts.headers || {}) },
      timeout: opts.timeout || 15000,
    }, res => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects > 0) {
        res.resume();
        return resolve(request(new URL(loc, u).toString(), opts, redirects - 1));
      }
      res.finalUrl = u.toString();
      resolve(res);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function text(url, limit = 900000) {
  const res = await request(url);
  if (res.statusCode >= 400) { res.resume(); throw new Error("HTTP " + res.statusCode); }
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", c => { buf += c; if (buf.length > limit) { res.destroy(); resolve(buf); } });
    res.on("end", () => resolve(buf));
    res.on("error", reject);
  });
}

/* ---------------- stream resolver ----------------
   Turns whatever you paste — a homepage, a playlist, a direct stream —
   into a playable URL. Best effort: JS-rendered players and bot-challenged
   sites will fail, and it says so rather than guessing. */
const AUDIO_RE = /https?:\/\/[^\s"'`<>\\]+?\.(?:mp3|aac|aacp|m3u8|ogg|opus)(?:\?[^\s"'`<>\\]*)?/gi;
const LIST_RE  = /https?:\/\/[^\s"'`<>\\]+?\.(?:pls|m3u)(?:\?[^\s"'`<>\\]*)?/gi;

async function resolveStream(input, depth = 0, seen = new Set()) {
  if (depth > 2) throw new Error("Gave up after following too many links.");
  const norm = input.replace(/\/+$/, "");
  if (seen.has(norm)) throw new Error("Already tried that URL.");
  seen.add(norm);
  const trail = [];
  const looksAudio = /\.(mp3|aac|aacp|ogg|opus)(\?|$)/i.test(input);
  const looksHls   = /\.m3u8(\?|$)/i.test(input);
  const looksList  = /\.(pls|m3u)(\?|$)/i.test(input);

  if (looksHls) return { url: input, kind: "hls", trail: ["direct HLS"], note: "HLS stream — plays via hls.js, but carries no ICY metadata." };
  if (looksAudio) return { url: input, kind: "stream", trail: ["direct stream"] };

  if (looksList) {
    trail.push("playlist file");
    const body = await text(input, 50000);
    const m = body.match(AUDIO_RE) || body.match(/^File\d*=(.+)$/gim)?.map(l => l.split("=")[1].trim())
            || body.split("\n").filter(l => /^https?:/.test(l.trim()));
    if (m && m[0]) return { url: m[0].trim(), kind: "stream", trail: [...trail, "extracted entry"] };
    throw new Error("Playlist contained no stream URL.");
  }

  // A bare host with no extension may still be an Icecast mount (Riviera is one).
  try {
    const probe = await request(input, { headers: { "Icy-MetaData": "1" }, timeout: 6000 });
    const ct = String(probe.headers["content-type"] || "");
    probe.destroy();
    if (/^audio\//i.test(ct)) return { url: input, kind: "stream", trail: ["responded as audio"] };
  } catch {}

  // Otherwise treat it as a page and hunt.
  trail.push("scanned page");
  let html;
  try { html = await text(input); }
  catch (e) {
    if (/HTTP (403|429|454|503)/.test(e.message))
      throw new Error("The site blocked an automated request (" + e.message + "). Open the player in your browser, look in the Network tab for a request to an .mp3, .aac or .m3u8, and paste that URL here instead.");
    throw e;
  }
  const lists = [...new Set(html.match(LIST_RE) || [])];
  const direct = [...new Set(html.match(AUDIO_RE) || [])]
    .filter(u => !/\.(js|css)\b/i.test(u));

  // Framework payloads often hide the URL in an escaped prop (Astro, Nuxt, Next).
  const escaped = [...new Set((html.replace(/&quot;/g, '"').match(/"(https?:\/\/[^"]*(?:stream|listen|live|radio|media|audio)[^"]*)"/gi) || [])
    .map(s => s.replace(/^"|"$/g, "")))].filter(u => !/\.(js|css|png|jpg|svg|woff2?)(\?|$)/i.test(u));

  // Rank: things that look like a stream host get probed first, so we don't
  // burn the clock on analytics and CDN URLs that merely contain "media".
  const score = u => (/(stream|icecast|shoutcast|listen|live)/i.test(u) ? 3 : 0)
                   + (/(media|radio|audio|cast)/i.test(u) ? 1 : 0)
                   - (/(google|facebook|doubleclick|analytics|gstatic|cookie|consent|sentry)/i.test(u) ? 5 : 0);
  const inputHost = (() => { try { return new URL(input).host; } catch { return ""; } })();
  const candidates = [...new Set([...direct, ...lists, ...escaped])]
    .filter(c => {
      const n = c.replace(/\/+$/, "");
      if (seen.has(n) || n === norm) return false;                       // don't chase our own tail
      if (/(instagram|facebook|youtube|linkedin|twitter|x\.com|tiktok)\./i.test(c)) return false;
      try { const h = new URL(c).host; if (h === inputHost && !/\.(mp3|aac|aacp|m3u8|pls|m3u)(\?|$)/i.test(c)) return false; } catch { return false; }
      return true;
    })
    .sort((a, b) => score(b) - score(a));
  if (!candidates.length) {
    if (/checking your browser|cf-browser-verification|challenge/i.test(html))
      throw new Error("Site is behind a bot challenge. Open the player, check the browser Network tab, and paste the stream URL directly.");
    throw new Error("No stream URL found on that page. It is probably built by JavaScript — grab the URL from the Network tab instead.");
  }

  for (const c of candidates.slice(0, 6)) {
    try {
      const r = await resolveStream(c, depth + 1, seen);
      return { ...r, trail: [...trail, ...r.trail] };
    } catch {}
  }
  throw new Error("Found candidate URLs but none played. Candidates: " + candidates.slice(0, 3).join(", "));
}

/* ---------------- ICY proxy ----------------
   Opens the stream asking for metadata, splits the interleaved title blocks
   out of the byte stream, and forwards clean audio to the browser. */
const listeners = new Map();   // stationId -> Set(SSE res)
const nowPlaying = new Map();  // stationId -> {title, artist, art, at}

function pushMeta(id, meta) {
  nowPlaying.set(id, meta);
  const payload = "data: " + JSON.stringify(meta) + "\n\n";
  for (const res of listeners.get(id) || []) { try { res.write(payload); } catch {} }
}

function parseIcyTitle(raw) {
  const m = /StreamTitle='([^']*)'/.exec(raw);
  if (!m) return null;
  const s = m[1].trim();
  if (!s) return null;
  const dash = s.split(/\s+-\s+/);
  return dash.length >= 2
    ? { artist: dash[0].trim(), title: dash.slice(1).join(" - ").trim(), raw: s }
    : { artist: "", title: s, raw: s };
}

const artCache = new Map();
async function lookupArt(artist, title) {
  const key = (artist + "|" + title).toLowerCase();
  if (artCache.has(key)) return artCache.get(key);
  let art = null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const j = JSON.parse(await text(`https://itunes.apple.com/search?term=${term}&media=music&limit=1`, 200000));
    if (j.results?.[0]?.artworkUrl100) art = j.results[0].artworkUrl100.replace("100x100", "300x300");
  } catch {}
  artCache.set(key, art);
  if (artCache.size > 400) artCache.clear();
  return art;
}

function logHistory(id, meta) {
  const st = stations.find(s => s.id === id);
  const last = history[0];
  if (last && last.raw === meta.raw && last.station === id) return;
  history.unshift({ station: id, stationName: st?.name || id, artist: meta.artist, title: meta.title, raw: meta.raw, at: new Date().toISOString() });
  if (history.length > 2000) history.length = 2000;
  save("history.json", history);
}

async function proxyStream(id, url, clientRes) {
  let upstream;
  try {
    upstream = await request(url, { headers: { "Icy-MetaData": "1" } });
  } catch (e) {
    clientRes.writeHead(502, { "Content-Type": "text/plain" });
    return clientRes.end("Upstream failed: " + e.message);
  }
  if (upstream.statusCode >= 400) {
    upstream.resume();
    const hint = upstream.statusCode === 500 || upstream.statusCode === 403
      ? " — this usually means the station is geo-fenced to its home country."
      : "";
    clientRes.writeHead(502, { "Content-Type": "text/plain" });
    return clientRes.end("Upstream returned " + upstream.statusCode + hint);
  }

  const h = upstream.headers;
  const metaint = parseInt(h["icy-metaint"], 10) || 0;
  pushMeta(id, { ...(nowPlaying.get(id) || {}), station: h["icy-name"] || null, bitrate: h["icy-br"] || null, genre: h["icy-genre"] || null, hasMeta: metaint > 0 });

  clientRes.writeHead(200, {
    "Content-Type": h["content-type"] || "audio/mpeg",
    "Cache-Control": "no-cache, no-store",
  });

  if (!metaint) { upstream.pipe(clientRes); return; }

  let counter = 0, metaLeft = 0, metaBuf = [];
  upstream.on("data", chunk => {
    let off = 0;
    while (off < chunk.length) {
      if (metaLeft > 0) {
        const take = Math.min(metaLeft, chunk.length - off);
        metaBuf.push(chunk.slice(off, off + take));
        off += take; metaLeft -= take;
        if (metaLeft === 0) {
          const raw = Buffer.concat(metaBuf).toString("utf8").replace(/\0+$/g, "");
          metaBuf = [];
          const parsed = parseIcyTitle(raw);
          if (parsed) {
            const prev = nowPlaying.get(id);
            if (!prev || prev.raw !== parsed.raw) {
              const meta = { ...parsed, station: h["icy-name"] || null, at: Date.now() };
              pushMeta(id, meta);
              logHistory(id, parsed);
              lookupArt(parsed.artist, parsed.title).then(art => {
                if (art) pushMeta(id, { ...meta, art });
              });
            }
          }
        }
        continue;
      }
      if (counter === metaint) {
        const len = chunk[off]; off += 1; counter = 0;
        metaLeft = len * 16;
        continue;
      }
      const take = Math.min(metaint - counter, chunk.length - off);
      if (!clientRes.write(chunk.slice(off, off + take))) upstream.pause();
      off += take; counter += take;
    }
  });
  clientRes.on("drain", () => upstream.resume());
  upstream.on("end", () => clientRes.end());
  upstream.on("error", () => clientRes.end());
  clientRes.on("close", () => upstream.destroy());
}

/* ---------------- routes ---------------- */
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon", ".webmanifest":"application/manifest+json" };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

  try {
    if (p === "/api/stations" && req.method === "GET") return json(200, stations);

    if (p === "/api/stations" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const s = JSON.parse(body);
      s.id = s.id || s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      const i = stations.findIndex(x => x.id === s.id);
      if (i >= 0) stations[i] = { ...stations[i], ...s }; else stations.push(s);
      save("stations.json", stations);
      return json(200, s);
    }

    if (p.startsWith("/api/stations/") && req.method === "DELETE") {
      stations = stations.filter(s => s.id !== decodeURIComponent(p.split("/")[3]));
      save("stations.json", stations);
      return json(200, { ok: true });
    }

    if (p === "/api/resolve") {
      const target = u.searchParams.get("url");
      if (!target) return json(400, { error: "Add a url parameter." });
      try { return json(200, await resolveStream(target.trim())); }
      catch (e) { return json(200, { error: e.message }); }
    }

    if (p === "/api/history") return json(200, history.slice(0, 300));

    if (p === "/api/now") {          // Server-Sent Events
      const id = u.searchParams.get("id");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      res.write(": open\n\n");
      if (nowPlaying.has(id)) res.write("data: " + JSON.stringify(nowPlaying.get(id)) + "\n\n");
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(res);
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
      req.on("close", () => { clearInterval(ping); listeners.get(id)?.delete(res); });
      return;
    }

    if (p === "/stream") {
      const id = u.searchParams.get("id");
      const st = stations.find(s => s.id === id);
      if (!st?.url) return json(404, { error: "Unknown station." });
      return proxyStream(id, st.url, res);
    }

    // static
    let f = p === "/" ? "/index.html" : p;
    const full = path.join(PUBLIC, path.normalize(f).replace(/^(\.\.[/\\])+/, ""));
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      return fs.createReadStream(full).pipe(res);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (e) {
    json(500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Receiver running → http://localhost:${PORT}`);
  console.log(`  ${stations.length} stations · library at ${file("stations.json")}\n`);
});
