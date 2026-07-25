# Changelog

All notable changes to this project get recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-07-24

### Fixed

- **Embed sizing now works.** `![[photo.png|400]]` and `![[photo.png|400x300]]`
  had no effect on externally-resolved embeds. The old code read the size from
  the `alt` attribute, which Obsidian fills in only for embeds it resolved
  itself — every embed this plugin handles stayed unresolved, so the size rode
  along on the raw link text and never got parsed. `parseEmbedSize()` now reads
  the size from the link target, the alt, the width/height attributes, and the
  rendered link text, in that order. Spaces around the pipe parse too.
- **The indicator outline hugs the media** instead of stretching across the
  full width of the note.
- **Media never exceeds the width of its note**, sized or not.
- **Per-embed observers disconnect when the plugin unloads**, rather than
  waiting on garbage collection.

### Added

- **Alignment setting** — left (the default, matching where Obsidian puts
  ordinary attachments), center, or right.
- **Per-link alignment override** — `![[photo.png|right]]`, or alongside a
  size in either order, `![[photo.png|400|right]]`. Obsidian ignores the extra
  segment, so notes carrying one still read correctly without the plugin.
- **Side-by-side rows** — two or more sized embeds written on one line render
  next to each other, the way two ordinary images would.
- **README screenshots** covering sizing, alignment, and rows, plus a
  "day in the life" walkthrough and colored diagrams.

### Changed

- Externally-resolved embeds deliberately avoid Obsidian's own embed classes
  (`image-embed`, `media-embed`, `is-loaded`). Themes hang layout on those
  names — Minimal restyles the wrapper around anything holding an
  `.image-embed`, and drives its click-to-zoom off `.image-embed:active` — and
  an embed backed by a blob URL cannot honor the rest of that contract. Style
  external attachments through `.internal-embed[data-external-attachment="true"]`
  instead.
- Resolved embeds shed `mod-empty-attachment` along with the other placeholder
  classes, so empty-state theme styling stops applying to them.

## [1.0.1]

### Fixed

- Findings from community review.

## [1.0.0]

### Added

- Initial release: TypeScript port, resolution across multiple external
  folders in priority order, optional recursive subfolder index, test suite,
  and CI.
