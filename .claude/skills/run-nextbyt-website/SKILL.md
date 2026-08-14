---
name: run-nextbyt-website
description: Build, serve, run, and screenshot the NextBYT static marketing site. Use when asked to run the site, start a local server, preview a page, take a screenshot, or check that a change (form, layout, animation) actually works in a browser.
---

NextBYT is a static HTML/CSS/JS site — no build step, no framework
(see `../../../CLAUDE.md`). "Running" it means serving the files over
HTTP and driving a real headless Chromium against them with the
Playwright-based REPL driver at
`.claude/skills/run-nextbyt-website/driver.mjs`. Don't open files via
`file://` — some pages use root-relative asset paths that only resolve
over HTTP.

All paths below are relative to `Website/` (the repo root — it has its
own `.git`/`CNAME`/`_config.yml`, independent of the parent `NextBYT/`
folder one level up).

## Prerequisites

```bash
cd .claude/skills/run-nextbyt-website
npm install                                    # installs playwright-core (gitignored)
node_modules/.bin/playwright-core install chromium   # one-time browser download (~270MB)
```

`python3` (stdlib `http.server`) is used for the static server — no
extra install needed.

## Build

None — there is no build step. Edits to any `.html` file are live
immediately.

## Run (agent path)

Pipe commands to the driver over stdin (this machine has no `tmux`
installed, so this is the primary path, not a fallback):

```bash
cd Website
node .claude/skills/run-nextbyt-website/driver.mjs <<'EOF'
serve
launch
nav index.html
ss 01-home
quit
EOF
```

Screenshots land in `/tmp/nextbyt-shots/` (override with
`SCREENSHOT_DIR`). The static server runs on port `8842` (override
with `PORT`).

If `tmux` is available, wrap it the usual way for iterative use:

```bash
tmux new-session -d -s nextbyt -x 200 -y 50
tmux send-keys -t nextbyt 'cd Website && node .claude/skills/run-nextbyt-website/driver.mjs' Enter
tmux send-keys -t nextbyt 'serve' Enter
tmux send-keys -t nextbyt 'launch' Enter
tmux send-keys -t nextbyt 'nav index.html' Enter
tmux send-keys -t nextbyt 'ss 01-home' Enter
tmux capture-pane -t nextbyt -p
```

### Commands

| command | what it does |
|---|---|
| `serve` | start `python3 -m http.server` in `Website/`, poll until it answers |
| `launch` | launch headless Chromium |
| `nav <path>` | go to `http://localhost:8842/<path>` (default `index.html`), waits for `#preloader` to hide |
| `ss [name]` | screenshot → `/tmp/nextbyt-shots/<name>.png` |
| `click <css-sel>` | click an element |
| `fill <css-sel> <value>` | fill a form field (rest of the line after the selector is the value) |
| `wait <css-sel>` | wait up to 10s for an element |
| `eval <js>` | evaluate JS in the page, prints JSON |
| `text [css-sel]` | print `innerText` of an element (or `body`) |
| `quit` | close browser + kill the static server |

Page errors and `console.error` calls print automatically as
`[pageerror]` / `[console.error]` lines — check for these, not just
the screenshot, since the preloader/hero can render fine while a later
script throws.

## Run (human path)

```bash
cd Website && python3 -m http.server 8842
```

Then open `http://localhost:8842/index.html` in a real browser.
Useless in a headless/agent context — use the driver instead.

## Gotchas

- **The preloader element is `#preloader` (an ID), not a class.** The
  driver's `nav` command waits for it to become `hidden` — get this
  selector wrong and every screenshot captures the "NEXTBYT" loading
  splash instead of the page (see CLAUDE.md's "Preloader" JS feature).
- **Driver commands piped via heredoc/stdin must run through the
  `queue` promise chain in `driver.mjs`, not be awaited directly in
  the `'line'` handler.** `readline` emits all buffered lines
  essentially at once for non-interactive input, so unserialized
  `async` handlers race — `nav` would run before `launch` had actually
  set `page`. Relatedly, stdin hits EOF (`'close'` fires) the instant
  the heredoc is fully read, which is *before* the queued commands
  finish — the `'close'` handler `await`s `queue` before tearing down
  the browser/server, and prompt calls after close are swallowed via
  `safePrompt()`. If you edit the driver, keep both.
- **The contact form (`#contactForm`) really POSTs to
  `formsubmit.co/ajax/hello@nextbyt.uk`.** Don't actually click
  `#contactSubmit` / submit the form when testing — it emails the real
  inbox. Fill fields and check validation state (`#emailError`, etc.)
  instead, or `eval` the validation function directly.
- **Pretty permalinks (`_config.yml`: `permalink: pretty`) are a
  GitHub Pages / Jekyll build-time feature and are NOT reproduced by
  the local `http.server`.** Always `nav` to the real `.html` filename
  (e.g. `work.html`, not `work`) when driving locally.
- **`npx -p playwright-core node script.mjs` does NOT work** — ESM
  `import` resolution walks up from the *importing file's own path*,
  not from `NODE_PATH`/npx's temp install dir. `playwright-core` must
  be a real local dependency next to `driver.mjs` (hence the
  `package.json` in this directory, with `node_modules/` gitignored).

## Troubleshooting

- **`Cannot find package 'playwright-core'`**: run `npm install` in
  this skill directory first — `node_modules/` is gitignored and not
  checked in.
- **Browser launch hangs / `Executable doesn't exist`**: run
  `node_modules/.bin/playwright-core install chromium` (one-time,
  downloads to `~/Library/Caches/ms-playwright`).
- **`serve` prints `ERROR: server did not come up`**: port 8842 is
  probably already bound by a leftover server from a crashed prior
  run — `lsof -ti:8842 -sTCP:LISTEN | xargs -r kill`, then retry. The
  driver's own `quit` kills its spawned server, but a hard crash
  (uncaught exception) skips that cleanup and leaks the process.
- **Screenshot shows the "NEXTBYT" splash screen, not the page**: the
  preloader hasn't hidden yet — see Gotchas above; don't lower the
  5s timeout in `nav`, the fade animation genuinely takes ~1.8s.
