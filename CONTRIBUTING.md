# Contributing to External Attachments

Thanks for the interest! Issues and pull requests welcome.

## Ground rules

- **The resolver carries the whole game.** `src/resolver.ts` stays free of Obsidian
  imports so the test suite can exercise it against real temp directories.
  Any change to resolution behavior needs a matching assertion in
  `test/run.mjs`, and the suite must stay green (`npm test`).
- **Non-interference first.** The plugin only ever touches embeds the vault
  itself failed to resolve. Nothing may intercept, rewrite, or restyle an
  embed Obsidian handles on its own.
- README and UI text keep **E-Prime** (no forms of "to be").
- No direct `.style.` writes — use CSS classes in `styles.css`.

## Workflow

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # typecheck + production bundle
npm test        # resolver test suite
```

Test in a real vault: copy `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/external-attachments/` and reload Obsidian.

## Reporting bugs

Include your Obsidian version, OS, whether the embed fails in reading view or
live preview, the wikilink as written, and your external-folder layout
(folder names only — no file contents needed).

## Releases (maintainer)

Bump `version` in `manifest.json` and `package.json`, add the entry to
`versions.json`, then push a matching tag (e.g. `1.1.0`). GitHub Actions
builds, tests, attests, and publishes the release with `main.js`,
`manifest.json`, and `styles.css`.
