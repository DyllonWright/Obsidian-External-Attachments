# Handoff: Shipped 1.1.0 — embed sizing fix, alignment, side-by-side rows

## Session Metadata
- Created: 2026-07-24 21:54:00
- Project: C:\Users\djwri\Documents\GitHub\obsidian-external-attachments
- Branch: main (clean, at 1806b9f, level with origin/main)
- Session duration: one long session, roughly a dozen build/verify cycles

### Recent Commits (for context)
  - 1806b9f Fix embed sizing, add alignment and side-by-side rows; release 1.1.0
  - affffdf Fix community review findings; release 1.0.1
  - 545dc95 Full-stack release build: TypeScript port, multi-mount resolution, tests, CI
  - dfdc4c6 Initial commit

## Handoff Chain

- **Continues from**: None (fresh start)
- **Supersedes**: None

> This is the first handoff for this task.

## Current State Summary

1.1.0 shipped and published. The session started from one bug report — Obsidian's `![[file.png|400]]` sizing suffix did nothing on externally-resolved embeds — and grew to include an alignment setting, side-by-side image rows, README screenshots and diagrams, and Obsidian community-review compliance. [PR #1](https://github.com/DyllonWright/Obsidian-External-Attachments/pull/1) is merged (squashed), tag `1.1.0` is pushed, and the release workflow published `main.js`, `manifest.json`, and `styles.css` at https://github.com/DyllonWright/Obsidian-External-Attachments/releases/tag/1.1.0. Nothing is half-finished in the repo; the remaining items are all optional or on Obsidian's side.

## Codebase Understanding

### Architecture Overview

Three source modules, split by what each can be tested against:

- `src/resolver.ts` — filesystem and pure link parsing. Imports `fs`/`path`, nothing from Obsidian, so the suite drives it against real temp directories.
- `src/layout.ts` — **new this session.** DOM predicates only: plain `Element`, `classList`, `nodeType`, zero Obsidian imports, so jsdom can drive them. Holds the guards that decide whether a wrapper may take an alignment.
- `src/main.ts` — the Obsidian shell. Markdown post-processor for reading view, a `MutationObserver` for Live Preview (which never fires the post-processor for *unresolved* embeds), and blob-URL lifecycle.

The plugin only ever touches embeds the vault could not resolve; if `metadataCache.getFirstLinkpathDest` finds a file, it returns immediately.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/main.ts` | `resolveEmbed`, `readSize`, `applySize`, `applyAlign` | Everything layout-related lives here |
| `src/layout.ts` | `holdsEmbedsOnly`, `countEmbeds`, `isEmbedRow`, `LAYOUT_CONTAINERS` | The guards; read the doc comments before changing them |
| `src/resolver.ts` | `parseEmbedSize`, `parseEmbedAlign`, `MountResolver` | Pure, fully tested |
| `styles.css` | sizing, alignment, indicator outline | Deliberately has **no** `:has()` and no ancestor selectors |
| `test/run.mjs` | 31 assertions; esbuild bundles resolver + layout to `test/.build/` | Includes captured real-world DOM as fixtures |
| `.github/workflows/release.yml` | Fires on tag `[0-9]+.[0-9]+.[0-9]+` | Runs tests, builds, attests provenance, creates the release |

### Key Patterns Discovered

- **Obsidian never parses the size suffix for embeds it did not resolve.** It fills the `alt` attribute only for its own resolved embeds. For anything this plugin handles, the size stays glued to the raw link (`photo.png|400`), and in Live Preview it survives only in the embed's rendered link text. `parseEmbedSize()` therefore reads several candidates right-to-left: src, alt, width/height attributes, then `textContent` — captured **before** `empty()` discards it.
- **In Live Preview an embed's parent is `.cm-content`**, which holds every embed in the note. Any sibling-counting logic must reject that container first.
- **CodeMirror pads widgets** with `img.cm-widgetBuffer` markers and empty spans. A genuine row of images arrives as `[buffer, span, buffer, buffer, embed, buffer, " ", buffer, embed]`.
- **`text-align` inherits.** Alignment goes on the embed itself, never on an ancestor, unless `holdsEmbedsOnly()` confirms the wrapper carries no prose.
- **Per-element values use `setCssStyles()`**, not `.style.x =`. The Obsidian review bot fails builds on `no-static-styles-assignment`.
- README voice and structure follow a house style shared across the author's plugins; see the memory note `obsidian-plugin-readme-house-style`.

## Work Completed

### Tasks Finished

- [x] Fixed `|WIDTH` / `|WIDTHxHEIGHT` sizing, including spaces around the pipe
- [x] Indicator outline hugs the media instead of spanning the note width
- [x] Media capped at the width of its note
- [x] Added the Alignment setting (left default, center, right) plus per-link overrides
- [x] Side-by-side rows for multiple sized embeds on one line
- [x] Per-embed `MutationObserver`s disconnect on plugin unload
- [x] Resolved embeds shed `mod-empty-attachment`
- [x] Converted all six direct `.style` writes to `setCssStyles()`
- [x] Adopted the declarative settings API while keeping `display()` for older Obsidian
- [x] README: three screenshots, colored mermaid diagrams, "A day in the life" section
- [x] Added `CHANGELOG.md`; bumped manifest, package, and versions.json to 1.1.0
- [x] Test suite 12 → 31 assertions; added jsdom
- [x] Merged PR #1, pushed tag, verified the published release and its assets
- [x] Removed test scaffolding from the Project Gnosis vault

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `src/main.ts` | size/alignment application, observer tracking, class stripping | Core of the fix |
| `src/layout.ts` | **new** — DOM predicates | Makes layout decisions testable |
| `src/resolver.ts` | `parseEmbedSize`, `parseEmbedAlign`, `Alignment`, `ALIGNMENTS` | Pure parsing, fully covered |
| `src/settings.ts` | Alignment setting; declarative API; shared label constants | Review compliance without dropping old-version support |
| `styles.css` | sizing, alignment, row, indicator rules | Removed the `:has()` rules that broke note text |
| `test/run.mjs` | 19 new assertions, jsdom, dual-entry esbuild build | Regression net |
| `README.md` | screenshots, colored diagrams, use case, placement docs | — |
| `CHANGELOG.md`, `manifest.json`, `package.json`, `versions.json` | 1.1.0 | Release |
| `screenshots/*.png` | three images | README |
| `package-lock.json` | added jsdom | dev dependency |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Do **not** wear Obsidian's `image-embed` / `media-embed` / `is-loaded` classes | Wear them for theme parity | Tried it; broke placement and half-fired Minimal's click-to-zoom. Themes hang layout on those names (`.markdown-preview-sizer > :has(.image-embed)`, `.image-embed:active`) and a blob-backed embed cannot satisfy the rest of that contract |
| Alignment via `text-align` on the embed itself | `:has()` on the parent; auto margins on the container | `:has()` re-aligned the whole note's prose. Auto margins pull the image off the readable-line column in Live Preview, since the container *is* that column |
| Keep `display()` alongside `getSettingDefinitions()` | Drop `display()`, bump minAppVersion to 1.13.0 | minAppVersion is 1.1.0; dropping it would leave an empty settings tab for anyone older. Both paths share constants and route writes through `setControlValue` so they cannot drift |
| Desktop-only stays | Add mobile support | No Node runtime in mobile Obsidian and both mobile OSes sandbox to the app container. The plugin's entire premise is reading a folder the vault does not contain |
| Squash-merge | Merge commit | Matches the repo's one-commit-per-release history |

## Pending Work

### Immediate Next Steps

1. **Nothing is required.** 1.1.0 is published and verified.
2. Sync the lockfile's stale top-level version — it still reads `1.0.1` while `package.json` says `1.1.0`. Harmless (`npm ci` ignores that field, and the lockfile is not a release asset), so fold it into the next change rather than cutting a commit: `npm install --package-lock-only`.
3. Optional: take the three remaining README screenshots — a hero shot (a real note in Reading view), the settings tab showing green `connected — N entries` status lines, and the untouched broken embed from the non-interference rule. Save to `screenshots/` and wire them in beside the prose they prove.

### Blockers/Open Questions

- [ ] **Obsidian catalog re-scan is on Obsidian's side.** The listing reported "no release matches your manifest version" because the check ran in the four-minute window between the merge (02:37Z) and the release (02:41Z). The release is correct — tag `1.1.0`, no `v` prefix, all three assets uploaded, not a draft. Re-trigger the scan from the plugin listing, or wait for the next automatic pass. No repo-side defect to fix.

### Deferred Items

- **Inline images mid-sentence render as blocks**, splitting the sentence. Native Obsidian keeps them inline via `.cm-line .internal-embed.image-embed { display: inline }` — a rule the plugin deliberately does not opt into. The author called it good enough; the fix would be one plugin-owned CSS rule scoped to embeds sharing a line with prose.
- **Mobile support**: declined, with reasoning above.
- **Moving alignment fully declarative** (drop `display()`): would need minAppVersion 1.13.0.

## Context for Resuming Agent

### Important Context

**If you touch layout in this plugin, get real DOM data first.** Four alignment attempts failed in this session because they reasoned from stylesheets rather than the running DOM. Extracting Obsidian's `app.css`, reading the Minimal theme, scanning every plugin's CSS, and building a standalone browser reproduction all said the code should work. A single DevTools console dump from the author's vault then revealed the two facts that mattered and that no stylesheet could show (the `.cm-content` parent and the `cm-widgetBuffer` padding). Ask for that dump early: walk `parentElement` up ~7 levels printing tagName, className, `getBoundingClientRect`, computed `display`/`textAlign`/margins, and the element's own inline `style`.

Second: **when a symptom appears right after your own change, audit that change before anything else.** The centering regression traced entirely to a class addition made minutes earlier — one flagged at the time as "revertable in three lines" — and two rounds went to hunting it elsewhere while the author's earlier screenshots already showed correct behavior before it.

Third: the guards in `src/layout.ts` exist because of specific failures, and the doc comments say which. Relaxing them requires keeping the negative cases green — tolerating CodeMirror filler must still reject a span containing words, and a stray sibling `<img>` must still disqualify a wrapper.

### Assumptions Made

- Left alignment as the default, on the author's statement that ordinary attachments sit left.
- Alignment applies per line rather than per image; a `|center` anywhere in a row centers the row. Documented as intended.
- `linkStyle` indices in the README mermaid diagrams verified by parsing with mermaid's own flowchart parser and counting edges.
- The author reads and verifies in Live Preview more than Reading view; check both.

### Potential Gotchas

- `main.js` is gitignored. The release workflow builds it; a local `npm run build` is needed before copying into a vault for testing.
- The plugin install in the Project Gnosis vault at `.obsidian/plugins/external-attachments/` has its `mounts` array **cleared** — the test folder it pointed at was deleted during cleanup. Point it at a real folder before expecting it to resolve anything.
- Editing the vault's `community-plugins.json` (in the Project Gnosis vault under its `.obsidian` folder, not in this repo) while Obsidian runs can be overwritten on exit; restart rather than reload.
- `npm test` needs `npm install` first, and needs jsdom.
- On Node 24, `globalThis.navigator` cannot be assigned; use `Object.defineProperty`. Relevant to the jsdom setup in `test/run.mjs`.
- Obsidian normalizes `![[file.png | 250]]` toward `![[file.png |250]]` when it touches a note, so test fixtures may shift under you.

## Environment State

### Tools/Services Used

- Node 24 with npm; esbuild bundles to `main.js`, and to `test/.build/` for tests.
- `gh` CLI, authenticated, for the PR, merge, release inspection, and asset download.
- `codex` CLI, authenticated via `~/.codex/auth.json`; one consult this session that found a real bug.
- Obsidian desktop with the Project Gnosis vault as the human-verification workspace.

### Active Processes

- None. A temporary static server on port 8231 that served a layout reproduction was stopped.

### Environment Variables

- None required by this project.

## Related Resources

- Release: https://github.com/DyllonWright/Obsidian-External-Attachments/releases/tag/1.1.0
- Merged PR: https://github.com/DyllonWright/Obsidian-External-Attachments/pull/1
- `CHANGELOG.md` — user-facing summary of everything in 1.1.0
- `README.md` — "Placement" section documents the alignment rules and their edge cases
- `src/layout.ts` — doc comments record which failure each guard prevents
- Memory notes for this project: `get-dom-data-before-css-theorizing`, `suspect-my-own-recent-change-first`, `verify-dom-predicates-with-jsdom`, `consult-codex-when-stuck`, `inspect-obsidian-core-css`, `project-gnosis-as-plugin-test-vault`, `obsidian-plugin-readme-house-style`

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
