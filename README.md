# Receiver — local server

Runs on your Mac. No dependencies, no build step, no `npm install`.

This repo is set up so the same `docs/` folder does two jobs at once:
the local Node server serves it directly, and if you turn on GitHub Pages
pointed at `/docs`, GitHub serves the same file publicly. **The public
version is view-only** — see the note at the bottom before you rely on it.

## Running it locally

You need Node 18 or newer. Check with `node -v`. If it's missing: `brew install node`.

```
git clone https://github.com/YOUR-USERNAME/receiver.git
cd receiver
node server.js
```

Then open **http://localhost:7799** — not `docs/index.html` directly. Opening
the HTML file itself in a browser (double-clicking it, or a `file://` URL)
will not work: every fetch in the page is a relative path like `/api/stations`,
and those only resolve correctly when a server is actually answering them.

Your station library lives in `data/stations.json` and your listening log in
`data/history.json` — both plain JSON you can read, edit, and back up.
`history.json` is gitignored on purpose; it's personal listening state, not
something to version.

## Endpoints

| Route | What it does |
|---|---|
| `GET /api/stations` | The library |
| `POST /api/stations` | Add or update one (`{name, cat, city, url}`) |
| `DELETE /api/stations/:id` | Remove one |
| `GET /api/resolve?url=` | Turn a station homepage or playlist into a stream URL |
| `GET /stream?id=` | Proxied audio, ICY metadata stripped out |
| `GET /api/now?id=` | Server-Sent Events — pushes each new track |
| `GET /api/history` | Everything heard, newest first |

## Keeping it running

To start it at login without a terminal window, save this as
`~/Library/LaunchAgents/local.receiver.plist`, changing `USERNAME`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.receiver</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/USERNAME/receiver/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/USERNAME/receiver</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

Then `launchctl load ~/Library/LaunchAgents/local.receiver.plist`.
On Apple silicon Node usually sits at `/opt/homebrew/bin/node` — check with `which node`.

## Updating GitHub after changes

```
git add -A
git commit -m "describe what changed"
git push
```

## About the GitHub Pages version

If Pages is enabled (Settings → Pages → Source: `main` branch, `/docs` folder),
GitHub will serve `docs/index.html` at `https://YOUR-USERNAME.github.io/receiver/`.
**Opening that URL will show the cabinet, but the library will stay empty and
nothing will play.** GitHub Pages only serves static files — there's no server
behind it to answer `/api/stations`, `/stream`, or any of the other calls the
page makes. That's expected, not a bug. Its purpose here is version control
and a public copy of the current file, not a working deployment. To actually
listen, run it locally as described above.

## Known limits

- **HLS streams** (`.m3u8`) pass through unproxied and carry no ICY metadata.
  The resolver flags them so the player knows to use a different code path.
- **Geo-fenced stations** stay blocked. A proxy on your Mac is still in your
  own country, so Kerrang! will keep refusing until the server sits in the UK.
- **Bot-challenged sites** (ANR, K100) can't be auto-resolved. Open the player,
  watch the Network tab, and paste the stream URL by hand.

