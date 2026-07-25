# External Attachments

> *"The map is not the territory."* — Alfred Korzybski

An [Obsidian](https://obsidian.md) plugin for vaults that outgrow their cloud storage. When an attachment embed fails to resolve inside the vault, the plugin quietly searches one or more folders **outside** the vault — an external drive, a second free cloud account, a NAS share — and renders the file from there. Your wikilinks keep working. Your sync quota breathes again.

## Why this exists

A wikilink works like a map; the file lives in some territory. Obsidian assumes the territory sits inside the vault, and that assumption holds up beautifully — right until the vault syncs through a free cloud tier and the scans, videos, and voice memos blow past the quota.

At that point the standard advice forks in two directions: delete your history, or pay rent on it forever. Both answers treat the vault's folder boundary as a law of nature rather than a default setting. This plugin opens a third door. Move the heavy files anywhere you like — spread them across as many free accounts, drives, and shares as you care to maintain — and the embeds keep resolving as if nothing moved. The note never learns the difference.

Nothing else did this, so this had to exist. Now it does, and you can have it for free.

## How resolution works

The plugin practices strict non-interference: if Obsidian can resolve an embed, the plugin does nothing at all. Only genuinely broken embeds get a second chance.

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart TD
    E(["Embed appears:  ![[diagram.png]]"]) --> V{"Does the vault<br/>resolve it?"}
    V -->|yes| OB["Obsidian renders it normally —<br/>the plugin stays out of the way"]
    V -->|no| M1{"External folder 1<br/>holds diagram.png?"}
    M1 -->|yes| R
    M1 -->|no| M2{"External folder 2? 3? …<br/>(in order, first match wins)"}
    M2 -->|yes| R
    M2 -->|no| IDX{"Subfolder search on?<br/>Check the filename index"}
    IDX -->|found| R["Read the file → blob URL →<br/>render as image · video · audio · PDF<br/>(subtle dashed outline, optional)"]
    IDX -->|not found| X["Leave the embed alone —<br/>broken links stay honestly broken"]

    classDef terminal fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef native fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:1px;
    classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:1px;
    classDef hit fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef miss fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:1px;

    class E terminal;
    class OB native;
    class V,M1,M2,IDX decision;
    class R hit;
    class X miss;

    linkStyle 1 stroke:#2563eb,stroke-width:2px;
    linkStyle 3,5,7 stroke:#16a34a,stroke-width:2px;
    linkStyle 8 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
```

Matching happens by **filename**, so `![[diagram.png]]` finds `diagram.png` wherever it landed.

Obsidian's sizing suffix carries over intact: `![[diagram.png|400]]` renders 400 px wide, `![[diagram.png|400x300]]` pins both axes, and spaces around the pipe — `![[diagram.png | 400]]` — parse the same way. Sized or not, nothing exceeds the width of the note it sits in. Unknown file types fall back to a download link.

![An 800 px source image rendering at full width, then the same file at |300 — 300 px wide and 150 px tall, its aspect ratio held. Both carry the dashed external-attachment outline.](screenshots/sizing.png)

*The same external file, unsized and at `|300`. The dashed outline marks an embed that resolved from outside the vault; it traces the image at whatever size the link asked for.*

Externally-resolved embeds deliberately avoid Obsidian's own embed classes (`image-embed`, `media-embed`, `is-loaded`) and carry only their own. Themes hang layout on those names — Minimal, for instance, restyles the wrapper around anything holding an `.image-embed` and drives its click-to-zoom off `.image-embed:active` — and an embed backed by a blob URL rather than a vault file can't honor the rest of that contract. Staying out of the namespace keeps external attachments predictable instead of half-styled. Target them with `.internal-embed[data-external-attachment="true"]` in a snippet if you want theme parity on your own terms.

### Placement

The **Alignment** setting puts external media left (the default, matching how Obsidian places ordinary attachments), centered, or right. Any single embed overrides it by naming the direction in the wikilink — alone, `![[diagram.png|right]]`, or alongside a size in either order, `![[diagram.png|400|right]]`. Obsidian ignores the extra segment, so a note carrying one still reads correctly with the plugin disabled.

![Three copies of one image at 250 px: the first flush with the left edge of the text, the second centred in the note, the third flush right.](screenshots/alignment.png)

*Default left, then `|250|center` and `|250|right` overriding it on individual links. Left lines the image up with the text column, exactly where Obsidian puts an ordinary attachment.*

Two sized embeds written on the same line render side by side, the way two ordinary images would:

```markdown
![[chart-before.png|300]] ![[chart-after.png|300]]
```

![Two different external images rendered next to each other on one line, each with its own dashed outline.](screenshots/side-by-side.png)

Sizing is what makes that work — a sized embed shrink-wraps to its media, while an unsized one keeps the full width of the line and stacks.

Two things follow from how CSS places a shrink-wrapped element, and both are deliberate. Alignment lands on the line rather than on one image within it, so a `|center` anywhere in a row centers the whole row. And centering or right-aligning a *sized* embed takes effect only on a line holding nothing but embeds — mix an image into a sentence and it stays inline where you wrote it. The plugin checks the surrounding element before touching its alignment, because `text-align` inherits: steering anything wider would swing the note's paragraphs and headings around with the picture.

## A day in the life

One researcher keeps a 46 GB vault: archive scans, seminar recordings, voice memos. The free sync tier holds 5 GB. Rather than pruning the archive or renting space for it forever, they cut the heavy files out of the vault, drop them into three folders their OS already mounts, and change not one line of any note:

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart LR
    subgraph vault["📓 The vault — 180 MB, syncs in seconds"]
        N1["Field note:<br/>![[ledger-1874.png|500]]"]
        N2["Seminar note:<br/>![[seminar-04.mp4]]"]
    end

    N1 --> P{{"External Attachments<br/>looks the filename up"}}
    N2 --> P

    subgraph ext["🗄️ Outside the vault — 46 GB, syncs never"]
        F1["1 · D:\VaultMedia<br/>(external drive)"]
        F2["2 · Drive mirror<br/>(second free account)"]
        F3["3 · NAS share<br/>(cold archive)"]
    end

    P --> F1 --> F2 --> F3
    F1 -.->|hit| OUT
    F2 -.->|hit| OUT
    F3 -.->|hit| OUT
    OUT(["Both notes render in place —<br/>the scan at 500 px, the video with controls.<br/>Quota untouched."])

    classDef terminal fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef note fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:1px;
    classDef lookup fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef folder fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1px;

    class N1,N2 note;
    class P lookup;
    class F1,F2,F3 folder;
    class OUT terminal;

    style vault fill:#eff6ff,stroke:#60a5fa,color:#1e3a8a;
    style ext fill:#f0fdf4,stroke:#4ade80,color:#14532d;

    linkStyle 0,1 stroke:#2563eb,stroke-width:2px;
    linkStyle 2 stroke:#d97706,stroke-width:2px;
    linkStyle 3,4 stroke:#16a34a,stroke-width:1px,stroke-dasharray:3 4;
    linkStyle 5,6,7 stroke:#7c3aed,stroke-width:2px;
```

The sync client now carries 180 MB of text. The archive keeps growing wherever the researcher has room for it, spread across as many drives and free accounts as they care to add — and every wikilink written over the past five years still resolves.

## Setup

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart LR
    A["1 · Install the plugin<br/>and enable it"] --> B["2 · Settings →<br/>External Attachments →<br/>add external folder(s)"]
    B --> C["3 · Move heavy attachments<br/>out of the vault<br/>into those folders"]
    C --> D(["4 · Embeds keep rendering.<br/>Sync quota recovers."])

    classDef step fill:#e0e7ff,stroke:#4f46e5,color:#312e81,stroke-width:1px;
    classDef terminal fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;

    class A,B,C step;
    class D terminal;

    linkStyle 0,1,2 stroke:#4f46e5,stroke-width:2px;
```

1. **Install** (see below) and enable the plugin.
2. **Add folders** in Settings → External Attachments. Each entry takes an absolute path — `D:\ObsidianAttachments`, a Google Drive mirror, a Dropbox folder, anything your OS mounts as a directory. Order matters: the plugin checks folders top to bottom and stops at the first match. A status line under each path tells you whether the plugin can reach it.
3. **Move files.** Cut attachments from the vault and paste them into an external folder. Don't rename them — the filename serves as the whole address.
4. **Verify.** Open a note that embeds a moved file. It should render with a faint dashed outline (your reminder that this file now lives off-vault; you can switch the outline off).

To split attachments across several free cloud services, install each service's desktop sync client, give each one a folder, and list all of those folders in settings. The plugin treats them as one big pool.

## Settings

- **External folders** — an ordered list of absolute paths; add and remove freely. Earlier folders win when two hold the same filename.
- **Search subfolders** — off by default. When on, the plugin also indexes every subfolder of each external folder (filename → path, built lazily on first use).
- **Alignment** — left (default), center, or right, for externally-resolved media. A `|left`, `|center`, or `|right` segment on an individual wikilink overrides it.
- **Show visual indicator** — the dashed outline around externally-resolved embeds. On by default; purely cosmetic.

## Commands

- **Rescan current view** — re-render the active note. Useful right after you move a file externally.
- **Rebuild external folder index** — clear the subfolder index so the next lookup rebuilds it. Run this after adding many files to nested folders.

## Rules of the game

Every tool encodes assumptions; these deserve stating plainly rather than discovering painfully.

- **Desktop only.** The plugin reads the local filesystem, which mobile Obsidian doesn't expose.
- **Filenames act as addresses.** Keep them unique across your external folders. With duplicates, the first folder in your list wins — deterministic, but worth knowing.
- **Read-only rendering.** External files render into your notes but never rejoin the vault. Obsidian's own features (renaming, outgoing-link counts, canvas drag-in) don't see them.
- **Misses get cached per view.** If an embed resolves nowhere, the plugin marks it and moves on rather than hammering the disk on every keystroke. After you add the missing file, run the rescan command or reopen the note.
- **Privacy.** The plugin reads only the folders you list, makes zero network requests, and phones home to nobody. Your settings live in the plugin's own `data.json` and travel with whatever syncs your vault.

## Installing

Until the plugin lands in the community catalog, install with [BRAT](https://github.com/TfTHacker/obsidian42-brat) pointed at this repo, or copy `main.js`, `manifest.json`, and `styles.css` from a [release](https://github.com/DyllonWright/Obsidian-External-Attachments/releases) into `<vault>/.obsidian/plugins/external-attachments/`.

Upgrading from a pre-release single-folder build? Your existing `data.json` migrates automatically — the old mount path becomes the first entry in the folder list.

## Developing

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # typecheck + production bundle
npm test        # resolver test suite — keep it green
```

The resolver (`src/resolver.ts`) holds the filesystem logic plus the pure link helpers — `linkpathOf`, `mimeFor`, `parseEmbedSize` — and imports nothing from Obsidian, so the test suite exercises all of it directly against real temporary directories. The plugin shell (`src/main.ts`) handles the DOM side: markdown post-processing for reading view, a `MutationObserver` for live preview, sizing the rendered media, and blob-URL lifecycle management so memory gets released when embeds leave the screen.

One stylistic note for contributors: the README and UI text keep to [E-Prime](https://en.wikipedia.org/wiki/E-Prime) — English without any form of "to be" — as a small tribute to Korzybski and Robert Anton Wilson, who argued that dropping "is" makes claims about *what happened* easier to tell apart from claims about *what things really are*. A plugin whose entire job involves the gap between a link and a file might as well practice what it renders.

## License

MIT
