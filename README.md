<p align="center">
  English | <a href="README_CN.md">中文</a>
</p>

<p align="center">
  <img src="ccursor.png" width="120" alt="Cursor++" />
</p>

<h1 align="center">CCursor-BYOK</h1>

<p align="center">
  <strong>Drive Cursor's Agent / Chat / Composer with your own API keys</strong><br/>
  A personal, opinionated fork of Cursor++ (BYOK for Cursor IDE)
</p>

<p align="center">
  <a href="https://github.com/Yoahoug/CCursor-BYOK/releases/latest"><img src="https://img.shields.io/github/v/release/Yoahoug/CCursor-BYOK?label=release" alt="Release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="License" /></a>
  <a href="https://github.com/CometixSpace/CCursor"><img src="https://img.shields.io/badge/upstream-Cursor%2B%2B%200.0.15-lightgrey" alt="Upstream" /></a>
</p>

---

## What is this?

A third-party fork of [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)
(**Cursor++**). It keeps upstream's architecture — a local BYOK server inside Cursor's
extension host that intercepts ConnectRPC/REST traffic and routes LLM requests to the
providers you configure — and rebuilds the parts I hit problems with in daily use.

| | |
|---|---|
| Upstream project | <https://github.com/CometixSpace/CCursor> |
| Upstream author | CometixSpace |
| Upstream license | AGPL-3.0-or-later |
| Forked from | upstream `0.0.15` |
| This version | `0.0.26` |
| Maintainer | [@Yoahoug](https://github.com/Yoahoug) (not the upstream author) |

Full upstream feature list and architecture notes:
[README_UPSTREAM.md](./README_UPSTREAM.md) (English) ·
[README_UPSTREAM_CN.md](./README_UPSTREAM_CN.md) (中文).
Every change below is documented with its root cause in [CHANGELOG.md](./CHANGELOG.md).

> **Disclaimer**
> This project is not affiliated with CometixSpace and is not an official distribution
> channel. Correctness and stability of the changes here are my own responsibility —
> please do not file issues about them against upstream. If you want upstream features
> and official support, use the upstream repository directly.

---

## What this fork changes

Grouped by area. Each item is a change on top of upstream `0.0.15`, not an upstream feature.

### Web Search & Fetch

| Change | Why |
|---|---|
| **Fixed Web Search silently returning garbage** | DuckDuckGo answers scraped requests with **HTTP 202 + a CAPTCHA page**. `202` is in the 2xx range, so `response.ok` was `true` and nothing looked wrong. The fallback then scraped *every `<a>` on the page*, feeding the model navigation links (`About DuckDuckGo`, `/lite`, `here`) as search results. Now the challenge page is detected and throws; the dangerous "scrape all links" fallback is **gone**, and the fallback respects the `enabled` flag instead of hardcoding DuckDuckGo. |
| **Custom Base URL for search and fetch** | Tavily's endpoint was hardcoded, so a self-hosted relay or proxy gateway could not be used. Now configurable in the panel; fetch reuses the search side's key and URL instead of asking twice. |
| **Test connection button** | Runs through the *same* code path as a real search (`searchWithProvider`), so it validates reachability, key validity and response parsing at once — not just "the port is open". |
| **Fetch defaults to Tavily Extract** | The built-in fetcher goes out from your machine and always loses to Cloudflare challenge pages (`linux.do` → `HTTP/2 403`, `cf-mitigated: challenge`; spoofing Chrome / curl / Googlebot UA changes nothing). Tavily fetches server-side and gets through. |
| **Discourse JSON → Markdown** | Fetching `https://<forum>/t/topic/<id>.json` returns raw JSON (20 posts ≈ 90–135KB), which used to be truncated by the 100k character cap with everything HTML-escaped. It is now rendered as Markdown with post numbers, and `?page=N` pagination works (verified 12/12 pages on a 1,947-post thread). |
| **Two-layer fallback that reports both failures** | Missing key or a failed Tavily call falls back to the built-in fetcher — but a misconfigured Base URL would otherwise surface only as the built-in fetcher's 403, looking like "Tavily never took effect". Both causes are now raised together. |
| **Trimmed provider lists** | Search 6 → 2, fetch 3 → 2. Only the *panel entries and defaults* were removed — the implementations (`searchExa`, `searchBrave`, `searchJina`, `searchFirecrawl`) are untouched and still usable by editing `~/.ccursor/web-tools.json`. |
| **Legacy configs normalized on read** | Retired values such as `fetch.jina` / `fetch.firecrawl` are mapped to the current default automatically; no manual cleanup. |

### Provider & protocol handling

| Change | Why |
|---|---|
| **Protocol moved from relay level to model level** | A single relay (one URL, one key) almost always serves `gpt` / `gemini` / `grok` / `glm` / `deepseek` at once, each with a different wire format — and the relay does the dispatch internally. Users cannot reasonably answer "which protocol is this relay?", and splitting one URL into several provider entries means retyping the key. The protocol now lives on `ProviderModel.type`. |
| **Address is a prefix; the protocol supplies the version segment** | The two SDKs disagree about `/v1`, which makes one base URL mathematically unable to serve both Anthropic and OpenAI models: with `/v1` Anthropic becomes `/v1/v1/messages`; without it OpenAI hits `/chat/completions` while the relay serves `/v1/chat/completions` and 404s. You now enter a bare prefix, and the request path is composed per model. Legacy addresses carrying a redundant version segment are stripped rather than doubled. |
| **Model connectivity test** | Sends one real request through the identical path a production call takes (URL composition, auth, parameter assembly, SSE parsing), so a pass really means "usable". The prompt is deliberately designed for measurement — asking the model to count to 120 yields ~600 stable tokens, whereas a ping's one or two tokens would be drowned out by time-to-first-token. Thinking models report **two** first-token metrics, since their first event is a reasoning token rather than content. |
| **Auto-detect protocol** | There is no reliable mapping from model name to wire format (`glm-4.6` may go either way), so the only way to know is to try. Auto-detect probes each protocol serially (to avoid rate limits), starting with the currently effective one, and writes the winner back into the config. |
| **Inference rules live in exactly one place** | `src/shared/providerProtocol.ts`. The server does not re-implement them — otherwise the UI could say "Anthropic" while requests actually went out as OpenAI. |

### Usage dashboard

| Change | Why |
|---|---|
| **`~/.ccursor/usage-stats.jsonl` + dashboard** | One record per completed turn, driving cache hit rate, daily trend, and per-model / per-relay attribution. |
| **Cache hit rate as the headline metric** | The question worth answering is "is my relay actually doing prefix caching?", not "how many tokens total". |
| **Token accounting normalized across protocols** | Each protocol defines input tokens differently — Anthropic's `input_tokens` *excludes* cache reads/writes, while OpenAI's `prompt_tokens` and Gemini's `promptTokenCount` *include* cached tokens as a subset. Summing them naively under-counts Anthropic and double-counts OpenAI. |
| **Attribution keyed by stable `providerId`** | Display names are user-editable; renaming a relay used to split its history into two rows and scatter the hit rate. |
| **Today vs. all-time split** | There was a single total whose semantics were "last 14 days" without saying so, which reads as "all time" and quietly shrinks as the window rolls. Now `today` (local timezone), `allTime`, and `window` (14 days, for the trend and per-model tables) are computed in one pass and labelled. |
| **Fixed hover tooltip flashing an empty box** | Closing and clearing were the same action, so during the 120ms fade-out `x-text` and `x-for` had no data: the box shrank to `min-width` + padding and its `left` fell back to `50%`, blinking an empty box in the middle of the chart before vanishing. |

### Update & release

| Change | Why |
|---|---|
| **Update check reads this fork's GitHub Release** | It used to query `@cometix/ccursor` on npm and prompt `npx @cometix/ccursor update` — which installs the **official build** and overwrites every change here. It now reads this repository's Release (public, anonymous, no token) and offers **Update Now** (downloads the attached `.vsix`, extracts and overwrites in place), **Release Notes**, and **Later**. |
| **Manual "Check for Updates" button in the panel** | The only path used to be the background check's popup. The button completes "check → install if available" in one click, with its label tracking the phase (`Checking…` / `Updating to x.y.z…`) from a single source of truth. |
| **Fixed updates failing 100% of the time on Windows** | Extraction hardcoded `unzip`, but Windows 10+ ships bsdtar (`tar`), not `unzip` — so the update died with ENOENT at the extraction step. Now the command is chosen per platform with a fallback. `installer/` and `scripts/release.mjs` had always done this; only the in-extension updater was missed. |
| **Local one-command release** | Online CI/release workflows were removed (build agents have no Cursor, so native-module failures were hard to reproduce remotely). `node scripts/release.mjs` does build → package → update the local extension → tag → push → `gh release create`. |
| **Local extension updated by default, with backups** | Shipping only a Release leaves the machine running old code — this repo hit exactly that trap, with an unchanged version number hiding it. Local install runs *before* the push so "cannot install" surfaces before a public Release exists. Old versions are backed up to `~/.ccursor/backups/` (last 3 kept) — deliberately not `/tmp`, which gets wiped on reboot. |
| **Fixed the release script being unusable on Windows** | Node refuses to `spawnSync` a `.cmd` / `.bat` (CVE-2024-27980), failing with `EINVAL` — on the very platform Cursor primarily runs on. All CLIs are now invoked as `process.execPath` + in-package JS entry. |

### UI / UX

| Change | Why |
|---|---|
| **Dropdowns and overlays use real glass instead of "4% ink"** | Overlays reused `--cpp-surface`, which is the current foreground at 4% opacity — fine as a card background, but as an overlay base it is effectively transparent: the text underneath showed straight through and interleaved with the options. Overlays now sit on the theme's `editorWidget` background plus a backdrop blur. |
| **Modal and floating panels are opaque** | A modal covers existing content, so transparency is actively harmful — the form's labels bled through and doubled up with the dialog's own text. Shadows switched to black as well, because `--cpp-ink` is near-white in dark themes and produced a glowing halo instead of a shadow. |
| **Protocol selector laid out on one line** | The three-way segmented control was `flex-direction: column`; at ~60px per segment, `Anthropic Messages` wrapped to two lines and left the buttons with mismatched heights. Now single-line, centred, with short labels and full names in the tooltip. |
| **Dashboard metric cards rearranged** | `Cache Write` displayed `nonCachedInputTokens` — the same quantity already shown as `4.2M new` under the hit-rate card, i.e. one dataset drawn twice, one of them labelled `est.`. That card was removed in favour of an explicit **Prompt total** (cache reads + uncached input). |
| **Fixed the reveal-password icon not rendering** | The icon comes from Cursor's own `codicon.ttf`, which lives outside the extension directory, so it must be declared in `localResourceRoots` — note that setting that field *replaces* the default, so the extension directory has to be listed too. Without it the font request was blocked, silently fell back to a system font, and the private-use codepoints rendered as missing-glyph boxes. |
| **Drag-to-reorder models** | Cursor's model picker renders `models[]` in `providers.json` order, so put frequently used models first. The real array is reordered (going through the normal draft → dirty → save flow), not just the view. Insertion is decided by the card's midline rather than mouse travel direction, and the array is only touched on drop so the list does not reshuffle under the cursor. |
| **Readable names in the remote model list** | Some relays obfuscate ids beyond recognition (e.g. `flash` reversed to `hsalf`), making a list of ids useless. The primary line is now `display_name` with the real id beneath it in monospace. Three parsing gaps were fixed alongside: only camelCase `displayName` was read (that relay returns snake_case, so the readable name was dropped entirely), timestamps were handled as seconds only, and `{ data: [...] }` / `{ models: [...] }` envelopes were not unwrapped. |
| **Confirmation dialogs for destructive actions** | Deleting a relay or removing a model now asks first and states the impact. |

### Reliability, performance & security

From a full-repository audit (report in [AUDIT.md](./AUDIT.md)). The conclusion was that the
existing design held up — these are targeted fixes.

| Change | Why |
|---|---|
| **Fixed a private-network guard that did not guard** | `isValidUrl` compared `new URL().hostname` against literals, but for IPv6 that field is **bracketed** and trailing dots are preserved: `http://[::1]/` → `"[::1]"`, `http://[::ffff:127.0.0.1]/` → `"[::ffff:7f00:1]"`, `http://[fd00::1]/`, `http://localhost./`. The "WebFetch must not reach localhost or the LAN" guard failed for all of them. The inverse was broken too — `/^(10\.\|127\.)/` on the hostname flagged ordinary domains like `10.example.com` as private. Hostnames are now normalized (brackets stripped, trailing dot removed), only real IPv4 literals take part in range checks, IPv4-mapped IPv6 is reduced to dotted-quad first, and `fc00::/7`, `fe80::/10`, `100.64/10`, `169.254/16` and the whole `127/8` are covered. |
| **Removed super-linear backtracking in the skill frontmatter regex** | `/^---\s*\n([\s\S]*?)\n---/` — `\s` includes `\n`, so `\s*` and the following `\n` competed for the same newlines. It runs **synchronously** in the extension host over workspace `SKILL.md` files of unbounded length: a malformed 40KB file took **254ms**. Now **0.02ms**, with no regression on valid files. The fix must be a single `\n` rather than `\n+`, otherwise the backtracking just moves. |
| **context breakdown 97% faster** | `buildContextBreakdown` called `countTokens` separately for the system prompt, every tool schema and each preamble paragraph — byte-identical across turns in a session, re-encoded every turn (a 44KB system prompt ≈ 0.9ms). A bounded LRU (cap 500, so long sessions cannot grow unboundedly) took the steady-state path from **13.8ms to 0.55ms**. |
| **Silent failures now log** | Skipping an undecodable blob left no trace at all, so users just saw "the context got shorter for no reason". Now a `logger.warn` with an `undecodableBlobs` count. Same for a corrupted canvas directory. The remaining 19 `catch` blocks were reviewed and are correct visible failures. |
| **Unbounded memory and a TDZ hazard** | The blob memory cache had no cap while `cleanupBlobCache()` had zero callers, and each blob is a whole message body (hundreds of KB with tool results) — cleanup now triggers past 10,000 entries. `waitForMessageMatching`'s `cleanup` referenced a `const timer` before initialization, which throws `ReferenceError` on the "no timeout, listener fires synchronously" path. |
| **`handlers/` `services/` `database/` brought into lint** | Those directories were excluded wholesale, leaving ~9,000 lines of core agent logic unchecked — the largest static-analysis blind spot in the repo. Only one local exemption remains, for literal leading tabs inside a template string that is part of a tool description sent to the model. **Also fixed a gate trap**: `pnpm run lint` silently disabled some rules when `VSCODE_PID` was set, so "0 errors" was partly fictional; `CI=true` gives the full rule set. |
| **Structural splits and tests** | `conversationRuntime.ts` (1,316 lines) split into `contextBreakdown` / `editStreamExtractor` / `editStreamDiagnostics`; `parseRunRequest.ts` split out `protocol/mcpNormalization.ts`; webview pure helpers moved out of `app.ts`. Each split was pure-move first, then change, in separate commits. Tests went from 442 to 506, locking in every fix above. |
| **One retreat, documented** | Rewriting the patch-header regex to `[^\S\n]+` *looked* safer but broke real inputs: with `\s` matching `\n`, the original still finds a path when `File:` is followed directly by a newline, while the rewrite matches nothing (53,428 of 400,000 random inputs regressed). Performance was equivalent, so the original was kept with an inline lint exemption. |

### Development

`npm run dev:ui` runs the panel in a browser using the **real** `panel-provider`, webview
code, config store, usage stats and model tests — only the host layer is substituted
(the `vscode` module, `acquireVsCodeApi`, and the port-grabbing `src/server`). Previously,
verifying a UI change meant a full build → overwrite the extension directory → restart cycle,
which made iterating on spacing and colours impractical. The preview script and its output
are not shipped in the VSIX.

### Known limitations

- **Dynamic-DNS hostnames** (e.g. `127.0.0.1.nip.io`) still bypass the private-network guard,
  and a redirect's final address is not re-checked — a pre-existing gap, not made worse here,
  but the SSRF protection is still incomplete.
- **Only the extension body is covered by this fork's fixes.** Anything in
  `installer/src/patch-*.js` (the injection into Cursor itself) is untouched.

---

## Install

### Important: do not install by dragging the VSIX

There are **two** parts, and dragging the VSIX only does half the job:

| Component | What it is | Can a dragged VSIX do it? |
|---|---|---|
| Extension body | the `cursor2plus` extension files | ❌ it only lands in the user extension directory `~/.cursor/extensions/`, while Cursor needs it under `resources/app/extensions/` in its **install** directory |
| **Three patches** | modifications to `workbench.desktop.main.js`, `workbench.glass.main.js`, `extensionHostProcess.js`, plus updated SHA256 checksums for those three files in `product.json` | ❌ **not done at all** |

Without the patches the extension is inert — requests never reach the BYOK server — and the
stale `product.json` checksums make Cursor report the installation as corrupted.

**Use the installer.**

### Option 1: full install of this fork

```bash
# 1. Clone
git clone https://github.com/Yoahoug/CCursor-BYOK.git
cd CCursor-BYOK

# 2. Dependencies (pnpm for Cursor++, npm for installer)
cd Cursor++ && pnpm install && cd ..
cd installer && npm install && cd ..

# 3. Build extension → package VSIX → build CLI
cd installer && npm run build:all && cd ..

# 4. Install (quit Cursor completely first)
node installer/dist/cli.cjs install

# 5. Verify
node installer/dist/cli.cjs status
```

> Coming from upstream, run `node installer/dist/cli.cjs uninstall` first, then `install`.
> `uninstall` restores the patched Cursor files from backup and **requires Cursor to be fully
> closed**, otherwise locked files make it fail.

### Option 2: replace the extension body only (incremental, easiest)

If you only changed things under `Cursor++/src/` (search logic, panel UI) and left
`installer/src/patch-*.js` alone, there is no need to uninstall and reinstall.

The advantage: **Cursor can stay open**, and existing patches are left untouched.

```bash
node scripts/release.mjs --local-only
```

This builds → packages → overwrites the local extension directory (backing up the old
version to `~/.ccursor/backups/`) without committing, pushing or creating a Release, so it
can be re-run freely. Restart Cursor to apply. Since `0.0.26` you can also use the panel's
**Check for Updates** button to pull the latest published Release the same way.

<details>
<summary>Doing it by hand instead</summary>

```powershell
# Build
cd <repo>\installer
npm run build:all

# Extract the VSIX over the extension directory
$vsix = "<repo>\installer\vsix\cursor2plus-<version>.vsix"
$tmp  = "$env:TEMP\ccursor-ext"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item $vsix "$tmp\v.zip"
tar -xf "$tmp\v.zip" -C $tmp

# Target directory (adjust to your actual install path)
$target = "$env:LOCALAPPDATA\Programs\cursor\resources\app\extensions\cursor2plus"
robocopy "$tmp\extension" $target /E
```

> **Note**: on Windows the native modules (`dist\supermarkdown.win32-x64-msvc.node` and
> friends) may be locked by a running Cursor. If the bytes are unchanged this is harmless;
> a `robocopy` `ERROR 32` can be ignored.

</details>

### Option 3: upstream's official installer

If you do not want this fork and just want upstream:

```bash
npx @cometix/ccursor install
npx @cometix/ccursor status    # check status
npx @cometix/ccursor uninstall # uninstall and restore
```

> This installs the **upstream official build** and none of the changes here.
> Conversely, if you already run this fork, do **not** use it to update — it overwrites
> everything. Use Option 1 or 2 instead.

---

## Configure

Config files live in `~/.ccursor/`:

| File | Purpose |
|---|---|
| `providers.json` | relays (Base URL + key) and model definitions |
| `web-tools.json` | search / fetch provider configuration |
| `routes.json` | BYOK switch and redirect whitelist |
| `usage-stats.jsonl` | per-turn usage records backing the dashboard |

All three config files can be edited visually in the Cursor++ sidebar panel; editing them by
hand is convenient for bulk changes or backup/restore.

### `providers.json`

**A relay's `baseUrl` should be the bare domain / port — no `/v1`, `/v1beta` or other version
segment.** The version segment and request path are supplied per model by the effective
protocol:

| Protocol | Actual request path |
|---|---|
| Anthropic Messages | `<prefix>/v1/messages` |
| OpenAI Chat Completions | `<prefix>/v1/chat/completions` |
| OpenAI Responses | `<prefix>/v1/responses` |
| Gemini | `<prefix>/v1beta/models/<model>:streamGenerateContent` |

That is why different vendors under one prefix each compose correctly — and why the protocol
lives on the model rather than the relay (one relay commonly serves gpt / gemini / glm / claude).

> A prefix that already contains the version segment is not doubled
> (`.../v1` + Anthropic → `.../v1/messages`), so old configs keep working. The real trap is
> entering a **complete endpoint** as the prefix (e.g. `.../v1/messages`), which appends the
> path twice.

### `web-tools.json`

```json
{
  "$schemaVersion": 1,
  "search": {
    "providers": [
      {
        "id": "default-tavily",
        "type": "tavily",
        "enabled": true,
        "apiKey": "your-api-key",
        "baseUrl": "https://api.tavily.com"
      },
      { "id": "default-ddg", "type": "duckduckgo", "enabled": false }
    ],
    "parallel": false,
    "maxResults": 10,
    "fallbackToDuckDuckGo": true
  },
  "fetch": { "provider": "tavily" }
}
```

- `search.providers` — the panel offers Tavily (custom `baseUrl` supported) and DuckDuckGo
  (free fallback, frequently blocked by anti-bot)
- `baseUrl` empty or omitted → the official `https://api.tavily.com`
- `fallbackToDuckDuckGo: false` → fail loudly instead of falling back
- `fetch.provider` — `tavily` (default, reuses the Tavily key / baseUrl above) or `builtin`
  (local fetch; cannot reach Cloudflare-protected sites)

---

## Update

The extension checks this repository's GitHub Release periodically (at most every 4 hours).
When a new version appears you get **Update Now** (downloads the Release `.vsix` and
overwrites the extension directory in place — **restart Cursor** afterwards), **Release
Notes**, and **Later** (skip that version).

To skip the wait, the panel's **Config** tab has a **Check for Updates** button beneath
`Edit Routes` / `Edit providers.json`: one click performs "check → install if available"
and reports the outcome inside the panel. While it runs, the label becomes `Checking…` /
`Updating to x.y.z…` and the button is disabled to prevent double-triggering.

The update channel is entirely controlled by this repository and does not depend on any
package existing on npm.

<details>
<summary>Maintainer: how to release</summary>

Write the changes into [`CHANGELOG.md`](./CHANGELOG.md), then:

```bash
node scripts/release.mjs --bump patch       # bump → build → package → update local → push & release
node scripts/release.mjs --local-only       # build + update local only; no commit, push or Release
node scripts/release.mjs --dry-run          # build + verify only; touches nothing
node scripts/release.mjs --no-install       # release only; leave this machine's extension alone
```

The script runs: preflight → version consistency → typecheck / lint / unit tests → production
build → multi-platform artifact check → package VSIX → update the local extension → commit
the version bump / tag / push / `gh release create`.

Two conventions:

1. **`Cursor++/package.json` and `installer/package.json` must carry the same version** —
   the script bumps both via `--bump`.
2. **The working tree must be clean before releasing** — the script only commits those two
   `package.json` files.

Requires the `gh` CLI to be logged in (`gh auth status`). `--local-only` does not, and does
not require a clean tree.

Artifacts include every native module for macOS / Linux / Windows (x64 · arm64), so a VSIX
built on any platform can be handed to users on any other platform.

</details>

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Cannot sign in after installing | Toggle BYOK **OFF** in the sidebar panel, sign in normally, then toggle it back on |
| Model not found | Add the model in the sidebar panel, or edit `~/.ccursor/providers.json` |
| LLM returns 401 / 403 / 404 | Check the key and base URL. Remember the base URL is a **prefix** — a complete endpoint gets the path appended twice |
| Search returns useless nav links | Fixed in `0.0.16`; make sure you are not running an older build |
| Fetch fails with 403 on some sites | Those sites sit behind Cloudflare. Add a Tavily key and keep `fetch.provider` as `tavily` |
| Update fails while Cursor is running | Native modules may be locked. Fully quit Cursor and re-run; already-written files are skipped, so nothing is duplicated. From `0.0.26` on Windows this no longer fails at extraction |
| Panel looks unchanged after an update | The extension directory's JS is loaded into memory — **restart Cursor** |

---

## Documentation

| File | Contents |
|---|---|
| [CHANGELOG.md](./CHANGELOG.md) | Every change with its root cause and the alternatives considered (中文) |
| [AUDIT.md](./AUDIT.md) | The full repository audit behind the `0.0.23` changes (中文) |
| [README_UPSTREAM.md](./README_UPSTREAM.md) · [中文](./README_UPSTREAM_CN.md) | Upstream's feature list and architecture |

---

## Upstream

Full feature list, architecture notes and general troubleshooting live upstream:

- Repository: <https://github.com/CometixSpace/CCursor>
- npm: <https://www.npmjs.com/package/@cometix/ccursor>

---

## License

AGPL-3.0-or-later, inherited from upstream — see [LICENSE](./LICENSE).

As required by the AGPL, this fork is released under the same license.
