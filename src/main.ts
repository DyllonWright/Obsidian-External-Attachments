import { MarkdownView, Notice, Plugin } from "obsidian";
import * as path from "path";
import {
	ALIGNMENTS, AUDIO_EXT, IMG_EXT, PDF_EXT, VIDEO_EXT,
	Alignment, EmbedSize, MountResolver,
	linkpathOf, mimeFor, parseEmbedAlign, parseEmbedSize
} from "./resolver";
import { holdsEmbedsOnly, isEmbedRow } from "./layout";
import { ExternalAttachmentsSettingTab, ExternalAttachmentsSettings, migrateSettings } from "./settings";

interface EmbedContext {
	sourcePath: string;
}

export default class ExternalAttachmentsPlugin extends Plugin {
	settings: ExternalAttachmentsSettings;
	resolver: MountResolver;
	private blobUrls = new Set<string>();
	/** One per rendered embed, watching for its removal. Held so unloading the
	 *  plugin disconnects the ones whose embeds still sit on screen. */
	private mediaObservers = new Set<MutationObserver>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.resolver = new MountResolver({
			mounts: this.settings.mounts,
			recursive: this.settings.recursive
		});

		this.addSettingTab(new ExternalAttachmentsSettingTab(this.app, this));

		this.registerMarkdownPostProcessor((el, ctx) => {
			this.processEmbeds(el, ctx);
		});

		// Live Preview doesn't fire the markdown post-processor for unresolved
		// embeds. Watch the workspace DOM and intercept embed elements as
		// CodeMirror inserts them.
		const liveObserver = new MutationObserver((mutations) => {
			if (!this.resolver.active) return;
			for (const m of mutations) {
				for (const n of m.addedNodes) {
					if (!n.instanceOf(Element)) continue;
					if (n.matches(".internal-embed:not([data-external-attachment])")) {
						void this.tryResolveExternal(n, { sourcePath: "" });
					}
					n.querySelectorAll(".internal-embed:not([data-external-attachment])").forEach((em) => {
						void this.tryResolveExternal(em, { sourcePath: "" });
					});
				}
			}
		});
		liveObserver.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
		this.register(() => liveObserver.disconnect());

		this.addCommand({
			id: "rescan-current-view",
			name: "Rescan current view",
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				view?.previewMode?.rerender(true);
			}
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild external folder index",
			callback: () => {
				this.resolver.invalidate();
				new Notice("External Attachments: index cleared; it rebuilds on the next lookup.");
			}
		});
	}

	onunload(): void {
		for (const observer of this.mediaObservers) observer.disconnect();
		this.mediaObservers.clear();
		for (const url of this.blobUrls) URL.revokeObjectURL(url);
		this.blobUrls.clear();
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const { settings, migrated } = migrateSettings(raw);
		this.settings = settings;
		if (migrated) await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.resolver.setOptions({
			mounts: this.settings.mounts,
			recursive: this.settings.recursive
		});
	}

	private processEmbeds(el: HTMLElement, ctx: EmbedContext): void {
		if (!this.resolver.active) return;
		el.querySelectorAll("span.internal-embed, div.internal-embed").forEach((embed) => {
			void this.tryResolveExternal(embed, ctx);
		});
	}

	private async tryResolveExternal(embed: Element, ctx: EmbedContext): Promise<void> {
		try {
			await this.resolveEmbed(embed as HTMLElement, ctx);
		} catch (err) {
			console.warn("External Attachments: resolve failed for", embed.getAttribute("src"), err);
		}
	}

	private async resolveEmbed(embed: HTMLElement, ctx: EmbedContext): Promise<void> {
		const src = embed.getAttribute("src");
		if (!src) return;
		if (embed.getAttribute("data-external-attachment")) return;

		const linkpath = linkpathOf(src);
		const sourcePath = ctx?.sourcePath ?? "";

		// Capture the layout hints while the original markup still stands:
		// empty() below discards the link text an unresolved embed carries.
		const size = this.readSize(embed, src);
		const align = parseEmbedAlign(src, embed.getAttribute("alt"), embed.textContent)
			?? this.settings.alignment;

		// If the vault already resolves it, stay out of the way and let
		// Obsidian render normally.
		const vaultFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (vaultFile) return;

		const basename = path.basename(linkpath);
		const found = await this.resolver.resolve(basename);
		if (!found) {
			// Not present externally either — leave the broken embed as-is,
			// but remember the miss so we don't re-stat on every DOM change.
			embed.setAttribute("data-external-attachment", "miss");
			return;
		}

		const buffer = await this.resolver.read(found);
		const blob = new Blob([new Uint8Array(buffer)], { type: mimeFor(basename) });
		const url = URL.createObjectURL(blob);
		this.blobUrls.add(url);

		// Free the blob URL when this embed leaves the DOM.
		const parent = embed.parentNode;
		if (parent) {
			const observer = new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const n of m.removedNodes) {
						if (n === embed || (n.instanceOf(Element) && n.contains(embed))) {
							URL.revokeObjectURL(url);
							this.blobUrls.delete(url);
							observer.disconnect();
							this.mediaObservers.delete(observer);
							return;
						}
					}
				}
			});
			observer.observe(parent, { childList: true });
			this.mediaObservers.add(observer);
		}

		embed.empty();
		// Shed every placeholder/error class Obsidian left on the unresolved
		// embed. mod-empty-attachment matters as much as the rest: themes hang
		// empty-state styling on it, and it outlives the emptying that earned
		// it unless we take it off.
		embed.removeClass("is-unresolved");
		embed.removeClass("mod-error");
		embed.removeClass("file-embed");
		embed.removeClass("mod-empty-attachment");

		// Deliberately *not* wearing Obsidian's own embed classes (image-embed,
		// media-embed, is-loaded). Themes hang layout on them: Minimal, for one,
		// restyles the wrapper of anything containing .image-embed
		// (`.markdown-preview-sizer > :has(.image-embed)`) and drives its
		// click-to-zoom off `.image-embed:active`. A blob-backed embed that
		// can't satisfy the rest of those contracts ends up mis-placed and
		// half-zoomable, so it stays out of that namespace and carries only its
		// own classes.
		let mediaEl: HTMLElement | null = null;
		if (IMG_EXT.test(basename)) {
			mediaEl = embed.createEl("img", { attr: { src: url, alt: basename } });
		} else if (VIDEO_EXT.test(basename)) {
			mediaEl = embed.createEl("video", { attr: { src: url, controls: "controls" } });
		} else if (AUDIO_EXT.test(basename)) {
			mediaEl = embed.createEl("audio", { attr: { src: url, controls: "controls" } });
		} else if (PDF_EXT.test(basename)) {
			mediaEl = embed.createEl("iframe", { attr: { src: url, width: "100%", height: "600px" } });
		} else {
			embed.createEl("a", { text: "↗ " + basename, attr: { href: url, download: basename } });
		}

		// A row of embeds sharing one wrapper flows inline so the images sit
		// side by side; a lone embed keeps the full-width block Obsidian gave
		// it and positions its media inside. isEmbedRow() insists the wrapper
		// holds embeds only — in Live Preview the parent is `.cm-content`,
		// which holds the whole note, so a bare count would call every embed
		// in a multi-image file part of one row.
		const line = embed.parentElement;
		const row = isEmbedRow(line);

		if (mediaEl) this.applySize(mediaEl, size, row ? embed : null);
		this.applyAlign(embed, align, row ? line : null);

		embed.setAttribute("data-external-attachment", "true");
		if (this.settings.showIndicator) {
			// Outline whichever box hugs the media: the shrink-wrapped container
			// in a row, the media itself when the container spans the column.
			const target = row ? embed : (mediaEl ?? embed);
			target.addClass("external-attachment-indicator");
		}
	}

	/**
	 * Collect every place the `|WIDTH` hint might survive, in order of trust:
	 * the raw src, the alt Obsidian derived from it, the width/height pair a
	 * resolved embed would carry, and finally the link text rendered inside an
	 * unresolved embed (Live Preview keeps the size only there).
	 */
	private readSize(embed: HTMLElement, src: string): EmbedSize | null {
		const width = embed.getAttribute("width");
		const height = embed.getAttribute("height");
		const paired = width && height ? `${width}x${height}` : width;

		const size = parseEmbedSize(
			src,
			embed.getAttribute("alt"),
			paired,
			embed.textContent
		);
		if (size && !size.height && height && /^\d+$/.test(height.trim())) {
			size.height = height.trim();
		}
		return size;
	}

	/**
	 * Size the media the way Obsidian sizes its own: width in pixels, height
	 * free to follow the aspect ratio unless the link named one. Inline styles
	 * carry it so a theme rule on `.internal-embed img` can't win. The
	 * container takes the same width — it stays block-level otherwise, and a
	 * 300 px image would sit inside a full-width box, stretching the indicator
	 * outline right across the note.
	 */
	private applySize(mediaEl: HTMLElement, size: EmbedSize | null, shrink: HTMLElement | null): void {
		if (!size) return;

		mediaEl.setAttribute("width", size.width);
		mediaEl.style.width = `${size.width}px`;
		if (size.height) {
			mediaEl.setAttribute("height", size.height);
			mediaEl.style.height = `${size.height}px`;
		} else if (mediaEl.tagName !== "IFRAME") {
			// A PDF frame keeps its own viewport height; everything else follows
			// its aspect ratio.
			mediaEl.style.height = "auto";
		}

		// Only a container in a row shrink-wraps. A lone embed keeps the width
		// Obsidian gave it — in Live Preview that block *is* the readable-line
		// column, and narrowing it would unmoor the image from the text.
		if (!shrink) return;
		shrink.setAttribute("width", size.width);
		if (size.height) shrink.setAttribute("height", size.height);
		shrink.style.width = `${size.width}px`;
		shrink.addClass("external-attachment-sized");
	}

	/**
	 * Place the embed with `text-align` on the embed itself.
	 *
	 * The container already spans the text column — Obsidian gives it that in
	 * reading view via the paragraph, and in Live Preview via readable-line
	 * width, which centres each block child of `.cm-content`. Aligning the
	 * media *inside* that box therefore lines it up with the surrounding prose,
	 * and touches nothing the note shares. Moving the box instead, as an
	 * earlier build did with auto margins, drags the image off the text column
	 * entirely in Live Preview.
	 *
	 * `line` arrives non-null only for a row of embeds, whose shrink-wrapped
	 * containers need their shared wrapper aligned instead.
	 */
	private applyAlign(embed: HTMLElement, align: Alignment, line: HTMLElement | null): void {
		embed.addClass(`external-attachment-align-${align}`);
		embed.style.textAlign = align;

		if (!line || !holdsEmbedsOnly(line)) return;
		for (const a of ALIGNMENTS) line.removeClass(`external-attachment-line-${a}`);
		line.addClass(`external-attachment-line-${align}`);
		line.style.textAlign = align;
	}
}
