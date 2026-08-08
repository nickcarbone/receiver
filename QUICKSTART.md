# Quickstart — Nick's cheat sheet

This is the one file to check when things feel broken. It assumes the repo
lives at:

```
~/Desktop/AI Ideas/receiver
```

If you move the folder again, update the `cd` line below to match — nothing
else in this file changes.

## Starting it up (every time)

```
cd ~/Desktop/AI\ Ideas/receiver
node server.js
```

Wait for this exact line before doing anything else:

```
Receiver running → http://localhost:7799
```

Then open **http://localhost:7799** in your browser.

Not `nickcarbone.github.io/receiver` — that's the public GitHub Pages copy,
and it's an empty shell with no server behind it. Nothing plays there, and
there are no instructions to find there either. The real app only exists at
`localhost:7799`, and only while the terminal running `node server.js` stays
open.

## "Address already in use"

A server from an earlier session is probably still running quietly in the
background. Fix it:

```
kill -9 $(lsof -ti :7799)
```

Then run `node server.js` again.

## Confirming you're running the current code

```
grep -c "reconnecting silently" ~/Desktop/AI\ Ideas/receiver/server.js
```

Should print `1`. If it prints `0`, the `server.js` in this folder is an
older version — the current one never got saved here.

## Two terminal windows, not one

- **Window 1**: `node server.js`, left alone. This is the live log — it's
  what told us about the Monocle dropout in the first place. Don't reuse
  this window for anything else.
- **Window 2**: git commands (`git add`, `git commit`, `git push`).

Running git commands in Window 1 means hitting Ctrl+C first, which kills the
server — an easy way to lose track of whether it's actually running.

## After changing any file

The server does not auto-reload. Every time `server.js` or `docs/index.html`
changes:

```
# in the server's terminal:
Ctrl+C
node server.js
```

## Confirming which GitHub repo you're pushing to

```
cd ~/Desktop/AI\ Ideas/receiver
git remote -v
```

Should show `nickcarbone/receiver` on both lines. If it shows anything else,
fix that before pushing:

```
git remote set-url origin https://github.com/nickcarbone/receiver.git
```

## Updating GitHub after changes

```
cd ~/Desktop/AI\ Ideas/receiver
git add -A
git commit -m "describe what changed"
git push
```
